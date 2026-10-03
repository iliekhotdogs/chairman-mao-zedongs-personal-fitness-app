import { Platform } from 'react-native';

import type { Confidence, EstimateItem, NutritionSourceKind } from '../types';
import { itemFromFdc, searchFdc } from '../nutrition/lookup';

/**
 * NVIDIA API (build.nvidia.com), used when the user saves their own NVIDIA key in Settings.
 * The API is OpenAI-compatible: POST /v1/chat/completions.
 *
 * Two models, chosen separately in Settings:
 *  - vision model: reads meal photos and estimates foods + portions
 *  - chat model:   the coach conversation
 *
 * Open models don't support guaranteed JSON output here, so replies are asked for as JSON,
 * parsed defensively, and validated field by field. Anything invalid is dropped, and the
 * caller falls back to the built-in answers.
 */

export const NVIDIA_DEFAULT_MODELS = {
  vision: 'meta/llama-3.2-90b-vision-instruct',
  chat: 'nvidia/llama-3.1-nemotron-70b-instruct',
} as const;

export const NVIDIA_SUGGESTED_MODELS = {
  vision: ['meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct', 'google/gemma-3-12b-it'],
  chat: ['nvidia/llama-3.1-nemotron-70b-instruct', 'mistralai/mistral-large-2-instruct', 'nvidia/nemotron-3-super-120b-a12b', 'meta/llama-3.2-90b-vision-instruct'],
};

export class NvidiaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const DIRECT = 'https://integrate.api.nvidia.com/v1';

/**
 * NVIDIA's API doesn't allow calls from web pages (no CORS headers), so in the browser the
 * request goes to the Expo dev server's pass-through (metro.config.js). On Android it's direct.
 */
function baseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/__nvidia/v1`;
  return DIRECT;
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type NvMessage = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

export async function nvidiaChat(args: { key: string; model: string; messages: NvMessage[]; maxTokens?: number; temperature?: number; timeoutMs?: number }): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.key.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: args.model, messages: args.messages, max_tokens: args.maxTokens ?? 1024, temperature: args.temperature ?? 0.2, top_p: 0.7, stream: false }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new NvidiaError(
      aborted
        ? 'NVIDIA took too long to answer.'
        : Platform.OS === 'web'
          ? "Couldn't reach NVIDIA. On the web version this only works while the Expo dev server is running (npx expo start)."
          : "Couldn't reach NVIDIA. Check your internet connection.",
    );
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  if (!res.ok) throw new NvidiaError(friendlyStatus(res.status, args.model, raw), res.status);
  let json: { choices?: { message?: { content?: string | null } }[] };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new NvidiaError('NVIDIA sent an unreadable reply.');
  }
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new NvidiaError('NVIDIA sent an empty reply.');
  return stripThinking(content);
}

function friendlyStatus(status: number, model: string, body: string): string {
  const detail = (() => {
    try {
      const j = JSON.parse(body);
      return String(j.detail ?? j.error?.message ?? j.message ?? j.title ?? '').slice(0, 160);
    } catch {
      return body.slice(0, 160);
    }
  })();
  if (status === 401 || status === 403) return 'NVIDIA rejected the API key. Check it in Settings → AI.';
  if (status === 404) return `NVIDIA doesn't offer the model "${model}" to your key. Pick another model in Settings.`;
  if (status === 402) return 'Your NVIDIA account is out of credits.';
  if (status === 429) return 'NVIDIA rate limit reached (or free credits used up). Try again in a minute.';
  if (status >= 500) return `NVIDIA is having problems right now (${status}).`;
  return `NVIDIA error ${status}${detail ? `: ${detail}` : ''}`;
}

/** Some models (reasoning ones) prefix their answer with <think>…</think>. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

/** Pulls the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): Record<string, unknown> {
  const cleaned = stripThinking(text).replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new NvidiaError("The AI reply wasn't in the expected format.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new NvidiaError("The AI reply wasn't in the expected format.");
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testNvidia(key: string, models: { vision: string; chat: string }) {
  const one = async (model: string) => {
    try {
      await nvidiaChat({ key, model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 8, timeoutMs: 30_000 });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const [vision, chat] = await Promise.all([one(models.vision), models.chat === models.vision ? Promise.resolve(null) : one(models.chat)]);
  return { vision, chat: chat ?? vision };
}

// ---------------------------------------------------------------------------
// Food photo / hint estimate
// ---------------------------------------------------------------------------

const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

interface VisionItem {
  name: string;
  restaurant: string | null;
  portion: string;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: Confidence;
  portion_assumption: string;
  usda_search_query: string;
}

export interface NvidiaFoodResult {
  items: EstimateItem[];
  overallConfidence: Confidence;
  followUpQuestion?: string;
  notes: string[];
}

const FOOD_INSTRUCTIONS = `You estimate food and portion sizes for a calorie-tracking app, from a meal photo and/or a short user hint.
Use the hint and the photo together. For each food give a realistic portion in grams and your nutrition estimate for that portion.
Be honest about uncertainty: photos cannot show hidden oil, sauces or portion depth. Use "low" confidence when unsure.
If a restaurant chain is identifiable, set "restaurant", otherwise null.
If one key detail is missing (size, sauce, brand), ask ONE short follow_up_question, otherwise null.
Reply with ONLY a JSON object, no other text, in exactly this shape:
{"items":[{"name":"Grilled chicken breast","restaurant":null,"portion":"1 palm-size piece","grams":120,"calories":198,"protein_g":37,"carbs_g":0,"fat_g":4.3,"confidence":"medium","portion_assumption":"About the size of a palm, 2 cm thick","usda_search_query":"chicken breast roasted"}],"overall_confidence":"medium","follow_up_question":null,"notes":["Short note about assumptions"]}
"usda_search_query" is a short generic USDA food search term. "notes" has at most 3 short sentences.`;

export async function nvidiaEstimateFood(args: {
  key: string;
  model: string;
  hint?: string;
  image?: { base64: string; mediaType: string };
  usdaKey: string;
}): Promise<NvidiaFoodResult> {
  const hint = (args.hint ?? '').slice(0, 300);
  const text = `${FOOD_INSTRUCTIONS}\n\nUser hint: ${hint || '(none)'}${args.image ? '' : '\nThere is no photo; estimate from the hint only.'}`;
  const dataUrl = args.image ? `data:${args.image.mediaType};base64,${args.image.base64}` : undefined;

  // Llama 3.2 Vision doesn't accept a system prompt alongside an image, so everything goes in the user turn.
  const ask = (content: NvMessage['content']) => nvidiaChat({ key: args.key, model: args.model, messages: [{ role: 'user', content }], maxTokens: 1500, temperature: 0.1 });
  let reply: string;
  if (!dataUrl) reply = await ask(text);
  else {
    try {
      reply = await ask([{ type: 'text', text }, { type: 'image_url', image_url: { url: dataUrl } }]);
    } catch (e) {
      // Some NVIDIA-hosted vision models only accept the older inline <img> form.
      if (!(e instanceof NvidiaError) || (e.status !== 400 && e.status !== 422)) throw e;
      reply = await ask(`${text}\n<img src="${dataUrl}" />`);
    }
  }

  const parsed = parseFoodJson(extractJson(reply));
  if (!parsed.items.length && !parsed.follow_up_question) throw new NvidiaError("The AI couldn't identify any food.");

  const items = await Promise.all(parsed.items.slice(0, 8).map((it) => sourceItem(it, args.usdaKey)));
  return {
    items,
    overallConfidence: parsed.overall_confidence,
    followUpQuestion: parsed.follow_up_question ?? undefined,
    notes: parsed.notes,
  };
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v) : NaN);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const conf = (v: unknown): Confidence => (CONFIDENCES.includes(v as Confidence) ? (v as Confidence) : 'low');

/** Validates the model's JSON. Items with missing/absurd numbers are dropped. */
export function parseFoodJson(j: Record<string, unknown>): { items: VisionItem[]; overall_confidence: Confidence; follow_up_question: string | null; notes: string[] } {
  const rawItems = Array.isArray(j.items) ? j.items : [];
  const items: VisionItem[] = [];
  for (const r of rawItems as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const it = {
      name: str(r.name),
      restaurant: str(r.restaurant) || null,
      portion: str(r.portion, '1 portion') || '1 portion',
      grams: num(r.grams),
      calories: num(r.calories),
      protein_g: num(r.protein_g),
      carbs_g: num(r.carbs_g),
      fat_g: num(r.fat_g),
      confidence: conf(r.confidence),
      portion_assumption: str(r.portion_assumption, 'Portion estimated by the AI.') || 'Portion estimated by the AI.',
      usda_search_query: str(r.usda_search_query) || str(r.name),
    };
    const sane = it.name && it.calories >= 0 && it.calories <= 3000 && [it.protein_g, it.carbs_g, it.fat_g].every((x) => x >= 0 && x <= 400);
    if (!sane) continue;
    if (!(it.grams > 0 && it.grams <= 3000)) it.grams = NaN;
    items.push(it);
  }
  const follow = str(j.follow_up_question);
  return {
    items,
    overall_confidence: conf(j.overall_confidence),
    follow_up_question: follow && follow.toLowerCase() !== 'null' ? follow : null,
    notes: (Array.isArray(j.notes) ? j.notes : []).filter((n): n is string => typeof n === 'string' && !!n.trim()).slice(0, 3),
  };
}

/** Swap the AI's visual guess for USDA values when a sensible match exists; otherwise keep the guess, labelled. */
async function sourceItem(it: VisionItem, usdaKey: string): Promise<EstimateItem> {
  const visual: EstimateItem = {
    name: it.name,
    portionLabel: it.portion,
    grams: isFinite(it.grams) ? Math.round(it.grams) : undefined,
    calories: Math.round(it.calories),
    proteinG: Math.round(it.protein_g * 10) / 10,
    carbsG: Math.round(it.carbs_g * 10) / 10,
    fatG: Math.round(it.fat_g * 10) / 10,
    confidence: it.confidence === 'high' ? 'medium' : it.confidence, // a visual guess is never "high"
    portionAssumption: it.portion_assumption,
    source: {
      kind: 'visual_estimate' as NutritionSourceKind,
      sourced: false,
      label: it.restaurant
        ? `Visual estimate by AI. Check ${it.restaurant}'s official nutrition info for exact values.`
        : 'Visual estimate by AI (no nutrition database match)',
    },
  };
  if (it.restaurant || !isFinite(it.grams)) return visual;
  try {
    const results = (await searchFdc(it.usda_search_query, usdaKey)).filter((r) => r.dataType !== 'Branded' && r.per100g.kcal > 0);
    const best = results[0];
    if (!best) return visual;
    const sourced = itemFromFdc(best, it.grams, it.portion);
    // If the database match disagrees wildly with what the AI saw, it's probably the wrong food.
    if (it.calories > 0 && (sourced.calories > it.calories * 2.5 || sourced.calories < it.calories * 0.4)) return visual;
    return { ...sourced, name: it.name, confidence: it.confidence, portionAssumption: `${it.portion_assumption} Nutrition per gram from USDA "${best.description}".` };
  } catch {
    return visual; // USDA unavailable or rate-limited
  }
}

// ---------------------------------------------------------------------------
// Coach chat
// ---------------------------------------------------------------------------

const AREAS = ['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip', 'ankle', 'neck'];
const GOALS = ['fat_loss', 'muscle_gain', 'strength', 'maintenance'];

export type NvidiaIntent =
  | { type: 'short_on_time'; minutes: number }
  | { type: 'pain'; area: string; red_flags: boolean }
  | { type: 'low_energy' }
  | { type: 'goal_change'; goal: string }
  | { type: 'training_days'; days: number };

export function coachSystemPrompt(context: unknown, tone: 'supportive' | 'direct'): string {
  const who = tone === 'direct' ? 'a direct, no-nonsense trainer: short sentences, no fluff' : 'a warm, supportive coach who briefly explains why';
  return [
    `You are FitCoach, ${who}. You help with nutrition, training and consistency, using the user's data below.`,
    'Rules:',
    '- Be concise (under 150 words) and practical. Use the numbers in the data.',
    '- Never claim you changed anything. If a change would help, describe it and add the matching intent; the app shows the user an Accept/Decline card.',
    '- Pain or injury: do not diagnose. Advise stopping movements that hurt; suggest a physiotherapist or doctor for persistent pain or red flags (swelling, numbness, sharp pain, a pop, cannot bear weight).',
    '- Never recommend extreme diets, under about 1,200 kcal/day, dehydration, or training through sharp pain. If the user mentions disordered eating, respond with care and suggest professional support.',
    '- Calorie and wearable numbers are estimates; say so when relevant.',
    'Reply with ONLY a JSON object, no other text:',
    '{"reply": "your message to the user", "safety": false, "intents": []}',
    '"safety" is true when the reply contains injury, pain or medical safety guidance.',
    'Allowed intents (only include one when it clearly matches what the user said):',
    '{"type":"short_on_time","minutes":20} | {"type":"pain","area":"knee|lower_back|shoulder|wrist|elbow|hip|ankle|neck","red_flags":false} | {"type":"low_energy"} | {"type":"goal_change","goal":"fat_loss|muscle_gain|strength|maintenance"} | {"type":"training_days","days":3}',
    `User data (JSON): ${JSON.stringify(context).slice(0, 6000)}`,
  ].join('\n');
}

/** Validates intents from the model; anything unknown or out of range is dropped. */
export function parseIntents(raw: unknown): NvidiaIntent[] {
  if (!Array.isArray(raw)) return [];
  const out: NvidiaIntent[] = [];
  for (const i of raw as Record<string, unknown>[]) {
    if (!i || typeof i !== 'object') continue;
    const n = (v: unknown) => Math.round(num(v));
    if (i.type === 'short_on_time' && n(i.minutes) >= 5 && n(i.minutes) <= 180) out.push({ type: 'short_on_time', minutes: n(i.minutes) });
    else if (i.type === 'pain' && AREAS.includes(String(i.area))) out.push({ type: 'pain', area: String(i.area), red_flags: i.red_flags === true });
    else if (i.type === 'low_energy') out.push({ type: 'low_energy' });
    else if (i.type === 'goal_change' && GOALS.includes(String(i.goal))) out.push({ type: 'goal_change', goal: String(i.goal) });
    else if (i.type === 'training_days' && n(i.days) >= 1 && n(i.days) <= 7) out.push({ type: 'training_days', days: n(i.days) });
  }
  return out.slice(0, 2);
}

export async function nvidiaCoach(args: {
  key: string;
  model: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  context: unknown;
  tone: 'supportive' | 'direct';
}): Promise<{ reply: string; safety: boolean; intents: NvidiaIntent[] }> {
  const history = args.history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (history.length && history[0].role !== 'user') history.shift();
  const text = await nvidiaChat({
    key: args.key,
    model: args.model,
    messages: [{ role: 'system', content: coachSystemPrompt(args.context, args.tone) }, ...history, { role: 'user', content: args.message.slice(0, 2000) }],
    maxTokens: 900,
    temperature: 0.4,
  });
  try {
    const j = extractJson(text);
    const reply = str(j.reply);
    if (!reply) throw new NvidiaError('empty');
    return { reply, safety: j.safety === true, intents: parseIntents(j.intents) };
  } catch {
    // The model answered in plain text instead of JSON: use it as the reply, with no suggested changes.
    const plain = stripThinking(text);
    if (!plain || plain.startsWith('{')) throw new NvidiaError("The AI reply wasn't in the expected format.");
    return { reply: plain, safety: false, intents: [] };
  }
}
