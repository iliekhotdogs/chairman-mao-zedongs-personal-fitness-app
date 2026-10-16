-- Run after 20261015000500_admin_stats_safe_casts_bug_delete.sql.
-- Shared, read-only restaurant nutrition catalog. Filled only by the restaurant-import Edge
-- Function (service role); signed-in users can read items, nobody else can write.

create table if not exists public.restaurant_sources (
  id text primary key,
  restaurant text not null,
  url text not null check (url ~ '^https://'),
  parser text not null,
  enabled boolean not null default false,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'ok', 'needs_review', 'disabled')),
  review_note text
);

create table if not exists public.restaurant_items (
  id bigint generated always as identity primary key,
  source_id text not null references public.restaurant_sources (id) on delete cascade,
  restaurant text not null,
  name text not null check (length(name) between 2 and 120),
  serving text not null check (length(serving) between 1 and 80),
  calories numeric not null check (calories > 0 and calories <= 5000),
  protein_g numeric not null check (protein_g between 0 and 400),
  carbs_g numeric not null check (carbs_g between 0 and 400),
  fat_g numeric not null check (fat_g between 0 and 400),
  source_url text not null,
  checked_at timestamptz not null
);
create index if not exists restaurant_items_restaurant_idx on public.restaurant_items (restaurant);
create index if not exists restaurant_items_source_idx on public.restaurant_items (source_id);

alter table public.restaurant_sources enable row level security;
alter table public.restaurant_items enable row level security;
revoke all on public.restaurant_sources from public, anon, authenticated;
revoke all on public.restaurant_items from public, anon, authenticated;
grant select on public.restaurant_items to authenticated;
drop policy if exists "restaurant_items: signed-in read" on public.restaurant_items;
create policy "restaurant_items: signed-in read" on public.restaurant_items for select to authenticated using (true);

-- Atomic swap of one source's rows (called by restaurant-import after validation).
create or replace function public.replace_restaurant_items(p_source text, p_items jsonb, p_checked_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_restaurant text;
  v_count integer;
begin
  select restaurant into v_restaurant from public.restaurant_sources where id = p_source for update;
  if v_restaurant is null then raise exception 'unknown restaurant source %', p_source; end if;
  delete from public.restaurant_items where source_id = p_source;
  insert into public.restaurant_items (source_id, restaurant, name, serving, calories, protein_g, carbs_g, fat_g, source_url, checked_at)
  select p_source, v_restaurant, i.name, i.serving, i.calories, i.protein_g, i.carbs_g, i.fat_g, i.source_url, p_checked_at
  from jsonb_to_recordset(p_items) as i(name text, serving text, calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, source_url text);
  get diagnostics v_count = row_count;
  update public.restaurant_sources
    set status = 'ok', review_note = null, last_checked_at = p_checked_at, last_success_at = p_checked_at
    where id = p_source;
  return v_count;
end;
$$;
revoke all on function public.replace_restaurant_items(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.replace_restaurant_items(text, jsonb, timestamptz) to service_role;

-- Sources. Both sites' robots.txt allow the pages, but their terms forbid automated
-- access / scraping and reuse, so both start disabled. Enable one only with written
-- permission from the restaurant (or a licensed data feed): update ... set enabled = true.
insert into public.restaurant_sources (id, restaurant, url, parser, enabled, status, review_note) values
  ('boston_pizza_ca', 'Boston Pizza', 'https://bostonpizza.com/en/nutritional-information.html', 'boston_pizza_ca', false, 'disabled',
   'Checked 2026-10-15. robots.txt allows this page, but the Legal Disclaimer (https://bostonpizza.com/en/legal-disclaimer.html, s.11 and s.13) prohibits scraping and data-mining and copying or republishing content beyond personal, non-commercial use. Disabled until Boston Pizza gives written permission.'),
  ('olive_garden_ca', 'Olive Garden', 'https://www.olivegarden.ca/content/dam/cara/en/olive-garden-image-library/downloads/olive_garden_nutrition.pdf', 'olive_garden_ca', false, 'disabled',
   'Checked 2026-10-15. robots.txt has no Disallow rules, but the Terms and Conditions (https://www.olivegarden.ca/en/terms.html) prohibit robots or other automatic means of access and compiling content into a database; use is limited to personal, non-commercial use. The site also blocks non-browser clients (HTTP 403). The PDF linked from olivegarden.ca is titled "U.S. Restaurants, excludes Hawaii", so its values may differ from Canadian menus. Disabled until permission is obtained.')
on conflict (id) do nothing;

-- Weekly refresh (Mondays 07:00 UTC) when pg_cron and pg_net are available. The job reads
-- the project URL and service-role key from Vault (secrets 'project_url' and
-- 'service_role_key'; see docs/SETUP.md) and does nothing until both exist.
-- Without these extensions, schedule it by hand (docs/SETUP.md).
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('restaurant-import-weekly', '0 7 * * 1', $job$
      select net.http_post(
        url := u.decrypted_secret || '/functions/v1/restaurant-import',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || k.decrypted_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
      from vault.decrypted_secrets u, vault.decrypted_secrets k
      where u.name = 'project_url' and k.name = 'service_role_key';
    $job$);
  else
    raise notice 'pg_cron/pg_net not available: schedule restaurant-import manually (docs/SETUP.md).';
  end if;
end
$outer$;
