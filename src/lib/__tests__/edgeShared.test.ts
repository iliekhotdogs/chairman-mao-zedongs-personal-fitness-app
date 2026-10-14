import { clientIpFrom } from '../../../supabase/functions/_shared/ip';
import { isPlausibleLocalDate, notifyCategory, PUSH_COPY, pushCopy } from '../../../supabase/functions/_shared/notifyCopy';

const headers = (values: Record<string, string>) => (name: string) => values[name.toLowerCase()] ?? null;

describe('clientIpFrom', () => {
  it('prefers cf-connecting-ip, which Cloudflare sets', () => {
    expect(clientIpFrom(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 198.51.100.1' }))).toBe('203.0.113.7');
  });

  it('uses the rightmost X-Forwarded-For entry, never the client-controlled first one', () => {
    expect(clientIpFrom(headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIpFrom(headers({ 'x-forwarded-for': ' 198.51.100.1 ' }))).toBe('198.51.100.1');
  });

  it('falls back to x-real-ip, then unknown', () => {
    expect(clientIpFrom(headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIpFrom(headers({}))).toBe('unknown');
  });

  it('ignores values that are not IP addresses', () => {
    expect(clientIpFrom(headers({ 'cf-connecting-ip': 'evil<script>', 'x-forwarded-for': '1.2.3.4, not-an-ip' }))).toBe('unknown');
    expect(clientIpFrom(headers({ 'x-forwarded-for': '1.2.3.4,' }))).toBe('1.2.3.4');
  });
});

describe('notify push copy', () => {
  it('maps known categories and ignores client free text', () => {
    const copy = pushCopy({ category: 'nutrition', title: 'You weigh 92 kg', body: 'Eat 1200 kcal' });
    expect(copy).toEqual({ category: 'nutrition', ...PUSH_COPY.nutrition });
    expect(JSON.stringify(copy)).not.toMatch(/92|1200/);
  });

  it('accepts `kind` and defaults unknown or missing categories to check-ins', () => {
    expect(notifyCategory({ kind: 'workouts' })).toBe('workouts');
    expect(notifyCategory({ category: 'phishing' })).toBe('checkins');
    expect(notifyCategory({ title: 'Coach suggestion' })).toBe('checkins');
  });
});

describe('isPlausibleLocalDate', () => {
  const now = new Date('2026-10-14T23:30:00Z');

  it('accepts the server date and one day either side', () => {
    expect(isPlausibleLocalDate('2026-10-14', now)).toBe(true);
    expect(isPlausibleLocalDate('2026-10-13', now)).toBe(true);
    expect(isPlausibleLocalDate('2026-10-15', now)).toBe(true);
  });

  it('rejects other days, impossible dates and non-strings', () => {
    expect(isPlausibleLocalDate('2026-10-16', now)).toBe(false);
    expect(isPlausibleLocalDate('2026-10-12', now)).toBe(false);
    expect(isPlausibleLocalDate('2026-02-30', new Date('2026-03-01T00:00:00Z'))).toBe(false);
    expect(isPlausibleLocalDate('20261014', now)).toBe(false);
    expect(isPlausibleLocalDate(20261014, now)).toBe(false);
  });
});
