import { buildSampleState } from '../sampleData';
import { checkAction, reducer } from '../reducer';
import { calorieFloor } from '../nutrition/targets';
import { hasInjuryRedFlag, isUrgentSymptom, simulateCoachReply } from '../coaching/coachSim';
import { migrateState } from '../schemaMigrations';
import { STATE_VERSION } from '../state';
import { matchingFood, validateVisionItem } from '../../../supabase/functions/ai/foodValidation';
import type { Proposal } from '../types';

const date = '2026-10-02';
const now = `${date}T12:00:00.000Z`;
const state = () => ({ ...buildSampleState('pilot', date), proposals: [] });

function targetProposal(calories: number): Proposal {
  return { id: 'old', kind: 'target_change', scope: 'ongoing', title: '', summary: '', rationale: [], change: { type: 'target_change', next: { calories, proteinG: 50, carbsG: 50, fatG: 50 } }, status: 'pending', createdAt: now, updatedAt: now, dedupeKey: 'old', origin: 'adaptive_engine' };
}

describe('pilot safety boundaries', () => {
  it.each(['female', 'male', 'unspecified'] as const)('blocks creation and acceptance below the %s floor', (sex) => {
    const s = state();
    s.profile!.sex = sex;
    const bad = targetProposal(calorieFloor(sex) - 1);
    expect(reducer(s, { type: 'ADD_PROPOSALS', proposals: [bad] }).proposals).toHaveLength(0);
    const old = { ...s, proposals: [bad] };
    const action = { type: 'ACCEPT_PROPOSAL' as const, id: bad.id, now, today: date };
    expect(() => checkAction(old, action)).toThrow(/cannot be below/);
    expect(reducer(old, action)).toBe(old);
    const boundary = { ...s, proposals: [targetProposal(calorieFloor(sex))] };
    expect(() => checkAction(boundary, action)).not.toThrow();
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
  it('rejects missing and non-finite amounts and marks implausible portions', () => {
    expect(validateVisionItem({ ...raw, grams: undefined })).toBeNull();
    expect(validateVisionItem({ ...raw, calories: Infinity })).toBeNull();
    expect(validateVisionItem({ ...raw, grams: 0 })).toBeNull();
    expect(validateVisionItem({ ...raw, calories: 4000 })?.review_required).toBe(true);
  });
  it('does not silently match raw, unrelated branded, or mixed dishes', () => {
    const item = validateVisionItem({ ...raw, name: 'Grilled chicken breast' })!;
    expect(matchingFood(item, [{ fdcId: 1, description: 'Chicken breast raw', foodNutrients: [{ nutrientNumber: '208', value: 165 }] }])).toBeNull();
    expect(matchingFood(item, [{ fdcId: 2, description: 'Chicken breast grilled', dataType: 'Branded', brandOwner: 'Other Brand', foodNutrients: [{ nutrientNumber: '208', value: 165 }] }])).toBeNull();
    const mixed = validateVisionItem({ ...raw, name: 'Chicken rice bowl' })!;
    expect(matchingFood(mixed, [{ fdcId: 3, description: 'Chicken rice', foodNutrients: [{ nutrientNumber: '208', value: 165 }] }])).toBeNull();
  });
});

it('migrates old photo entries with conservative quality defaults', () => {
  const old = state();
  old.version = 1;
  const next = migrateState(old) as typeof old;
  expect(next.version).toBe(STATE_VERSION);
  expect(next.foodLog.find((e) => e.origin === 'photo')?.estimateQuality?.overallConfidence).toBe('low');
});
