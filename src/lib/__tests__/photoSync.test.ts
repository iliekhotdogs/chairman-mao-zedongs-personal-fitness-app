import { emptyState, type AppState } from '../state';
import { reducer } from '../reducer';
import { validateRecord } from '../schema';
import { applyPhotoUploads, localChanges, mergeRemote, pendingStorageRemovals } from '../sync/merge';
import { dataUrlBytes } from '../photo';
import { jsonExport, csvExports } from '../export';
import type { FoodEntry, ProgressPhoto } from '../types';

const T0 = '2026-10-01T09:00:00.000Z';
const T1 = '2026-10-02T10:00:00.000Z';
const NOW = '2026-10-03T12:00:00.000Z';
const CLOUD = 'storage:food-photos/u1/progress/p1.jpg';

const photo = (over: Partial<ProgressPhoto> = {}): ProgressPhoto => ({ id: 'p1', date: '2026-10-01', uri: 'data:image/jpeg;base64,AAAA', note: 'week 1', weightKg: 80, updatedAt: T0, ...over });
const meal = (over: Partial<FoodEntry> = {}): FoodEntry => ({
  id: 'f1', date: '2026-10-01', meal: 'lunch', origin: 'photo', confirmedAt: T0, createdAt: T0, updatedAt: T0, photoUri: 'data:image/jpeg;base64,AAAA', hint: 'pasta',
  items: [{ name: 'Pasta', portionLabel: '1 plate', calories: 600, proteinG: 20, carbsG: 90, fatG: 15, source: { kind: 'user_entered', sourced: false, label: '' } }],
  ...over,
});
const withPhotos = (s: Partial<AppState>): AppState => ({ ...emptyState('d', T0), ...s });

describe('photo tombstones', () => {
  it('a deleted progress photo keeps no image, note or weight, and still validates', () => {
    const s = reducer(withPhotos({ progressPhotos: [photo()] }), { type: 'DELETE_PROGRESS_PHOTO', id: 'p1', now: T1 });
    const t = s.progressPhotos[0];
    expect(t).toEqual({ id: 'p1', updatedAt: T1, deleted: true, date: '2026-10-01', uri: '' });
    expect(validateRecord('progressPhotos', t)).not.toBeNull();
    expect(pendingStorageRemovals(s)).toEqual([]); // the photo was never uploaded
  });

  it('a deleted cloud photo remembers its storage path for removal', () => {
    const s = reducer(withPhotos({ progressPhotos: [photo({ uri: CLOUD })] }), { type: 'DELETE_PROGRESS_PHOTO', id: 'p1', now: T1 });
    expect(JSON.stringify(s.progressPhotos[0])).not.toContain('week 1');
    expect(pendingStorageRemovals(s)).toEqual([{ collection: 'progressPhotos', id: 'p1', path: 'u1/progress/p1.jpg' }]);
  });

  it('a deleted meal drops its photo and hint and still validates', () => {
    const s = reducer(withPhotos({ foodLog: [meal({ photoUri: 'storage:food-photos/u1/f1.jpg' })] }), { type: 'DELETE_FOOD', id: 'f1', now: T1 });
    const t = s.foodLog[0];
    expect(t.deleted).toBe(true);
    expect(t.photoUri).toBeUndefined();
    expect(t.hint).toBeUndefined();
    expect(validateRecord('foodLog', t)).not.toBeNull();
    expect(pendingStorageRemovals(s)).toEqual([{ collection: 'foodLog', id: 'f1', path: 'u1/f1.jpg' }]);
  });

  it('strips full tombstones pulled from older app versions and removes their cloud photo', () => {
    const local = withPhotos({ progressPhotos: [photo({ uri: CLOUD })] });
    const merged = mergeRemote(local, [{ collection: 'progressPhotos', id: 'p1', data: { ...photo({ uri: CLOUD }), deleted: true }, updated_at: T1, deleted: true }]);
    expect(merged.progressPhotos[0].uri).toBe('');
    expect(merged.progressPhotos[0].note).toBeUndefined();
    expect(pendingStorageRemovals(merged)).toEqual([{ collection: 'progressPhotos', id: 'p1', path: 'u1/progress/p1.jpg' }]);
  });

  it('remembers the local cloud copy when a stripped remote tombstone replaces it', () => {
    const local = withPhotos({ progressPhotos: [photo({ uri: CLOUD })] });
    const merged = mergeRemote(local, [{ collection: 'progressPhotos', id: 'p1', data: { id: 'p1', updatedAt: T1, deleted: true }, updated_at: T1, deleted: true }]);
    expect(merged.progressPhotos[0].deleted).toBe(true);
    expect(pendingStorageRemovals(merged)).toHaveLength(1);
  });
});

describe('applying photo uploads to the current state', () => {
  const up = { collection: 'progressPhotos' as const, id: 'p1', from: 'data:image/jpeg;base64,AAAA', to: CLOUD };

  it('sets only the photo field and re-stamps the record', () => {
    const s = applyPhotoUploads(withPhotos({ progressPhotos: [photo({ note: 'edited meanwhile', updatedAt: T1 })] }), [up], NOW);
    expect(s.progressPhotos[0]).toMatchObject({ uri: CLOUD, note: 'edited meanwhile', updatedAt: NOW });
  });

  it('never resurrects a tombstone; marks the uploaded copy for removal instead', () => {
    const deleted = reducer(withPhotos({ progressPhotos: [photo()] }), { type: 'DELETE_PROGRESS_PHOTO', id: 'p1', now: T1 });
    const s = applyPhotoUploads(deleted, [up], NOW);
    expect(s.progressPhotos[0]).toMatchObject({ deleted: true, uri: '', updatedAt: T1 });
    expect(pendingStorageRemovals(s)).toEqual([{ collection: 'progressPhotos', id: 'p1', path: 'u1/progress/p1.jpg' }]);
  });

  it('leaves a record whose photo changed, and ignores records that are gone', () => {
    const s0 = withPhotos({ progressPhotos: [photo({ uri: 'data:image/jpeg;base64,BBBB' })] });
    expect(applyPhotoUploads(s0, [up, { ...up, id: 'gone' }], NOW)).toBe(s0);
  });
});

describe('importing earlier device data into an account', () => {
  it('re-stamps everything so it uploads, and keeps what was already pulled', () => {
    const pulled = withPhotos({
      weights: [{ id: 'w-account', date: '2026-09-30', weightKg: 81, updatedAt: T1 }],
      settings: { ...emptyState('x', T0).settings, units: 'metric', updatedAt: T1 },
    });
    const legacy = withPhotos({
      profile: { name: 'Sam', sex: 'male', birthYear: 1990, heightCm: 180, startWeightKg: 85, goal: 'fat_loss', experience: 'beginner', equipment: 'gym', trainingDays: [1, 3], dietPreferences: [], limitations: [], createdAt: T0, updatedAt: T0 } as never,
      weights: [{ id: 'w-legacy', date: '2026-09-20', weightKg: 84, updatedAt: T0 }, { id: 'w-dead', date: '2026-09-21', weightKg: 84, updatedAt: T0, deleted: true }],
      foodLog: [meal()],
    });
    const out = reducer(pulled, { type: 'IMPORT_LEGACY', legacy, now: NOW });
    expect(out.weights.map((w) => w.id).sort()).toEqual(['w-account', 'w-legacy']);
    expect(out.profile?.name).toBe('Sam');
    expect(out.profile?.updatedAt).toBe(NOW);
    expect(out.deviceId).toBe(pulled.deviceId);
    // Everything imported is newer than any push cursor before now.
    const rows = localChanges(out, T1);
    expect(rows.map((r) => `${r.collection}/${r.id}`).sort()).toEqual(['foodLog/f1', 'singleton/profile', 'singleton/settings', 'weights/w-legacy']);
  });
});

describe('data URLs', () => {
  it('decodes base64 data URLs to bytes', () => {
    expect([...dataUrlBytes('data:image/jpeg;base64,/9j/4A==')!]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect([...dataUrlBytes('data:text/plain;base64,aGVsbG8=')!]).toEqual([104, 101, 108, 108, 111]);
    expect(dataUrlBytes('file:///x.jpg')).toBeUndefined();
  });
});

describe('export file names', () => {
  it("use the user's local date, not the UTC one", () => {
    // 21:30 on Oct 2 in New York is already Oct 3 in UTC.
    const late = '2026-10-03T01:30:00.000Z';
    expect(jsonExport(emptyState('d', late), late).filename).toBe('fitcoach-export-2026-10-02.json');
    expect(csvExports(emptyState('d', late), late)[0].filename).toBe('fitcoach-food-log-2026-10-02.csv');
  });
});
