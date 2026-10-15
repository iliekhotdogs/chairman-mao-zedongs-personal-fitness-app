// Invite-code and signup validation. Pure TypeScript (no Deno/npm imports) so
// Jest can test it (src/lib/__tests__/invite.test.ts).

/** No 0/O, 1/I/L: codes are read aloud and typed by hand. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Builds an XXXX-XXXX code from 8 random bytes. Rejection sampling keeps every
 * character equally likely; `random` must return fresh cryptographic bytes. */
export function generateInviteCode(random: (length: number) => Uint8Array): string {
  const max = 256 - (256 % INVITE_ALPHABET.length);
  const chars: string[] = [];
  while (chars.length < 8) {
    for (const byte of random(16)) {
      if (byte < max) chars.push(INVITE_ALPHABET[byte % INVITE_ALPHABET.length]);
      if (chars.length === 8) break;
    }
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Accepts lower case, spaces and a missing dash. Returns null if it cannot be a code. */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 8) return null;
  if ([...compact].some((char) => !INVITE_ALPHABET.includes(char))) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export const MIN_PASSWORD_LENGTH = 8;

export type SignupInput = { email: string; password: string; code: string };
export type SignupCheck = { ok: true; value: SignupInput } | { ok: false; error: string };

export function validateSignup(body: unknown): SignupCheck {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password.length > 72) return { ok: false, error: 'Use a password of at most 72 characters.' };
  const code = normalizeInviteCode(input.code);
  if (!code) return { ok: false, error: 'Enter a valid invite code (like ABCD-2345).' };
  return { ok: true, value: { email, password, code } };
}

/** Optional expiry in whole days (1-365). Returns null for "never expires". */
export function inviteExpiry(days: unknown, now: Date): string | null | undefined {
  if (days === undefined || days === null || days === '' || days === 0) return null;
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 365) return undefined;
  return new Date(now.getTime() + (days as number) * 86_400_000).toISOString();
}
