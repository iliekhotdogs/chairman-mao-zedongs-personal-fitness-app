-- Bug reports (user files, admin triages) and whitelisted per-user stats for the admin console.
-- Run after 20261015000200_user_ai_preference_admin.sql.

-- Idempotent: the owner's email auto-promotes to admin once confirmed (see handle_new_user_profile).
insert into public.admin_bootstrap_emails(email) values ('wesley.pang1@gmail.com') on conflict do nothing;

create table public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  route       text check (char_length(route) <= 200),
  app_version text check (char_length(app_version) <= 40),
  platform    text check (char_length(platform) <= 40),
  status      text not null default 'open' check (status in ('open', 'triaged', 'closed')),
  created_at  timestamptz not null default now()
);
create index bug_reports_user_idx on public.bug_reports (user_id, created_at desc);
create index bug_reports_status_idx on public.bug_reports (status, created_at desc);

-- Fail closed: a missing or disabled profile is not an admin.
create or replace function public.is_active_admin()
returns boolean language sql security definer set search_path = '' stable as $$
  select coalesce((select role = 'admin' and not disabled from public.profiles where user_id = auth.uid()), false);
$$;
revoke all on function public.is_active_admin() from public, anon;
grant execute on function public.is_active_admin() to authenticated, service_role;

alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
grant select, insert on public.bug_reports to authenticated;
grant update (status) on public.bug_reports to authenticated;
grant select, insert, update, delete on public.bug_reports to service_role;

create policy "bug_reports: owner insert" on public.bug_reports
  for insert to authenticated with check (auth.uid() = user_id and status = 'open');
create policy "bug_reports: owner select" on public.bug_reports
  for select to authenticated using (auth.uid() = user_id);
create policy "bug_reports: admin select" on public.bug_reports
  for select to authenticated using (public.is_active_admin());
create policy "bug_reports: admin update" on public.bug_reports
  for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());

-- Rate limit: 10 reports per user per rolling 24 hours.
create or replace function public.bug_reports_rate_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 20261015));
  if (select count(*) from public.bug_reports where user_id = new.user_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Bug report limit reached (10 per day).' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.bug_reports_rate_limit() from public, anon, authenticated;
create trigger bug_reports_rate_limit before insert on public.bug_reports
  for each row execute function public.bug_reports_rate_limit();

-- Whitelisted per-user stats. Reads counts and dates only; never returns chat text,
-- photos, raw weights, food items or push tokens. Service role only.
-- Streak and 7-day window use the UTC date (shortcut: users' local dates may differ by a day).
create or replace function public.admin_user_stats(p_user uuid)
returns json language sql security definer set search_path = '' stable as $$
  with live as (
    select collection, id, data from public.records
    where user_id = p_user and not deleted and collection in ('foodLog', 'sessions', 'weights')
  ),
  active_days as (
    select distinct (data->>'date')::date as d from live
    where (collection = 'foodLog' or (collection = 'sessions' and data->>'finishedAt' is not null))
      and data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
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
    select (data->>'date')::date as d,
           coalesce((select sum(coalesce((i->>'calories')::numeric, 0)) from jsonb_array_elements(data->'items') i), 0) as kcal
    from live
    where collection = 'foodLog' and data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
      and (data->>'date')::date > (now() at time zone 'utc')::date - 7
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
    'targetKcal', (select (data->>'calories')::numeric from public.records where user_id = u.id and collection = 'singleton' and id = 'targets' and not deleted),
    'aiRequestsTotal', coalesce((select sum(requests) from public.ai_usage where user_id = u.id), 0),
    'disabled', coalesce((select disabled from public.profiles where user_id = u.id), false)
  )
  from auth.users u where u.id = p_user;
$$;
revoke all on function public.admin_user_stats(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_stats(uuid) to service_role;
