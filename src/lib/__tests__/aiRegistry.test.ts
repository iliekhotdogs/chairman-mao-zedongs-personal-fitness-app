import { DEFAULT_CONFIG, describeRegistry, PROVIDER_IDS, PROVIDERS, resolveConfig, validateConfigUpdate } from '../../../supabase/functions/_shared/providers';

describe('AI provider registry', () => {
  it('has groq, gemini and nvidia with chat and vision models', () => {
    expect(PROVIDER_IDS.sort()).toEqual(['gemini', 'groq', 'nvidia']);
    for (const id of PROVIDER_IDS) {
      const info = PROVIDERS[id];
      expect(info.url).toMatch(/^https:\/\/.+\/chat\/completions$/);
      expect(info.keyEnv).toMatch(/_API_KEY$/);
      expect(info.chatModels.length).toBeGreaterThan(0);
      expect(info.visionModels.length).toBeGreaterThan(0);
    }
    expect(PROVIDERS.gemini.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(PROVIDERS.nvidia.chatModels.some((model) => /kimi/i.test(model.id))).toBe(true);
  });

  // Ids verified against the providers' model catalogs in 2026-10 (see docs/AI_PROVIDER.md).
  // Changing a list is deliberate: update the doc and re-verify the ids when this fails.
  it('lists only the verified model ids', () => {
    const ids = (models: { id: string }[]) => models.map((model) => model.id);
    expect(ids(PROVIDERS.groq.chatModels)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
    expect(ids(PROVIDERS.groq.visionModels)).toEqual(['qwen/qwen3.8-27b']);
    expect(ids(PROVIDERS.gemini.chatModels)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite']);
    expect(ids(PROVIDERS.gemini.visionModels)).toEqual(ids(PROVIDERS.gemini.chatModels));
    expect(ids(PROVIDERS.nvidia.chatModels)).toEqual(['moonshotai/kimi-k2.6', 'deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-3-super-120b-a12b']);
    expect(ids(PROVIDERS.nvidia.visionModels)).toEqual(['meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct', 'moonshotai/kimi-k2.6']);
    // Gemini's OpenAI-compatible endpoint accepts reasoning_effort (minimal/low/medium/high).
    expect(PROVIDERS.gemini.extra).toEqual({ reasoning_effort: 'low' });
    // Gemini 2.5 Pro is limited to existing users, so it must not be offered to new keys.
    expect(ids(PROVIDERS.gemini.chatModels)).not.toContain('gemini-2.5-pro');
  });

  it('defaults to the current Groq setup', () => {
    expect(DEFAULT_CONFIG).toMatchObject({ provider: 'groq', chat_model: 'openai/gpt-oss-120b', vision_model: 'qwen/qwen3.8-27b', per_user_daily_limit: 5, global_daily_limit: 40, per_ip_daily_limit: 100, ai_enabled: true });
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it('repairs stale stored rows', () => {
    const resolved = resolveConfig({ provider: 'gemini', chat_model: 'openai/gpt-oss-120b', vision_model: 'nope', per_user_daily_limit: -1, ai_enabled: false });
    expect(resolved.provider).toBe('gemini');
    expect(resolved.chat_model).toBe(PROVIDERS.gemini.chatModels[0].id);
    expect(resolved.vision_model).toBe(PROVIDERS.gemini.visionModels[0].id);
    expect(resolved.per_user_daily_limit).toBe(5);
    expect(resolved.ai_enabled).toBe(false);
    expect(resolveConfig({ provider: 'openrouter' }).provider).toBe('groq');
  });

  it('switching provider resets models to that provider', () => {
    const result = validateConfigUpdate(DEFAULT_CONFIG, { provider: 'nvidia' });
    expect(result).toEqual({ ok: true, config: { ...DEFAULT_CONFIG, provider: 'nvidia', chat_model: PROVIDERS.nvidia.chatModels[0].id, vision_model: PROVIDERS.nvidia.visionModels[0].id } });
  });

  it('accepts a provider with its own models in one update', () => {
    const result = validateConfigUpdate(DEFAULT_CONFIG, { provider: 'gemini', chat_model: 'gemini-3.5-flash-lite', vision_model: 'gemini-3.8-flash' });
    expect(result.ok && result.config).toMatchObject({ provider: 'gemini', chat_model: 'gemini-3.5-flash-lite', vision_model: 'gemini-3.8-flash' });
  });

  it('rejects models from another provider', () => {
    expect(validateConfigUpdate(DEFAULT_CONFIG, { chat_model: 'gemini-3.8-flash' })).toEqual({ ok: false, error: 'Groq does not offer that chat model.' });
    expect(validateConfigUpdate(DEFAULT_CONFIG, { provider: 'gemini', vision_model: 'qwen/qwen3.8-27b' }).ok).toBe(false);
    // Only the vision allowlist counts for photos.
    expect(validateConfigUpdate(DEFAULT_CONFIG, { vision_model: 'openai/gpt-oss-120b' }).ok).toBe(false);
  });

  it('rejects unknown providers and bad limits', () => {
    expect(validateConfigUpdate(DEFAULT_CONFIG, { provider: 'openai' }).ok).toBe(false);
    expect(validateConfigUpdate(DEFAULT_CONFIG, { per_user_daily_limit: 2.5 }).ok).toBe(false);
    expect(validateConfigUpdate(DEFAULT_CONFIG, { global_daily_limit: -1 }).ok).toBe(false);
    expect(validateConfigUpdate(DEFAULT_CONFIG, { ai_enabled: 'no' }).ok).toBe(false);
    expect(validateConfigUpdate(DEFAULT_CONFIG, { per_ip_daily_limit: 100_001 }).ok).toBe(false);
    expect(validateConfigUpdate(DEFAULT_CONFIG, { per_ip_daily_limit: '50' }).ok).toBe(false);
    const result = validateConfigUpdate(DEFAULT_CONFIG, { per_user_daily_limit: 0, global_daily_limit: 100, ai_enabled: false });
    expect(result.ok && result.config).toMatchObject({ per_user_daily_limit: 0, global_daily_limit: 100, ai_enabled: false });
  });

  it('keeps the per-IP limit configurable, with 0 meaning no per-IP cap', () => {
    expect(resolveConfig({ per_ip_daily_limit: 0 }).per_ip_daily_limit).toBe(0);
    expect(resolveConfig({ per_ip_daily_limit: -3 }).per_ip_daily_limit).toBe(100);
    expect(resolveConfig({}).per_ip_daily_limit).toBe(100); // rows from before the column existed
    const result = validateConfigUpdate(DEFAULT_CONFIG, { per_ip_daily_limit: 250 });
    expect(result.ok && result.config.per_ip_daily_limit).toBe(250);
  });

  it('describes the registry without exposing keys', () => {
    const described = describeRegistry((keyEnv) => keyEnv === 'GROQ_API_KEY');
    expect(described.find((p) => p.id === 'groq')?.keySet).toBe(true);
    expect(described.find((p) => p.id === 'gemini')?.keySet).toBe(false);
    expect(JSON.stringify(described)).not.toMatch(/extra|chat_template_kwargs/);
  });
});
