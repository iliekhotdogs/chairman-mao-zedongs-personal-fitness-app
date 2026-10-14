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
