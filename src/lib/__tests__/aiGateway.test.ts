import { aiEngine, coachReply, estimateFood, fetchAiInfo } from '../ai/provider';
import { buildSampleState } from '../sampleData';

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
});

describe('shared AI gateway', () => {
  it('uses Supabase for chat and never sends a model', async () => {
    const state = sample();
    mockInvoke.mockResolvedValue({ data: { reply: 'Shorter workout?', safety: false, intents: [{ type: 'short_on_time', minutes: 20 }] }, error: null });
    expect(aiEngine()).toBe('server');
    const result = await coachReply(state, 'I have 20 minutes', TODAY);
    expect(result.simulated).toBe(false);
    expect(result.proposals.every((proposal) => proposal.status === 'pending')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'coach' }) });
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('model');
  });

  it('keeps urgent symptoms off the model', async () => {
    const result = await coachReply(sample(), 'I have chest pain', TODAY);
    expect(result.text).toMatch(/emergency/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('labels meal estimates with the provider the server used', async () => {
    const state = sample();
    mockInvoke.mockResolvedValue({ data: { items: [], overall_confidence: 'low', notes: [], model: 'gemini-3.8-flash', provider: 'Gemini' }, error: null });
    const result = await estimateFood(state, { hint: 'apple' });
    expect(result.provider).toBe('Gemini (gemini-3.8-flash) via your server');
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'estimate_food' }) });
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('model');
  });

  it('reads the admin-chosen provider from the info action', async () => {
    const info = { enabled: true, provider: 'groq', providerLabel: 'Groq', chatModel: 'openai/gpt-oss-120b', chatModelLabel: 'GPT-OSS 120B', visionModel: 'qwen/qwen3.8-27b', visionModelLabel: 'Qwen3.8 27B', perUserDailyLimit: 5, usedToday: 1 };
    mockInvoke.mockResolvedValue({ data: info, error: null });
    await expect(fetchAiInfo()).resolves.toEqual(info);
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: { action: 'info' } });
  });

  it('shows the kill-switch message when AI is switched off', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'Coach AI is switched off by the app owner right now. Built-in answers still work.' }), { status: 503 }),
    });
    mockInvoke.mockResolvedValue({ data: null, error });
    const result = await coachReply(sample(), 'Can I shorten my workout?', TODAY);
    expect(result.simulated).toBe(true);
    expect(result.aiNotice).toMatch(/switched off/);
  });

  it('labels a failed photo call as a hint-based fallback', async () => {
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

  it('keeps a failed coach reply clearly simulated', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('provider unavailable') });
    const result = await coachReply(sample(), 'Can I shorten my workout?', TODAY);
    expect(result.simulated).toBe(true);
    expect(result.aiNotice).toContain('provider unavailable');
  });
});
