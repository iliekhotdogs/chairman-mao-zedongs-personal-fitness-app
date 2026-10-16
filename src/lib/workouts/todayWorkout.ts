import type { AppState } from '../state';
import type { ISODate, WorkoutDay, WorkoutSession } from '../types';
import { activeSession, sessionForDay, workoutForDay } from '../selectors';

export type TodayWorkout =
  | { status: 'no_plan' }
  | { status: 'rest' }
  | { status: 'planned' | 'active' | 'done'; day?: WorkoutDay; overridden: boolean; session?: WorkoutSession };

/** What the user should see and do about today's workout; shared by Today and Training. Honors one-day overrides. */
export function todayWorkout(state: AppState, date: ISODate): TodayWorkout {
  const { day, overridden } = workoutForDay(state, date);
  if (!state.plan && !overridden) return { status: 'no_plan' };
  const done = sessionForDay(state, date);
  if (done?.finishedAt) return { status: 'done', day, overridden, session: done };
  const active = activeSession(state);
  if (active) return { status: 'active', day, overridden, session: active };
  if (!day) return { status: 'rest' };
  return { status: 'planned', day, overridden };
}
