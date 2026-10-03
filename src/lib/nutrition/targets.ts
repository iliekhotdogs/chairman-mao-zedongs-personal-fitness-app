import type { DailyActivity, DayAdjustment, GoalPriority, MacroTargets, NutritionTargets, Profile, ISODate } from '../types';
import { nowISO } from '../dates';

/**
 * Initial calorie + macro targets.
 *
 * - BMR: Mifflin–St Jeor (the most validated simple equation for adults).
 * - Maintenance: BMR × a non-exercise activity factor, plus the average daily cost of the
 *   planned training schedule. Because planned training is *already included* here, the
 *   adaptive engine only reacts to activity *above* this baseline (no double counting).
 * - Goal adjustment: a moderate deficit/surplus, which is then corrected over time from
 *   the user's real body-weight trend (estimates are never treated as exact).
 */

const NEAT_FACTOR: Record<DailyActivity, number> = {
  mostly_sitting: 1.2,
  on_feet: 1.375,
  physical_job: 1.55,
};

/** Steps/day each activity level roughly implies; used as the baseline for wearable data. */
export const BASELINE_STEPS: Record<DailyActivity, number> = {
  mostly_sitting: 5000,
  on_feet: 8500,
  physical_job: 12000,
};

const GOAL_ADJUST: Record<GoalPriority, number> = {
  fat_loss: -0.2,
  muscle_gain: 0.1,
  strength: 0.05,
  maintenance: 0,
};

const PROTEIN_G_PER_KG: Record<GoalPriority, number> = {
  fat_loss: 2.0,
  muscle_gain: 1.8,
  strength: 1.8,
  maintenance: 1.6,
};

export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}

export function bmrMifflin(sex: Profile['sex'], weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78; // midpoint when the user prefers not to say
}

/** Rough training cost: ~5 kcal/min of resistance training, averaged across the week. */
export function averageDailyTrainingKcal(trainingDays: number, sessionMinutes: number): number {
  return Math.round((trainingDays * sessionMinutes * 5) / 7);
}

export function computeTargets(profile: Pick<Profile, 'sex' | 'birthYear' | 'heightCm' | 'dailyActivity' | 'trainingDays' | 'sessionMinutes' | 'goal'>, weightKg: number): NutritionTargets {
  const age = ageFromBirthYear(profile.birthYear);
  const bmr = bmrMifflin(profile.sex, weightKg, profile.heightCm, age);
  const training = averageDailyTrainingKcal(profile.trainingDays.length, profile.sessionMinutes);
  const maintenance = Math.round(bmr * NEAT_FACTOR[profile.dailyActivity] + training);
  const calories = roundTo(maintenance * (1 + GOAL_ADJUST[profile.goal]), 10);
  const floor = profile.sex === 'female' ? 1200 : profile.sex === 'male' ? 1500 : 1350;
  const safeCalories = Math.max(calories, floor);
  const macros = macrosFor(safeCalories, weightKg, profile.goal);
  return {
    ...macros,
    bmr: Math.round(bmr),
    maintenance,
    baselineSteps: BASELINE_STEPS[profile.dailyActivity],
    baselineTrainingKcal: training,
    method: `Mifflin–St Jeor BMR × ${NEAT_FACTOR[profile.dailyActivity]} (daily activity) + ${training} kcal/day planned training, ${goalAdjustLabel(profile.goal)}`,
    updatedAt: nowISO(),
  };
}

export function macrosFor(calories: number, weightKg: number, goal: GoalPriority): MacroTargets {
  const proteinG = Math.round(weightKg * PROTEIN_G_PER_KG[goal]);
  const fatG = Math.round((calories * 0.27) / 9);
  const carbsG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  return { calories: Math.round(calories), proteinG, carbsG, fatG };
}

function goalAdjustLabel(goal: GoalPriority): string {
  const pct = Math.round(GOAL_ADJUST[goal] * 100);
  if (pct === 0) return 'no goal adjustment (maintenance)';
  return `${pct > 0 ? '+' : ''}${pct}% for ${goal.replace('_', ' ')}`;
}

export function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Targets for a specific day = ongoing target + any accepted one-day adjustment. */
export function targetsForDay(base: MacroTargets, adjustments: DayAdjustment[], date: ISODate): MacroTargets & { adjustment?: DayAdjustment } {
  const adj = adjustments.find((a) => a.date === date && !a.deleted);
  if (!adj) return { calories: base.calories, proteinG: base.proteinG, carbsG: base.carbsG, fatG: base.fatG };
  return {
    calories: base.calories + adj.calorieDelta,
    proteinG: base.proteinG,
    carbsG: base.carbsG + adj.carbsDeltaG,
    fatG: base.fatG,
    adjustment: adj,
  };
}
