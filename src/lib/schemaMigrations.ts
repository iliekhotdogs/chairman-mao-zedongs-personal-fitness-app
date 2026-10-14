import { defaultSettings, emptyState, STATE_VERSION, SYNCED_COLLECTIONS, SYNCED_SINGLETONS, type AppState } from './state';
import { validateList, validateSingleton } from './schema';
import { clampFutureStamp } from './sync/merge';
import { log } from './log';

type Raw = Record<string, unknown>;

/**
 * Upgrades for stored state, keyed by the version they upgrade FROM.
 * To change the stored shape: bump STATE_VERSION in state.ts and add
 * `[old]: (s) => upgraded` here. Each step receives the output of the previous one.
 */
export const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // v0: saved before the version field existed. Same shape; just stamp it.
  0: (s) => ({ ...s, version: 1 }),
};

/** Run every migration from the stored version up to `target`. Unknown/newer versions pass through. */
export function migrateState(raw: Raw, target = STATE_VERSION, migrations = MIGRATIONS): Raw {
  let s = raw;
  let v = typeof s.version === 'number' && Number.isInteger(s.version) ? s.version : 0;
  if (v > target) {
    log.warn('state', `Stored state is from a newer app version (${v}); loading what is understood.`);
    return s;
  }
  while (v < target) {
    const step = migrations[v];
    if (!step) {
      log.warn('state', `No migration from state version ${v}; keeping data as-is.`);
      break;
    }
    s = step(s);
    v += 1;
  }
  return { ...s, version: target };
}

/**
 * Turn whatever was read from storage into a valid AppState: migrate, then validate
 * every synced record. Invalid records are dropped and logged rather than crashing.
 */
export function sanitizeState(input: unknown, fallbackDeviceId: string, now = new Date().toISOString()): { state: AppState; dropped: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    log.error('state', 'Stored state is not an object; starting fresh.');
    return { state: emptyState(fallbackDeviceId, now), dropped: 1 };
  }
  const raw = migrateState(input as Raw);
  const deviceId = typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : fallbackDeviceId;
  const base = emptyState(deviceId, now);
  const out: Raw = { ...base, ...raw, deviceId, version: STATE_VERSION };
  const nowMs = Date.parse(now);
  let dropped = 0;

  for (const c of SYNCED_COLLECTIONS) {
    const { items, dropped: n } = validateList<{ updatedAt: string }>(c, raw[c]);
    if (n) log.warn('state', `Dropped ${n} invalid ${c} record(s) from storage.`);
    dropped += n;
    out[c] = items.map((x) => {
      const updatedAt = clampFutureStamp(x.updatedAt, nowMs);
      return updatedAt === x.updatedAt ? x : { ...x, updatedAt };
    });
  }
  for (const s of SYNCED_SINGLETONS) {
    if (raw[s] === undefined) continue;
    const ok = validateSingleton<{ updatedAt?: string }>(s, raw[s]);
    if (!ok) {
      log.warn('state', `Dropped invalid ${s} from storage.`);
      dropped += 1;
    }
    out[s] = ok ? { ...ok, updatedAt: ok.updatedAt ? clampFutureStamp(ok.updatedAt, nowMs) : ok.updatedAt } : s === 'settings' ? defaultSettings() : undefined;
  }
  for (const k of ['integrations', 'insights', 'dismissedInsights'] as const) {
    if (!Array.isArray(out[k])) out[k] = base[k];
  }
  return { state: out as unknown as AppState, dropped };
}

export interface PruneOptions {
  now: string;
  /** Records edited at or before this time are known to be on the server. Omit when sync is off. */
  syncedBefore?: string;
  tombstoneDays?: number;
  chatLimit?: number;
}

/**
 * Keep the single stored state blob from growing forever: drop old tombstones that the
 * server already has, and keep only the most recent chat messages on this device.
 * Nothing that still needs to be uploaded is removed.
 */
export function pruneState(state: AppState, { now, syncedBefore, tombstoneDays = 30, chatLimit = 500 }: PruneOptions): AppState {
  const cutoff = new Date(Date.parse(now) - tombstoneDays * 86_400_000).toISOString();
  const synced = (updatedAt: string) => syncedBefore === undefined || updatedAt <= syncedBefore;
  let changed = false;
  const next: Raw = { ...state };
  for (const c of SYNCED_COLLECTIONS) {
    const list = state[c] as { deleted?: boolean; updatedAt: string }[];
    const kept = list.filter((x) => !(x.deleted && x.updatedAt < cutoff && synced(x.updatedAt)));
    if (kept.length !== list.length) {
      next[c] = kept;
      changed = true;
    }
  }
  const chat = next.chat as AppState['chat'];
  const live = chat.filter((m) => !m.deleted);
  if (live.length > chatLimit) {
    const keep = new Set(
      [...live].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, chatLimit).map((m) => m.id),
    );
    // Old messages are dropped only once they are on the server (they stay there).
    next.chat = chat.filter((m) => m.deleted || keep.has(m.id) || !synced(m.updatedAt));
    changed = changed || (next.chat as unknown[]).length !== chat.length;
  }
  return changed ? (next as unknown as AppState) : state;
}
