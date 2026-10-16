import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '../log';
import { barcodeCandidates, lookupBarcode, type BarcodeLookup, type LookupOptions } from './barcode';

/** Local cache of barcode lookups. Errors are never cached. */
export const BARCODE_CACHE_KEY = 'fitapp:barcode-cache:v1';
export const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MISS_TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface BarcodeCacheDeps {
  storage?: CacheStorage;
  now?: () => number;
}

type Entry = { at: number; result: BarcodeLookup };
type CacheMap = Record<string, Entry>;

const ttl = (r: BarcodeLookup) => (r.status === 'found' ? FOUND_TTL_MS : MISS_TTL_MS);

async function readMap(storage: CacheStorage): Promise<CacheMap> {
  try {
    const raw = await storage.getItem(BARCODE_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CacheMap) : {};
  } catch (e) {
    log.warn('barcodeCache', 'could not read barcode cache', e);
    return {};
  }
}

export async function lookupBarcodeCached(rawCode: string, opts: LookupOptions & { cache?: BarcodeCacheDeps } = {}): Promise<BarcodeLookup> {
  const { cache, ...lookupOpts } = opts;
  const storage = cache?.storage ?? AsyncStorage;
  const now = cache?.now ?? Date.now;
  const key = barcodeCandidates(rawCode)[0];
  if (!key) return lookupBarcode(rawCode, lookupOpts); // throws the friendly error

  const map = await readMap(storage);
  const hit = map[key];
  if (hit?.result && typeof hit.at === 'number' && now() - hit.at < ttl(hit.result) && now() >= hit.at) return hit.result;

  const result = await lookupBarcode(rawCode, lookupOpts);
  try {
    const t = now();
    const fresh: CacheMap = {};
    for (const [k, v] of Object.entries(map)) if (v?.result && t - v.at < ttl(v.result)) fresh[k] = v;
    fresh[key] = { at: t, result };
    await storage.setItem(BARCODE_CACHE_KEY, JSON.stringify(fresh));
  } catch (e) {
    log.warn('barcodeCache', 'could not write barcode cache', e);
  }
  return result;
}
