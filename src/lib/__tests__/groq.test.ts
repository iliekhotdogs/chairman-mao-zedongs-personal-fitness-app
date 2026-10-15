import { __setApiKeyForTests, __setGeminiKeyForTests } from '../ai/apiKey';
import { aiEngine, chatEngine, coachReply, estimateFood } from '../ai/provider';
import { buildSampleState } from '../sampleData';
import { GROQ_VISION_MODEL, selectedChatModel } from '../ai/groqModels';

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
  __setApiKeyForTests(null);
  __setGeminiKeyForTests(null);
});

describe('shared Groq gateway', () => {
  it('uses Supabase for chat even when old device keys exist', async () => {
    __setApiKeyForTests('nvapi-old');
    __setGeminiKeyForTests('gemini-old');
    const state = sample();
    state.settings.chatModel = 'openai/gpt-oss-20b';
    mockInvoke.mockResolvedValue({ data: { reply: 'Shorter workout?', safety: false, intents: [{ type: 'short_on_time', minutes: 20 }] }, error: null });
    expect(aiEngine(state.settings)).toBe('server');
    expect(chatEngine(state.settings)).toBe('server');
    const result = await coachReply(state, 'I have 20 minutes', TODAY);
    expect(result.simulated).toBe(false);
    expect(result.proposals.every((proposal) => proposal.status === 'pending')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'coach', model: 'openai/gpt-oss-20b' }) });
  });

  it('keeps urgent symptoms off the model', async () => {
    const result = await coachReply(sample(), 'I have chest pain', TODAY);
    expect(result.text).toMatch(/emergency/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('sends meal photos to the Groq vision model', async () => {
    const state = sample();
    mockInvoke.mockResolvedValue({ data: { items: [{ name: 'Apple', portion: 'one', grams: 150, calories: 78, protein_g: 0, carbs_g: 21, fat_g: 0, confidence: 'low', portion_assumption: 'medium apple', source_kind: 'visual_estimate', source_label: 'Visual estimate' }], overall_confidence: 'low', notes: [], model: GROQ_VISION_MODEL }, error: null });
    const result = await estimateFood(state, { hint: 'apple' });
    expect(result.provider).toContain('Groq');
    expect(mockInvoke).toHaveBeenCalledWith('ai', { body: expect.objectContaining({ action: 'estimate_food', model: GROQ_VISION_MODEL }) });
    expect(selectedChatModel('google/gemma-4-31b-it:free')).toBe('openai/gpt-oss-120b');
  });
  it('marks a malformed gateway estimate as a visible fallback', async () => {
    mockInvoke.mockResolvedValue({ data: { items: [{ name: 'Apple', grams: null, calories: 80 }], overall_confidence: 'high', model: GROQ_VISION_MODEL }, error: null });
    const result = await estimateFood(sample(), { hint: 'apple' });
    expect(result.simulated).toBe(true);
    expect(result.aiNotice).toBeTruthy();
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

  it('keeps a failed Groq coach reply clearly simulated', async () => {
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
    mockSession = true;
    const err = Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' });
    mockInvoke.mockResolvedValue({ data: null, error: err });
    const result = await coachReply(sample(), 'How am I doing?', TODAY);
    expect(result.aiNoticeKind).toBe('unavailable');
    expect(result.aiNotice).not.toMatch(/edge function|supabase/i);
  });
});
