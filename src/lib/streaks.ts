import type { AppState } from './state';
import type { ISODate, WorkoutDay, WorkoutSession } from './types';
import { addDays, parseISODate, toISODate, weekday } from './dates';
import { live, sessionForDay, workoutForDay } from './selectors';
import { e1rm } from './workouts/progression';
import { exerciseName } from './workouts/exercises';

type StreakSource = Pick<AppState, 'foodLog' | 'sessions'>;

/** Days with any food logged or a finished workout. */
export function activeDates(state: StreakSource): Set<ISODate> {
  const set = new Set<ISODate>();
  for (const e of live(state.foodLog)) set.add(e.date);
  for (const s of live(state.sessions)) if (s.finishedAt) set.add(s.date);
  return set;
}

export interface Streak {
  /** consecutive active days ending today, or ending yesterday if today has nothing yet */
  current: number;
  best: number;
  activeToday: boolean;
}

/** Pure streak maths over a set of active dates. */
export function computeStreak(dates: Iterable<ISODate>, today: ISODate): Streak {
  const set = new Set(dates);
  const activeToday = set.has(today);
  let current = 0;
  let d = activeToday ? today : addDays(today, -1);
  while (set.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  let prev: ISODate | undefined;
  for (const date of [...set].filter((x) => x <= today).sort()) {
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return { current, best: Math.max(best, current), activeToday };
}

export function streakForState(state: StreakSource, today: ISODate): Streak {
  return computeStreak(activeDates(state), today);
}

/** Monday of the week containing `date`. */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Finished workouts and lifted volume (kg × reps) from Monday through `today`. */
export function weekTraining(sessions: WorkoutSession[], today: ISODate): { workouts: number; volumeKg: number } {
  const start = weekStart(today);
  const done = live(sessions).filter((s) => s.finishedAt && s.date >= start && s.date <= today);
  return { workouts: done.length, volumeKg: Math.round(done.reduce((v, s) => v + s.sets.reduce((a, x) => a + x.weightKg * x.reps, 0), 0)) };
}

export interface NextWorkout {
  date: ISODate;
  day: WorkoutDay;
  /** true when the session is today and not finished yet */
  isToday: boolean;
  /** local midnight of `date` */
  startsAt: Date;
}

/** The next scheduled (or overridden) workout that is not finished yet, looking up to 7 days ahead. */
export function nextWorkout(state: AppState, today: ISODate): NextWorkout | undefined {
  for (let i = 0; i <= 7; i++) {
    const date = addDays(today, i);
    const { day } = workoutForDay(state, date);
    if (!day) continue;
    if (i === 0 && sessionForDay(state, date)?.finishedAt) continue;
    return { date, day, isToday: i === 0, startsAt: parseISODate(date) };
  }
  return undefined;
}

/** "2d 04:05:09" / "04:05:09" countdown text for a positive duration. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ---------- Milestones ----------

export type MilestoneKind = 'start' | 'meal' | 'workout' | 'streak' | 'count' | 'weight' | 'pr';

export interface Milestone {
  id: string;
  date: ISODate;
  kind: MilestoneKind;
  title: string;
  detail?: string;
}

const STREAK_STEPS = [3, 7, 14, 30, 60, 100, 365];
const COUNT_STEPS = [5, 10, 25, 50, 100, 250, 500];
const WEIGHT_STEP_KG = 2.5;
const MAX_PRS = 8;

/**
 * Notable moments derived from the log, newest first: first meal/workout, streak lengths reached,
 * workout counts, every 2.5 kg of weight change from the first weigh-in, and personal records
 * (best estimated 1RM per exercise beating every earlier session).
 */
export function milestones(state: Pick<AppState, 'foodLog' | 'sessions' | 'weights' | 'profile'>, opts: { today?: ISODate; formatWeight?: (kg: number) => string } = {}): Milestone[] {
  const today = opts.today ?? toISODate();
  const fmt = opts.formatWeight ?? ((kg: number) => `${Math.round(kg * 10) / 10} kg`);
  const out: Milestone[] = [];

  if (state.profile?.createdAt) out.push({ id: 'start', date: toISODate(new Date(state.profile.createdAt)), kind: 'start', title: 'Started FitCoach', detail: `Starting weight ${fmt(state.profile.startWeightKg)}` });

  const meals = live(state.foodLog).map((e) => e.date).sort();
  if (meals[0]) out.push({ id: 'first-meal', date: meals[0], kind: 'meal', title: 'First meal logged' });

  const sessions = live(state.sessions).filter((s) => s.finishedAt).sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt));
  if (sessions[0]) out.push({ id: 'first-workout', date: sessions[0].date, kind: 'workout', title: 'First workout', detail: sessions[0].name });
  sessions.forEach((s, i) => {
    if (COUNT_STEPS.includes(i + 1)) out.push({ id: `count-${i + 1}`, date: s.date, kind: 'count', title: `${i + 1} workouts done` });
  });

  // streak lengths, first time each was reached
  const days = [...activeDates(state)].filter((d) => d <= today).sort();
  let run = 0;
  let prev: ISODate | undefined;
  const reached = new Set<number>();
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    prev = d;
    for (const step of STREAK_STEPS) {
      if (run === step && !reached.has(step)) {
        reached.add(step);
        out.push({ id: `streak-${step}`, date: d, kind: 'streak', title: step === 7 ? 'First full week' : `${step}-day streak`, detail: `${step} days in a row of logging or training` });
      }
    }
  }

  // weight change steps from the first weigh-in
  const weights = live(state.weights).sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length) {
    const base = weights[0].weightKg;
    out.push({ id: 'first-weigh-in', date: weights[0].date, kind: 'weight', title: 'First weigh-in', detail: fmt(base) });
    let downSteps = 0;
    let upSteps = 0;
    for (const w of weights.slice(1)) {
      const delta = w.weightKg - base;
      const steps = Math.floor(Math.abs(delta) / WEIGHT_STEP_KG + 1e-9);
      if (delta < 0 && steps > downSteps) {
        downSteps = steps;
        out.push({ id: `weight-down-${steps}`, date: w.date, kind: 'weight', title: `Down ${fmt(steps * WEIGHT_STEP_KG)}`, detail: `Weighed in at ${fmt(w.weightKg)}` });
      } else if (delta > 0 && steps > upSteps) {
        upSteps = steps;
        out.push({ id: `weight-up-${steps}`, date: w.date, kind: 'weight', title: `Up ${fmt(steps * WEIGHT_STEP_KG)}`, detail: `Weighed in at ${fmt(w.weightKg)}` });
      }
    }
  }

  // personal records
  const best = new Map<string, number>();
  const prs: Milestone[] = [];
  for (const s of sessions) {
    const sessionBest = new Map<string, number>();
    for (const set of s.sets) {
      if (set.weightKg <= 0 || set.reps <= 0) continue;
      sessionBest.set(set.exerciseId, Math.max(sessionBest.get(set.exerciseId) ?? 0, e1rm(set.weightKg, set.reps)));
    }
    for (const [ex, v] of sessionBest) {
      const prior = best.get(ex);
      if (prior !== undefined && v > prior + 0.25) prs.push({ id: `pr-${s.id}-${ex}`, date: s.date, kind: 'pr', title: `PR · ${exerciseName(ex)}`, detail: `Estimated 1RM ${fmt(v)}` });
      if (prior === undefined || v > prior) best.set(ex, v);
    }
  }
  out.push(...prs.slice(-MAX_PRS));

  const order: Record<MilestoneKind, number> = { start: 0, meal: 1, workout: 2, weight: 3, pr: 4, count: 5, streak: 6 };
  return out.filter((m) => m.date <= today).sort((a, b) => b.date.localeCompare(a.date) || order[b.kind] - order[a.kind]);
}
