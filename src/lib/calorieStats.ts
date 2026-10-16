export const MIN_LOGGED_DAYS = 3;

interface DayRow { d: string; eaten: { calories: number; proteinG: number }; target: { calories: number } }

/** Averages over completed logged days (today excluded). Metrics stay null until MIN_LOGGED_DAYS days are logged. */
export function calorieStats(rows: DayRow[], today: string, min = MIN_LOGGED_DAYS) {
  const logged = rows.filter((r) => r.eaten.calories > 0 && r.d !== today);
  const count = logged.length;
  if (count < min) return { count, ready: false as const, avg: null, avgProtein: null, within: null };
  const mean = (f: (r: DayRow) => number) => Math.round(logged.reduce((s, r) => s + f(r), 0) / count);
  return {
    count,
    ready: true as const,
    avg: mean((r) => r.eaten.calories),
    avgProtein: mean((r) => r.eaten.proteinG),
    within: logged.filter((r) => Math.abs(r.eaten.calories - r.target.calories) <= r.target.calories * 0.1).length,
  };
}

/** "1 logged day" / "2 logged days" */
export const loggedDaysLabel = (n: number) => `${n} logged ${n === 1 ? 'day' : 'days'}`;
