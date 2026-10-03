import type { AppState, WorkoutOverride } from './state';
import type {
  ActivityRecord, ChatMessage, FoodEntry, GoalPriority, Insight, IntegrationState, LoggedSet, NotificationRecord,
  NutritionTargets, Profile, Proposal, Settings, WeightEntry, WorkoutPlan, WorkoutSession, ISODate,
} from './types';
import { mergeActivity } from './activity/activity';
import { newId } from './id';
import { mergeRemote, type RemoteRecord } from './sync/merge';

export type Action =
  | { type: 'HYDRATE'; state: AppState }
  | { type: 'COMPLETE_ONBOARDING'; profile: Profile; targets: NutritionTargets; weight: WeightEntry; plan?: WorkoutPlan }
  | { type: 'UPDATE_PROFILE'; patch: Partial<Omit<Profile, 'goal' | 'createdAt'>>; now: string }
  | { type: 'SET_GOAL'; goal: GoalPriority; targets: NutritionTargets; now: string; confirmed: boolean }
  | { type: 'SET_TARGETS'; targets: NutritionTargets; confirmed: boolean }
  | { type: 'LOG_FOOD'; entry: FoodEntry }
  | { type: 'UPDATE_FOOD'; entry: FoodEntry }
  | { type: 'DELETE_FOOD'; id: string; now: string }
  | { type: 'LOG_WEIGHT'; entry: WeightEntry }
  | { type: 'DELETE_WEIGHT'; id: string; now: string }
  | { type: 'SET_PLAN'; plan: WorkoutPlan; confirmed: boolean }
  | { type: 'SAVE_ROUTINE'; routine: WorkoutPlan }
  | { type: 'DELETE_ROUTINE'; id: string; now: string }
  | { type: 'START_SESSION'; session: WorkoutSession }
  | { type: 'ADD_SETS'; sessionId: string; sets: LoggedSet[]; now: string }
  | { type: 'UPDATE_SET'; sessionId: string; set: LoggedSet; now: string }
  | { type: 'DELETE_SET'; sessionId: string; setId: string; now: string }
  | { type: 'FINISH_SESSION'; sessionId: string; now: string; notes?: string }
  | { type: 'DISCARD_SESSION'; sessionId: string; now: string }
  | { type: 'DELETE_SESSION'; sessionId: string; now: string }
  | { type: 'MERGE_ACTIVITY'; records: ActivityRecord[] }
  | { type: 'DELETE_ACTIVITY'; id: string; now: string }
  | { type: 'SET_INTEGRATION'; integration: IntegrationState }
  | { type: 'ADD_PROPOSALS'; proposals: Proposal[] }
  | { type: 'ACCEPT_PROPOSAL'; id: string; now: string; today: ISODate }
  | { type: 'REJECT_PROPOSAL'; id: string; now: string }
  | { type: 'EXPIRE_PROPOSALS'; today: ISODate; now: string }
  | { type: 'SET_INSIGHTS'; insights: Insight[] }
  | { type: 'DISMISS_INSIGHT'; dedupeKey: string }
  | { type: 'ADD_CHAT'; messages: ChatMessage[] }
  | { type: 'CLEAR_CHAT'; now: string }
  | { type: 'RECORD_NOTIFICATION'; record: NotificationRecord }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Omit<Settings, 'updatedAt'>>; now: string }
  | { type: 'REPLACE_STATE'; state: AppState }
  | { type: 'MERGE_REMOTE'; rows: RemoteRecord[] };

export class RuleViolation extends Error {}

/**
 * Business rules that must hold no matter which screen dispatches the action.
 * Throws RuleViolation; the reducer itself ignores invalid actions (returns the
 * same state) so a bad dispatch can never corrupt data.
 */
export function checkAction(state: AppState, action: Action): void {
  switch (action.type) {
    case 'LOG_FOOD':
    case 'UPDATE_FOOD': {
      const e = action.entry;
      if (!e.confirmedAt) throw new RuleViolation('Food can only be logged after you confirm it.');
      if (!e.items.length) throw new RuleViolation('A meal needs at least one item.');
      if (e.items.some((i) => !Number.isFinite(i.calories) || i.calories < 0)) throw new RuleViolation('Calories must be a positive number.');
      return;
    }
    case 'SET_GOAL':
    case 'SET_TARGETS':
    case 'SET_PLAN':
      if (action.confirmed !== true) throw new RuleViolation('This change needs your confirmation first.');
      return;
    case 'ACCEPT_PROPOSAL': {
      const p = state.proposals.find((x) => x.id === action.id);
      if (!p) throw new RuleViolation('Suggestion not found.');
      if (p.status !== 'pending') throw new RuleViolation(`This suggestion was already ${p.status}.`);
      if (p.expiresOn && p.expiresOn < action.today) throw new RuleViolation('This suggestion has expired.');
      if (p.change.type === 'plan_weight_update' && state.plan?.id !== p.change.planId) throw new RuleViolation('Your plan changed since this suggestion was made.');
      if ((p.change.type === 'target_change' || p.change.type === 'day_calorie_adjustment') && !state.targets) throw new RuleViolation('Set up nutrition targets first.');
      return;
    }
    case 'REJECT_PROPOSAL': {
      const p = state.proposals.find((x) => x.id === action.id);
      if (!p || p.status !== 'pending') throw new RuleViolation('Only pending suggestions can be declined.');
      return;
    }
    case 'ADD_SETS':
    case 'UPDATE_SET': {
      const sets = action.type === 'ADD_SETS' ? action.sets : [action.set];
      if (sets.some((s) => !Number.isFinite(s.weightKg) || s.weightKg < 0 || !Number.isInteger(s.reps) || s.reps <= 0 || s.reps > 300)) {
        throw new RuleViolation('Each set needs a weight (0 or more) and 1–300 reps (or seconds for holds).');
      }
      return;
    }
    case 'LOG_WEIGHT':
      if (!(action.entry.weightKg > 20 && action.entry.weightKg < 400)) throw new RuleViolation('That body weight looks out of range.');
      return;
    default:
      return;
  }
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
};

const tombstone = <T extends { id: string; updatedAt: string; deleted?: boolean }>(list: T[], id: string, now: string): T[] =>
  list.map((x) => (x.id === id ? { ...x, deleted: true, updatedAt: now } : x));

function updateSession(state: AppState, id: string, fn: (s: WorkoutSession) => WorkoutSession): AppState {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) };
}

export function reducer(state: AppState, action: Action): AppState {
  try {
    checkAction(state, action);
  } catch {
    return state;
  }
  switch (action.type) {
    case 'HYDRATE':
    case 'REPLACE_STATE':
      return action.state;

    case 'MERGE_REMOTE':
      return mergeRemote(state, action.rows);

    case 'COMPLETE_ONBOARDING':
      return {
        ...state,
        profile: action.profile,
        targets: action.targets,
        weights: upsert(state.weights, action.weight),
        plan: action.plan ?? state.plan,
      };

    case 'UPDATE_PROFILE':
      if (!state.profile) return state;
      return { ...state, profile: { ...state.profile, ...action.patch, updatedAt: action.now } };

    case 'SET_GOAL':
      if (!state.profile) return state;
      return { ...state, profile: { ...state.profile, goal: action.goal, updatedAt: action.now }, targets: action.targets };

    case 'SET_TARGETS':
      return { ...state, targets: action.targets };

    case 'LOG_FOOD':
    case 'UPDATE_FOOD':
      return { ...state, foodLog: upsert(state.foodLog, action.entry) };
    case 'DELETE_FOOD':
      return { ...state, foodLog: tombstone(state.foodLog, action.id, action.now) };

    case 'LOG_WEIGHT': {
      // one weigh-in per day: replace an existing entry for the same date
      const existing = state.weights.find((w) => w.date === action.entry.date && !w.deleted);
      const entry = existing ? { ...action.entry, id: existing.id } : action.entry;
      return { ...state, weights: upsert(state.weights, entry) };
    }
    case 'DELETE_WEIGHT':
      return { ...state, weights: tombstone(state.weights, action.id, action.now) };

    case 'SET_PLAN':
      return { ...state, plan: action.plan };
    case 'SAVE_ROUTINE':
      return { ...state, routines: upsert(state.routines, action.routine) };
    case 'DELETE_ROUTINE':
      return { ...state, routines: tombstone(state.routines, action.id, action.now) };

    case 'START_SESSION':
      return { ...state, sessions: upsert(state.sessions, action.session), activeSessionId: action.session.id };
    case 'ADD_SETS':
      return updateSession(state, action.sessionId, (s) => ({ ...s, sets: [...s.sets, ...action.sets], updatedAt: action.now }));
    case 'UPDATE_SET':
      return updateSession(state, action.sessionId, (s) => ({ ...s, sets: s.sets.map((x) => (x.id === action.set.id ? action.set : x)), updatedAt: action.now }));
    case 'DELETE_SET':
      return updateSession(state, action.sessionId, (s) => ({ ...s, sets: s.sets.filter((x) => x.id !== action.setId), updatedAt: action.now }));
    case 'FINISH_SESSION': {
      const next = updateSession(state, action.sessionId, (s) => ({ ...s, finishedAt: action.now, notes: action.notes ?? s.notes, updatedAt: action.now }));
      return { ...next, activeSessionId: state.activeSessionId === action.sessionId ? undefined : state.activeSessionId };
    }
    case 'DISCARD_SESSION':
    case 'DELETE_SESSION':
      return {
        ...state,
        sessions: tombstone(state.sessions, action.sessionId, action.now),
        activeSessionId: state.activeSessionId === action.sessionId ? undefined : state.activeSessionId,
      };

    case 'MERGE_ACTIVITY':
      return { ...state, activity: mergeActivity(state.activity, action.records).records };
    case 'DELETE_ACTIVITY':
      return { ...state, activity: tombstone(state.activity, action.id, action.now) };
    case 'SET_INTEGRATION':
      return { ...state, integrations: [...state.integrations.filter((i) => i.id !== action.integration.id), action.integration] };

    case 'ADD_PROPOSALS': {
      const live = new Set(state.proposals.filter((p) => !p.deleted).map((p) => p.dedupeKey));
      const fresh = action.proposals.filter((p) => !live.has(p.dedupeKey));
      return fresh.length ? { ...state, proposals: [...state.proposals, ...fresh] } : state;
    }
    case 'REJECT_PROPOSAL':
      return { ...state, proposals: state.proposals.map((p) => (p.id === action.id ? { ...p, status: 'rejected', decidedAt: action.now, updatedAt: action.now } : p)) };
    case 'EXPIRE_PROPOSALS': {
      let changed = false;
      const proposals = state.proposals.map((p) => {
        if (p.status === 'pending' && p.expiresOn && p.expiresOn < action.today) {
          changed = true;
          return { ...p, status: 'expired' as const, updatedAt: action.now };
        }
        return p;
      });
      return changed ? { ...state, proposals } : state;
    }
    case 'ACCEPT_PROPOSAL':
      return applyProposal(state, action.id, action.now);

    case 'SET_INSIGHTS':
      return { ...state, insights: action.insights.filter((i) => !state.dismissedInsights.includes(i.dedupeKey)) };
    case 'DISMISS_INSIGHT':
      return { ...state, dismissedInsights: [...state.dismissedInsights, action.dedupeKey], insights: state.insights.filter((i) => i.dedupeKey !== action.dedupeKey) };

    case 'ADD_CHAT':
      return { ...state, chat: [...state.chat, ...action.messages] };
    case 'CLEAR_CHAT':
      return { ...state, chat: state.chat.map((m) => ({ ...m, deleted: true, updatedAt: action.now })) };

    case 'RECORD_NOTIFICATION':
      return { ...state, notifications: [...state.notifications, action.record] };

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch, updatedAt: action.now } };

    default:
      return state;
  }
}

/** Apply an accepted proposal. This is the only code path that changes plans/targets from a suggestion. */
function applyProposal(state: AppState, id: string, now: string): AppState {
  const p = state.proposals.find((x) => x.id === id)!;
  const proposals = state.proposals.map((x) => (x.id === id ? { ...x, status: 'accepted' as const, decidedAt: now, updatedAt: now } : x));
  const c = p.change;
  switch (c.type) {
    case 'day_calorie_adjustment': {
      const others = state.dayAdjustments.map((a) => (a.date === c.date && !a.deleted ? { ...a, deleted: true, updatedAt: now } : a));
      return {
        ...state,
        proposals,
        dayAdjustments: [...others, { id: newId(), date: c.date, calorieDelta: c.calorieDelta, carbsDeltaG: c.carbsDeltaG, reason: p.title, proposalId: p.id, updatedAt: now }],
      };
    }
    case 'target_change':
      return { ...state, proposals, targets: { ...state.targets!, ...c.next, updatedAt: now, method: `${state.targets!.method} · adjusted from your progress (${now.slice(0, 10)})` } };
    case 'goal_change':
      return {
        ...state,
        proposals,
        profile: state.profile ? { ...state.profile, goal: c.goal, updatedAt: now } : state.profile,
        targets: state.targets ? { ...state.targets, ...c.next, updatedAt: now } : state.targets,
      };
    case 'plan_weight_update': {
      if (!state.plan) return { ...state, proposals };
      const days = state.plan.days.map((d) => ({
        ...d,
        exercises: d.exercises.map((e) => {
          const u = c.updates.find((x) => x.dayId === d.id && x.exerciseId === e.exerciseId);
          return u ? { ...e, targetWeightKg: u.targetWeightKg, repMin: u.repMin ?? e.repMin, repMax: u.repMax ?? e.repMax } : e;
        }),
      }));
      return { ...state, proposals, plan: { ...state.plan, days, updatedAt: now } };
    }
    case 'today_workout_swap': {
      const others = state.workoutOverrides.map((o) => (o.date === c.date && !o.deleted ? { ...o, deleted: true, updatedAt: now } : o));
      const ov: WorkoutOverride = { id: newId(), date: c.date, day: c.day, proposalId: p.id, updatedAt: now };
      return { ...state, proposals, workoutOverrides: [...others, ov] };
    }
    case 'add_limitation': {
      if (!state.profile) return { ...state, proposals };
      const current = state.profile.limitations.find((l) => l.area === c.limitation.area);
      // never shorten an existing permanent (or longer) limitation
      if (current && (!current.until || (c.limitation.until && current.until >= c.limitation.until))) return { ...state, proposals };
      return {
        ...state,
        proposals,
        profile: { ...state.profile, limitations: [...state.profile.limitations.filter((l) => l.area !== c.limitation.area), c.limitation], updatedAt: now },
      };
    }
    case 'new_plan':
      return { ...state, proposals, plan: c.plan };
    default:
      return { ...state, proposals };
  }
}
