import type { AppState, SyncedCollection, SyncedSingleton } from '../state';
import { SYNCED_COLLECTIONS, SYNCED_SINGLETONS } from '../state';
import { validateRecord, validateSingleton } from '../schema';
import { log } from '../log';

/** One row in the server `records` table. */
export interface RemoteRecord {
  collection: SyncedCollection | 'singleton';
  id: string;
  data: unknown;
  updated_at: string;
  deleted: boolean;
}

type Stamped = { id: string; updatedAt: string; deleted?: boolean };

/** How far ahead of this device's clock an edit time may be before it is treated as clock skew. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Normalise an edit timestamp to ISO-8601 UTC and pull far-future values back to `nowMs`.
 * A device with a fast clock would otherwise "win" every last-write-wins conflict.
 */
export function clampFutureStamp(stamp: string, nowMs = Date.now()): string {
  const t = Date.parse(stamp);
  if (!Number.isFinite(t)) return stamp;
  if (t > nowMs + FUTURE_TOLERANCE_MS) return new Date(nowMs).toISOString();
  return stamp;
}

/** Server timestamps come back as `…+00:00`; compare them in the same format as local ones. */
function normalise(stamp: string, nowMs: number): string {
  const t = Date.parse(stamp);
  if (!Number.isFinite(t)) return stamp;
  return clampFutureStamp(new Date(t).toISOString(), nowMs);
}

const newer = (a?: string, b?: string) => (a ?? '') > (b ?? '');

/**
 * Last-write-wins merge of remote rows into local state. Pure; easy to test.
 * Rows that fail validation are dropped (and logged) instead of corrupting state.
 */
export function mergeRemote(local: AppState, rows: RemoteRecord[], nowMs = Date.now()): AppState {
  if (!rows.length) return local;
  const next: AppState = { ...local };
  let dropped = 0;
  for (const c of SYNCED_COLLECTIONS) {
    const incoming = rows.filter((r) => r.collection === c);
    if (!incoming.length) continue;
    const map = new Map<string, Stamped>((local[c] as Stamped[]).map((x) => [x.id, x]));
    for (const r of incoming) {
      const data = (r.data && typeof r.data === 'object' ? r.data : {}) as Partial<Stamped>;
      const remote = validateRecord<Stamped>(c, { ...data, id: r.id, updatedAt: normalise(r.updated_at, nowMs), deleted: Boolean(r.deleted || data.deleted) });
      if (!remote) {
        dropped += 1;
        continue;
      }
      const mine = map.get(r.id);
      if (!mine || newer(remote.updatedAt, clampFutureStamp(mine.updatedAt, nowMs))) map.set(r.id, remote);
    }
    (next as unknown as Record<string, unknown>)[c] = [...map.values()];
  }
  for (const s of SYNCED_SINGLETONS) {
    const r = rows.find((x) => x.collection === 'singleton' && x.id === s);
    if (!r || r.deleted) continue;
    const updatedAt = normalise(r.updated_at, nowMs);
    const data = validateSingleton<{ updatedAt?: string }>(s, { ...(r.data as object), updatedAt });
    if (!data) {
      dropped += 1;
      continue;
    }
    const mine = local[s] as { updatedAt?: string } | undefined;
    if (!mine || newer(updatedAt, mine.updatedAt && clampFutureStamp(mine.updatedAt, nowMs))) (next as unknown as Record<string, unknown>)[s] = data;
  }
  if (dropped) log.warn('sync', `Ignored ${dropped} invalid record(s) from the server.`);
  return next;
}

/**
 * Local changes since `since` as rows to upsert. Edit times more than a few minutes in the
 * future (a device with a wrong clock) are clamped to now so they can't win every conflict.
 */
export function localChanges(state: AppState, since: string, nowMs = Date.now()): RemoteRecord[] {
  const rows: RemoteRecord[] = [];
  const stamp = <T extends { updatedAt: string }>(item: T): T => {
    const updatedAt = clampFutureStamp(item.updatedAt, nowMs);
    return updatedAt === item.updatedAt ? item : { ...item, updatedAt };
  };
  for (const c of SYNCED_COLLECTIONS) {
    for (const raw of (state[c] ?? []) as Stamped[]) {
      if (!(raw.updatedAt > since)) continue;
      const item = stamp(raw);
      rows.push({ collection: c, id: item.id, data: item, updated_at: item.updatedAt, deleted: Boolean(item.deleted) });
    }
  }
  for (const s of SYNCED_SINGLETONS as readonly SyncedSingleton[]) {
    const v = state[s] as { updatedAt?: string } | undefined;
    if (!v?.updatedAt || !(v.updatedAt > since)) continue;
    const item = stamp(v as { updatedAt: string });
    rows.push({ collection: 'singleton', id: s, data: item, updated_at: item.updatedAt, deleted: false });
  }
  return rows;
}
