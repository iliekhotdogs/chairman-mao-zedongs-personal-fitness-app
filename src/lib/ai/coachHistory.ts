import type { AppState } from '../state';
import type { FoodEntry, ISODate, LoggedSet } from '../types';
import { addDays, lastNDates } from '../dates';
import { live } from '../selectors';
import { sumItems } from '../nutrition/lookup';
import { exerciseName } from '../workouts/exercises';

/** Compact recent history for the coach: confirmed food totals per day and finished sessions with top sets.
 * Uncertainty is described in words only (never as a percentage). */
export function recentFoodSummary(state: AppState, today: ISODate, days = 14) {
  const dates = new Set(lastNDates(days, today));
  const byDate = new Map<ISODate, FoodEntry[]>();
  for (const e of live(state.foodLog)) {
    if (!e.confirmedAt || !dates.has(e.date)) continue;
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => {
      const t = sumItems(entries.flatMap((e) => e.items));
      const est = entries.filter((e) => e.estimateQuality && !e.estimateQuality.corrected).map((e) => e.estimateQuality!.overallConfidence);
      const estimate = est.includes('low') ? 'includes rough photo estimates' : est.includes('medium') ? 'includes approximate photo estimates' : undefined;
      return { date, kcal: Math.round(t.calories), protein_g: Math.round(t.proteinG), carbs_g: Math.round(t.carbsG), fat_g: Math.round(t.fatG), entries: entries.length, ...(estimate ? { estimate } : {}) };
    });
}

const better = (a: LoggedSet, b: LoggedSet) => a.weightKg > b.weightKg || (a.weightKg === b.weightKg && a.reps > b.reps);

export function recentSessionSummary(state: AppState, today: ISODate, max = 8, maxExercises = 6) {
  return live(state.sessions)
    .filter((s) => s.finishedAt && s.date > addDays(today, -28) && s.date <= today)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, max)
    .map((s) => {
      const top = new Map<string, LoggedSet>();
      for (const x of s.sets) {
        const prev = top.get(x.exerciseId);
        if (!x.warmup && (!prev || better(x, prev))) top.set(x.exerciseId, x);
      }
      return {
        date: s.date,
        name: s.name.slice(0, 40),
        top_sets: [...top.values()].slice(0, maxExercises).map((x) => `${exerciseName(x.exerciseId)} ${Math.round(x.weightKg * 10) / 10}kg x${x.reps}${x.rpe ? ` @RPE${x.rpe}` : ''}`),
        ...(s.effort ? { effort: s.effort } : {}),
        ...(s.pain ? { pain: true } : {}),
      };
    });
}
