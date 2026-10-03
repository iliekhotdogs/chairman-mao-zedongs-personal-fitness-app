// Supabase Edge Function: claim a coaching-notification slot and (optionally) push it.
//   POST { title, body, dedupe_key, local_date: 'YYYY-MM-DD', push?: boolean }
//   → { allowed: boolean, pushed: number }
//
// The hard limit of 3 coaching notifications per user per day is enforced here, in the
// database function `claim_notification_slot`, so it holds across every device the user
// has. The app asks for a slot before showing any coaching notification.
// With push=true it also sends to the user's registered devices through Expo's push
// service (requires a development/production build with push credentials).

import { createClient } from 'npm:@supabase/supabase-js@^2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: 'Not signed in' }, 401);

  const b = await req.json().catch(() => null);
  if (!b?.title || !b?.dedupe_key || !/^\d{4}-\d{2}-\d{2}$/.test(b.local_date ?? '')) return json({ error: 'Bad request' }, 400);

  const { data: allowed, error } = await admin.rpc('claim_notification_slot', {
    p_user: auth.user.id,
    p_local_date: b.local_date,
    p_dedupe: String(b.dedupe_key).slice(0, 200),
    p_title: String(b.title).slice(0, 120),
    p_body: String(b.body ?? '').slice(0, 400),
  });
  if (error) return json({ error: error.message }, 500);
  if (!allowed || !b.push) return json({ allowed: Boolean(allowed), pushed: 0 });

  const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', auth.user.id);
  const messages = (tokens ?? []).filter((t) => t.token.startsWith('ExponentPushToken')).map((t) => ({ to: t.token, title: b.title, body: b.body, channelId: 'coach' }));
  if (!messages.length) return json({ allowed: true, pushed: 0 });
  const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messages) });
  return json({ allowed: true, pushed: res.ok ? messages.length : 0 });
});
