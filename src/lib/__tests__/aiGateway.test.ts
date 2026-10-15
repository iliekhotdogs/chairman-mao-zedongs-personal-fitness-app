import { aiEngine, coachReply, estimateFood, fetchAiInfo } from '../ai/provider';
import { buildSampleState } from '../sampleData';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
const mockInvoke = jest.fn();
let mockSession = true;
jest.mock('../sync/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: () => ({ functions: { invoke: mockInvoke }, auth: { getSession: async () => ({ data: { session: mockSession ? { user: {} } : null } }) } }),
}));

const TODAY = '2026-10-02';
const sample = () => ({ ...buildSampleState('dev', TODAY), proposals: [] });
afterEach(() => {
  mockSession = true;
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
    mockInvoke.mockResolvedValue({ data: { items: [{ name: 'Apple', portion: '1', grams: 100, calories: 95, protein_g: 0, carbs_g: 25, fat_g: 0, confidence: 'low', portion_assumption: 'one apple', source_kind: 'visual_estimate', source_label: 'Visual estimate' }], overall_confidence: 'low', notes: [], model: 'z-ai/glm-5.3-flash', provider: 'OpenRouter' }, error: null });
    const result = await estimateFood(state, { hint: 'apple' });
    expect(result.provider).toBe('OpenRouter (z-ai/glm-5.3-flash) via your server');
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'estimate_food' }) });
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('model');
  });

  it('reads the admin-chosen provider from the info action', async () => {
    const info = { enabled: true, provider: 'groq', providerLabel: 'Groq', chatModel: 'openai/gpt-oss-20b', chatModelLabel: 'GPT-OSS 20B', visionModel: 'qwen/qwen3.8-27b', visionModelLabel: 'Qwen3.8 27B', perUserDailyLimit: 25, usedToday: 1 };
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

describe('coach when signed out', () => {
  it('answers with a built-in reply, a sign-in notice and no server call', async () => {
    mockSession = false;
    const result = await coachReply(sample(), 'How am I doing?', TODAY);
    expect(result.simulated).toBe(true);
    expect(result.aiNoticeKind).toBe('signed_out');
    expect(result.aiNotice).toBe('Sign in to use the AI coach.');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
  it('maps a transport failure to a friendly message', async () => {
    const err = Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' });
    mockInvoke.mockResolvedValue({ data: null, error: err });
    const result = await coachReply(sample(), 'How am I doing?', TODAY);
    expect(result.aiNoticeKind).toBe('unavailable');
    expect(result.aiNotice).not.toMatch(/edge function|supabase/i);
  });
});
