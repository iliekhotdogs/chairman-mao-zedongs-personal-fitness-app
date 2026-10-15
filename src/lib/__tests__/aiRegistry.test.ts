import { DEFAULT_CONFIG, describeRegistry, effectiveConfig, PROVIDER_IDS, PROVIDERS, resolveConfig, validateConfigUpdate, validPreference } from '../../../supabase/functions/_shared/providers';

describe('AI provider registry', () => {
  it('has groq, openrouter and nvidia with chat and vision models', () => {
    expect(PROVIDER_IDS.sort()).toEqual(['groq', 'nvidia', 'openrouter']);
    for (const id of PROVIDER_IDS) {
      const info = PROVIDERS[id];
      expect(info.url).toMatch(/^https:\/\/.+\/chat\/completions$/);
      expect(info.keyEnv).toMatch(/_API_KEY$/);
      expect(info.chatModels.length).toBeGreaterThan(0);
      expect(info.visionModels.length).toBeGreaterThan(0);
    }
    expect(PROVIDERS.openrouter.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(PROVIDERS.nvidia.chatModels.some((model) => /kimi/i.test(model.id))).toBe(true);
    expect(PROVIDERS.groq.chatModels).toHaveLength(3);
    expect(PROVIDERS.openrouter.chatModels).toHaveLength(3);
    expect(PROVIDERS.groq.userSelectable).toBe(true);
    expect(PROVIDERS.openrouter.userSelectable).toBe(true);
    expect(PROVIDERS.nvidia.userSelectable).toBe(false);
  });

  // Ids verified against the providers' model catalogs in 2026-10 (see docs/AI_PROVIDER.md).
  // Changing a list is deliberate: update the doc and re-verify the ids when this fails.
  it('lists only the verified model ids', () => {
    const ids = (models: { id: string }[]) => models.map((model) => model.id);
    expect(ids(PROVIDERS.groq.chatModels)).toEqual(['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']);
    expect(ids(PROVIDERS.groq.visionModels)).toEqual(['qwen/qwen3.8-27b']);
    expect(ids(PROVIDERS.openrouter.chatModels)).toEqual(['z-ai/glm-5.3-flash', 'nvidia/nemotron-3.5-lightning', 'deepseek/deepseek-v4.1-flash']);
    expect(ids(PROVIDERS.openrouter.visionModels)).toEqual(['z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash']);
    expect(ids(PROVIDERS.nvidia.chatModels)).toEqual(['moonshotai/kimi-k2.6', 'deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-3-super-120b-a12b']);
    expect(ids(PROVIDERS.nvidia.visionModels)).toEqual(['meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct', 'moonshotai/kimi-k2.6']);
    expect(ids(PROVIDERS.openrouter.visionModels)).not.toContain('nvidia/nemotron-3.5-lightning');
    expect(PROVIDERS.openrouter.chatModels.find((model) => model.id === 'deepseek/deepseek-v4.1-flash')?.extra).toEqual({ reasoning: { enabled: false } });
  });

  it('defaults to the current Groq setup', () => {
    expect(DEFAULT_CONFIG).toMatchObject({ provider: 'groq', chat_model: 'openai/gpt-oss-20b', vision_model: 'qwen/qwen3.8-27b', per_user_daily_limit: 25, global_daily_limit: 250, per_ip_daily_limit: 250, ai_enabled: true });
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it('repairs stale stored rows', () => {
    const resolved = resolveConfig({ provider: 'openrouter', chat_model: 'openai/gpt-oss-120b', vision_model: 'nope', per_user_daily_limit: -1, ai_enabled: false });
    expect(resolved.provider).toBe('openrouter');
    expect(resolved.chat_model).toBe(PROVIDERS.openrouter.chatModels[0].id);
    expect(resolved.vision_model).toBe(PROVIDERS.openrouter.visionModels[0].id);
    expect(resolved.per_user_daily_limit).toBe(25);
    expect(resolved.ai_enabled).toBe(false);
    expect(resolveConfig({ provider: 'gemini' }).provider).toBe('groq');
  });

  it('switching provider resets models to that provider', () => {
    const result = validateConfigUpdate(DEFAULT_CONFIG, { provider: 'nvidia' });
    expect(result).toEqual({ ok: true, config: { ...DEFAULT_CONFIG, provider: 'nvidia', chat_model: PROVIDERS.nvidia.chatModels[0].id, vision_model: PROVIDERS.nvidia.visionModels[0].id } });
  });

  it('accepts a provider with its own models in one update', () => {
    const result = validateConfigUpdate(DEFAULT_CONFIG, { provider: 'openrouter', chat_model: 'z-ai/glm-5.3-flash', vision_model: 'deepseek/deepseek-v4.1-flash' });
    expect(result.ok && result.config).toMatchObject({ provider: 'openrouter', chat_model: 'z-ai/glm-5.3-flash', vision_model: 'deepseek/deepseek-v4.1-flash' });
  });

  it('rejects models from another provider', () => {
    expect(validateConfigUpdate(DEFAULT_CONFIG, { chat_model: 'z-ai/glm-5.3-flash' })).toEqual({ ok: false, error: 'Groq does not offer that chat model.' });
    expect(validateConfigUpdate(DEFAULT_CONFIG, { provider: 'openrouter', vision_model: 'qwen/qwen3.8-27b' }).ok).toBe(false);
    expect(validateConfigUpdate(DEFAULT_CONFIG, { provider: 'openrouter', vision_model: 'nvidia/nemotron-3.5-lightning' }).ok).toBe(false);
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
    expect(resolveConfig({ per_ip_daily_limit: -3 }).per_ip_daily_limit).toBe(250);
    expect(resolveConfig({}).per_ip_daily_limit).toBe(250); // rows from before the column existed
    const result = validateConfigUpdate(DEFAULT_CONFIG, { per_ip_daily_limit: 250 });
    expect(result.ok && result.config.per_ip_daily_limit).toBe(250);
  });

  it('describes the registry without exposing keys', () => {
    const described = describeRegistry((keyEnv) => keyEnv === 'GROQ_API_KEY');
    expect(described.find((p) => p.id === 'groq')?.keySet).toBe(true);
    expect(described.find((p) => p.id === 'openrouter')?.keySet).toBe(false);
    expect(JSON.stringify(described)).not.toMatch(/extra|chat_template_kwargs/);
  });

  it('derives photo models from the chosen chat model', () => {
    const keySet = () => true;
    expect(effectiveConfig(DEFAULT_CONFIG, { provider: 'groq', chat_model: 'openai/gpt-oss-20b' }, keySet).config.vision_model).toBe('qwen/qwen3.8-27b');
    expect(effectiveConfig(DEFAULT_CONFIG, { provider: 'groq', chat_model: 'qwen/qwen3.8-27b' }, keySet).config.vision_model).toBe('qwen/qwen3.8-27b');
    expect(effectiveConfig(DEFAULT_CONFIG, { provider: 'openrouter', chat_model: 'deepseek/deepseek-v4.1-flash' }, keySet).config.vision_model).toBe('deepseek/deepseek-v4.1-flash');
    expect(effectiveConfig(DEFAULT_CONFIG, { provider: 'openrouter', chat_model: 'nvidia/nemotron-3.5-lightning' }, keySet).config.vision_model).toBe('z-ai/glm-5.3-flash');
  });

  it('ignores stale and unavailable user choices', () => {
    const preference = { provider: 'openrouter', chat_model: 'z-ai/glm-5.3-flash' };
    expect(effectiveConfig(DEFAULT_CONFIG, preference, () => false)).toEqual({ config: DEFAULT_CONFIG, isDefault: true });
    expect(effectiveConfig(DEFAULT_CONFIG, { provider: 'nvidia', chat_model: PROVIDERS.nvidia.chatModels[0].id }, () => true).isDefault).toBe(true);
    expect(effectiveConfig(DEFAULT_CONFIG, { provider: 'openrouter', chat_model: 'retired' }, () => true).isDefault).toBe(true);
    expect(validPreference({ provider: 'groq', chat_model: 'z-ai/glm-5.3-flash' })).toBeNull();
    expect(effectiveConfig({ ...DEFAULT_CONFIG, allow_user_choice: false }, preference, () => true).isDefault).toBe(true);
  });
});
