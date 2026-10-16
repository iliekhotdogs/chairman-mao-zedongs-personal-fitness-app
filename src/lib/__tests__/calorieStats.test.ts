import { calorieStats, loggedDaysLabel } from '../calorieStats';

const row = (d: string, calories: number) => ({ d, eaten: { calories, proteinG: 100 }, target: { calories: 2000 } });
const T = '2026-01-10';

describe('calorieStats', () => {
  it('hides metrics below 3 completed logged days', () => {
    for (const n of [0, 1, 2]) {
      const s = calorieStats(Array.from({ length: n }, (_, i) => row(`2026-01-0${i + 1}`, 2000)), T);
      expect(s.ready).toBe(false);
      expect(s.count).toBe(n);
      expect(s.avg).toBeNull();
      expect(s.within).toBeNull();
    }
  });
  it('shows metrics at 3 days', () => {
    const s = calorieStats([row('2026-01-01', 2000), row('2026-01-02', 1800), row('2026-01-03', 3000)], T);
    expect(s).toMatchObject({ ready: true, count: 3, avg: 2267, avgProtein: 100, within: 2 });
  });
  it('excludes today and unlogged days', () => {
    const s = calorieStats([row('2026-01-01', 2000), row('2026-01-02', 2000), row(T, 2000), row('2026-01-03', 0)], T);
    expect(s.ready).toBe(false);
    expect(s.count).toBe(2);
  });
  it('pluralises', () => {
    expect(loggedDaysLabel(1)).toBe('1 logged day');
    expect(loggedDaysLabel(2)).toBe('2 logged days');
  });
});
