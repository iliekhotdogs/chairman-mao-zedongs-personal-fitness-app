export type Profile = { role: 'admin' | 'user'; disabled: boolean };

/** Missing profiles and failed reads are distinct states; neither grants access. */
export function parseProfileResult(result: { data: { role?: unknown; disabled?: unknown } | null; error: { message: string } | null }): Profile | null {
  if (result.error) throw new Error('Profile lookup failed.');
  if (!result.data) return null;
  return { role: result.data.role === 'admin' ? 'admin' : 'user', disabled: result.data.disabled === true };
}

/** Shared request gate: a failed or missing profile read never becomes an enabled account. */
export async function profileGate(lookup: () => Promise<Profile | null>): Promise<{ ok: true; profile: Profile } | { ok: false; status: 503; missing: boolean }> {
  try {
    const profile = await lookup();
    return profile ? { ok: true, profile } : { ok: false, status: 503, missing: true };
  } catch {
    return { ok: false, status: 503, missing: false };
  }
}
