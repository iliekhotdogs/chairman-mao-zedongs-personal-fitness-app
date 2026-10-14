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
      if (!mine || newer(remote.updatedAt, clampFutureStamp(mine.updatedAt, nowMs))) {
        // Tombstones from older app versions still carry the photo; drop it, and remember a
        // cloud copy (ours or theirs) so this device can remove it from Storage.
        map.set(r.id, remote.deleted && isPhotoCollection(c) ? stripTombstone(c, remote, remote.updatedAt, mine) : remote);
      }
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

// ---------------------------------------------------------------------------
// Photos: tombstones, uploads and cloud clean-up
// ---------------------------------------------------------------------------

/** Collections whose records carry a photo (`foodLog.photoUri`, `progressPhotos.uri`). */
export type PhotoCollection = 'foodLog' | 'progressPhotos';
export const PHOTO_FIELD: Record<PhotoCollection, 'photoUri' | 'uri'> = { foodLog: 'photoUri', progressPhotos: 'uri' };
export const isPhotoCollection = (c: string): c is PhotoCollection => c === 'foodLog' || c === 'progressPhotos';

/** Cloud photos live in this bucket and are referenced as `storage:food-photos/<path>`. */
export const PHOTO_BUCKET = 'food-photos';
const STORAGE_URI_PREFIX = `storage:${PHOTO_BUCKET}/`;

/** The object path inside the photo bucket for a `storage:food-photos/<path>` uri. */
export function storagePathOf(uri: unknown): string | undefined {
  return typeof uri === 'string' && uri.startsWith(STORAGE_URI_PREFIX) && uri.length > STORAGE_URI_PREFIX.length
    ? uri.slice(STORAGE_URI_PREFIX.length)
    : undefined;
}

/**
 * Tombstone fields. `storagePath` marks a cloud photo that still has to be removed from
 * Storage; sync removes it and then clears the field (see `pendingStorageRemovals`).
 */
type Tomb = Stamped & { storagePath?: string };
type Loose = Record<string, unknown>;

/**
 * A deleted photo record without its payload: a deleted progress photo keeps only its
 * identity and date (the uri, which on web is the whole image as a data: URL, the note and
 * the weight are dropped); a deleted meal loses its photo and photo hint. A cloud copy is
 * remembered in `storagePath` (from this record, or from `previous`, the local version it
 * replaces) so it can be removed from Storage. Tombstones validate with only id/updatedAt.
 */
export function stripTombstone<T extends Stamped>(collection: PhotoCollection, item: T, now: string, previous?: Stamped): T {
  const it = item as unknown as Loose;
  const field = PHOTO_FIELD[collection];
  const storagePath =
    storagePathOf(it[field]) ?? (typeof it.storagePath === 'string' ? it.storagePath : undefined) ?? storagePathOf((previous as Loose | undefined)?.[field]);
  if (collection === 'progressPhotos') {
    return {
      id: item.id,
      updatedAt: now,
      deleted: true,
      date: typeof it.date === 'string' ? it.date : '',
      uri: '',
      ...(storagePath ? { storagePath } : {}),
    } as unknown as T;
  }
  const { photoUri: _photo, hint: _hint, storagePath: _old, ...rest } = it;
  return { ...rest, deleted: true, updatedAt: now, ...(storagePath ? { storagePath } : {}) } as unknown as T;
}

/** Delete record `id` of a photo collection as a stripped tombstone. */
export function deletePhotoRecord<T extends Stamped>(list: T[], collection: PhotoCollection, id: string, now: string): T[] {
  return list.map((x) => (x.id === id ? stripTombstone(collection, x, now) : x));
}

/** A finished upload of a local photo to `storage:food-photos/<path>`. */
export interface PhotoUpload {
  collection: PhotoCollection;
  id: string;
  /** The local uri that was uploaded. */
  from: string;
  /** The `storage:` uri it now lives at. */
  to: string;
}

/**
 * Point records at their uploaded photos, against the CURRENT state (uploads take a while):
 *  - only a live record whose photo is still the uploaded local file is changed, and only
 *    its photo field; it is re-stamped so the next push carries the cloud uri;
 *  - a record deleted meanwhile stays deleted; the just-uploaded object is marked for removal;
 *  - a record whose photo changed, or that is gone, is left alone.
 */
export function applyPhotoUploads(state: AppState, uploads: PhotoUpload[], now: string): AppState {
  if (!uploads.length) return state;
  const next: AppState = { ...state };
  let any = false;
  for (const c of ['foodLog', 'progressPhotos'] as const) {
    const mine = uploads.filter((u) => u.collection === c);
    const list = state[c] as unknown as Loose[] | undefined;
    if (!mine.length || !Array.isArray(list)) continue;
    const byId = new Map(mine.map((u) => [u.id, u]));
    let changed = false;
    const updated = list.map((x) => {
      const u = byId.get(x.id as string);
      if (!u) return x;
      if (x.deleted) {
        const path = storagePathOf(u.to);
        if (!path || x.storagePath === path) return x;
        changed = true;
        return { ...x, storagePath: path };
      }
      if (x[PHOTO_FIELD[c]] !== u.from) return x;
      changed = true;
      return { ...x, [PHOTO_FIELD[c]]: u.to, updatedAt: now };
    });
    if (changed) {
      (next as unknown as Loose)[c] = updated;
      any = true;
    }
  }
  return any ? next : state;
}

/** A cloud photo of a deleted record that still has to be removed from Storage. */
export interface StorageRemoval {
  collection: PhotoCollection;
  id: string;
  path: string;
}

export function pendingStorageRemovals(state: AppState): StorageRemoval[] {
  const out: StorageRemoval[] = [];
  for (const c of ['foodLog', 'progressPhotos'] as const) {
    for (const x of ((state[c] ?? []) as unknown as Tomb[])) {
      if (x.deleted && typeof x.storagePath === 'string' && x.storagePath) out.push({ collection: c, id: x.id, path: x.storagePath });
    }
  }
  return out;
}

/** Forget removals that are done. Not re-stamped: this is local bookkeeping, not an edit. */
export function clearStorageRemovals(state: AppState, done: StorageRemoval[]): AppState {
  if (!done.length) return state;
  const next: AppState = { ...state };
  for (const c of ['foodLog', 'progressPhotos'] as const) {
    const mine = done.filter((d) => d.collection === c);
    if (!mine.length || !Array.isArray(state[c])) continue;
    (next as unknown as Loose)[c] = (state[c] as unknown as Tomb[]).map((x) => {
      if (!x.deleted || !mine.some((d) => d.id === x.id && d.path === x.storagePath)) return x;
      const { storagePath: _done, ...rest } = x;
      return rest;
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Importing data saved on this device before the user had an account
// ---------------------------------------------------------------------------

/**
 * Merge earlier device-only data into the signed-in account's state. Every imported record
 * and document is stamped `now`, so the next push uploads all of it (its old edit times are
 * before the account's push cursor and would never be sent), and it is merged per id into
 * the state already pulled from the account (last write wins), so nothing pulled is lost.
 * Deleted local records are not imported.
 */
export function importLegacyState(current: AppState, legacy: AppState, now: string): AppState {
  const restamped = { ...legacy } as unknown as Loose;
  for (const c of SYNCED_COLLECTIONS) {
    const list = legacy[c] as Stamped[] | undefined;
    restamped[c] = Array.isArray(list) ? list.filter((x) => !x.deleted).map((x) => ({ ...x, updatedAt: now })) : [];
  }
  for (const s of SYNCED_SINGLETONS) {
    const v = legacy[s] as object | undefined;
    restamped[s] = v ? { ...v, updatedAt: now } : undefined;
  }
  const rows = localChanges(restamped as unknown as AppState, '', Date.parse(now));
  const merged = mergeRemote(current, rows, Date.parse(now));
  // Device-only bits (not synced) come along too; the account keeps its own device id.
  return {
    ...merged,
    integrations: legacy.integrations ?? merged.integrations,
    dismissedInsights: [...new Set([...(merged.dismissedInsights ?? []), ...(legacy.dismissedInsights ?? [])])],
    activeSessionId: merged.activeSessionId ?? legacy.activeSessionId,
  };
}
