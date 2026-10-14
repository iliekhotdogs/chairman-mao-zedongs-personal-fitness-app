import type { AppState } from './state';
import type { UnitSystem } from './types';
import { live } from './selectors';
import { round, weightValue, weightUnit } from './units';

/** Pure builders for data exports. File saving lives in exportFile.ts. */

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

const day = (nowIso: string) => nowIso.slice(0, 10);

/** Quote a CSV field when needed (RFC 4180). Also defuses spreadsheet formula injection. */
export function csvField(v: unknown): string {
  if (v === undefined || v === null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** One row per food item, so per-item macros and sources are kept. Deleted entries are skipped. */
export function foodLogCsv(state: AppState): string {
  const rows = live(state.foodLog)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .flatMap((e) =>
      e.items.map((i) => [e.date, e.meal, i.name, i.portionLabel, i.grams ?? '', round(i.calories), round(i.proteinG, 1), round(i.carbsG, 1), round(i.fatG, 1), i.source?.label ?? '', e.origin, e.id]),
    );
  return toCsv(['date', 'meal', 'food', 'portion', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'source', 'origin', 'entry_id'], rows);
}

/** Body weights in kg plus the user's display unit. */
export function weightsCsv(state: AppState, units: UnitSystem = state.settings.units): string {
  const unit = weightUnit(units);
  const rows = live(state.weights)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => [w.date, round(w.weightKg, 2), ...(unit === 'kg' ? [] : [weightValue(w.weightKg, units)])]);
  return toCsv(['date', 'weight_kg', ...(unit === 'kg' ? [] : [`weight_${unit}`])], rows);
}

export function jsonExport(state: AppState, nowIso: string): ExportFile {
  return {
    filename: `fitcoach-export-${day(nowIso)}.json`,
    mimeType: 'application/json',
    content: JSON.stringify({ exportedAt: nowIso, app: 'FitCoach', data: state }, null, 2),
  };
}

export function csvExports(state: AppState, nowIso: string): ExportFile[] {
  return [
    { filename: `fitcoach-food-log-${day(nowIso)}.csv`, mimeType: 'text/csv', content: foodLogCsv(state) },
    { filename: `fitcoach-weights-${day(nowIso)}.csv`, mimeType: 'text/csv', content: weightsCsv(state) },
  ];
}
