// Supabase Edge Function: claim a coaching-notification slot and (optionally) push it.
//   POST { title, body, dedupe_key, local_date: 'YYYY-MM-DD', push?: boolean }
//   → { allowed: boolean, pushed: number }
//
// The hard limit of 3 coaching notifications per user per day is enforced here, in the
// database function `claim_notification_slot`, so it holds across every device the user
// has. The app asks for a slot before showing any coaching notification.
// With push=true it also sends to the user's registered devices through Expo's push
// service (requires a development/production build with push credentials).

import { admin, requestUser } from '../_shared/auth.ts';
import { json as jsonFor, preflight, readJsonBody } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  const json = (b: unknown, status = 200) => jsonFor(req, b, status);
  const user = await requestUser(req);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const b = await readJsonBody(req, 8_000).catch(() => null);
  if (!b?.title || !b?.dedupe_key || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.local_date ?? ''))) return json({ error: 'Bad request' }, 400);

  const { data: allowed, error } = await admin.rpc('claim_notification_slot', {
    p_user: user.id,
    p_local_date: b.local_date,
    p_dedupe: String(b.dedupe_key).slice(0, 200),
    p_title: String(b.title).slice(0, 120),
    p_body: String(b.body ?? '').slice(0, 400),
  });
  if (error) return json({ error: error.message }, 500);
  if (!allowed || !b.push) return json({ allowed: Boolean(allowed), pushed: 0 });

  const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', user.id);
  const messages = (tokens ?? []).filter((t) => t.token.startsWith('ExponentPushToken')).map((t) => ({ to: t.token, title: b.title, body: b.body, channelId: 'coach' }));
  if (!messages.length) return json({ allowed: true, pushed: 0 });
  const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messages) });
  return json({ allowed: true, pushed: res.ok ? messages.length : 0 });
});
