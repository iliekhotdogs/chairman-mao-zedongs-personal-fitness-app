import type { Confidence, EstimateItem, FoodEntry, FoodEstimate, FoodItem, MealType, ISODate } from '../types';
import { newId } from '../id';
import { nowISO } from '../dates';
import { detectBrand } from './foodDb';
import { bestMatch, itemFromRef, parseQuantity, portionFor, sizeWord } from './lookup';

/**
 * SIMULATED photo estimator used until a real vision AI provider is connected.
 * It cannot see the photo — it reads the user's hint and matches it against the
 * built-in reference table. Results are labelled as simulated in the UI.
 */
export function simulateFoodEstimate(input: { hint?: string; photoUri?: string }): FoodEstimate {
  const hint = input.hint?.trim() ?? '';
  const base = {
    id: newId(),
    createdAt: nowISO(),
    hint: hint || undefined,
    photoUri: input.photoUri,
    simulated: true,
    provider: 'Simulated (hint-based, offline)',
  };

  if (!hint) {
    return {
      ...base,
      items: [],
      overallConfidence: 'low',
      followUpQuestion: 'What is in the photo? A few words is enough, e.g. "chicken, rice and broccoli".',
      notes: ['Simulated mode cannot analyse the image itself, so it needs a short description.'],
    };
  }

  const brand = detectBrand(hint);
  const segments = hint
    .split(/,|\band\b|\bwith\b|\+|&/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const items: EstimateItem[] = [];
  const unmatched: string[] = [];
  for (const seg of segments.length ? segments : [hint]) {
    const ref = bestMatch(seg);
    if (!ref) {
      unmatched.push(seg);
      continue;
    }
    if (items.some((i) => i.name === ref.name)) continue;
    const q = parseQuantity(seg);
    // Branded doubles are usually the larger 'premium' size unless the user says otherwise.
    const portion = portionFor(ref, q, { size: sizeWord(seg), preferLarge: Boolean(brand) && ref.id === 'burger_double' });
    const item = itemFromRef(ref, portion.grams, portion.label);
    let confidence: Confidence = portion.assumed ? 'medium' : 'high';
    if (ref.generic) confidence = 'medium';
    if (ref.generic && portion.assumed) confidence = 'low';
    items.push({
      ...item,
      confidence,
      portionAssumption: portion.assumed
        ? `Assumed a typical portion (${portion.label}, ~${Math.round(portion.grams)} g) — the photo was not measured.`
        : `Portion from your hint (${portion.label}).`,
      alternatives: ref.portions.length > 1 ? ref.portions.map((p) => p.label) : undefined,
    });
  }

  const notes: string[] = [];
  let followUpQuestion: string | undefined;
  if (brand) {
    notes.push(`Looks like a ${titleCase(brand)} item. Official restaurant nutrition is used when the server nutrition service is connected; this simulated estimate uses generic fast-food reference values instead.`);
    followUpQuestion = `Which exact ${titleCase(brand)} menu item and size was it? (e.g. "Dave's Double, no cheese")`;
  }
  if (unmatched.length) {
    notes.push(`Couldn't match: ${unmatched.map((u) => `"${u}"`).join(', ')}. Add it manually or rephrase.`);
    followUpQuestion = followUpQuestion ?? `How would you describe "${unmatched[0]}"? You can also add it as a manual item.`;
  }
  if (!items.length) {
    return { ...base, items, overallConfidence: 'low', followUpQuestion: followUpQuestion ?? 'Could you describe the food in a few words?', notes };
  }

  const order: Confidence[] = ['low', 'medium', 'high'];
  const overall = items.reduce<Confidence>((acc, i) => (order.indexOf(i.confidence) < order.indexOf(acc) ? i.confidence : acc), 'high');
  notes.push('Calories from a photo are always an estimate — portion size is the biggest source of error.');
  return { ...base, items, overallConfidence: brand ? minConfidence(overall, 'medium') : overall, followUpQuestion, notes };
}

function minConfidence(a: Confidence, b: Confidence): Confidence {
  const order: Confidence[] = ['low', 'medium', 'high'];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
}

function titleCase(s: string) {
  // capitalise words only (a \b-based regex would turn "wendy's" into "Wendy'S")
  return s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export class FoodConfirmationError extends Error {}

/**
 * The ONLY way an AI estimate becomes a food log entry. Requires an explicit user
 * acceptance flag and valid values; anything else throws. Items edited by the user
 * are re-labelled so their source reflects the change.
 */
export function confirmEstimate(args: {
  estimate: FoodEstimate;
  items: FoodItem[];
  meal: MealType;
  date: ISODate;
  userAccepted: boolean;
}): FoodEntry {
  const { estimate, items, meal, date, userAccepted } = args;
  if (userAccepted !== true) throw new FoodConfirmationError('The calorie estimate must be explicitly accepted before logging.');
  if (!items.length) throw new FoodConfirmationError('Add at least one food item before logging.');
  for (const i of items) {
    if (!Number.isFinite(i.calories) || i.calories < 0 || i.calories > 5000) throw new FoodConfirmationError(`"${i.name}" has an invalid calorie value.`);
    if ([i.proteinG, i.carbsG, i.fatG].some((v) => !Number.isFinite(v) || v < 0)) throw new FoodConfirmationError(`"${i.name}" has an invalid macro value.`);
  }
  const now = nowISO();
  return {
    id: newId(),
    date,
    meal,
    items: items.map(stripEstimateFields),
    origin: 'photo',
    photoUri: estimate.photoUri,
    hint: estimate.hint,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function stripEstimateFields(i: FoodItem): FoodItem {
  const { name, portionLabel, grams, calories, proteinG, carbsG, fatG, source } = i;
  return { name, portionLabel, grams, calories, proteinG, carbsG, fatG, source };
}

export function manualEntry(args: { items: FoodItem[]; meal: MealType; date: ISODate }): FoodEntry {
  if (!args.items.length) throw new FoodConfirmationError('Add at least one food item.');
  const now = nowISO();
  return { id: newId(), date: args.date, meal: args.meal, items: args.items, origin: 'manual', confirmedAt: now, createdAt: now, updatedAt: now };
}

/** Mark an item as user-edited so it is no longer presented as sourced data. */
export function markEdited(original: FoodItem, next: FoodItem): FoodItem {
  const changed = original.calories !== next.calories || original.proteinG !== next.proteinG || original.carbsG !== next.carbsG || original.fatG !== next.fatG;
  if (!changed) return next;
  if (original.grams && next.grams && original.grams !== next.grams) {
    // portion change only: nutrition density is still from the source
    return next;
  }
  return { ...next, source: { kind: 'user_entered', sourced: false, label: `Edited by you (was ${original.calories} kcal from: ${original.source.label})` } };
}

export function defaultMealForTime(d = new Date()): MealType {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 22) return 'dinner';
  return 'snack';
}
