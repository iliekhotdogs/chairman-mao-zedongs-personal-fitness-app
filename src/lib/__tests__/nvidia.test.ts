import { extractJson, parseFoodJson, parseIntents, stripThinking, testNvidia } from '../ai/nvidia';
import { aiEngine, coachReply, estimateFood } from '../ai/provider';
import { __setApiKeyForTests } from '../ai/apiKey';
import { buildSampleState } from '../sampleData';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories must use require
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../ai/image', () => ({ prepareImageForAI: jest.fn(async () => ({ base64: 'AAAA', mediaType: 'image/jpeg' })) }));

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
});

describe('engine selection', () => {
  const s = sample().settings;
  it('no key → built-in answers', () => expect(aiEngine(s, null)).toBe('simulated'));
  it('a saved NVIDIA key always wins', () => expect(aiEngine({ ...s, aiMode: 'server' }, 'nvapi-x')).toBe('nvidia'));
  it('server only when chosen and no key', () => expect(aiEngine({ ...s, aiMode: 'server' }, null)).toBe('server'));
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

describe('NVIDIA food estimate', () => {
  it('uses the vision model and sources values from USDA when they agree', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch((url) => {
      if (url.includes('api.nal.usda.gov')) {
        return { status: 200, json: { foods: [{ fdcId: 1, description: 'Rice, white, cooked', dataType: 'SR Legacy', foodNutrients: [{ nutrientNumber: '208', value: 130 }, { nutrientNumber: '203', value: 2.7 }, { nutrientNumber: '205', value: 28 }, { nutrientNumber: '204', value: 0.3 }] }] } };
      }
      return chatReply(JSON.stringify({ items: [{ name: 'White rice', restaurant: null, portion: '1 cup', grams: 158, calories: 210, protein_g: 4, carbs_g: 45, fat_g: 0.5, confidence: 'medium', portion_assumption: 'A level cup', usda_search_query: 'rice white cooked' }], overall_confidence: 'medium', follow_up_question: null, notes: [] }));
    });
    const est = await estimateFood(sample(), { hint: 'rice', photoUri: 'file://x.jpg', photoSize: { width: 4000, height: 3000 } });
    expect(est.simulated).toBe(false);
    expect(est.aiNotice).toBeUndefined();
    expect(est.provider).toContain('meta/llama-3.2-90b-vision-instruct');
    expect(est.items[0].source.kind).toBe('database');
    expect(est.items[0].calories).toBe(Math.round(130 * 1.58));
    const [url, init] = calls.find(([u]) => u.includes('/chat/completions'))!;
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(init?.headers?.Authorization).toBe('Bearer nvapi-test');
    expect(JSON.stringify(JSON.parse(init!.body!).messages)).toContain('data:image/jpeg;base64,AAAA');
  });

  it('falls back to the built-in estimate, with a note, when the key is rejected', async () => {
    __setApiKeyForTests('nvapi-wrong');
    mockFetch(() => ({ status: 401, json: { detail: 'Unauthorized' } }));
    const est = await estimateFood(sample(), { hint: '2 eggs and toast' });
    expect(est.simulated).toBe(true);
    expect(est.aiNotice).toMatch(/rejected the API key/);
    expect(est.items.length).toBeGreaterThan(0);
  });
});

describe('NVIDIA coach', () => {
  it('uses the chat model and turns intents into approval-gated proposals', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch(() => chatReply('<think>plan</think>{"reply":"Let\'s do a quick version.","safety":false,"intents":[{"type":"short_on_time","minutes":20}]}'));
    const s = sample();
    const r = await coachReply(s, 'I only have 20 minutes', TODAY);
    expect(r.simulated).toBe(false);
    expect(r.text).toBe("Let's do a quick version.");
    for (const p of r.proposals) expect(p.status).toBe('pending');
    const body = JSON.parse(calls[0][1]!.body!);
    expect(body.model).toBe('deepseek-ai/deepseek-v4.1-flash');
    expect(body.chat_template_kwargs).toEqual({ thinking: false, enable_thinking: false });
  });

  it('uses the models chosen in settings', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch(() => chatReply('{"reply":"ok","safety":false,"intents":[]}'));
    const s = sample();
    await coachReply({ ...s, settings: { ...s.settings, aiModels: { vision: 'v/model', chat: 'c/model' } } }, 'hello', TODAY);
    expect(JSON.parse(calls[0][1]!.body!).model).toBe('c/model');
  });

  it('accepts a plain-text reply with no suggested changes', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch(() => chatReply('Great work this week!'));
    const r = await coachReply(sample(), 'how am I doing', TODAY);
    expect(r.text).toBe('Great work this week!');
    expect(r.proposals).toHaveLength(0);
  });

  it('falls back to built-in answers when NVIDIA fails', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch(() => ({ status: 429, json: {} }));
    const r = await coachReply(sample(), "I'm eating out tonight", TODAY);
    expect(r.simulated).toBe(true);
    expect(r.aiNotice).toMatch(/rate limit/);
    expect(r.text).toMatch(/kcal/);
  });

  it('emergencies never go to the model', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch(() => chatReply('{"reply":"push through it","safety":false,"intents":[]}'));
    const r = await coachReply(sample(), 'I have chest pain', TODAY);
    expect(calls).toHaveLength(0);
    expect(r.text).toMatch(/emergency/);
  });
});

describe('thinking models (DeepSeek)', () => {
  it('retries without the thinking switch if NVIDIA rejects it', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch((_url, body) => (body && 'chat_template_kwargs' in body ? { status: 400, json: { detail: 'unknown field' } } : chatReply('{"reply":"hi","safety":false,"intents":[]}')));
    const r = await coachReply(sample(), 'hello', TODAY);
    expect(r.text).toBe('hi');
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1][1]!.body!).max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('explains when the model spent its whole allowance thinking', async () => {
    __setApiKeyForTests('nvapi-test');
    mockFetch(() => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'hmm…' } }] } }));
    const r = await coachReply(sample(), 'hello', TODAY);
    expect(r.simulated).toBe(true);
    expect(r.aiNotice).toMatch(/thinking/);
  });

  it('the connection test accepts an empty answer and reports seconds', async () => {
    mockFetch(() => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '' } }] } }));
    const r = await testNvidia('nvapi-test', { vision: 'meta/llama-3.2-90b-vision-instruct', chat: 'deepseek-ai/deepseek-v4.1-flash' });
    expect(r.vision.ok && r.chat.ok).toBe(true);
    expect(typeof r.chat.seconds).toBe('number');
  });
});
