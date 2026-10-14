import { adjustRest, defaultRestSec, formatRest, isRestDone, remainingSec, restProgress, sanitizeRestPrefs, startRest, totalSec, REST_MAX_SEC } from '../workouts/restTimer';
import { EXERCISE_BY_ID } from '../workouts/exercises';

const T0 = 1_000_000;

describe('rest timer defaults', () => {
  it('uses 90 s for compound lifts and 60 s for accessories', () => {
    expect(defaultRestSec({ compound: true })).toBe(90);
    expect(defaultRestSec({ compound: false })).toBe(60);
  });

  it('lets the plan prescription win over the defaults', () => {
    expect(defaultRestSec({ compound: false }, { restSec: 120 })).toBe(120);
  });

  it('uses the user preference when there is no plan prescription', () => {
    expect(defaultRestSec({ compound: true }, undefined, { compoundSec: 150, accessorySec: 45 })).toBe(150);
    expect(defaultRestSec({ compound: false }, undefined, { compoundSec: 150, accessorySec: 45 })).toBe(45);
  });

  it('treats unknown exercises as compound and works with the real exercise list', () => {
    expect(defaultRestSec(undefined)).toBe(90);
    const accessory = Object.values(EXERCISE_BY_ID).find((e) => !e.compound);
    if (accessory) expect(defaultRestSec(accessory)).toBe(60);
  });

  it('sanitizes stored preferences', () => {
    expect(sanitizeRestPrefs(undefined)).toEqual({ compoundSec: 90, accessorySec: 60 });
    expect(sanitizeRestPrefs({ compoundSec: 5, accessorySec: 9999 })).toEqual({ compoundSec: 15, accessorySec: REST_MAX_SEC });
  });
});

describe('rest countdown', () => {
  it('counts down in whole seconds, rounding up', () => {
    const t = startRest(90, T0, 'bench');
    expect(totalSec(t)).toBe(90);
    expect(remainingSec(t, T0)).toBe(90);
    expect(remainingSec(t, T0 + 400)).toBe(90);
    expect(remainingSec(t, T0 + 1000)).toBe(89);
    expect(remainingSec(t, T0 + 89_001)).toBe(1);
    expect(isRestDone(t, T0 + 89_999)).toBe(false);
    expect(remainingSec(t, T0 + 95_000)).toBe(0);
    expect(isRestDone(t, T0 + 90_000)).toBe(true);
  });

  it('reports progress from 0 to 1', () => {
    const t = startRest(60, T0);
    expect(restProgress(t, T0)).toBe(0);
    expect(restProgress(t, T0 + 30_000)).toBeCloseTo(0.5);
    expect(restProgress(t, T0 + 120_000)).toBe(1);
  });

  it('adds and removes 15 s without going below zero', () => {
    const t = startRest(60, T0);
    expect(remainingSec(adjustRest(t, 15, T0), T0)).toBe(75);
    expect(remainingSec(adjustRest(t, -15, T0), T0)).toBe(45);
    const almost = adjustRest(t, -15, T0 + 50_000);
    expect(remainingSec(almost, T0 + 50_000)).toBe(0);
    expect(isRestDone(almost, T0 + 50_000)).toBe(true);
  });

  it('restarts from now when time is added after the rest finished', () => {
    const t = startRest(60, T0);
    const later = T0 + 120_000;
    const again = adjustRest(t, 15, later);
    expect(remainingSec(again, later)).toBe(15);
    expect(restProgress(again, later)).toBe(0);
  });

  it('caps the total rest', () => {
    const t = startRest(REST_MAX_SEC, T0);
    expect(totalSec(adjustRest(t, 15, T0))).toBe(REST_MAX_SEC);
  });

  it('formats as m:ss', () => {
    expect(formatRest(90)).toBe('1:30');
    expect(formatRest(5)).toBe('0:05');
    expect(formatRest(0)).toBe('0:00');
    expect(formatRest(600)).toBe('10:00');
  });
});

describe('rest preferences from storage', () => {
  it('ignores garbage values', () => {
    expect(sanitizeRestPrefs({ compoundSec: 'x' as unknown as number, accessorySec: NaN })).toEqual({ compoundSec: 90, accessorySec: 60 });
    expect(defaultRestSec({ compound: true }, { restSec: NaN }, { compoundSec: 120 })).toBe(120);
  });
});
