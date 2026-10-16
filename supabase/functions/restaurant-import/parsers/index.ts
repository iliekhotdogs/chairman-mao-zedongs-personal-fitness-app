// restaurant_sources.parser -> parser. `pdf` sources are converted to text with pdfText() first.
import type { RawItem } from '../validate.ts';
import { parseBostonPizza } from './bostonPizza.ts';
import { parseOliveGarden } from './oliveGarden.ts';

export const PARSERS: Record<string, { format: 'html' | 'pdf'; parse: (text: string, sourceUrl: string, checkedAt: string) => RawItem[] }> = {
  boston_pizza_ca: { format: 'html', parse: parseBostonPizza },
  olive_garden_ca: { format: 'pdf', parse: parseOliveGarden },
};
