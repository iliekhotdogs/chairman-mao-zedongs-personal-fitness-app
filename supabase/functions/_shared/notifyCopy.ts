// Push notification copy and request checks for the notify function. Pure TypeScript
// (no Deno/npm imports) so Jest can test it (src/lib/__tests__/edgeShared.test.ts).
//
// Push text is built here from fixed templates, never from client-sent title/body:
//   - a client could otherwise push arbitrary text to every device registered to its
//     account (including a device whose token it registered), and
//   - push payloads travel through Expo and FCM/APNs, so they must not carry health
//     data (weights, calories, pain areas). The app shows the detailed text locally.

export type NotifyCategory = 'nutrition' | 'workouts' | 'checkins';

export const PUSH_COPY: Record<NotifyCategory, { title: string; body: string }> = {
  nutrition: { title: 'FitCoach', body: 'You have a new nutrition suggestion. Open FitCoach to review it.' },
  workouts: { title: 'FitCoach', body: 'You have a new workout suggestion. Open FitCoach to review it.' },
  checkins: { title: 'FitCoach', body: 'You have a new coaching update. Open FitCoach to see it.' },
};

/** The category the app sent (`category` or `kind`), or the generic check-in copy. */
export function notifyCategory(body: Record<string, unknown>): NotifyCategory {
  const raw = typeof body.category === 'string' ? body.category : typeof body.kind === 'string' ? body.kind : '';
  return raw === 'nutrition' || raw === 'workouts' || raw === 'checkins' ? raw : 'checkins';
}

/** Fixed push text for a request; ignores any free-form title/body it carries. */
export function pushCopy(body: Record<string, unknown>): { category: NotifyCategory; title: string; body: string } {
  const category = notifyCategory(body);
  return { category, ...PUSH_COPY[category] };
}

const DAY_MS = 86_400_000;

/** True when `value` is a real YYYY-MM-DD date within one day of `now` (UTC). Every
 * time zone's local date is within that window, so honest clients always pass, while a
 * client cannot claim slots on arbitrary dates to get more than 3 pushes a day. */
export function isPlausibleLocalDate(value: unknown, now: Date): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return false;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.abs(parsed - today) <= DAY_MS;
}
