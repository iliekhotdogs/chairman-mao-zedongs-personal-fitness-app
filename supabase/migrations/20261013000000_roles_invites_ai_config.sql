-- Run after 20261003000000_shared_accounts_ai.sql.
-- Adds roles (profiles), invite-only signup, the admin-chosen AI provider
-- (app_config), quota refunds, admin RPCs and per-user data caps.
-- Every new table is service-role only except profiles, which users can read
-- (their own row only). No client can write any of them.

-- ---------------------------------------------------------------------------
-- 1. Profiles: role + disabled flag. Roles never come from user_metadata.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'user' check (role in ('admin', 'user')),
  disabled   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
drop policy if exists "profiles: owner read" on public.profiles;
create policy "profiles: owner read" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

-- Every auth user gets a profile, however it was created (invite, dashboard, CLI).
create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Invites. A code is claimed by setting used_at (atomic), then used_by is
--    filled in once the account exists. used_email survives account deletion.
-- ---------------------------------------------------------------------------
create table if not exists public.invites (
  code       text primary key check (code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_by    uuid references auth.users (id) on delete set null,
  used_at    timestamptz,
  used_email text,
  note       text check (note is null or char_length(note) <= 200)
);
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant select, insert, update, delete on public.invites to service_role;

create or replace function public.claim_invite(p_code text, p_email text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed text;
begin
  update public.invites
  set used_at = now(), used_email = p_email
  where code = p_code
    and used_at is null
    and used_by is null
    and (expires_at is null or expires_at > now())
  returning code into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_invite(text, text) from public, anon, authenticated;
grant execute on function public.claim_invite(text, text) to service_role;

-- Gives a claimed code back when account creation failed.
create or replace function public.release_invite(p_code text)
returns void language sql security invoker set search_path = '' as $$
  update public.invites set used_at = null, used_email = null
  where code = p_code and used_by is null;
$$;
revoke all on function public.release_invite(text) from public, anon, authenticated;
grant execute on function public.release_invite(text) to service_role;

-- Per-IP signup attempts, so invite codes cannot be brute-forced.
create table if not exists public.signup_attempts (
  ip       text not null,
  day      date not null,
  attempts integer not null default 0 check (attempts >= 0),
  primary key (ip, day)
);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;
grant select, insert, update, delete on public.signup_attempts to service_role;

create or replace function public.claim_signup_attempt(p_ip text, p_day date, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  insert into public.signup_attempts (ip, day, attempts)
  values (p_ip, p_day, 1)
  on conflict (ip, day) do update
    set attempts = public.signup_attempts.attempts + 1
    where public.signup_attempts.attempts < p_limit
  returning attempts into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_signup_attempt(text, date, integer) from public, anon, authenticated;
grant execute on function public.claim_signup_attempt(text, date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Global AI configuration, chosen by the admin. Exactly one row (id = 1).
--    Provider/model ids are validated by the Edge Function's registry.
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  id                   smallint primary key default 1 check (id = 1),
  provider             text not null default 'groq' check (provider in ('groq', 'gemini', 'nvidia')),
  chat_model           text not null default 'openai/gpt-oss-120b',
  vision_model         text not null default 'qwen/qwen3.8-27b',
  per_user_daily_limit integer not null default 5 check (per_user_daily_limit between 0 and 10000),
  global_daily_limit   integer not null default 40 check (global_daily_limit between 0 and 1000000),
  ai_enabled           boolean not null default true,
  updated_at           timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select, insert, update on public.app_config to service_role;
insert into public.app_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Quota refund: give back a claimed AI request when the provider failed.
-- ---------------------------------------------------------------------------
create or replace function public.release_ai_request(p_user uuid, p_day date)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.ai_usage set requests = greatest(requests - 1, 0)
  where user_id = p_user and day = p_day;
  update public.ai_global_usage set requests = greatest(requests - 1, 0)
  where day = p_day;
end;
$$;
revoke all on function public.release_ai_request(uuid, date) from public, anon, authenticated;
grant execute on function public.release_ai_request(uuid, date) to service_role;
grant delete on public.ai_usage to service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin RPCs (service role only; the admin Edge Function checks the role).
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats()
returns json language sql security definer set search_path = '' stable as $$
  select json_build_object(
    'accounts', (select count(*) from auth.users),
    'active7Days', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'disabledAccounts', (select count(*) from public.profiles where disabled),
    'foodEntries', (select count(*) from public.records where collection = 'foodLog' and not deleted),
    'workoutSessions', (select count(*) from public.records where collection = 'sessions' and not deleted),
    'chatMessages', (select count(*) from public.records where collection = 'chat' and not deleted),
    'aiRequestsToday', coalesce((select requests from public.ai_global_usage where day = (now() at time zone 'utc')::date), 0),
    'openInvites', (select count(*) from public.invites where used_at is null and (expires_at is null or expires_at > now())),
    'measuredAt', now()
  );
$$;
revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;

create or replace function public.admin_list_users(p_limit integer default 200, p_offset integer default 0)
returns table (
  user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  email_confirmed_at timestamptz, role text, disabled boolean, ai_requests_today integer
) language sql security definer set search_path = '' stable as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
         coalesce(p.role, 'user'), coalesce(p.disabled, false), coalesce(a.requests, 0)
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join public.ai_usage a on a.user_id = u.id and a.day = (now() at time zone 'utc')::date
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0);
$$;
revoke all on function public.admin_list_users(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(integer, integer) to service_role;

create or replace function public.admin_list_invites()
returns table (
  code text, created_at timestamptz, expires_at timestamptz, used_at timestamptz,
  used_email text, note text, status text
) language sql security definer set search_path = '' stable as $$
  select i.code, i.created_at, i.expires_at, i.used_at,
         coalesce(u.email::text, i.used_email), i.note,
         case when i.used_by is not null or i.used_at is not null then 'used'
              when i.expires_at is not null and i.expires_at <= now() then 'expired'
              else 'open' end
  from public.invites i
  left join auth.users u on u.id = i.used_by
  order by i.created_at desc
  limit 200;
$$;
revoke all on function public.admin_list_invites() from public, anon, authenticated;
grant execute on function public.admin_list_invites() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Data caps. Simple guards against one account filling the database.
--    records: at most 50,000 rows per user (new rows only; edits always work).
--    food-photos: at most 2,000 objects per user folder.
-- ---------------------------------------------------------------------------
create or replace function public.records_row_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare existing integer;
begin
  -- An upsert of an existing row becomes an update; never block it.
  if exists (select 1 from public.records r
             where r.user_id = new.user_id and r.collection = new.collection and r.id = new.id) then
    return new;
  end if;
  select count(*) into existing
  from (select 1 from public.records r where r.user_id = new.user_id limit 50000) capped;
  if existing >= 50000 then
    raise exception 'Record limit reached (50,000 per account). Delete old data or contact the app owner.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.records_row_cap() from public, anon, authenticated;
drop trigger if exists records_row_cap on public.records;
create trigger records_row_cap
  before insert on public.records
  for each row execute function public.records_row_cap();

-- Counts only the caller's own photos (auth.uid()), so it reveals nothing about others.
create or replace function public.food_photo_count()
returns integer language sql security definer set search_path = '' stable as $$
  select count(*)::integer from (
    select 1 from storage.objects o
    where o.bucket_id = 'food-photos' and (storage.foldername(o.name))[1] = (select auth.uid())::text
    limit 2000
  ) capped;
$$;
revoke all on function public.food_photo_count() from public, anon;
grant execute on function public.food_photo_count() to authenticated;

drop policy if exists "food-photos: owner write" on storage.objects;
create policy "food-photos: owner write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'food-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.food_photo_count() < 2000
  );
