// Admin API for the owner screen (src/app/admin.tsx). Deploy with JWT verification on.
// Admin = profiles.role 'admin', or the bootstrap owner in the ADMIN_USER_ID secret.
// Actions: check, stats, list_users, create_invite, list_invites, revoke_invite,
// set_disabled, reset_quota, set_role, get_config, set_config, list_bugs, set_bug_status, user_stats.
// Audited (fail closed): set_disabled, reset_quota, set_role (in its RPC), list_bugs, set_bug_status, user_stats.
// No health data, records or chat content leave this function.
import { admin, isAdmin, isOwner, ownerId, profileOf, requestUser } from '../_shared/auth.ts';
import { BodyError, json as jsonFor, preflight, readJsonBody, utcDay } from '../_shared/http.ts';
import { describeRegistry, resolveConfig, validateConfigUpdate } from '../_shared/providers.ts';
import { isBugStatus, pickBugReport, pickUserStats } from '../_shared/userStats.ts';
import { generateInviteCode, inviteExpiry, normalizeInviteCode } from '../_shared/invite.ts';

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);
  const user = await requestUser(request);
  if (!user) return json({ error: 'Sign in first' }, 401);
  let authorized;
  try { authorized = await isAdmin(user); } catch { return json({ error: 'Account status is unavailable.' }, 503); }
  if (!authorized) return json({ error: 'Admin access required' }, 403);

  let input: Record<string, unknown>;
  try { input = await readJsonBody(request, 16_000, true); } catch (error) {
    return error instanceof BodyError ? json({ error: error.message }, error.status) : json({ error: 'Invalid request.' }, 400);
  }
  const action = typeof input.action === 'string' ? input.action : 'stats';
  // Fail closed: callers stop (503) when the audit row cannot be written. Mutations audit first.
  const audit = async (entry: string, target: string | null) => {
    const { error } = await admin.from('admin_audit').insert({ actor: user.id, action: entry, target });
    if (error) console.error(`admin_audit ${entry}: ${error.message}`);
    return !error;
  };
  const auditFailed = () => json({ error: 'Could not record the audit entry.' }, 503);

  switch (action) {
    case 'check':
      return json({ admin: true });

    case 'stats': {
      const { data, error } = await admin.rpc('admin_stats');
      if (error) return json({ error: 'Could not load statistics. Apply the latest SQL migration first.' }, 502);
      return json(data);
    }

    case 'list_users': {
      const offset = Number.isInteger(input.offset) ? input.offset as number : 0;
      const { data, error } = await admin.rpc('admin_list_users', { p_limit: 200, p_offset: offset });
      if (error) return json({ error: 'Could not load users.' }, 502);
      return json({ users: data ?? [] });
    }

    case 'create_invite': {
      const expiresAt = inviteExpiry(input.expiresInDays, new Date());
      if (expiresAt === undefined) return json({ error: 'Expiry must be 1 to 365 days, or empty for none.' }, 400);
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) || null : null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateInviteCode(randomBytes);
        const { error } = await admin.from('invites').insert({ code, created_by: user.id, expires_at: expiresAt, note });
        if (!error) return json({ code, expires_at: expiresAt, note });
        if (error.code !== '23505') return json({ error: 'Could not create the invite.' }, 502);
      }
      return json({ error: 'Could not create a unique invite code. Try again.' }, 502);
    }

    case 'list_invites': {
      const { data, error } = await admin.rpc('admin_list_invites');
      if (error) return json({ error: 'Could not load invites.' }, 502);
      return json({ invites: data ?? [] });
    }

    case 'revoke_invite': {
      const code = normalizeInviteCode(input.code);
      if (!code) return json({ error: 'Unknown invite code.' }, 400);
      // Used codes stay as a record of who joined with them.
      const { data, error } = await admin.from('invites').delete().eq('code', code).is('used_at', null).select('code');
      if (error) return json({ error: 'Could not revoke the invite.' }, 502);
      if (!data?.length) return json({ error: 'That invite is already used or does not exist.' }, 409);
      return json({ ok: true });
    }

    case 'set_disabled': {
      if (!isUuid(input.userId) || typeof input.disabled !== 'boolean') return json({ error: 'userId and disabled are required.' }, 400);
      if (input.userId === user.id) return json({ error: 'You cannot disable your own account.' }, 400);
      // The bootstrap owner (ADMIN_USER_ID) can never be disabled from the app, and only
      // the owner may disable or re-enable another admin. Otherwise one admin could lock
      // out every other admin, or a compromised admin account could lock out the owner.
      if (isOwner(input.userId)) return json({ error: 'The app owner account cannot be disabled.' }, 403);
      let target;
      try { target = await profileOf(input.userId); } catch { return json({ error: 'Account status is unavailable.' }, 503); }
      if (!target) return json({ error: 'Account profile is missing.' }, 404);
      if (target.role === 'admin' && !isOwner(user.id)) return json({ error: 'Only the app owner can disable or enable an admin.' }, 403);
      if (!await audit(input.disabled ? 'disable' : 'enable', input.userId)) return auditFailed();
      const { error } = await admin.from('profiles').upsert({ user_id: input.userId, disabled: input.disabled }, { onConflict: 'user_id' });
      if (error) return json({ error: 'Could not update the account.' }, 502);
      // A ban blocks new sign-ins and token refresh.
      const { error: banError } = await admin.auth.admin.updateUserById(input.userId, { ban_duration: input.disabled ? '876000h' : 'none' });
      if (banError) return json({ error: 'Saved, but the sign-in ban could not be updated.' }, 502);
      if (input.disabled) {
        // End existing sessions too, so the user's current access tokens stop working
        // (GoTrue rejects tokens whose session is gone). auth.admin.signOut() needs the
        // user's own JWT, so this uses a service-role RPC that deletes auth.sessions.
        // Functions also refuse disabled profiles, which covers any token still in flight.
        const { error: revokeError } = await admin.rpc('admin_revoke_sessions', { p_user: input.userId });
        if (revokeError) {
          console.error(`admin_revoke_sessions ${input.userId}: ${revokeError.message}`);
          return json({ error: 'Disabled and banned, but active sessions could not be ended. They expire within an hour.' }, 502);
        }
      }
      return json({ ok: true });
    }

    case 'reset_quota': {
      if (!isUuid(input.userId)) return json({ error: 'userId is required.' }, 400);
      if (!await audit('reset_quota', input.userId)) return auditFailed();
      const { error } = await admin.rpc('admin_reset_ai_quota', { p_user: input.userId, p_day: utcDay() });
      if (error) return json({ error: 'Could not reset the quota.' }, 502);
      return json({ ok: true });
    }

    case 'set_role': {
      if (!isUuid(input.userId) || !['admin', 'user'].includes(String(input.role))) return json({ error: 'userId and role are required.' }, 400);
      const { data, error } = await admin.rpc('admin_set_role', {
        p_actor: user.id, p_target: input.userId, p_role: input.role,
        p_owner: isUuid(ownerId()) ? ownerId() : null,
      });
      if (error) return json({ error: 'Could not change the role.' }, 503);
      if (data === 'missing') return json({ error: 'Account profile is missing.' }, 404);
      if (data === 'protected' || data === 'last_admin') return json({ error: 'That admin role is protected.' }, 403);
      if (data !== 'ok') return json({ error: 'Could not change the role.' }, 400);
      return json({ ok: true });
    }

    case 'list_bugs': {
      let query = admin.from('bug_reports').select('id, user_id, body, route, app_version, platform, status, created_at').order('created_at', { ascending: false }).limit(200);
      if (input.status !== undefined && input.status !== 'all') {
        if (!isBugStatus(input.status)) return json({ error: 'Unknown status.' }, 400);
        query = query.eq('status', input.status);
      }
      const { data, error } = await query;
      if (error) return json({ error: 'Could not load bug reports. Apply the latest SQL migration first.' }, 502);
      if (!await audit(`list_bugs:${input.status ?? 'all'}`, null)) return auditFailed();
      return json({ bugs: (data ?? []).map(pickBugReport).filter(Boolean) });
    }

    case 'set_bug_status': {
      if (!isUuid(input.id) || !isBugStatus(input.status)) return json({ error: 'id and a valid status are required.' }, 400);
      const { data: bug, error: findError } = await admin.from('bug_reports').select('user_id').eq('id', input.id).maybeSingle();
      if (findError) return json({ error: 'Could not update the bug report.' }, 502);
      if (!bug) return json({ error: 'Bug report not found.' }, 404);
      if (!await audit(`bug_status:${input.status}:${input.id}`, bug.user_id)) return auditFailed();
      const { data, error } = await admin.from('bug_reports').update({ status: input.status }).eq('id', input.id).select('id');
      if (error) return json({ error: 'Could not update the bug report.' }, 502);
      // Deleted by its owner between the lookup and the update.
      if (!data?.length) return json({ error: 'Bug report not found.' }, 404);
      return json({ ok: true });
    }

    case 'user_stats': {
      if (!isUuid(input.userId)) return json({ error: 'userId is required.' }, 400);
      const { data, error } = await admin.rpc('admin_user_stats', { p_user: input.userId });
      if (error) return json({ error: 'Could not load user stats. Apply the latest SQL migration first.' }, 502);
      const stats = pickUserStats(data);
      if (!stats) return json({ error: 'User not found.' }, 404);
      // Fail closed: never return per-user stats that were not audited.
      if (!await audit('view_user_stats', input.userId)) return auditFailed();
      return json({ stats });
    }

    case 'get_config': {
      const { data, error } = await admin.from('app_config').select('*').eq('id', 1).maybeSingle();
      if (error) return json({ error: 'AI configuration is not ready. Apply the latest SQL migration first.' }, 502);
      return json({
        config: resolveConfig(data),
        updatedAt: data?.updated_at ?? null,
        providers: describeRegistry((keyEnv) => Boolean(Deno.env.get(keyEnv))),
      });
    }

    case 'set_config': {
      const { data, error } = await admin.from('app_config').select('*').eq('id', 1).maybeSingle();
      if (error) return json({ error: 'AI configuration is not ready. Apply the latest SQL migration first.' }, 502);
      const patch = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config as Record<string, unknown> : {};
      const result = validateConfigUpdate(resolveConfig(data), patch);
      if (!result.ok) return json({ error: result.error }, 400);
      const { error: saveError } = await admin.from('app_config').upsert({ id: 1, ...result.config, updated_at: new Date().toISOString() });
      if (saveError) return json({ error: 'Could not save the AI configuration.' }, 502);
      return json({ config: result.config });
    }

    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
