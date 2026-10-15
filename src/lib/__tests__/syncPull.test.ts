import { emptyState } from '../state';
import { log } from '../log';
import type { FoodEntry, ProgressPhoto } from '../types';
import {
  EMPTY_CURSOR, keysetFilter, listAllPaths, memoryStore, parseCursor, PULL_PAGE_SIZE, pullSince, PUSH_CHUNK_SIZE, SETTLE_WINDOW_MS, syncNow, timestampMs, type SyncCursor,
} from '../sync/sync';

/**
 * In-memory stand-in for the Supabase `records` table and the subset of the PostgREST
 * query builder that sync uses (eq / gte / or / order / limit / upsert), plus the
 * `server_time` RPC (the database clock).
 */
type Row = { user_id: string; collection: string; id: string; data: unknown; updated_at: string; deleted: boolean; synced_at: string };

/** Split on commas that are not inside quotes or parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted && ch === '\\') { cur += ch + s[++i]; continue; }
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function matchTerm(row: Row, term: string): boolean {
  if (term.startsWith('and(')) return splitTop(term.slice(4, -1)).every((t) => matchTerm(row, t));
  const m = /^(\w+)\.(gt|eq|gte)\.(.*)$/.exec(term);
  if (!m) throw new Error(`unsupported filter ${term}`);
  const [, field, op, rawVal] = m;
  const val = rawVal.startsWith('"') ? rawVal.slice(1, -1).replace(/\\(.)/g, '$1') : rawVal;
  const v = String(row[field as keyof Row]);
  return op === 'gt' ? v > val : op === 'gte' ? v >= val : v === val;
}

let mockTable: Row[] = [];
const mockCalls: { filters: string[] }[] = [];
let mockServerNow = '2026-10-02T12:00:00.000000+00:00';
/** False simulates a database without the server_time function (migration not applied). */
let mockRpcAvailable = true;

function builder() {
  let rows = [...mockTable];
  const orders: string[] = [];
  let limit = Infinity;
  const call = { filters: [] as string[] };
  mockCalls.push(call);
  const b = {
    select: () => b,
    eq: (f: keyof Row, v: string) => { call.filters.push(`eq:${f}`); rows = rows.filter((r) => r[f] === v); return b; },
    gte: (f: keyof Row, v: string) => { call.filters.push(`gte:${f}`); rows = rows.filter((r) => String(r[f]) >= v); return b; },
    or: (expr: string) => { call.filters.push('or'); const terms = splitTop(expr); rows = rows.filter((r) => terms.some((t) => matchTerm(r, t))); return b; },
    order: (f: string) => { orders.push(f); return b; },
    limit: (n: number) => { limit = n; return b; },
    then: (resolve: (v: { data: Row[]; error: null }) => void) => {
      const sorted = rows.sort((a, z) => {
        for (const f of orders) {
          const x = String(a[f as keyof Row]);
          const y = String(z[f as keyof Row]);
          if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
      });
      if (mockPullError) return resolve({ data: null, error: { message: mockPullError } } as never);
      resolve({ data: sorted.slice(0, limit), error: null });
    },
    upsert: async (input: Omit<Row, 'synced_at'>[]) => {
      mockUpsertCalls.push(input.length);
      // Like Postgres: one bad row fails the whole statement.
      for (const r of input) {
        const err = mockRowError(r);
        if (err) return { error: { message: err.message, code: err.code }, status: err.status ?? 400 };
      }
      for (const r of input) {
        mockTable = mockTable.filter((x) => !(x.user_id === r.user_id && x.collection === r.collection && x.id === r.id));
        mockTable.push({ ...r, synced_at: mockServerNow });
      }
      return { error: null, status: 201 };
    },
  };
  return b;
}

/** Per-row upsert failure (none by default). */
let mockRowError: (r: Omit<Row, 'synced_at'>) => { message: string; code?: string; status?: number } | undefined = () => undefined;
const mockUpsertCalls: number[] = [];
let mockPullError: string | undefined;

const mockUploads: string[] = [];
const mockRemoved: string[] = [];
/** Runs while an upload is in flight (simulates the user editing meanwhile). */
let mockDuringUpload: (path: string) => void = () => {};
let mockRemoveError: string | undefined;
let mockStoredSize = 100;
const mockClient = {
  from: () => builder(),
  storage: {
    from: () => ({
      upload: async (path: string) => {
        mockUploads.push(path);
        mockDuringUpload(path);
        return { data: { path, id: 'x', fullPath: `food-photos/${path}` }, error: null };
      },
      info: async () => ({ data: { size: mockStoredSize }, error: null }),
      remove: async (paths: string[]) => {
        if (mockRemoveError) return { data: null, error: { message: mockRemoveError } };
        mockRemoved.push(...paths);
        return { data: [], error: null };
      },
    }),
  },
  rpc: async (name: string) => {
    mockCalls.push({ filters: [`rpc:${name}`] });
    return name === 'server_time' && mockRpcAvailable ? { data: mockServerNow, error: null } : { data: null, error: { message: 'function not found' } };
  },
};
/** Only the table queries (the server_time RPC is counted separately). */
const queries = () => mockCalls.filter((c) => !c.filters.some((f) => f.startsWith('rpc:')));
jest.mock('../sync/supabase', () => ({ supabase: () => mockClient }));
/** Photos "on this device": file:///here/* and data: URLs. Anything else is another device's path. */
jest.mock('../photo', () => ({
  readLocalPhoto: async (uri: string) =>
    uri.startsWith('file:///here/') || uri.startsWith('data:') ? { body: new Uint8Array([1, 2, 3]), size: 3 } : undefined,
}));

const USER = 'user-1';
const TS = '2026-10-02T10:00:00.123456+00:00';
const weightRow = (id: string, synced_at = TS, collection = 'weights'): Row => ({
  user_id: USER, collection, id, synced_at, deleted: false, updated_at: '2026-10-02T09:00:00.000Z',
  data: { id, date: '2026-10-01', weightKg: 80, updatedAt: '2026-10-02T09:00:00.000Z' },
});
const pad = (n: number) => String(n).padStart(5, '0');

beforeEach(() => {
  mockTable = [];
  mockCalls.length = 0;
  mockRpcAvailable = true;
  mockServerNow = '2026-10-02T12:00:00.000000+00:00';
  mockRowError = () => undefined;
  mockUpsertCalls.length = 0;
  mockPullError = undefined;
  mockUploads.length = 0;
  mockRemoved.length = 0;
  mockDuringUpload = () => {};
  mockRemoveError = undefined;
  mockStoredSize = 100;
});

describe('sync pull keyset cursor', () => {
  it('pulls every row when a whole batch shares one synced_at (page-boundary ties)', async () => {
    const n = PULL_PAGE_SIZE * 2 + 37;
    mockTable = Array.from({ length: n }, (_, i) => weightRow(`w${pad(i)}`));
    const { rows, cursor } = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
    expect(rows).toHaveLength(n);
    expect(new Set(rows.map((r) => r.id)).size).toBe(n);
    expect(queries()).toHaveLength(3); // 1000 + 1000 + 37
    expect(cursor).toMatchObject({ lastPulledAt: TS, lastPulledCollection: 'weights', lastPulledId: `w${pad(n - 1)}` });
  });

  it('stops after one request when the first page is short', async () => {
    mockTable = [weightRow('a'), weightRow('b')];
    await pullSince(mockClient as never, USER, EMPTY_CURSOR);
    expect(queries()).toHaveLength(1);
  });

  it('resumes after the last (synced_at, collection, id) and picks up later ties', async () => {
    mockTable = [weightRow('a'), weightRow('b')];
    const first = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
    // Another device lands rows at the same timestamp, sorting after the cursor.
    mockTable.push(weightRow('c'), weightRow('a', TS, 'workoutOverrides'));
    const second = await pullSince(mockClient as never, USER, first.cursor);
    expect(second.rows.map((r) => `${r.collection}/${r.id}`).sort()).toEqual(['weights/c', 'workoutOverrides/a']);
    const third = await pullSince(mockClient as never, USER, second.cursor);
    expect(third.rows).toHaveLength(0);
    expect(third.cursor).toEqual(second.cursor);
  });

  it('only reads the signed-in user\'s rows', async () => {
    mockTable = [weightRow('a'), { ...weightRow('b'), user_id: 'someone-else' }];
    const { rows } = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('an old cursor without tie-breakers re-reads rows at its timestamp instead of skipping them', async () => {
    mockTable = [weightRow('a', '2026-10-02T09:00:00+00:00'), weightRow('b'), weightRow('c')];
    const old: SyncCursor = { lastPulledAt: TS, lastPushedAt: EMPTY_CURSOR.lastPushedAt };
    const { rows, cursor } = await pullSince(mockClient as never, USER, old);
    expect(queries()[0].filters).toContain('gte:synced_at');
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(cursor.lastPulledId).toBe('c');
  });

  // A transaction stamps its rows when it writes them but they become visible only at commit,
  // so another device can pull past a stamp before the row exists for it.
  describe('late commits (synced_at race)', () => {
    const at = (seconds: number) => `2026-10-02T12:00:${String(seconds).padStart(2, '0')}.000000+00:00`;

    it('re-reads the settle window and picks up a row committed after the cursor passed its stamp', async () => {
      mockTable = [weightRow('x', at(10))];
      mockServerNow = at(11);
      const first = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
      expect(first.cursor).toMatchObject({ lastPulledAt: at(10), lastPulledId: 'x' });
      expect(timestampMs(first.cursor.settledAt!)).toBe(timestampMs(at(11)) - SETTLE_WINDOW_MS);

      // Slow transaction: stamped at :08, before the cursor, but committed only now.
      mockTable.push(weightRow('late', at(8)));
      mockServerNow = at(20);
      const second = await pullSince(mockClient as never, USER, first.cursor);
      expect(second.rows.map((r) => r.id)).toContain('late');
      // The cursor never moves backwards because of the rescan.
      expect(second.cursor).toMatchObject({ lastPulledAt: at(10), lastPulledId: 'x' });

      // Once the server clock is past the window, nothing old is read again.
      mockServerNow = at(59);
      const third = await pullSince(mockClient as never, USER, second.cursor);
      expect(timestampMs(third.cursor.settledAt!)).toBeGreaterThan(timestampMs(at(10)));
      const fourth = await pullSince(mockClient as never, USER, third.cursor);
      expect(fourth.rows).toHaveLength(0);
      expect(queries().at(-1)!.filters).toContain('or');
    });

    it('does not re-download settled rows when the cursor is idle', async () => {
      mockTable = [weightRow('a', at(1)), weightRow('b', at(2))];
      mockServerNow = at(50);
      const first = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
      const second = await pullSince(mockClient as never, USER, first.cursor);
      expect(second.rows).toHaveLength(0);
    });

    it('rescans a window larger than one page without skipping or moving the cursor back', async () => {
      const n = PULL_PAGE_SIZE + 250;
      mockTable = Array.from({ length: n }, (_, i) => weightRow(`w${pad(i)}`, at(5)));
      mockServerNow = at(6);
      const first = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
      expect(first.rows).toHaveLength(n);
      // A late commit sorts first inside the window.
      mockTable.push(weightRow('a-late', at(4)));
      mockServerNow = at(7);
      const second = await pullSince(mockClient as never, USER, first.cursor);
      expect(new Set(second.rows.map((r) => r.id)).size).toBe(n + 1);
      expect(second.cursor).toMatchObject({ lastPulledAt: at(5), lastPulledId: `w${pad(n - 1)}` });
    });

    it('without the server_time function, re-reads a fixed window before the cursor', async () => {
      mockRpcAvailable = false;
      mockTable = [weightRow('old', '2026-10-02T11:00:00.000000+00:00'), weightRow('x', at(10))];
      const first = await pullSince(mockClient as never, USER, EMPTY_CURSOR);
      expect(first.cursor.settledAt).toBeUndefined();
      mockTable.push(weightRow('late', at(8)));
      const second = await pullSince(mockClient as never, USER, first.cursor);
      expect(second.rows.map((r) => r.id).sort()).toEqual(['late', 'x']); // 'old' is outside the window
    });
  });

  it('parses Postgres timestamps with microseconds', () => {
    expect(timestampMs('2026-10-02T10:00:00.123456+00:00')).toBe(Date.parse('2026-10-02T10:00:00.123Z'));
    expect(timestampMs('2026-10-02T10:00:00+00:00')).toBe(Date.parse('2026-10-02T10:00:00Z'));
  });

  it('quotes values in the keyset filter', () => {
    expect(keysetFilter('2026-01-01T00:00:00+00:00', 'chat', 'a"b,c')).toBe(
      'synced_at.gt."2026-01-01T00:00:00+00:00",and(synced_at.eq."2026-01-01T00:00:00+00:00",collection.gt."chat"),and(synced_at.eq."2026-01-01T00:00:00+00:00",collection.eq."chat",id.gt."a\\"b,c")',
    );
  });
});

describe('stored cursor format', () => {
  it('accepts the old two-field cursor', () => {
    expect(parseCursor(JSON.stringify({ lastPulledAt: TS, lastPushedAt: TS }))).toEqual({ lastPulledAt: TS, lastPushedAt: TS });
  });
  it('keeps tie-breakers and the settled point when present', () => {
    const c = { lastPulledAt: TS, lastPushedAt: TS, lastPulledCollection: 'chat', lastPulledId: 'x', settledAt: TS };
    expect(parseCursor(JSON.stringify(c))).toEqual(c);
  });
  it('falls back to a full pull for missing or corrupt cursors', () => {
    expect(parseCursor(null)).toBe(EMPTY_CURSOR);
    expect(parseCursor('{not json')).toBe(EMPTY_CURSOR);
    expect(parseCursor(JSON.stringify({ lastPulledAt: 5 }))).toBe(EMPTY_CURSOR);
  });
});

describe('cloud photo deletion listing', () => {
  // A fake bucket: 2,345 photos at the top level plus a sub-folder with 3 more.
  const files: Record<string, string[]> = {
    u: Array.from({ length: 2345 }, (_, i) => `p${pad(i)}.jpg`),
    'u/old': ['a.jpg', 'b.jpg', 'c.jpg'],
  };
  const bucket = {
    list: jest.fn(async (prefix: string, opts: { limit: number; offset: number }) => {
      const names = [...(files[prefix] ?? []).map((name) => ({ name, id: name })), ...(prefix === 'u' ? [{ name: 'old', id: null }] : [])];
      return { data: names.slice(opts.offset, opts.offset + opts.limit), error: null };
    }),
    remove: jest.fn(),
  };

  it('pages past 1,000 files and recurses into folders', async () => {
    const paths = await listAllPaths(bucket as never, 'u');
    expect(paths).toHaveLength(2348);
    expect(new Set(paths).size).toBe(2348);
    expect(paths).toContain('u/old/b.jpg');
    expect(paths).toContain('u/p02344.jpg');
  });
});

describe('syncNow', () => {
  it('pushes local changes, clamps far-future edit times, and returns the pulled rows', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const state = { ...emptyState('d', TS), weights: [{ id: 'w1', date: '2026-10-01', weightKg: 80, updatedAt: future }] };
    mockServerNow = '2026-10-02T12:00:00.000001+00:00';
    const res = await syncNow(memoryStore(state), USER, EMPTY_CURSOR);
    expect(res.pushed).toBeGreaterThan(0);
    const pushed = mockTable.find((r) => r.id === 'w1')!;
    expect(Date.parse(pushed.updated_at)).toBeLessThan(Date.parse(future));
    expect(res.rows.some((r) => r.id === 'w1')).toBe(true);
    expect(res.cursor.lastPulledAt).toBe(mockServerNow);
  });
});

const OLD = '2026-10-01T09:00:00.000Z';
const meal = (over: Partial<FoodEntry> = {}): FoodEntry => ({
  id: 'f1', date: '2026-10-01', meal: 'lunch', origin: 'photo', confirmedAt: OLD, createdAt: OLD, updatedAt: OLD,
  photoUri: 'file:///here/meal.jpg', hint: 'pasta',
  items: [{ name: 'Pasta', portionLabel: '1 plate', calories: 600, proteinG: 20, carbsG: 90, fatG: 15, source: { kind: 'user_entered', sourced: false, label: '' } }],
  ...over,
});
const photo = (over: Partial<ProgressPhoto> = {}): ProgressPhoto => ({ id: 'p1', date: '2026-10-01', uri: 'file:///here/front.jpg', note: 'week 1', weightKg: 80, updatedAt: OLD, ...over });
const serverRow = (collection: string, id: string) => mockTable.find((r) => r.collection === collection && r.id === id);

describe('photo uploads', () => {
  it('uploads local food and progress photos and points the records at their cloud copies', async () => {
    const store = memoryStore({
      ...emptyState('d', TS),
      foodLog: [meal()],
      progressPhotos: [photo(), photo({ id: 'p2', uri: `storage:food-photos/${USER}/progress/p2.jpg` })],
    });
    await syncNow(store, USER, EMPTY_CURSOR);
    expect(mockUploads.sort()).toEqual([`${USER}/f1.jpg`, `${USER}/progress/p1.jpg`]);
    expect(store.state.foodLog[0].photoUri).toBe(`storage:food-photos/${USER}/f1.jpg`);
    expect(store.state.progressPhotos[0].uri).toBe(`storage:food-photos/${USER}/progress/p1.jpg`);
    // The rows pushed in the same sync carry the cloud uris.
    expect((serverRow('foodLog', 'f1')?.data as FoodEntry).photoUri).toBe(`storage:food-photos/${USER}/f1.jpg`);
    expect((serverRow('progressPhotos', 'p1')?.data as ProgressPhoto).uri).toBe(`storage:food-photos/${USER}/progress/p1.jpg`);
  });

  it('works when the state has no progressPhotos', async () => {
    const state = { ...emptyState('d', TS) };
    delete (state as { progressPhotos?: unknown }).progressPhotos;
    await expect(syncNow(memoryStore(state), USER, EMPTY_CURSOR)).resolves.toBeDefined();
    expect(mockUploads).toHaveLength(0);
  });

  it("skips another device's photo paths quietly", async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const store = memoryStore({ ...emptyState('d', TS), progressPhotos: [photo({ uri: 'file:///data/user/0/other-phone/front.jpg' })] });
    await syncNow(store, USER, EMPTY_CURSOR);
    expect(mockUploads).toHaveLength(0);
    expect(store.state.progressPhotos[0].uri).toBe('file:///data/user/0/other-phone/front.jpg');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the local photo when the stored object turns out empty', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    mockStoredSize = 0;
    const store = memoryStore({ ...emptyState('d', TS), progressPhotos: [photo()] });
    await syncNow(store, USER, EMPTY_CURSOR);
    expect(store.state.progressPhotos[0].uri).toBe('file:///here/front.jpg');
    warn.mockRestore();
  });

  describe('edits made while a photo uploads', () => {
    it('a photo deleted during its upload stays deleted, here and on the server, and its upload is removed', async () => {
      const store = memoryStore({ ...emptyState('d', TS), progressPhotos: [photo()] });
      mockDuringUpload = () => store.dispatch({ type: 'DELETE_PROGRESS_PHOTO', id: 'p1', now: new Date().toISOString() });
      await syncNow(store, USER, EMPTY_CURSOR);
      const local = store.state.progressPhotos[0];
      expect(local.deleted).toBe(true);
      expect(local.uri).toBe('');
      expect(mockRemoved).toEqual([`${USER}/progress/p1.jpg`]);
      expect((local as { storagePath?: string }).storagePath).toBeUndefined(); // removal done
      const row = serverRow('progressPhotos', 'p1')!;
      expect(row.deleted).toBe(true);
      expect(JSON.stringify(row.data)).not.toContain('front.jpg');
      expect(JSON.stringify(row.data)).not.toContain('week 1');
    });

    it('a meal edited during its photo upload keeps the edit and gets the cloud photo', async () => {
      const store = memoryStore({ ...emptyState('d', TS), foodLog: [meal()] });
      mockDuringUpload = () => {
        const current = store.state.foodLog[0];
        store.dispatch({ type: 'UPDATE_FOOD', entry: { ...current, items: [{ ...current.items[0], calories: 450 }], updatedAt: new Date().toISOString() } });
      };
      await syncNow(store, USER, EMPTY_CURSOR);
      const local = store.state.foodLog[0];
      expect(local.items[0].calories).toBe(450);
      expect(local.photoUri).toBe(`storage:food-photos/${USER}/f1.jpg`);
      const pushed = serverRow('foodLog', 'f1')!.data as FoodEntry;
      expect(pushed.items[0].calories).toBe(450);
      expect(pushed.photoUri).toBe(`storage:food-photos/${USER}/f1.jpg`);
    });

    it('a meal deleted during its photo upload is not resurrected', async () => {
      const store = memoryStore({ ...emptyState('d', TS), foodLog: [meal()] });
      mockDuringUpload = () => store.dispatch({ type: 'DELETE_FOOD', id: 'f1', now: new Date().toISOString() });
      await syncNow(store, USER, EMPTY_CURSOR);
      expect(store.state.foodLog[0].deleted).toBe(true);
      expect(store.state.foodLog[0].photoUri).toBeUndefined();
      expect(serverRow('foodLog', 'f1')!.deleted).toBe(true);
      expect(mockRemoved).toEqual([`${USER}/f1.jpg`]);
    });

    it('a photo replaced during the upload is not overwritten by the old upload', async () => {
      const store = memoryStore({ ...emptyState('d', TS), foodLog: [meal()] });
      mockDuringUpload = () => store.dispatch({ type: 'UPDATE_FOOD', entry: { ...store.state.foodLog[0], photoUri: 'file:///here/retake.jpg', updatedAt: new Date().toISOString() } });
      await syncNow(store, USER, EMPTY_CURSOR);
      expect(store.state.foodLog[0].photoUri).toBe('file:///here/retake.jpg');
    });
  });
});

describe('deleted photos in cloud storage', () => {
  it('removes the cloud copy of a deleted photo once, and retries after a failure', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const store = memoryStore({ ...emptyState('d', TS), progressPhotos: [photo({ uri: `storage:food-photos/${USER}/progress/p1.jpg` })] });
    store.dispatch({ type: 'DELETE_PROGRESS_PHOTO', id: 'p1', now: new Date().toISOString() });
    mockRemoveError = 'offline';
    await syncNow(store, USER, EMPTY_CURSOR);
    expect((store.state.progressPhotos[0] as { storagePath?: string }).storagePath).toBe(`${USER}/progress/p1.jpg`);
    mockRemoveError = undefined;
    await syncNow(store, USER, EMPTY_CURSOR);
    expect(mockRemoved).toEqual([`${USER}/progress/p1.jpg`]);
    expect((store.state.progressPhotos[0] as { storagePath?: string }).storagePath).toBeUndefined();
    await syncNow(store, USER, EMPTY_CURSOR);
    expect(mockRemoved).toHaveLength(1);
    warn.mockRestore();
  });

  it("never tries to remove a path outside the user's folder", async () => {
    const store = memoryStore({ ...emptyState('d', TS), progressPhotos: [photo({ uri: 'storage:food-photos/someone-else/progress/p1.jpg' })] });
    store.dispatch({ type: 'DELETE_PROGRESS_PHOTO', id: 'p1', now: new Date().toISOString() });
    await syncNow(store, USER, EMPTY_CURSOR);
    expect(mockRemoved).toHaveLength(0);
    expect((store.state.progressPhotos[0] as { storagePath?: string }).storagePath).toBeUndefined();
  });
});

describe('push failures', () => {
  const weights = (n: number, stamp: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => ({ id: `w${pad(i)}`, date: '2026-10-01', weightKg: 80, updatedAt: stamp(i) }));

  it('pushes in chunks and skips a row the server rejects for good, without blocking the rest', async () => {
    const err = jest.spyOn(log, 'error').mockImplementation(() => {});
    mockRowError = (r) => (r.id === 'w00250' ? { message: 'violates check constraint "records_size_check"', code: '23514' } : undefined);
    const store = memoryStore({ ...emptyState('d', TS), weights: weights(450, () => OLD) });
    mockTable = [weightRow('remote-1', TS)];
    const res = await syncNow(store, USER, EMPTY_CURSOR);
    expect(Math.max(...mockUpsertCalls)).toBeLessThanOrEqual(PUSH_CHUNK_SIZE);
    expect(res.pushed).toBe(449);
    expect(res.rejected).toBe(1);
    expect(res.pushError).toBeUndefined();
    expect(mockTable.filter((r) => r.collection === 'weights' && r.id.startsWith('w0'))).toHaveLength(449);
    expect(res.rows.some((r) => r.id === 'remote-1')).toBe(true);
    // The cursor moves past the rejected row so it doesn't fail on every sync.
    expect(res.cursor.lastPushedAt > OLD).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('still pulls when the push fails, and keeps the failed rows for the next push', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const stamp = (i: number) => new Date(Date.parse('2026-10-02T08:00:00.000Z') + i * 1000).toISOString();
    mockRowError = (r) => (r.id >= 'w00003' ? { message: 'Failed to fetch', status: 0 } : undefined);
    const store = memoryStore({ ...emptyState('d', TS), weights: weights(5, stamp) });
    mockTable = [weightRow('remote-1', TS)];
    const res = await syncNow(memoryStore(store.state), USER, EMPTY_CURSOR);
    expect(res.pushError).toMatch(/Upload failed/);
    expect(res.rows.some((r) => r.id === 'remote-1')).toBe(true);
    // Every row that did not arrive is newer than the saved push cursor, so it is sent again.
    expect(res.cursor.lastPushedAt < stamp(0)).toBe(true);
    warn.mockRestore();
  });

  it('a transient failure in one chunk holds the push cursor below the failed rows only', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const stamp = (i: number) => new Date(Date.parse('2026-10-02T08:00:00.000Z') + i * 1000).toISOString();
    let failOnce = true;
    mockRowError = (r) => (r.id === 'w00300' && failOnce ? { message: 'timeout', code: '57014', status: 500 } : undefined);
    const store = memoryStore({ ...emptyState('d', TS), weights: weights(450, stamp) });
    const first = await syncNow(store, USER, EMPTY_CURSOR);
    expect(first.pushed).toBe(200);
    expect(first.cursor.lastPushedAt < stamp(200)).toBe(true);
    expect(first.cursor.lastPushedAt > stamp(199)).toBe(true); // just below the first failed row
    failOnce = false;
    const second = await syncNow(store, USER, first.cursor);
    expect(second.pushError).toBeUndefined();
    expect(mockTable.filter((r) => r.collection === 'weights')).toHaveLength(450);
    warn.mockRestore();
  });

  it('reports both errors when the pull fails after a failed push', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    mockRowError = () => ({ message: 'Failed to fetch', status: 0 });
    mockPullError = 'Network request failed';
    const store = memoryStore({ ...emptyState('d', TS), weights: weights(1, () => OLD) });
    await expect(syncNow(store, USER, EMPTY_CURSOR)).rejects.toThrow(/Upload failed: Failed to fetch.*Download failed: Network request failed/);
    warn.mockRestore();
  });
});
