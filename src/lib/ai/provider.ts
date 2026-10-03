import type { AppState } from '../state';
import type { Confidence, EstimateItem, FoodEstimate, ISODate, Proposal } from '../types';
import { simulateFoodEstimate } from '../nutrition/estimate';
import { isUrgentSymptom, simulateCoachReply, type CoachReply } from '../coaching/coachSim';
import { isSupabaseConfigured, supabase } from '../sync/supabase';
import { newId } from '../id';
import { nowISO, addDays } from '../dates';
import { remainingForDay, workoutForDay, latestWeight, live } from '../selectors';
import { exerciseName, formatPrescription } from '../workouts/exercises';
import { getApiKey, getGeminiKey } from './apiKey';
import { NVIDIA_DEFAULT_MODELS } from './nvidia';
import { GEMINI_DEFAULT_MODEL } from './gemini';
import { prepareImageForAI } from './image';
import { selectedChatModel } from './openrouterModels';

/** Signed-in accounts use the owner's server-side NVIDIA key (and OpenRouter for chat when set).
 * Without Supabase, the app offers built-in answers. AI only proposes changes. */

export class AIUnavailableError extends Error {}

/** supabase-js reports any non-2xx as a generic message; the gateway's own reason is in the body. */
async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) return body.error;
  }
  return error instanceof Error ? error.message : fallback;
}

export type AIEngine = 'nvidia' | 'gemini' | 'server' | 'simulated';

/** In the account build, calls go through the authenticated Supabase gateway. */
export function aiEngine(settings: AppState['settings'], key: string | null = getApiKey()): AIEngine {
  void settings; void key;
  return isSupabaseConfigured() ? 'server' : 'simulated';
}

export function chatEngine(settings: AppState['settings'], key: string | null = getGeminiKey()): AIEngine {
  void settings; void key;
  return isSupabaseConfigured() ? 'server' : 'simulated';
}

export function geminiModel(settings: AppState['settings']): string {
  return settings.geminiModel || GEMINI_DEFAULT_MODEL;
}

export function aiModels(settings: AppState['settings']) {
  return { vision: settings.aiModels?.vision || NVIDIA_DEFAULT_MODELS.vision, chat: settings.aiModels?.chat || NVIDIA_DEFAULT_MODELS.chat };
}

type FoodInput = { hint?: string; photoUri?: string; photoSize?: { width?: number; height?: number }; followUpAnswered?: boolean };

export async function estimateFood(state: AppState, input: FoodInput): Promise<FoodEstimate> {
  const engine = aiEngine(state.settings);
  if (engine === 'simulated') {
    await delay(700); // let the UI show its loading state realistically
    return simulateFoodEstimate(input);
  }
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  try {
    const image = input.photoUri ? await prepareImageForAI(input.photoUri, input.photoSize) : undefined;
    const { data, error } = await sb.functions.invoke('ai', {
      body: { action: 'estimate_food', hint: input.hint ?? '', image: image ? { data: image.base64, mediaType: image.mediaType } : undefined, units: state.settings.units, model: aiModels(state.settings).vision },
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
    confidence: Confidence; portion_assumption: string; source_kind: EstimateItem['source']['kind']; source_label: string; source_url?: string | null;
  }[];
  overall_confidence: Confidence;
  follow_up_question?: string | null;
  notes: string[];
  model: string;
}

function toEstimate(data: ServerEstimate, input: { hint?: string; photoUri?: string }): FoodEstimate {
  return {
    id: newId(),
    createdAt: nowISO(),
    hint: input.hint,
    photoUri: input.photoUri,
    simulated: false,
    provider: `NVIDIA (${data.model}) via your server`,
    overallConfidence: data.overall_confidence,
    followUpQuestion: data.follow_up_question ?? undefined,
    notes: data.notes ?? [],
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
  | { type: 'training_days'; days: number };

function intentPhrase(i: CoachIntent): string {
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

export function proposalsForIntents(state: AppState, intents: CoachIntent[], today: ISODate): Proposal[] {
  return intents.flatMap((i) => simulateCoachReply(state, intentPhrase(i), today).proposals);
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
    nutrition_today: rem ? { target: rem.target.calories, eaten: rem.eaten.calories, remaining: rem.remaining } : undefined,
    workout_today: day ? { name: day.name, exercises: day.exercises.map((e) => `${exerciseName(e.exerciseId)} ${formatPrescription(e)}`) } : null,
    latest_weight_kg: latestWeight(state)?.weightKg,
    weights_14d: live(state.weights).filter((w) => w.date > addDays(today, -14)).map((w) => [w.date, w.weightKg]),
    sessions_14d: live(state.sessions).filter((s) => s.finishedAt && s.date > addDays(today, -14)).length,
  };
}

export async function coachReply(state: AppState, message: string, today: ISODate): Promise<CoachReply & { simulated: boolean; aiNotice?: string }> {
  const engine = chatEngine(state.settings);
  if (engine === 'simulated') {
    await delay(500);
    return { ...simulateCoachReply(state, message, today), simulated: true };
  }
  // Emergencies always get the fixed safety text, never a model's improvisation.
  if (isUrgentSymptom(message)) return { ...simulateCoachReply(state, message, today), simulated: false };
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  const history = live(state.chat).slice(-12).map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', content: m.text }));
  try {
    const { data, error } = await sb.functions.invoke('ai', { body: { action: 'coach', message, history, context: coachContext(state, today), model: selectedChatModel(state.settings.openRouterChatModel) } });
    if (error) throw error;
    const d = data as { reply: string; safety: boolean; intents: CoachIntent[] };
    if (!d || typeof d.reply !== 'string') throw new Error('The coach returned an invalid reply.');
    return { text: d.reply, safety: d.safety, proposals: proposalsForIntents(state, d.intents ?? [], today), simulated: false };
  } catch (error) {
    return { ...simulateCoachReply(state, message, today), simulated: true, aiNotice: await functionErrorMessage(error, 'The chat service is unavailable.') };
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
