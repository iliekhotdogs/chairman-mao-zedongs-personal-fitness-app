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

/** PostgREST `or=` value quoting: wrap in double quotes, escape `\` and `"`. */
const q = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** PostgREST filter for rows strictly after `(at, collection, id)` in keyset order. */
export function keysetFilter(at: string, collection: string, id: string): string {
  return `synced_at.gt.${q(at)},and(synced_at.eq.${q(at)},collection.gt.${q(collection)}),and(synced_at.eq.${q(at)},collection.eq.${q(collection)},id.gt.${q(id)})`;
}

type PulledRow = RemoteRecord & { synced_at: string };

const isLocalPhoto = (uri?: string) => Boolean(uri && !uri.startsWith('storage:'));

/** Upload local food photos to the user's private folder, returning the updated state. */
async function uploadPhotos(state: AppState, userId: string): Promise<AppState> {
  const sb = supabase();
  if (!sb) return state;
  let changed = false;
  const foodLog = await Promise.all(
    state.foodLog.map(async (e) => {
      if (e.deleted || !isLocalPhoto(e.photoUri)) return e;
      try {
        const blob = await (await fetch(e.photoUri!)).blob();
        const path = `${userId}/${e.id}.jpg`;
        const { error } = await sb.storage.from('food-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (error) {
          log.warn('sync', `Photo upload failed for ${e.id}; will retry.`, error);
          return e;
        }
        changed = true;
        return { ...e, photoUri: `storage:food-photos/${path}`, updatedAt: new Date().toISOString() };
      } catch (err) {
        log.warn('sync', `Photo upload failed for ${e.id}; will retry.`, err);
        return e; // keep the local photo; retry next sync
      }
    }),
  );
  return changed ? { ...state, foodLog } : state;
}

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
  const photoRows = localChanges({ ...withPhotos, foodLog: withPhotos.foodLog.filter((e, i) => e !== state.foodLog[i]) }, cursor.lastPushedAt).filter((r) => r.collection === 'foodLog');
  return { rows: [...photoRows, ...pulled.rows], cursor: { ...pulled.cursor, lastPushedAt: startedAt }, pushed: rows.length, pulled: pulled.rows.length };
}

/**
 * Page through every row after the cursor in `(synced_at, collection, id)` order, until a
 * page comes back short. The pull cursor uses the SERVER timestamp so device clock
 * differences can't skip rows.
 */
export async function pullSince(sb: SupabaseClient, userId: string, cursor: SyncCursor): Promise<{ rows: RemoteRecord[]; cursor: SyncCursor }> {
  const rows: RemoteRecord[] = [];
  let at = cursor.lastPulledAt;
  let col = cursor.lastPulledCollection;
  let id = cursor.lastPulledId;
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const base = sb.from('records').select('collection,id,data,updated_at,deleted,synced_at').eq('user_id', userId);
    // Old cursors have no tie-breaker: re-read rows AT the timestamp (merging is idempotent).
    const filtered = col !== undefined && id !== undefined ? base.or(keysetFilter(at, col, id)) : base.gte('synced_at', at);
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
      at = last.synced_at;
      col = last.collection;
      id = last.id;
    }
    if (batch.length < PULL_PAGE_SIZE) break;
  }
  const next: SyncCursor = { lastPulledAt: at, lastPushedAt: cursor.lastPushedAt };
  if (col !== undefined && id !== undefined) {
    next.lastPulledCollection = col;
    next.lastPulledId = id;
  }
  return { rows, cursor: next };
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
