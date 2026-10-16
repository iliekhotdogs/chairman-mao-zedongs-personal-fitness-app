// Olive Garden Canada nutrition guide (PDF), as text from pdfText(): one row per line,
// "name<TAB>11 values" in the order Calories, Calories from Fat, Total Fat, Saturated Fat,
// Trans Fat, Cholesterol, Sodium, Total Carbs, Dietary Fiber, Sugars, Protein.
import type { RawItem } from '../validate.ts';

const COLUMNS = 11;
const HEADER = /^\(|^(menu item|calories|from fat|total fat|saturated fat|trans fat|cholesterol|sodium|total carbs|dietary fiber|sugars|protein)\b/i;
// Sections whose rows are not the regular plate size; their name becomes the serving.
const SIZED_SECTION = /lunch|lighter|kids|catering|take home|serves|gallon|pint|to go/i;

/** "12", "2.5", "less than 1 g" (counted as half the bound). */
function value(cell: string): number | undefined {
  const m = /^(less than )?(\d+(?:\.\d+)?)(?: ?m?g)?$/i.exec(cell.trim());
  if (!m) return undefined;
  return m[1] ? Number(m[2]) / 2 : Number(m[2]);
}

export function parseOliveGarden(text: string, sourceUrl: string, checkedAt: string): RawItem[] {
  const items: RawItem[] = [];
  let section = '';
  for (const line of text.split('\n')) {
    const cells = line.split('\t').map((c) => c.trim());
    if (cells.length === 1) {
      if (cells[0] && !/^\d/.test(cells[0]) && !HEADER.test(cells[0])) section = cells[0].replace(/:$/, '');
      continue;
    }
    if (cells.length !== COLUMNS + 1) continue;
    const [label, ...rest] = cells;
    const numbers = rest.map(value);
    // shortcut: "add ..." rows are add-ons to the row above; skipped because they are not dishes.
    if (!label || /^add /i.test(label) || numbers.some((n) => n === undefined)) continue;
    const paren = /^(.*?)\s*\(([^)]*)\)$/.exec(label);
    items.push({
      name: label,
      serving: paren?.[2] ?? (SIZED_SECTION.test(section) ? section : 'as served'),
      calories: numbers[0], fat_g: numbers[2], carbs_g: numbers[7], protein_g: numbers[10],
      source_url: sourceUrl, checked_at: checkedAt,
    });
  }
  return items;
}
