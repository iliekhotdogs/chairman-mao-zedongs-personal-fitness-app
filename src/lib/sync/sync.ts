import type { AppState } from '../state';
import { localChanges, type RemoteRecord } from './merge';
import { supabase } from './supabase';

export interface SyncCursor {
  lastPulledAt: string;
  lastPushedAt: string;
}

export const EMPTY_CURSOR: SyncCursor = { lastPulledAt: '1970-01-01T00:00:00.000Z', lastPushedAt: '1970-01-01T00:00:00.000Z' };

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
        if (error) return e;
        changed = true;
        return { ...e, photoUri: `storage:food-photos/${path}`, updatedAt: new Date().toISOString() };
      } catch {
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

  const { data, error } = await sb
    .from('records')
    .select('collection,id,data,updated_at,deleted,synced_at')
    .eq('user_id', userId)
    .gt('synced_at', cursor.lastPulledAt)
    .order('synced_at', { ascending: true })
    .limit(5000);
  if (error) throw new Error(`Download failed: ${error.message}`);
  // Local photo uploads are returned as rows too, so the caller merges everything into the
  // CURRENT state (edits made during the network call are not lost).
  const photoRows = localChanges({ ...withPhotos, foodLog: withPhotos.foodLog.filter((e, i) => e !== state.foodLog[i]) }, cursor.lastPushedAt).filter((r) => r.collection === 'foodLog');
  // Pull cursor uses the SERVER timestamp so device clock differences can't skip rows.
  const maxSynced = (data ?? []).reduce((m: string, r: { synced_at: string }) => (r.synced_at > m ? r.synced_at : m), cursor.lastPulledAt);
  return { rows: [...photoRows, ...((data ?? []) as RemoteRecord[])], cursor: { lastPulledAt: maxSynced, lastPushedAt: startedAt }, pushed: rows.length, pulled: data?.length ?? 0 };
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

/** Delete every cloud record and photo for this user (privacy control). */
export async function deleteCloudData(userId: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { data: files } = await sb.storage.from('food-photos').list(userId, { limit: 1000 });
  if (files?.length) await sb.storage.from('food-photos').remove(files.map((f) => `${userId}/${f.name}`));
  const { error } = await sb.from('records').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}
