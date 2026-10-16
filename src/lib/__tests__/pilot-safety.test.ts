import { buildSampleState } from '../sampleData';
import { checkAction, reducer } from '../reducer';
import { calorieFloor } from '../nutrition/targets';
import { hasInjuryRedFlag, isUrgentSymptom, simulateCoachReply } from '../coaching/coachSim';
import { migrateState, STATE_VERSION } from '../state';
import { matchingFood, validateVisionItem } from '../../../supabase/functions/ai/foodValidation';
import type { Proposal } from '../types';

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
