// Shared AI gateway. Deploy with JWT verification enabled.
// The admin picks the provider, models, limits and kill switch in app_config
// (see the admin screen). Keys are Edge Function secrets only: GROQ_API_KEY,
// GEMINI_API_KEY, NVIDIA_API_KEY; optional FDC_API_KEY. Never place them in Expo env vars.
import type { User } from 'npm:@supabase/supabase-js@2.117.2';
import { admin, profileOf, requestUser } from '../_shared/auth.ts';
import { BodyError, clientIpHash, json as jsonFor, preflight, readJsonBody, utcDay } from '../_shared/http.ts';
import { matchingFood, validateVisionItem, type VisionItem } from './foodValidation.ts';
import { findModel, modelLabel, PROVIDERS, resolveConfig, type AiConfig } from '../_shared/providers.ts';

const safeNumber = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : 0;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';
const MAX_BODY_BYTES = 7_200_000;
const AI_OFF = 'Coach AI is switched off by the app owner right now. Built-in answers still work.';
// Client-facing failure text is deliberately generic: it never names the provider,
// model, status code or secret. Details go to the function logs (Supabase dashboard
// → Edge Functions → ai → Logs), which only the project owner can read.
const AI_UNAVAILABLE = 'Coach AI is not available right now. Built-in answers still work; try again later.';
const AI_BUSY = 'Coach AI is busy right now. Try again in a minute.';
const AI_NO_ANSWER = 'Coach AI did not respond in time. Try again.';
const AI_UNUSABLE = 'Coach AI sent an answer that could not be used. Try again, or rephrase your request.';

/** A failure with a safe message for the client. `status` is the HTTP status to return. */
class AiError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/** `counted`: the request reached the provider in a way that keeps the quota claim.
 * Quota is refunded only while this is false. Once a provider returns 2xx, tokens were
 * spent, so an unusable reply still counts against the user's allowance (and its token
 * usage is recorded); otherwise anyone could make the model produce unparseable output
 * on purpose and get unlimited provider calls for free. */
type Meter = { counted: boolean; input: number; output: number };

async function loadConfig(): Promise<AiConfig> {
  const { data, error } = await admin.from('app_config').select('*').eq('id', 1).maybeSingle();
  if (error) throw new AiError('AI configuration is not ready. Apply the latest SQL migration first.', 503);
  return resolveConfig(data);
}

type Completion = { text: string; input: number; output: number };
async function complete(config: AiConfig, meter: Meter, kind: 'chat' | 'vision', messages: unknown[], maxTokens: number): Promise<Completion> {
  const info = PROVIDERS[config.provider];
  const model = kind === 'chat' ? config.chat_model : config.vision_model;
  const modelInfo = findModel(kind === 'chat' ? info.chatModels : info.visionModels, model);
  const key = Deno.env.get(info.keyEnv);
  if (!key) {
    console.error(`${info.keyEnv} is not set; the ${info.label} provider cannot be used.`);
    throw new AiError(AI_UNAVAILABLE, 503);
  }
  let response: Response;
  try {
    response = await fetch(info.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens, ...info.extra, ...modelInfo?.extra }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    // Network failure or timeout before any response: nothing was billed.
    console.error(`${info.label} request for ${model} failed before a response: ${error}`);
    throw new AiError(AI_NO_ANSWER, 504);
  }
  if (!response.ok) {
    // Rejected requests are not billed by the providers we use. Outages, rate limits
    // and our own configuration problems (bad key, unknown model) are refunded; a
    // request the provider rejects as malformed (400, 413, 422, ...) is caused by the
    // caller's input, so it keeps the quota claim. Otherwise crafted input could hit
    // the provider without limit.
    const ourFault = response.status === 429 || response.status >= 500 || [401, 403, 404, 408].includes(response.status);
    if (!ourFault) meter.counted = true;
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    const hint = response.status === 401 || response.status === 403 ? ` (check the ${info.keyEnv} secret)`
      : response.status === 404 ? ` (model "${model}" not offered to this key)` : '';
    console.error(`${info.label} ${response.status} for ${model}${hint}: ${detail}`);
    throw new AiError(response.status === 429 ? AI_BUSY : AI_UNAVAILABLE, response.status === 429 ? 429 : 502);
  }
  // From here on the provider has done (and billed) the work.
  meter.counted = true;
  let data: { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  try {
    data = await response.json();
  } catch (error) {
    console.error(`${info.label} returned unreadable JSON for ${model}: ${error}`);
    throw new AiError(AI_UNUSABLE);
  }
  meter.input = safeNumber(data.usage?.prompt_tokens, 10_000_000);
  meter.output = safeNumber(data.usage?.completion_tokens, 10_000_000);
  const content = data.choices?.[0]?.message?.content;
  // Reasoning models may inline their thinking; only the answer after it is used.
  const reply = (typeof content === 'string' ? content : '').replace(/<think>[\s\S]*?<\/think>/g, '');
  if (!reply.trim()) {
    console.error(`${info.label} returned an empty reply for ${model}.`);
    throw new AiError(AI_UNUSABLE);
  }
  return { text: reply, input: meter.input, output: meter.output };
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
  if (start < 0 || end <= start) throw new AiError(AI_UNUSABLE);
  let value: unknown;
  try { value = JSON.parse(reply.slice(start, end + 1)); } catch { throw new AiError(AI_UNUSABLE); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiError(AI_UNUSABLE);
  return value as Record<string, unknown>;
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
async function coach(config: AiConfig, meter: Meter, body: Record<string, unknown>) {
  const message = text(body.message, 2000);
  if (!message.trim()) throw new AiError('Enter a message first.', 400);
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
  const response = await complete(config, meter, 'chat', [{ role: 'system', content: system }, ...history, { role: 'user', content: message }], 4096);
  let value: Record<string, unknown>;
  try {
    value = parseObject(response.text);
  } catch (error) {
    console.error(`Unusable ${config.chat_model} coach reply (${response.text.length} chars).`);
    throw error;
  }
  const reply = text(value.reply, 2000).trim();
  if (!reply) {
    console.error(`${config.chat_model} returned no "reply" field.`);
    throw new AiError(AI_UNUSABLE);
  }
  return { result: { reply, safety: value.safety === true, intents: validatedIntents(value.intents) }, tokens: response };
}

async function searchUsda(query: string, pageSize: number) {
  const key = Deno.env.get('FDC_API_KEY') || 'DEMO_KEY';
  // The key goes in a header so it never appears in URLs or proxy logs.
  const response = await fetch('https://api.nal.usda.gov/fdc/v1/foods/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
    body: JSON.stringify({ query, pageSize, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] }),
  });
  if (!response.ok) {
    console.error(`USDA search ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
    throw new AiError('Food search is not available right now. Try again later.', 502);
  }
  return (await response.json()).foods ?? [];
}

async function usdaItem(item: VisionItem) {
  const food = matchingFood(item, await searchUsda(item.usda_search_query || item.name, 8));
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
    review_required: false,
    source_kind: 'database', source_label: `USDA FoodData Central #${food.fdcId}: ${food.description}`,
    source_url: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
  };
}

async function estimateFood(config: AiConfig, meter: Meter, body: Record<string, unknown>) {
  const hint = text(body.hint, 300);
  const image = body.image as { data?: unknown; mediaType?: unknown } | undefined;
  const data = text(image?.data, 7_000_001);
  const mime = text(image?.mediaType, 30);
  if (!hint && !data) throw new AiError('Send a photo or a hint.', 400);
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 7_000_000)) throw new AiError('Use a smaller JPEG, PNG, or WebP photo.', 400);
  const prompt = `${FOOD_INSTRUCTIONS}\n\nUser hint: ${hint || '(none)'}${data ? '' : '\nThere is no photo; estimate from the hint only.'}`;
  const content = data ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }] : prompt;
  // Groq's free tier allows 1000 output tokens per minute for its vision model, and max_tokens counts against it.
  const response = await complete(config, meter, 'vision', [{ role: 'user', content }], PROVIDERS[config.provider].visionMaxTokens);
  let value: Record<string, unknown>;
  try {
    value = parseObject(response.text.replace(/```(?:json)?/gi, ''));
  } catch (error) {
    console.error(`Unusable ${config.vision_model} reply: ${response.text.slice(0, 500)}`);
    throw error;
  }
  if (!Array.isArray(value.items)) {
    console.error(`${config.vision_model} meal estimate has no items array.`);
    throw new AiError(AI_UNUSABLE);
  }
  const validated = value.items.slice(0, 8).map(validateVisionItem);
  const rejected = validated.filter((item) => item === null).length;
  if (validated.every((item) => item === null)) throw new AiError('The model returned no usable food portions. Please correct the meal manually.', 502);
  const items = await Promise.all(validated.filter((item): item is VisionItem => item !== null).map(async (item) => {
    const sourced = item.review_required ? null : await usdaItem(item).catch(() => null);
    return sourced ?? {
      name: item.name, portion: item.portion, grams: item.grams, calories: item.calories,
      protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g,
      confidence: item.confidence === 'high' ? 'medium' : item.confidence,
      portion_assumption: item.portion_assumption,
      review_required: Boolean(item.review_required),
      source_kind: 'visual_estimate', source_label: 'Visual estimate (no matching USDA value)', source_url: null,
    };
  }));
  const notes = Array.isArray(value.notes) ? value.notes.slice(0, 3).map((note: unknown) => text(note, 200)) : [];
  if (rejected) notes.unshift(`${rejected} food item(s) had invalid portions or nutrition and were left out. Add them manually.`);
  if (items.some((item) => item.review_required)) notes.unshift('An implausible item needs correction before logging.');
  const low = rejected || items.some((item) => item.review_required);
  return { result: { items, rejected_items: rejected, overall_confidence: low ? 'low' : ['high', 'medium', 'low'].includes(String(value.overall_confidence)) ? value.overall_confidence : 'low', follow_up_question: text(value.follow_up_question, 200) || null, notes, model: config.vision_model, provider: PROVIDERS[config.provider].label }, tokens: response };
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
    } catch (error) {
      if (!(error instanceof AiError)) console.error(`USDA search failed: ${error}`);
      return json({ error: error instanceof AiError ? error.message : 'Food search is not available right now. Try again later.' }, 502);
    }
  }
  if (body.action !== 'coach' && body.action !== 'estimate_food') return json({ error: 'Unknown action.' }, 400);

  let config: AiConfig;
  try { config = await loadConfig(); } catch (error) { return json({ error: error instanceof AiError ? error.message : 'AI is not ready.' }, 503); }
  if (!config.ai_enabled) return json({ error: AI_OFF }, 503);
  const info = PROVIDERS[config.provider];
  if (!Deno.env.get(info.keyEnv)) {
    console.error(`${info.keyEnv} is not set; the ${info.label} provider cannot be used.`);
    return json({ error: AI_UNAVAILABLE }, 503);
  }

  const day = utcDay();
  // Per-network cap first (0 = off). Requests with no known client IP skip it; the
  // per-user and global caps below still apply.
  const ip = config.per_ip_daily_limit > 0 ? await clientIpHash(request) : null;
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
  if (claim !== 'ok') return json({ error: claim === 'user_limit' ? "You have used today's AI coach allowance. It resets tomorrow." : 'The AI coach has hit its daily limit. Please try again tomorrow.' }, 429);
  const meter: Meter = { counted: false, input: 0, output: 0 };
  const recordTokens = async () => {
    const { error } = await admin.rpc('record_ai_tokens', { p_user: user.id, p_day: day, p_input: meter.input, p_output: meter.output });
    if (error) console.error(`Token record failed: ${error.message}`);
  };
  try {
    const { result } = body.action === 'coach' ? await coach(config, meter, body) : await estimateFood(config, meter, body);
    await recordTokens();
    return json(result);
  } catch (error) {
    if (!(error instanceof AiError)) console.error(`AI request failed: ${error instanceof Error ? error.stack ?? error.message : error}`);
    const message = error instanceof AiError ? error.message : AI_UNAVAILABLE;
    const status = error instanceof AiError ? error.status : 502;
    if (meter.counted) {
      // The provider answered (and billed us), so the request counts: no refund.
      await recordTokens();
      return json({ error: message }, status);
    }
    // Never reached a billed provider call (bad input, missing key, network error,
    // timeout, 429/5xx/4xx): give the user's, global and network quota back.
    const { error: releaseError } = await admin.rpc('release_ai_request', { p_user: user.id, p_day: day });
    if (releaseError) console.error(`Quota release failed: ${releaseError.message}`);
    await releaseIp();
    return json({ error: message }, status);
  }
});
