import type {
  ActivityRecord, ChatMessage, DayAdjustment, FoodEntry, Insight, IntegrationState, ISODate, NotificationRecord,
  NutritionTargets, Profile, ProgressPhoto, Proposal, Settings, SyncMeta, WeightEntry, WorkoutDay, WorkoutPlan, WorkoutSession,
} from './types';

export const STATE_VERSION = 2;

/** An approved one-day workout replacement (e.g. a 20-minute version). */
export interface WorkoutOverride extends SyncMeta {
  date: ISODate;
  day: WorkoutDay;
  proposalId: string;
}

export interface AppState {
  version: number;
  profile?: Profile;
  targets?: NutritionTargets;
  dayAdjustments: DayAdjustment[];
  workoutOverrides: WorkoutOverride[];
  foodLog: FoodEntry[];
  weights: WeightEntry[];
  progressPhotos: ProgressPhoto[];
  plan?: WorkoutPlan;
  routines: WorkoutPlan[]; // user-created routines
  sessions: WorkoutSession[];
  activeSessionId?: string;
  activity: ActivityRecord[];
  integrations: IntegrationState[];
  proposals: Proposal[];
  insights: Insight[];
  dismissedInsights: string[]; // dedupe keys
  chat: ChatMessage[];
  notifications: NotificationRecord[];
  settings: Settings;
  deviceId: string;
  /** true while the app holds generated sample data (shows a persistent banner) */
  sample?: boolean;
}

/** Timestamp older than any real edit, so defaults never overwrite synced settings. */
export const EPOCH = '1970-01-01T00:00:00.000Z';

export function defaultSettings(): Settings {
  return {
    units: 'imperial',
    coachTone: 'supportive',
    notifications: { enabled: false, quietStart: '21:30', quietEnd: '07:30', categories: { nutrition: true, workouts: true, checkins: true } },
    aiMode: 'simulated',
    updatedAt: EPOCH,
  };
}

export function emptyState(deviceId: string, now: string): AppState {
  return {
    version: STATE_VERSION,
    dayAdjustments: [],
    workoutOverrides: [],
    foodLog: [],
    weights: [],
    progressPhotos: [],
    routines: [],
    sessions: [],
    activity: [],
    integrations: [{ id: 'health_connect', status: 'not_connected' }],
    proposals: [],
    insights: [],
    dismissedInsights: [],
    chat: [],
    notifications: [],
    settings: defaultSettings(),
    deviceId,
  };
}

export function migrateState(saved: AppState): AppState {
  const base = emptyState(saved.deviceId ?? 'unknown', new Date().toISOString());
  return {
    ...base, ...saved, version: STATE_VERSION,
    foodLog: (saved.foodLog ?? []).map((entry) => ({
      ...entry,
      items: (entry.items ?? []).map((item) => ({ ...item, reviewRequired: item.reviewRequired ?? false })),
      estimateQuality: entry.estimateQuality ?? (entry.origin === 'photo' ? { provider: 'Earlier estimate', overallConfidence: 'low' as const, corrected: false, notes: ['Estimate quality was not recorded in this version.'] } : undefined),
    })),
    sessions: (saved.sessions ?? []).map((session) => ({ ...session, effort: session.effort ?? undefined, pain: session.pain ?? undefined })),
  };
}

/** Collections that sync record-by-record (each item has id/updatedAt/deleted). */
export const SYNCED_COLLECTIONS = ['dayAdjustments', 'workoutOverrides', 'foodLog', 'weights', 'routines', 'sessions', 'activity', 'proposals', 'chat', 'notifications', 'progressPhotos'] as const;
export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

/** Single documents that sync as a whole. */
export const SYNCED_SINGLETONS = ['profile', 'targets', 'plan', 'settings'] as const;
export type SyncedSingleton = (typeof SYNCED_SINGLETONS)[number];

type SignatureKey = SyncedCollection | SyncedSingleton;

/**
 * A cheap content signature: per key, the item count plus the newest `updatedAt`.
 * Every edit (including deletes, which are tombstones) bumps `updatedAt`, so this
 * changes on edits as well as additions, unlike a plain length check.
 */
export function contentSignature(state: AppState, keys: readonly SignatureKey[] = [...SYNCED_COLLECTIONS, ...SYNCED_SINGLETONS]): string {
  return keys
    .map((k) => {
      const v = state[k] as { updatedAt?: string }[] | { updatedAt?: string } | undefined;
      if (Array.isArray(v)) {
        let max = '';
        for (const x of v) if (x.updatedAt && x.updatedAt > max) max = x.updatedAt;
        return `${k}:${v.length}:${max}`;
      }
      return `${k}:${v?.updatedAt ?? '-'}`;
    })
    .join('|');
}
