// Shared AI gateway. Deploy with JWT verification enabled.
// The admin picks the provider, models, limits and kill switch in app_config
// (see the admin screen). Keys are Edge Function secrets only: GROQ_API_KEY,
// GEMINI_API_KEY, NVIDIA_API_KEY; optional FDC_API_KEY. Never place them in Expo env vars.
import type { User } from 'npm:@supabase/supabase-js@2';
import { admin, profileOf, requestUser } from '../_shared/auth.ts';
import { BodyError, clientIp, json as jsonFor, preflight, readJsonBody, utcDay } from '../_shared/http.ts';
import { findModel, modelLabel, PROVIDERS, resolveConfig, type AiConfig } from '../_shared/providers.ts';

const safeNumber = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : 0;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';
const MAX_BODY_BYTES = 7_200_000;
const AI_OFF = 'Coach AI is switched off by the app owner right now. Built-in answers still work.';

/** Keyed SHA-256 of the client IP, so the per-IP table never stores raw addresses.
 * Keyed with the service-role key (server-only); null when the IP is unknown. */
async function ipHash(request: Request): Promise<string | null> {
  const ip = clientIp(request);
  if (ip === 'unknown') return null;
  const secret = new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'fitcoach');
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadConfig(): Promise<AiConfig> {
  const { data, error } = await admin.from('app_config').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('AI configuration is not ready. Apply the latest SQL migration first.');
  return resolveConfig(data);
}

type Completion = { text: string; input: number; output: number };
async function complete(config: AiConfig, kind: 'chat' | 'vision', messages: unknown[], maxTokens: number): Promise<Completion> {
  const info = PROVIDERS[config.provider];
  const model = kind === 'chat' ? config.chat_model : config.vision_model;
  const modelInfo = findModel(kind === 'chat' ? info.chatModels : info.visionModels, model);
  const key = Deno.env.get(info.keyEnv);
  if (!key) throw new Error(`${info.label} is not configured on the server.`);
  const response = await fetch(info.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens, ...info.extra, ...modelInfo?.extra }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    console.error(`${info.label} ${response.status} for ${model}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
    if (response.status === 429) throw new Error(`${info.label} rate limit reached. Try again in a minute.`);
    if (response.status === 401 || response.status === 403) throw new Error(`The server ${info.label} key was rejected. Check ${info.keyEnv} in Supabase.`);
    if (response.status === 404) throw new Error(`${info.label} doesn't offer "${model}" to this key.`);
    throw new Error(`${info.label} request failed (${response.status}).`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  // Reasoning models may inline their thinking; only the answer after it is used.
  const reply = (typeof content === 'string' ? content : '').replace(/<think>[\s\S]*?<\/think>/g, '');
  if (!reply.trim()) throw new Error('The model returned an empty reply. Try again.');
  return { text: reply, input: safeNumber(data.usage?.prompt_tokens, 10_000_000), output: safeNumber(data.usage?.completion_tokens, 10_000_000) };
}

const FOOD_INSTRUCTIONS = `You estimate food and portion sizes for a calorie-tracking app, from a meal photo and/or a short user hint.
Use the hint and the photo together. For each food give a realistic portion in grams and your nutrition estimate for that portion.
Be honest about uncertainty: photos cannot show hidden oil, sauces or portion depth. Use "low" confidence when unsure.
If one key detail is missing (size, sauce, brand), ask ONE short follow_up_question, otherwise null.
Reply with ONLY a JSON object, no other text, in exactly this shape:
{"items":[{"name":"Grilled chicken breast","portion":"1 palm-size piece","grams":120,"calories":198,"protein_g":37,"carbs_g":0,"fat_g":4.3,"confidence":"medium","portion_assumption":"About the size of a palm, 2 cm thick","usda_search_query":"chicken breast roasted"}],"overall_confidence":"medium","follow_up_question":null,"notes":["Short note about assumptions"]}
Up to 8 items. "usda_search_query" is a short generic USDA food search term. "notes" has at most 3 short sentences.`;

function parseObject(reply: string): Record<string, unknown> {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The selected model did not return usable JSON. Try again.');
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

// Older app builds still send a "model" field; it is ignored. The admin picks the model.
async function coach(config: AiConfig, body: Record<string, unknown>) {
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
    'Never claim to edit a plan or log. Changes require the user to accept a card. Each intent is a flat object with a "type" field, exactly one of: {"type":"short_on_time","minutes":10-120}, {"type":"pain","area":"knee"|"lower_back"|"shoulder"|"wrist"|"elbow"|"hip"|"ankle"|"neck","red_flags":boolean}, {"type":"low_energy"}, {"type":"goal_change","goal":"fat_loss"|"muscle_gain"|"strength"|"maintenance"}, {"type":"training_days","days":1-6}. Use [] when no change is needed.',
    'Do not diagnose injuries, recommend extreme diets, or tell users to train through pain. For chest pain, fainting or trouble breathing, urge emergency medical help and return no intents.',
    `User context: ${context}`,
  ].join('\n');
  const response = await complete(config, 'chat', [{ role: 'system', content: system }, ...history, { role: 'user', content: message }], 4096);
  const value = parseObject(response.text);
  const reply = text(value.reply, 2000).trim();
  if (!reply) throw new Error('The selected model returned no coach reply.');
  return { result: { reply, safety: value.safety === true, intents: validatedIntents(value.intents) }, tokens: response };
}

type VisionItem = { name: string; portion: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence: string; portion_assumption: string; usda_search_query: string };
async function searchUsda(query: string, pageSize: number) {
  const key = Deno.env.get('FDC_API_KEY') || 'DEMO_KEY';
  // The key goes in a header so it never appears in URLs or proxy logs.
  const response = await fetch('https://api.nal.usda.gov/fdc/v1/foods/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
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

async function estimateFood(config: AiConfig, body: Record<string, unknown>) {
  const hint = text(body.hint, 300);
  const image = body.image as { data?: unknown; mediaType?: unknown } | undefined;
  const data = text(image?.data, 7_000_001);
  const mime = text(image?.mediaType, 30);
  if (!hint && !data) throw new Error('Send a photo or a hint.');
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 7_000_000)) throw new Error('Use a smaller JPEG, PNG, or WebP photo.');
  const prompt = `${FOOD_INSTRUCTIONS}\n\nUser hint: ${hint || '(none)'}${data ? '' : '\nThere is no photo; estimate from the hint only.'}`;
  const content = data ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }] : prompt;
  // Groq's free tier allows 1000 output tokens per minute for its vision model, and max_tokens counts against it.
  const response = await complete(config, 'vision', [{ role: 'user', content }], PROVIDERS[config.provider].visionMaxTokens);
  let value: Record<string, unknown>;
  try {
    value = parseObject(response.text.replace(/```(?:json)?/gi, ''));
  } catch (error) {
    console.error(`Unusable ${config.vision_model} reply: ${response.text.slice(0, 500)}`);
    throw error;
  }
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
  return { result: { items, overall_confidence: ['high', 'medium', 'low'].includes(String(value.overall_confidence)) ? value.overall_confidence : 'low', follow_up_question: text(value.follow_up_question, 200) || null, notes: Array.isArray(value.notes) ? value.notes.slice(0, 3).map((note: unknown) => text(note, 200)) : [], model: config.vision_model, provider: PROVIDERS[config.provider].label }, tokens: response };
}

async function aiInfo(user: User) {
  const config = await loadConfig();
  const { data } = await admin.from('ai_usage').select('requests').eq('user_id', user.id).eq('day', utcDay()).maybeSingle();
  return {
    enabled: config.ai_enabled && Boolean(Deno.env.get(PROVIDERS[config.provider].keyEnv)),
    provider: config.provider,
    providerLabel: PROVIDERS[config.provider].label,
    chatModel: config.chat_model,
    chatModelLabel: modelLabel(config.provider, config.chat_model),
    visionModel: config.vision_model,
    visionModelLabel: modelLabel(config.provider, config.vision_model),
    perUserDailyLimit: config.per_user_daily_limit,
    usedToday: data?.requests ?? 0,
  };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);
  const user = await requestUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  // Invite-created accounts are confirmed at creation; older self-signups must confirm by email.
  if (!user.email_confirmed_at) return json({ error: 'Confirm your email address first, then sign in again.' }, 403);
  const profile = await profileOf(user.id);
  if (profile.disabled) return json({ error: 'This account is disabled. Contact the app owner.' }, 403);
  let body: Record<string, unknown>;
  try { body = await readJsonBody(request, MAX_BODY_BYTES); } catch (error) {
    return error instanceof BodyError ? json({ error: error.message }, error.status) : json({ error: 'Invalid request.' }, 400);
  }
  if (body.action === 'info') {
    try { return json(await aiInfo(user)); } catch (error) { return json({ error: error instanceof Error ? error.message : 'AI info unavailable.' }, 503); }
  }
  if (body.action === 'search_food') {
    const query = text(body.query, 100).trim();
    if (query.length < 2) return json({ foods: [] });
    const { data: searchClaim, error: searchClaimError } = await admin.rpc('claim_food_search', {
      p_user: user.id, p_day: utcDay(),
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

  let config: AiConfig;
  try { config = await loadConfig(); } catch (error) { return json({ error: error instanceof Error ? error.message : 'AI is not ready.' }, 503); }
  if (!config.ai_enabled) return json({ error: AI_OFF }, 503);
  const info = PROVIDERS[config.provider];
  if (!Deno.env.get(info.keyEnv)) return json({ error: `${info.label} is not configured on the server.` }, 503);

  const day = utcDay();
  // Per-network cap first (0 = off). Requests with no known client IP skip it; the
  // per-user and global caps below still apply.
  const ip = config.per_ip_daily_limit > 0 ? await ipHash(request) : null;
  if (ip) {
    const { data: ipAllowed, error: ipError } = await admin.rpc('claim_ai_ip_request', { p_ip_hash: ip, p_day: day, p_limit: config.per_ip_daily_limit });
    if (ipError) return json({ error: 'AI metering is not ready. Apply the latest SQL migration first.' }, 503);
    if (!ipAllowed) return json({ error: 'Too many AI requests from this network today. Try again tomorrow.' }, 429);
  }
  const releaseIp = async () => {
    if (!ip) return;
    const { error } = await admin.rpc('release_ai_ip_request', { p_ip_hash: ip, p_day: day });
    if (error) console.error(`IP quota release failed: ${error.message}`);
  };

  const { data: claim, error: claimError } = await admin.rpc('claim_ai_request', {
    p_user: user.id, p_day: day,
    p_user_limit: config.per_user_daily_limit,
    p_global_limit: config.global_daily_limit,
  });
  if (claimError || claim !== 'ok') await releaseIp();
  if (claimError) return json({ error: 'AI metering is not ready. Apply the account SQL setup first.' }, 503);
  // A limit of 0 also switches AI off.
  if (claim === 'disabled') return json({ error: AI_OFF }, 503);
  if (claim !== 'ok') return json({ error: claim === 'user_limit' ? 'Your daily AI limit is reached.' : 'The shared free AI allowance is used up today. Try tomorrow.' }, 429);
  try {
    const { result, tokens } = body.action === 'coach' ? await coach(config, body) : await estimateFood(config, body);
    await admin.rpc('record_ai_tokens', { p_user: user.id, p_day: day, p_input: tokens.input, p_output: tokens.output });
    return json(result);
  } catch (error) {
    // A failed or unusable provider reply does not use up the user's allowance.
    const { error: releaseError } = await admin.rpc('release_ai_request', { p_user: user.id, p_day: day });
    if (releaseError) console.error(`Quota release failed: ${releaseError.message}`);
    await releaseIp();
    return json({ error: error instanceof Error ? error.message : 'AI request failed.' }, 502);
  }
});
