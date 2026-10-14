import { contentSignature, emptyState, STATE_VERSION, type AppState } from '../state';
import { buildSampleState } from '../sampleData';
import { migrateState, pruneState, sanitizeState } from '../schemaMigrations';
import { validateRecord } from '../schema';
import { clampFutureStamp, FUTURE_TOLERANCE_MS, localChanges, mergeRemote } from '../sync/merge';
import { checkedAction, reducer, RuleViolation } from '../reducer';
import type { ChatMessage, Proposal } from '../types';

const NOW = '2026-10-02T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const TODAY = '2026-10-02';
const roundTrip = <T,>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe('stored state validation', () => {
  it('keeps a realistic saved state intact', () => {
    const s = buildSampleState('dev', TODAY);
    const { state, dropped } = sanitizeState(roundTrip(s), 'fallback', NOW);
    expect(dropped).toBe(0);
    expect(state.foodLog).toHaveLength(s.foodLog.length);
    expect(state.weights).toHaveLength(s.weights.length);
    expect(state.sessions).toHaveLength(s.sessions.length);
    expect(state.profile?.name).toBe(s.profile?.name);
    expect(state.plan?.days.length).toBe(s.plan?.days.length);
    expect(state.deviceId).toBe('dev');
  });

  it('drops invalid records instead of crashing, and keeps the valid ones', () => {
    const s = roundTrip(buildSampleState('dev', TODAY)) as Record<string, unknown>;
    const weights = s.weights as unknown[];
    s.weights = [...weights, { id: 'bad', date: TODAY, weightKg: 'eighty', updatedAt: NOW }, null, 42];
    s.foodLog = 'not a list';
    const { state, dropped } = sanitizeState(s, 'fallback', NOW);
    expect(state.weights).toHaveLength(weights.length);
    expect(state.foodLog).toEqual([]);
    expect(dropped).toBe(4);
  });

  it('keeps tombstones even when their payload is partial', () => {
    expect(validateRecord('foodLog', { id: 'x', updatedAt: NOW, deleted: true })).not.toBeNull();
    expect(validateRecord('foodLog', { id: 'x', updatedAt: NOW })).toBeNull();
  });

  it('replaces invalid settings with defaults and drops an invalid profile', () => {
    const { state } = sanitizeState({ ...emptyState('d', NOW), settings: { units: 'furlongs' }, profile: { name: 3 } }, 'f', NOW);
    expect(state.settings.units).toBe('imperial');
    expect(state.profile).toBeUndefined();
  });

  it('fills missing list fields with defaults so the UI never sees undefined', () => {
    const { state } = sanitizeState({ version: 1, deviceId: 'd' }, 'f', NOW);
    expect(state.chat).toEqual([]);
    expect(state.integrations.length).toBeGreaterThan(0);
    expect(state.version).toBe(STATE_VERSION);
  });

  it('starts fresh for a non-object', () => {
    const { state, dropped } = sanitizeState('garbage', 'fallback', NOW);
    expect(state.deviceId).toBe('fallback');
    expect(dropped).toBe(1);
  });

  it('clamps far-future edit times from a bad device clock', () => {
    const future = '2030-01-01T00:00:00.000Z';
    const { state } = sanitizeState({ ...emptyState('d', NOW), weights: [{ id: 'w', date: TODAY, weightKg: 80, updatedAt: future }] }, 'f', NOW);
    expect(state.weights[0].updatedAt).toBe(NOW);
  });
});

describe('state migrations', () => {
  it('upgrades pre-versioned state', () => {
    expect(migrateState({ deviceId: 'd' }).version).toBe(STATE_VERSION);
  });

  it('runs each step in order up to the target version', () => {
    const steps = { 1: (s: Record<string, unknown>) => ({ ...s, a: 1 }), 2: (s: Record<string, unknown>) => ({ ...s, b: (s.a as number) + 1 }) };
    expect(migrateState({ version: 1 }, 3, steps)).toEqual({ version: 3, a: 1, b: 2 });
  });

  it('leaves state from a newer app version alone', () => {
    expect(migrateState({ version: 99, x: 1 }, 1)).toEqual({ version: 99, x: 1 });
  });
});

describe('remote merge validation and clock skew', () => {
  // weightKg is loosely typed so tests can feed invalid remote payloads.
  const weight = (id: string, updatedAt: string, weightKg: unknown = 80) => ({ id, date: TODAY, weightKg: weightKg as number, updatedAt });

  it('ignores invalid remote rows', () => {
    const merged = mergeRemote(emptyState('d', NOW), [
      { collection: 'weights', id: 'ok', data: weight('ok', NOW), updated_at: NOW, deleted: false },
      { collection: 'weights', id: 'bad', data: weight('bad', NOW, 'heavy'), updated_at: NOW, deleted: false },
      { collection: 'singleton', id: 'settings', data: { units: 'cubits' }, updated_at: NOW, deleted: false },
    ], NOW_MS);
    expect(merged.weights.map((w) => w.id)).toEqual(['ok']);
    expect(merged.settings.units).toBe('imperial');
  });

  it('normalises server timestamps (+00:00) to local ISO format', () => {
    const merged = mergeRemote(emptyState('d', NOW), [{ collection: 'weights', id: 'w', data: weight('w', NOW), updated_at: '2026-10-02T11:00:00.5+00:00', deleted: false }], NOW_MS);
    expect(merged.weights[0].updatedAt).toBe('2026-10-02T11:00:00.500Z');
  });

  it('a far-future remote edit cannot win forever', () => {
    const local = { ...emptyState('d', NOW), weights: [weight('w', NOW, 81)] };
    const merged = mergeRemote(local, [{ collection: 'weights', id: 'w', data: weight('w', '2030-01-01T00:00:00.000Z', 90), updated_at: '2030-01-01T00:00:00.000Z', deleted: false }], NOW_MS);
    // Clamped to "now", which equals the local edit, so the local value stays.
    expect(merged.weights[0].weightKg).toBe(81);
  });

  it('clampFutureStamp allows small drift', () => {
    const soon = new Date(NOW_MS + FUTURE_TOLERANCE_MS - 1000).toISOString();
    expect(clampFutureStamp(soon, NOW_MS)).toBe(soon);
    expect(clampFutureStamp('2030-01-01T00:00:00.000Z', NOW_MS)).toBe(NOW);
    expect(clampFutureStamp('not a date', NOW_MS)).toBe('not a date');
  });

  it('localChanges clamps future stamps before pushing', () => {
    const s = { ...emptyState('d', NOW), weights: [weight('w', '2030-01-01T00:00:00.000Z')] };
    const [row] = localChanges(s, '1970-01-01T00:00:00.000Z', NOW_MS).filter((r) => r.collection === 'weights');
    expect(row.updated_at).toBe(NOW);
    expect((row.data as { updatedAt: string }).updatedAt).toBe(NOW);
  });
});

describe('storage pruning', () => {
  const old = '2026-08-01T00:00:00.000Z';
  const chat = (i: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: `c${i}`, role: 'user', text: `m${i}`, createdAt: new Date(Date.parse(old) + i * 1000).toISOString(), updatedAt: old, ...over,
  });

  it('drops old synced tombstones but keeps recent or unsynced ones', () => {
    const s: AppState = {
      ...emptyState('d', NOW),
      weights: [
        { id: 'old-dead', date: TODAY, weightKg: 80, updatedAt: old, deleted: true },
        { id: 'new-dead', date: TODAY, weightKg: 80, updatedAt: NOW, deleted: true },
        { id: 'old-live', date: TODAY, weightKg: 80, updatedAt: old },
      ],
    };
    expect(pruneState(s, { now: NOW, syncedBefore: NOW }).weights.map((w) => w.id)).toEqual(['new-dead', 'old-live']);
    // Nothing has been pushed yet: keep the tombstone so the deletion still syncs.
    expect(pruneState(s, { now: NOW, syncedBefore: '1970-01-01T00:00:00.000Z' })).toBe(s);
  });

  it('caps chat history to the most recent messages once synced', () => {
    const s: AppState = { ...emptyState('d', NOW), chat: Array.from({ length: 12 }, (_, i) => chat(i)) };
    const pruned = pruneState(s, { now: NOW, syncedBefore: NOW, chatLimit: 5 });
    expect(pruned.chat.map((m) => m.id)).toEqual(['c7', 'c8', 'c9', 'c10', 'c11']);
    expect(pruneState(s, { now: NOW, syncedBefore: '1970-01-01T00:00:00.000Z', chatLimit: 5 }).chat).toHaveLength(12);
  });

  it('returns the same object when nothing changes', () => {
    const s = emptyState('d', NOW);
    expect(pruneState(s, { now: NOW })).toBe(s);
  });
});

describe('content signature', () => {
  it('changes on an edit, not only on additions', () => {
    const s = { ...emptyState('d', NOW), weights: [{ id: 'w', date: TODAY, weightKg: 80, updatedAt: NOW }] };
    const edited = { ...s, weights: [{ ...s.weights[0], weightKg: 81, updatedAt: '2026-10-02T12:00:01.000Z' }] };
    expect(contentSignature(edited)).not.toBe(contentSignature(s));
    expect(contentSignature({ ...s, weights: [...s.weights] })).toBe(contentSignature(s));
  });

  it('covers every synced collection, including chat and notifications', () => {
    const s = emptyState('d', NOW);
    const withChat = { ...s, chat: [{ id: 'c', role: 'user' as const, text: 'hi', createdAt: NOW, updatedAt: NOW }] };
    expect(contentSignature(withChat)).not.toBe(contentSignature(s));
    expect(contentSignature(withChat, ['weights'])).toBe(contentSignature(s, ['weights']));
  });
});

describe('single-pass action checks', () => {
  const proposal = (over: Partial<Proposal> = {}): Proposal => ({
    id: 'p1', kind: 'target_change', scope: 'ongoing', title: 't', summary: 's', rationale: [],
    change: { type: 'target_change', next: { calories: 1500, proteinG: 150, carbsG: 100, fatG: 50 } },
    status: 'pending', createdAt: NOW, updatedAt: NOW, dedupeKey: 'k', origin: 'adaptive_engine', ...over,
  });

  it('checkedAction throws for invalid actions and marks valid ones', () => {
    const s = emptyState('d', NOW);
    expect(() => checkedAction(s, { type: 'LOG_WEIGHT', entry: { id: 'w', date: TODAY, weightKg: 5, updatedAt: NOW } })).toThrow(RuleViolation);
    const ok = checkedAction(s, { type: 'LOG_WEIGHT', entry: { id: 'w', date: TODAY, weightKg: 80, updatedAt: NOW } });
    expect(reducer(s, ok).weights).toHaveLength(1);
  });

  it('accepting a proposal that disappeared since the check is a no-op, not a crash', () => {
    const s = { ...buildSampleState('d', TODAY), proposals: [proposal()] };
    const action = checkedAction(s, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    const gone = { ...s, proposals: [] };
    expect(reducer(gone, action)).toBe(gone);
    const noTargets = { ...s, targets: undefined };
    expect(reducer(noTargets, action)).toBe(noTargets);
  });
});
