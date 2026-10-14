import { addDays, daysBetween, hhmmToMinutes, lastNDates, parseISODate, toISODate, weekday } from '../dates';
import { cmToFtIn, displayWeight, ftInToCm, kgToLb, lbToKg, round, roundLoadKg, toKg, weightValue } from '../units';
import { decide, inQuietHours, MAX_COACH_NOTIFICATIONS_PER_DAY, remainingToday, type Candidate } from '../notifications/policy';
import { activeSession, foodForDay, latestWeight, loggedDays, pendingProposals, remainingForDay, totalsForDay, workoutForDay } from '../selectors';
import { defaultSettings, emptyState, type AppState } from '../state';
import type { FoodEntry, NotificationPrefs, NotificationRecord, NutritionTargets, Proposal, WorkoutDay } from '../types';

const NOW = '2026-10-02T12:00:00.000Z';

// Tests run in America/New_York (see jest.global-setup.js), which has DST.
describe('dates across DST', () => {
  it('runs in a DST time zone', () => {
    // EST in January, EDT in July
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(300);
    expect(new Date('2026-07-15T12:00:00Z').getTimezoneOffset()).toBe(240);
  });

  it('every day of the year steps by exactly one calendar day', () => {
    let d = '2025-12-31';
    for (let i = 0; i < 366; i++) {
      const next = addDays(d, 1);
      expect(daysBetween(d, next)).toBe(1);
      expect(toISODate(parseISODate(next))).toBe(next);
      d = next;
    }
    expect(d).toBe('2027-01-01');
  });

  it('counts days across US DST changes', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // spring forward (23h day)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2); // fall back (25h day)
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
    expect(lastNDates(3, '2026-03-09')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('uses the local calendar date, not UTC', () => {
    expect(toISODate(new Date('2026-03-08T04:30:00Z'))).toBe('2026-03-07'); // 23:30 EST
    expect(toISODate(new Date('2026-03-08T07:30:00Z'))).toBe('2026-03-08'); // 03:30 EDT, just after the jump
    expect(toISODate(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01'); // 01:30 EDT, before fall-back
    expect(toISODate(new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01'); // 23:59 EST
  });

  it('handles month and year boundaries and weekdays', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekday('2026-10-04')).toBe(0); // Sunday
  });

  it('parses HH:MM', () => {
    expect(hhmmToMinutes('07:30')).toBe(450);
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('bad')).toBe(0);
  });
});

describe('units', () => {
  it('converts kg and lb both ways', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462);
    expect(lbToKg(kgToLb(72.5))).toBeCloseTo(72.5);
    expect(toKg(176, 'imperial')).toBeCloseTo(79.83, 2);
    expect(toKg(80, 'metric')).toBe(80);
  });

  it('formats weights in the user unit', () => {
    expect(displayWeight(80, 'metric')).toBe('80 kg');
    expect(displayWeight(80, 'imperial')).toBe('176.4 lb');
    expect(weightValue(80, 'imperial', 0)).toBe(176);
  });

  it('rounds loads to plate-friendly increments', () => {
    expect(roundLoadKg(61, 'metric')).toBe(60);
    expect(roundLoadKg(61.3, 'metric')).toBe(62.5);
    expect(kgToLb(roundLoadKg(61, 'imperial'))).toBeCloseTo(135);
  });

  it('converts height and carries 12 inches into a foot', () => {
    expect(cmToFtIn(182.88)).toEqual({ ft: 6, inch: 0 });
    expect(cmToFtIn(182.6)).toEqual({ ft: 6, inch: 0 });
    expect(cmToFtIn(175)).toEqual({ ft: 5, inch: 9 });
    expect(ftInToCm(5, 9)).toBeCloseTo(175.26);
    expect(round(1.005, 2)).toBeCloseTo(1, 1);
  });
});

describe('notification policy', () => {
  const prefs = (over: Partial<NotificationPrefs> = {}): NotificationPrefs => ({ ...defaultSettings().notifications, enabled: true, ...over });
  const at = (hhmm: string) => hhmmToMinutes(hhmm);
  const cand = (over: Partial<Candidate> = {}): Candidate => ({ category: 'checkins', title: 't', body: 'b', dedupeKey: 'k', priority: 2, ...over });
  const sent = (i: number, over: Partial<NotificationRecord> = {}): NotificationRecord => ({
    id: `n${i}`, date: '2026-10-02', sentAt: NOW, category: 'checkins', title: 't', body: 'b', dedupeKey: `k${i}`, deviceId: 'd', delivered: 'in_app', updatedAt: NOW, ...over,
  });

  it('quiet hours that cross midnight (21:30 to 07:30)', () => {
    const p = prefs({ quietStart: '21:30', quietEnd: '07:30' });
    expect(inQuietHours(p, at('21:29'))).toBe(false);
    expect(inQuietHours(p, at('21:30'))).toBe(true);
    expect(inQuietHours(p, at('23:59'))).toBe(true);
    expect(inQuietHours(p, at('00:00'))).toBe(true);
    expect(inQuietHours(p, at('07:29'))).toBe(true);
    expect(inQuietHours(p, at('07:30'))).toBe(false);
    expect(inQuietHours(p, at('12:00'))).toBe(false);
  });

  it('daytime quiet hours and an empty window', () => {
    const p = prefs({ quietStart: '13:00', quietEnd: '14:00' });
    expect(inQuietHours(p, at('13:30'))).toBe(true);
    expect(inQuietHours(p, at('14:00'))).toBe(false);
    expect(inQuietHours(p, at('23:00'))).toBe(false);
    expect(inQuietHours(prefs({ quietStart: '09:00', quietEnd: '09:00' }), at('09:00'))).toBe(false);
  });

  it('applies switches, priority, cap and de-duplication', () => {
    const noon = at('12:00');
    expect(decide(cand(), prefs({ enabled: false }), [], '2026-10-02', noon).send).toBe(false);
    expect(decide(cand(), prefs({ categories: { nutrition: true, workouts: true, checkins: false } }), [], '2026-10-02', noon).send).toBe(false);
    expect(decide(cand({ priority: 1 }), prefs(), [], '2026-10-02', noon).send).toBe(false);
    expect(decide(cand(), prefs(), [], '2026-10-02', at('23:00')).send).toBe(false);
    expect(decide(cand(), prefs(), [], '2026-10-02', noon).send).toBe(true);
    expect(decide(cand({ dedupeKey: 'k0' }), prefs(), [sent(0)], '2026-10-02', noon).send).toBe(false);
    const full = Array.from({ length: MAX_COACH_NOTIFICATIONS_PER_DAY }, (_, i) => sent(i));
    expect(decide(cand(), prefs(), full, '2026-10-02', noon).send).toBe(false);
    // yesterday's and deleted records don't count toward today's cap
    const other = [...full.map((r) => ({ ...r, date: '2026-10-01' })), sent(9, { deleted: true })];
    expect(decide(cand(), prefs(), other, '2026-10-02', noon).send).toBe(true);
    expect(remainingToday(full, '2026-10-02')).toBe(0);
    expect(remainingToday([], '2026-10-02')).toBe(MAX_COACH_NOTIFICATIONS_PER_DAY);
  });
});

describe('selectors', () => {
  const TODAY = '2026-10-02';
  const food = (id: string, cal: number, over: Partial<FoodEntry> = {}): FoodEntry => ({
    id, date: TODAY, meal: 'lunch', origin: 'manual', confirmedAt: NOW, createdAt: NOW, updatedAt: NOW,
    items: [{ name: id, portionLabel: '1', calories: cal, proteinG: 10, carbsG: 20, fatG: 5, source: { kind: 'user_entered', sourced: false, label: '' } }],
    ...over,
  });
  const targets: NutritionTargets = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60, bmr: 1700, maintenance: 2300, baselineSteps: 6000, baselineTrainingKcal: 100, method: 'test', updatedAt: NOW };
  const day = (id: string, wd: number): WorkoutDay => ({ id, name: id, focus: '', weekday: wd, exercises: [] });
  const base = (): AppState => ({
    ...emptyState('d', NOW),
    targets,
    foodLog: [
      food('b', 300, { createdAt: '2026-10-02T13:00:00.000Z' }),
      food('a', 500, { createdAt: '2026-10-02T08:00:00.000Z' }),
      food('gone', 999, { deleted: true }),
      food('other-day', 400, { date: '2026-10-01' }),
    ],
  });

  it('lists a day\'s live food in time order and totals it', () => {
    const s = base();
    expect(foodForDay(s, TODAY).map((e) => e.id)).toEqual(['a', 'b']);
    expect(totalsForDay(s, TODAY).calories).toBe(800);
  });

  it('remaining calories include an approved one-day adjustment', () => {
    const s = { ...base(), dayAdjustments: [{ id: 'adj', date: TODAY, calorieDelta: 200, carbsDeltaG: 50, reason: 'r', proposalId: 'p', updatedAt: NOW }] };
    const r = remainingForDay(s, TODAY)!;
    expect(r.target.calories).toBe(2200);
    expect(r.remaining.calories).toBe(1400);
    expect(remainingForDay({ ...s, targets: undefined }, TODAY)).toBeUndefined();
  });

  it('a live workout override wins over the plan day', () => {
    const s: AppState = {
      ...base(),
      plan: { id: 'plan', name: 'P', source: 'user_created', days: [day('fri', 5)], rationale: [], createdAt: NOW, updatedAt: NOW },
      workoutOverrides: [],
    };
    expect(workoutForDay(s, TODAY)).toEqual({ day: s.plan!.days[0], overridden: false }); // 2026-10-02 is a Friday
    const ov = { id: 'o', date: TODAY, day: day('short', 5), proposalId: 'p', updatedAt: NOW };
    expect(workoutForDay({ ...s, workoutOverrides: [ov] }, TODAY).day?.id).toBe('short');
    expect(workoutForDay({ ...s, workoutOverrides: [{ ...ov, deleted: true }] }, TODAY).overridden).toBe(false);
  });

  it('latest weight, pending proposals, logged days and the active session', () => {
    const p = (id: string, status: Proposal['status'], deleted = false) => ({ id, status, deleted }) as Proposal;
    const s: AppState = {
      ...base(),
      weights: [
        { id: 'w1', date: '2026-09-30', weightKg: 81, updatedAt: NOW },
        { id: 'w2', date: '2026-10-01', weightKg: 80, updatedAt: NOW },
        { id: 'w3', date: '2026-10-02', weightKg: 79, updatedAt: NOW, deleted: true },
      ],
      proposals: [p('x', 'pending'), p('y', 'accepted'), p('z', 'pending', true)],
      sessions: [{ id: 's', date: TODAY, name: 'S', startedAt: NOW, sets: [], updatedAt: NOW }],
      activeSessionId: 's',
    };
    expect(latestWeight(s)?.id).toBe('w2');
    expect(pendingProposals(s).map((x) => x.id)).toEqual(['x']);
    expect(loggedDays(s, 7, TODAY)).toBe(2);
    expect(activeSession(s)?.id).toBe('s');
    expect(activeSession({ ...s, sessions: [{ ...s.sessions[0], finishedAt: NOW }] })).toBeUndefined();
  });
});
