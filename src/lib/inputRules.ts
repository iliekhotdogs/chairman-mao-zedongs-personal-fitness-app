/** Shared numeric-input and set-entry rules (pure; used by NumberField and the session screen). */

export const MAX_SET_WEIGHT_KG = 700;
export const MAX_REPS = 300;

export interface Bounds {
  min?: number;
  max?: number;
  /** value must be strictly greater than min */
  exclusiveMin?: boolean;
}

/** Parse typed text without stripping: junk, '-' and repeated dots are errors. */
export function parseNumberText(text: string): { value?: number; error?: string } {
  const t = text.trim().replace(/^(\d*),(\d+)$/, '$1.$2');
  if (t === '') return { value: undefined };
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return { error: 'Enter digits only, with at most one decimal point.' };
  return { value: parseFloat(t) };
}

export function rangeMessage(n: number, { min, max, exclusiveMin }: Bounds): string | undefined {
  const lo = min !== undefined && (exclusiveMin ? n <= min : n < min);
  const hi = max !== undefined && n > max;
  if (!lo && !hi) return undefined;
  if (min !== undefined && max !== undefined && !exclusiveMin) return `Enter a number between ${min} and ${max}.`;
  if (lo) return exclusiveMin ? `Enter a number above ${min}.` : `Enter a number of ${min} or more.`;
  return `Enter a number of ${max} or less.`;
}

/** Block values the reducer would reject (or that are obviously typos). */
export function checkSet({ weightKg, reps }: { weightKg: number; reps: number }): string | undefined {
  if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > MAX_SET_WEIGHT_KG) return 'That weight looks out of range. Check the number and unit.';
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) return `Reps must be a whole number from 1 to ${MAX_REPS}.`;
  return undefined;
}

export function jumpWarning(weightKg: number, lastTopKg: number | undefined): string | undefined {
  if (!lastTopKg || lastTopKg <= 0 || weightKg <= lastTopKg * 1.5) return undefined;
  return 'That is more than 50% above your last session. Check the weight, then tap Log set again to confirm.';
}

/** Reps prefill: last logged set, else the plan's minimum (matches the "fell short of N reps" copy). */
export function prefillReps({ lastReps, repMin }: { lastReps?: number; repMin?: number; repMax?: number }): number {
  return lastReps ?? repMin ?? 8;
}
