// AI provider registry and admin-config validation. Pure TypeScript with no
// Deno or npm imports, so Jest can test it (src/lib/__tests__/aiRegistry.test.ts).
// This is the single source of truth for provider URLs and model allowlists.

export type ProviderId = 'groq' | 'gemini' | 'nvidia';

export interface ModelInfo {
  id: string;
  label: string;
  /** Extra request-body fields for this model (e.g. turning thinking off). */
  extra?: Record<string, unknown>;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  url: string;
  /** Name of the Supabase Edge Function secret holding the key. */
  keyEnv: string;
  chatModels: ModelInfo[];
  visionModels: ModelInfo[];
  /** Output-token cap for meal-photo replies (Groq's free tier is strict). */
  visionMaxTokens: number;
  /** Extra request-body fields for every call to this provider. */
  extra?: Record<string, unknown>;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    // Verified 2026-10 against console.groq.com/docs/models and /docs/vision.
    chatModels: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B' },
    ],
    // The only Groq model that accepts images (preview tier; max 3 images, 20 MB per request).
    visionModels: [{ id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B' }],
    visionMaxTokens: 900,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    // Google's OpenAI-compatible endpoint; same request shape as Groq.
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyEnv: 'GEMINI_API_KEY',
    // Verified 2026-10 against ai.google.dev/gemini-api/docs/models and /pricing.
    // gemini-2.5-pro was dropped: Google now limits the 2.5 family to existing users.
    chatModels: [
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    ],
    // Every Gemini model reads images; the OpenAI-compatible endpoint accepts base64 data URIs.
    visionModels: [
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    ],
    visionMaxTokens: 4096,
    // Keeps "thinking" short so it does not eat the reply allowance. The OpenAI-compatible
    // endpoint maps reasoning_effort to thinking_level (3.x); thinking cannot be fully off on 3.x.
    extra: { reasoning_effort: 'low' },
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    keyEnv: 'NVIDIA_API_KEY',
    // Verified 2026-10 against the live catalog (GET integrate.api.nvidia.com/v1/models) and
    // docs.api.nvidia.com. kimi-k2-instruct and llama-3.3-70b-instruct are no longer in that
    // catalog. Thinking is switched off where the chat template supports it; <think> blocks are stripped anyway.
    chatModels: [
      { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', extra: { chat_template_kwargs: { thinking: false } } },
      { id: 'deepseek-ai/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', extra: { chat_template_kwargs: { thinking: false, enable_thinking: false } } },
      { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', extra: { chat_template_kwargs: { enable_thinking: false } } },
    ],
    visionModels: [
      { id: 'meta/llama-3.2-90b-vision-instruct', label: 'Llama 3.2 90B Vision' },
      { id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision' },
      { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', extra: { chat_template_kwargs: { thinking: false } } },
    ],
    visionMaxTokens: 2048,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export interface AiConfig {
  provider: ProviderId;
  chat_model: string;
  vision_model: string;
  per_user_daily_limit: number;
  global_daily_limit: number;
  /** AI requests per client IP per UTC day across all accounts. 0 = no per-IP cap. */
  per_ip_daily_limit: number;
  ai_enabled: boolean;
}

export const DEFAULT_CONFIG: AiConfig = {
  provider: 'groq',
  chat_model: PROVIDERS.groq.chatModels[0].id,
  vision_model: PROVIDERS.groq.visionModels[0].id,
  per_user_daily_limit: 30,
  global_daily_limit: 500,
  per_ip_daily_limit: 100,
  ai_enabled: true,
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value);
}

export function findModel(models: ModelInfo[], id: string): ModelInfo | undefined {
  return models.find((model) => model.id === id);
}

/** Turns a stored (possibly stale or partial) row into a usable config. Models
 * that no longer belong to the provider fall back to its first model. */
export function resolveConfig(row: Partial<Record<keyof AiConfig, unknown>> | null | undefined): AiConfig {
  const provider = isProviderId(row?.provider) ? row.provider : DEFAULT_CONFIG.provider;
  const info = PROVIDERS[provider];
  const chat = typeof row?.chat_model === 'string' && findModel(info.chatModels, row.chat_model) ? row.chat_model : info.chatModels[0].id;
  const vision = typeof row?.vision_model === 'string' && findModel(info.visionModels, row.vision_model) ? row.vision_model : info.visionModels[0].id;
  const limit = (value: unknown, fallback: number) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fallback);
  return {
    provider,
    chat_model: chat,
    vision_model: vision,
    per_user_daily_limit: limit(row?.per_user_daily_limit, DEFAULT_CONFIG.per_user_daily_limit),
    global_daily_limit: limit(row?.global_daily_limit, DEFAULT_CONFIG.global_daily_limit),
    per_ip_daily_limit: limit(row?.per_ip_daily_limit, DEFAULT_CONFIG.per_ip_daily_limit),
    ai_enabled: typeof row?.ai_enabled === 'boolean' ? row.ai_enabled : DEFAULT_CONFIG.ai_enabled,
  };
}

export type ConfigResult = { ok: true; config: AiConfig } | { ok: false; error: string };

/** Validates an admin's change against the current config. Strict: unknown
 * providers, models outside the provider's allowlist and bad limits are rejected. */
export function validateConfigUpdate(current: AiConfig, patch: Record<string, unknown>): ConfigResult {
  const next: AiConfig = { ...current };
  if (patch.provider !== undefined) {
    if (!isProviderId(patch.provider)) return { ok: false, error: 'Unknown AI provider.' };
    if (patch.provider !== current.provider) {
      // Switching provider resets models to that provider's defaults unless given.
      next.provider = patch.provider;
      next.chat_model = PROVIDERS[patch.provider].chatModels[0].id;
      next.vision_model = PROVIDERS[patch.provider].visionModels[0].id;
    }
  }
  const info = PROVIDERS[next.provider];
  if (patch.chat_model !== undefined) {
    if (typeof patch.chat_model !== 'string' || !findModel(info.chatModels, patch.chat_model)) {
      return { ok: false, error: `${info.label} does not offer that chat model.` };
    }
    next.chat_model = patch.chat_model;
  }
  if (patch.vision_model !== undefined) {
    if (typeof patch.vision_model !== 'string' || !findModel(info.visionModels, patch.vision_model)) {
      return { ok: false, error: `${info.label} does not offer that photo model.` };
    }
    next.vision_model = patch.vision_model;
  }
  if (patch.per_user_daily_limit !== undefined) {
    const value = patch.per_user_daily_limit;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) return { ok: false, error: 'Per-user limit must be a whole number from 0 to 10,000.' };
    next.per_user_daily_limit = value as number;
  }
  if (patch.global_daily_limit !== undefined) {
    const value = patch.global_daily_limit;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) return { ok: false, error: 'Global limit must be a whole number from 0 to 1,000,000.' };
    next.global_daily_limit = value as number;
  }
  if (patch.per_ip_daily_limit !== undefined) {
    const value = patch.per_ip_daily_limit;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100_000) return { ok: false, error: 'Per-network limit must be a whole number from 0 to 100,000.' };
    next.per_ip_daily_limit = value as number;
  }
  if (patch.ai_enabled !== undefined) {
    if (typeof patch.ai_enabled !== 'boolean') return { ok: false, error: 'ai_enabled must be true or false.' };
    next.ai_enabled = patch.ai_enabled;
  }
  return { ok: true, config: next };
}

/** Public description of the registry for the admin screen. Never includes keys. */
export function describeRegistry(hasKey: (keyEnv: string) => boolean) {
  return PROVIDER_IDS.map((id) => {
    const info = PROVIDERS[id];
    return {
      id,
      label: info.label,
      keyEnv: info.keyEnv,
      keySet: hasKey(info.keyEnv),
      chatModels: info.chatModels.map(({ id: modelId, label }) => ({ id: modelId, label })),
      visionModels: info.visionModels.map(({ id: modelId, label }) => ({ id: modelId, label })),
    };
  });
}

export function modelLabel(provider: ProviderId, id: string): string {
  const info = PROVIDERS[provider];
  return (findModel(info.chatModels, id) ?? findModel(info.visionModels, id))?.label ?? id;
}
