import { mergeRemote, localChanges } from '../sync/merge';
import { mergeActivity, dailyActivity, simulatedHealthConnectPull } from '../activity/activity';
import { emptyState } from '../state';
import type { ActivityRecord } from '../types';

const T1 = '2026-10-02T10:00:00.000Z';
const T2 = '2026-10-02T11:00:00.000Z';

describe('cross-device merge (last write wins)', () => {
  const entry = (id: string, cal: number, updatedAt: string, deleted = false) => ({
    id, date: '2026-10-02', meal: 'lunch' as const, origin: 'manual' as const, confirmedAt: T1, createdAt: T1, updatedAt, deleted,
    items: [{ name: 'x', portionLabel: '1', calories: cal, proteinG: 0, carbsG: 0, fatG: 0, source: { kind: 'user_entered' as const, sourced: false, label: '' } }],
  });

  it('newer remote record replaces older local', () => {
    const local = { ...emptyState('a', T1), foodLog: [entry('f1', 100, T1)] };
    const merged = mergeRemote(local, [{ collection: 'foodLog', id: 'f1', data: entry('f1', 200, T2), updated_at: T2, deleted: false }]);
    expect(merged.foodLog[0].items[0].calories).toBe(200);
  });

  it('older remote record does not overwrite a newer local edit', () => {
    const local = { ...emptyState('a', T1), foodLog: [entry('f1', 300, T2)] };
    const merged = mergeRemote(local, [{ collection: 'foodLog', id: 'f1', data: entry('f1', 100, T1), updated_at: T1, deleted: false }]);
    expect(merged.foodLog[0].items[0].calories).toBe(300);
  });

  it('deletions sync as tombstones', () => {
    const local = { ...emptyState('a', T1), foodLog: [entry('f1', 100, T1)] };
    const merged = mergeRemote(local, [{ collection: 'foodLog', id: 'f1', data: entry('f1', 100, T2, true), updated_at: T2, deleted: true }]);
    expect(merged.foodLog[0].deleted).toBe(true);
  });

  it('adds records created on another device', () => {
    const merged = mergeRemote(emptyState('a', T1), [{ collection: 'foodLog', id: 'f9', data: entry('f9', 50, T2), updated_at: T2, deleted: false }]);
    expect(merged.foodLog).toHaveLength(1);
  });

  it('collects only local changes since the cursor', () => {
    const s = { ...emptyState('a', T1), foodLog: [entry('old', 1, T1), entry('new', 2, T2)] };
    const rows = localChanges(s, '2026-10-02T10:30:00.000Z');
    expect(rows.filter((r) => r.collection === 'foodLog').map((r) => r.id)).toEqual(['new']);
  });
});

describe('activity de-duplication', () => {
  const rec = (over: Partial<ActivityRecord>): ActivityRecord => ({ id: Math.random().toString(), date: '2026-10-02', source: 'health_connect', origin: 'Phone', syncedAt: T1, updatedAt: T1, ...over });

  it('re-syncing the same upstream record does not duplicate it', () => {
    const a = mergeActivity([], [rec({ externalId: 'x', steps: 1000 })]);
    const b = mergeActivity(a.records, [rec({ externalId: 'x', steps: 1000 })]);
    expect(b.records).toHaveLength(1);
    expect(b.duplicates).toBe(1);
    const c = mergeActivity(b.records, [rec({ externalId: 'x', steps: 1500 })]);
    expect(c.records).toHaveLength(1);
    expect(c.updated).toBe(1);
  });

  it('counts one source per day: manual first, then most steps', () => {
    const records = [rec({ externalId: 'p', origin: 'Phone', steps: 8000 }), rec({ externalId: 'w', origin: 'Watch', steps: 9000 })];
    const d = dailyActivity(records, '2026-10-02');
    expect(d.steps).toBe(9000);
    expect(d.otherSources).toHaveLength(1);
    const withManual = dailyActivity([...records, rec({ source: 'manual', origin: 'You', steps: 5000 })], '2026-10-02');
    expect(withManual.steps).toBe(5000);
  });

  it('reports missing days', () => {
    expect(dailyActivity([], '2026-10-02').missing).toBe(true);
    const sim = simulatedHealthConnectPull('2026-10-02');
    expect(dailyActivity(sim, '2026-09-27').missing).toBe(true); // built-in gap day
  });
});
