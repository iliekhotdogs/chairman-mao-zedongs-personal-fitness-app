// Shared AI gateway. Deploy with JWT verification enabled.
// Secrets: OPENROUTER_API_KEY, NVIDIA_API_KEY, optional FDC_API_KEY, AI_DAILY_LIMIT,
// AI_GLOBAL_DAILY_LIMIT. Never place the OpenRouter key in Expo env vars.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CHAT_MODELS = [
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
];
const VISION_MODELS = ['meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const safeNumber = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : 0;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';

type Completion = { text: string; input: number; output: number };
async function complete(model: string, messages: unknown[]): Promise<Completion> {
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) throw new Error('OpenRouter is not configured on the server.');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'FitCoach' },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 4096 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('OpenRouter free-model limit reached. Try again later.');
    if (response.status === 401 || response.status === 403) throw new Error('The server OpenRouter key was rejected.');
    throw new Error(`OpenRouter request failed (${response.status}).`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const reply = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? '').join('') : '';
  if (!reply.trim()) throw new Error('The selected model returned an empty reply. Try another model.');
  return { text: reply, input: safeNumber(data.usage?.prompt_tokens, 10_000_000), output: safeNumber(data.usage?.completion_tokens, 10_000_000) };
}

async function nvidiaComplete(model: string, messages: unknown[]): Promise<Completion> {
  const key = Deno.env.get('NVIDIA_API_KEY');
  if (!key) throw new Error('NVIDIA meal-photo AI is not configured on the server.');
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 2500 }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('NVIDIA image-model limit reached. Try again later.');
    if (response.status === 401 || response.status === 403) throw new Error('The server NVIDIA key was rejected.');
    throw new Error(`NVIDIA image request failed (${response.status}).`);
  }
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('The NVIDIA model returned an empty reply.');
  return { text: reply, input: safeNumber(data.usage?.prompt_tokens, 10_000_000), output: safeNumber(data.usage?.completion_tokens, 10_000_000) };
}

function parseObject(reply: string): Record<string, unknown> {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The selected model did not return usable JSON. Try another model.');
  const value = JSON.parse(reply.slice(start, end + 1));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The model returned an invalid reply.');
  return value;
}

function validatedIntents(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).filter((intent) => {
    if (!intent || typeof intent !== 'object') return false;
    if (intent.type === 'short_on_time') return Number.isInteger(intent.minutes) && intent.minutes >= 10 && intent.minutes <= 120;
    if (intent.type === 'training_days') return Number.isInteger(intent.days) && intent.days >= 1 && intent.days <= 6;
    if (intent.type === 'goal_change') return ['fat_loss', 'muscle_gain', 'strength', 'maintenance'].includes(intent.goal);
    if (intent.type === 'pain') return ['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip', 'ankle', 'neck'].includes(intent.area) && typeof intent.red_flags === 'boolean';
    return intent.type === 'low_energy';
  });
}

async function coach(body: Record<string, unknown>) {
  const model = text(body.model, 100);
  if (!CHAT_MODELS.includes(model)) throw new Error('Choose a supported free chat model.');
  const message = text(body.message, 2000);
  if (!message.trim()) throw new Error('Enter a message first.');
  const context = body.context && typeof body.context === 'object' ? JSON.stringify(body.context).slice(0, 6000) : '{}';
  const history = Array.isArray(body.history) ? body.history.slice(-12).map((turn) => ({
    role: turn?.role === 'assistant' ? 'assistant' : 'user', content: text(turn?.content, 2000),
  })) : [];
  if (history.at(-1)?.role === 'user') history.pop();
  while (history.length && history[0].role !== 'user') history.shift();
  const system = [
    'You are FitCoach, a concise fitness and nutrition coach. Respond ONLY with a JSON object: {"reply":string,"safety":boolean,"intents":array}. Keep reply under 150 words.',
    'Never claim to edit a plan or log. Changes require the user to accept a card. Allowed intents: short_on_time {minutes}, pain {area,red_flags}, low_energy, goal_change {goal}, training_days {days}. Use [] when no change is needed.',
    'Do not diagnose injuries, recommend extreme diets, or tell users to train through pain. For chest pain, fainting or trouble breathing, urge emergency medical help and return no intents.',
    `User context: ${context}`,
  ].join('\n');
  const response = await complete(model, [{ role: 'system', content: system }, ...history, { role: 'user', content: message }]);
  const value = parseObject(response.text);
  const reply = text(value.reply, 2000).trim();
  if (!reply) throw new Error('The selected model returned no coach reply.');
  return { result: { reply, safety: value.safety === true, intents: validatedIntents(value.intents) }, tokens: response };
}

type VisionItem = { name: string; portion: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence: string; portion_assumption: string; usda_search_query: string };
async function searchUsda(query: string, pageSize: number) {
  const key = Deno.env.get('FDC_API_KEY') || 'DEMO_KEY';
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pageSize, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] }),
  });
  if (!response.ok) throw new Error(`USDA search failed (${response.status}).`);
  return (await response.json()).foods ?? [];
}

async function usdaItem(item: VisionItem) {
  const food = (await searchUsda(item.usda_search_query || item.name, 1))[0];
  if (!food) return null;
  const nutrient = (numbers: string[]) => food.foodNutrients?.find((n: { nutrientNumber?: string }) => numbers.includes(n.nutrientNumber ?? ''))?.value ?? 0;
  const kcal = nutrient(['208', '957', '958']) * item.grams / 100;
  if (!Number.isFinite(kcal) || kcal <= 0 || (item.calories > 0 && (kcal < item.calories * 0.4 || kcal > item.calories * 2.5))) return null;
  return {
    name: item.name, portion: item.portion, grams: item.grams, calories: Math.round(kcal),
    protein_g: Math.round(nutrient(['203']) * item.grams / 10) / 10,
    carbs_g: Math.round(nutrient(['205']) * item.grams / 10) / 10,
    fat_g: Math.round(nutrient(['204']) * item.grams / 10) / 10,
    confidence: item.confidence, portion_assumption: item.portion_assumption,
    source_kind: 'database', source_label: `USDA FoodData Central #${food.fdcId}: ${food.description}`,
    source_url: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
  };
}

async function estimateFood(body: Record<string, unknown>) {
  const model = text(body.model, 100);
  if (!VISION_MODELS.includes(model)) throw new Error('Choose a supported NVIDIA image model.');
  const hint = text(body.hint, 300);
  const image = body.image as { data?: unknown; mediaType?: unknown } | undefined;
  const data = text(image?.data, 7_000_001);
  const mime = text(image?.mediaType, 30);
  if (!hint && !data) throw new Error('Send a photo or a hint.');
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 7_000_000)) throw new Error('Use a smaller JPEG, PNG, or WebP photo.');
  const content: unknown[] = [{ type: 'text', text: `Food hint: ${hint || '(none)'}. Identify foods, portions and estimate nutrition. Reply ONLY with JSON: {"items":[{"name":string,"portion":string,"grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"confidence":"high"|"medium"|"low","portion_assumption":string,"usda_search_query":string}],"overall_confidence":"high"|"medium"|"low","follow_up_question":string|null,"notes":string[]}. Up to 8 items. Be honest about visual uncertainty.` }];
  if (data) content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } });
  const response = await nvidiaComplete(model, [
    { role: 'system', content: 'You estimate meals from images and hints. A photo cannot reveal exact ingredients or calories. Never invent an official nutrition source.' },
    { role: 'user', content },
  ]);
  const value = parseObject(response.text);
  if (!Array.isArray(value.items)) throw new Error('The model returned an invalid meal estimate.');
  const items = await Promise.all(value.items.slice(0, 8).map(async (raw: Record<string, unknown>) => {
    const item: VisionItem = {
      name: text(raw.name, 100) || 'Unknown food', portion: text(raw.portion, 80) || 'Estimated serving',
      grams: safeNumber(raw.grams, 5000), calories: safeNumber(raw.calories, 10000),
      protein_g: safeNumber(raw.protein_g, 1000), carbs_g: safeNumber(raw.carbs_g, 2000), fat_g: safeNumber(raw.fat_g, 1000),
      confidence: ['high', 'medium', 'low'].includes(String(raw.confidence)) ? String(raw.confidence) : 'low',
      portion_assumption: text(raw.portion_assumption, 200), usda_search_query: text(raw.usda_search_query, 100),
    };
    const sourced = item.grams ? await usdaItem(item).catch(() => null) : null;
    return sourced ?? {
      name: item.name, portion: item.portion, grams: item.grams, calories: item.calories,
      protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g,
      confidence: item.confidence === 'high' ? 'medium' : item.confidence,
      portion_assumption: item.portion_assumption,
      source_kind: 'visual_estimate', source_label: 'Visual estimate (no matching USDA value)', source_url: null,
    };
  }));
  return { result: { items, overall_confidence: ['high', 'medium', 'low'].includes(String(value.overall_confidence)) ? value.overall_confidence : 'low', follow_up_question: text(value.follow_up_question, 200) || null, notes: Array.isArray(value.notes) ? value.notes.slice(0, 3).map((note: unknown) => text(note, 200)) : [], model }, tokens: response };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user || auth.user.is_anonymous) return json({ error: 'Sign in first.' }, 401);
  const raw = await request.text();
  if (raw.length > 7_200_000) return json({ error: 'Request too large.' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  if (body.action === 'search_food') {
    const query = text(body.query, 100).trim();
    if (query.length < 2) return json({ foods: [] });
    const { data: searchClaim, error: searchClaimError } = await admin.rpc('claim_food_search', {
      p_user: auth.user.id, p_day: new Date().toISOString().slice(0, 10),
      p_user_limit: 30, p_global_limit: 500,
    });
    if (searchClaimError) return json({ error: 'Food search metering is not ready. Apply the account SQL setup first.' }, 503);
    if (searchClaim !== 'ok') return json({ error: 'Food search limit reached. Try again tomorrow.' }, 429);
    try {
      const foods = await searchUsda(query, 8);
      const result = foods.map((food: { fdcId: number; description: string; brandOwner?: string; dataType: string; foodNutrients?: { nutrientNumber?: string; value?: number }[] }) => {
        const nutrient = (numbers: string[]) => food.foodNutrients?.find((n) => numbers.includes(n.nutrientNumber ?? ''))?.value ?? 0;
        return { fdcId: food.fdcId, description: food.description, brandOwner: food.brandOwner, dataType: food.dataType,
          per100g: { kcal: nutrient(['208', '957', '958']), p: nutrient(['203']), c: nutrient(['205']), f: nutrient(['204']) } };
      });
      return json({ foods: result });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'USDA search failed.' }, 502); }
  }
  if (body.action !== 'coach' && body.action !== 'estimate_food') return json({ error: 'Unknown action.' }, 400);
  if (body.action === 'coach' && !Deno.env.get('OPENROUTER_API_KEY')) {
    return json({ error: 'OpenRouter is not configured on the server.' }, 503);
  }
  if (body.action === 'estimate_food' && !Deno.env.get('NVIDIA_API_KEY')) {
    return json({ error: 'NVIDIA meal-photo AI is not configured on the server.' }, 503);
  }
  const day = new Date().toISOString().slice(0, 10);
  const { data: claim, error: claimError } = await admin.rpc('claim_ai_request', {
    p_user: auth.user.id, p_day: day,
    p_user_limit: Number(Deno.env.get('AI_DAILY_LIMIT') || 5),
    p_global_limit: Number(Deno.env.get('AI_GLOBAL_DAILY_LIMIT') || 40),
  });
  if (claimError) return json({ error: 'AI metering is not ready. Apply the account SQL setup first.' }, 503);
  if (claim !== 'ok') return json({ error: claim === 'user_limit' ? 'Your daily AI limit is reached.' : 'The shared free AI allowance is used up today. Try tomorrow.' }, 429);
  try {
    const { result, tokens } = body.action === 'coach' ? await coach(body) : await estimateFood(body);
    await admin.rpc('record_ai_tokens', { p_user: auth.user.id, p_day: day, p_input: tokens.input, p_output: tokens.output });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'AI request failed.' }, 502);
  }
});
