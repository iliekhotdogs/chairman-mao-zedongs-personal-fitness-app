-- Run after 20261014000300_push_token_registration.sql.
-- Security hardening from the 2026-10 audit. Idempotent: safe to re-run, and safe on
-- existing data (no rows are rewritten; new checks apply to new writes only).
--
--   1. push_tokens: clients may read and delete their own tokens, but only the
--      register_push_token RPC (security definer) can add or change one.
--   2. signup_attempts: rows older than a week are pruned on every claim (the
--      redeem-invite function now stores a keyed hash of the IP, not the raw address).
--   3. invites: failed_attempts counter. A code whose account creation failed 5 times
--      is burned, so one code cannot be used to probe which emails have accounts.
--   4. records_row_cap: a per-user advisory lock makes the 50,000-row cap exact
--      under concurrent inserts.
--   5. Storage: uploads must match <uid>/<id>.<ext> or <uid>/progress/<id>.<ext>
--      (the paths the app uses), keeping the 2,000-photo cap.
--   6. Service-role RPCs: user_storage_objects (account deletion finds every photo,
--      however deep) and admin_revoke_sessions (disabling a user ends their sessions).

-- ---------------------------------------------------------------------------
-- 1. push_tokens: no direct insert/update from clients.
--    Before this, a signed-in user could insert ANY token string under their own
--    account (e.g. someone else's device token) and have notify push to it.
--    register_push_token validates the token and is the only write path the app
--    uses (src/lib/notifications/push.ts); sign-out still deletes the row directly.
-- ---------------------------------------------------------------------------
revoke insert, update on public.push_tokens from authenticated, anon;
grant select, delete on public.push_tokens to authenticated;

drop policy if exists "push_tokens: owner all" on public.push_tokens;
drop policy if exists "push_tokens: owner read" on public.push_tokens;
create policy "push_tokens: owner read" on public.push_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "push_tokens: owner delete" on public.push_tokens;
create policy "push_tokens: owner delete" on public.push_tokens
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. signup_attempts pruning (same pattern as claim_ai_ip_request).
-- ---------------------------------------------------------------------------
create index if not exists signup_attempts_day_idx on public.signup_attempts (day);

create or replace function public.claim_signup_attempt(p_ip text, p_day date, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  delete from public.signup_attempts where day < p_day - 7;
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
-- 3. Invite failure counter. release_invite (old function, kept for deployed
--    functions) gives a code back unconditionally; fail_invite counts the failure
--    and keeps the code claimed (burned) from the 5th failure on.
-- ---------------------------------------------------------------------------
alter table public.invites
  add column if not exists failed_attempts integer not null default 0;

create or replace function public.fail_invite(p_code text, p_max_failures integer default 5)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare failures integer;
begin
  update public.invites
  set failed_attempts = failed_attempts + 1,
      used_email = null,
      -- Burned codes stay claimed (used_at set, used_by null) so claim_invite refuses them.
      used_at = case when failed_attempts + 1 >= p_max_failures then coalesce(used_at, now()) else null end
  where code = p_code and used_by is null
  returning failed_attempts into failures;
  return coalesce(failures, 0) >= p_max_failures;
end;
$$;
revoke all on function public.fail_invite(text, integer) from public, anon, authenticated;
grant execute on function public.fail_invite(text, integer) to service_role;

-- Same columns as before; burned codes now show as 'burned'.
create or replace function public.admin_list_invites()
returns table (
  code text, created_at timestamptz, expires_at timestamptz, used_at timestamptz,
  used_email text, note text, status text
) language sql security definer set search_path = '' stable as $$
  select i.code, i.created_at, i.expires_at, i.used_at,
         coalesce(u.email::text, i.used_email), i.note,
         case when i.used_by is null and i.failed_attempts >= 5 and i.used_at is not null then 'burned'
              when i.used_by is not null or i.used_at is not null then 'used'
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
-- 4. Row cap without a race: two concurrent inserts for the same user used to
--    both count 49,999 and both succeed. The transaction-scoped lock serialises
--    the count per user (other users are unaffected).
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
  perform pg_advisory_xact_lock(hashtext('records_row_cap:' || new.user_id::text));
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
-- The trigger from 20261013000000 already points at this function.

-- ---------------------------------------------------------------------------
-- 5. Storage upload paths. The app writes <uid>/<uuid>.jpg (food photos) and
--    <uid>/progress/<uuid>.jpg (progress photos), src/lib/sync/sync.ts. Anything
--    else (deep folders, odd names, other extensions) is refused. Existing objects
--    are untouched. Byte-size caps per account are future work (the bucket's
--    5 MB per-file limit still applies).
-- ---------------------------------------------------------------------------
drop policy if exists "food-photos: owner write" on storage.objects;
create policy "food-photos: owner write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'food-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/(progress/)?[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$')
    and public.food_photo_count() < 2000
  );

drop policy if exists "food-photos: owner update" on storage.objects;
create policy "food-photos: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'food-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/(progress/)?[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$')
  );

-- ---------------------------------------------------------------------------
-- 6a. Every object a user owns in food-photos, at any depth. Used by the
--     delete-account function (service role), which then removes them through the
--     Storage API (deleting storage.objects rows directly would leave the files).
-- ---------------------------------------------------------------------------
create or replace function public.user_storage_objects(p_user uuid, p_limit integer default 1000)
returns table (name text) language sql security definer set search_path = '' stable as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'food-photos'
    and o.name like p_user::text || '/%'
  order by o.name
  limit least(greatest(p_limit, 1), 1000);
$$;
revoke all on function public.user_storage_objects(uuid, integer) from public, anon, authenticated;
grant execute on function public.user_storage_objects(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6b. End every session of a user (all devices). supabase-js's
--     auth.admin.signOut() needs the user's own JWT, so the admin function cannot
--     use it for someone else. Deleting auth.sessions rows is what GoTrue's global
--     logout does: refresh tokens cascade, and GoTrue rejects access tokens whose
--     session no longer exists. Returns the number of sessions ended.
-- ---------------------------------------------------------------------------
create or replace function public.admin_revoke_sessions(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare ended integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics ended = row_count;
  return ended;
end;
$$;
revoke all on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;
