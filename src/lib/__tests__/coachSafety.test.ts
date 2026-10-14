import { hasInjuryRedFlag, isUrgentSymptom } from '../../../supabase/functions/_shared/coachSafety';
import { parseProfileResult, profileGate } from '../../../supabase/functions/_shared/profile';

describe('shared coach safety gates', () => {
  it.each(['number of reps', 'popcorn macros', 'fallback plan', 'snapshot'])('allows ordinary question %s through', (message) => {
    expect(isUrgentSymptom(message)).toBe(false);
    expect(hasInjuryRedFlag(message)).toBe(false);
  });
  it('recognizes complete symptom words', () => {
    expect(isUrgentSymptom('I feel dizzy')).toBe(true);
    expect(hasInjuryRedFlag('My knee is swollen')).toBe(true);
  });
});

describe('profile lookup', () => {
  it('throws on database errors instead of returning an enabled user', () => {
    expect(() => parseProfileResult({ data: null, error: { message: 'connection lost' } })).toThrow('Profile lookup failed.');
  });
  it('keeps a missing profile distinct', () => {
    expect(parseProfileResult({ data: null, error: null })).toBeNull();
  });
  it('maps a database failure to 503 at the request gate', async () => {
    await expect(profileGate(async () => parseProfileResult({ data: null, error: { message: 'database unavailable' } }))).resolves.toEqual({ ok: false, status: 503, missing: false });
  });
});
