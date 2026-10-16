import { recentFoodSummary, recentSessionSummary } from '../ai/coachHistory';
import { emptyState } from '../state';
import type { FoodEntry, LoggedSet, WorkoutSession } from '../types';

const T = '2026-10-15';
const item = (calories: number) => ({ name: 'x', grams: 100, calories, proteinG: 10, carbsG: 20, fatG: 5 }) as FoodEntry['items'][number];
const food = (date: string, calories: number, extra: Partial<FoodEntry> = {}): FoodEntry => ({ id: `${date}${calories}`, date, meal: 'lunch', items: [item(calories)], origin: 'manual', confirmedAt: `${date}T12:00:00Z`, createdAt: `${date}T12:00:00Z`, updatedAt: `${date}T12:00:00Z`, ...extra });
const set = (exerciseId: string, weightKg: number, reps: number, extra: Partial<LoggedSet> = {}): LoggedSet => ({ id: `${exerciseId}${weightKg}${reps}`, exerciseId, weightKg, reps, via: 'manual', loggedAt: '2026-10-10T10:00:00Z', ...extra });
const sess = (date: string, sets: LoggedSet[], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({ id: date, date, name: 'Upper', startedAt: `${date}T10:00:00Z`, finishedAt: `${date}T11:00:00Z`, sets, updatedAt: `${date}T11:00:00Z`, ...extra });

describe('coach history context', () => {
  it('sums confirmed food per day within 14 days and describes estimate uncertainty in words', () => {
    const s = emptyState('d', `${T}T00:00:00Z`);
    s.foodLog = [
      food(T, 500),
      food(T, 300, { id: 'b', origin: 'photo', estimateQuality: { provider: 'p', overallConfidence: 'low', corrected: false, notes: [] } }),
      food('2026-10-14', 700, { deleted: true }),
      food('2026-10-14', 400, { confirmedAt: '' }),
      food('2026-09-01', 900),
    ];
    const out = recentFoodSummary(s, T);
    expect(out).toEqual([{ date: T, kcal: 800, protein_g: 20, carbs_g: 40, fat_g: 10, entries: 2, estimate: 'includes rough photo estimates' }]);
    expect(JSON.stringify(out)).not.toMatch(/%/);
  });

  it('lists recent finished sessions newest first with the top working set per exercise', () => {
    const s = emptyState('d', `${T}T00:00:00Z`);
    s.sessions = [
      sess('2026-10-10', [set('bench_press', 100, 3, { warmup: true }), set('bench_press', 80, 8), set('bench_press', 80, 6), set('squat', 100, 5, { rpe: 8 })], { effort: 7 }),
      sess('2026-10-12', [set('squat', 105, 5)], { pain: true }),
      sess('2026-10-13', [set('squat', 110, 5)], { finishedAt: undefined }),
      sess('2026-08-01', [set('squat', 90, 5)]),
    ];
    const out = recentSessionSummary(s, T);
    expect(out.map((x) => x.date)).toEqual(['2026-10-12', '2026-10-10']);
    expect(out[0]).toMatchObject({ pain: true });
    expect(out[1].top_sets).toEqual([expect.stringMatching(/80kg x8$/), expect.stringMatching(/100kg x5 @RPE8$/)]);
    expect(out[1].effort).toBe(7);
  });
});
