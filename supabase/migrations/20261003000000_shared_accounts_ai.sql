-- Run after 0001_init.sql. Public clients get only their own rows; the shared
-- OpenRouter key and aggregate usage are available to Edge Functions only.

grant select, insert, update, delete on public.records to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant select on public.notification_log, public.ai_usage to authenticated;

create table if not exists public.ai_global_usage (
  day date primary key,
  requests integer not null default 0 check (requests >= 0)
);
alter table public.ai_global_usage enable row level security;
revoke all on public.ai_global_usage from anon, authenticated;
grant select, insert, update on public.ai_global_usage to service_role;
grant select, insert, update on public.ai_usage to service_role;

-- Invoked only by the Edge Function service-role client. Row updates are atomic,
-- so concurrent requests cannot both claim the last free request.
create or replace function public.claim_ai_request(
  p_user uuid, p_day date, p_user_limit integer, p_global_limit integer
) returns text language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  if p_user_limit < 1 or p_global_limit < 1 then
    return 'disabled';
  end if;
  insert into public.ai_usage (user_id, day, requests)
  values (p_user, p_day, 1)
  on conflict (user_id, day) do update
    set requests = public.ai_usage.requests + 1
    where public.ai_usage.requests < p_user_limit
  returning requests into claimed;
  if claimed is null then return 'user_limit'; end if;

  claimed := null;
  insert into public.ai_global_usage (day, requests)
  values (p_day, 1)
  on conflict (day) do update
    set requests = public.ai_global_usage.requests + 1
    where public.ai_global_usage.requests < p_global_limit
  returning requests into claimed;
  if claimed is null then
    update public.ai_usage set requests = requests - 1
    where user_id = p_user and day = p_day;
    return 'global_limit';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.claim_ai_request(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_request(uuid, date, integer, integer) to service_role;

create or replace function public.record_ai_tokens(
  p_user uuid, p_day date, p_input integer, p_output integer
) returns void language sql security invoker set search_path = '' as $$
  update public.ai_usage
  set input_tokens = input_tokens + greatest(p_input, 0),
      output_tokens = output_tokens + greatest(p_output, 0)
  where user_id = p_user and day = p_day;
$$;
revoke all on function public.record_ai_tokens(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.record_ai_tokens(uuid, date, integer, integer) to service_role;

-- An object must stay in the owner's folder even when it is updated.
drop policy if exists "food-photos: owner update" on storage.objects;
create policy "food-photos: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- USDA search uses a separate allowance, so manual food lookup cannot exhaust
-- the model budget and cannot be used without limit against the owner's USDA key.
create table if not exists public.food_search_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (user_id, day)
);
create table if not exists public.food_search_global_usage (
  day date primary key,
  requests integer not null default 0 check (requests >= 0)
);
alter table public.food_search_usage enable row level security;
alter table public.food_search_global_usage enable row level security;
revoke all on public.food_search_usage, public.food_search_global_usage from anon, authenticated;
grant select, insert, update on public.food_search_usage, public.food_search_global_usage to service_role;

create or replace function public.claim_food_search(
  p_user uuid, p_day date, p_user_limit integer, p_global_limit integer
) returns text language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  if p_user_limit < 1 or p_global_limit < 1 then return 'disabled'; end if;
  insert into public.food_search_usage (user_id, day, requests)
  values (p_user, p_day, 1)
  on conflict (user_id, day) do update
    set requests = public.food_search_usage.requests + 1
    where public.food_search_usage.requests < p_user_limit
  returning requests into claimed;
  if claimed is null then return 'user_limit'; end if;
  claimed := null;
  insert into public.food_search_global_usage (day, requests)
  values (p_day, 1)
  on conflict (day) do update
    set requests = public.food_search_global_usage.requests + 1
    where public.food_search_global_usage.requests < p_global_limit
  returning requests into claimed;
  if claimed is null then
    update public.food_search_usage set requests = requests - 1
    where user_id = p_user and day = p_day;
    return 'global_limit';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.claim_food_search(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_food_search(uuid, date, integer, integer) to service_role;
