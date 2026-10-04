/** Groq chat models offered in Settings. The server allowlist in
 * supabase/functions/ai/index.ts must match. Meal photos always use the vision model. */
export const GROQ_CHAT_MODELS = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B' },
] as const;

export const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';

export const DEFAULT_CHAT_MODEL = GROQ_CHAT_MODELS[0].id;

export function selectedChatModel(id?: string): string {
  return GROQ_CHAT_MODELS.some((model) => model.id === id) ? id! : DEFAULT_CHAT_MODEL;
}
