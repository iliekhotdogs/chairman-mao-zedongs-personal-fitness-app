import { checkAction, reducer, RuleViolation } from '../reducer';
import { emptyState, STATE_VERSION, SYNCED_COLLECTIONS } from '../state';
import { migrateState, sanitizeState } from '../schemaMigrations';
import { validateRecord } from '../schema';
import { itemFromProduct } from '../nutrition/barcode';
import {
  basisFromItem, dishFromEntry, draftFromItem, findSavedByBarcode, itemFromSaved, logAgain, recentMeals, restaurantsVisited, savedFoodFromDraft, setMacro,
} from '../nutrition/savedFoods';
import type { FoodEntry, FoodItem, SavedFood } from '../types';

const NOW = '2026-10-15T12:00:00.000Z';
const LATER = '2026-10-15T13:00:00.000Z';

const product = (over: Partial<SavedFood> = {}): SavedFood => ({
  id: 's1', kind: 'barcode', name: 'Oat drink', brand: 'Oatly', barcode: '7394376616228',
  basis: { unit: 'ml', amount: 250, label: '1 cup (250 mL)' },
  nutrients: { calories: 120, proteinG: 3, carbsG: 16, fatG: null },
  confirmedAt: NOW, createdAt: NOW, updatedAt: NOW, ...over,
});

const item = (over: Partial<FoodItem> = {}): FoodItem => ({ name: 'Rice', portionLabel: '1 cup', grams: 158, calories: 205, proteinG: 4, carbsG: 45, fatG: 0.4, source: { kind: 'database', sourced: true, label: 'USDA' }, ...over });
const entry = (over: Partial<FoodEntry> = {}): FoodEntry => ({ id: 'e1', date: '2026-10-14', meal: 'lunch', items: [item()], origin: 'manual', confirmedAt: NOW, createdAt: NOW, updatedAt: NOW, ...over });

describe('savedFoods collection', () => {
  it('is synced and starts empty', () => {
    expect(SYNCED_COLLECTIONS).toContain('savedFoods');
    expect(emptyState('d', NOW).savedFoods).toEqual([]);
  });

  it('migrates v2 state by adding an empty savedFoods list', () => {
    const out = migrateState({ version: 2, deviceId: 'd', foodLog: [] });
    expect(out.version).toBe(STATE_VERSION);
    expect(out.savedFoods).toEqual([]);
    expect(sanitizeState({ version: 2, deviceId: 'd' }, 'f', NOW).state.savedFoods).toEqual([]);
  });

  it('validates nullable nutrients and keeps nulls', () => {
    const ok = validateRecord<SavedFood>('savedFoods', product());
    expect(ok?.nutrients.fatG).toBeNull();
    expect(validateRecord('savedFoods', { ...product(), nutrients: { calories: 'x' } })).toBeNull();
    expect(validateRecord('savedFoods', { ...product(), basis: { unit: 'cup', amount: 1, label: 'x' } })).toBeNull();
  });
});

describe('SAVE_FOOD / DELETE_SAVED_FOOD', () => {
  it('saves a confirmed food and updates it by id', () => {
    const s1 = reducer(emptyState('d', NOW), { type: 'SAVE_FOOD', food: product() });
    expect(s1.savedFoods).toHaveLength(1);
    const s2 = reducer(s1, { type: 'SAVE_FOOD', food: product({ flavour: 'Barista', updatedAt: LATER }) });
    expect(s2.savedFoods).toHaveLength(1);
    expect(s2.savedFoods[0].flavour).toBe('Barista');
  });

  it('refuses unconfirmed or out-of-range foods', () => {
    const s = emptyState('d', NOW);
    expect(() => checkAction(s, { type: 'SAVE_FOOD', food: product({ confirmedAt: '' }) })).toThrow(RuleViolation);
    expect(() => checkAction(s, { type: 'SAVE_FOOD', food: product({ nutrients: { calories: 99999, proteinG: 1, carbsG: 1, fatG: 1 } }) })).toThrow(RuleViolation);
    expect(() => checkAction(s, { type: 'SAVE_FOOD', food: product({ nutrients: { calories: 100, proteinG: -1, carbsG: null, fatG: null } }) })).toThrow(RuleViolation);
    expect(() => checkAction(s, { type: 'SAVE_FOOD', food: product({ nutrients: { calories: null, proteinG: 1, carbsG: 1, fatG: 1 } }) })).toThrow(RuleViolation);
    expect(reducer(s, { type: 'SAVE_FOOD', food: product({ confirmedAt: '' }) })).toBe(s);
  });

  it('deletes as a tombstone', () => {
    const s = reducer(reducer(emptyState('d', NOW), { type: 'SAVE_FOOD', food: product() }), { type: 'DELETE_SAVED_FOOD', id: 's1', now: LATER });
    expect(s.savedFoods[0]).toMatchObject({ deleted: true, updatedAt: LATER });
  });
});

describe('serving basis and missing macros', () => {
  it('logs ml and per-serving foods without inventing grams, and keeps unknown macros unknown', () => {
    const ml = itemFromSaved(product())!;
    expect(ml.grams).toBeUndefined();
    expect(ml.portionLabel).toBe('1 cup (250 mL)');
    expect(ml.missing).toEqual(['fatG']);
    expect(itemFromSaved(product({ basis: { unit: 'serving', amount: 1, label: '1 bar' } }))!.grams).toBeUndefined();
    expect(itemFromSaved(product({ basis: { unit: 'g', amount: 30, label: '30 g' } }))!.grams).toBe(30);
    expect(itemFromSaved(product({ nutrients: { calories: null, proteinG: 1, carbsG: 1, fatG: 1 } }))).toBeUndefined();
  });

  it('round-trips unknown macros through a draft as null', () => {
    const draft = draftFromItem(itemFromSaved(product())!);
    expect(draft.nutrients.fatG).toBeNull();
    expect(draft.basis).toEqual({ unit: 'ml', amount: 250, label: '1 cup (250 mL)' });
    expect(basisFromItem(item({ grams: undefined, portionLabel: '1 bar' }))).toEqual({ unit: 'serving', amount: 1, label: '1 bar' });
  });

  it('Open Food Facts: ml servings get no grams and absent macros are flagged, not zero-filled', () => {
    const r = itemFromProduct('123', { product_name: 'Juice', serving_size: '250 ml', nutriments: { 'energy-kcal_100g': 40, carbohydrates_100g: 10 } });
    if (r.status !== 'found') throw new Error('expected found');
    expect(r.item.grams).toBeUndefined();
    expect(r.item.calories).toBe(100);
    expect(r.item.missing).toEqual(['proteinG', 'fatG']);
  });

  it('setMacro marks empty values as missing and clears the flag when set', () => {
    const a = setMacro(item(), 'proteinG', undefined);
    expect(a.missing).toEqual(['proteinG']);
    expect(setMacro(a, 'proteinG', 5)).toMatchObject({ proteinG: 5, missing: undefined });
  });
});

describe('personal barcode match', () => {
  it('matches equivalent UPC-A / EAN-13 forms and ignores deleted foods', () => {
    const list = [product({ barcode: '012345678905' })];
    expect(findSavedByBarcode(list, '0012345678905')?.id).toBe('s1');
    expect(findSavedByBarcode([{ ...list[0], deleted: true }], '012345678905')).toBeUndefined();
    expect(findSavedByBarcode(list, '4006381333931')).toBeUndefined();
  });
});

describe('log again', () => {
  it('creates an independent entry that survives edits and deletes of the original', () => {
    const original = entry();
    let s = reducer(emptyState('d', NOW), { type: 'LOG_FOOD', entry: original });
    const copy = logAgain(original, '2026-10-15', LATER);
    expect(copy.id).not.toBe(original.id);
    expect(copy.items[0]).not.toBe(original.items[0]);
    s = reducer(s, { type: 'LOG_FOOD', entry: copy });
    s = reducer(s, { type: 'UPDATE_FOOD', entry: { ...original, items: [item({ calories: 999 })], updatedAt: LATER } });
    s = reducer(s, { type: 'DELETE_FOOD', id: original.id, now: LATER });
    const kept = s.foodLog.find((e) => e.id === copy.id)!;
    expect(kept).toMatchObject({ date: '2026-10-15', confirmedAt: LATER });
    expect(kept.deleted).toBeUndefined();
    expect(kept.items[0].calories).toBe(205);
  });
});

describe('food screen selectors', () => {
  it('recentMeals: newest first, distinct by items, skips deleted', () => {
    const list = [
      entry({ id: 'a', createdAt: '2026-10-10T00:00:00Z' }),
      entry({ id: 'b', createdAt: '2026-10-12T00:00:00Z' }),
      entry({ id: 'c', createdAt: '2026-10-13T00:00:00Z', items: [item({ name: 'Eggs' })], deleted: true }),
      entry({ id: 'd', createdAt: '2026-10-11T00:00:00Z', items: [item({ name: 'Toast' })] }),
    ];
    expect(recentMeals(list).map((e) => e.id)).toEqual(['b', 'd']);
  });

  it('restaurantsVisited groups dishes by restaurant, most recent first', () => {
    const dish = (id: string, restaurant: string, updatedAt: string) => savedFoodFromDraft({ ...dishFromEntry(entry(), restaurant, id) }, 'restaurant', updatedAt, id);
    const out = restaurantsVisited([dish('fries', 'A&W', NOW), dish('burger', 'a&w ', LATER), dish('wrap', 'Subway', NOW), product()]);
    expect(out.map((r) => r.restaurant)).toEqual(['A&W', 'Subway']);
    expect(out[0].dishes).toHaveLength(2);
  });

  it('dishFromEntry leaves a macro unknown when any item lacks it', () => {
    const d = dishFromEntry(entry({ items: [item(), item({ missing: ['fatG'] })] }), 'X', 'Combo');
    expect(d.nutrients).toMatchObject({ calories: 410, proteinG: 8, fatG: null });
  });
});
