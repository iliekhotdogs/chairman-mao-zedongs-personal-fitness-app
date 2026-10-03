import type { UnitSystem } from '../types';
import { findExercise } from './exercises';
import { toKg } from '../units';

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Speech recognisers often mishear these as words
const HOMOPHONES: Record<string, string> = { for: 'for', to: 'to', too: 'two', won: 'one', ate: 'eight', fiver: 'five' };

const isNumWord = (w: string) => w in ONES || w in TENS || w === 'hundred';

function runToNumber(words: string[]): number[] {
  if (words.includes('hundred')) {
    let total = 0;
    let current = 0;
    for (const w of words) {
      if (w === 'hundred') {
        current = (current || 1) * 100;
        total += current;
        current = 0;
      } else current += ONES[w] ?? TENS[w] ?? 0;
    }
    return [total + current];
  }
  // group into "tens [ones]" or single ones/teens
  const groups: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in TENS) {
      const next = words[i + 1];
      if (next && next in ONES && ONES[next] < 10 && ONES[next] > 0) {
        groups.push(TENS[w] + ONES[next]);
        i++;
      } else groups.push(TENS[w]);
    } else groups.push(ONES[w]);
  }
  // "one thirty five" → 135, "two twenty five" → 225, "two oh five" → 205
  if (groups.length === 2 && groups[0] > 0 && groups[0] < 10 && groups[1] >= 10) return [groups[0] * 100 + groups[1]];
  if (groups.length === 3 && groups[0] > 0 && groups[0] < 10 && groups[1] === 0 && groups[2] < 10) return [groups[0] * 100 + groups[2]];
  return groups;
}

/** Convert spoken number words to digits: "one thirty five pounds eight reps" → "135 pounds 8 reps". */
export function wordsToDigits(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t in HOMOPHONES && !['for', 'to'].includes(t) ? HOMOPHONES[t] : t));
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (isNumWord(tokens[i])) {
      const run: string[] = [];
      while (i < tokens.length && (isNumWord(tokens[i]) || (tokens[i] === 'and' && run.includes('hundred') && isNumWord(tokens[i + 1] ?? '')))) {
        if (tokens[i] !== 'and') run.push(tokens[i]);
        i++;
      }
      i--;
      out.push(...runToNumber(run).map(String));
    } else out.push(tokens[i]);
  }
  return out.join(' ');
}

export interface ParsedSet {
  raw: string;
  exerciseId?: string;
  exerciseFromContext: boolean;
  weight?: number; // in `unit`
  unit?: 'lb' | 'kg';
  weightKg?: number;
  reps?: number;
  sets: number;
  repeatLast: boolean;
  issues: string[];
}

/**
 * Parse a spoken or typed set like "bench press, 135 pounds, eight reps",
 * "squat 225 for 5", "3 sets of 8 at 60 kilos", or "same again".
 * Never saves anything — the UI shows the result for review first.
 */
export function parseSetUtterance(input: string, ctx: { units: UnitSystem; currentExerciseId?: string }): ParsedSet {
  const text = wordsToDigits(input);
  const issues: string[] = [];
  const result: ParsedSet = { raw: input, exerciseFromContext: false, sets: 1, repeatLast: false, issues };

  if (/\b(same again|same as last|repeat( that| last)?|another (one|set))\b/.test(text)) {
    result.repeatLast = true;
    result.exerciseId = ctx.currentExerciseId;
    result.exerciseFromContext = true;
    return result;
  }

  const ex = findExercise(text);
  if (ex) result.exerciseId = ex.id;
  else if (ctx.currentExerciseId) {
    result.exerciseId = ctx.currentExerciseId;
    result.exerciseFromContext = true;
  } else issues.push('Exercise not recognised — choose it below.');

  let rest = text;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  const setsM = take(/\b(\d+)\s*sets?\b(\s*of)?/);
  if (setsM) result.sets = Math.min(10, parseInt(setsM[1], 10));

  const wM = take(/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kilos?|kilograms?|kgs?)\b/);
  if (wM) {
    result.weight = parseFloat(wM[1]);
    result.unit = /^(pound|lb)/.test(wM[2]) ? 'lb' : 'kg';
  }
  if (/\bbody ?weight\b/.test(rest)) {
    result.weight = 0;
    result.unit = ctx.units === 'imperial' ? 'lb' : 'kg';
  }

  const rM = take(/\b(\d+)\s*(reps?|repetitions?|times)\b/) ?? take(/\b(?:for|by|x|times)\s*(\d+)\b/);
  if (rM) result.reps = parseInt(rM[1], 10);

  const xM = !wM && !rM ? take(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+)\b/) : null;
  if (xM) {
    result.weight = parseFloat(xM[1]);
    result.reps = parseInt(xM[2], 10);
  }

  // Remaining bare numbers: large → weight, small → reps
  const bare = (rest.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number);
  for (const n of bare) {
    if (result.weight === undefined && n >= 15) result.weight = n;
    else if (result.reps === undefined && n > 0 && n <= 50 && Number.isInteger(n)) result.reps = n;
  }

  if (result.weight !== undefined && !result.unit) {
    result.unit = ctx.units === 'imperial' ? 'lb' : 'kg';
    if (result.weight > 0) issues.push(`No unit heard — assumed ${result.unit}.`);
  }
  if (result.weight !== undefined && result.unit) result.weightKg = toKg(result.weight, result.unit === 'lb' ? 'imperial' : 'metric');
  if (result.weight === undefined) issues.push('Weight not heard.');
  if (result.reps === undefined) issues.push('Reps not heard.');
  if (result.reps !== undefined && result.reps > 50) issues.push('That rep count looks unusually high — please check.');
  if (result.weight !== undefined && result.weight > 1000) issues.push('That weight looks unusually high — please check.');
  return result;
}
