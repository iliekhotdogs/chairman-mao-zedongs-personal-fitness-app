import { useStore } from '@/store/AppStore';
import { useApiKey } from '@/lib/ai/apiKey';
import { aiEngine, type AIEngine } from '@/lib/ai/provider';

/** Which AI the app is using right now: 'nvidia' (your key), 'server', or 'simulated' (built-in answers). */
export function useAiEngine(): AIEngine {
  const { state } = useStore();
  const { key } = useApiKey();
  return aiEngine(state.settings, key);
}
