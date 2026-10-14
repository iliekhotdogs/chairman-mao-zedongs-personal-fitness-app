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

  it('defaults to the current Groq setup', () => {
    expect(DEFAULT_CONFIG).toMatchObject({ provider: 'groq', chat_model: 'openai/gpt-oss-120b', vision_model: 'qwen/qwen3.8-27b', per_user_daily_limit: 5, global_daily_limit: 40, ai_enabled: true });
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
    const result = validateConfigUpdate(DEFAULT_CONFIG, { per_user_daily_limit: 0, global_daily_limit: 100, ai_enabled: false });
    expect(result.ok && result.config).toMatchObject({ per_user_daily_limit: 0, global_daily_limit: 100, ai_enabled: false });
  });

  it('describes the registry without exposing keys', () => {
    const described = describeRegistry((keyEnv) => keyEnv === 'GROQ_API_KEY');
    expect(described.find((p) => p.id === 'groq')?.keySet).toBe(true);
    expect(described.find((p) => p.id === 'gemini')?.keySet).toBe(false);
    expect(JSON.stringify(described)).not.toMatch(/extra|chat_template_kwargs/);
  });
});
