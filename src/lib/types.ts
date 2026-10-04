// Core domain types shared by the whole app.
// All weights are stored in kilograms and heights in centimetres; the UI converts
// to the user's preferred units at display time.

export type ISODate = string; // 'YYYY-MM-DD' in the user's local time zone
export type ISODateTime = string; // full ISO timestamp

export type GoalPriority = 'fat_loss' | 'muscle_gain' | 'strength' | 'maintenance';
export type Sex = 'male' | 'female' | 'unspecified';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Equipment = 'full_gym' | 'home_barbell' | 'dumbbells' | 'bodyweight';
export type DailyActivity = 'mostly_sitting' | 'on_feet' | 'physical_job';
export type UnitSystem = 'imperial' | 'metric';
export type CoachTone = 'supportive' | 'direct';
export type BodyArea = 'knee' | 'lower_back' | 'shoulder' | 'wrist' | 'elbow' | 'hip' | 'ankle' | 'neck';

/** Every synced record carries an id and an updatedAt for last-write-wins merging. */
export interface SyncMeta {
  id: string;
  updatedAt: ISODateTime;
  deleted?: boolean;
}

export interface Profile {
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  startWeightKg: number;
  goal: GoalPriority;
  experience: Experience;
  equipment: Equipment;
  trainingDays: number[]; // 0 = Sunday … 6 = Saturday
  sessionMinutes: number;
  dailyActivity: DailyActivity;
  dietPreferences: string[]; // e.g. 'vegetarian', 'no_pork', 'dairy_free'
  limitations: Limitation[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Limitation {
  area: BodyArea;
  note?: string;
  /** temporary limitations added from a coach conversation can expire */
  until?: ISODate;
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** The ongoing nutrition target plus how it was derived (for transparency). */
export interface NutritionTargets extends MacroTargets {
  bmr: number;
  maintenance: number;
  /** steps/day that the maintenance estimate already assumes (avoid double counting) */
  baselineSteps: number;
  /** average daily kcal from planned training already included in maintenance */
  baselineTrainingKcal: number;
  method: string;
  updatedAt: ISODateTime;
}

/** One-day adjustment approved by the user; does not change the ongoing target. */
export interface DayAdjustment extends SyncMeta {
  date: ISODate;
  calorieDelta: number;
  carbsDeltaG: number;
  reason: string;
  proposalId: string;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type NutritionSourceKind = 'official_restaurant' | 'database' | 'label' | 'visual_estimate' | 'user_entered';

export interface NutritionSource {
  kind: NutritionSourceKind;
  label: string; // human-readable, e.g. "USDA FoodData Central #171477"
  url?: string;
  /** true when the values came from a nutrition source rather than an AI guess */
  sourced: boolean;
}

export interface FoodItem {
  name: string;
  portionLabel: string; // "1 burger", "1.5 cups"
  grams?: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  source: NutritionSource;
}

export interface FoodEntry extends SyncMeta {
  date: ISODate;
  meal: MealType;
  items: FoodItem[];
  origin: 'photo' | 'manual';
  photoUri?: string;
  hint?: string;
  /** set only when the user explicitly accepted; logging requires it */
  confirmedAt: ISODateTime;
  createdAt: ISODateTime;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface EstimateItem extends FoodItem {
  confidence: Confidence;
  portionAssumption: string;
  alternatives?: string[];
}

/** AI output for a food photo. Never logged until the user accepts it. */
export interface FoodEstimate {
  id: string;
  createdAt: ISODateTime;
  hint?: string;
  photoUri?: string;
  items: EstimateItem[];
  overallConfidence: Confidence;
  followUpQuestion?: string;
  notes: string[];
  simulated: boolean;
  provider: string;
  /** Set when the real AI failed and the built-in estimate was used instead. */
  aiNotice?: string;
}

export interface WeightEntry extends SyncMeta {
  date: ISODate;
  weightKg: number;
}

// ---------- Workouts ----------

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'quads' | 'hamstrings' | 'glutes' | 'biceps' | 'triceps' | 'core' | 'calves' | 'full_body';

export interface Exercise {
  id: string;
  name: string;
  aliases: string[];
  primary: MuscleGroup;
  pattern: 'push' | 'pull' | 'squat' | 'hinge' | 'lunge' | 'carry' | 'core' | 'isolation';
  equipment: Equipment[]; // equipment levels that can perform it
  loadType: 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight';
  stresses: BodyArea[]; // body areas loaded heavily; used to avoid aggravating limitations
  compound: boolean;
  /** held for time (plank, carries): rep ranges are seconds */
  timed?: boolean;
}

export interface PlannedExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  targetWeightKg?: number;
  restSec: number;
  note?: string;
}

export interface WorkoutDay {
  id: string;
  name: string; // "Upper A"
  focus: string;
  weekday?: number;
  exercises: PlannedExercise[];
  /** for one-day variants (short/lighter/swapped): the plan day they were derived from */
  sourceDayId?: string;
}

export interface WorkoutPlan extends SyncMeta {
  name: string;
  source: 'ai_generated' | 'user_created';
  days: WorkoutDay[];
  rationale: string[];
  createdAt: ISODateTime;
}

export interface LoggedSet {
  id: string;
  exerciseId: string;
  weightKg: number;
  reps: number;
  rpe?: number;
  via: 'manual' | 'voice';
  loggedAt: ISODateTime;
}

export interface WorkoutSession extends SyncMeta {
  date: ISODate;
  planId?: string;
  dayId?: string;
  name: string;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  sets: LoggedSet[];
  notes?: string;
}

// ---------- Activity / wearables ----------

export type ActivitySourceId = 'health_connect' | 'manual' | 'simulated';

export interface ActivityRecord extends SyncMeta {
  date: ISODate;
  source: ActivitySourceId;
  /** device/app that produced the data, as reported by Health Connect */
  origin: string;
  /** stable id from the upstream source for de-duplication */
  externalId?: string;
  steps?: number;
  activeKcal?: number;
  exerciseMinutes?: number;
  syncedAt: ISODateTime;
}

export type IntegrationStatus = 'not_connected' | 'connected' | 'permission_denied' | 'unavailable' | 'error';

export interface IntegrationState {
  id: 'health_connect';
  status: IntegrationStatus;
  lastSyncAt?: ISODateTime;
  message?: string;
}

// ---------- Coaching ----------

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export type ProposalChange =
  | { type: 'day_calorie_adjustment'; date: ISODate; calorieDelta: number; carbsDeltaG: number }
  | { type: 'target_change'; next: MacroTargets }
  | { type: 'plan_weight_update'; planId: string; updates: { dayId: string; exerciseId: string; targetWeightKg: number; repMin?: number; repMax?: number }[] }
  | { type: 'today_workout_swap'; date: ISODate; day: WorkoutDay }
  | { type: 'add_limitation'; limitation: Limitation }
  | { type: 'goal_change'; goal: GoalPriority; next: MacroTargets }
  | { type: 'new_plan'; plan: WorkoutPlan };

export interface Proposal extends SyncMeta {
  kind: ProposalChange['type'];
  /** 'today' for one-day changes, 'ongoing' for changes to the saved plan/targets */
  scope: 'today' | 'ongoing';
  title: string;
  summary: string;
  rationale: string[];
  change: ProposalChange;
  status: ProposalStatus;
  createdAt: ISODateTime;
  decidedAt?: ISODateTime;
  expiresOn?: ISODate;
  /** de-duplication key so the engine doesn't re-propose the same thing */
  dedupeKey: string;
  origin: 'adaptive_engine' | 'coach_chat' | 'progression' | 'onboarding';
}

export interface Insight {
  id: string;
  dedupeKey: string;
  title: string;
  body: string;
  priority: number; // 1 (low) … 3 (high)
  createdAt: ISODateTime;
  proposalId?: string;
}

export interface ChatMessage extends SyncMeta {
  role: 'user' | 'coach';
  text: string;
  createdAt: ISODateTime;
  proposalIds?: string[];
  simulated?: boolean;
  safety?: boolean;
}

// ---------- Notifications ----------

export interface NotificationPrefs {
  enabled: boolean;
  quietStart: string; // 'HH:MM'
  quietEnd: string; // 'HH:MM'
  categories: { nutrition: boolean; workouts: boolean; checkins: boolean };
}

export interface NotificationRecord extends SyncMeta {
  date: ISODate;
  sentAt: ISODateTime;
  category: keyof NotificationPrefs['categories'];
  title: string;
  body: string;
  dedupeKey: string;
  deviceId: string;
  delivered: 'system' | 'in_app';
}

export interface Settings {
  units: UnitSystem;
  coachTone: CoachTone;
  notifications: NotificationPrefs;
  aiMode: 'simulated' | 'server';
  /** Retained for old saved settings; the server picks the photo model. */
  aiModels?: { vision: string; chat: string };
  geminiModel?: string;
  /** Groq coach model; see src/lib/ai/groqModels.ts. */
  chatModel?: string;
  updatedAt: ISODateTime;
}
