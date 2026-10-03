/** Free OpenRouter chat-completion models from the user's selected router list.
 * Excludes embedding, reranking, moderation, and harness-only endpoints. */
export const OPENROUTER_CHAT_MODELS = [
  { id: 'qwen/qwen3.8-27b:free', label: 'Qwen3.8 27B' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning' },
] as const;

export const DEFAULT_CHAT_MODEL = OPENROUTER_CHAT_MODELS[0].id;

export function selectedChatModel(id?: string): string {
  return OPENROUTER_CHAT_MODELS.some((model) => model.id === id) ? id! : DEFAULT_CHAT_MODEL;
}
