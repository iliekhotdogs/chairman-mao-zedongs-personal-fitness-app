import { z } from 'zod';
import type { FoodItem } from '../types';
import { round } from '../units';

/**
 * Packaged-food lookup by barcode via Open Food Facts (free, no key).
 * https://openfoodfacts.github.io/openfoodfacts-server/api/
 * Results are only a starting point: the screen shows them in the item editor and nothing
 * is logged until the user confirms.
 */

export const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'code,product_name,product_name_en,brands,quantity,nutriments,serving_size,serving_quantity,serving_quantity_unit';

/** Native apps should identify themselves to Open Food Facts; browsers don't allow setting it. */
export const OFF_USER_AGENT = 'FitCoach/1.0 (personal fitness app; barcode food logging)';

export type BarcodeLookup =
  | { status: 'found'; code: string; item: FoodItem; per100g: Per100g; servingGrams?: number; brand?: string; packageSize?: string }
  /** The product exists but has no usable calorie data: offer manual entry with the name. */
  | { status: 'incomplete'; code: string; name?: string }
  | { status: 'not_found'; code: string };

/** Macros the product doesn't list stay undefined (never assumed 0). */
export interface Per100g {
  kcal: number;
  p?: number;
  c?: number;
  f?: number;
}

export class BarcodeError extends Error {}

/**
 * Clean up a typed or scanned code. Accepts EAN-8, UPC-A (12), EAN-13 and GTIN-14.
 * Returns undefined when the digits can't be a retail barcode.
 */
export function normalizeBarcode(input: string): string | undefined {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return undefined;
  if (![8, 12, 13, 14].includes(digits.length)) return undefined;
  return digits;
}

/** Expand an 8-digit UPC-E (number system 0/1) to its 12-digit UPC-A; undefined otherwise. */
export function expandUpcE(code: string): string | undefined {
  if (!/^[01]\d{7}$/.test(code)) return undefined;
  const [ns, a, b, c, d, e, f, chk] = code.split('');
  let body: string;
  if ('012'.includes(f)) body = `${a}${b}${f}00` + `00${c}${d}${e}`;
  else if (f === '3') body = `${a}${b}${c}00` + `000${d}${e}`;
  else if (f === '4') body = `${a}${b}${c}${d}0` + `0000${e}`;
  else body = `${a}${b}${c}${d}${e}` + `0000${f}`;
  return `${ns}${body}${chk}`;
}

/** Lookup candidates: canonical EAN-13 first, then the raw code if different. */
export function barcodeCandidates(input: string): string[] {
  const code = normalizeBarcode(input);
  if (!code) return [];
  let canon = code;
  if (code.length === 12) canon = `0${code}`;
  else if (code.length === 14 && code.startsWith('0')) canon = code.slice(1);
  else if (code.length === 8) {
    const upcA = expandUpcE(code);
    // An EAN-8 can also start with 0/1; only treat it as UPC-E when the expanded UPC-A check digit holds.
    if (upcA && mod10Valid(upcA)) canon = `0${upcA}`;
  }
  return canon === code ? [code] : [canon, code];
}

function mod10Valid(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** GTIN mod-10 check digit validation (EAN-8/UPC-A/EAN-13/GTIN-14; UPC-E is checked on its UPC-A expansion). */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  if (mod10Valid(code)) return true;
  const upcA = expandUpcE(code);
  return !!upcA && mod10Valid(upcA);
}

type Nutriments = Record<string, number | string | undefined>;

const looseStr = z.string().optional().catch(undefined);
const looseNum = z.union([z.number(), z.string()]).optional().catch(undefined);
const offProductSchema = z.object({
  code: looseStr,
  product_name: looseStr,
  product_name_en: looseStr,
  brands: looseStr,
  quantity: looseStr,
  nutriments: z.record(z.string(), looseNum).optional().catch(undefined),
  serving_size: looseStr,
  serving_quantity: looseNum,
  serving_quantity_unit: looseStr,
});
const offResponseSchema = z.object({
  status: looseNum,
  product: offProductSchema.optional().catch(undefined),
});

type OffProduct = z.infer<typeof offProductSchema>;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Per-100 g values. Energy may only be given in kJ. Returns undefined without calories. */
export function per100gFrom(n: Nutriments | undefined): Per100g | undefined {
  if (!n) return undefined;
  // `energy_100g` is always kJ in Open Food Facts.
  const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
  const kcal = num(n['energy-kcal_100g']) ?? (kj !== undefined ? kj / 4.184 : undefined);
  if (kcal === undefined) return undefined;
  return { kcal, p: num(n['proteins_100g']), c: num(n['carbohydrates_100g']), f: num(n['fat_100g']) };
}

/** One serving from `serving_quantity` or text like "30 g", "1 bar (40g)", "250 ml". Millilitres are never turned into grams. */
export function servingFrom(p: Pick<OffProduct, 'serving_quantity' | 'serving_size' | 'serving_quantity_unit'>): { amount: number; unit: 'g' | 'ml' } | undefined {
  const textUnit = /\d\s*ml\b/i.test(p.serving_size ?? '') ? 'ml' : 'g';
  const unit = p.serving_quantity_unit === 'ml' || (!p.serving_quantity_unit && textUnit === 'ml') ? 'ml' : 'g';
  const q = num(p.serving_quantity);
  if (q && q > 0 && q < 2000) return { amount: q, unit };
  const m = p.serving_size?.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|ml)\b/);
  const g = m ? num(m[1]) : undefined;
  return g && g > 0 && g < 2000 ? { amount: g, unit: m![2] === 'ml' ? 'ml' : 'g' } : undefined;
}

export function servingGramsFrom(p: Pick<OffProduct, 'serving_quantity' | 'serving_size' | 'serving_quantity_unit'>): number | undefined {
  const s = servingFrom(p);
  return s?.unit === 'g' ? s.amount : undefined;
}

export function productName(p: OffProduct): string | undefined {
  const name = (p.product_name || p.product_name_en || '').trim();
  const brand = p.brands?.split(',')[0]?.trim();
  if (!name) return brand ? `${brand} product` : undefined;
  return brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name;
}

/** Map an Open Food Facts product to a food item for one serving (or 100 g when unknown). */
export function itemFromProduct(code: string, p: OffProduct): BarcodeLookup {
  const name = productName(p);
  const per100g = per100gFrom(p.nutriments);
  if (!per100g) return { status: 'incomplete', code, name };
  const serving = servingFrom(p);
  // OFF's *_100g values are per 100 ml for drinks, so scaling by ml is fine; only grams get a weight.
  const k = (serving?.amount ?? 100) / 100;
  const portionLabel = serving ? `1 serving (${p.serving_size?.trim() || `${round(serving.amount)} ${serving.unit}`})` : '100 g';
  const missing = (['p', 'c', 'f'] as const).filter((m) => per100g[m] === undefined).map((m) => ({ p: 'proteinG', c: 'carbsG', f: 'fatG' } as const)[m]);
  const item: FoodItem = {
    name: name ?? `Product ${code}`,
    portionLabel,
    grams: serving ? (serving.unit === 'g' ? round(serving.amount) : undefined) : 100,
    calories: Math.round(per100g.kcal * k),
    proteinG: round((per100g.p ?? 0) * k, 1),
    carbsG: round((per100g.c ?? 0) * k, 1),
    fatG: round((per100g.f ?? 0) * k, 1),
    ...(missing.length ? { missing } : {}),
    source: { kind: 'label', sourced: true, label: `Open Food Facts #${code} (package label data)`, url: `https://world.openfoodfacts.org/product/${code}` },
  };
  return { status: 'found', code, item, per100g, servingGrams: serving?.unit === 'g' ? serving.amount : undefined, brand: p.brands?.split(',')[0]?.trim() || undefined, packageSize: p.quantity?.trim() || undefined };
}

export interface LookupOptions {
  /** Send on native only; browsers forbid setting User-Agent. */
  userAgent?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Give up after this long (default 8000 ms). */
  timeoutMs?: number;
}

async function lookupOne(code: string, doFetch: typeof fetch, headers: Record<string, string>, signal: AbortSignal): Promise<BarcodeLookup> {
  let res: Response;
  try {
    res = await doFetch(`${OFF_PRODUCT_URL}${code}.json?fields=${FIELDS}`, { headers, signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new BarcodeError('Could not reach Open Food Facts. Check your connection, or enter the food by hand.');
  }
  if (res.status === 404) return { status: 'not_found', code };
  if (res.status === 429) throw new BarcodeError('Open Food Facts is busy right now. Try again in a minute.');
  if (!res.ok) throw new BarcodeError(`Product lookup failed (${res.status}). Try again, or enter the food by hand.`);
  let body: z.infer<typeof offResponseSchema>;
  try {
    body = offResponseSchema.parse(await res.json());
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new BarcodeError('Open Food Facts sent an unreadable reply. Try again, or enter the food by hand.');
  }
  if (Number(body.status) !== 1 || !body.product) return { status: 'not_found', code };
  return itemFromProduct(code, body.product);
}

export async function lookupBarcode(rawCode: string, opts: LookupOptions = {}): Promise<BarcodeLookup> {
  const candidates = barcodeCandidates(rawCode);
  if (!candidates.length) throw new BarcodeError('Barcodes are 8, 12, 13 or 14 digits. Check the number and try again.');
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent;

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? 8000);
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener('abort', onAbort);
  try {
    let last: BarcodeLookup | undefined;
    for (const code of candidates) {
      const r = await lookupOne(code, doFetch, headers, ctrl.signal);
      if (r.status === 'found') return r;
      // prefer reporting 'incomplete' (product exists) over a later not_found
      if (!last || last.status === 'not_found') last = r;
    }
    return last ?? { status: 'not_found', code: candidates[0] };
  } catch (e) {
    if (timedOut && (e as Error)?.name === 'AbortError') {
      throw new BarcodeError('Open Food Facts took too long to answer. Try again, or enter the food by hand.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
