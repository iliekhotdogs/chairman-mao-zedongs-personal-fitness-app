// Permanently deletes the caller's account. Deploy with JWT verification on.
// Removes every photo under "<uid>/" at any depth, then deletes the auth user;
// database rows cascade (records, usage, profiles, push tokens, notification log).
//
// Disabled accounts may still delete themselves (their right to erase their data);
// in practice a disabled user is banned and their sessions are ended, so the app
// owner deletes such accounts from the Supabase dashboard instead.
import { admin, isOwner, requestUser } from '../_shared/auth.ts';
import { json as jsonFor, preflight } from '../_shared/http.ts';

const BUCKET = 'food-photos';
const BATCH = 1000;
/** 2,000 photos per account is the upload cap; this leaves room for older objects. */
const MAX_BATCHES = 50;

/** Deletes every object whose name starts with "<userId>/". The names come from
 * storage.objects through a service-role RPC (Storage's list() is per folder and
 * easy to get wrong for nested paths); files are removed through the Storage API so
 * the stored bytes go too. Returns the number of objects removed. */
async function removeAllPhotos(userId: string): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc('user_storage_objects', { p_user: userId, p_limit: BATCH });
    if (error) throw new Error(`Could not list photos: ${error.message}`);
    const names = ((data ?? []) as { name: string }[]).map((row) => row.name).filter((name) => name.startsWith(`${userId}/`));
    if (!names.length) return removed;
    const { data: gone, error: removeError } = await admin.storage.from(BUCKET).remove(names);
    if (removeError) throw new Error(`Could not delete photos: ${removeError.message}`);
    if (!gone?.length) throw new Error('Storage removed nothing; stopping to avoid a loop.');
    removed += gone.length;
  }
  throw new Error(`More than ${MAX_BATCHES * BATCH} objects; run again.`);
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);
  const user = await requestUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (isOwner(user.id)) return json({ error: 'The bootstrap admin account cannot delete itself. Change ADMIN_USER_ID first.' }, 400);

  try {
    await removeAllPhotos(user.id);
  } catch (error) {
    console.error(error);
    return json({ error: 'Could not delete your photos. Nothing else was deleted; try again.' }, 502);
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error(`deleteUser ${user.id}: ${error.message}`);
    return json({ error: 'Your photos were deleted, but the account could not be. Try again.' }, 502);
  }
  return json({ ok: true });
});
