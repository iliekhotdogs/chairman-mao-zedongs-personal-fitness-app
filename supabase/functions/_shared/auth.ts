// Service-role client, user lookup and the admin check shared by every function.
// The version is pinned to package.json's @supabase/supabase-js so every deploy bundles
// the same, reviewed client; bump both together.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.117.2';

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Profile = { role: 'admin' | 'user'; disabled: boolean };

/** The signed-in, non-anonymous user behind the request's bearer token, or null. */
export async function requestUser(request: Request): Promise<User | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return null;
  return data.user;
}

export async function profileOf(userId: string): Promise<Profile> {
  const { data } = await admin.from('profiles').select('role, disabled').eq('user_id', userId).maybeSingle();
  return { role: data?.role === 'admin' ? 'admin' : 'user', disabled: data?.disabled === true };
}

/** The bootstrap owner's user id (ADMIN_USER_ID secret), or null when unset. */
export function ownerId(): string | null {
  return Deno.env.get('ADMIN_USER_ID')?.trim().toLowerCase() || null;
}

export const isOwner = (userId: string) => ownerId() === userId.toLowerCase();

/** Admin = role 'admin' in profiles, or the bootstrap owner in the ADMIN_USER_ID secret.
 * Roles never come from user_metadata, which users can edit themselves. */
export async function isAdmin(user: User, profile?: Profile): Promise<boolean> {
  if (isOwner(user.id)) return true;
  const resolved = profile ?? await profileOf(user.id);
  return resolved.role === 'admin' && !resolved.disabled;
}
