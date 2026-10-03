import type {
  ActivityRecord, ChatMessage, DayAdjustment, FoodEntry, Insight, IntegrationState, ISODate, NotificationRecord,
  NutritionTargets, Profile, Proposal, Settings, SyncMeta, WeightEntry, WorkoutDay, WorkoutPlan, WorkoutSession,
} from './types';

export const STATE_VERSION = 1;

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
}

export function defaultSettings(now: string): Settings {
  return {
    units: 'imperial',
    coachTone: 'supportive',
    notifications: { enabled: false, quietStart: '21:30', quietEnd: '07:30', categories: { nutrition: true, workouts: true, checkins: true } },
    aiMode: 'simulated',
    updatedAt: now,
  };
}

export function emptyState(deviceId: string, now: string): AppState {
  return {
    version: STATE_VERSION,
    dayAdjustments: [],
    workoutOverrides: [],
    foodLog: [],
    weights: [],
    routines: [],
    sessions: [],
    activity: [],
    integrations: [{ id: 'health_connect', status: 'not_connected' }],
    proposals: [],
    insights: [],
    dismissedInsights: [],
    chat: [],
    notifications: [],
    settings: defaultSettings(now),
    deviceId,
  };
}

/** Collections that sync record-by-record (each item has id/updatedAt/deleted). */
export const SYNCED_COLLECTIONS = ['dayAdjustments', 'workoutOverrides', 'foodLog', 'weights', 'routines', 'sessions', 'activity', 'proposals', 'chat', 'notifications'] as const;
export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

/** Single documents that sync as a whole. */
export const SYNCED_SINGLETONS = ['profile', 'targets', 'plan', 'settings'] as const;
export type SyncedSingleton = (typeof SYNCED_SINGLETONS)[number];
