import type { ISODate, NotificationPrefs, NotificationRecord } from '../types';
import { hhmmToMinutes } from '../dates';

/** Hard cap across ALL of a user's devices (records sync, and the server re-checks). */
export const MAX_COACH_NOTIFICATIONS_PER_DAY = 3;
/** Only meaningful messages are sent; low-priority items stay in the app. */
export const MIN_PRIORITY_TO_NOTIFY = 2;

export interface Candidate {
  category: keyof NotificationPrefs['categories'];
  title: string;
  body: string;
  dedupeKey: string;
  priority: number;
}

export type Decision = { send: true } | { send: false; reason: string };

export function inQuietHours(prefs: NotificationPrefs, minutesOfDay: number): boolean {
  const start = hhmmToMinutes(prefs.quietStart);
  const end = hhmmToMinutes(prefs.quietEnd);
  if (start === end) return false;
  return start < end ? minutesOfDay >= start && minutesOfDay < end : minutesOfDay >= start || minutesOfDay < end;
}

export function sentToday(records: NotificationRecord[], date: ISODate): NotificationRecord[] {
  return records.filter((r) => r.date === date && !r.deleted);
}

export function decide(c: Candidate, prefs: NotificationPrefs, records: NotificationRecord[], date: ISODate, minutesOfDay: number): Decision {
  if (!prefs.enabled) return { send: false, reason: 'Notifications are off.' };
  if (!prefs.categories[c.category]) return { send: false, reason: `${c.category} notifications are off.` };
  if (c.priority < MIN_PRIORITY_TO_NOTIFY) return { send: false, reason: 'Not important enough to interrupt you.' };
  if (inQuietHours(prefs, minutesOfDay)) return { send: false, reason: 'Quiet hours.' };
  const today = sentToday(records, date);
  if (today.length >= MAX_COACH_NOTIFICATIONS_PER_DAY) return { send: false, reason: `Daily limit of ${MAX_COACH_NOTIFICATIONS_PER_DAY} reached.` };
  if (today.some((r) => r.dedupeKey === c.dedupeKey)) return { send: false, reason: 'Already sent today.' };
  return { send: true };
}

export function remainingToday(records: NotificationRecord[], date: ISODate): number {
  return Math.max(0, MAX_COACH_NOTIFICATIONS_PER_DAY - sentToday(records, date).length);
}
