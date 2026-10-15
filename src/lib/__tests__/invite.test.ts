import { generateInviteCode, INVITE_ALPHABET, inviteExpiry, normalizeInviteCode, validateSignup } from '../../../supabase/functions/_shared/invite';

const bytes = (values: number[]) => () => Uint8Array.from(values);

describe('invite codes', () => {
  it('generates readable XXXX-XXXX codes', () => {
    const random = (length: number) => Uint8Array.from({ length }, () => Math.floor(Math.random() * 256));
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode(random);
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01OIL]/);
      expect(normalizeInviteCode(code)).toBe(code);
    }
  });

  it('skips bytes that would bias the alphabet', () => {
    // 248..255 are rejected for a 31-letter alphabet (256 - 256 % 31 = 248).
    const code = generateInviteCode(bytes([255, 250, 248, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(code).toBe(`${INVITE_ALPHABET.slice(0, 4)}-${INVITE_ALPHABET.slice(4, 8)}`);
  });

  it('normalizes user input', () => {
    expect(normalizeInviteCode(' abcd 2345 ')).toBe('ABCD-2345');
    expect(normalizeInviteCode('abcd-2345')).toBe('ABCD-2345');
    expect(normalizeInviteCode('ABCD-234')).toBeNull();
    expect(normalizeInviteCode('ABCD-2340')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeInviteCode(42)).toBeNull();
  });

  it('validates signup input', () => {
    expect(validateSignup({ email: ' Me@Example.com ', password: 'longenough', code: 'abcd-2345' }))
      .toEqual({ ok: true, value: { email: 'me@example.com', password: 'longenough', code: 'ABCD-2345' } });
    expect(validateSignup({ email: 'nope', password: 'longenough', code: 'ABCD-2345' }).ok).toBe(false);
    expect(validateSignup({ email: 'a@b.co', password: 'short', code: 'ABCD-2345' }).ok).toBe(false);
    expect(validateSignup({ email: 'a@b.co', password: 'longenough', code: '' }).ok).toBe(false);
    expect(validateSignup(null).ok).toBe(false);
  });

  it('computes optional expiry', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    expect(inviteExpiry(undefined, now)).toBeNull();
    expect(inviteExpiry(0, now)).toBeNull();
    expect(inviteExpiry(7, now)).toBe('2026-10-20T00:00:00.000Z');
    expect(inviteExpiry(400, now)).toBeUndefined();
    expect(inviteExpiry(1.5, now)).toBeUndefined();
  });
});
