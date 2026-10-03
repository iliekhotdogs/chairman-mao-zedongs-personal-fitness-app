import type { AppState } from '../state';
import type { Insight, ISODate, Proposal, WorkoutSession } from '../types';
import { addDays, daysBetween, lastNDates, nowISO, weekday } from '../dates';
import { newId } from '../id';
import { macrosFor, roundTo } from '../nutrition/targets';
import { live, loggedDays, totalsForDay, dayTargets } from '../selectors';
import { dailyActivity } from '../activity/activity';
import { dayForWeekday } from '../workouts/generator';
import { recommendNext } from '../workouts/progression';
import { exerciseName } from '../workouts/exercises';
import { displayWeight } from '../units';

/** kcal per step above baseline for a typical adult (deliberately conservative). */
export const KCAL_PER_STEP = 0.04;
/** Wearable calorie estimates are often high; only half of the extra is offered back. */
export const WEARABLE_DISCOUNT = 0.5;
export const MAX_ACTIVITY_BONUS = 400;

export interface EngineOutput {
  proposals: Proposal[];
  insights: Insight[];
}

function proposal(p: Omit<Proposal, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Proposal {
  const now = nowISO();
  return { ...p, id: newId(), status: 'pending', createdAt: now, updatedAt: now };
}

function insight(i: Omit<Insight, 'id' | 'createdAt'>): Insight {
  return { ...i, id: newId(), createdAt: nowISO() };
}

/**
 * Activity day bonus. The baseline target already assumes `baselineSteps` per day and the
 * planned training sessions, so only activity ABOVE that is considered, and only half of
 * the wearable estimate is offered. Logged gym sessions are never added (already counted).
 */
export function activityBonus(state: AppState, date: ISODate): { proposal?: Proposal; detail?: string } {
  const t = state.targets;
  if (!t) return {};
  const day = dailyActivity(state.activity, date);
  if (day.missing || day.steps === undefined) return {};
  const extraSteps = day.steps - t.baselineSteps;
  if (extraSteps < 3000) return {};
  const extraKcal = extraSteps * KCAL_PER_STEP;
  const bonus = Math.min(MAX_ACTIVITY_BONUS, roundTo(extraKcal * WEARABLE_DISCOUNT, 50));
  if (bonus < 100) return {};
  const fatLoss = state.profile?.goal === 'fat_loss';
  return {
    proposal: proposal({
      kind: 'day_calorie_adjustment',
      scope: 'today',
      title: `Add ${bonus} kcal today for extra activity`,
      summary: `You're at ${day.steps.toLocaleString()} steps — about ${extraSteps.toLocaleString()} more than your target already assumes.`,
      rationale: [
        `Your daily target already includes ~${t.baselineSteps.toLocaleString()} steps and your planned workouts, so those aren't counted again.`,
        `${extraSteps.toLocaleString()} extra steps ≈ ${Math.round(extraKcal)} kcal. Wearable estimates often run high, so only half (${bonus} kcal) is suggested.`,
        'Mostly as carbohydrate, to help recovery. This applies to today only; your ongoing target stays the same.',
        ...(fatLoss ? ['Optional on a fat-loss goal: skipping it is fine if you are not hungry.'] : []),
        ...(day.otherSources.length ? [`Several devices reported activity; counted only ${day.chosen?.origin} to avoid double counting.`] : []),
      ],
      change: { type: 'day_calorie_adjustment', date, calorieDelta: bonus, carbsDeltaG: Math.round(bonus / 4) },
      expiresOn: date,
      dedupeKey: `activity-bonus-${date}`,
      origin: 'adaptive_engine',
    }),
  };
}

/** Least-squares slope of weight (kg) per day. */
export function weightSlopePerDay(points: { date: ISODate; weightKg: number }[]): number {
  if (points.length < 2) return 0;
  const x0 = points[0].date;
  const xs = points.map((p) => daysBetween(x0, p.date));
  const ys = points.map((p) => p.weightKg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const RATE_BANDS = {
  // % body weight per week considered on-track
  fat_loss: { min: -1.0, max: -0.25, low: 150, high: 150 },
  muscle_gain: { min: 0.1, max: 0.5, low: 150, high: 100 },
  strength: { min: -0.25, max: 0.5, low: 150, high: 100 },
  maintenance: { min: -0.35, max: 0.35, low: 100, high: 100 },
} as const;

/** Ongoing target change from the 3-week body-weight trend (only with good logging data). */
export function trendAdjustment(state: AppState, today: ISODate): { proposal?: Proposal; insight?: Insight } {
  const { profile, targets } = state;
  if (!profile || !targets) return {};
  const since = addDays(today, -21);
  const pts = live(state.weights)
    .filter((w) => w.date > since && w.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 6 || daysBetween(pts[0].date, pts[pts.length - 1].date) < 14) return {};

  // Don't change targets more than once every two weeks.
  const recent = state.proposals.find((p) => (p.kind === 'target_change' || p.kind === 'goal_change') && (p.status === 'pending' || (p.status === 'accepted' && p.decidedAt && daysBetween(p.decidedAt.slice(0, 10), today) < 14)));
  if (recent) return {};

  const slope = weightSlopePerDay(pts);
  const latest = pts[pts.length - 1].weightKg;
  const ratePct = ((slope * 7) / latest) * 100;
  const band = RATE_BANDS[profile.goal];
  const logged = loggedDays(state, 14, today);
  const loggedDates = lastNDates(14, today).filter((d) => totalsForDay(state, d).calories > 0);
  const avgIntake = loggedDates.length ? Math.round(loggedDates.reduce((s, d) => s + totalsForDay(state, d).calories, 0) / loggedDates.length) : 0;
  const rateLabel = `${slope * 7 >= 0 ? '+' : ''}${displayWeight(slope * 7, state.settings.units)}/week (${ratePct >= 0 ? '+' : ''}${ratePct.toFixed(2)}% of body weight)`;

  let delta = 0;
  if (ratePct > band.max) delta = -band.high;
  else if (ratePct < band.min) delta = band.low;
  if (!delta) return {};

  if (logged < 10) {
    return {
      insight: insight({
        dedupeKey: `trend-needs-logging-${today}`,
        title: 'Your weight trend is off target, but logging is patchy',
        body: `Trend: ${rateLabel}. You logged food on ${logged} of the last 14 days, so it's unclear whether the target or the tracking needs to change. Log consistently for a week and the coach will suggest a precise adjustment.`,
        priority: 2,
      }),
    };
  }
  if (avgIntake && Math.abs(avgIntake - targets.calories) / targets.calories > 0.12) {
    return {
      insight: insight({
        dedupeKey: `trend-adherence-${today}`,
        title: 'Intake is different from your target',
        body: `Trend: ${rateLabel}. You've averaged ${avgIntake.toLocaleString()} kcal vs a ${targets.calories.toLocaleString()} kcal target. Before changing the target, try matching it more closely for a week.`,
        priority: 2,
      }),
    };
  }

  const nextCalories = targets.calories + delta;
  const next = macrosFor(nextCalories, latest, profile.goal);
  const goalText = profile.goal.replace('_', ' ');
  const expected = `${band.min}% to ${band.max}% per week`;
  return {
    proposal: proposal({
      kind: 'target_change',
      scope: 'ongoing',
      title: `${delta > 0 ? 'Raise' : 'Lower'} daily calories by ${Math.abs(delta)}`,
      summary: `${targets.calories.toLocaleString()} → ${nextCalories.toLocaleString()} kcal/day, based on 3 weeks of weigh-ins.`,
      rationale: [
        `Weight trend over ${pts.length} weigh-ins: ${rateLabel}. For ${goalText}, the target range is ${expected}.`,
        `You logged food on ${logged} of 14 days and averaged ${avgIntake.toLocaleString()} kcal, so the data is reliable enough to adjust.`,
        `A small ${Math.abs(delta)} kcal step avoids over-correcting; the coach will re-check in 2 weeks.`,
        `New macros: ${next.proteinG} g protein, ${next.carbsG} g carbs, ${next.fatG} g fat.`,
      ],
      change: { type: 'target_change', next },
      dedupeKey: `trend-${today}`,
      origin: 'adaptive_engine',
    }),
  };
}

export function proteinInsight(state: AppState, today: ISODate): Insight | undefined {
  if (!state.targets) return undefined;
  const days = lastNDates(7, addDays(today, -1)).filter((d) => totalsForDay(state, d).calories > 0);
  if (days.length < 4) return undefined;
  const low = days.filter((d) => totalsForDay(state, d).proteinG < state.targets!.proteinG * 0.8);
  if (low.length < Math.ceil(days.length * 0.6)) return undefined;
  const veg = state.profile?.dietPreferences.some((p) => ['vegetarian', 'vegan'].includes(p));
  return insight({
    dedupeKey: `protein-low-${today}`,
    title: 'Protein has been running low',
    body: `On ${low.length} of your last ${days.length} logged days you were under 80% of your ${state.targets.proteinG} g protein goal. Easy additions: ${veg ? 'Greek yogurt, tofu, lentils, or a protein shake' : 'Greek yogurt, chicken, tuna, eggs, or a protein shake'}.`,
    priority: 2,
  });
}

export function loggingInsight(state: AppState, today: ISODate): Insight | undefined {
  if (!state.profile) return undefined;
  const age = daysBetween(state.profile.createdAt.slice(0, 10), today);
  if (age < 4) return undefined;
  const n = loggedDays(state, 7, today);
  if (n >= 3) return undefined;
  return insight({
    dedupeKey: `logging-low-${today}`,
    title: 'Snap a photo of your next meal',
    body: `You've logged food on ${n} of the last 7 days. The coach can only fine-tune your targets with a few days of data. A photo and a few words is enough.`,
    priority: 1,
  });
}

export function eveningInsight(state: AppState, today: ISODate, hour: number): Insight | undefined {
  const t = dayTargets(state, today);
  if (!t || hour < 18) return undefined;
  const eaten = totalsForDay(state, today);
  if (eaten.calories === 0) return undefined;
  const left = t.calories - eaten.calories;
  const protLeft = t.proteinG - eaten.proteinG;
  if (left < 700 || protLeft < 40) return undefined;
  return insight({
    dedupeKey: `evening-${today}`,
    title: `${Math.round(left)} kcal and ${Math.round(protLeft)} g protein left today`,
    body: 'A protein-forward dinner would close most of the gap. Under-eating repeatedly can slow training progress.',
    priority: 2,
  });
}

export function missedWorkoutInsight(state: AppState, today: ISODate): Insight | undefined {
  if (!state.plan) return undefined;
  const past = lastNDates(7, addDays(today, -1));
  const planned = past.filter((d) => dayForWeekday(state.plan, weekday(d)));
  if (planned.length < 2) return undefined;
  const done = new Set(live(state.sessions).filter((s) => s.finishedAt).map((s) => s.date));
  const missed = planned.filter((d) => !done.has(d));
  if (missed.length < 2) return undefined;
  return insight({
    dedupeKey: `missed-${today}`,
    title: `${missed.length} planned workouts missed this week`,
    body: 'That happens. If your schedule has changed, ask the coach for a plan with fewer or shorter sessions. Consistency beats a perfect plan.',
    priority: 2,
  });
}

/** After a finished session, propose updating the saved plan's target weights. */
export function progressionProposal(state: AppState, session: WorkoutSession): Proposal | undefined {
  const plan = state.plan;
  if (!plan || session.planId !== plan.id || !session.dayId) return undefined;
  const day = plan.days.find((d) => d.id === session.dayId);
  if (!day) return undefined;
  const sessions = live(state.sessions);
  const updates: { dayId: string; exerciseId: string; targetWeightKg: number; repMin?: number; repMax?: number }[] = [];
  const lines: string[] = [];
  for (const pe of day.exercises) {
    if (!session.sets.some((s) => s.exerciseId === pe.exerciseId)) continue;
    const rec = recommendNext(pe, sessions, state.settings.units);
    if (rec.weightKg === undefined) continue;
    const changed = pe.targetWeightKg === undefined || Math.abs(rec.weightKg - pe.targetWeightKg) > 0.01 || rec.repMin !== pe.repMin;
    if (!changed) continue;
    updates.push({ dayId: day.id, exerciseId: pe.exerciseId, targetWeightKg: rec.weightKg, repMin: rec.repMin, repMax: rec.repMax });
    const from = pe.targetWeightKg !== undefined ? displayWeight(pe.targetWeightKg, state.settings.units) : 'not set';
    lines.push(`${exerciseName(pe.exerciseId)}: ${from} → ${displayWeight(rec.weightKg, state.settings.units)} (${rec.repMin}–${rec.repMax} reps). ${rec.reason}`);
  }
  if (!updates.length) return undefined;
  return proposal({
    kind: 'plan_weight_update',
    scope: 'ongoing',
    title: `Update next ${day.name} targets`,
    summary: `${updates.length} exercise${updates.length > 1 ? 's' : ''} based on today's session.`,
    rationale: lines,
    change: { type: 'plan_weight_update', planId: plan.id, updates },
    dedupeKey: `progression-${session.id}`,
    origin: 'progression',
  });
}

/** Run every rule. Safe to call often: dedupe keys prevent repeats. */
export function runEngine(state: AppState, today: ISODate, hour: number): EngineOutput {
  const proposals: Proposal[] = [];
  const insights: Insight[] = [];
  const a = activityBonus(state, today);
  if (a.proposal) proposals.push(a.proposal);
  const tr = trendAdjustment(state, today);
  if (tr.proposal) proposals.push(tr.proposal);
  if (tr.insight) insights.push(tr.insight);
  for (const i of [proteinInsight(state, today), eveningInsight(state, today, hour), missedWorkoutInsight(state, today), loggingInsight(state, today)]) {
    if (i) insights.push(i);
  }
  const dismissed = new Set(state.dismissedInsights);
  const decidedKeys = new Set(state.proposals.map((p) => p.dedupeKey));
  return {
    proposals: proposals.filter((p) => !decidedKeys.has(p.dedupeKey)),
    insights: insights.filter((i) => !dismissed.has(i.dedupeKey)).sort((x, y) => y.priority - x.priority),
  };
}
