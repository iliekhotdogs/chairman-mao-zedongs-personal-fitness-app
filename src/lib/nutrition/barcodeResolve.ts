import { barcodeCandidates, type BarcodeLookup, type LookupOptions } from './barcode';
import { lookupBarcodeCached } from './barcodeCache';
import { findFdcByGtin, itemFromGtinMatch, type FdcResult } from './lookup';
import { log } from '../log';

export interface ResolveOptions extends LookupOptions {
  /** Test seams. */
  lookup?: (code: string, opts: LookupOptions) => Promise<BarcodeLookup>;
  findGtin?: (codes: string[]) => Promise<FdcResult | undefined>;
  usdaTried?: Set<string>;
}

/** Open Food Facts first (cached); on a miss or no calories, try a USDA branded-food GTIN match. */
const usdaTried = new Set<string>(); // shortcut: per-session only, persist if USDA quota becomes a problem

const USDA_TIMEOUT_MS = 6000;

function withDeadline<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('USDA GTIN lookup timed out')), USDA_TIMEOUT_MS);
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    });
  });
}

export async function resolveBarcode(rawCode: string, opts: ResolveOptions = {}): Promise<BarcodeLookup> {
  const { lookup = lookupBarcodeCached, findGtin = findFdcByGtin, usdaTried: tried = usdaTried, ...rest } = opts;
  const off = await lookup(rawCode, rest);
  if (off.status === 'found') return off;
  // USDA stores the 12-digit UPC-A form; one search (daily quota is shared with text search), zeros are ignored when matching.
  const canon = barcodeCandidates(off.code)[0];
  if (!canon || tried.has(canon) || rest.signal?.aborted) return off;
  tried.add(canon);
  const query = canon.length === 13 && canon.startsWith('0') ? canon.slice(1) : canon;
  try {
    const hit = await withDeadline(findGtin([query]), rest.signal);
    if (hit) return { status: 'found', code: off.code, item: itemFromGtinMatch(hit), per100g: hit.per100g, servingGrams: undefined };
  } catch (e) {
    // Not signed in, offline or rate limited: the OFF answer stands.
    log.warn('barcode', 'USDA GTIN fallback failed', e);
  }
  return off;
}
