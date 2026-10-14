import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppState } from '../state';
import { log } from '../log';
import { readLocalPhoto } from '../photo';
import { reducer, type Action } from '../reducer';
import { localChanges, PHOTO_BUCKET, PHOTO_FIELD, pendingStorageRemovals, type PhotoUpload, type RemoteRecord } from './merge';
import { supabase } from './supabase';

export interface SyncCursor {
  /** Server `synced_at` of the last row pulled. */
  lastPulledAt: string;
  /** Device time when the last successful push started. */
  lastPushedAt: string;
  /**
   * Tie-breakers for the keyset cursor `(synced_at, collection, id)`. Many rows from one
   * batch upsert share a `synced_at`, so a timestamp alone would skip rows at a page
   * boundary. Absent in cursors saved by older app versions.
   */
  lastPulledCollection?: string;
  lastPulledId?: string;
  /**
   * Server time before which every row was already visible to a finished pull (database
   * clock at pull start minus SETTLE_WINDOW_MS). A transaction can commit rows stamped a
   * little before the cursor after another device passed it; the next pull re-reads rows
   * from here so those late commits are not skipped. Absent in older cursors.
   */
  settledAt?: string;
}

export const EMPTY_CURSOR: SyncCursor = { lastPulledAt: '1970-01-01T00:00:00.000Z', lastPushedAt: '1970-01-01T00:00:00.000Z' };

/** Parse a stored cursor, accepting the old `{lastPulledAt,lastPushedAt}` format. */
export function parseCursor(raw: string | null | undefined): SyncCursor {
  if (!raw) return EMPTY_CURSOR;
  try {
    const v = JSON.parse(raw) as Partial<SyncCursor>;
    if (typeof v?.lastPulledAt !== 'string' || typeof v.lastPushedAt !== 'string') return EMPTY_CURSOR;
    const tie = typeof v.lastPulledCollection === 'string' && typeof v.lastPulledId === 'string';
    return {
      lastPulledAt: v.lastPulledAt,
      lastPushedAt: v.lastPushedAt,
      ...(tie ? { lastPulledCollection: v.lastPulledCollection, lastPulledId: v.lastPulledId } : {}),
      ...(typeof v.settledAt === 'string' ? { settledAt: v.settledAt } : {}),
    };
  } catch (e) {
    log.warn('sync', 'Stored sync cursor was unreadable; doing a full pull.', e);
    return EMPTY_CURSOR;
  }
}

/** Rows per pull request. Supabase caps responses at 1000 rows by default. */
export const PULL_PAGE_SIZE = 1000;
/** Safety stop for one sync; the next sync resumes from the saved cursor. */
const MAX_PULL_PAGES = 50;

/**
 * How long after its `synced_at` stamp a row may still be uncommitted. Longer than
 * Supabase's 8 s statement timeout for API roles, so any write from the app has committed
 * (or failed) by then. See supabase/migrations/20261014000200_records_synced_at_clock.sql.
 */
export const SETTLE_WINDOW_MS = 15_000;

/** Milliseconds for a Postgres/ISO timestamp. Fractions beyond milliseconds are dropped
 * first, because not every JS engine parses microseconds. NaN if unreadable. */
export function timestampMs(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
}

const shiftIso = (value: string, ms: number) => new Date(timestampMs(value) + ms).toISOString();

/** The database clock, or undefined if the `server_time` RPC is missing (migration not applied) or fails. */
async function serverTime(sb: SupabaseClient): Promise<string | undefined> {
  try {
    const { data, error } = await sb.rpc('server_time');
    if (!error && typeof data === 'string' && Number.isFinite(timestampMs(data))) return data;
    log.warn('sync', 'server_time is unavailable; re-reading a fixed window before the cursor instead.', error);
  } catch (e) {
    log.warn('sync', 'server_time is unavailable; re-reading a fixed window before the cursor instead.', e);
  }
  return undefined;
}

/** PostgREST `or=` value quoting: wrap in double quotes, escape `\` and `"`. */
const q = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** PostgREST filter for rows strictly after `(at, collection, id)` in keyset order. */
export function keysetFilter(at: string, collection: string, id: string): string {
  return `synced_at.gt.${q(at)},and(synced_at.eq.${q(at)},collection.gt.${q(collection)}),and(synced_at.eq.${q(at)},collection.eq.${q(collection)},id.gt.${q(id)})`;
}

type PulledRow = RemoteRecord & { synced_at: string };

/** Bucket API used for photos (narrowed so tests can fake it). */
type PhotoBucket = Pick<ReturnType<SupabaseClient['storage']['from']>, 'upload' | 'info' | 'remove'>;

/**
 * Local state access for a sync. Uploads take a while, so sync re-reads state after them
 * and records their results with targeted actions instead of returning a stale copy.
 */
export interface SyncStore {
  /** The current local state. */
  get(): AppState;
  dispatch(action: Action): void;
}

/** A store over a plain state object (tests, and callers without a live store). */
export function memoryStore(initial: AppState): SyncStore & { state: AppState } {
  const store = {
    state: initial,
    get: () => store.state,
    dispatch: (action: Action) => {
      store.state = reducer(store.state, action);
    },
  };
  return store;
}

/** Zero-byte photos are reported once per session, not on every sync. */
const reportedEmpty = new Set<string>();

/**
 * Upload one local photo. Returns false when it is not on this device (skipped quietly:
 * another device's path), is empty, or the upload failed (kept local, retried next sync).
 */
async function uploadOne(bucket: PhotoBucket, path: string, uri: string, id: string): Promise<boolean> {
  const photo = await readLocalPhoto(uri);
  if (!photo) return false;
  if (!photo.size) {
    if (!reportedEmpty.has(id)) log.warn('sync', `Photo for ${id} is empty on this device; not uploading it.`);
    reportedEmpty.add(id);
    return false;
  }
  const { data, error } = await bucket.upload(path, photo.body, { contentType: 'image/jpeg', upsert: true });
  if (error || !data?.path) {
    log.warn('sync', `Photo upload failed for ${id}; will retry.`, error);
    return false;
  }
  // A stored object of 0 bytes means the body did not make it (React Native Blob bodies
  // upload empty). If the check itself fails, trust the successful upload.
  try {
    const info = await bucket.info(path);
    if (!info.error && info.data?.size === 0) {
      log.warn('sync', `Photo upload for ${id} arrived empty; will retry.`);
      return false;
    }
  } catch (e) {
    log.warn('sync', `Could not check the uploaded photo for ${id}.`, e);
  }
  return true;
}

/**
 * Upload the local photos of live records in `state` to the user's private folder. Only
 * successful uploads are returned; the caller applies them to the CURRENT state.
 */
async function uploadPhotos(bucket: PhotoBucket, state: AppState, userId: string): Promise<PhotoUpload[]> {
  const jobs: Promise<PhotoUpload | undefined>[] = [];
  for (const c of ['foodLog', 'progressPhotos'] as const) {
    const list = state[c] as unknown as ({ id: string; deleted?: boolean } & Record<string, unknown>)[] | undefined;
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const uri = e[PHOTO_FIELD[c]];
      if (e.deleted || typeof uri !== 'string' || !uri || uri.startsWith('storage:')) continue;
      const path = c === 'foodLog' ? `${userId}/${e.id}.jpg` : `${userId}/progress/${e.id}.jpg`;
      jobs.push(
        uploadOne(bucket, path, uri, e.id).then(
          (ok): PhotoUpload | undefined => (ok ? { collection: c, id: e.id, from: uri, to: `storage:${PHOTO_BUCKET}/${path}` } : undefined),
          (err) => {
            log.warn('sync', `Photo upload failed for ${e.id}; will retry.`, err);
            return undefined;
          },
        ),
      );
    }
  }
  return (await Promise.all(jobs)).filter((u): u is PhotoUpload => u !== undefined);
}

/**
 * Remove the cloud copies of deleted photos. Failures are logged and retried next sync.
 * Paths outside the user's folder can't be theirs (RLS refuses them), so they are dropped.
 */
async function removeDeletedPhotos(bucket: PhotoBucket, store: SyncStore, userId: string): Promise<void> {
  const pending = pendingStorageRemovals(store.get());
  if (!pending.length) return;
  const own = pending.filter((p) => p.path.startsWith(`${userId}/`));
  let done = pending.filter((p) => !p.path.startsWith(`${userId}/`));
  if (own.length) {
    try {
      const { error } = await bucket.remove([...new Set(own.map((p) => p.path))]);
      if (error) log.warn('sync', `Could not remove ${own.length} deleted photo(s) from the cloud; will retry.`, error);
      else done = [...done, ...own];
    } catch (e) {
      log.warn('sync', `Could not remove ${own.length} deleted photo(s) from the cloud; will retry.`, e);
    }
  }
  if (done.length) store.dispatch({ type: 'STORAGE_REMOVED', removed: done });
}

/** Rows per upsert request. */
export const PUSH_CHUNK_SIZE = 200;

/**
 * Postgres errors that reject a row for what it IS, so sending it again can't succeed:
 * check violations (`records_size_check`, `records_collection_check`), the per-account row
 * cap (`raise exception`, P0001), malformed or over-long values, and HTTP 413 (request too
 * large). Anything else (network, timeouts, 5xx, auth) is treated as transient.
 */
const PERMANENT_CODES = new Set(['23514', 'P0001', '22P02', '23502', '22001', '54000']);
type UpsertError = { message: string; code?: string };
const isPermanent = (error: UpsertError, status?: number) => PERMANENT_CODES.has(error.code ?? '') || status === 413;

export interface PushResult {
  pushed: number;
  /** Rows the server refused for good; logged and skipped until they are edited again. */
  rejected: RemoteRecord[];
  /** Rows not stored because of a transient error; sent again next sync. */
  failed: RemoteRecord[];
  error?: string;
}

/**
 * Upsert `rows` in chunks. A chunk refused for a permanent reason is retried row by row, so
 * one bad row can't hold back the rest. A transient error stops the push (the network is
 * probably down) and every row not yet stored is reported as `failed`.
 */
export async function pushRows(sb: SupabaseClient, userId: string, rows: RemoteRecord[], chunkSize = PUSH_CHUNK_SIZE): Promise<PushResult> {
  const out: PushResult = { pushed: 0, rejected: [], failed: [] };
  const send = async (batch: RemoteRecord[]) => {
    const res = await sb.from('records').upsert(
      batch.map((r) => ({ user_id: userId, collection: r.collection, id: r.id, data: r.data, updated_at: r.updated_at, deleted: r.deleted })),
      { onConflict: 'user_id,collection,id' },
    );
    return { error: res.error as UpsertError | null, status: res.status as number | undefined };
  };
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const res = await send(chunk);
    if (!res.error) {
      out.pushed += chunk.length;
      continue;
    }
    if (!isPermanent(res.error, res.status)) {
      out.failed.push(...rows.slice(i));
      out.error = res.error.message;
      return out;
    }
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      const one = await send([row]);
      if (!one.error) {
        out.pushed += 1;
      } else if (isPermanent(one.error, one.status)) {
        out.rejected.push(row);
        log.error('sync', `The server rejected ${row.collection}/${row.id} (${one.error.code ?? one.status ?? 'error'}); skipping it.`, one.error.message);
      } else {
        out.failed.push(...chunk.slice(j), ...rows.slice(i + chunkSize));
        out.error = one.error.message;
        return out;
      }
    }
  }
  return out;
}

export interface SyncResult {
  /** Pulled rows, to merge into the current state. */
  rows: RemoteRecord[];
  cursor: SyncCursor;
  pushed: number;
  pulled: number;
  /** Rows the server refused for good (logged, skipped). */
  rejected: number;
  /** Set when some local changes could not be uploaded; the pull still ran. */
  pushError?: string;
}

/**
 * Two-way sync: upload local photos, push local changes, then pull everything newer than
 * the cursor. Conflicts resolve by last write (updatedAt). Deletions sync as tombstones.
 *
 * Photo uploads are applied to the CURRENT state through `store` (PHOTOS_UPLOADED), and the
 * rows to push are read only after that, so an edit or delete made while photos uploaded is
 * neither overwritten locally nor pushed over with an older copy.
 *
 * The pull runs even when the push fails; the push error is returned as `pushError`.
 *
 * Push cursor: `lastPushedAt` becomes the time the rows were read (minus 1 ms, so an edit
 * stamped in that same millisecond is still sent next time). If rows failed transiently it
 * stays just below the oldest of them, so they are sent again next sync; re-sending rows
 * that did arrive is harmless (same id and updatedAt). Rows the server rejects for good do
 * not hold it back, since they would fail on every sync and block everything after them;
 * they are logged and sent again only once edited.
 */
export async function syncNow(store: SyncStore, userId: string, cursor: SyncCursor): Promise<SyncResult> {
  const sb = supabase();
  if (!sb) throw new Error('Cloud sync is not configured.');
  const bucket: PhotoBucket = sb.storage.from(PHOTO_BUCKET);

  const uploads = await uploadPhotos(bucket, store.get(), userId);
  if (uploads.length) store.dispatch({ type: 'PHOTOS_UPLOADED', uploads, now: new Date().toISOString() });
  await removeDeletedPhotos(bucket, store, userId);

  const readAt = new Date(Date.now() - 1).toISOString();
  const rows = localChanges(store.get(), cursor.lastPushedAt);
  const push: PushResult = rows.length ? await pushRows(sb, userId, rows) : { pushed: 0, rejected: [], failed: [] };
  let lastPushedAt = readAt;
  if (push.failed.length) {
    const oldest = Math.min(...push.failed.map((r) => timestampMs(r.updated_at)));
    const before = Number.isFinite(oldest) ? new Date(oldest - 1).toISOString() : cursor.lastPushedAt;
    lastPushedAt = before > cursor.lastPushedAt ? before : cursor.lastPushedAt;
  }
  const pushError = push.error !== undefined ? `Upload failed: ${push.error}` : undefined;
  if (pushError) log.warn('sync', `${push.failed.length} change(s) were not uploaded; will retry.`, push.error);

  let pulled: { rows: RemoteRecord[]; cursor: SyncCursor };
  try {
    pulled = await pullSince(sb, userId, cursor);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(pushError ? `${pushError}. ${message}` : message);
  }
  return {
    rows: pulled.rows,
    cursor: { ...pulled.cursor, lastPushedAt },
    pushed: push.pushed,
    pulled: pulled.rows.length,
    rejected: push.rejected.length,
    ...(pushError ? { pushError } : {}),
  };
}

/**
 * Page through every row after the cursor in `(synced_at, collection, id)` order, until a
 * page comes back short. The pull cursor uses the SERVER timestamp so device clock
 * differences can't skip rows.
 *
 * Late commits: a row is stamped when written but becomes visible only when its transaction
 * commits, so another device's pull can pass its stamp first. Rows stamped at or after
 * `cursor.settledAt` (or, for older cursors, within SETTLE_WINDOW_MS before the cursor) are
 * therefore read again. Re-reads are harmless: merging is last-write-wins and idempotent.
 */
export async function pullSince(sb: SupabaseClient, userId: string, cursor: SyncCursor): Promise<{ rows: RemoteRecord[]; cursor: SyncCursor }> {
  const rows: RemoteRecord[] = [];
  // Read the database clock BEFORE the first page: everything stamped before
  // (now - window) has committed by now, so this pull is guaranteed to see it.
  const now = await serverTime(sb);
  type Position = { at: string; col?: string; id?: string };
  // `cur` is the saved cursor (only ever moves forward); `pos` is where the next page starts.
  let cur: Position = { at: cursor.lastPulledAt, col: cursor.lastPulledCollection, id: cursor.lastPulledId };
  let pos: Position = cur;
  const settled = cursor.settledAt ?? shiftIso(cur.at, -SETTLE_WINDOW_MS);
  // Rows below `settled` were fully seen. If that point is not past the cursor, rescan from it.
  const rescanFrom = timestampMs(settled) <= timestampMs(cur.at) ? settled : undefined;
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const base = sb.from('records').select('collection,id,data,updated_at,deleted,synced_at').eq('user_id', userId);
    // First page: rescan from the settled point, or (old cursor without tie-breakers) re-read
    // rows AT the timestamp. Later pages continue strictly after the last row read.
    const filtered = page === 0 && rescanFrom !== undefined
      ? base.gte('synced_at', rescanFrom)
      : pos.col === undefined || pos.id === undefined
        ? base.gte('synced_at', pos.at)
        : base.or(keysetFilter(pos.at, pos.col, pos.id));
    const { data, error } = await filtered
      .order('synced_at', { ascending: true })
      .order('collection', { ascending: true })
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (error) throw new Error(`Download failed: ${error.message}`);
    const batch = (data ?? []) as PulledRow[];
    for (const r of batch) rows.push({ collection: r.collection, id: r.id, data: r.data, updated_at: r.updated_at, deleted: r.deleted });
    const last = batch[batch.length - 1];
    if (last) {
      pos = { at: last.synced_at, col: last.collection, id: last.id };
      // A rescan page can end before the saved cursor; never move the cursor backwards.
      if (isAfter(last, cur)) cur = pos;
    }
    if (batch.length < PULL_PAGE_SIZE) break;
  }
  const next: SyncCursor = { lastPulledAt: cur.at, lastPushedAt: cursor.lastPushedAt };
  if (cur.col !== undefined && cur.id !== undefined) {
    next.lastPulledCollection = cur.col;
    next.lastPulledId = cur.id;
  }
  // Without the server clock nothing new is known to have settled; leaving it unset makes the
  // next pull re-read the fixed window before the cursor (keeping a stale point would make
  // every later pull re-read everything since it).
  if (now) next.settledAt = shiftIso(now, -SETTLE_WINDOW_MS);
  return { rows, cursor: next };
}

/** True if the row sorts after the keyset position. */
function isAfter(row: PulledRow, p: { at: string; col?: string; id?: string }): boolean {
  const a = timestampMs(row.synced_at);
  const b = timestampMs(p.at);
  if (a !== b) return a > b;
  // Same millisecond: PostgREST formats every synced_at alike, so the text orders correctly.
  if (row.synced_at !== p.at) return row.synced_at > p.at;
  if (p.col === undefined || p.id === undefined) return true;
  return row.collection > p.col || (row.collection === p.col && row.id > p.id);
}

export async function signedPhotoUrl(uri: string): Promise<string | undefined> {
  if (!uri.startsWith('storage:')) return uri;
  const sb = supabase();
  if (!sb) return undefined;
  const [, rest] = uri.split('storage:');
  const [bucket, ...path] = rest.split('/');
  const { data } = await sb.storage.from(bucket).createSignedUrl(path.join('/'), 3600);
  return data?.signedUrl;
}

const STORAGE_PAGE_SIZE = 1000;

type StorageBucket = Pick<ReturnType<SupabaseClient['storage']['from']>, 'list' | 'remove'>;

/** Every file path under `prefix`, following pagination and recursing into sub-folders. */
export async function listAllPaths(bucket: StorageBucket, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await bucket.list(prefix, { limit: STORAGE_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list photos: ${error.message}`);
    const entries = data ?? [];
    for (const f of entries) {
      const path = `${prefix}/${f.name}`;
      // Folders come back without an id (and without metadata).
      if (f.id === null || f.id === undefined) out.push(...(await listAllPaths(bucket, path)));
      else out.push(path);
    }
    if (entries.length < STORAGE_PAGE_SIZE) return out;
  }
}

/** Delete every cloud record and photo for this user (privacy control). */
export async function deleteCloudData(userId: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const bucket = sb.storage.from('food-photos');
  const paths = await listAllPaths(bucket, userId);
  // Collect first, then delete: deleting while paging by offset would skip files.
  for (let i = 0; i < paths.length; i += STORAGE_PAGE_SIZE) {
    const { error } = await bucket.remove(paths.slice(i, i + STORAGE_PAGE_SIZE));
    if (error) throw new Error(`Photo deletion failed: ${error.message}`);
  }
  const { error } = await sb.from('records').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}
