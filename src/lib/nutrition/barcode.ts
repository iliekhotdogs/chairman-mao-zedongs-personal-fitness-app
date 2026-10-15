import type { FoodItem } from '../types';
import { round } from '../units';

/**
 * Packaged-food lookup by barcode via Open Food Facts (free, no key).
 * https://openfoodfacts.github.io/openfoodfacts-server/api/
 * Results are only a starting point: the screen shows them in the item editor and nothing
 * is logged until the user confirms.
 */

export const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit';

/** Native apps should identify themselves to Open Food Facts; browsers don't allow setting it. */
export const OFF_USER_AGENT = 'FitCoach/1.0 (personal fitness app; barcode food logging)';

export type BarcodeLookup =
  | { status: 'found'; code: string; item: FoodItem; per100g: Per100g; servingGrams?: number }
  /** The product exists but has no usable calorie data: offer manual entry with the name. */
  | { status: 'incomplete'; code: string; name?: string }
  | { status: 'not_found'; code: string };

export interface Per100g {
  kcal: number;
  p: number;
  c: number;
  f: number;
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

/** GTIN mod-10 check digit validation (EAN-8/UPC-A/EAN-13/GTIN-14). */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

type Nutriments = Record<string, number | string | undefined>;

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  nutriments?: Nutriments;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
}

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
  return { kcal, p: num(n['proteins_100g']) ?? 0, c: num(n['carbohydrates_100g']) ?? 0, f: num(n['fat_100g']) ?? 0 };
}

/** Grams in one serving from `serving_quantity` or text like "30 g", "1 bar (40g)", "250 ml". */
export function servingGramsFrom(p: Pick<OffProduct, 'serving_quantity' | 'serving_size'>): number | undefined {
  const q = num(p.serving_quantity);
  if (q && q > 0 && q < 2000) return q;
  const m = p.serving_size?.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|ml)\b/);
  const g = m ? num(m[1]) : undefined;
  return g && g > 0 && g < 2000 ? g : undefined;
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
  const servingGrams = servingGramsFrom(p);
  const grams = servingGrams ?? 100;
  const k = grams / 100;
  const unit = p.serving_quantity_unit === 'ml' || /ml\b/i.test(p.serving_size ?? '') ? 'ml' : 'g';
  const portionLabel = servingGrams ? `1 serving (${p.serving_size?.trim() || `${round(grams)} ${unit}`})` : '100 g';
  const item: FoodItem = {
    name: name ?? `Product ${code}`,
    portionLabel,
    grams: round(grams),
    calories: Math.round(per100g.kcal * k),
    proteinG: round(per100g.p * k, 1),
    carbsG: round(per100g.c * k, 1),
    fatG: round(per100g.f * k, 1),
    source: { kind: 'label', sourced: true, label: `Open Food Facts #${code} (package label data)`, url: `https://world.openfoodfacts.org/product/${code}` },
  };
  return { status: 'found', code, item, per100g, servingGrams };
}

export interface LookupOptions {
  /** Send on native only; browsers forbid setting User-Agent. */
  userAgent?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function lookupBarcode(rawCode: string, opts: LookupOptions = {}): Promise<BarcodeLookup> {
  const code = normalizeBarcode(rawCode);
  if (!code) throw new BarcodeError('Barcodes are 8, 12, 13 or 14 digits. Check the number and try again.');
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent;
  let res: Response;
  try {
    res = await doFetch(`${OFF_PRODUCT_URL}${code}.json?fields=${FIELDS}`, { headers, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new BarcodeError('Could not reach Open Food Facts. Check your connection, or enter the food by hand.');
  }
  if (res.status === 404) return { status: 'not_found', code };
  if (res.status === 429) throw new BarcodeError('Open Food Facts is busy right now. Try again in a minute.');
  if (!res.ok) throw new BarcodeError(`Product lookup failed (${res.status}). Try again, or enter the food by hand.`);
  let body: { status?: number; product?: OffProduct };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new BarcodeError('Open Food Facts sent an unreadable reply. Try again, or enter the food by hand.');
  }
  if (body.status !== 1 || !body.product) return { status: 'not_found', code };
  return itemFromProduct(code, body.product);
}
