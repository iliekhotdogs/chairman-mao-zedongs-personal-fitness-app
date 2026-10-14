-- Run after 20261014000100_ai_ip_limit.sql.
-- Sync pull race fix (see src/lib/sync/sync.ts, pullSince).
--
-- records.synced_at is the pull cursor. It used to be now(), the START of the
-- writing transaction, so a slow transaction could commit rows stamped earlier
-- than a cursor another device had already passed, and those rows were never
-- pulled. Two changes close that gap:
--   1. Stamp with clock_timestamp() (the moment the row is written), which keeps
--      the stamp-to-commit gap down to the rest of that one statement.
--   2. server_time() lets the client learn the database clock before each pull.
--      Rows stamped more than a settle window (15 s, longer than Supabase's 8 s
--      statement timeout for API roles) before that time have certainly
--      committed. The client re-reads rows from that point on the next pull, so
--      a late commit is picked up; last-write-wins merging makes re-reads harmless.

create or replace function public.records_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old; -- keep the newer row (no-op update)
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

-- The trigger itself is unchanged (records_lww, before insert or update, for each row).

create or replace function public.server_time()
returns timestamptz language sql volatile security invoker set search_path = '' as $$
  select clock_timestamp();
$$;
revoke all on function public.server_time() from public, anon;
grant execute on function public.server_time() to authenticated, service_role;
