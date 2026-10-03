import { useStore } from '@/store/AppStore';
import { useApiKey, useGeminiKey } from '@/lib/ai/apiKey';
import { aiEngine, chatEngine, type AIEngine } from '@/lib/ai/provider';

/** The current provider for meal photos or coach chat. */
export function useAiEngine(feature: 'food' | 'chat'): AIEngine {
  const { state } = useStore();
  const { key: nvidiaKey } = useApiKey();
  const { key: geminiKey } = useGeminiKey();
  return feature === 'food' ? aiEngine(state.settings, nvidiaKey) : chatEngine(state.settings, geminiKey);
}
