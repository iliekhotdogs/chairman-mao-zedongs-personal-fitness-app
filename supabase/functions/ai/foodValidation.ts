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

// ---------- Coach log/edit intents (F2). Pure; shared by the gateway and the app. ----------

export type FoodIntentItem = { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; grams?: number };
export type WorkoutIntentSet = { exercise: string; reps: number; weight_kg: number; rpe?: number };
export type ActionIntent =
  | { type: 'log_food'; meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack'; items: FoodIntentItem[] }
  | { type: 'edit_food'; entry_id: string; item_index: number; calories: number }
  | { type: 'delete_food'; entry_id: string }
  | { type: 'log_workout'; name?: string; sets: WorkoutIntentSet[] };

export const ACTION_INTENT_TYPES = ['log_food', 'edit_food', 'delete_food', 'log_workout'];
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Returns a cleaned intent, or null when anything is missing or out of bounds. Reject, never clamp. */
export function validateActionIntent(raw: unknown): ActionIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = short(r.entry_id, 64);
  switch (r.type) {
    case 'log_food': {
      if (!Array.isArray(r.items) || r.items.length < 1 || r.items.length > 10) return null;
      const items: FoodIntentItem[] = [];
      for (const it of r.items) {
        const o = (it ?? {}) as Record<string, unknown>;
        const name = short(o.name, 100);
        const protein = o.protein_g === undefined ? 0 : o.protein_g;
        const carbs = o.carbs_g === undefined ? 0 : o.carbs_g;
        const fat = o.fat_g === undefined ? 0 : o.fat_g;
        if (!name || !inRange(o.calories, 0, 5000) || !inRange(protein, 0, 1000) || !inRange(carbs, 0, 2000) || !inRange(fat, 0, 1000)) return null;
        if (o.grams !== undefined && !inRange(o.grams, 1, 5000)) return null;
        items.push({ name, calories: Math.round(o.calories), protein_g: protein, carbs_g: carbs, fat_g: fat, ...(typeof o.grams === 'number' ? { grams: o.grams } : {}) });
      }
      const meal = ['breakfast', 'lunch', 'dinner', 'snack'].includes(String(r.meal)) ? (r.meal as 'breakfast') : undefined;
      return { type: 'log_food', meal, items };
    }
    case 'edit_food': {
      const index = r.item_index === undefined ? 0 : r.item_index;
      if (!id || !inRange(r.calories, 0, 5000) || !Number.isInteger(index) || !inRange(index, 0, 9)) return null;
      return { type: 'edit_food', entry_id: id, item_index: index as number, calories: Math.round(r.calories) };
    }
    case 'delete_food':
      return id ? { type: 'delete_food', entry_id: id } : null;
    case 'log_workout': {
      if (!Array.isArray(r.sets) || r.sets.length < 1 || r.sets.length > 30) return null;
      const sets: WorkoutIntentSet[] = [];
      for (const s of r.sets) {
        const o = (s ?? {}) as Record<string, unknown>;
        const exercise = short(o.exercise, 80);
        if (!exercise || !Number.isInteger(o.reps) || !inRange(o.reps, 1, 300) || !inRange(o.weight_kg, 20, 400)) return null;
        if (o.rpe !== undefined && !inRange(o.rpe, 1, 10)) return null;
        sets.push({ exercise, reps: o.reps as number, weight_kg: o.weight_kg, ...(typeof o.rpe === 'number' ? { rpe: o.rpe } : {}) });
      }
      return { type: 'log_workout', name: short(r.name, 60) || undefined, sets };
    }
    default:
      return null;
  }
}
