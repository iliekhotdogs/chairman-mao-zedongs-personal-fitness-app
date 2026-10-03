import type { AppState } from './state';
import type { FoodEntry, ISODate, MacroTargets, WorkoutDay } from './types';
import { sumItems } from './nutrition/lookup';
import { targetsForDay } from './nutrition/targets';
import { dayForWeekday } from './workouts/generator';
import { weekday, lastNDates } from './dates';
import { dailyActivity } from './activity/activity';

export const live = <T extends { deleted?: boolean }>(list: T[]) => list.filter((x) => !x.deleted);

export function foodForDay(state: AppState, date: ISODate): FoodEntry[] {
  return live(state.foodLog)
    .filter((e) => e.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function totalsForDay(state: AppState, date: ISODate) {
  return sumItems(foodForDay(state, date).flatMap((e) => e.items));
}

export function dayTargets(state: AppState, date: ISODate): (MacroTargets & { adjustment?: ReturnType<typeof targetsForDay>['adjustment'] }) | undefined {
  if (!state.targets) return undefined;
  return targetsForDay(state.targets, live(state.dayAdjustments), date);
}

export function remainingForDay(state: AppState, date: ISODate) {
  const t = dayTargets(state, date);
  if (!t) return undefined;
  const eaten = totalsForDay(state, date);
  return {
    target: t,
    eaten,
    remaining: {
      calories: Math.round(t.calories - eaten.calories),
      proteinG: Math.round(t.proteinG - eaten.proteinG),
      carbsG: Math.round(t.carbsG - eaten.carbsG),
      fatG: Math.round(t.fatG - eaten.fatG),
    },
  };
}

/** Today's workout: an approved override wins over the plan's scheduled day. */
export function workoutForDay(state: AppState, date: ISODate): { day?: WorkoutDay; overridden: boolean } {
  const ov = live(state.workoutOverrides).find((o) => o.date === date);
  if (ov) return { day: ov.day, overridden: true };
  return { day: dayForWeekday(state.plan, weekday(date)), overridden: false };
}

export function sessionForDay(state: AppState, date: ISODate) {
  return live(state.sessions).find((s) => s.date === date);
}

export function activeSession(state: AppState) {
  return state.activeSessionId ? live(state.sessions).find((s) => s.id === state.activeSessionId && !s.finishedAt) : undefined;
}

export function latestWeight(state: AppState) {
  return [...live(state.weights)].sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function pendingProposals(state: AppState) {
  return state.proposals.filter((p) => p.status === 'pending' && !p.deleted);
}

export function loggedDays(state: AppState, days: number, end: ISODate): number {
  const set = new Set(live(state.foodLog).map((e) => e.date));
  return lastNDates(days, end).filter((d) => set.has(d)).length;
}

export function activityForDay(state: AppState, date: ISODate) {
  return dailyActivity(state.activity, date);
}

export function visibleChat(state: AppState) {
  return live(state.chat);
}
