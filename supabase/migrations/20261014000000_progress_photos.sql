-- Run after 20261013000000_roles_invites_ai_config.sql.
-- Adds the `progressPhotos` synced collection (src/lib/state.ts SYNCED_COLLECTIONS).
--
-- Apply this BEFORE shipping a client that knows about progressPhotos: the client pushes
-- all changed rows in one upsert, so an unknown collection would fail the whole batch.
--
-- Photo files reuse the private `food-photos` bucket under <user_id>/progress/<id>.jpg.
-- The existing owner-only storage policies check only the first folder (the user id),
-- so no storage policy change is needed, and account deletion already removes them.

alter table public.records drop constraint if exists records_collection_check;
alter table public.records add constraint records_collection_check check (collection in (
  'dayAdjustments','workoutOverrides','foodLog','weights','routines','sessions',
  'activity','proposals','chat','notifications','progressPhotos','singleton'
));
