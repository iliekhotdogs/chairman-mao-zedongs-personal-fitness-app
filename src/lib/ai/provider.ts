import type { AppState } from '../state';
import type { Confidence, EstimateItem, FoodEstimate, ISODate, Proposal } from '../types';
import { simulateFoodEstimate } from '../nutrition/estimate';
import { simulateCoachReply, type CoachReply } from '../coaching/coachSim';
import { supabase } from '../sync/supabase';
import { newId } from '../id';
import { nowISO, addDays } from '../dates';
import { remainingForDay, workoutForDay, latestWeight, live } from '../selectors';
import { exerciseName } from '../workouts/exercises';

/**
 * Two interchangeable AI back-ends:
 *  - 'simulated': runs on the device, free, clearly labelled. Used for the prototype.
 *  - 'server': a Supabase Edge Function that calls the Claude API. The API key stays on
 *    the server; the app only sends the signed-in user's token.
 *
 * Whatever the back-end, the AI only *proposes*. Changes are built by deterministic code
 * (so plans stay safe and valid) and applied only after the user accepts them.
 */

export class AIUnavailableError extends Error {}

export async function estimateFood(state: AppState, input: { hint?: string; photoUri?: string; photoBase64?: string; mediaType?: string }): Promise<FoodEstimate> {
  if (state.settings.aiMode !== 'server') {
    await delay(700); // let the UI show its loading state realistically
    return simulateFoodEstimate(input);
  }
  const sb = supabase();
  if (!sb) throw new AIUnavailableError('Server AI is not configured. Switch to simulated mode in Settings.');
  const { data, error } = await sb.functions.invoke('ai', {
    body: { action: 'estimate_food', hint: input.hint ?? '', image: input.photoBase64 ? { data: input.photoBase64, mediaType: input.mediaType ?? 'image/jpeg' } : undefined, units: state.settings.units },
  });
  if (error) throw new AIUnavailableError(`The food estimator is unavailable (${error.message}). You can enter the food manually.`);
  return toEstimate(data, input);
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
    workout_today: day ? { name: day.name, exercises: day.exercises.map((e) => `${exerciseName(e.exerciseId)} ${e.sets}×${e.repMin}-${e.repMax}`) } : null,
    latest_weight_kg: latestWeight(state)?.weightKg,
    weights_14d: live(state.weights).filter((w) => w.date > addDays(today, -14)).map((w) => [w.date, w.weightKg]),
    sessions_14d: live(state.sessions).filter((s) => s.finishedAt && s.date > addDays(today, -14)).length,
  };
}

export async function coachReply(state: AppState, message: string, today: ISODate): Promise<CoachReply & { simulated: boolean }> {
  if (state.settings.aiMode !== 'server') {
    await delay(500);
    return { ...simulateCoachReply(state, message, today), simulated: true };
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
