-- Adds the `savedFoods` synced collection (src/lib/state.ts SYNCED_COLLECTIONS):
-- the personal food database (confirmed barcode products, restaurant dishes, custom foods).
--
-- Apply this BEFORE shipping a client that knows about savedFoods: the client pushes
-- all changed rows in one upsert, so an unknown collection would fail the whole batch.
-- Rows live in public.records, so the existing per-user RLS policies already cover them.

alter table public.records drop constraint if exists records_collection_check;
alter table public.records add constraint records_collection_check check (collection in (
  'dayAdjustments','workoutOverrides','foodLog','weights','routines','sessions',
  'activity','proposals','chat','notifications','progressPhotos','savedFoods','singleton'
));
