export type Profile = { role: 'admin' | 'user'; disabled: boolean };

/** Missing profiles and failed reads are distinct states; neither grants access. */
export function parseProfileResult(result: { data: { role?: unknown; disabled?: unknown } | null; error: { message: string } | null }): Profile | null {
  if (result.error) throw new Error('Profile lookup failed.');
  if (!result.data) return null;
  return { role: result.data.role === 'admin' ? 'admin' : 'user', disabled: result.data.disabled === true };
}
