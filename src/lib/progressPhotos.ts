import { daysBetween, parseISODate, toISODate } from './dates';
import type { ProgressPhoto } from './types';

/** Live photos, oldest first (by date, then creation), the order the gallery slides in. */
export function galleryOrder(photos: ProgressPhoto[]): ProgressPhoto[] {
  return photos
    .filter((p) => !p.deleted)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt));
}

/**
 * Default side-by-side comparison: the first photo against the latest, or against
 * `withId` when the user picked one. Undefined with fewer than two photos.
 */
export function comparePair(ordered: ProgressPhoto[], withId?: string): [ProgressPhoto, ProgressPhoto] | undefined {
  if (ordered.length < 2) return undefined;
  const first = ordered[0];
  const other = (withId && withId !== first.id ? ordered.find((p) => p.id === withId) : undefined) ?? ordered[ordered.length - 1];
  return [first, other];
}

/** Days and body-weight change between two photos (weight only when both carry one). */
export function compareSummary(before: ProgressPhoto, after: ProgressPhoto): { days: number; weightDeltaKg?: number } {
  const days = daysBetween(before.date, after.date);
  const weightDeltaKg = before.weightKg !== undefined && after.weightKg !== undefined ? after.weightKg - before.weightKg : undefined;
  return { days, weightDeltaKg };
}

/** Validate a typed photo date: a real calendar day, not in the future. */
export function photoDateError(date: string, today: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Use the format YYYY-MM-DD.';
  const d = parseISODate(date);
  if (Number.isNaN(d.getTime()) || toISODate(d) !== date) return 'That date does not exist.';
  if (date > today) return 'Progress photos can’t be dated in the future.';
  return undefined;
}
