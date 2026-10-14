// Invite-only signup. Deploy WITHOUT JWT verification (--no-verify-jwt): the
// caller has no account yet. Public signups can then be switched off in
// Supabase Auth, because this function creates users with the service role.
// Body: { email, password, code }. The client signs in with the password afterwards.
import { admin } from '../_shared/auth.ts';
import { BodyError, clientIp, json as jsonFor, preflight, readJsonBody, utcDay } from '../_shared/http.ts';
import { validateSignup } from '../_shared/invite.ts';

/** Signup attempts per IP per UTC day, successful or not. */
const ATTEMPTS_PER_IP = 10;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);

  let body: Record<string, unknown>;
  try { body = await readJsonBody(request, 4_000); } catch (error) {
    return error instanceof BodyError ? json({ error: error.message }, error.status) : json({ error: 'Invalid request.' }, 400);
  }

  const { data: allowed, error: limitError } = await admin.rpc('claim_signup_attempt', { p_ip: clientIp(request), p_day: utcDay(), p_limit: ATTEMPTS_PER_IP });
  if (limitError) return json({ error: 'Signup is not ready. Apply the latest SQL migration first.' }, 503);
  if (!allowed) return json({ error: 'Too many signup attempts from this network today. Try again tomorrow.' }, 429);

  const check = validateSignup(body);
  if (!check.ok) return json({ error: check.error }, 400);
  const { email, password, code } = check.value;

  // Atomic: only one request can claim an unused, unexpired code.
  const { data: claimed, error: claimError } = await admin.rpc('claim_invite', { p_code: code, p_email: email });
  if (claimError) return json({ error: 'Signup is not ready. Apply the latest SQL migration first.' }, 503);
  if (!claimed) return json({ error: 'That invite code is invalid, expired or already used.' }, 400);

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) {
    await admin.rpc('release_invite', { p_code: code });
    const exists = createError && (createError.status === 422 || /already|registered|exists/i.test(createError.message));
    if (exists) return json({ error: 'An account with this email already exists. Sign in instead.' }, 409);
    console.error(`createUser failed: ${createError?.message}`);
    return json({ error: 'Could not create the account. Try again.' }, 502);
  }

  const userId = created.user.id;
  // The auth trigger normally creates the profile already; this keeps it certain.
  await admin.from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  const { error: linkError } = await admin.from('invites').update({ used_by: userId }).eq('code', code);
  if (linkError) console.error(`Invite ${code} claimed but not linked to ${userId}: ${linkError.message}`);
  return json({ ok: true });
});
