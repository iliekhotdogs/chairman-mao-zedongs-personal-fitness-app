-- FitCoach backend schema (Supabase / Postgres)
-- Run with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Privacy model: every row belongs to one user. Row Level Security (RLS) makes it
-- impossible for one signed-in user to read or change another user's rows, even
-- though the app's public (anon/publishable) key is shipped inside the app.

-- ---------------------------------------------------------------------------
-- 1. Synced records (food log, weights, workouts, proposals, chat, …)
-- ---------------------------------------------------------------------------
create table if not exists public.records (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  collection  text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null,           -- client edit time (last-write-wins)
  deleted     boolean     not null default false,
  synced_at   timestamptz not null default now(), -- server time, used as the pull cursor
  primary key (user_id, collection, id),
  constraint records_collection_check check (collection in (
    'dayAdjustments','workoutOverrides','foodLog','weights','routines','sessions',
    'activity','proposals','chat','notifications','singleton'
  )),
  constraint records_size_check check (pg_column_size(data) < 200000)
);

create index if not exists records_user_synced_idx on public.records (user_id, synced_at);

-- Server-side last-write-wins: ignore an upsert that is older than what is stored,
-- and always stamp synced_at with the server clock.
create or replace function public.records_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old; -- keep the newer row (no-op update)
  end if;
  new.synced_at := now();
  return new;
end;
$$;

drop trigger if exists records_lww on public.records;
create trigger records_lww
before insert or update on public.records
for each row execute function public.records_lww();

alter table public.records enable row level security;

drop policy if exists "records: owner can read" on public.records;
create policy "records: owner can read" on public.records
  for select using (auth.uid() = user_id);

drop policy if exists "records: owner can insert" on public.records;
create policy "records: owner can insert" on public.records
  for insert with check (auth.uid() = user_id);

drop policy if exists "records: owner can update" on public.records;
create policy "records: owner can update" on public.records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "records: owner can delete" on public.records;
create policy "records: owner can delete" on public.records
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Private food-photo storage: users/<user_id>/<entry_id>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-photos', 'food-photos', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "food-photos: owner read" on storage.objects;
create policy "food-photos: owner read" on storage.objects
  for select using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "food-photos: owner write" on storage.objects;
create policy "food-photos: owner write" on storage.objects
  for insert with check (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "food-photos: owner update" on storage.objects;
create policy "food-photos: owner update" on storage.objects
  for update using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "food-photos: owner delete" on storage.objects;
create policy "food-photos: owner delete" on storage.objects
  for delete using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3. Push notifications: device tokens + a server-enforced daily cap
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  user_id    uuid not null references auth.users (id) on delete cascade,
  token      text not null,
  platform   text not null check (platform in ('android','web','ios')),
  timezone   text not null default 'UTC',
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);
alter table public.push_tokens enable row level security;
drop policy if exists "push_tokens: owner all" on public.push_tokens;
create policy "push_tokens: owner all" on public.push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.notification_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  local_date  date not null,          -- the user's calendar day
  dedupe_key  text not null,
  title       text not null,
  body        text not null,
  sent_at     timestamptz not null default now(),
  unique (user_id, local_date, dedupe_key)
);
create index if not exists notification_log_user_day_idx on public.notification_log (user_id, local_date);
alter table public.notification_log enable row level security;
drop policy if exists "notification_log: owner read" on public.notification_log;
create policy "notification_log: owner read" on public.notification_log
  for select using (auth.uid() = user_id);
-- No insert policy for users: only the server (service role) records sends.

-- Atomically claim one of the user's 3 daily notification slots.
-- Returns true if the notification may be sent. Called by the server with the service role.
create or replace function public.claim_notification_slot(p_user uuid, p_local_date date, p_dedupe text, p_title text, p_body text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  sent_today int;
begin
  -- serialise per user+day so two devices/servers can't both take the 3rd slot
  perform pg_advisory_xact_lock(hashtext(p_user::text || p_local_date::text));
  select count(*) into sent_today from public.notification_log where user_id = p_user and local_date = p_local_date;
  if sent_today >= 3 then
    return false;
  end if;
  insert into public.notification_log (user_id, local_date, dedupe_key, title, body)
  values (p_user, p_local_date, p_dedupe, p_title, p_body)
  on conflict (user_id, local_date, dedupe_key) do nothing;
  return found;
end;
$$;

revoke all on function public.claim_notification_slot(uuid, date, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. AI usage metering (cost control): requests per user per day
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null default current_date,
  requests   int  not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage: owner read" on public.ai_usage;
create policy "ai_usage: owner read" on public.ai_usage for select using (auth.uid() = user_id);
