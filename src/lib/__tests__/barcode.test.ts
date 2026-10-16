import { lookupBarcodeCached } from '../nutrition/barcodeCache';
import { barcodeCandidates, expandUpcE, hasValidCheckDigit, itemFromProduct, lookupBarcode, normalizeBarcode, OFF_USER_AGENT, per100gFrom, servingGramsFrom, BarcodeError } from '../nutrition/barcode';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));

const NUTELLA = {
  code: '3017620422003',
  product_name: 'Nutella',
  brands: 'Ferrero, Nutella',
  serving_size: '15 g',
  serving_quantity: 15,
  nutriments: { 'energy-kcal_100g': 539, energy_100g: 2252, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
};

function mockFetch(status: number, body: unknown) {
  return jest.fn(async (_url: string, _init?: RequestInit) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response);
}

describe('barcode normalisation', () => {
  it('accepts retail barcode lengths and strips spaces/dashes', () => {
    expect(normalizeBarcode(' 3017620422003 ')).toBe('3017620422003');
    expect(normalizeBarcode('0 12345-67890 5')).toBe('012345678905');
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(normalizeBarcode('12345')).toBeUndefined();
    expect(normalizeBarcode('abc')).toBeUndefined();
  });

  it('validates GTIN check digits', () => {
    expect(hasValidCheckDigit('3017620422003')).toBe(true);
    expect(hasValidCheckDigit('012345678905')).toBe(true);
    expect(hasValidCheckDigit('96385074')).toBe(true);
    // UPC-E: valid on the expanded UPC-A (042100005264) although the plain EAN-8 check fails
    expect(hasValidCheckDigit('04252614')).toBe(true);
    expect(hasValidCheckDigit('04252615')).toBe(false);
    expect(hasValidCheckDigit('3017620422004')).toBe(false);
  });
});

describe('Open Food Facts mapping', () => {
  it('scales per-100 g values to one serving', () => {
    const r = itemFromProduct(NUTELLA.code, NUTELLA);
    expect(r.status).toBe('found');
    if (r.status !== 'found') return;
    expect(r.item).toMatchObject({ name: 'Nutella (Ferrero)', grams: 15, calories: 81, proteinG: 0.9, carbsG: 8.6, fatG: 4.6, portionLabel: '1 serving (15 g)' });
    expect(r.item.source).toMatchObject({ kind: 'label', sourced: true });
    expect(r.item.source.label).toContain(NUTELLA.code);
  });

  it('adds the brand when the name does not include it', () => {
    const r = itemFromProduct('1', { ...NUTELLA, product_name: 'Hazelnut spread', brands: 'Acme, Other' });
    expect(r.status === 'found' && r.item.name).toBe('Hazelnut spread (Acme)');
  });

  it('falls back to 100 g when the serving size is unknown', () => {
    const r = itemFromProduct('1', { ...NUTELLA, serving_size: undefined, serving_quantity: undefined });
    expect(r.status === 'found' && r.item).toMatchObject({ grams: 100, calories: 539, portionLabel: '100 g' });
  });

  it('converts kJ when kcal is missing', () => {
    expect(per100gFrom({ energy_100g: 418.4 })?.kcal).toBeCloseTo(100);
    expect(per100gFrom({ proteins_100g: 3 })).toBeUndefined();
  });

  it('parses serving text', () => {
    expect(servingGramsFrom({ serving_size: '1 bar (40g)' })).toBe(40);
    expect(servingGramsFrom({ serving_size: '250 ml' })).toBeUndefined(); // never turn ml into grams
    expect(servingGramsFrom({ serving_quantity: '30' })).toBe(30);
    expect(servingGramsFrom({ serving_size: '2 biscuits' })).toBeUndefined();
  });

  it('reports products without calorie data as incomplete, keeping the name', () => {
    expect(itemFromProduct('1', { product_name: 'Mystery bar', nutriments: {} })).toEqual({ status: 'incomplete', code: '1', name: 'Mystery bar' });
  });
});

describe('lookupBarcode', () => {
  it('calls the v2 product endpoint and sends the User-Agent when given', async () => {
    const f = mockFetch(200, { status: 1, product: NUTELLA });
    const r = await lookupBarcode('3017620422003', { fetchImpl: f as unknown as typeof fetch, userAgent: OFF_USER_AGENT });
    const [url, init] = f.mock.calls[0];
    expect(url.startsWith('https://world.openfoodfacts.org/api/v2/product/3017620422003.json')).toBe(true);
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(OFF_USER_AGENT);
    expect(r.status).toBe('found');
  });

  it('omits the User-Agent on web', async () => {
    const f = mockFetch(200, { status: 1, product: NUTELLA });
    await lookupBarcode('3017620422003', { fetchImpl: f as unknown as typeof fetch });
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)['User-Agent']).toBeUndefined();
  });

  it('handles not found (404 and status 0)', async () => {
    await expect(lookupBarcode('0000000000000', { fetchImpl: mockFetch(404, { status: 0 }) as unknown as typeof fetch })).resolves.toEqual({ status: 'not_found', code: '0000000000000' });
    await expect(lookupBarcode('0000000000000', { fetchImpl: mockFetch(200, { status: 0, status_verbose: 'product not found' }) as unknown as typeof fetch })).resolves.toEqual({ status: 'not_found', code: '0000000000000' });
  });

  it('rejects malformed codes before calling the network', async () => {
    const f = mockFetch(200, {});
    await expect(lookupBarcode('123', { fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(BarcodeError);
    expect(f).not.toHaveBeenCalled();
  });

  it('turns network and server errors into friendly messages', async () => {
    const offline = jest.fn(async () => { throw new TypeError('Network request failed'); });
    await expect(lookupBarcode('3017620422003', { fetchImpl: offline as unknown as typeof fetch })).rejects.toThrow(/connection/);
    await expect(lookupBarcode('3017620422003', { fetchImpl: mockFetch(503, {}) as unknown as typeof fetch })).rejects.toThrow(/503/);
    await expect(lookupBarcode('3017620422003', { fetchImpl: mockFetch(429, {}) as unknown as typeof fetch })).rejects.toThrow(/busy/);
  });
});

describe('candidates', () => {
  it('expands UPC-E', () => {
    expect(expandUpcE('01234565')).toBe('012345000065');
    expect(expandUpcE('96385074')).toBeUndefined();
  });
  it('orders canonical EAN-13 first', () => {
    expect(barcodeCandidates('012345678905')).toEqual(['0012345678905', '012345678905']);
    expect(barcodeCandidates('01234565')).toEqual(['0012345000065', '01234565']);
    expect(barcodeCandidates('03017620422003')).toEqual(['3017620422003', '03017620422003']);
    expect(barcodeCandidates('96385074')).toEqual(['96385074']);
    expect(barcodeCandidates('3017620422003')).toEqual(['3017620422003']);
    expect(barcodeCandidates('12')).toEqual([]);
  });
});

describe('lookupBarcode candidates, timeout, parsing', () => {
  it('tries the next candidate after not_found and keeps the matched code', async () => {
    const f = jest.fn(async (url: string) => {
      const hit = url.includes('/012345678905.json');
      return { ok: true, status: 200, json: async () => (hit ? { status: '1', product: { ...NUTELLA, serving_quantity: '15' } } : { status: 0 }) } as Response;
    });
    const r = await lookupBarcode('012345678905', { fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.status === 'found' && r.item.source.url).toContain('/012345678905');
  });

  it('returns not_found when every candidate misses', async () => {
    const f = mockFetch(404, {});
    expect(await lookupBarcode('012345678905', { fetchImpl: f as unknown as typeof fetch })).toEqual({ status: 'not_found', code: '012345678905' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('maps malformed bodies to the unreadable reply', async () => {
    await expect(lookupBarcode('3017620422003', { fetchImpl: mockFetch(200, 'nope') as unknown as typeof fetch })).rejects.toThrow(/unreadable/);
  });

  it('times out with a BarcodeError but rethrows caller aborts', async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    await expect(lookupBarcode('3017620422003', { fetchImpl: hang as unknown as typeof fetch, timeoutMs: 10 })).rejects.toThrow(/took too long/);
    const ctrl = new AbortController();
    const p = lookupBarcode('3017620422003', { fetchImpl: hang as unknown as typeof fetch, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('lookupBarcodeCached', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, storage: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) } };
  };
  const DAY = 86400000;

  it('hits the cache, then expires found after 30 days', async () => {
    const { storage } = mem();
    let t = 1_000_000;
    const f = mockFetch(200, { status: 1, product: NUTELLA });
    const opts = { fetchImpl: f as unknown as typeof fetch, cache: { storage, now: () => t } };
    await lookupBarcodeCached('3017620422003', opts);
    await lookupBarcodeCached('3017620422003', opts);
    expect(f).toHaveBeenCalledTimes(1);
    t += 29 * DAY;
    await lookupBarcodeCached('3017620422003', opts);
    expect(f).toHaveBeenCalledTimes(1);
    t += 2 * DAY;
    await lookupBarcodeCached('3017620422003', opts);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('expires not_found after 1 day and never caches errors', async () => {
    const { storage } = mem();
    let t = 0;
    const miss = mockFetch(404, {});
    const opts = (f: unknown) => ({ fetchImpl: f as typeof fetch, cache: { storage, now: () => t } });
    await lookupBarcodeCached('3017620422003', opts(miss));
    await lookupBarcodeCached('3017620422003', opts(miss));
    expect(miss).toHaveBeenCalledTimes(1);
    t += 2 * DAY;
    await lookupBarcodeCached('3017620422003', opts(miss));
    expect(miss).toHaveBeenCalledTimes(2);
    const busy = mockFetch(429, {});
    const ok = mockFetch(200, { status: 1, product: NUTELLA });
    const s2 = mem().storage;
    await expect(lookupBarcodeCached('3017620422003', { fetchImpl: busy as unknown as typeof fetch, cache: { storage: s2 } })).rejects.toThrow(/busy/);
    expect((await lookupBarcodeCached('3017620422003', { fetchImpl: ok as unknown as typeof fetch, cache: { storage: s2 } })).status).toBe('found');
  });

  it('falls through when storage throws', async () => {
    const bad = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('y'); } };
    const r = await lookupBarcodeCached('3017620422003', { fetchImpl: mockFetch(200, { status: 1, product: NUTELLA }) as unknown as typeof fetch, cache: { storage: bad } });
    expect(r.status).toBe('found');
  });
});

describe('barcodeCandidates UPC-E gating', () => {
  it('only expands 8-digit codes whose UPC-A check digit holds', () => {
    expect(barcodeCandidates('04252614')).toEqual(['0042100005264', '04252614']);
    expect(barcodeCandidates('04252615')).toEqual(['04252615']);
  });
});
