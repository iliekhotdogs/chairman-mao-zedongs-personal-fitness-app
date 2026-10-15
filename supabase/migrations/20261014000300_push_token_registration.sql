-- Run after 20261014000200_records_synced_at_clock.sql.
-- Expo push token registration (src/lib/notifications/push.ts).
-- A device token belongs to whoever is signed in on that device now: registering
-- it removes it from any other account, so a shared or handed-down phone never
-- receives the previous user's coaching messages. Each account keeps at most
-- 10 devices (the oldest registrations are dropped).

create index if not exists push_tokens_token_idx on public.push_tokens (token);

create or replace function public.register_push_token(p_token text, p_platform text, p_timezone text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_token is null or char_length(p_token) > 200 or p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'Not an Expo push token.' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'Unsupported platform.' using errcode = '22023';
  end if;
  delete from public.push_tokens where token = p_token and user_id <> uid;
  insert into public.push_tokens (user_id, token, platform, timezone, created_at)
  values (uid, p_token, p_platform, left(coalesce(nullif(p_timezone, ''), 'UTC'), 64), now())
  on conflict (user_id, token) do update
    set platform = excluded.platform, timezone = excluded.timezone, created_at = now();
  delete from public.push_tokens
  where user_id = uid
    and token not in (
      select t.token from public.push_tokens t where t.user_id = uid order by t.created_at desc limit 10
    );
end;
$$;
revoke all on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;
