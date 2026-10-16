import { addDays } from '../dates';
import type { ISODate, LoggedSet, MuscleGroup, WorkoutSession } from '../types';
import { EXERCISE_BY_ID } from './exercises';
import { historyFor } from './progression';

export interface MuscleVolume {
  muscle: MuscleGroup;
  /** working sets in the 7 days ending today */
  sets: number;
  /** working sets in the 7 days before that */
  prevSets: number;
}

/** Working (non-warm-up) sets per primary muscle for the last 7 days vs the 7 before, most-worked first. */
export function weeklyMuscleVolume(sessions: WorkoutSession[], today: ISODate): MuscleVolume[] {
  const thisFrom = addDays(today, -6);
  const prevFrom = addDays(today, -13);
  const by = new Map<MuscleGroup, MuscleVolume>();
  for (const s of sessions) {
    if (s.deleted || s.date < prevFrom || s.date > today) continue;
    for (const set of s.sets) {
      const muscle = EXERCISE_BY_ID[set.exerciseId]?.primary;
      if (!muscle || set.warmup) continue;
      const row = by.get(muscle) ?? { muscle, sets: 0, prevSets: 0 };
      if (s.date >= thisFrom) row.sets += 1;
      else row.prevSets += 1;
      by.set(muscle, row);
    }
  }
  return [...by.values()].sort((a, b) => b.sets - a.sets || b.prevSets - a.prevSets);
}

/** The set done at the same position in the exercise's most recent finished session (or its last set). */
export function lastSessionSet(exerciseId: string, history: WorkoutSession[], index: number): LoggedSet | undefined {
  const sets = historyFor(exerciseId, history)[0]?.sets;
  return sets ? sets[Math.min(index, sets.length - 1)] : undefined;
}
