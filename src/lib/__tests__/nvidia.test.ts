import { extractJson, nvidiaChat, parseFoodJson, parseIntents, stripThinking, testNvidia } from '../ai/nvidia';
import { aiEngine, chatEngine } from '../ai/provider';
import { __setApiKeyForTests, __setGeminiKeyForTests } from '../ai/apiKey';
import { buildSampleState } from '../sampleData';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories must use require
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const TODAY = '2026-10-02';
const sample = () => ({ ...buildSampleState('dev', TODAY), proposals: [] });

type FetchArgs = [string, { body?: string; headers?: Record<string, string> }?];
const realFetch = globalThis.fetch;
let calls: FetchArgs[] = [];

function mockFetch(handler: (url: string, body: Record<string, unknown> | undefined) => { status: number; json: unknown }) {
  calls = [];
  globalThis.fetch = jest.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    calls.push([url, init]);
    const r = handler(url, init?.body ? JSON.parse(init.body) : undefined);
    const text = JSON.stringify(r.json);
    return { ok: r.status < 400, status: r.status, text: async () => text, json: async () => r.json } as unknown as Response;
  }) as unknown as typeof fetch;
}

const chatReply = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }] } });

afterEach(() => {
  globalThis.fetch = realFetch;
  __setApiKeyForTests(null);
  __setGeminiKeyForTests(null);
});

describe('engine selection', () => {
  const s = sample().settings;
  it('no key → built-in answers', () => expect(aiEngine(s, null)).toBe('simulated'));
  it('old device keys no longer activate client-side AI', () => {
    __setApiKeyForTests('nvapi-test');
    __setGeminiKeyForTests('gemini-test');
    expect(aiEngine(s)).toBe('simulated');
    expect(chatEngine(s, null)).toBe('simulated');
    expect(chatEngine(s, 'gemini-test')).toBe('simulated');
  });
});

describe('parsing model replies', () => {
  it('strips <think> blocks and code fences', () => {
    expect(stripThinking('<think>hmm</think> Hello')).toBe('Hello');
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('keeps valid food items and drops absurd ones', () => {
    const r = parseFoodJson({
      items: [
        { name: 'Rice', portion: '1 cup', grams: 158, calories: 205, protein_g: 4.3, carbs_g: 45, fat_g: 0.4, confidence: 'high', portion_assumption: 'x', usda_search_query: 'rice white cooked' },
        { name: 'Bad', calories: 99999, protein_g: 1, carbs_g: 1, fat_g: 1 },
        { name: '', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
        { name: 'Strings', calories: '120', protein_g: '3', carbs_g: '20', fat_g: '2', confidence: 'weird' },
      ],
      overall_confidence: 'medium',
      follow_up_question: 'null',
      notes: ['a', 2, 'b'],
    });
    expect(r.items.map((i) => i.name)).toEqual(['Rice', 'Strings']);
    expect(r.items[1].calories).toBe(120);
    expect(r.items[1].confidence).toBe('low');
    expect(r.follow_up_question).toBeNull();
    expect(r.notes).toEqual(['a', 'b']);
  });

  it('only accepts known coach intents with sane values', () => {
    expect(
      parseIntents([
        { type: 'short_on_time', minutes: 20 },
        { type: 'pain', area: 'knee', red_flags: false },
        { type: 'delete_everything' },
        { type: 'training_days', days: 12 },
      ]),
    ).toEqual([
      { type: 'short_on_time', minutes: 20 },
      { type: 'pain', area: 'knee', red_flags: false },
    ]);
  });
});

describe('NVIDIA API client', () => {
  it('retries without the thinking switch if NVIDIA rejects it', async () => {
    mockFetch((_url, body) => (body && 'chat_template_kwargs' in body ? { status: 400, json: { detail: 'unknown field' } } : chatReply('{"reply":"hi","safety":false,"intents":[]}')));
    const r = await nvidiaChat({ key: 'nvapi-test', model: 'deepseek-ai/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hello' }] });
    expect(r).toContain('"reply":"hi"');
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1][1]!.body!).max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('explains when the model spent its whole allowance thinking', async () => {
    mockFetch(() => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'hmm…' } }] } }));
    await expect(nvidiaChat({ key: 'nvapi-test', model: 'deepseek-ai/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow(/thinking/);
  });

  it('the connection test accepts an empty answer and reports seconds', async () => {
    mockFetch(() => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '' } }] } }));
    const r = await testNvidia('nvapi-test', { vision: 'meta/llama-3.2-90b-vision-instruct', chat: 'deepseek-ai/deepseek-v4.1-flash' });
    expect(r.vision.ok && r.chat.ok).toBe(true);
    expect(typeof r.chat.seconds).toBe('number');
  });
});
