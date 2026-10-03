import type { AppState } from '../state';
import type { Confidence, EstimateItem, FoodEstimate, ISODate, Proposal } from '../types';
import { simulateFoodEstimate } from '../nutrition/estimate';
import { isUrgentSymptom, simulateCoachReply, type CoachReply } from '../coaching/coachSim';
import { supabase } from '../sync/supabase';
import { newId } from '../id';
import { nowISO, addDays } from '../dates';
import { remainingForDay, workoutForDay, latestWeight, live } from '../selectors';
import { exerciseName, formatPrescription } from '../workouts/exercises';
import { getApiKey } from './apiKey';
import { NVIDIA_DEFAULT_MODELS, nvidiaCoach, nvidiaEstimateFood } from './nvidia';
import { prepareImageForAI } from './image';

/**
 * Three interchangeable AI back-ends, picked by aiEngine():
 *  - 'nvidia':    the user pasted their own NVIDIA API key in Settings (stored only on this
 *                 device). If NVIDIA fails, the app falls back to the built-in answers.
 *  - 'server':    a Supabase Edge Function that calls the Claude API. The API key stays on
 *                 the server; the app only sends the signed-in user's token.
 *  - 'simulated': no key: pre-determined, rule-based answers built on the device. Free.
 *
 * Whatever the back-end, the AI only *proposes*. Changes are built by deterministic code
 * (so plans stay safe and valid) and applied only after the user accepts them.
 */

export class AIUnavailableError extends Error {}

export type AIEngine = 'nvidia' | 'server' | 'simulated';

/** A saved NVIDIA key always wins; otherwise the Settings choice; otherwise built-in answers. */
export function aiEngine(settings: AppState['settings'], key: string | null = getApiKey()): AIEngine {
  if (key) return 'nvidia';
  return settings.aiMode === 'server' ? 'server' : 'simulated';
}

export function aiModels(settings: AppState['settings']) {
  return { vision: settings.aiModels?.vision || NVIDIA_DEFAULT_MODELS.vision, chat: settings.aiModels?.chat || NVIDIA_DEFAULT_MODELS.chat };
}

const USDA_KEY = process.env.EXPO_PUBLIC_USDA_API_KEY || 'DEMO_KEY';

type FoodInput = { hint?: string; photoUri?: string; photoSize?: { width?: number; height?: number }; followUpAnswered?: boolean };

export async function estimateFood(state: AppState, input: FoodInput): Promise<FoodEstimate> {
  const engine = aiEngine(state.settings);
  if (engine === 'simulated') {
    await delay(700); // let the UI show its loading state realistically
    return simulateFoodEstimate(input);
  }
  if (engine === 'nvidia') {
    const model = aiModels(state.settings).vision;
    try {
      const image = input.photoUri ? await prepareImageForAI(input.photoUri, input.photoSize) : undefined;
      const r = await nvidiaEstimateFood({ key: getApiKey()!, model, hint: input.hint, image, usdaKey: USDA_KEY });
      return { id: newId(), createdAt: nowISO(), hint: input.hint, photoUri: input.photoUri, simulated: false, provider: `NVIDIA (${model})`, ...r };
    } catch (e) {
      return fallbackEstimate(input, e);
    }
  }
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  const image = input.photoUri ? await prepareImageForAI(input.photoUri, input.photoSize).catch(() => undefined) : undefined;
  const { data, error } = await sb.functions.invoke('ai', {
    body: { action: 'estimate_food', hint: input.hint ?? '', image: image ? { data: image.base64, mediaType: image.mediaType } : undefined, units: state.settings.units },
  });
  if (error) throw new AIUnavailableError(`The food estimator is unavailable (${error.message}). You can enter the food manually.`);
  return toEstimate(data, input);
}

/** NVIDIA failed: use the built-in estimate, and say why at the top of the notes. */
function fallbackEstimate(input: FoodInput, e: unknown): FoodEstimate {
  const est = simulateFoodEstimate(input);
  const why = e instanceof Error ? e.message : 'NVIDIA could not be reached.';
  return { ...est, aiNotice: why, notes: [`NVIDIA AI didn't work (${why}) This is the built-in estimate from your hint instead.`, ...est.notes] };
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
    provider: `Claude (${data.model}) via your server`,
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
  const engine = aiEngine(state.settings);
  if (engine === 'simulated') {
    await delay(500);
    return { ...simulateCoachReply(state, message, today), simulated: true };
  }
  // Emergencies always get the fixed safety text, never a model's improvisation.
  if (isUrgentSymptom(message)) return { ...simulateCoachReply(state, message, today), simulated: false };
  if (engine === 'nvidia') {
    try {
      const history = live(state.chat)
        .slice(-13)
        .map((m) => ({ role: (m.role === 'coach' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.text }));
      // the latest user message is sent separately
      if (history.length && history[history.length - 1].role === 'user' && history[history.length - 1].content === message) history.pop();
      const r = await nvidiaCoach({ key: getApiKey()!, model: aiModels(state.settings).chat, message, history, context: coachContext(state, today), tone: state.settings.coachTone });
      return { text: r.reply, safety: r.safety, proposals: proposalsForIntents(state, r.intents, today), simulated: false };
    } catch (e) {
      return { ...simulateCoachReply(state, message, today), simulated: true, aiNotice: e instanceof Error ? e.message : 'NVIDIA could not be reached.' };
    }
  }
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  const history = live(state.chat).slice(-12).map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', content: m.text }));
  const { data, error } = await sb.functions.invoke('ai', { body: { action: 'coach', message, history, context: coachContext(state, today) } });
  if (error) throw new AIUnavailableError(`The coach is unavailable right now (${error.message}).`);
  const d = data as { reply: string; safety: boolean; intents: CoachIntent[] };
  return { text: d.reply, safety: d.safety, proposals: proposalsForIntents(state, d.intents ?? [], today), simulated: false };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
