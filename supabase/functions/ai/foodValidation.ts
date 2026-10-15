export type VisionItem = { name: string; portion: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence: string; portion_assumption: string; usda_search_query: string; review_required?: boolean };
export type FoodHit = { fdcId: number; description: string; brandOwner?: string; dataType?: string; foodNutrients?: { nutrientNumber?: string; value?: number }[] };

const numeric = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const short = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export function validateVisionItem(raw: unknown): VisionItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = short(r.name, 100);
  const grams = numeric(r.grams, 5000);
  const calories = numeric(r.calories, 10000);
  const protein = numeric(r.protein_g, 1000);
  const carbs = numeric(r.carbs_g, 2000);
  const fat = numeric(r.fat_g, 1000);
  if (!name || grams === null || grams <= 0 || calories === null || protein === null || carbs === null || fat === null) return null;
  const kcalFromMacros = protein * 4 + carbs * 4 + fat * 9;
  const review = grams > 2000 || calories > 3500 || calories / grams > 10 || kcalFromMacros > calories * 2.5 || (calories > 100 && kcalFromMacros < calories * 0.15);
  return {
    name, portion: short(r.portion, 80) || 'Estimated serving', grams, calories,
    protein_g: protein, carbs_g: carbs, fat_g: fat,
    confidence: ['high', 'medium', 'low'].includes(String(r.confidence)) ? String(r.confidence) : 'low',
    portion_assumption: short(r.portion_assumption, 200), usda_search_query: short(r.usda_search_query, 100),
    review_required: review,
  };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
const ignored = new Set(['a', 'the', 'with', 'and', 'of', 'in', 'one', 'slice', 'piece', 'serving', 'size', 'large', 'small', 'medium', 'fresh', 'about']);
const cooked = /\b(cooked|roasted|grilled|baked|fried|boiled|steamed|sauteed)\b/i;
const raw = /\b(raw|uncooked)\b/i;

/** Conservative automatic match: ambiguous foods remain visual estimates for user review. */
export function matchingFood(item: VisionItem, hits: FoodHit[]): FoodHit | null {
  const name = `${item.name} ${item.usda_search_query}`;
  const requested = words(item.name).filter((w) => !ignored.has(w) && !['raw', 'uncooked', 'cooked', 'roasted', 'grilled', 'baked', 'fried', 'boiled', 'steamed', 'sauteed'].includes(w));
  if (!requested.length) return null;
  for (const hit of hits.slice(0, 8)) {
    const description = hit.description ?? '';
    if (raw.test(name) && cooked.test(description)) continue;
    if (cooked.test(name) && raw.test(description)) continue;
    if (hit.dataType === 'Branded') {
      if (!hit.brandOwner || !item.name.toLowerCase().includes(hit.brandOwner.toLowerCase())) continue;
    } else if (hits.some((h) => h.dataType === 'Branded' && h.brandOwner && item.name.toLowerCase().includes(h.brandOwner.toLowerCase()))) {
      continue;
    }
    const found = new Set(words(description));
    if (!requested.every((w) => found.has(w))) continue;
    const kcal = hit.foodNutrients?.find((n) => ['208', '957', '958'].includes(n.nutrientNumber ?? ''))?.value;
    if (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal <= 0) continue;
    const scaled = kcal * item.grams / 100;
    if (item.calories > 0 && (scaled < item.calories * 0.4 || scaled > item.calories * 2.5)) continue;
    return hit;
  }
  return null;
}
