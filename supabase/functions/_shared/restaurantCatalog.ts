// Read side of the shared restaurant catalog (restaurant_items, filled by restaurant-import).
// Pure helpers plus one query; used by the ai gateway's estimate_food action.

/** Catalog values older than this are labelled "may be out of date", never shown as current. */
export const STALE_DAYS = 30;

export type CatalogItem = {
  restaurant: string; name: string; serving: string;
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
  source_url: string; checked_at: string;
};
export type Candidate = CatalogItem & { stale: boolean; disagreement: string | null };

/** Supported restaurants; `name` must equal restaurant_sources.restaurant. */
export const RESTAURANTS: { name: string; aliases: string[] }[] = [
  { name: 'Boston Pizza', aliases: ['boston pizza', 'bostonpizza', 'boston pizzas'] },
  { name: 'Olive Garden', aliases: ['olive garden', 'olivegarden'] },
];

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The supported restaurant named in free text, or null. */
export function detectRestaurant(text: string | null | undefined): string | null {
  const folded = ` ${fold(text ?? '')} `;
  return RESTAURANTS.find((r) => r.aliases.some((alias) => folded.includes(` ${alias} `)))?.name ?? null;
}

const STOP = new Set(['the', 'and', 'with', 'of', 'an', 'in', 'on', 'or', 'side', 'plate', 'order', 'size', 'meal', 'dish']);
// Restaurant names the model may prefix to a dish are removed first ("Olive Garden" must not match "Garden Salad").
const ALIASES = RESTAURANTS.flatMap((r) => r.aliases);
const terms = (s: string) => ALIASES.reduce((t, alias) => t.replaceAll(` ${alias} `, ' '), ` ${fold(s)} `).split(' ').filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/(?<=..)s$/, ''));

export const isStale = (checkedAt: string, now = Date.now()) => !(now - Date.parse(checkedAt) <= STALE_DAYS * 86_400_000);

/** Fraction of the guess's words found in the item name (0..1). */
export function matchScore(guess: string, itemName: string): number {
  const g = terms(guess);
  if (!g.length) return 0;
  const have = new Set(terms(itemName));
  return g.filter((t) => have.has(t)).length / g.length;
}

/** Note when the photo estimate and the official value differ by more than 35%. */
export function disagreement(photoKcal: number, officialKcal: number): string | null {
  if (!(photoKcal > 0 && officialKcal > 0)) return null;
  const ratio = photoKcal / officialKcal;
  if (ratio >= 0.65 && ratio <= 1.35) return null;
  return `The photo estimate (${Math.round(photoKcal)} kcal) is ${ratio < 1 ? 'much lower' : 'much higher'} than the official value (${Math.round(officialKcal)} kcal). Check the portion: you may have eaten ${ratio < 1 ? 'part of it' : 'more than one serving or extra sides'}.`;
}

/** Up to `limit` credible catalog matches for the model's dish guesses, best first. */
export function rankCandidates(items: CatalogItem[], guesses: string[], photoKcal: number, now = Date.now(), limit = 3): Candidate[] {
  const scored = items.map((item) => ({ item, score: Math.max(0, ...guesses.map((g) => matchScore(g, item.name))) }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map(({ item }) => ({ ...item, stale: isStale(item.checked_at, now), disagreement: disagreement(photoKcal, item.calories) }));
}

export const CATALOG_COLUMNS = 'restaurant, name, serving, calories, protein_g, carbs_g, fat_g, source_url, checked_at';
