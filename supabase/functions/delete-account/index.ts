// Permanently deletes the caller's account. Deploy with JWT verification on.
// Removes every food photo under "<uid>/" (paginating past storage's 1000-item
// pages), then deletes the auth user; database rows cascade (records, usage,
// profiles, push tokens, notification log).
import { admin, requestUser } from '../_shared/auth.ts';
import { json as jsonFor, preflight } from '../_shared/http.ts';

const BUCKET = 'food-photos';
const PAGE = 1000;

/** Every object path under a folder, including nested folders. */
async function listAll(prefix: string, depth = 0): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list photos: ${error.message}`);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      // Folders come back without an id.
      if (item.id) paths.push(path);
      else if (depth < 5) paths.push(...await listAll(path, depth + 1));
    }
    if (!data || data.length < PAGE) break;
  }
  return paths;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);
  const user = await requestUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const owner = Deno.env.get('ADMIN_USER_ID')?.trim();
  if (owner && owner === user.id) return json({ error: 'The bootstrap admin account cannot delete itself. Change ADMIN_USER_ID first.' }, 400);

  try {
    const paths = await listAll(user.id);
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + PAGE));
      if (error) throw new Error(`Could not delete photos: ${error.message}`);
    }
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
