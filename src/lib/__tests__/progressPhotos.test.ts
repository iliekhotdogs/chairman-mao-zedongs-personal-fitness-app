import { checkAction, reducer, RuleViolation } from '../reducer';
import { emptyState, SYNCED_COLLECTIONS } from '../state';
import { sanitizeState } from '../schemaMigrations';
import { validateRecord } from '../schema';
import { mergeRemote } from '../sync/merge';
import { comparePair, compareSummary, galleryOrder, photoDateError } from '../progressPhotos';
import type { ProgressPhoto } from '../types';

const NOW = '2026-10-02T12:00:00.000Z';
const photo = (over: Partial<ProgressPhoto> = {}): ProgressPhoto => ({ id: 'ph1', date: '2026-10-02', uri: 'file:///p.jpg', updatedAt: NOW, ...over });

describe('progress photos', () => {
  it('is a synced collection', () => {
    expect(SYNCED_COLLECTIONS).toContain('progressPhotos');
    expect(emptyState('d', NOW).progressPhotos).toEqual([]);
  });

  it('adds a photo and deletes it as a tombstone', () => {
    const s = reducer(emptyState('d', NOW), { type: 'ADD_PROGRESS_PHOTO', photo: photo({ weightKg: 80, note: 'Week 1' }) });
    expect(s.progressPhotos).toHaveLength(1);
    const later = '2026-10-03T12:00:00.000Z';
    const d = reducer(s, { type: 'DELETE_PROGRESS_PHOTO', id: 'ph1', now: later });
    expect(d.progressPhotos[0]).toMatchObject({ deleted: true, updatedAt: later });
  });

  it('enforces rules', () => {
    const s = emptyState('d', NOW);
    expect(() => checkAction(s, { type: 'ADD_PROGRESS_PHOTO', photo: photo({ uri: '' }) })).toThrow(RuleViolation);
    expect(() => checkAction(s, { type: 'ADD_PROGRESS_PHOTO', photo: photo({ date: 'yesterday' }) })).toThrow(RuleViolation);
    expect(() => checkAction(s, { type: 'ADD_PROGRESS_PHOTO', photo: photo({ weightKg: 5 }) })).toThrow(RuleViolation);
    expect(() => checkAction(s, { type: 'DELETE_PROGRESS_PHOTO', id: 'missing', now: NOW })).toThrow(RuleViolation);
    // the reducer ignores invalid actions
    expect(reducer(s, { type: 'ADD_PROGRESS_PHOTO', photo: photo({ uri: '' }) })).toBe(s);
  });

  it('loads older stored state without the field', () => {
    const old = { ...emptyState('d', NOW) } as Record<string, unknown>;
    delete old.progressPhotos;
    const { state, dropped } = sanitizeState(old, 'd', NOW);
    expect(state.progressPhotos).toEqual([]);
    expect(dropped).toBe(0);
  });

  it('validates stored and pulled records', () => {
    expect(validateRecord('progressPhotos', photo())).toBeTruthy();
    expect(validateRecord('progressPhotos', { id: 'x', updatedAt: NOW, date: '2026-10-02' })).toBeNull();
    const merged = mergeRemote(emptyState('d', NOW), [{ collection: 'progressPhotos', id: 'r1', data: photo({ id: 'r1', uri: 'storage:food-photos/u/progress/r1.jpg' }), updated_at: NOW, deleted: false }]);
    expect(merged.progressPhotos.map((p) => p.id)).toEqual(['r1']);
  });

  it('orders the gallery oldest first and picks first/latest to compare', () => {
    const list = [photo({ id: 'b', date: '2026-09-15' }), photo({ id: 'a', date: '2026-08-01' }), photo({ id: 'gone', date: '2026-07-01', deleted: true }), photo({ id: 'c', date: '2026-10-01' })];
    const g = galleryOrder(list);
    expect(g.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(comparePair(g)?.map((p) => p.id)).toEqual(['a', 'c']);
    expect(comparePair(g, 'b')?.map((p) => p.id)).toEqual(['a', 'b']);
    expect(comparePair(g.slice(0, 1))).toBeUndefined();
  });

  it('summarises days and weight change between two photos', () => {
    expect(compareSummary(photo({ date: '2026-08-01', weightKg: 85 }), photo({ date: '2026-10-01', weightKg: 81.5 }))).toEqual({ days: 61, weightDeltaKg: -3.5 });
    expect(compareSummary(photo({ date: '2026-08-01' }), photo({ date: '2026-08-08', weightKg: 80 })).weightDeltaKg).toBeUndefined();
  });

  it('validates typed dates', () => {
    expect(photoDateError('2026-10-01', '2026-10-02')).toBeUndefined();
    expect(photoDateError('2026-10-03', '2026-10-02')).toMatch(/future/);
    expect(photoDateError('2026-02-30', '2026-10-02')).toMatch(/exist/);
    expect(photoDateError('10/1/2026', '2026-10-02')).toMatch(/YYYY/);
  });
});
