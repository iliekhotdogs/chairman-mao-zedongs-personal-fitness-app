import { parseNumberText, rangeMessage, checkSet, jumpWarning, prefillReps, MAX_SET_WEIGHT_KG } from '../inputRules';
import { parseSetUtterance } from '../workouts/voiceParser';

describe('parseNumberText', () => {
  it('accepts plain numbers, empty and decimal comma', () => {
    expect(parseNumberText('12.5')).toEqual({ value: 12.5 });
    expect(parseNumberText('')).toEqual({ value: undefined });
    expect(parseNumberText('12,5')).toEqual({ value: 12.5 });
    expect(parseNumberText('.5')).toEqual({ value: 0.5 });
  });
  it('rejects instead of silently stripping', () => {
    expect(parseNumberText('-5').error).toBeTruthy();
    expect(parseNumberText('1.2.3').error).toBeTruthy();
    expect(parseNumberText('12abc').error).toBeTruthy();
    expect(parseNumberText('.').error).toBeTruthy();
  });
});

describe('rangeMessage', () => {
  it('uses per-field bounds', () => {
    expect(rangeMessage(0, { min: 0, exclusiveMin: true })).toBe('Enter a number above 0.');
    expect(rangeMessage(5, { min: 0, exclusiveMin: true })).toBeUndefined();
    expect(rangeMessage(99999, { min: 0, max: 1500 })).toBe('Enter a number between 0 and 1500.');
    expect(rangeMessage(-1, { min: 0 })).toBe('Enter a number of 0 or more.');
    expect(rangeMessage(9, { max: 5 })).toBe('Enter a number of 5 or less.');
  });
});

describe('checkSet / jumpWarning / prefillReps', () => {
  it('blocks out-of-range sets', () => {
    expect(checkSet({ weightKg: 50, reps: 8 })).toBeUndefined();
    expect(checkSet({ weightKg: MAX_SET_WEIGHT_KG + 1, reps: 8 })).toMatch(/weight/i);
    expect(checkSet({ weightKg: 50, reps: 0 })).toMatch(/reps/i);
    expect(checkSet({ weightKg: 50, reps: 301 })).toMatch(/reps/i);
  });
  it('warns on >50% jump only', () => {
    expect(jumpWarning(100, 60)).toMatch(/50%/);
    expect(jumpWarning(90, 60)).toBeUndefined();
    expect(jumpWarning(100, 0)).toBeUndefined();
    expect(jumpWarning(100, undefined)).toBeUndefined();
  });
  it('prefills reps from last set, else plan min', () => {
    expect(prefillReps({ lastReps: 9, repMin: 6 })).toBe(9);
    expect(prefillReps({ repMin: 6, repMax: 10 })).toBe(6);
    expect(prefillReps({})).toBe(8);
  });
});

describe('voice parser hardening', () => {
  const ctx = { units: 'imperial' as const, currentExerciseId: 'bench_press' };
  it('rejects unparseable input', () => {
    expect(parseSetUtterance('asdf', ctx).understood).toBe(false);
  });
  it('treats 0 reps as invalid', () => {
    const p = parseSetUtterance('bench 135 pounds 0 reps', ctx);
    expect(p.reps).toBeUndefined();
    expect(p.understood).toBe(true);
    expect(p.issues.join(' ')).toMatch(/reps/i);
  });
  it('parses 135x8', () => {
    const p = parseSetUtterance('bench 135x8', ctx);
    expect([p.weight, p.reps, p.sets]).toEqual([135, 8, 1]);
  });
  it('parses 3x10@50', () => {
    const p = parseSetUtterance('squat 3x10@50 kg', ctx);
    expect([p.sets, p.reps, p.weight, p.unit]).toEqual([3, 10, 50, 'kg']);
  });
  it('parses @ rpe 9', () => {
    const p = parseSetUtterance('bench 135 x 8 @ rpe 9', ctx);
    expect([p.weight, p.reps, p.rpe]).toEqual([135, 8, 9]);
  });
});
