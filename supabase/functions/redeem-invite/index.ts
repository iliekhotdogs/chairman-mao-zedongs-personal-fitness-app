// Invite-only signup. Deploy WITHOUT JWT verification (--no-verify-jwt): the
// caller has no account yet. Public signups can then be switched off in
// Supabase Auth, because this function creates users with the service role.
// Body: { email, password, code }. The client signs in with the password afterwards.
import { admin } from '../_shared/auth.ts';
import { BodyError, clientIpHash, json as jsonFor, preflight, readJsonBody, utcDay } from '../_shared/http.ts';
import { validateSignup } from '../_shared/invite.ts';

/** Signup attempts per IP per UTC day, successful or not. */
const ATTEMPTS_PER_IP = 10;
/** Failed account creations one invite code survives before it is burned. */
const FAILURES_PER_CODE = 5;
const GENERIC_FAILURE = "Couldn't create the account. If you already have one, sign in or reset your password.";

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);

  let body: Record<string, unknown>;
  try { body = await readJsonBody(request, 4_000); } catch (error) {
    return error instanceof BodyError ? json({ error: error.message }, error.status) : json({ error: 'Invalid request.' }, 400);
  }

  const check = validateSignup(body);
  if (!check.ok) return json({ error: check.error }, 400);
  const { email, password, code } = check.value;
  const ipKey = await clientIpHash(request);
  if (ipKey) {
    const { data: allowed, error: limitError } = await admin.rpc('claim_signup_attempt', { p_ip: ipKey, p_day: utcDay(), p_limit: ATTEMPTS_PER_IP });
    if (limitError) return json({ error: 'Signup is not ready. Apply the latest SQL migration first.' }, 503);
    if (!allowed) return json({ error: 'Too many signup attempts from this network today. Try again tomorrow.' }, 429);
  }

  // Atomic: only one request can claim an unused, unexpired code.
  const { data: claimed, error: claimError } = await admin.rpc('claim_invite', { p_code: code, p_email: email });
  if (claimError) return json({ error: 'Signup is not ready. Apply the latest SQL migration first.' }, 503);
  if (!claimed) return json({ error: 'That invite code is invalid, expired or already used.' }, 400);

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) {
    // One generic answer whether or not the email already has an account, so the
    // endpoint cannot be used to find out who uses the app. The code is given back
    // (the person may have mistyped their email), but every failure is counted and
    // the code is burned after FAILURES_PER_CODE, so one code cannot probe emails
    // without limit.
    console.error(`createUser failed (status ${createError?.status ?? 'none'}): ${createError?.message}`);
    const { data: burned, error: failError } = await admin.rpc('fail_invite', { p_code: code, p_max_failures: FAILURES_PER_CODE });
    if (failError) {
      // Migration 20261015000000 not applied yet: keep the code claimed rather than
      // falling back to an unlimited release.
      console.error(`fail_invite ${code}: ${failError.message}`);
    } else if (burned) {
      console.error(`Invite ${code} burned after ${FAILURES_PER_CODE} failed redemptions.`);
    }
    return json({ error: GENERIC_FAILURE }, 400);
  }

  const userId = created.user.id;
  // The auth trigger normally creates the profile already; this keeps it certain.
  await admin.from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  const { error: linkError } = await admin.from('invites').update({ used_by: userId }).eq('code', code);
  if (linkError) console.error(`Invite ${code} claimed but not linked to ${userId}: ${linkError.message}`);
  return json({ ok: true });
});
