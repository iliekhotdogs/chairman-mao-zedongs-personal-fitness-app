// Deletes the calling user's photos, rows and auth user. verify_jwt = true; the user id comes from the token only.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'Sign in first' }, 401);
  const uid = auth.user.id;

  for (;;) {
    const { data: files, error } = await admin.storage.from('food-photos').list(uid, { limit: 1000 });
    if (error) return json({ error: 'Could not delete photos' }, 502);
    if (!files?.length) break;
    const { error: rmError } = await admin.storage.from('food-photos').remove(files.map((f) => `${uid}/${f.name}`));
    if (rmError) return json({ error: 'Could not delete photos' }, 502);
  }
  // Every user table references auth.users on delete cascade, so deleting the user removes the rows too.
  const { error: delError } = await admin.auth.admin.deleteUser(uid);
  if (delError) return json({ error: 'Could not delete account' }, 502);
  return json({ deleted: true });
});
