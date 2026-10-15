-- Run after 20261013000000_roles_invites_ai_config.sql.
-- Per-IP daily cap on AI requests (coach chat and meal photos), on top of the
-- per-user and global caps. It stops one network from burning the shared
-- allowance through many accounts. The limit lives in app_config so the admin
-- can change it; 0 switches the per-IP cap off (it does not switch AI off).
-- IPs are stored as a salted SHA-256 hash computed by the Edge Function, never raw.

alter table public.app_config
  add column if not exists per_ip_daily_limit integer not null default 100
  check (per_ip_daily_limit between 0 and 100000);

create table if not exists public.ai_ip_usage (
  ip_hash  text    not null check (char_length(ip_hash) <= 128),
  day      date    not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (ip_hash, day)
);
create index if not exists ai_ip_usage_day_idx on public.ai_ip_usage (day);
alter table public.ai_ip_usage enable row level security;
revoke all on public.ai_ip_usage from anon, authenticated;
grant select, insert, update, delete on public.ai_ip_usage to service_role;

-- Atomically claims one request for this IP today. True if allowed.
-- Also clears rows older than a week, so the table stays small.
create or replace function public.claim_ai_ip_request(p_ip_hash text, p_day date, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  if p_limit < 1 then return true; end if;
  delete from public.ai_ip_usage where day < p_day - 7;
  insert into public.ai_ip_usage (ip_hash, day, requests)
  values (p_ip_hash, p_day, 1)
  on conflict (ip_hash, day) do update
    set requests = public.ai_ip_usage.requests + 1
    where public.ai_ip_usage.requests < p_limit
  returning requests into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_ai_ip_request(text, date, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_ip_request(text, date, integer) to service_role;

-- Gives a claimed request back (provider failure, or a per-user/global cap refused it).
create or replace function public.release_ai_ip_request(p_ip_hash text, p_day date)
returns void language sql security invoker set search_path = '' as $$
  update public.ai_ip_usage set requests = greatest(requests - 1, 0)
  where ip_hash = p_ip_hash and day = p_day;
$$;
revoke all on function public.release_ai_ip_request(text, date) from public, anon, authenticated;
grant execute on function public.release_ai_ip_request(text, date) to service_role;
