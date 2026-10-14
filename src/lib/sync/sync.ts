import type { SupabaseClient } from '@supabase/supabase-js';

import type { AppState } from '../state';
import { log } from '../log';
import { localChanges, type RemoteRecord } from './merge';
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

const isLocalPhoto = (uri?: string) => Boolean(uri && !uri.startsWith('storage:'));

/** Synced progress photo (the `progressPhotos` collection; typed loosely so this file
 * does not depend on its exact type). */
type ProgressPhotoLike = { id: string; uri?: string; updatedAt: string; deleted?: boolean };
type WithProgress = AppState & { progressPhotos?: ProgressPhotoLike[] };

/**
 * Upload every local photo in `items` (field `field`) to the user's private folder and
 * point the entry at `storage:food-photos/<path>`. Failures keep the local photo for a retry.
 */
async function uploadList<T extends { id: string; updatedAt: string; deleted?: boolean }>(
  sb: SupabaseClient, items: T[], field: 'photoUri' | 'uri', pathFor: (item: T) => string,
): Promise<{ items: T[]; changed: boolean }> {
  let changed = false;
  const next = await Promise.all(
    items.map(async (e) => {
      const uri = (e as Record<string, unknown>)[field] as string | undefined;
      if (e.deleted || !isLocalPhoto(uri)) return e;
      try {
        const blob = await (await fetch(uri!)).blob();
        const path = pathFor(e);
        const { error } = await sb.storage.from('food-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (error) {
          log.warn('sync', `Photo upload failed for ${e.id}; will retry.`, error);
          return e;
        }
        changed = true;
        return { ...e, [field]: `storage:food-photos/${path}`, updatedAt: new Date().toISOString() };
      } catch (err) {
        log.warn('sync', `Photo upload failed for ${e.id}; will retry.`, err);
        return e; // keep the local photo; retry next sync
      }
    }),
  );
  return { items: next, changed };
}

/** Upload local food and progress photos to the user's private folder, returning the updated state. */
async function uploadPhotos(state: AppState, userId: string): Promise<AppState> {
  const sb = supabase();
  if (!sb) return state;
  const food = await uploadList(sb, state.foodLog, 'photoUri', (e) => `${userId}/${e.id}.jpg`);
  const progressList = (state as WithProgress).progressPhotos;
  const progress = Array.isArray(progressList)
    ? await uploadList(sb, progressList, 'uri', (p) => `${userId}/progress/${p.id}.jpg`)
    : { items: progressList, changed: false };
  if (!food.changed && !progress.changed) return state;
  return { ...state, foodLog: food.items, ...(progress.changed ? { progressPhotos: progress.items } : {}) } as AppState;
}

/** Entries of `after` that differ (by identity) from the same index in `before`. */
const changedEntries = <T,>(after: T[] | undefined, before: T[] | undefined): T[] =>
  Array.isArray(after) ? after.filter((e, i) => e !== before?.[i]) : [];

/** Collections whose photo uploads are merged back as rows. */
const PHOTO_COLLECTIONS = new Set<string>(['foodLog', 'progressPhotos']);

/**
 * Two-way sync: push local changes, then pull everything newer than the cursor.
 * Conflicts resolve by last write (updatedAt). Deletions sync as tombstones.
 */
export async function syncNow(state: AppState, userId: string, cursor: SyncCursor): Promise<{ rows: RemoteRecord[]; cursor: SyncCursor; pushed: number; pulled: number }> {
  const sb = supabase();
  if (!sb) throw new Error('Cloud sync is not configured.');
  const startedAt = new Date().toISOString();

  const withPhotos = await uploadPhotos(state, userId);
  const rows = localChanges(withPhotos, cursor.lastPushedAt);
  if (rows.length) {
    const { error } = await sb.from('records').upsert(
      rows.map((r) => ({ user_id: userId, collection: r.collection, id: r.id, data: r.data, updated_at: r.updated_at, deleted: r.deleted })),
      { onConflict: 'user_id,collection,id' },
    );
    if (error) throw new Error(`Upload failed: ${error.message}`);
  }

  const pulled = await pullSince(sb, userId, cursor);
  // Local photo uploads are returned as rows too, so the caller merges everything into the
  // CURRENT state (edits made during the network call are not lost).
  // (progressPhotos is included once it is a synced collection; see SYNCED_COLLECTIONS.)
  const photoState = {
    ...withPhotos,
    foodLog: changedEntries(withPhotos.foodLog, state.foodLog),
    progressPhotos: changedEntries((withPhotos as WithProgress).progressPhotos, (state as WithProgress).progressPhotos),
  } as AppState;
  const photoRows = localChanges(photoState, cursor.lastPushedAt).filter((r) => PHOTO_COLLECTIONS.has(r.collection));
  return { rows: [...photoRows, ...pulled.rows], cursor: { ...pulled.cursor, lastPushedAt: startedAt }, pushed: rows.length, pulled: pulled.rows.length };
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
