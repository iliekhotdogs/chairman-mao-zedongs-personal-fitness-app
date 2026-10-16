// deno test --allow-read supabase/functions
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { parseBostonPizza } from './parsers/bostonPizza.ts';
import { parseOliveGarden } from './parsers/oliveGarden.ts';
import { contentText } from './parsers/pdfText.ts';
import { decideImport, validateItems, type RawItem } from './validate.ts';
import { detectRestaurant, disagreement, isStale, rankCandidates, type CatalogItem } from '../_shared/restaurantCatalog.ts';

const AT = '2026-10-15T12:00:00.000Z';
const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));

Deno.test('Boston Pizza parser reads every size block from the saved page', async () => {
  const rows = parseBostonPizza(await fixture('boston-pizza-ca.html'), 'https://bostonpizza.com/en/nutritional-information.html', AT);
  assertEquals(rows.length, 5);
  assertEquals(rows[0], { name: 'Garlic Fingers', serving: 'Indy', calories: 800, protein_g: 26, carbs_g: 112, fat_g: 30, source_url: 'https://bostonpizza.com/en/nutritional-information.html', checked_at: AT });
  assertEquals(rows[2].name, "Boston's Pizza Bread");
  assertEquals(rows[1].serving, 'as served');
  assertEquals(rows.filter((r) => r.name === 'Bandera Pizza Bread').map((r) => r.serving), ['as served', 'Medium']);
  assertEquals(validateItems(rows).rejected, 0);
});

Deno.test('Olive Garden parser reads rows, sections and "less than" cells; skips add-ons and headers', async () => {
  const rows = parseOliveGarden(await fixture('olive-garden-ca.txt'), 'https://www.olivegarden.ca/x.pdf', AT);
  assert(!rows.some((r) => /^add /i.test(r.name)));
  assertEquals(rows.find((r) => r.name === 'Calamari'), { name: 'Calamari', serving: 'as served', calories: 670, protein_g: 24, carbs_g: 48, fat_g: 42, source_url: 'https://www.olivegarden.ca/x.pdf', checked_at: AT });
  assertEquals(rows.filter((r) => r.name === 'Chicken Parmigiana').map((r) => [r.serving, r.calories]), [['Lunch-Sized Favorites', 630], ['as served', 1020]]);
  assertEquals(rows.find((r) => r.name.startsWith('Chicken Alfredo (with grilled'))?.serving, 'with grilled chicken');
  const { items, rejected } = validateItems(rows);
  assertEquals(rejected, 0);
  assertEquals(items.length, rows.length);
});

Deno.test('pdf content stream: same baseline joins with tabs, kerning gaps become spaces, octal escapes decode', () => {
  const lines = contentText('BT 8 0 0 8 20 500 Tm [(Chick)-10 (en)-300 (Parm)]TJ 7 0 0 7 230 500.2 Tm (630)Tj 6 0 Td (we\\222re)Tj 0 -2 Td (Next)Tj ET');
  assertEquals(lines, ['Chicken Parm\t630\twe’re', 'Next']);
});

const row = (over: Partial<RawItem> = {}): RawItem => ({ name: 'Pasta', serving: '1 plate', calories: 600, protein_g: 20, carbs_g: 80, fat_g: 20, source_url: 'https://example.com/n', checked_at: AT, ...over });

Deno.test('validation rejects missing or absurd values and drops duplicates', () => {
  const { items, rejected } = validateItems([
    row(), row(), // duplicate kept once
    row({ name: 'No kcal', calories: undefined }),
    row({ name: 'Zero', calories: 0 }),
    row({ name: 'Huge', calories: 17280 }),
    row({ name: 'Neg', fat_g: -1 }),
    row({ name: 'Macros', calories: 100, fat_g: 90 }),
    row({ name: 'Http', source_url: 'http://example.com' }),
  ]);
  assertEquals(items.length, 1);
  assertEquals(rejected, 6);
});

Deno.test('import decision keeps previous rows on empty, shrinking or noisy parses', () => {
  assertEquals(decideImport(100, 0, 0).replace, false);
  assertEquals(decideImport(100, 40, 0), { replace: false, status: 'needs_review', note: 'Only 40 items parsed, fewer than half of the 100 stored. Previous items kept.' });
  assertEquals(decideImport(100, 60, 30).status, 'needs_review');
  assertEquals(decideImport(100, 95, 2), { replace: true, status: 'ok', note: null });
  assertEquals(decideImport(0, 3, 0).replace, true);
});

const item = (name: string, calories: number, checked_at = AT): CatalogItem => ({ restaurant: 'Olive Garden', name, serving: 'as served', calories, protein_g: 30, carbs_g: 60, fat_g: 20, source_url: 'https://example.com', checked_at });

Deno.test('catalog: restaurant aliases, matching, stale marking and disagreement', () => {
  assertEquals(detectRestaurant('dinner at Olive Garden, chicken parm'), 'Olive Garden');
  assertEquals(detectRestaurant('BOSTON PIZZA wings'), 'Boston Pizza');
  assertEquals(detectRestaurant('garden salad with olive oil'), null);
  const now = Date.parse(AT);
  assert(!isStale(AT, now));
  assert(isStale('2026-08-01T00:00:00Z', now));
  assert(isStale('not a date', now));
  const items = [item('Chicken Parmigiana', 1020, '2026-08-01T00:00:00Z'), item('Eggplant Parmigiana', 1070), item('Fettuccine Alfredo', 1220)];
  const c = rankCandidates(items, ['Olive Garden Chicken Parmigiana'], 600, now);
  // Best match first; a half match stays as an alternative. "Olive Garden" in the guess is ignored.
  assertEquals(c.map((x) => x.name), ['Chicken Parmigiana', 'Eggplant Parmigiana']);
  assertEquals(rankCandidates(items, ['garden salad'], 600, now), []);
  assertEquals(c[0].stale, true);
  assert(c[0].disagreement?.includes('much lower'));
  assertEquals(rankCandidates(items, ['beef burger'], 600, now), []);
  assertEquals(disagreement(1000, 1020), null);
});
