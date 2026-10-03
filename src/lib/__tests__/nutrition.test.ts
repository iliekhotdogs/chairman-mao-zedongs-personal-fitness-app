import { bmrMifflin, computeTargets, targetsForDay } from '../nutrition/targets';
import { confirmEstimate, FoodConfirmationError, markEdited, simulateFoodEstimate } from '../nutrition/estimate';
import { parseQuantity, scaleItem, searchFoods } from '../nutrition/lookup';
import type { Profile } from '../types';

const profile: Pick<Profile, 'sex' | 'birthYear' | 'heightCm' | 'dailyActivity' | 'trainingDays' | 'sessionMinutes' | 'goal'> = {
  sex: 'male', birthYear: new Date().getFullYear() - 28, heightCm: 175, dailyActivity: 'mostly_sitting', trainingDays: [1, 3, 4, 5], sessionMinutes: 60, goal: 'muscle_gain',
};

describe('targets', () => {
  it('uses Mifflin-St Jeor', () => {
    expect(Math.round(bmrMifflin('male', 80, 180, 30))).toBe(1780);
    expect(Math.round(bmrMifflin('female', 60, 165, 30))).toBe(1320);
  });

  it('includes planned training in maintenance and applies the goal adjustment', () => {
    const t = computeTargets(profile, 77.1);
    expect(t.baselineTrainingKcal).toBe(171);
    expect(t.maintenance).toBeGreaterThan(t.bmr * 1.2);
    expect(t.calories).toBeCloseTo(t.maintenance * 1.1, -1);
    // macros add up to roughly the calorie target
    expect(Math.abs(t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9 - t.calories)).toBeLessThan(15);
  });

  it('never goes below a safe floor', () => {
    const t = computeTargets({ ...profile, sex: 'female', heightCm: 150, goal: 'fat_loss', trainingDays: [] }, 40);
    expect(t.calories).toBeGreaterThanOrEqual(1200);
  });

  it('applies a one-day adjustment only to its date', () => {
    const base = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 };
    const adj = [{ id: 'a', date: '2026-10-02', calorieDelta: 250, carbsDeltaG: 63, reason: '', proposalId: 'p', updatedAt: '' }];
    expect(targetsForDay(base, adj, '2026-10-02').calories).toBe(2250);
    expect(targetsForDay(base, adj, '2026-10-03').calories).toBe(2000);
  });
});

describe('food lookup', () => {
  it('parses quantities', () => {
    expect(parseQuantity('200g chicken')).toEqual({ grams: 200 });
    expect(parseQuantity('two eggs')).toEqual({ count: 2, unit: undefined });
    expect(parseQuantity('1.5 cups rice')).toEqual({ count: 1.5, unit: 'cups' });
    expect(parseQuantity('6 oz steak').grams).toBeCloseTo(170.1, 0);
  });

  it('finds foods by alias', () => {
    expect(searchFoods('grilled chicken')[0].id).toBe('chicken_breast');
    expect(searchFoods('fries')[0].id).toBe('fries');
  });

  it('scales items proportionally', () => {
    const item = { name: 'x', portionLabel: '100 g', grams: 100, calories: 200, proteinG: 10, carbsG: 20, fatG: 5, source: { kind: 'database' as const, sourced: true, label: 'x' } };
    expect(scaleItem(item, 150).calories).toBe(300);
  });
});

describe('simulated photo estimate', () => {
  it('asks a follow-up when there is no hint', () => {
    const e = simulateFoodEstimate({ photoUri: 'file://x.jpg' });
    expect(e.items).toHaveLength(0);
    expect(e.followUpQuestion).toBeTruthy();
    expect(e.simulated).toBe(true);
  });

  it('identifies multiple foods with portions from the hint', () => {
    const e = simulateFoodEstimate({ hint: '2 eggs and 1 slice toast' });
    expect(e.items.map((i) => i.name)).toEqual(['Egg, whole, cooked', 'White bread']);
    expect(e.items[0].grams).toBe(100);
    expect(e.items[0].confidence).toBe('high');
  });

  it('flags restaurant items as generic and asks which menu item', () => {
    const e = simulateFoodEstimate({ hint: "Wendy's double burger and medium fries" });
    expect(e.followUpQuestion).toMatch(/Wendy's/);
    expect(e.notes.join(' ')).toMatch(/Official restaurant nutrition/);
    const fries = e.items.find((i) => i.name.startsWith('French fries'))!;
    expect(fries.portionLabel).toBe('medium serving');
    expect(e.items[0].source.label).toMatch(/not official/);
  });

  it('reports unmatched foods', () => {
    const e = simulateFoodEstimate({ hint: 'chicken and zorblax' });
    expect(e.items).toHaveLength(1);
    expect(e.notes.join(' ')).toMatch(/zorblax/);
  });
});

describe('food confirmation rule', () => {
  const estimate = simulateFoodEstimate({ hint: 'chicken breast and rice' });

  it('refuses to log without explicit acceptance', () => {
    expect(() => confirmEstimate({ estimate, items: estimate.items, meal: 'lunch', date: '2026-10-02', userAccepted: false })).toThrow(FoodConfirmationError);
    // @ts-expect-error — guards against truthy non-boolean values too
    expect(() => confirmEstimate({ estimate, items: estimate.items, meal: 'lunch', date: '2026-10-02', userAccepted: 'yes' })).toThrow(FoodConfirmationError);
  });

  it('refuses empty or invalid items', () => {
    expect(() => confirmEstimate({ estimate, items: [], meal: 'lunch', date: '2026-10-02', userAccepted: true })).toThrow();
    expect(() => confirmEstimate({ estimate, items: [{ ...estimate.items[0], calories: -5 }], meal: 'lunch', date: '2026-10-02', userAccepted: true })).toThrow();
  });

  it('logs accepted estimates with a confirmation timestamp and no AI-only fields', () => {
    const entry = confirmEstimate({ estimate, items: estimate.items, meal: 'lunch', date: '2026-10-02', userAccepted: true });
    expect(entry.confirmedAt).toBeTruthy();
    expect(entry.origin).toBe('photo');
    expect('confidence' in entry.items[0]).toBe(false);
  });

  it('marks macro edits as user-entered', () => {
    const it0 = estimate.items[0];
    const edited = markEdited(it0, { ...it0, calories: it0.calories + 50 });
    expect(edited.source.kind).toBe('user_entered');
    expect(edited.source.sourced).toBe(false);
    expect(markEdited(it0, { ...it0 }).source.kind).toBe(it0.source.kind);
  });
});
