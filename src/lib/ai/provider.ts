import type { AppState } from '../state';
import type { Confidence, EstimateItem, FoodEstimate, FoodItem, ISODate, Proposal } from '../types';
import { simulateFoodEstimate } from '../nutrition/estimate';
import { hasInjuryRedFlag, isUrgentSymptom, simulateCoachReply, type CoachReply } from '../coaching/coachSim';
import { isSupabaseConfigured, supabase } from '../sync/supabase';
import { newId } from '../id';
import { nowISO, addDays } from '../dates';
import { remainingForDay, workoutForDay, latestWeight, live } from '../selectors';
import { exerciseName, findExercise, formatPrescription } from '../workouts/exercises';
import { ACTION_INTENT_TYPES, validateActionIntent, type ActionIntent } from '../../../supabase/functions/ai/foodValidation';
import { prepareImageForAI, type ImageSetting } from './image';
import { z } from 'zod';
import { log } from '../log';

/** Signed-in accounts use the server-side AI gateway (supabase/functions/ai). The
 * gateway resolves each user's saved choice; model ids never accompany coach calls.
 * Without Supabase, the app offers built-in answers. AI only proposes changes. */

export class AIUnavailableError extends Error {}

export const SIGNED_OUT = 'Sign in to use the AI coach.';
export const UNAVAILABLE = 'Coach is unavailable right now. Try again.';
export type AiNoticeKind = 'signed_out' | 'unavailable' | 'other';

/** supabase-js reports any non-2xx as a generic message; the gateway's own reason is in the body. */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  // Transport failures (CORS, offline, outage) carry developer jargon the user must never see.
  if ((error as { name?: string } | null)?.name === 'FunctionsFetchError') return UNAVAILABLE;
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) return /supabase|edge function|api_key/i.test(body.error) ? UNAVAILABLE : body.error;
  }
  const m = error instanceof Error ? error.message : fallback;
  return /supabase|edge function/i.test(m) ? UNAVAILABLE : m;
}

export type AIEngine = 'server' | 'simulated';

/** In the account build, chat and meal photos go through the authenticated Supabase gateway. */
export function aiEngine(): AIEngine {
  return isSupabaseConfigured() ? 'server' : 'simulated';
}

/** What the admin has configured, as reported by the gateway's `info` action. */
export interface AiInfo {
  enabled: boolean;
  provider: string;
  providerLabel: string;
  chatModel: string;
  chatModelLabel: string;
  visionModel: string;
  visionModelLabel: string;
  perUserDailyLimit: number;
  usedToday: number;
  allowUserChoice: boolean;
  isDefault: boolean;
  options: { id: string; label: string; keyConfigured: boolean; models: { id: string; label: string; vision: boolean }[] }[];
}

export async function fetchAiInfo(): Promise<AiInfo> {
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured.');
  const { data, error } = await sb.functions.invoke('ai', { body: { action: 'info' } });
  if (error) throw new Error(await functionErrorMessage(error, 'AI info is unavailable.'));
  if (!data || typeof data.providerLabel !== 'string') throw new Error('AI info is unavailable.');
  return data as AiInfo;
}

export async function saveAiPreference(provider: string, chat_model: string): Promise<AiInfo> {
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured.');
  const { data, error } = await sb.functions.invoke('ai', { body: { action: 'set_preference', provider, chat_model } });
  if (error) throw new Error(await functionErrorMessage(error, 'Could not save AI choice.'));
  if (!data?.info || typeof data.info.provider !== 'string') throw new Error('Could not confirm AI choice.');
  return data.info as AiInfo;
}

type FoodInput = { hint?: string; photoUri?: string; photoSize?: { width?: number; height?: number }; followUpAnswered?: boolean; imageSetting?: ImageSetting };

export async function estimateFood(state: AppState, input: FoodInput): Promise<AiFoodEstimate> {
  const engine = aiEngine();
  if (engine === 'simulated') {
    await delay(700); // let the UI show its loading state realistically
    return simulateFoodEstimate(input);
  }
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  try {
    const image = input.photoUri ? await prepareImageForAI(input.photoUri, input.photoSize, input.imageSetting) : undefined;
    const { data, error } = await sb.functions.invoke('ai', {
      body: { action: 'estimate_food', hint: input.hint ?? '', image: image ? { data: image.base64, mediaType: image.mediaType } : undefined, units: state.settings.units },
    });
    if (error) throw error;
    return toEstimate(data, input);
  } catch (error) {
    return { ...simulateFoodEstimate(input), aiNotice: await functionErrorMessage(error, 'The image service is unavailable.') };
  }
}

interface ServerEstimate {
  items: {
    name: string; portion: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number;
    confidence: Confidence; portion_assumption: string; review_required?: boolean; source_kind: EstimateItem['source']['kind']; source_label: string; source_url?: string | null;
  }[];
  overall_confidence: Confidence;
  follow_up_question?: string | null;
  notes: string[];
  rejected_items?: number;
  model: string;
  provider?: string;
  restaurant?: {
    name: string; supported: boolean; note?: string | null;
    candidates: { name: string; serving: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; source_url: string; checked_at: string; stale: boolean; disagreement?: string | null }[];
  } | null;
}

/** Official restaurant values offered next to the photo estimate; the user picks one or keeps the estimate. */
export interface RestaurantCandidate {
  item: FoodItem;
  checkedAt: string;
  /** Checked more than 30 days ago: shown as "may be out of date". */
  stale: boolean;
  disagreement?: string;
}
export interface RestaurantMatch { name: string; supported: boolean; note?: string; candidates: RestaurantCandidate[] }
export type AiFoodEstimate = FoodEstimate & { restaurant?: RestaurantMatch };

const okNumber = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;

function toRestaurant(r: ServerEstimate['restaurant']): RestaurantMatch | undefined {
  if (!r || typeof r.name !== 'string') return undefined;
  const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
    // The gateway is not trusted blindly: drop anything the food log would refuse.
    .filter((c) => c && typeof c.name === 'string' && /^https:\/\//.test(c.source_url ?? '') && okNumber(c.calories, 5000) && c.calories > 0 && [c.protein_g, c.carbs_g, c.fat_g].every((n) => okNumber(n, 1000)))
    .slice(0, 3)
    .map((c) => {
      const date = (c.checked_at ?? '').slice(0, 10);
      return {
        item: {
          name: c.name, portionLabel: c.serving || '1 serving', calories: Math.round(c.calories), proteinG: c.protein_g, carbsG: c.carbs_g, fatG: c.fat_g,
          source: { kind: 'official_restaurant' as const, label: `${r.name} official nutrition, checked ${date}${c.stale ? ' (may be out of date)' : ''}`, url: c.source_url, sourced: true },
        },
        checkedAt: date, stale: c.stale !== false, disagreement: c.disagreement ?? undefined,
      };
    });
  return { name: r.name, supported: r.supported === true, note: r.note ?? undefined, candidates };
}

export function toEstimate(data: ServerEstimate, input: { hint?: string; photoUri?: string }): AiFoodEstimate {
  if (!Array.isArray(data?.items) || !data.items.length) throw new Error('The image service returned no usable food items.');
  for (const item of data.items) {
    if (!item.name || !Number.isFinite(item.grams) || item.grams <= 0 || [item.calories, item.protein_g, item.carbs_g, item.fat_g].some((n) => !Number.isFinite(n) || n < 0)) throw new Error('The image service returned invalid food amounts.');
  }
  return {
    id: newId(),
    createdAt: nowISO(),
    hint: input.hint,
    photoUri: input.photoUri,
    simulated: false,
    provider: `${data.provider ?? 'Server AI'} (${data.model}) via your server`,
    overallConfidence: data.overall_confidence,
    followUpQuestion: data.follow_up_question ?? undefined,
    notes: data.notes ?? [],
    rejectedItems: data.rejected_items,
    restaurant: toRestaurant(data.restaurant),
    items: (data.items ?? []).map((i) => ({
      name: i.name,
      portionLabel: i.portion,
      grams: i.grams,
      calories: Math.round(i.calories),
      proteinG: i.protein_g,
      carbsG: i.carbs_g,
      fatG: i.fat_g,
      confidence: i.confidence,
      portionAssumption: i.portion_assumption,
      reviewRequired: i.review_required,
      source: { kind: i.source_kind, label: i.source_label, url: i.source_url ?? undefined, sourced: i.source_kind !== 'visual_estimate' },
    })),
  };
}

/** Intents the server coach may return; proposals are built locally from them. */
export type CoachIntent =
  | { type: 'short_on_time'; minutes: number }
  | { type: 'pain'; area: string; red_flags: boolean }
  | { type: 'low_energy' }
  | { type: 'goal_change'; goal: string }
  | { type: 'training_days'; days: number }
  | ActionIntent;

function intentPhrase(i: Exclude<CoachIntent, ActionIntent>): string {
  switch (i.type) {
    case 'short_on_time':
      return `I only have ${i.minutes} minutes`;
    case 'pain':
      return `my ${i.area.replace('_', ' ')} hurts${i.red_flags ? ' and is swollen' : ''}`;
    case 'low_energy':
      return 'I am tired';
    case 'goal_change':
      return `I want to switch to ${i.goal.replace('_', ' ')}`;
    case 'training_days':
      return `I can only train ${i.days} days a week now`;
  }
}

const isAction = (i: { type: string }): i is ActionIntent => ACTION_INTENT_TYPES.includes(i.type);

// Same bounds as the server prompt; the app re-validates because the gateway is not trusted blindly.
const coachIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('short_on_time'), minutes: z.number().int().min(10).max(120) }),
  z.object({ type: z.literal('pain'), area: z.enum(['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip', 'ankle', 'neck']), red_flags: z.boolean() }),
  z.object({ type: z.literal('low_energy') }),
  z.object({ type: z.literal('goal_change'), goal: z.enum(['fat_loss', 'muscle_gain', 'strength', 'maintenance']) }),
  z.object({ type: z.literal('training_days'), days: z.number().int().min(1).max(6) }),
]);

/** Builds a pending proposal for a log/edit intent, or null when it is invalid or refers to something missing. */
function actionProposal(state: AppState, raw: ActionIntent, today: ISODate): Proposal | null {
  const i = validateActionIntent(raw); // the app re-validates; the server is not trusted blindly
  if (!i) return null;
  const now = nowISO();
  const base = { id: newId(), status: 'pending' as const, createdAt: now, updatedAt: now, origin: 'coach_chat' as const, expiresOn: today };
  const entryOf = (id: string) => live(state.foodLog).find((e) => e.id === id);
  switch (i.type) {
    case 'log_food': {
      const hour = new Date().getHours();
      const meal = i.meal ?? (hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack');
      const items = i.items.map((it) => ({
        name: it.name, portionLabel: it.grams ? `${it.grams} g` : '1 serving', grams: it.grams, calories: it.calories,
        proteinG: it.protein_g, carbsG: it.carbs_g, fatG: it.fat_g,
        source: { kind: 'visual_estimate' as const, label: 'Estimated by the coach from your message', sourced: false },
      }));
      const kcal = items.reduce((s, it) => s + it.calories, 0);
      const entry = { id: newId(), date: today, meal, items, origin: 'manual' as const, confirmedAt: '', createdAt: now, updatedAt: now };
      return { ...base, kind: 'log_food', scope: 'today', title: `Log ${items.map((it) => it.name).join(', ')}`, summary: `${items.length} item(s) · ${kcal} kcal to ${meal}`, rationale: ['Nothing is saved until you accept.'], change: { type: 'log_food', entry }, dedupeKey: `log-food-${entry.id}` };
    }
    case 'edit_food': {
      const e = entryOf(i.entry_id);
      const item = e?.items[i.item_index];
      if (!e || !item) return null;
      return { ...base, kind: 'edit_food', scope: 'today', title: `Change ${item.name} to ${i.calories} kcal`, summary: `${item.calories} kcal → ${i.calories} kcal. Nothing else changes.`, rationale: ['Only the calories of this item are edited.'], change: { type: 'edit_food', entryId: e.id, itemIndex: i.item_index, calories: i.calories, before: item.calories }, dedupeKey: `edit-food-${e.id}-${i.item_index}-${i.calories}` };
    }
    case 'delete_food': {
      const e = entryOf(i.entry_id);
      if (!e) return null;
      return { ...base, kind: 'delete_food', scope: 'today', title: `Delete ${e.items.map((it) => it.name).join(', ')}`, summary: `Removes this ${e.meal} entry (${e.items.reduce((s, it) => s + it.calories, 0)} kcal).`, rationale: ['The entry is removed only if you accept.'], change: { type: 'delete_food', entryId: e.id }, dedupeKey: `delete-food-${e.id}` };
    }
    case 'log_workout': {
      const sets = i.sets.flatMap((s) => { const ex = findExercise(s.exercise); return ex ? [{ exerciseId: ex.id, weightKg: s.weight_kg, reps: s.reps, rpe: s.rpe }] : []; });
      if (!sets.length || sets.length < i.sets.length) return null; // unknown exercise: drop rather than guess
      return { ...base, kind: 'log_workout', scope: 'today', title: `Log workout${i.name ? `: ${i.name}` : ''}`, summary: `${sets.length} set(s): ${sets.map((s) => `${exerciseName(s.exerciseId)} ${s.reps} × ${s.weightKg} kg`).join(', ')}`, rationale: ['Saved as a finished session only if you accept.'], change: { type: 'log_workout', date: today, sessionId: newId(), name: i.name ?? 'Logged workout', sets }, dedupeKey: `log-workout-${newId()}` };
    }
  }
}

export function proposalsForIntents(state: AppState, intents: CoachIntent[], today: ISODate): Proposal[] {
  return intents.flatMap((i) => {
    if (i && typeof i === 'object' && isAction(i)) {
      const p = actionProposal(state, i, today);
      if (!p) log.warn('coach', `Dropped invalid or stale ${i.type} intent.`);
      return p ? [p] : [];
    }
    const parsed = coachIntentSchema.safeParse(i);
    if (!parsed.success) { log.warn('coach', 'Dropped invalid coach intent.', parsed.error); return []; }
    return simulateCoachReply(state, intentPhrase(parsed.data), today).proposals;
  });
}

/** Compact, privacy-minded summary of the user's data sent to the server coach. */
export function coachContext(state: AppState, today: ISODate) {
  const rem = remainingForDay(state, today);
  const { day } = workoutForDay(state, today);
  const p = state.profile;
  return {
    today,
    goal: p?.goal,
    experience: p?.experience,
    equipment: p?.equipment,
    limitations: p?.limitations.map((l) => l.area),
    diet: p?.dietPreferences,
    units: state.settings.units,
    tone: state.settings.coachTone,
    coach_name: state.settings.coachName,
    food_today: live(state.foodLog).filter((e) => e.date === today).map((e) => ({ id: e.id, meal: e.meal, items: e.items.map((it) => [it.name, it.calories]) })),
    nutrition_today: rem ? { target: rem.target.calories, eaten: rem.eaten.calories, remaining: rem.remaining } : undefined,
    workout_today: day ? { name: day.name, exercises: day.exercises.map((e) => `${exerciseName(e.exerciseId)} ${formatPrescription(e)}`) } : null,
    latest_weight_kg: latestWeight(state)?.weightKg,
    weights_14d: live(state.weights).filter((w) => w.date > addDays(today, -14)).map((w) => [w.date, w.weightKg]),
    sessions_14d: live(state.sessions).filter((s) => s.finishedAt && s.date > addDays(today, -14)).length,
  };
}

export async function coachReply(state: AppState, message: string, today: ISODate): Promise<CoachReply & { simulated: boolean; aiNotice?: string; aiNoticeKind?: AiNoticeKind }> {
  const engine = aiEngine();
  if (engine === 'simulated') {
    await delay(500);
    return { ...simulateCoachReply(state, message, today), simulated: true };
  }
  // Emergencies always get the fixed safety text, never a model's improvisation.
  if (isUrgentSymptom(message) || hasInjuryRedFlag(message)) return { ...simulateCoachReply(state, message, today), simulated: false };
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return { ...simulateCoachReply(state, message, today), simulated: true, aiNotice: SIGNED_OUT, aiNoticeKind: 'signed_out' };
  const history = live(state.chat).slice(-12).map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', content: m.text }));
  try {
    const { data, error } = await sb.functions.invoke('ai', { body: { action: 'coach', message, history, context: coachContext(state, today) } });
    if (error) throw error;
    const d = data as { reply: string; safety: boolean; intents: CoachIntent[] };
    if (!d || typeof d.reply !== 'string') throw new Error('The coach returned an invalid reply.');
    return { text: d.reply, safety: d.safety, proposals: proposalsForIntents(state, d.intents ?? [], today), simulated: false };
  } catch (error) {
    const aiNotice = await functionErrorMessage(error, UNAVAILABLE);
    return { ...simulateCoachReply(state, message, today), simulated: true, aiNotice, aiNoticeKind: aiNotice === UNAVAILABLE ? 'unavailable' : 'other' };
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
