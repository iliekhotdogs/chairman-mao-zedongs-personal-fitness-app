import { useStore } from '@/store/AppStore';
import type { AIEngine } from '@/lib/ai/provider';

/** Whether meal photos and coach chat use the server AI gateway or built-in answers.
 * Both features share one engine; the parameter is kept for call-site readability. */
export function useAiEngine(feature: 'food' | 'chat'): AIEngine {
  const { sync } = useStore();
  return feature && sync.configured ? 'server' : 'simulated';
}
