// Supabase Edge Function: AI features for FitCoach.
//   POST { action: 'estimate_food', hint, image?: { data, mediaType }, units }
//   POST { action: 'coach', message, history, context }
//
// Secrets (set with `supabase secrets set ...`, never in the app):
//   ANTHROPIC_API_KEY   — Claude API key (billed per use by Anthropic)
//   FDC_API_KEY         — free USDA FoodData Central key (optional; DEMO_KEY otherwise)
//   AI_DAILY_LIMIT      — max AI requests per user per day (default 60)
//
// The AI only proposes. The app shows every estimate/suggestion for review, and the
// app's own code applies changes only after the user accepts them.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const MODEL = 'claude-opus-5-5';
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 60);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // 1. Authenticate the caller (only signed-in users can spend AI credits)
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'Not signed in' }, 401);
  const userId = auth.user.id;

  // 2. Per-user daily limit (cost control)
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabaseAdmin.from('ai_usage').select('requests,input_tokens,output_tokens').eq('user_id', userId).eq('day', today).maybeSingle();
  if ((usage?.requests ?? 0) >= DAILY_LIMIT) return json({ error: 'Daily AI limit reached. Try again tomorrow.' }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  try {
    let result: unknown;
    let tokens = { input: 0, output: 0 };
    if (body.action === 'estimate_food') ({ result, tokens } = await estimateFood(body));
    else if (body.action === 'coach') ({ result, tokens } = await coach(body));
    else return json({ error: 'Unknown action' }, 400);

    await supabaseAdmin.from('ai_usage').upsert(
      { user_id: userId, day: today, requests: (usage?.requests ?? 0) + 1, input_tokens: (usage?.input_tokens ?? 0) + tokens.input, output_tokens: (usage?.output_tokens ?? 0) + tokens.output },
      { onConflict: 'user_id,day' },
    );
    return json(result);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'AI is busy, please retry shortly.' }, 503);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'Server AI key is not configured.' }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `AI error (${e.status})` }, 502);
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Shared: one structured-output request with refusal fallbacks enabled
// ---------------------------------------------------------------------------

async function structured<T>(args: { system: string; content: Anthropic.Beta.BetaContentBlockParam[] | string; schema: Record<string, unknown>; effort: 'low' | 'medium' | 'high'; history?: Anthropic.Beta.BetaMessageParam[] }) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: args.system,
    output_config: { effort: args.effort, format: { type: 'json_schema', schema: args.schema } },
    messages: [...(args.history ?? []), { role: 'user', content: args.content }],
  };
  // deno-lint-ignore no-explicit-any
  const res = await anthropic.beta.messages.create(params as any);
  if (res.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  if (res.stop_reason === 'max_tokens') throw new Error('The AI response was cut off.');
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Empty AI response');
  return { value: JSON.parse(text.text) as T, tokens: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}

// ---------------------------------------------------------------------------
// Food photo estimate
// ---------------------------------------------------------------------------

const FOOD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'overall_confidence', 'follow_up_question', 'notes'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'restaurant', 'portion', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence', 'portion_assumption', 'usda_search_query'],
        properties: {
          name: { type: 'string' },
          restaurant: { type: ['string', 'null'], description: 'Restaurant chain if identifiable, else null' },
          portion: { type: 'string' },
          grams: { type: 'number' },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          portion_assumption: { type: 'string' },
          usda_search_query: { type: 'string', description: 'Short generic USDA search term, e.g. "chicken breast roasted"' },
        },
      },
    },
    overall_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    follow_up_question: { type: ['string', 'null'] },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

interface VisionItem {
  name: string; restaurant: string | null; portion: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  confidence: 'high' | 'medium' | 'low'; portion_assumption: string; usda_search_query: string;
}

async function estimateFood(body: Record<string, unknown>) {
  const hint = String(body.hint ?? '').slice(0, 300);
  const image = body.image as { data: string; mediaType: string } | undefined;
  if (!hint && !image) throw new Error('Send a photo or a hint.');
  if (image && image.data.length > 7_000_000) throw new Error('Photo is too large.');

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: image.data } });
  content.push({ type: 'text', text: `User hint: ${hint || '(none)'}\nIdentify each food and estimate the portion and nutrition.` });

  const system = [
    'You estimate food and portion sizes from a meal photo and a short user hint, for a calorie-tracking app.',
    'Use the hint and the photo together. Give a realistic portion in grams for each item and your visual nutrition estimate.',
    'Be honest about uncertainty: photos cannot reveal exact calories (hidden oil, sauces, portion depth). Use "low" confidence when unsure.',
    'If the restaurant or a specific menu item is identifiable, set "restaurant". If a key detail is missing (size, sauce, brand), ask ONE short follow_up_question; otherwise null.',
    'Notes: at most 3 short sentences about assumptions.',
  ].join('\n');

  const vision = await structured<{ items: VisionItem[]; overall_confidence: string; follow_up_question: string | null; notes: string[] }>({ system, content, schema: FOOD_SCHEMA, effort: 'medium' });
  let tokens = vision.tokens;

  // Replace visual guesses with sourced values where possible.
  const items = [];
  for (const it of vision.value.items.slice(0, 8)) {
    let sourced: Record<string, unknown> | null = null;
    if (it.restaurant) {
      const r = await officialRestaurantNutrition(it).catch(() => null);
      if (r) {
        sourced = r.item;
        tokens = { input: tokens.input + r.tokens.input, output: tokens.output + r.tokens.output };
      }
    }
    if (!sourced) sourced = await usdaNutrition(it).catch(() => null);
    items.push(
      sourced ?? {
        name: it.name, portion: it.portion, grams: it.grams, calories: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g,
        confidence: it.confidence === 'high' ? 'medium' : it.confidence, portion_assumption: it.portion_assumption,
        source_kind: 'visual_estimate', source_label: 'Visual estimate by AI (no nutrition source found)', source_url: null,
      },
    );
  }
  return { result: { items, overall_confidence: vision.value.overall_confidence, follow_up_question: vision.value.follow_up_question, notes: vision.value.notes, model: MODEL }, tokens };
}

/** Official restaurant nutrition via Claude's web search, restricted to an official-source answer. */
async function officialRestaurantNutrition(it: VisionItem) {
  const params = {
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    system: 'Find OFFICIAL nutrition facts published by the restaurant itself (its website or official nutrition PDF). Never use third-party estimates. Reply with ONLY a JSON object: {"found": boolean, "item": string, "serving": string, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "url": string}. If no official source is found, reply {"found": false}.',
    messages: [{ role: 'user', content: `${it.restaurant}: ${it.name} (${it.portion})` }],
  };
  // deno-lint-ignore no-explicit-any
  const res = await anthropic.beta.messages.create(params as any);
  if (res.stop_reason === 'refusal') return null;
  const text = [...res.content].reverse().find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  const m = text.text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  if (!j.found || !j.url || typeof j.calories !== 'number') return null;
  return {
    item: {
      name: `${j.item} (${it.restaurant})`, portion: j.serving, grams: it.grams, calories: j.calories, protein_g: j.protein_g, carbs_g: j.carbs_g, fat_g: j.fat_g,
      confidence: 'high', portion_assumption: `Assumed one standard serving (${j.serving}) as listed by the restaurant.`,
      source_kind: 'official_restaurant', source_label: `Official ${it.restaurant} nutrition information`, source_url: j.url,
    },
    tokens: { input: res.usage.input_tokens, output: res.usage.output_tokens },
  };
}

/** Generic foods: USDA FoodData Central values per 100 g, scaled to the estimated portion. */
async function usdaNutrition(it: VisionItem) {
  const key = Deno.env.get('FDC_API_KEY') ?? 'DEMO_KEY';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${encodeURIComponent(it.usda_search_query)}&pageSize=3&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.foods?.[0];
  if (!f) return null;
  const get = (nums: string[]) => f.foodNutrients.find((n: { nutrientNumber?: string }) => n.nutrientNumber && nums.includes(n.nutrientNumber))?.value ?? 0;
  const k = it.grams / 100;
  const kcal = get(['208', '957', '958']);
  if (!kcal) return null;
  return {
    name: it.name, portion: it.portion, grams: it.grams,
    calories: Math.round(kcal * k), protein_g: Math.round(get(['203']) * k * 10) / 10, carbs_g: Math.round(get(['205']) * k * 10) / 10, fat_g: Math.round(get(['204']) * k * 10) / 10,
    confidence: it.confidence, portion_assumption: it.portion_assumption,
    source_kind: 'database', source_label: `USDA FoodData Central #${f.fdcId}: ${f.description} (per-gram values; portion estimated from photo)`,
    source_url: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
  };
}

// ---------------------------------------------------------------------------
// Coach chat
// ---------------------------------------------------------------------------

const COACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'safety', 'intents'],
  properties: {
    reply: { type: 'string' },
    safety: { type: 'boolean', description: 'true when the reply contains injury/pain/medical safety guidance' },
    intents: {
      type: 'array',
      description: 'Structured changes the app may OFFER the user (never applied automatically).',
      items: {
        anyOf: [
          { type: 'object', additionalProperties: false, required: ['type', 'minutes'], properties: { type: { const: 'short_on_time' }, minutes: { type: 'integer' } } },
          { type: 'object', additionalProperties: false, required: ['type', 'area', 'red_flags'], properties: { type: { const: 'pain' }, area: { type: 'string', enum: ['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip', 'ankle', 'neck'] }, red_flags: { type: 'boolean' } } },
          { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'low_energy' } } },
          { type: 'object', additionalProperties: false, required: ['type', 'goal'], properties: { type: { const: 'goal_change' }, goal: { type: 'string', enum: ['fat_loss', 'muscle_gain', 'strength', 'maintenance'] } } },
          { type: 'object', additionalProperties: false, required: ['type', 'days'], properties: { type: { const: 'training_days' }, days: { type: 'integer' } } },
        ],
      },
    },
  },
};

async function coach(body: Record<string, unknown>) {
  const context = body.context as Record<string, unknown>;
  const tone = context?.tone === 'direct' ? 'a direct, no-nonsense trainer: short sentences, no fluff' : 'a warm, supportive coach who briefly explains why';
  const system = [
    `You are FitCoach, ${tone}. You help with nutrition, training and consistency, using the user's data below.`,
    'Rules:',
    '- Be concise (under 150 words) and practical. Use the numbers in the context.',
    '- Never claim a change has been made. If a change would help, describe it and add the matching intent; the app shows an Accept/Decline card.',
    '- Pain or injury: do not diagnose. Advise stopping movements that hurt, suggest seeing a physiotherapist/doctor for persistent pain or red flags (swelling, numbness, sharp pain, a pop, cannot bear weight). For chest pain, fainting or trouble breathing: tell them to stop and seek urgent medical care, and return no intents.',
    '- Never recommend extreme diets, under ~1,200 kcal/day, dehydration, or training through sharp pain. If the user mentions disordered eating, respond with care and suggest professional support.',
    '- Calorie and wearable numbers are estimates; say so when relevant.',
    `User data (JSON): ${JSON.stringify(context).slice(0, 6000)}`,
  ].join('\n');
  const history = ((body.history as { role: 'user' | 'assistant'; content: string }[]) ?? []).slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  // the latest user message is sent separately; drop it from history if the app included it
  if (history.length && history[history.length - 1].role === 'user') history.pop();
  while (history.length && history[0].role !== 'user') history.shift();
  const { value, tokens } = await structured<{ reply: string; safety: boolean; intents: unknown[] }>({ system, content: String(body.message ?? '').slice(0, 2000), schema: COACH_SCHEMA, effort: 'low', history });
  return { result: value, tokens };
}
