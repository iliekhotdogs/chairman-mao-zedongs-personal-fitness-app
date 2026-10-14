// Supabase Edge Function: claim a coaching-notification slot and (optionally) push it.
//   POST { dedupe_key, local_date: 'YYYY-MM-DD', category?: 'nutrition'|'workouts'|'checkins',
//          push?: boolean, exclude_token?: string }
//   → { allowed: boolean, pushed: number }
// Older app builds also send `title` and `body`; they are accepted and IGNORED. Pushed
// text comes from fixed server templates (_shared/notifyCopy.ts), so a client cannot
// push arbitrary text, and no health data goes through Expo/FCM. `local_date` must be
// within a day of the server's date. Disabled accounts are refused.
//
// The hard limit of 3 coaching notifications per user per day is enforced here, in the
// database function `claim_notification_slot`, so it holds across every device the user
// has. The app asks for a slot before showing any coaching notification.
// With push=true it also sends to the user's registered devices through Expo's push
// service, except `exclude_token` (the calling device, which shows it locally).
// Tokens Expo reports as DeviceNotRegistered are deleted. Requires push credentials
// (FCM V1 key in EAS) and builds with an EAS project id; see docs/RELEASE.md.
// Optional secret EXPO_ACCESS_TOKEN: needed only if "enhanced push security" is on in EAS.

import { admin, profileOf, requestUser } from '../_shared/auth.ts';
import { json as jsonFor, preflight, readJsonBody } from '../_shared/http.ts';
import { isPlausibleLocalDate, pushCopy } from '../_shared/notifyCopy.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH = 100;
const isExpoToken = (token: string) => /^Expo(nent)?PushToken\[.+\]$/.test(token);

type Ticket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string; expoPushToken?: string } };

/** Sends the messages; returns how many Expo accepted. Deletes tokens Expo says are dead. */
async function sendPush(tokens: string[], title: string, body: string): Promise<number> {
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN')?.trim();
  let accepted = 0;
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += EXPO_BATCH) {
    const batch = tokens.slice(i, i + EXPO_BATCH);
    const messages = batch.map((to) => ({ to, title, body, channelId: 'coach', priority: 'default' }));
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    }).catch((error) => {
      console.error(`Expo push request failed: ${error}`);
      return null;
    });
    if (!response) continue;
    const result = await response.json().catch(() => null) as { data?: Ticket[]; errors?: unknown[] } | null;
    if (!response.ok || !Array.isArray(result?.data)) {
      console.error(`Expo push ${response.status}: ${JSON.stringify(result?.errors ?? result).slice(0, 300)}`);
      continue;
    }
    result.data.forEach((ticket, index) => {
      if (ticket.status === 'ok') accepted++;
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(ticket.details.expoPushToken ?? batch[index]);
      else console.error(`Expo push ticket error: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`);
    });
  }
  if (dead.length) {
    // The token is dead for every account, not only this one.
    const { error } = await admin.from('push_tokens').delete().in('token', dead);
    if (error) console.error(`Could not delete dead push tokens: ${error.message}`);
  }
  return accepted;
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  const json = (b: unknown, status = 200) => jsonFor(req, b, status);
  const user = await requestUser(req);
  if (!user) return json({ error: 'Not signed in' }, 401);
  if ((await profileOf(user.id)).disabled) return json({ error: 'This account is disabled.' }, 403);

  const b = await readJsonBody(req, 8_000).catch(() => null);
  if (!b || typeof b.dedupe_key !== 'string' || !b.dedupe_key.trim()) return json({ error: 'Bad request' }, 400);
  if (!isPlausibleLocalDate(b.local_date, new Date())) return json({ error: 'local_date must be today\'s date.' }, 400);
  // Fixed copy keyed by category; client free text is never stored or pushed.
  const { title, body } = pushCopy(b);

  const { data: allowed, error } = await admin.rpc('claim_notification_slot', {
    p_user: user.id,
    p_local_date: b.local_date,
    p_dedupe: String(b.dedupe_key).slice(0, 200),
    p_title: title,
    p_body: body,
  });
  if (error) {
    console.error(`claim_notification_slot: ${error.message}`);
    return json({ error: 'Notification cap is not ready. Apply the SQL migrations first.' }, 500);
  }
  if (!allowed || b.push !== true) return json({ allowed: Boolean(allowed), pushed: 0 });

  const exclude = typeof b.exclude_token === 'string' ? b.exclude_token : '';
  const { data: rows, error: tokenError } = await admin.from('push_tokens').select('token').eq('user_id', user.id);
  if (tokenError) console.error(`push_tokens: ${tokenError.message}`);
  const tokens = [...new Set((rows ?? []).map((row) => String(row.token)))].filter((token) => isExpoToken(token) && token !== exclude);
  if (!tokens.length) return json({ allowed: true, pushed: 0 });
  return json({ allowed: true, pushed: await sendPush(tokens, title, body) });
});
