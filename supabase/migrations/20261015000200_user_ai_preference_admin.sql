-- Account AI choices and audited admin roles. Edge Functions use service_role.
create table public.user_ai_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('groq', 'gemini')),
  chat_model text not null check (char_length(chat_model) <= 100),
  updated_at timestamptz not null default now()
);
alter table public.user_ai_prefs enable row level security;
revoke all on public.user_ai_prefs from anon, authenticated;
grant select, insert, update, delete on public.user_ai_prefs to service_role;

alter table public.app_config
  add column allowed_providers text[] not null default array['groq','gemini']::text[],
  add column allow_user_choice boolean not null default true;

create table public.admin_bootstrap_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.admin_bootstrap_emails enable row level security;
revoke all on public.admin_bootstrap_emails from anon, authenticated;
grant select, insert, update, delete on public.admin_bootstrap_emails to service_role;
insert into public.admin_bootstrap_emails(email) values ('wesley.pang1@gmail.com') on conflict do nothing;

create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  target uuid references auth.users(id) on delete set null,
  at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
grant select, insert on public.admin_audit to service_role;

-- Called on insert and confirmation updates. An unconfirmed email never gains a role.
create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values (new.id) on conflict (user_id) do nothing;
  if new.email_confirmed_at is not null and exists (
    select 1 from public.admin_bootstrap_emails where email = lower(new.email)
  ) then
    update public.profiles set role = 'admin' where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.handle_new_user_profile();
update public.profiles set role = 'admin'
where user_id in (select id from auth.users where lower(email) = 'wesley.pang1@gmail.com' and email_confirmed_at is not null);

-- Row lock serializes role changes, including simultaneous last-admin demotions.
create or replace function public.admin_set_role(p_actor uuid, p_target uuid, p_role text, p_owner uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare current_role text;
begin
  if p_role not in ('admin', 'user') then return 'bad_role'; end if;
  perform pg_advisory_xact_lock(20261015);
  select role into current_role from public.profiles where user_id = p_target for update;
  if current_role is null then return 'missing'; end if;
  if p_role = 'user' and (p_target = p_owner or p_target = p_actor) then return 'protected'; end if;
  if p_role = 'user' and current_role = 'admin' and
    (select count(*) from public.profiles where role = 'admin' and disabled = false) <= 1 then return 'last_admin'; end if;
  if current_role <> p_role then
    update public.profiles set role = p_role where user_id = p_target;
    insert into public.admin_audit(actor, action, target) values (p_actor, 'set_role:' || p_role, p_target);
  end if;
  return 'ok';
end;
$$;
revoke all on function public.admin_set_role(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_role(uuid, uuid, text, uuid) to service_role;

drop function if exists public.admin_list_users(integer, integer);
create function public.admin_list_users(p_limit integer default 200, p_offset integer default 0)
returns table (
  user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  email_confirmed_at timestamptz, role text, disabled boolean, ai_requests_today integer,
  ai_provider text, ai_chat_model text
) language sql security definer set search_path = '' stable as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
         coalesce(p.role, 'user'), coalesce(p.disabled, false), coalesce(a.requests, 0),
         pref.provider, pref.chat_model
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join public.ai_usage a on a.user_id = u.id and a.day = (now() at time zone 'utc')::date
  left join public.user_ai_prefs pref on pref.user_id = u.id
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0);
$$;
revoke all on function public.admin_list_users(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(integer, integer) to service_role;
