import { __setApiKeyForTests, __setGeminiKeyForTests } from '../ai/apiKey';
import { aiEngine, chatEngine, coachReply, estimateFood } from '../ai/provider';
import { buildSampleState } from '../sampleData';
import { selectedChatModel } from '../ai/openrouterModels';
import { NVIDIA_DEFAULT_MODELS } from '../ai/nvidia';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
const mockInvoke = jest.fn();
jest.mock('../sync/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: () => ({ functions: { invoke: mockInvoke } }),
}));

const TODAY = '2026-10-02';
const sample = () => ({ ...buildSampleState('dev', TODAY), proposals: [] });
afterEach(() => {
  mockInvoke.mockReset();
  __setApiKeyForTests(null);
  __setGeminiKeyForTests(null);
});

describe('shared OpenRouter gateway', () => {
  it('uses Supabase for chat even when old device keys exist', async () => {
    __setApiKeyForTests('nvapi-old');
    __setGeminiKeyForTests('gemini-old');
    const state = sample();
    state.settings.openRouterChatModel = 'google/gemma-4-31b-it:free';
    mockInvoke.mockResolvedValue({ data: { reply: 'Shorter workout?', safety: false, intents: [{ type: 'short_on_time', minutes: 20 }] }, error: null });
    expect(aiEngine(state.settings)).toBe('server');
    expect(chatEngine(state.settings)).toBe('server');
    const result = await coachReply(state, 'I have 20 minutes', TODAY);
    expect(result.simulated).toBe(false);
    expect(result.proposals.every((proposal) => proposal.status === 'pending')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'coach', model: 'google/gemma-4-31b-it:free' }) });
  });

  it('keeps urgent symptoms off the model', async () => {
    const result = await coachReply(sample(), 'I have chest pain', TODAY);
    expect(result.text).toMatch(/emergency/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('keeps meal photos on the original NVIDIA model', async () => {
    const state = sample();
    state.settings.aiModels = { vision: NVIDIA_DEFAULT_MODELS.vision, chat: NVIDIA_DEFAULT_MODELS.chat };
    mockInvoke.mockResolvedValue({ data: { items: [], overall_confidence: 'low', notes: [], model: NVIDIA_DEFAULT_MODELS.vision }, error: null });
    const result = await estimateFood(state, { hint: 'apple' });
    expect(result.provider).toContain('NVIDIA');
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'estimate_food', model: NVIDIA_DEFAULT_MODELS.vision }) });
    expect(selectedChatModel('paid/unknown')).toContain(':free');
  });

  it('labels a failed NVIDIA call as a hint-based fallback', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('provider unavailable') });
    const result = await estimateFood(sample(), { hint: 'apple' });
    expect(result.simulated).toBe(true);
    expect(result.aiNotice).toContain('provider unavailable');
  });

  it('shows the gateway reason instead of the generic non-2xx message', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'NVIDIA is not configured on the server.' }), { status: 503 }),
    });
    mockInvoke.mockResolvedValue({ data: null, error });
    const result = await coachReply(sample(), 'Can I shorten my workout?', TODAY);
    expect(result.aiNotice).toBe('NVIDIA is not configured on the server.');
  });

  it('keeps a failed OpenRouter coach reply clearly simulated', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('provider unavailable') });
    const result = await coachReply(sample(), 'Can I shorten my workout?', TODAY);
    expect(result.simulated).toBe(true);
    expect(result.aiNotice).toContain('provider unavailable');
  });
});
