import { searchFdc } from '../nutrition/lookup';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('USDA lookup', () => {
  it('uses the documented POST body with an array of data types', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ foods: [] }) } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await searchFdc('apple', 'DEMO_KEY');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.nal.usda.gov/fdc/v1/foods/search');
    expect(url).not.toContain('api_key');
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('DEMO_KEY');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ query: 'apple', pageSize: 8, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] });
  });

  it('explains an unverified emailed key without revealing it', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'API_KEY_UNVERIFIED' } }) } as Response)) as unknown as typeof fetch;
    await expect(searchFdc('apple', 'a-private-key')).rejects.toThrow(/verification link/);
  });
});
