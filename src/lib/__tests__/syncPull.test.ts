import { emptyState } from '../state';
import { EMPTY_CURSOR, keysetFilter, listAllPaths, parseCursor, PULL_PAGE_SIZE, pullSince, SETTLE_WINDOW_MS, syncNow, timestampMs, type SyncCursor } from '../sync/sync';

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
      resolve({ data: sorted.slice(0, limit), error: null });
    },
    upsert: async (input: Omit<Row, 'synced_at'>[]) => {
      for (const r of input) {
        mockTable = mockTable.filter((x) => !(x.user_id === r.user_id && x.collection === r.collection && x.id === r.id));
        mockTable.push({ ...r, synced_at: mockServerNow });
      }
      return { error: null };
    },
  };
  return b;
}

const mockClient = {
  from: () => builder(),
  rpc: async (name: string) => {
    mockCalls.push({ filters: [`rpc:${name}`] });
    return name === 'server_time' && mockRpcAvailable ? { data: mockServerNow, error: null } : { data: null, error: { message: 'function not found' } };
  },
};
/** Only the table queries (the server_time RPC is counted separately). */
const queries = () => mockCalls.filter((c) => !c.filters.some((f) => f.startsWith('rpc:')));
jest.mock('../sync/supabase', () => ({ supabase: () => mockClient }));

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
    const res = await syncNow(state, USER, EMPTY_CURSOR);
    expect(res.pushed).toBeGreaterThan(0);
    const pushed = mockTable.find((r) => r.id === 'w1')!;
    expect(Date.parse(pushed.updated_at)).toBeLessThan(Date.parse(future));
    expect(res.rows.some((r) => r.id === 'w1')).toBe(true);
    expect(res.cursor.lastPulledAt).toBe(mockServerNow);
  });
});
