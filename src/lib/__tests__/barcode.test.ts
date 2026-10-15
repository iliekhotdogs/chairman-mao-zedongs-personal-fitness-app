import { hasValidCheckDigit, itemFromProduct, lookupBarcode, normalizeBarcode, OFF_USER_AGENT, per100gFrom, servingGramsFrom, BarcodeError } from '../nutrition/barcode';

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
    expect(servingGramsFrom({ serving_size: '250 ml' })).toBe(250);
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
