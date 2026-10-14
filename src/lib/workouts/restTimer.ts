import type { Exercise, PlannedExercise, RestPrefs } from '../types';

/** Defaults when the user has not chosen their own rest times. */
export const DEFAULT_REST: RestPrefs = { compoundSec: 90, accessorySec: 60 };

export const REST_STEP_SEC = 15;
export const REST_MIN_SEC = 15;
export const REST_MAX_SEC = 600;

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clampRest = (sec: number) => Math.min(REST_MAX_SEC, Math.max(REST_MIN_SEC, Math.round(sec)));

/**
 * Rest after a set: the plan's prescription wins, otherwise the user's preference for
 * compound or accessory lifts (falling back to 90 s / 60 s).
 */
export function defaultRestSec(exercise: Pick<Exercise, 'compound'> | undefined, planned?: Pick<PlannedExercise, 'restSec'>, prefs?: Partial<RestPrefs>): number {
  if (planned && Number.isFinite(planned.restSec) && planned.restSec > 0) return clampRest(planned.restSec);
  const p = sanitizeRestPrefs(prefs);
  return clampRest(exercise?.compound === false ? p.accessorySec : p.compoundSec);
}

/** A running countdown. Times are epoch milliseconds so the state survives re-renders and app pauses. */
export interface RestTimer {
  exerciseId?: string;
  startedAt: number;
  endsAt: number;
}

export function startRest(durationSec: number, now: number, exerciseId?: string): RestTimer {
  return { exerciseId, startedAt: now, endsAt: now + clampRest(durationSec) * 1000 };
}

/** Whole seconds left (rounded up, so "0" only shows once the rest is really over). */
export function remainingSec(t: RestTimer, now: number): number {
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}

export function totalSec(t: RestTimer): number {
  return Math.round((t.endsAt - t.startedAt) / 1000);
}

export const isRestDone = (t: RestTimer, now: number) => now >= t.endsAt;

/** Fraction of the rest already elapsed, 0..1. */
export function restProgress(t: RestTimer, now: number): number {
  const total = t.endsAt - t.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - t.startedAt) / total));
}

/**
 * Add or remove time (±15 s buttons). Never leaves less than 0 s remaining; the total
 * can't exceed REST_MAX_SEC. Adjusting a finished timer restarts it from now.
 */
export function adjustRest(t: RestTimer, deltaSec: number, now: number): RestTimer {
  const base = isRestDone(t, now) ? { ...t, startedAt: now, endsAt: now } : t;
  const endsAt = Math.min(base.startedAt + REST_MAX_SEC * 1000, Math.max(now, base.endsAt + deltaSec * 1000));
  return { ...base, endsAt };
}

/** "1:30", "0:05". */
export function formatRest(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Normalise a user-entered preference (settings screen). */
export function sanitizeRestPrefs(p: Partial<RestPrefs> | undefined): RestPrefs {
  return {
    compoundSec: clampRest(finite(p?.compoundSec) ?? DEFAULT_REST.compoundSec),
    accessorySec: clampRest(finite(p?.accessorySec) ?? DEFAULT_REST.accessorySec),
  };
}
