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

describe('findFdcByGtin', () => {
  const { findFdcByGtin, itemFromGtinMatch } = require('../nutrition/lookup');
  const food = (gtinUpc?: string) => ({ fdcId: 1, description: 'Bar', dataType: 'Branded', gtinUpc, per100g: { kcal: 400, p: 10, c: 50, f: 10 } });

  it('matches across leading zeros', async () => {
    const search = jest.fn().mockResolvedValue([food('0012345678905')]);
    const hit = await findFdcByGtin(['012345678905'], search);
    expect(hit?.fdcId).toBe(1);
    expect(itemFromGtinMatch(hit).grams).toBe(100);
  });
  it('rejects a different gtin and results without gtinUpc', async () => {
    expect(await findFdcByGtin(['012345678905'], jest.fn().mockResolvedValue([food('999')]))).toBeUndefined();
    expect(await findFdcByGtin(['012345678905'], jest.fn().mockResolvedValue([food()]))).toBeUndefined();
  });
  it('caps searches at 2', async () => {
    const search = jest.fn().mockResolvedValue([]);
    await findFdcByGtin(['1', '2', '3'], search);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
