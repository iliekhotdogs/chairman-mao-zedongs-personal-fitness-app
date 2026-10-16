/** Pure user-facing wording helpers (error mapping, labels, page titles). */
import type { UnitSystem } from './types';
import { cmToFtIn } from './units';

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const NETWORK = /failed to fetch|fetch failed|\bload failed|network ?(request failed|error)|timeout|offline/i;
export const isNetworkError = (message?: string) => !!message && NETWORK.test(message);

export const OFFLINE_MESSAGE = "Can't reach the server. We'll retry.";

/** Sync errors as shown to users: network failures get one friendly line. */
export function friendlySyncError(message?: string): string | undefined {
  if (!message) return undefined;
  return isNetworkError(message) ? OFFLINE_MESSAGE : message;
}

/** Supabase auth errors in plain words. */
export function authErrorMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Check them, or reset your password.";
  // Supabase's wording when the build has a wrong or mistyped publishable key.
  if (/invalid api key/i.test(message)) return "Accounts are unavailable: this site's sign-in key is misconfigured. Check EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY and redeploy.";
  if (isNetworkError(message)) return "Can't reach the server. Check your connection and try again.";
  return message;
}

export function formatHeight(cm: number, units: UnitSystem): string {
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const { ft, inch } = cmToFtIn(cm);
  return `${ft} ft ${inch} in`;
}

export const SEX_LABEL = { female: 'female', male: 'male', unspecified: 'sex not stated' } as const;
export const ACTIVITY_LABEL = { mostly_sitting: 'mostly sitting', on_feet: 'on your feet', physical_job: 'physical work' } as const;

const TITLES: [string, string][] = [
  ['/food', 'Food'], ['/workouts', 'Train'], ['/coach', 'Coach'], ['/progress', 'Progress'], ['/activity', 'Activity'],
  ['/settings', 'Settings'], ['/states', 'UI states'], ['/onboarding', 'Get started'], ['/admin', 'Admin'],
  ['/reset-password', 'Reset password'], ['/welcome', 'Welcome'],
];

/** Browser tab title for a route; unknown paths are the 404 page. */
export function pageTitle(pathname: string): string {
  const label = pathname === '/' ? 'Today' : TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? 'Page not found';
  return `${label} · FitCoach`;
}
