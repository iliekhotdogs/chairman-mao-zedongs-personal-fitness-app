import { parseSetUtterance, wordsToDigits } from '../workouts/voiceParser';
import { recommendNext, e1rm } from '../workouts/progression';
import { lbToKg } from '../units';
import type { WorkoutSession } from '../types';

describe('voice parsing', () => {
  const ctx = { units: 'imperial' as const };

  it('converts number words', () => {
    expect(wordsToDigits('one thirty five pounds eight reps')).toBe('135 pounds 8 reps');
    expect(wordsToDigits('two twenty-five for five')).toBe('225 for 5');
    expect(wordsToDigits('a hundred and thirty five')).toContain('135');
    expect(wordsToDigits('forty five')).toBe('45');
  });

  it('parses the example from the brief', () => {
    const p = parseSetUtterance('bench press, 135 pounds, eight reps', ctx);
    expect(p.exerciseId).toBe('bench_press');
    expect(p.weight).toBe(135);
    expect(p.unit).toBe('lb');
    expect(p.weightKg).toBeCloseTo(lbToKg(135), 5);
    expect(p.reps).toBe(8);
    expect(p.issues).toHaveLength(0);
  });

  it('parses "squat 225 for 5" and assumes the user unit', () => {
    const p = parseSetUtterance('squat 225 for 5', ctx);
    expect(p.exerciseId).toBe('back_squat');
    expect(p.weight).toBe(225);
    expect(p.reps).toBe(5);
    expect(p.issues.join(' ')).toMatch(/assumed lb/);
  });

  it('parses sets and kilos', () => {
    const p = parseSetUtterance('3 sets of 10 at 60 kilos romanian deadlift', ctx);
    expect(p.exerciseId).toBe('romanian_deadlift');
    expect(p.sets).toBe(3);
    expect(p.reps).toBe(10);
    expect(p.unit).toBe('kg');
    expect(p.weightKg).toBe(60);
  });

  it('parses 135x8 shorthand', () => {
    const p = parseSetUtterance('db row 70 x 10', ctx);
    expect(p.exerciseId).toBe('db_row');
    expect(p.weight).toBe(70);
    expect(p.reps).toBe(10);
  });

  it('falls back to the current exercise and flags it', () => {
    const p = parseSetUtterance('185 pounds 6 reps', { ...ctx, currentExerciseId: 'deadlift' });
    expect(p.exerciseId).toBe('deadlift');
    expect(p.exerciseFromContext).toBe(true);
  });

  it('understands "same again"', () => {
    expect(parseSetUtterance('same again', ctx).repeatLast).toBe(true);
  });

  it('reports missing parts instead of guessing', () => {
    const p = parseSetUtterance('bench press', ctx);
    expect(p.issues).toEqual(expect.arrayContaining(['Weight not heard.', 'Reps not heard.']));
  });
});

describe('progression', () => {
  const planned = { exerciseId: 'bench_press', sets: 3, repMin: 6, repMax: 10, restSec: 120 };
  const sess = (date: string, weight: number, reps: number[]): WorkoutSession => ({
    id: date, date, name: 'Upper', startedAt: `${date}T10:00:00Z`, finishedAt: `${date}T11:00:00Z`, updatedAt: '',
    sets: reps.map((r, i) => ({ id: `${date}${i}`, exerciseId: 'bench_press', weightKg: weight, reps: r, via: 'manual' as const, loggedAt: '' })),
  });

  it('first time gives guidance, no invented weight', () => {
    const r = recommendNext(planned, [], 'imperial');
    expect(r.kind).toBe('first_time');
    expect(r.weightKg).toBeUndefined();
  });

  it('increases after all sets hit the top of the range', () => {
    const r = recommendNext(planned, [sess('2026-09-28', lbToKg(135), [10, 10, 10])], 'imperial');
    expect(r.kind).toBe('increase');
    expect(r.weightKg!).toBeCloseTo(lbToKg(140), 3);
  });

  it('holds when reps are within range', () => {
    expect(recommendNext(planned, [sess('2026-09-28', 60, [9, 8, 7])], 'metric').kind).toBe('hold');
  });

  it('deloads after two sessions below range at the same weight', () => {
    const r = recommendNext(planned, [sess('2026-09-25', 100, [5, 4, 4]), sess('2026-09-28', 100, [5, 4, 3])], 'metric');
    expect(r.kind).toBe('deload');
    expect(r.weightKg).toBe(90);
  });

  it('ignores unfinished sessions', () => {
    const s = { ...sess('2026-09-28', 60, [10, 10, 10]), finishedAt: undefined };
    expect(recommendNext(planned, [s], 'metric').kind).toBe('first_time');
  });

  it('e1rm', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 10)).toBeCloseTo(133.3, 1);
  });
});
