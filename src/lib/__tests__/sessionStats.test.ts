import { lastSessionSet, weeklyMuscleVolume } from '../workouts/sessionStats';
import type { LoggedSet, WorkoutSession } from '../types';

const set = (exerciseId: string, weightKg: number, reps: number, extra: Partial<LoggedSet> = {}): LoggedSet => ({ id: `${exerciseId}${weightKg}${reps}${Math.random()}`, exerciseId, weightKg, reps, via: 'manual', loggedAt: '2026-10-10T10:00:00Z', ...extra });
const sess = (date: string, sets: LoggedSet[], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({ id: date, date, name: 'x', startedAt: `${date}T10:00:00Z`, finishedAt: `${date}T11:00:00Z`, sets, updatedAt: `${date}T11:00:00Z`, ...extra });

describe('weeklyMuscleVolume', () => {
  it('counts working sets per muscle, skips warm-ups and deleted sessions, and splits weeks', () => {
    const rows = weeklyMuscleVolume(
      [
        sess('2026-10-14', [set('bench_press', 60, 8, { warmup: true }), set('bench_press', 80, 8), set('bench_press', 80, 7)]),
        sess('2026-10-05', [set('bench_press', 75, 8)]),
        sess('2026-10-13', [set('bench_press', 80, 8)], { deleted: true }),
        sess('2026-09-01', [set('bench_press', 70, 8)]),
      ],
      '2026-10-15',
    );
    expect(rows).toEqual([{ muscle: 'chest', sets: 2, prevSets: 1 }]);
  });
});

describe('lastSessionSet', () => {
  it('returns the same-position set of the latest finished session, clamped to its last set', () => {
    const h = [sess('2026-10-10', [set('bench_press', 50, 10), set('bench_press', 60, 8)]), sess('2026-10-01', [set('bench_press', 40, 10)])];
    expect(lastSessionSet('bench_press', h, 0)?.weightKg).toBe(50);
    expect(lastSessionSet('bench_press', h, 5)?.weightKg).toBe(60);
    expect(lastSessionSet('squat', h, 0)).toBeUndefined();
  });
});
