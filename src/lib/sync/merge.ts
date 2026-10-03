import type { AppState, SyncedCollection, SyncedSingleton } from '../state';
import { SYNCED_COLLECTIONS, SYNCED_SINGLETONS } from '../state';

/** One row in the server `records` table. */
export interface RemoteRecord {
  collection: SyncedCollection | 'singleton';
  id: string;
  data: unknown;
  updated_at: string;
  deleted: boolean;
}

type Stamped = { id: string; updatedAt: string; deleted?: boolean };

const newer = (a?: string, b?: string) => (a ?? '') > (b ?? '');

/** Last-write-wins merge of remote rows into local state. Pure; easy to test. */
export function mergeRemote(local: AppState, rows: RemoteRecord[]): AppState {
  const next: AppState = { ...local };
  for (const c of SYNCED_COLLECTIONS) {
    const incoming = rows.filter((r) => r.collection === c);
    if (!incoming.length) continue;
    const map = new Map<string, Stamped>((local[c] as Stamped[]).map((x) => [x.id, x]));
    for (const r of incoming) {
      const remote = { ...(r.data as Stamped), id: r.id, updatedAt: r.updated_at, deleted: r.deleted || (r.data as Stamped).deleted };
      const mine = map.get(r.id);
      if (!mine || newer(remote.updatedAt, mine.updatedAt)) map.set(r.id, remote);
    }
    (next as unknown as Record<string, unknown>)[c] = [...map.values()];
  }
  for (const s of SYNCED_SINGLETONS) {
    const r = rows.find((x) => x.collection === 'singleton' && x.id === s);
    if (!r || r.deleted) continue;
    const mine = local[s] as { updatedAt?: string } | undefined;
    if (!mine || newer(r.updated_at, mine.updatedAt)) (next as unknown as Record<string, unknown>)[s] = r.data;
  }
  return next;
}

/** Local changes since `since` as rows to upsert. */
export function localChanges(state: AppState, since: string): RemoteRecord[] {
  const rows: RemoteRecord[] = [];
  for (const c of SYNCED_COLLECTIONS) {
    for (const item of state[c] as Stamped[]) {
      if (item.updatedAt > since) rows.push({ collection: c, id: item.id, data: item, updated_at: item.updatedAt, deleted: Boolean(item.deleted) });
    }
  }
  for (const s of SYNCED_SINGLETONS as readonly SyncedSingleton[]) {
    const v = state[s] as { updatedAt?: string } | undefined;
    if (v?.updatedAt && v.updatedAt > since) rows.push({ collection: 'singleton', id: s, data: v, updated_at: v.updatedAt, deleted: false });
  }
  return rows;
}
