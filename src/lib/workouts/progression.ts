import type { LoggedSet, PlannedExercise, UnitSystem, WorkoutSession } from '../types';
import { EXERCISE_BY_ID } from './exercises';
import { lbToKg, roundLoadKg } from '../units';

export interface Recommendation {
  exerciseId: string;
  kind: 'first_time' | 'increase' | 'hold' | 'deload' | 'add_reps';
  weightKg?: number;
  repMin: number;
  repMax: number;
  reason: string;
}

/** Epley estimated one-rep max, used for progression charts. */
export function e1rm(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function incrementKg(exerciseId: string, units: UnitSystem): number {
  const ex = EXERCISE_BY_ID[exerciseId];
  const lower = ex && ['squat', 'hinge', 'lunge'].includes(ex.pattern);
  if (!ex) return units === 'imperial' ? lbToKg(5) : 2.5;
  switch (ex.loadType) {
    case 'barbell':
      return units === 'imperial' ? lbToKg(lower ? 10 : 5) : lower ? 5 : 2.5;
    case 'dumbbell':
      return units === 'imperial' ? lbToKg(5) : 2;
    case 'machine':
    case 'cable':
      return units === 'imperial' ? lbToKg(10) : 5;
    default:
      return 0;
  }
}

/** Completed sessions containing this exercise, newest first. */
export function historyFor(exerciseId: string, sessions: WorkoutSession[]): { session: WorkoutSession; sets: LoggedSet[] }[] {
  return sessions
    .filter((s) => !s.deleted && s.finishedAt)
    .map((session) => ({ session, sets: session.sets.filter((x) => x.exerciseId === exerciseId) }))
    .filter((h) => h.sets.length > 0)
    .sort((a, b) => (a.session.date < b.session.date ? 1 : a.session.date > b.session.date ? -1 : b.session.startedAt.localeCompare(a.session.startedAt)));
}

function workingSets(sets: LoggedSet[]) {
  const top = Math.max(...sets.map((s) => s.weightKg));
  return { top, sets: sets.filter((s) => Math.abs(s.weightKg - top) < 0.01) };
}

/**
 * Double progression: stay at a weight until every planned set reaches the top of the
 * rep range, then add the smallest sensible increment. Two sessions in a row below the
 * bottom of the range triggers a ~10% deload.
 */
export function recommendNext(planned: PlannedExercise, sessions: WorkoutSession[], units: UnitSystem): Recommendation {
  const { exerciseId, repMin, repMax, sets: plannedSets } = planned;
  const ex = EXERCISE_BY_ID[exerciseId];
  const hist = historyFor(exerciseId, sessions);
  if (!hist.length) {
    return {
      exerciseId,
      kind: 'first_time',
      weightKg: planned.targetWeightKg,
      repMin,
      repMax,
      reason: planned.targetWeightKg ? 'Planned starting weight.' : `First time: pick a weight you could lift for ${repMax + 2}–${repMax + 3} reps, and stop at ${repMax}.`,
    };
  }
  const last = workingSets(hist[0].sets);
  const bodyweight = ex?.loadType === 'bodyweight' && last.top === 0;
  const allTop = last.sets.length >= plannedSets && last.sets.every((s) => s.reps >= repMax);
  const missed = last.sets.some((s) => s.reps < repMin);

  if (bodyweight) {
    if (allTop) return { exerciseId, kind: 'add_reps', weightKg: 0, repMin: repMin + 2, repMax: repMax + 2, reason: `You hit ${repMax} reps on every set. Raise the rep target (or add load, such as a backpack or weight vest).` };
    return { exerciseId, kind: 'add_reps', weightKg: 0, repMin, repMax, reason: 'Aim for one more rep per set than last time.' };
  }

  if (allTop) {
    const next = roundLoadKg(last.top + incrementKg(exerciseId, units), units);
    return { exerciseId, kind: 'increase', weightKg: next, repMin, repMax, reason: `All ${last.sets.length} sets reached ${repMax}+ reps last time, so add a small amount of weight and restart at ${repMin} reps.` };
  }
  if (missed && hist[1]) {
    const prev = workingSets(hist[1].sets);
    const prevMissed = Math.abs(prev.top - last.top) < 0.01 && prev.sets.some((s) => s.reps < repMin);
    if (prevMissed) {
      return { exerciseId, kind: 'deload', weightKg: roundLoadKg(last.top * 0.9, units), repMin, repMax, reason: `Reps fell below ${repMin} in two sessions in a row at this weight. A ~10% reduction usually restarts progress.` };
    }
  }
  if (missed) return { exerciseId, kind: 'hold', weightKg: last.top, repMin, repMax, reason: `Some sets fell short of ${repMin} reps. Repeat this weight and aim to hit the range.` };
  return { exerciseId, kind: 'hold', weightKg: last.top, repMin, repMax, reason: `Keep this weight and add a rep where you can, working toward ${repMax} on every set.` };
}

/** Best e1RM per session for an exercise, oldest first (for charts). */
export function progressionSeries(exerciseId: string, sessions: WorkoutSession[]): { date: string; e1rm: number; topWeightKg: number; volumeKg: number }[] {
  return historyFor(exerciseId, sessions)
    .map(({ session, sets }) => ({
      date: session.date,
      e1rm: Math.max(...sets.map((s) => e1rm(s.weightKg, s.reps))),
      topWeightKg: Math.max(...sets.map((s) => s.weightKg)),
      volumeKg: sets.reduce((v, s) => v + s.weightKg * s.reps, 0),
    }))
    .reverse();
}
