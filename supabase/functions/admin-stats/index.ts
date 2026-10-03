// Aggregate-only dashboard for the app owner. Deploy with JWT verification on.
// Set ADMIN_USER_ID to the owner's Supabase auth user UUID as an Edge Function secret.
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
  if (authError || !auth.user || auth.user.is_anonymous) return json({ error: 'Sign in first' }, 401);
  const ownerId = Deno.env.get('ADMIN_USER_ID');
  if (!ownerId || auth.user.id !== ownerId) return json({ error: 'Admin access required' }, 403);

  let input: { action?: string } = {};
  try { input = await request.json(); } catch { /* Empty body means stats. */ }
  if (input.action === 'check') return json({ admin: true });

  // No user-level records, email addresses, health data or chat content leave this function.
  let accounts = 0;
  let active7Days = 0;
  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json({ error: 'Could not load account statistics.' }, 502);
    const users = data.users ?? [];
    accounts += users.length;
    active7Days += users.filter((user) => user.last_sign_in_at && new Date(user.last_sign_in_at).getTime() >= sevenDaysAgo).length;
    if (users.length < 1000) break;
  }
  const counts = await Promise.all([
    admin.from('records').select('id', { count: 'exact', head: true }).eq('collection', 'foodLog').eq('deleted', false),
    admin.from('records').select('id', { count: 'exact', head: true }).eq('collection', 'sessions').eq('deleted', false),
    admin.from('records').select('id', { count: 'exact', head: true }).eq('collection', 'chat').eq('deleted', false),
    admin.from('ai_global_usage').select('requests').eq('day', new Date().toISOString().slice(0, 10)).maybeSingle(),
  ]);
  if (counts.some((result) => result.error)) return json({ error: 'Could not load usage statistics. Apply the account SQL setup first.' }, 502);
  return json({
    accounts, active7Days,
    foodEntries: counts[0].count ?? 0,
    workoutSessions: counts[1].count ?? 0,
    chatMessages: counts[2].count ?? 0,
    aiRequestsToday: counts[3].data?.requests ?? 0,
    measuredAt: new Date().toISOString(),
  });
});
