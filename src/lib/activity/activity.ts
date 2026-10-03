import type { ActivityRecord, ISODate } from '../types';
import { addDays, lastNDates, nowISO, toISODate } from '../dates';
import { newId } from '../id';

/**
 * Merge incoming activity records with what we already have.
 *  - Same upstream externalId → update in place (re-syncs don't duplicate).
 *  - Several apps reporting the same day (e.g. phone + watch both writing steps to
 *    Health Connect) are kept as separate records but only ONE is counted per day; see
 *    `dailyActivity`, which prefers manual entries, then the highest-step device.
 */
export function mergeActivity(existing: ActivityRecord[], incoming: ActivityRecord[]): { records: ActivityRecord[]; added: number; updated: number; duplicates: number } {
  const byKey = new Map(existing.map((r) => [keyOf(r), r]));
  let added = 0;
  let updated = 0;
  let duplicates = 0;
  for (const r of incoming) {
    const k = keyOf(r);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, r);
      added++;
    } else if (prev.steps !== r.steps || prev.activeKcal !== r.activeKcal || prev.exerciseMinutes !== r.exerciseMinutes) {
      byKey.set(k, { ...r, id: prev.id });
      updated++;
    } else duplicates++;
  }
  return { records: [...byKey.values()], added, updated, duplicates };
}

function keyOf(r: ActivityRecord): string {
  return r.externalId ? `${r.source}:${r.externalId}` : `${r.source}:${r.origin}:${r.date}`;
}

export interface DailyActivity {
  date: ISODate;
  steps?: number;
  activeKcal?: number;
  exerciseMinutes?: number;
  chosen?: ActivityRecord;
  otherSources: ActivityRecord[];
  missing: boolean;
}

/** One value per day, avoiding double counting across sources. */
export function dailyActivity(records: ActivityRecord[], date: ISODate): DailyActivity {
  const day = records.filter((r) => r.date === date && !r.deleted);
  if (!day.length) return { date, otherSources: [], missing: true };
  const manual = day.find((r) => r.source === 'manual');
  const chosen = manual ?? [...day].sort((a, b) => (b.steps ?? 0) - (a.steps ?? 0))[0];
  return {
    date,
    steps: chosen.steps,
    activeKcal: chosen.activeKcal,
    exerciseMinutes: chosen.exerciseMinutes,
    chosen,
    otherSources: day.filter((r) => r !== chosen),
    missing: false,
  };
}

export function activityHistory(records: ActivityRecord[], days: number, end = toISODate()): DailyActivity[] {
  return lastNDates(days, end).map((d) => dailyActivity(records, d));
}

/**
 * SIMULATED Health Connect data for the design prototype and browser testing.
 * Produces a phone and a watch source for some days so de-duplication is visible,
 * leaves one gap day to show missing data, and makes today an unusually active day.
 */
export function simulatedHealthConnectPull(today = toISODate(), days = 14): ActivityRecord[] {
  const out: ActivityRecord[] = [];
  const syncedAt = nowISO();
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    if (i === 5) continue; // gap: watch not worn, phone left at home
    const seed = hash(date);
    const steps = i === 0 ? 14800 : 5200 + (seed % 5500);
    out.push({ id: newId(), date, source: 'simulated', origin: 'Pixel phone (simulated)', externalId: `phone-${date}`, steps: Math.round(steps * 0.92), activeKcal: Math.round(steps * 0.035), exerciseMinutes: Math.round(steps / 400), syncedAt, updatedAt: syncedAt });
    if (seed % 3 !== 0 || i === 0) {
      out.push({ id: newId(), date, source: 'simulated', origin: 'Galaxy Watch (simulated)', externalId: `watch-${date}`, steps, activeKcal: Math.round(steps * 0.04), exerciseMinutes: Math.round(steps / 350), syncedAt, updatedAt: syncedAt });
    }
  }
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
