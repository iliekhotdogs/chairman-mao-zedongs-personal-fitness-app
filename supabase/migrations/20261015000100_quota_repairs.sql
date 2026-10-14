-- Atomic quota repairs. Only Edge Functions (service role) may call these.
create or replace function public.release_food_search(p_user uuid, p_day date)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.food_search_usage set requests = greatest(requests - 1, 0)
  where user_id = p_user and day = p_day;
  update public.food_search_global_usage set requests = greatest(requests - 1, 0)
  where day = p_day;
end;
$$;
revoke all on function public.release_food_search(uuid, date) from public, anon, authenticated;
grant execute on function public.release_food_search(uuid, date) to service_role;

create or replace function public.admin_reset_ai_quota(p_user uuid, p_day date)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous_count integer;
begin
  select requests into previous_count from public.ai_usage
  where user_id = p_user and day = p_day for update;
  if previous_count is not null then
    update public.ai_usage set requests = 0 where user_id = p_user and day = p_day;
    update public.ai_global_usage set requests = greatest(requests - previous_count, 0)
    where day = p_day;
  end if;
end;
$$;
revoke all on function public.admin_reset_ai_quota(uuid, date) from public, anon, authenticated;
grant execute on function public.admin_reset_ai_quota(uuid, date) to service_role;
