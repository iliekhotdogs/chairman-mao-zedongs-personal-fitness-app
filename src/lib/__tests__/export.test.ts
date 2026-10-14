import { csvExports, csvField, foodLogCsv, jsonExport, toCsv, weightsCsv } from '../export';
import { emptyState, type AppState } from '../state';
import type { FoodEntry } from '../types';

const NOW = '2026-10-02T12:00:00.000Z';

const entry = (id: string, date: string, name: string, over: Partial<FoodEntry> = {}): FoodEntry => ({
  id, date, meal: 'dinner', origin: 'manual', confirmedAt: NOW, createdAt: `${date}T18:00:00.000Z`, updatedAt: NOW,
  items: [{ name, portionLabel: '1 bowl', grams: 300, calories: 612.4, proteinG: 30.26, carbsG: 70, fatG: 20, source: { kind: 'database', sourced: true, label: 'USDA #1' } }],
  ...over,
});

function state(): AppState {
  return {
    ...emptyState('d', NOW),
    foodLog: [entry('f2', '2026-10-02', 'Chili, "homemade"'), entry('f1', '2026-10-01', 'Pasta'), entry('gone', '2026-10-01', 'Deleted', { deleted: true })],
    weights: [
      { id: 'w2', date: '2026-10-02', weightKg: 80.123, updatedAt: NOW },
      { id: 'w1', date: '2026-10-01', weightKg: 80.5, updatedAt: NOW },
      { id: 'w0', date: '2026-09-30', weightKg: 99, updatedAt: NOW, deleted: true },
    ],
  };
}

describe('CSV helpers', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(undefined)).toBe('');
    expect(csvField(-5)).toBe('-5');
  });

  it('defuses spreadsheet formulas', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('@cmd')).toBe("'@cmd");
  });

  it('uses CRLF line endings', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2\r\n');
  });
});

describe('food log CSV', () => {
  it('has one row per item, sorted by date, without deleted entries', () => {
    const lines = foodLogCsv(state()).trim().split('\r\n');
    expect(lines[0]).toBe('date,meal,food,portion,grams,calories,protein_g,carbs_g,fat_g,source,origin,entry_id');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('2026-10-01,dinner,Pasta,1 bowl,300,612,30.3,70,20,USDA #1,manual,f1');
    expect(lines[2]).toContain('"Chili, ""homemade"""');
  });
});

describe('weights CSV', () => {
  it('exports kg plus the display unit, sorted, without deleted entries', () => {
    const lines = weightsCsv(state(), 'imperial').trim().split('\r\n');
    expect(lines).toEqual(['date,weight_kg,weight_lb', '2026-10-01,80.5,177.5', '2026-10-02,80.12,176.6']);
  });

  it('omits the duplicate column for metric users', () => {
    expect(weightsCsv(state(), 'metric').split('\r\n')[0]).toBe('date,weight_kg');
  });
});

describe('export files', () => {
  it('JSON export wraps the full state with a dated filename', () => {
    const f = jsonExport(state(), NOW);
    expect(f.filename).toBe('fitcoach-export-2026-10-02.json');
    expect(f.mimeType).toBe('application/json');
    expect(JSON.parse(f.content)).toMatchObject({ app: 'FitCoach', exportedAt: NOW, data: { deviceId: 'd' } });
  });

  it('CSV export produces food log and weights files', () => {
    expect(csvExports(state(), NOW).map((f) => f.filename)).toEqual(['fitcoach-food-log-2026-10-02.csv', 'fitcoach-weights-2026-10-02.csv']);
  });
});
