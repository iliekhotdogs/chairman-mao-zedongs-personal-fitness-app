import { __setApiKeyForTests, __setGeminiKeyForTests } from '../ai/apiKey';
import { aiEngine, chatEngine, coachReply, estimateFood } from '../ai/provider';
import { geminiCoach, testGemini } from '../ai/gemini';
import { buildSampleState } from '../sampleData';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const TODAY = '2026-10-02';
const realFetch = globalThis.fetch;
let calls: { url: string; init?: { body?: string; headers?: Record<string, string> } }[] = [];

function mockGemini(status: number, reply?: string) {
  calls = [];
  globalThis.fetch = jest.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    calls.push({ url, init });
    return {
      ok: status < 400, status,
      json: async () => ({ candidates: [{ content: { parts: [{ text: reply }] } }] }),
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  __setApiKeyForTests(null);
  __setGeminiKeyForTests(null);
});

describe('old device keys', () => {
  it('cannot activate direct Gemini or NVIDIA calls in the shared-account app', async () => {
    __setApiKeyForTests('nvapi-old');
    __setGeminiKeyForTests('gemini-old');
    mockGemini(200, 'unused');
    const state = buildSampleState('dev', TODAY);
    expect(aiEngine(state.settings)).toBe('simulated');
    expect(chatEngine(state.settings)).toBe('simulated');
    expect((await estimateFood(state, { hint: 'apple' })).simulated).toBe(true);
    expect((await coachReply(state, 'hello', TODAY)).simulated).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('legacy Gemini client', () => {
  it('parses text and validates proposed intents', async () => {
    mockGemini(200, '{"reply":"Let’s make it shorter.","safety":false,"intents":[{"type":"short_on_time","minutes":20},{"type":"training_days","days":12}]}');
    const result = await geminiCoach({ key: 'old-key', model: 'gemini-3.8-flash', message: 'I have 20 minutes', history: [], context: {}, tone: 'supportive' });
    expect(result.reply).toBe('Let’s make it shorter.');
    expect(result.intents).toEqual([{ type: 'short_on_time', minutes: 20 }]);
    expect(calls[0].init?.headers?.['x-goog-api-key']).toBe('old-key');
  });

  it('reports a rejected connection', async () => {
    mockGemini(403);
    const result = await testGemini('old-key', 'gemini-3.8-flash');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rejected/);
  });
});
