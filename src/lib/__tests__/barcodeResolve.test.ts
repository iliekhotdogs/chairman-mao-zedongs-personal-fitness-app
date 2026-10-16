import { resolveBarcode } from '../nutrition/barcodeResolve';
import type { BarcodeLookup } from '../nutrition/barcode';
import type { FdcResult } from '../nutrition/lookup';
jest.mock('../nutrition/barcodeCache', () => ({ lookupBarcodeCached: jest.fn() })); // avoids loading native AsyncStorage

const hit: FdcResult = { fdcId: 1, description: 'Bar', dataType: 'Branded', gtinUpc: '036000291452', per100g: { kcal: 400, p: 10, c: 50, f: 12 } };
const offFound = { status: 'found', code: '0036000291452', item: { name: 'off' } } as unknown as BarcodeLookup;
const notFound: BarcodeLookup = { status: 'not_found', code: '0036000291452' };
const incomplete: BarcodeLookup = { status: 'incomplete', code: '0036000291452', name: 'Bar' };

describe('resolveBarcode', () => {
  it('skips USDA when OFF has the product', async () => {
    const findGtin = jest.fn();
    expect(await resolveBarcode('036000291452', { lookup: async () => offFound, findGtin, usdaTried: new Set() })).toBe(offFound);
    expect(findGtin).not.toHaveBeenCalled();
  });
  it.each([notFound, incomplete])('uses a USDA hit for %p', async (off) => {
    const r = await resolveBarcode('036000291452', { lookup: async () => off, findGtin: async () => hit, usdaTried: new Set() });
    expect(r.status).toBe('found');
    if (r.status === 'found') {
      expect(r.per100g).toEqual(hit.per100g);
      expect(r.servingGrams).toBeUndefined();
      expect(r.item.calories).toBe(400);
    }
  });
  it('returns the OFF result when USDA throws or misses', async () => {
    expect(await resolveBarcode('x', { lookup: async () => notFound, findGtin: async () => { throw new Error('401'); }, usdaTried: new Set() })).toBe(notFound);
    expect(await resolveBarcode('x', { lookup: async () => incomplete, findGtin: async () => undefined, usdaTried: new Set() })).toBe(incomplete);
  });
  it('queries USDA once with the 12-digit form, and not again for the same code', async () => {
    const findGtin = jest.fn(async () => undefined);
    const usdaTried = new Set<string>();
    await resolveBarcode('036000291452', { lookup: async () => notFound, findGtin, usdaTried });
    await resolveBarcode('036000291452', { lookup: async () => notFound, findGtin, usdaTried });
    expect(findGtin).toHaveBeenCalledTimes(1);
    expect(findGtin).toHaveBeenCalledWith(['036000291452']);
  });
});
