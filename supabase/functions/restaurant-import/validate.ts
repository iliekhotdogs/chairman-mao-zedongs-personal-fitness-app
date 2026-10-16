// Validation and keep-or-replace decision for one source's parsed rows. Pure; tested in import.test.ts.
// zod is pinned to the app's version (package.json).
import { z } from 'npm:zod@4.6.7';

/** What a parser emits; numbers may be missing when a cell could not be read. */
export type RawItem = {
  name: string; serving: string;
  calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number;
  source_url: string; checked_at: string;
};

const grams = z.number().finite().min(0).max(400);
export const itemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  serving: z.string().trim().min(1).max(80),
  // Same ceiling as the app's food log (confirmEstimate). Calories are required.
  calories: z.number().finite().gt(0).max(5000),
  protein_g: grams, carbs_g: grams, fat_g: grams,
  source_url: z.url({ protocol: /^https$/ }),
  checked_at: z.iso.datetime(),
}).refine((i) => i.protein_g * 4 + i.carbs_g * 4 + i.fat_g * 9 <= i.calories * 1.5 + 50, 'macros do not fit the calories');
export type Item = z.infer<typeof itemSchema>;

/** Valid rows (first of any duplicate name + serving) and the number rejected. */
export function validateItems(raw: RawItem[]): { items: Item[]; rejected: number } {
  const seen = new Set<string>();
  const items: Item[] = [];
  let rejected = 0;
  for (const row of raw) {
    const parsed = itemSchema.safeParse(row);
    if (!parsed.success) { rejected++; continue; }
    const key = `${parsed.data.name.toLowerCase()}|${parsed.data.serving.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); items.push(parsed.data); }
  }
  return { items, rejected };
}

export type Decision = { replace: boolean; status: 'ok' | 'needs_review'; note: string | null };

/** Replace the stored rows only when the new parse looks complete; otherwise keep the old ones. */
export function decideImport(previousCount: number, valid: number, rejected: number): Decision {
  if (valid === 0) return { replace: false, status: 'needs_review', note: 'The parser found no valid items; the page layout may have changed. Previous items kept.' };
  if (previousCount > 0 && valid < previousCount * 0.5) return { replace: false, status: 'needs_review', note: `Only ${valid} items parsed, fewer than half of the ${previousCount} stored. Previous items kept.` };
  if (rejected > (valid + rejected) * 0.2) return { replace: false, status: 'needs_review', note: `${rejected} of ${valid + rejected} rows failed validation. Previous items kept.` };
  return { replace: true, status: 'ok', note: null };
}
