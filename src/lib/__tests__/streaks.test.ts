import { activeDates, computeStreak, formatCountdown, milestones, nextWorkout, streakForState, weekStart, weekTraining } from '../streaks';
import { emptyState, type AppState } from '../state';
import { addDays } from '../dates';
import type { FoodEntry, LoggedSet, WorkoutPlan, WorkoutSession } from '../types';

const NOW = '2026-10-02T12:00:00.000Z';
const TODAY = '2026-10-02'; // a Friday

function food(date: string, deleted = false): FoodEntry {
  return { id: `f-${date}`, date, meal: 'lunch', items: [], origin: 'manual', confirmedAt: NOW, createdAt: `${date}T12:00:00.000Z`, updatedAt: NOW, deleted };
}

function set(exerciseId: string, weightKg: number, reps: number): LoggedSet {
  return { id: `${exerciseId}-${weightKg}-${reps}`, exerciseId, weightKg, reps, via: 'manual', loggedAt: NOW };
}

function session(date: string, sets: LoggedSet[] = [], finished = true): WorkoutSession {
  return { id: `s-${date}`, date, name: 'Upper A', startedAt: `${date}T08:00:00.000Z`, finishedAt: finished ? `${date}T09:00:00.000Z` : undefined, sets, updatedAt: NOW };
}

function state(over: Partial<AppState> = {}): AppState {
  return { ...emptyState('d', NOW), ...over };
}

describe('computeStreak', () => {
  it('is zero with no activity', () => {
    expect(computeStreak([], TODAY)).toEqual({ current: 0, best: 0, activeToday: false });
  });

  it('counts consecutive days ending today', () => {
    const s = computeStreak([TODAY, addDays(TODAY, -1), addDays(TODAY, -2)], TODAY);
    expect(s).toEqual({ current: 3, best: 3, activeToday: true });
  });

  it('keeps the streak alive when today has nothing yet', () => {
    const s = computeStreak([addDays(TODAY, -1), addDays(TODAY, -2)], TODAY);
    expect(s.current).toBe(2);
    expect(s.activeToday).toBe(false);
  });

  it('breaks after a missed day and remembers the best run', () => {
    const dates = [addDays(TODAY, -10), addDays(TODAY, -9), addDays(TODAY, -8), addDays(TODAY, -7), addDays(TODAY, -2), TODAY];
    const s = computeStreak(dates, TODAY);
    expect(s.current).toBe(1);
    expect(s.best).toBe(4);
  });

  it('ignores future dates and crosses month boundaries', () => {
    const s = computeStreak(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05'], TODAY);
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });
});

describe('activeDates / streakForState', () => {
  it('uses live food logs and finished workouts only', () => {
    const st = state({
      foodLog: [food(TODAY), food(addDays(TODAY, -3), true)],
      sessions: [session(addDays(TODAY, -1)), session(addDays(TODAY, -2), [], false)],
    });
    expect([...activeDates(st)].sort()).toEqual([addDays(TODAY, -1), TODAY]);
    expect(streakForState(st, TODAY).current).toBe(2);
  });
});

describe('week helpers', () => {
  it('finds Monday', () => {
    expect(weekStart('2026-10-02')).toBe('2026-09-28');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday belongs to the week that started Monday
  });

  it('sums this week only', () => {
    const sessions = [session('2026-09-27', [set('bench_press', 100, 5)]), session('2026-09-29', [set('bench_press', 60, 10), set('back_squat', 100, 5)]), session('2026-10-01', [], false)];
    expect(weekTraining(sessions, TODAY)).toEqual({ workouts: 1, volumeKg: 1100 });
  });
});

describe('nextWorkout', () => {
  const plan: WorkoutPlan = {
    id: 'p', name: 'Plan', source: 'ai_generated', rationale: [], createdAt: NOW, updatedAt: NOW,
    days: [
      { id: 'mon', name: 'Upper A', focus: 'Upper', weekday: 1, exercises: [] },
      { id: 'fri', name: 'Lower A', focus: 'Lower', weekday: 5, exercises: [] },
    ],
  };

  it('returns today when a planned session is not done', () => {
    const n = nextWorkout(state({ plan }), TODAY);
    expect(n?.isToday).toBe(true);
    expect(n?.day.id).toBe('fri');
  });

  it('skips today once finished and finds the next plan day', () => {
    const n = nextWorkout(state({ plan, sessions: [session(TODAY)] }), TODAY);
    expect(n?.date).toBe('2026-10-05');
    expect(n?.day.id).toBe('mon');
    expect(n?.startsAt.getDate()).toBe(5);
  });

  it('is undefined without a plan', () => {
    expect(nextWorkout(state(), TODAY)).toBeUndefined();
  });
});

describe('formatCountdown', () => {
  it('formats days, hours, minutes and seconds', () => {
    expect(formatCountdown(((2 * 24 + 4) * 3600 + 5 * 60 + 9) * 1000)).toBe('2d 04:05:09');
    expect(formatCountdown(59_000)).toBe('00:00:59');
    expect(formatCountdown(-5)).toBe('00:00:00');
  });
});

describe('milestones', () => {
  it('derives firsts, streaks, weight steps and PRs newest first', () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i - 6));
    const st = state({
      foodLog: days.map((d) => food(d)),
      sessions: [
        session(days[0], [set('bench_press', 80, 5)]),
        session(days[3], [set('bench_press', 85, 5)]),
        session(days[5], [set('bench_press', 82.5, 5)]),
      ],
      weights: [
        { id: 'w1', date: days[0], weightKg: 90, updatedAt: NOW },
        { id: 'w2', date: days[3], weightKg: 87.4, updatedAt: NOW },
        { id: 'w3', date: days[6], weightKg: 84.9, updatedAt: NOW },
      ],
    });
    const ms = milestones(st, { today: TODAY });
    const ids = ms.map((m) => m.id);
    expect(ids).toContain('first-meal');
    expect(ids).toContain('first-workout');
    expect(ids).toContain('streak-3');
    expect(ids).toContain('streak-7');
    expect(ids).toContain('weight-down-1');
    expect(ids).toContain('weight-down-2');
    expect(ms.filter((m) => m.kind === 'pr')).toHaveLength(1);
    expect(ms.find((m) => m.kind === 'pr')?.date).toBe(days[3]);
    // newest first
    expect(ms[0].date).toBe(TODAY);
    expect([...ms].map((m) => m.date)).toEqual([...ms].map((m) => m.date).sort().reverse());
  });

  it('is empty for a fresh state', () => {
    expect(milestones(state(), { today: TODAY })).toEqual([]);
  });
});
