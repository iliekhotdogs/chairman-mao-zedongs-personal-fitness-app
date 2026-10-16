-- Run after 20261015000400_bug_reports_user_stats.sql.
-- 1. admin_user_stats skips malformed record values instead of failing the whole RPC.
-- 2. Users can delete their own bug reports; the daily cap moves to a counter so deleting
--    does not free up quota.

-- Cast helpers: null instead of an error for anything that is not a plain date / number
-- (exponent forms like 1e-7 also read as null).
create or replace function public.safe_date(p text)
returns date language plpgsql stable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null; -- e.g. 2026-13-45
end;
$$;

create or replace function public.safe_numeric(p text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^-?\d{1,15}(\.\d+)?$' then return null; end if;
  return p::numeric;
end;
$$;
revoke all on function public.safe_date(text) from public, anon, authenticated;
revoke all on function public.safe_numeric(text) from public, anon, authenticated;

-- Same output as 20261015000400; every cast of record JSON goes through the helpers.
create or replace function public.admin_user_stats(p_user uuid)
returns json language sql security definer set search_path = '' stable as $$
  with live as (
    select collection, id, data from public.records
    where user_id = p_user and not deleted and collection in ('foodLog', 'sessions', 'weights')
  ),
  active_days as (
    select distinct d from (
      select public.safe_date(data->>'date') as d from live
      where collection = 'foodLog' or (collection = 'sessions' and data->>'finishedAt' is not null)
    ) x where d is not null
  ),
  ranked as (
    select d, row_number() over (order by d desc) as rn from active_days where d <= (now() at time zone 'utc')::date
  ),
  streak as (
    select count(*) as n from ranked
    where d + (rn - 1)::int = (select d from ranked where rn = 1)
      and (select d from ranked where rn = 1) >= (now() at time zone 'utc')::date - 1
  ),
  food7 as (
    select d, kcal from (
      select public.safe_date(data->>'date') as d,
             coalesce((select sum(coalesce(public.safe_numeric(i->>'calories'), 0))
                       from jsonb_array_elements(case when jsonb_typeof(data->'items') = 'array' then data->'items' else '[]'::jsonb end) i), 0) as kcal
      from live where collection = 'foodLog'
    ) x
    where d > (now() at time zone 'utc')::date - 7
  )
  select json_build_object(
    'userId', u.id,
    'signedUpAt', u.created_at,
    'lastActiveAt', greatest(u.last_sign_in_at, (select max(synced_at) from public.records where user_id = u.id)),
    'foodEntries', (select count(*) from live where collection = 'foodLog'),
    'sessions', (select count(*) from live where collection = 'sessions'),
    'weighIns', (select count(*) from live where collection = 'weights'),
    'currentStreak', (select n from streak),
    'goal', (select data->>'goal' from public.records where user_id = u.id and collection = 'singleton' and id = 'profile' and not deleted),
    'avgKcal7d', (select round(sum(kcal) / nullif(count(distinct d), 0)) from food7),
    'targetKcal', (select public.safe_numeric(data->>'calories') from public.records where user_id = u.id and collection = 'singleton' and id = 'targets' and not deleted),
    'aiRequestsTotal', coalesce((select sum(requests) from public.ai_usage where user_id = u.id), 0),
    'disabled', coalesce((select disabled from public.profiles where user_id = u.id), false)
  )
  from auth.users u where u.id = p_user;
$$;
revoke all on function public.admin_user_stats(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_stats(uuid) to service_role;

-- Owner delete.
grant delete on public.bug_reports to authenticated;
create policy "bug_reports: owner delete" on public.bug_reports
  for delete to authenticated using (auth.uid() = user_id);

-- Daily cap counts sends, not surviving rows, so delete-and-resend cannot bypass it.
-- shortcut: the window is the UTC day rather than a rolling 24 hours.
create table public.bug_report_counts (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  n       integer not null default 0,
  primary key (user_id, day)
);
alter table public.bug_report_counts enable row level security;
revoke all on public.bug_report_counts from anon, authenticated;
grant select, insert, update, delete on public.bug_report_counts to service_role;

create or replace function public.bug_reports_rate_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sent integer;
begin
  insert into public.bug_report_counts as c (user_id, day, n)
  values (new.user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set n = c.n + 1
  returning c.n into sent;
  if sent > 10 then
    raise exception 'Bug report limit reached (10 per day).' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.bug_reports_rate_limit() from public, anon, authenticated;
