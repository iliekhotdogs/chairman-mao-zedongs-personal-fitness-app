// Boston Pizza Canada: https://bostonpizza.com/en/nutritional-information.html
// One accordion card per dish (<h3>), one block per size (<h4>, often empty) with label/value <p> pairs.
import type { RawItem } from '../validate.ts';

const unescape = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function parseBostonPizza(html: string, sourceUrl: string, checkedAt: string): RawItem[] {
  const items: RawItem[] = [];
  for (const card of html.split(/<div class="nutrition-recipe-accordian--card">/).slice(1)) {
    const name = unescape(/card-header">([^<]*)</.exec(card)?.[1] ?? '');
    for (const block of card.split(/class="recipe-description--title"/).slice(1)) {
      const values = new Map([...block.matchAll(/<p>([^<]+)<\/p>\s*<p>([^<]*)<\/p>/g)].map((m) => [unescape(m[1]).toLowerCase(), parseFloat(m[2])]));
      items.push({
        name,
        serving: unescape(/<h4[^>]*>([^<]*)</.exec(block)?.[1] ?? '') || 'as served',
        calories: values.get('calories'), protein_g: values.get('protein'), carbs_g: values.get('carbohydrates'), fat_g: values.get('fat'),
        source_url: sourceUrl, checked_at: checkedAt,
      });
    }
  }
  return items;
}
