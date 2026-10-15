import { buildSampleState } from '../sampleData';
import { checkAction, reducer } from '../reducer';
import { calorieFloor } from '../nutrition/targets';
import { hasInjuryRedFlag, isUrgentSymptom, simulateCoachReply } from '../coaching/coachSim';
import { migrateState, STATE_VERSION } from '../state';
import { photoObjectForDeletion, syncNow } from '../sync/sync';
import { supabase } from '../sync/supabase';
import { matchingFood, validateVisionItem } from '../../../supabase/functions/ai/foodValidation';
import type { Proposal } from '../types';

jest.mock('../sync/supabase', () => ({ supabase: jest.fn() }));

const date = '2026-10-02';
const now = `${date}T12:00:00.000Z`;
const state = () => ({ ...buildSampleState('pilot', date), proposals: [] });

describe('pilot safety boundaries', () => {
  it.each(['female', 'male', 'unspecified'] as const)('blocks old %s target proposals below the floor', (sex) => {
    const s = state();
    s.profile!.sex = sex;
    const bad: Proposal = { id: 'old', kind: 'target_change', scope: 'ongoing', title: '', summary: '', rationale: [], change: { type: 'target_change', next: { calories: calorieFloor(sex) - 1, proteinG: 50, carbsG: 50, fatG: 50 } }, status: 'pending', createdAt: now, updatedAt: now, dedupeKey: 'old', origin: 'adaptive_engine' };
    const before = { ...s, proposals: [bad] };
    const action = { type: 'ACCEPT_PROPOSAL' as const, id: bad.id, now, today: date };
    expect(() => checkAction(before, action)).toThrow(/cannot be below/);
    expect(reducer(before, action)).toBe(before);
    bad.change = { type: 'target_change', next: { calories: calorieFloor(sex), proteinG: 50, carbsG: 50, fatG: 50 } };
    expect(() => checkAction(before, action)).not.toThrow();
  });

  it.each(['chest pressure during a run', 'difficulty breathing now', 'I blacked out', 'shortness of breath'])('uses fixed urgent reply for %s', (message) => {
    expect(isUrgentSymptom(message)).toBe(true);
    expect(simulateCoachReply(state(), message, date).proposals).toHaveLength(0);
  });

  it.each(['my knee is swollen', 'I heard a pop in my shoulder', 'my ankle cannot bear weight', 'my wrist has tingling'])('offers no workout card for %s', (message) => {
    expect(hasInjuryRedFlag(message)).toBe(true);
    expect(simulateCoachReply(state(), message, date).proposals).toHaveLength(0);
  });
});

describe('pilot food validation', () => {
  const raw = { name: 'Chicken breast', portion: 'one piece', grams: 120, calories: 198, protein_g: 37, carbs_g: 0, fat_g: 4, confidence: 'medium', portion_assumption: 'palm', usda_search_query: 'chicken breast cooked' };
  it('rejects missing and non-finite amounts', () => {
    expect(validateVisionItem({ ...raw, grams: undefined })).toBeNull();
    expect(validateVisionItem({ ...raw, calories: Infinity })).toBeNull();
    expect(validateVisionItem({ ...raw, grams: 0 })).toBeNull();
    expect(validateVisionItem({ ...raw, grams: 120, calories: 4000 })?.review_required).toBe(true);
  });
  it('refuses raw/cooked, unrelated branded, and incomplete mixed-dish matches', () => {
    const item = validateVisionItem({ ...raw, name: 'Grilled chicken breast' })!;
    expect(matchingFood(item, [{ fdcId: 1, description: 'Chicken breast raw', foodNutrients: [{ nutrientNumber: '208', value: 165 }] }])).toBeNull();
    expect(matchingFood(item, [{ fdcId: 2, description: 'Chicken breast grilled', dataType: 'Branded', brandOwner: 'Other Brand', foodNutrients: [{ nutrientNumber: '208', value: 165 }] }])).toBeNull();
    const mixed = validateVisionItem({ ...raw, name: 'Chicken rice bowl' })!;
    expect(matchingFood(mixed, [{ fdcId: 3, description: 'Chicken rice', foodNutrients: [{ nutrientNumber: '208', value: 165 }] }])).toBeNull();
  });
});

it('migrates old photo and session data with safe defaults', () => {
  const old = state();
  old.version = 1;
  const next = migrateState(old);
  expect(next.version).toBe(STATE_VERSION);
  expect(next.foodLog.find((e) => e.origin === 'photo')?.estimateQuality?.overallConfidence).toBe('low');
  expect(next.sessions[0].pain).toBeUndefined();
});

it('only permits deletion of an object in the signed-in folder', () => {
  expect(photoObjectForDeletion('storage:food-photos/user-1/meal-1.jpg', 'user-1')).toBe('user-1/meal-1.jpg');
  expect(photoObjectForDeletion('storage:food-photos/user-2/meal-1.jpg', 'user-1')).toBeNull();
});

it('keeps a photo tombstone for retry when Storage removal fails', async () => {
  const entry = { ...state().foodLog[0], id: 'meal-1', photoUri: 'storage:food-photos/user-1/meal-1.jpg', deleted: true, updatedAt: now };
  const s = { ...state(), foodLog: [entry] };
  let fail = true;
  const remove = jest.fn(async () => fail ? { error: new Error('offline') } : { error: null });
  const upsert = jest.fn(async () => ({ error: null }));
  const row = { collection: 'foodLog', id: entry.id, data: entry, updated_at: now, deleted: true, synced_at: now };
  const query = { eq: () => query, gt: () => query, order: () => query, limit: async () => ({ data: [row], error: null }) };
  (supabase as jest.Mock).mockReturnValue({ storage: { from: () => ({ remove }) }, from: () => ({ upsert, select: () => query }) });
  const cursor = { lastPulledAt: '1970-01-01T00:00:00.000Z', lastPushedAt: '1970-01-01T00:00:00.000Z' };
  const first = await syncNow(s, 'user-1', cursor);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(first.rows.find((r) => r.id === entry.id)?.data).toHaveProperty('photoUri', entry.photoUri);
  fail = false;
  const second = await syncNow(s, 'user-1', cursor);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(second.rows.at(-1)?.data).toHaveProperty('photoUri', undefined);
  expect(upsert).toHaveBeenCalled();
});
