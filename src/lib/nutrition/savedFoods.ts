import type { FoodEntry, FoodItem, ISODate, MacroKey, Nutrients, NutritionSource, SavedFood, ServingBasis } from '../types';
import { barcodeCandidates } from './barcode';
import { newId } from '../id';
import { round } from '../units';

/** Upper bounds for one food item (typo guards for editors and saved foods). */
export const FOOD_LIMITS = { kcal: 5000, macroG: 1000, amount: 5000 } as const;

export const MACROS: MacroKey[] = ['proteinG', 'carbsG', 'fatG'];

/** Set one macro; undefined means "unknown" (kept as 0 for totals and flagged missing). */
export function setMacro(item: FoodItem, key: MacroKey, value: number | undefined): FoodItem {
  const rest = (item.missing ?? []).filter((k) => k !== key);
  const missing = value === undefined ? [...rest, key] : rest;
  return { ...item, [key]: value ?? 0, missing: missing.length ? missing : undefined };
}

export const macroValue = (item: FoodItem, key: MacroKey): number | undefined => (item.missing?.includes(key) ? undefined : item[key]);

/** Editable product details awaiting the user's confirmation. */
export interface ProductDraft {
  name: string;
  brand?: string;
  flavour?: string;
  packageSize?: string;
  barcode?: string;
  restaurant?: string;
  basis: ServingBasis;
  nutrients: Nutrients;
  source?: NutritionSource;
}

/** Read the serving basis from an item without inventing a gram weight. */
export function basisFromItem(item: FoodItem): ServingBasis {
  if (item.grams && item.grams > 0) return { unit: 'g', amount: item.grams, label: item.portionLabel };
  // only an amount printed in the serving text itself, e.g. "3/4 cup (175 g)" or "1 can (355 mL)"
  const m = item.portionLabel.match(/(\d+(?:\.\d+)?)\s*(ml|g)\b/i);
  if (m) return { unit: m[2].toLowerCase() === 'ml' ? 'ml' : 'g', amount: parseFloat(m[1]), label: item.portionLabel };
  return { unit: 'serving', amount: 1, label: item.portionLabel || '1 serving' };
}

export function nutrientsFromItem(item: FoodItem): Nutrients {
  return { calories: item.calories, proteinG: macroValue(item, 'proteinG') ?? null, carbsG: macroValue(item, 'carbsG') ?? null, fatG: macroValue(item, 'fatG') ?? null };
}

export function draftFromItem(item: FoodItem, extra: Partial<ProductDraft> = {}): ProductDraft {
  return { name: item.name, basis: basisFromItem(item), nutrients: nutrientsFromItem(item), source: item.source, ...extra };
}

/** Problems that block saving a draft; empty when it can be confirmed. */
export function draftProblems(d: ProductDraft): string[] {
  const out: string[] = [];
  const n = d.nutrients;
  if (!d.name.trim()) out.push('Add a name.');
  if (n.calories === null || !(n.calories > 0) || n.calories > FOOD_LIMITS.kcal) out.push(`Calories must be above 0 and at most ${FOOD_LIMITS.kcal}.`);
  if (MACROS.some((k) => n[k] !== null && !(n[k]! >= 0 && n[k]! <= FOOD_LIMITS.macroG))) out.push(`Macros must be 0 to ${FOOD_LIMITS.macroG} g.`);
  if (!(d.basis.amount > 0 && d.basis.amount <= FOOD_LIMITS.amount)) out.push('Enter the serving size.');
  if (!d.basis.label.trim()) out.push('Describe the serving as printed on the label.');
  return out;
}

const clean = (s?: string) => s?.trim() || undefined;

export function savedFoodFromDraft(d: ProductDraft, kind: SavedFood['kind'], now: string, id = newId()): SavedFood {
  return {
    id, kind, name: d.name.trim(), brand: clean(d.brand), flavour: clean(d.flavour), packageSize: clean(d.packageSize), barcode: clean(d.barcode), restaurant: clean(d.restaurant),
    basis: { ...d.basis, label: d.basis.label.trim() }, nutrients: d.nutrients, source: d.source, confirmedAt: now, createdAt: now, updatedAt: now,
  };
}

/** One serving of a saved food as a log item. Grams only when the label basis is grams; undefined without calories. */
export function itemFromSaved(f: Pick<SavedFood, 'name' | 'brand' | 'flavour' | 'basis' | 'nutrients' | 'source' | 'barcode'>): FoodItem | undefined {
  const n = f.nutrients;
  if (n.calories === null) return undefined;
  const missing = MACROS.filter((k) => n[k] === null);
  const name = [f.name, f.flavour].filter(Boolean).join(', ');
  return {
    name: f.brand && !name.toLowerCase().includes(f.brand.toLowerCase()) ? `${name} (${f.brand})` : name,
    portionLabel: f.basis.label,
    grams: f.basis.unit === 'g' ? f.basis.amount : undefined,
    calories: Math.round(n.calories),
    proteinG: n.proteinG ?? 0,
    carbsG: n.carbsG ?? 0,
    fatG: n.fatG ?? 0,
    missing: missing.length ? missing : undefined,
    source: f.source ?? { kind: 'user_entered', sourced: false, label: `Your saved food${f.barcode ? ` (barcode ${f.barcode})` : ''}` },
  };
}

/** The user's confirmed product for a barcode (any equivalent UPC/EAN form), newest first. */
export function findSavedByBarcode(list: SavedFood[], code: string): SavedFood | undefined {
  const want = new Set(barcodeCandidates(code));
  if (!want.size) return undefined;
  return list
    .filter((f) => !f.deleted && f.barcode && barcodeCandidates(f.barcode).some((c) => want.has(c)))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
}

/** Sum a meal into one restaurant dish; a macro is unknown if any item lacks it. */
export function dishFromEntry(entry: FoodEntry, restaurant: string, name: string): ProductDraft {
  const sum = (k: 'calories' | MacroKey) => (entry.items.some((i) => k !== 'calories' && i.missing?.includes(k)) ? null : round(entry.items.reduce((s, i) => s + i[k], 0), 1));
  return {
    name,
    restaurant,
    basis: { unit: 'serving', amount: 1, label: '1 order' },
    nutrients: { calories: sum('calories'), proteinG: sum('proteinG'), carbsG: sum('carbsG'), fatG: sum('fatG') },
    source: entry.items.length === 1 ? entry.items[0].source : { kind: 'user_entered', sourced: false, label: `Saved from your meal on ${entry.date}` },
  };
}

/** A fresh copy of a confirmed meal for `date`: new id and item copies, so later edits to either never touch the other. */
export function logAgain(entry: FoodEntry, date: ISODate, now: string): FoodEntry {
  return {
    ...entry,
    id: newId(),
    date,
    items: entry.items.map((i) => ({ ...i, source: { ...i.source }, missing: i.missing ? [...i.missing] : undefined })),
    photoUri: undefined, // the photo stays with the original meal
    origin: 'manual',
    deleted: undefined,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

const mealKey = (e: FoodEntry) => e.items.map((i) => i.name.toLowerCase()).sort().join('|');

/** Most recent distinct meals (by item names), newest first. */
export function recentMeals(foodLog: FoodEntry[], limit = 5): FoodEntry[] {
  const seen = new Set<string>();
  const out: FoodEntry[] = [];
  for (const e of [...foodLog].filter((x) => !x.deleted && x.items.length).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))) {
    const k = mealKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Restaurants with saved dishes, most recently used first. */
export function restaurantsVisited(saved: SavedFood[]): { restaurant: string; dishes: SavedFood[] }[] {
  const by = new Map<string, { restaurant: string; dishes: SavedFood[]; last: string }>();
  for (const f of saved) {
    if (f.deleted || f.kind !== 'restaurant' || !f.restaurant?.trim()) continue;
    const key = f.restaurant.trim().toLowerCase();
    const g = by.get(key) ?? { restaurant: f.restaurant.trim(), dishes: [], last: '' };
    g.dishes.push(f);
    if (f.updatedAt > g.last) g.last = f.updatedAt;
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (a.last < b.last ? 1 : -1)).map(({ restaurant, dishes }) => ({ restaurant, dishes }));
}
