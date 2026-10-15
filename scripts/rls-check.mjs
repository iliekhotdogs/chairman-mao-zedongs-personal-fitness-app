#!/usr/bin/env node
// Row Level Security isolation check for a FitCoach Supabase project.
//
// Creates two throwaway, confirmed users (A and B), writes a record and a food photo as A,
// then checks that B (and an anonymous client) cannot read, change or delete them, cannot
// call the admin function, and cannot read server-only tables. Both users and A's photo
// are deleted at the end, also when a check fails.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
//   SUPABASE_SECRET_KEY=sb_secret_... \
//   npm run check:rls -- --yes
//
// Use a staging/test project. It writes to the database and Storage of the project you
// point it at (and cleans up after itself). The secret key never leaves this process.
// Exit code: 0 = all checks passed, 1 = a check failed, 2 = bad setup.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const clean = (value) => (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const PROJECT_URL = clean(process.env.SUPABASE_URL).replace(/\/$/, '');
const PUBLISHABLE = clean(process.env.SUPABASE_PUBLISHABLE_KEY);
const SECRET = clean(process.env.SUPABASE_SECRET_KEY);

if (!PROJECT_URL || !PUBLISHABLE || !SECRET) {
  console.error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (service role / sb_secret_ key).');
  process.exit(2);
}
if (!process.argv.includes('--yes')) {
  console.error(`This creates and deletes two test users in ${PROJECT_URL}.\nRe-run with --yes to continue (npm run check:rls -- --yes).`);
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(PROJECT_URL, SECRET, options);
const BUCKET = 'food-photos';
const RECORD_ID = 'rls-check-record';
const run = randomBytes(4).toString('hex');

let failures = 0;
function check(ok, label, detail = '') {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`);
  }
}

/** A "no access" result: an error (e.g. permission denied) or zero rows. */
const denied = ({ data, error }) => Boolean(error) || !data || (Array.isArray(data) && data.length === 0);
const describe = ({ data, error }) => (error ? `error: ${error.message}` : `got ${Array.isArray(data) ? `${data.length} row(s)` : JSON.stringify(data)}`);

async function createUser(tag) {
  const email = `rls-check-${run}-${tag}@example.com`;
  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create test user ${tag}: ${error?.message}`);
  const client = createClient(PROJECT_URL, PUBLISHABLE, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Test user ${tag} could not sign in: ${signInError.message}`);
  return { id: data.user.id, client };
}

const users = [];
let photoPath = null;
/** Other objects the run may have created (removed in cleanup if they exist). */
const extraPaths = [];

async function main() {
  console.log(`RLS check against ${PROJECT_URL} (run ${run})`);
  const a = await createUser('a');
  users.push(a);
  const b = await createUser('b');
  users.push(b);
  const anon = createClient(PROJECT_URL, PUBLISHABLE, options);

  console.log('\nUser A writes its own data');
  const record = { user_id: a.id, collection: 'weights', id: RECORD_ID, data: { id: RECORD_ID, date: '2026-01-01', weightKg: 80, updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString(), deleted: false };
  const write = await a.client.from('records').upsert(record, { onConflict: 'user_id,collection,id' });
  check(!write.error, 'A can write its own record', write.error?.message);
  const own = await a.client.from('records').select('id').eq('user_id', a.id);
  check(own.data?.length === 1, 'A can read its own record', describe(own));
  photoPath = `${a.id}/rls-check.jpg`;
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const upload = await a.client.storage.from(BUCKET).upload(photoPath, jpeg, { contentType: 'image/jpeg', upsert: true });
  check(!upload.error, 'A can upload a photo to its folder', upload.error?.message);
  const ownPhoto = await a.client.storage.from(BUCKET).download(photoPath);
  check(!ownPhoto.error, 'A can download its own photo', ownPhoto.error?.message);
  const progressPath = `${a.id}/progress/rls-check-${run}.jpg`;
  extraPaths.push(progressPath);
  const progress = await a.client.storage.from(BUCKET).upload(progressPath, jpeg, { contentType: 'image/jpeg', upsert: true });
  check(!progress.error, 'A can upload a progress photo (<uid>/progress/<id>.jpg)', progress.error?.message);

  console.log('\nUploads must follow the app\'s path pattern');
  for (const [path, label] of [
    [`${a.id}/deep/nested/rls-check-${run}.jpg`, 'a nested folder'],
    [`${a.id}/rls-check-${run}.html`, 'a non-image extension'],
    [`${a.id}/progress/x/rls-check-${run}.jpg`, 'a folder below progress/'],
  ]) {
    extraPaths.push(path);
    const odd = await a.client.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg' });
    check(Boolean(odd.error), `A cannot upload to ${label}`, odd.error ? '' : `upload to ${path} succeeded`);
  }

  console.log('\nPush tokens are written only through register_push_token');
  const token = `ExponentPushToken[rls-check-${run}]`;
  const directInsert = await a.client.from('push_tokens').insert({ user_id: a.id, token, platform: 'android' });
  check(Boolean(directInsert.error), 'A cannot insert a push token directly', directInsert.error ? '' : 'insert succeeded');
  const directUpdate = await a.client.from('push_tokens').update({ token: `${token}x` }).eq('user_id', a.id).select('token');
  check(denied(directUpdate), 'A cannot update push tokens directly', describe(directUpdate));
  const registered = await a.client.rpc('register_push_token', { p_token: token, p_platform: 'android', p_timezone: 'UTC' });
  check(!registered.error, 'A can register a push token through the RPC', registered.error?.message);
  const ownTokens = await a.client.from('push_tokens').select('token').eq('user_id', a.id);
  check(ownTokens.data?.length === 1, 'A can read its own push token', describe(ownTokens));
  const removedToken = await a.client.from('push_tokens').delete().eq('user_id', a.id).eq('token', token).select('token');
  check(removedToken.data?.length === 1, 'A can delete its own push token (sign-out)', describe(removedToken));

  console.log('\nUser B cannot see or touch A\'s records');
  const readA = await b.client.from('records').select('id').eq('user_id', a.id);
  check(denied(readA), 'B reads 0 of A\'s records', describe(readA));
  const readAll = await b.client.from('records').select('user_id');
  check(!readAll.error && (readAll.data ?? []).every((row) => row.user_id === b.id), 'B sees only its own rows in records', describe(readAll));
  const update = await b.client.from('records').update({ data: { hacked: true } }).eq('user_id', a.id).select('id');
  check(denied(update), 'B cannot update A\'s record', describe(update));
  const del = await b.client.from('records').delete().eq('user_id', a.id).select('id');
  check(denied(del), 'B cannot delete A\'s record', describe(del));
  const insert = await b.client.from('records').insert({ ...record, id: 'rls-check-forged' });
  check(Boolean(insert.error), 'B cannot insert a record owned by A', insert.error ? '' : 'insert succeeded');
  const stillThere = await admin.from('records').select('data').eq('user_id', a.id).eq('id', RECORD_ID).maybeSingle();
  check(stillThere.data && !stillThere.data.data?.hacked, 'A\'s record is unchanged (checked with the service role)', describe(stillThere));
  const forged = await admin.from('records').select('id').eq('user_id', a.id).eq('id', 'rls-check-forged');
  check((forged.data ?? []).length === 0, 'No forged record exists for A', describe(forged));

  console.log('\nUser B cannot reach A\'s photos');
  const download = await b.client.storage.from(BUCKET).download(photoPath);
  check(Boolean(download.error), 'B cannot download A\'s photo', download.error ? '' : 'download succeeded');
  const signed = await b.client.storage.from(BUCKET).createSignedUrl(photoPath, 60);
  check(Boolean(signed.error) || !signed.data?.signedUrl, 'B cannot create a signed PROJECT_URL for A\'s photo', signed.error ? '' : 'signed PROJECT_URL created');
  const list = await b.client.storage.from(BUCKET).list(a.id);
  check(denied(list), 'B lists 0 files in A\'s folder', describe(list));
  const overwrite = await b.client.storage.from(BUCKET).upload(photoPath, jpeg, { contentType: 'image/jpeg', upsert: true });
  check(Boolean(overwrite.error), 'B cannot overwrite A\'s photo', overwrite.error ? '' : 'upload succeeded');
  const plant = await b.client.storage.from(BUCKET).upload(`${a.id}/planted-${run}.jpg`, jpeg, { contentType: 'image/jpeg' });
  check(Boolean(plant.error), 'B cannot upload into A\'s folder', plant.error ? '' : 'upload succeeded');
  await b.client.storage.from(BUCKET).remove([photoPath]);
  const afterRemove = await admin.storage.from(BUCKET).download(photoPath);
  check(!afterRemove.error, 'A\'s photo survives B\'s delete attempt (checked with the service role)', afterRemove.error?.message);

  console.log('\nUser B is not an admin');
  const stats = await b.client.functions.invoke('admin-stats', { body: { action: 'stats' } });
  const status = stats.error?.context?.status;
  check(status === 403, 'admin-stats "stats" returns 403 for B', stats.error ? `status ${status ?? 'unknown'}${status === 404 ? ': is admin-stats deployed?' : ''}` : 'returned data');
  const rpcStats = await b.client.rpc('admin_stats');
  check(Boolean(rpcStats.error), 'B cannot call the admin_stats RPC directly', rpcStats.error ? '' : 'RPC returned data');
  const claim = await b.client.rpc('claim_ai_request', { p_user: b.id, p_day: '2026-01-01', p_user_limit: 1000, p_global_limit: 1000 });
  check(Boolean(claim.error), 'B cannot call the claim_ai_request RPC', claim.error ? '' : 'RPC ran');
  const listA = await b.client.rpc('user_storage_objects', { p_user: a.id, p_limit: 10 });
  check(Boolean(listA.error), 'B cannot call user_storage_objects for A', listA.error ? '' : describe(listA));
  const revoke = await b.client.rpc('admin_revoke_sessions', { p_user: a.id });
  check(Boolean(revoke.error), 'B cannot call admin_revoke_sessions', revoke.error ? '' : 'RPC ran');
  for (const action of ['check', 'stats', 'list_users', 'create_invite', 'list_invites', 'revoke_invite', 'set_disabled', 'reset_quota', 'get_config', 'set_config', 'set_role']) {
    const result = await b.client.functions.invoke('admin-stats', { body: { action } });
    check(result.error?.context?.status === 403, `B gets 403 for admin action ${action}`);
  }
  const roleRpc = await b.client.rpc('admin_set_role', { p_actor: b.id, p_target: a.id, p_role: 'admin', p_owner: null });
  check(Boolean(roleRpc.error), 'B cannot call admin_set_role directly', roleRpc.error ? '' : 'RPC ran');

  console.log('\nServer-only tables are closed to B');
  for (const table of ['app_config', 'invites', 'ai_global_usage', 'signup_attempts', 'ai_ip_usage', 'food_search_global_usage', 'user_ai_prefs', 'admin_audit', 'admin_bootstrap_emails']) {
    const result = await b.client.from(table).select('*').limit(5);
    check(denied(result), `B cannot read ${table}`, describe(result));
  }
  for (const table of ['profiles', 'push_tokens', 'notification_log', 'ai_usage', 'food_search_usage']) {
    const result = await b.client.from(table).select('user_id').eq('user_id', a.id);
    check(denied(result), `B cannot read A's rows in ${table}`, describe(result));
  }
  const ownProfile = await b.client.from('profiles').select('role').eq('user_id', b.id).maybeSingle();
  check(ownProfile.data?.role === 'user', 'B reads its own profile with role "user"', describe(ownProfile));
  const promote = await b.client.from('profiles').update({ role: 'admin' }).eq('user_id', b.id).select('role');
  check(denied(promote), 'B cannot make itself admin', describe(promote));
  const prefRead = await b.client.from('user_ai_prefs').select('*').eq('user_id', a.id);
  check(denied(prefRead), 'B cannot read A\'s AI preference', describe(prefRead));
  const prefWrite = await b.client.from('user_ai_prefs').insert({ user_id: a.id, provider: 'groq', chat_model: 'openai/gpt-oss-120b' });
  check(Boolean(prefWrite.error), 'B cannot write A\'s AI preference');
  for (const choice of [{ provider: 'nvidia', chat_model: 'moonshotai/kimi-k2.6' }, { provider: 'groq', chat_model: 'z-ai/glm-5.3-flash' }]) {
    const response = await b.client.functions.invoke('ai', { body: { action: 'set_preference', ...choice } });
    check(response.error?.context?.status === 400, `AI rejects unlisted choice ${choice.provider}/${choice.chat_model}`);
    const unchanged = await admin.from('user_ai_prefs').select('user_id').eq('user_id', b.id);
    check(!unchanged.error && (unchanged.data ?? []).length === 0, 'Invalid choice changes no preference');
  }
  const roleWrite = await b.client.from('profiles').update({ role: 'admin' }).eq('user_id', a.id).select('role');
  check(denied(roleWrite), 'B cannot change A\'s role', describe(roleWrite));
  const configWrite = await b.client.from('app_config').update({ ai_enabled: false }).eq('id', 1).select('id');
  check(denied(configWrite), 'B cannot change app_config', describe(configWrite));

  console.log('\nAnonymous (signed-out) client');
  const anonRecords = await anon.from('records').select('id').limit(5);
  check(denied(anonRecords), 'anon reads 0 records', describe(anonRecords));
  const anonPhoto = await anon.storage.from(BUCKET).download(photoPath);
  check(Boolean(anonPhoto.error), 'anon cannot download A\'s photo', anonPhoto.error ? '' : 'download succeeded');
}

async function cleanup() {
  console.log('\nCleaning up');
  if (photoPath) {
    const { error } = await admin.storage.from(BUCKET).remove([photoPath]);
    if (error) console.log(`  could not delete ${photoPath}: ${error.message}`);
  }
  if (extraPaths.length) {
    const { error } = await admin.storage.from(BUCKET).remove(extraPaths);
    if (error) console.log(`  could not delete extra test objects: ${error.message}`);
  }
  for (const user of users) {
    await user.client.auth.signOut().catch(() => {});
    // Records, usage rows and profiles cascade from auth.users.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    console.log(error ? `  could not delete test user ${user.id}: ${error.message}` : `  deleted test user ${user.id}`);
  }
}

try {
  await main();
} catch (error) {
  failures++;
  console.error(`\nSetup error: ${error instanceof Error ? error.message : error}`);
} finally {
  await cleanup();
}
console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll RLS checks passed.');
process.exit(failures ? 1 : 0);
