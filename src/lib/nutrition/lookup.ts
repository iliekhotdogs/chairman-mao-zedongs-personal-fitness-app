import type { FoodItem, NutritionSource } from '../types';
import { round } from '../units';
import { FOOD_DB, type RefFood } from './foodDb';

export function referenceSource(ref: RefFood): NutritionSource {
  if (ref.generic === 'restaurant') {
    return { kind: 'database', sourced: true, label: `Generic reference values for "${ref.name}" (not official restaurant data)` };
  }
  return { kind: 'database', sourced: true, label: `Reference values (USDA FoodData Central generic) for "${ref.name}"` };
}

export function itemFromRef(ref: RefFood, grams: number, portionLabel: string): FoodItem {
  const k = grams / 100;
  return {
    name: ref.name,
    portionLabel,
    grams: round(grams),
    calories: Math.round(ref.kcal * k),
    proteinG: round(ref.p * k, 1),
    carbsG: round(ref.c * k, 1),
    fatG: round(ref.f * k, 1),
    source: referenceSource(ref),
  };
}

/** Scale an item to a new gram amount (keeps the source). */
export function scaleItem(item: FoodItem, grams: number): FoodItem {
  if (!item.grams || item.grams <= 0) return item;
  const k = grams / item.grams;
  return {
    ...item,
    grams: round(grams),
    calories: Math.round(item.calories * k),
    proteinG: round(item.proteinG * k, 1),
    carbsG: round(item.carbsG * k, 1),
    fatG: round(item.fatG * k, 1),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Score how well a reference food matches free text (higher is better; 0 = no match). */
export function matchScore(ref: RefFood, text: string): number {
  const t = ` ${norm(text)} `;
  let best = 0;
  for (const alias of [ref.name.toLowerCase(), ...ref.aliases]) {
    const a = norm(alias);
    if (!a) continue;
    if (t.includes(` ${a} `) || t.includes(` ${a}s `)) best = Math.max(best, a.length + 10);
    else if (a.length > 3 && t.includes(a)) best = Math.max(best, a.length);
  }
  return best;
}

export function searchFoods(query: string, limit = 8): RefFood[] {
  const q = norm(query);
  if (!q) return [];
  return FOOD_DB.map((f) => ({ f, s: Math.max(matchScore(f, q), f.name.toLowerCase().includes(q) ? q.length + 5 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.f);
}

export function bestMatch(text: string): RefFood | undefined {
  return searchFoods(text, 1)[0];
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, couple: 2,
};

export interface QuantitySpec {
  grams?: number;
  count?: number;
  unit?: string;
}

/** Extract "200g", "6 oz", "2 cups", "two eggs", "1.5 slices" from a phrase. */
export function parseQuantity(text: string): QuantitySpec {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?|\b(?:a|an|one|two|three|four|five|six|half|couple)\b)\s*(g|grams?|oz|ounces?|cups?|slices?|pieces?|tbsp|tablespoons?|scoops?|bowls?|plates?)?\b/);
  if (!m) return {};
  const raw = m[1];
  const n = NUMBER_WORDS[raw] ?? parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return {};
  const unit = m[2];
  if (unit && /^g|gram/.test(unit)) return { grams: n };
  if (unit && /^oz|ounce/.test(unit)) return { grams: n * 28.35 };
  // ignore bare numbers that are part of a brand/size ("16 oz" handled above, "4 for 4")
  if (!unit && n > 12) return {};
  return { count: n, unit };
}

/** Grams for a quantity of a reference food, plus a human-readable portion label. */
export function portionFor(ref: RefFood, q: QuantitySpec, opts: { preferLarge?: boolean; size?: string } = {}): { grams: number; label: string; assumed: boolean } {
  if (q.grams) return { grams: q.grams, label: `${Math.round(q.grams)} g`, assumed: false };
  const sized = opts.size ? ref.portions.find((p) => p.label.toLowerCase().includes(opts.size!)) : undefined;
  const portion = sized ?? ((opts.preferLarge && ref.portions[1]) || ref.portions[0]);
  if (q.count) {
    const unitPortion = q.unit ? ref.portions.find((p) => p.label.includes(q.unit!.replace(/s$/, ''))) ?? portion : portion;
    const base = unitPortion.label.match(/^(\d+(?:\.\d+)?)\s/);
    const perLabel = base ? parseFloat(base[1]) : 1;
    const grams = (unitPortion.grams / perLabel) * q.count;
    return { grams, label: `${q.count} × ${unitPortion.label.replace(/^\d+(?:\.\d+)?\s/, '')}`, assumed: false };
  }
  return { grams: portion.grams, label: portion.label, assumed: !sized };
}

/** 'small' | 'medium' | 'regular' | 'large' if the phrase names a size. */
export function sizeWord(text: string): string | undefined {
  return text.toLowerCase().match(/\b(small|medium|regular|large)\b/)?.[1];
}

export function sumItems(items: Pick<FoodItem, 'calories' | 'proteinG' | 'carbsG' | 'fatG'>[]) {
  return items.reduce(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      proteinG: round(acc.proteinG + i.proteinG, 1),
      carbsG: round(acc.carbsG + i.carbsG, 1),
      fatG: round(acc.fatG + i.fatG, 1),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

// ---------- Live lookup: USDA FoodData Central ----------

export interface FdcResult {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType: string;
  per100g: { kcal: number; p: number; c: number; f: number };
}

/**
 * Searches USDA FoodData Central. `DEMO_KEY` works for light testing (strict rate limits);
 * a free personal key from api.data.gov is recommended. USDA keys are not secret, but in
 * production this call should go through the server so the key and rate limit are shared.
 */
export async function searchFdc(query: string, apiKey: string, signal?: AbortSignal): Promise<FdcResult[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=8&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS),Branded`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(res.status === 429 ? 'USDA rate limit reached — try again later.' : `USDA lookup failed (${res.status})`);
  const json = (await res.json()) as { foods?: { fdcId: number; description: string; brandOwner?: string; dataType: string; foodNutrients: { nutrientNumber?: string; nutrientName?: string; value?: number; unitName?: string }[] }[] };
  return (json.foods ?? []).map((f) => {
    const get = (nums: string[]) => f.foodNutrients.find((n) => n.nutrientNumber && nums.includes(n.nutrientNumber))?.value ?? 0;
    return {
      fdcId: f.fdcId,
      description: f.description,
      brandOwner: f.brandOwner,
      dataType: f.dataType,
      per100g: { kcal: get(['208', '957', '958']), p: get(['203']), c: get(['205']), f: get(['204']) },
    };
  });
}

export function itemFromFdc(r: FdcResult, grams: number, portionLabel: string): FoodItem {
  const k = grams / 100;
  return {
    name: r.brandOwner ? `${r.description} (${r.brandOwner})` : r.description,
    portionLabel,
    grams: round(grams),
    calories: Math.round(r.per100g.kcal * k),
    proteinG: round(r.per100g.p * k, 1),
    carbsG: round(r.per100g.c * k, 1),
    fatG: round(r.per100g.f * k, 1),
    source: {
      kind: r.dataType === 'Branded' ? 'label' : 'database',
      sourced: true,
      label: `USDA FoodData Central #${r.fdcId} (${r.dataType})`,
      url: `https://fdc.nal.usda.gov/food-details/${r.fdcId}/nutrients`,
    },
  };
}
