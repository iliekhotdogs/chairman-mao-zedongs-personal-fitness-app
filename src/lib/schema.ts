import { z } from 'zod';

import type { SyncedCollection, SyncedSingleton } from './state';

/**
 * Runtime validation for data that crosses a trust boundary: state read back from
 * device storage and rows pulled from the server. Schemas check only the fields the
 * app relies on and keep unknown fields (`looseObject`), so older or newer app
 * versions can round-trip data they don't fully understand.
 */

// Zod probes `new Function('')` when an object schema is built, to decide whether to compile
// parsers. The web Content-Security-Policy forbids eval, so the probe would log a CSP
// violation; jitless skips it (and eval) and parses the same way.
z.config({ jitless: true });

const str = z.string();
const num = z.number();
const stamp = z.string().min(1);

const syncMeta = { id: z.string().min(1), updatedAt: stamp, deleted: z.boolean().optional() };

/** A tombstone only needs its identity; its payload is never shown. */
const tombstone = z.looseObject({ ...syncMeta, deleted: z.literal(true) });

const foodItem = z.looseObject({ name: str, calories: num, proteinG: num, carbsG: num, fatG: num });
const foodEntry = z.looseObject({ ...syncMeta, date: str, meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']), items: z.array(foodItem) });
const weightEntry = z.looseObject({ ...syncMeta, date: str, weightKg: num });
const plannedExercise = z.looseObject({ exerciseId: str, sets: num, repMin: num, repMax: num });
const workoutDay = z.looseObject({ id: str, name: str, exercises: z.array(plannedExercise) });
const workoutPlan = z.looseObject({ ...syncMeta, name: str, days: z.array(workoutDay) });
const loggedSet = z.looseObject({ id: str, exerciseId: str, weightKg: num, reps: num });
const session = z.looseObject({ ...syncMeta, date: str, name: str, startedAt: str, sets: z.array(loggedSet) });
const activity = z.looseObject({ ...syncMeta, date: str, source: str });
const proposal = z.looseObject({
  ...syncMeta,
  kind: str,
  status: z.enum(['pending', 'accepted', 'rejected', 'expired']),
  change: z.looseObject({ type: str }),
  dedupeKey: str,
  title: str,
});
const chat = z.looseObject({ ...syncMeta, role: z.enum(['user', 'coach']), text: str });
const notification = z.looseObject({ ...syncMeta, date: str, dedupeKey: str, category: str });
const dayAdjustment = z.looseObject({ ...syncMeta, date: str, calorieDelta: num, carbsDeltaG: num });
const progressPhoto = z.looseObject({ ...syncMeta, date: str, uri: z.string().min(1) });
const workoutOverride = z.looseObject({ ...syncMeta, date: str, day: workoutDay });

const COLLECTION_SCHEMAS: Record<SyncedCollection, z.ZodType> = {
  dayAdjustments: dayAdjustment,
  workoutOverrides: workoutOverride,
  foodLog: foodEntry,
  weights: weightEntry,
  routines: workoutPlan,
  sessions: session,
  activity,
  proposals: proposal,
  chat,
  notifications: notification,
  progressPhotos: progressPhoto,
};

const SINGLETON_SCHEMAS: Record<SyncedSingleton, z.ZodType> = {
  profile: z.looseObject({
    name: str,
    goal: str,
    heightCm: num,
    updatedAt: stamp,
    trainingDays: z.array(num).default([]),
    dietPreferences: z.array(str).default([]),
    limitations: z.array(z.looseObject({ area: str })).default([]),
  }),
  targets: z.looseObject({ calories: num, proteinG: num, carbsG: num, fatG: num, updatedAt: stamp }),
  plan: workoutPlan,
  settings: z.looseObject({
    units: z.enum(['imperial', 'metric']),
    coachTone: z.enum(['supportive', 'direct']),
    notifications: z.looseObject({
      enabled: z.boolean(),
      quietStart: str,
      quietEnd: str,
      categories: z.looseObject({ nutrition: z.boolean(), workouts: z.boolean(), checkins: z.boolean() }),
    }),
    updatedAt: stamp,
  }),
};

/** Returns the validated record, or null if it is unusable. Tombstones need only id/updatedAt. */
export function validateRecord<T>(collection: SyncedCollection, value: unknown): T | null {
  const full = COLLECTION_SCHEMAS[collection].safeParse(value);
  if (full.success) return full.data as T;
  const dead = tombstone.safeParse(value);
  return dead.success ? (dead.data as T) : null;
}

export function validateSingleton<T>(name: SyncedSingleton, value: unknown): T | null {
  const r = SINGLETON_SCHEMAS[name].safeParse(value);
  return r.success ? (r.data as T) : null;
}

/** Validate every item of a stored collection, dropping (and counting) bad ones. */
export function validateList<T>(collection: SyncedCollection, value: unknown): { items: T[]; dropped: number } {
  if (!Array.isArray(value)) return { items: [], dropped: value === undefined ? 0 : 1 };
  const items: T[] = [];
  for (const v of value) {
    const ok = validateRecord<T>(collection, v);
    if (ok) items.push(ok);
  }
  return { items, dropped: value.length - items.length };
}
