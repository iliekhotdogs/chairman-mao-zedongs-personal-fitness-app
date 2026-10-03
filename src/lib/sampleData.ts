import type { AppState } from './state';
import { emptyState } from './state';
import type { FoodEntry, LoggedSet, MealType, Profile, WeightEntry, WorkoutSession } from './types';
import { addDays, nowISO, toISODate, weekday } from './dates';
import { newId } from './id';
import { computeTargets } from './nutrition/targets';
import { FOOD_DB } from './nutrition/foodDb';
import { itemFromRef, scaleItem } from './nutrition/lookup';
import { generatePlan, dayForWeekday } from './workouts/generator';
import { simulatedHealthConnectPull } from './activity/activity';
import { EXERCISE_BY_ID } from './workouts/exercises';

/**
 * Realistic SAMPLE data so every screen can be reviewed in the prototype.
 * Three weeks of slightly-too-slow fat loss with good logging (triggers a target
 * suggestion), a very active day today (triggers a one-day bonus), and workout history.
 */
const START_KG: Record<string, number> = {
  bench_press: 70, barbell_row: 60, back_squat: 90, deadlift: 110, romanian_deadlift: 80, overhead_press: 42.5,
  db_shoulder_press: 22, incline_db_press: 26, db_bench_press: 28, lat_pulldown: 55, pull_up: 0, seated_cable_row: 55,
  lateral_raise: 8, db_curl: 12, triceps_pushdown: 25, leg_curl: 40, leg_press: 140, calf_raise: 0, plank: 0, dead_bug: 0,
  split_squat: 16, hip_thrust: 80, leg_extension: 45, face_pull: 20, db_row: 30,
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const MEALS: { meal: MealType; options: [string, number][][] }[] = [
  { meal: 'breakfast', options: [[['greek_yogurt', 1], ['berries', 1], ['oats', 1]], [['egg', 3], ['wheat_bread', 2]], [['oatmeal', 1], ['banana', 1], ['whey', 1]]] },
  { meal: 'lunch', options: [[['chicken_breast', 1.3], ['white_rice', 1], ['broccoli', 1]], [['sandwich_turkey', 1], ['apple', 1]], [['caesar_chicken', 1]], [['burrito', 1]]] },
  { meal: 'dinner', options: [[['salmon', 1], ['potato', 1], ['salad_greens', 1], ['olive_oil', 1]], [['bolognese', 1]], [['chicken_curry', 1], ['white_rice', 1]], [['steak', 1], ['sweet_potato', 1], ['broccoli', 1]], [['stir_fry', 1], ['brown_rice', 1]]] },
  { meal: 'snack', options: [[['protein_bar', 1]], [['almonds', 1]], [['apple', 1], ['peanut_butter', 0.5]], [['whey', 1], ['milk_2', 1]]] },
];

function makeEntry(date: string, meal: MealType, combo: [string, number][], hour: number): FoodEntry {
  const items = combo.map(([id, mult]) => {
    const ref = FOOD_DB.find((f) => f.id === id)!;
    const p = ref.portions[0];
    return itemFromRef(ref, p.grams * mult, mult === 1 ? p.label : `${mult} × ${p.label}`);
  });
  const at = new Date(`${date}T${String(hour).padStart(2, '0')}:15:00`).toISOString();
  return { id: newId(), date, meal, items, origin: Math.random() > 0.5 ? 'photo' : 'manual', confirmedAt: at, createdAt: at, updatedAt: at };
}

export function buildSampleState(deviceId: string, today = toISODate()): AppState {
  const now = nowISO();
  const r = rng(42);
  const created = new Date(`${addDays(today, -24)}T09:00:00`).toISOString();
  const profile: Profile = {
    name: 'Alex',
    sex: 'male',
    birthYear: new Date().getFullYear() - 31,
    heightCm: 178,
    startWeightKg: 86.2,
    goal: 'fat_loss',
    experience: 'intermediate',
    equipment: 'full_gym',
    trainingDays: [1, 2, 4, 5],
    sessionMinutes: 60,
    dailyActivity: 'mostly_sitting',
    dietPreferences: [],
    limitations: [],
    createdAt: created,
    updatedAt: created,
  };
  const targets = { ...computeTargets(profile, 86.2), updatedAt: created };
  const state = emptyState(deviceId, now);

  // Weights: ~-0.1%/week (slower than the fat-loss target range) with daily noise.
  const weights: WeightEntry[] = [];
  for (let i = 22; i >= 0; i--) {
    if (r() < 0.25 && i !== 0) continue;
    const date = addDays(today, -i);
    const kg = 86.2 - (22 - i) * 0.012 + (r() - 0.5) * 0.6;
    weights.push({ id: newId(), date, weightKg: Math.round(kg * 10) / 10, updatedAt: now });
  }

  // Food: 14 days of logs close to target; today has breakfast + lunch only.
  const foodLog: FoodEntry[] = [];
  for (let i = 14; i >= 0; i--) {
    const date = addDays(today, -i);
    if (i > 0 && r() < 0.12) continue; // a couple of unlogged days
    for (const m of MEALS) {
      if (i === 0 && (m.meal === 'dinner' || m.meal === 'snack')) continue;
      if (m.meal === 'snack' && r() < 0.3) continue;
      const combo = m.options[Math.floor(r() * m.options.length)];
      foodLog.push(makeEntry(date, m.meal, combo, m.meal === 'breakfast' ? 8 : m.meal === 'lunch' ? 13 : m.meal === 'snack' ? 16 : 19));
    }
  }

  // Scale past days to land within ±5% of target (good adherence), so the weight-trend rule can act.
  for (let i = 14; i >= 1; i--) {
    const date = addDays(today, -i);
    const day = foodLog.filter((e) => e.date === date);
    const total = day.reduce((s, e) => s + e.items.reduce((t, it) => t + it.calories, 0), 0);
    if (!total) continue;
    const k = (targets.calories * (0.95 + r() * 0.1)) / total;
    for (const e of day) e.items = e.items.map((it) => (it.grams ? scaleItem(it, it.grams * k) : it));
  }

  // Workouts: follow the plan on scheduled days over the last 3 weeks, with progression.
  const plan = { ...generatePlan(profile, today), createdAt: created, updatedAt: created };
  const sessions: WorkoutSession[] = [];
  const bump: Record<string, number> = {};
  for (let i = 21; i >= 1; i--) {
    const date = addDays(today, -i);
    const day = dayForWeekday(plan, weekday(date));
    if (!day || r() < 0.12) continue;
    const start = new Date(`${date}T18:00:00`);
    const sets: LoggedSet[] = [];
    for (const pe of day.exercises) {
      const base = START_KG[pe.exerciseId] ?? 20;
      const ex = EXERCISE_BY_ID[pe.exerciseId];
      const w = ex?.loadType === 'bodyweight' ? 0 : base + (bump[pe.exerciseId] ?? 0);
      let allTop = true;
      for (let s = 0; s < pe.sets; s++) {
        const reps = Math.max(pe.repMin - 1, Math.min(pe.repMax, pe.repMin + Math.floor(r() * (pe.repMax - pe.repMin + 2)) - s));
        if (reps < pe.repMax) allTop = false;
        sets.push({ id: newId(), exerciseId: pe.exerciseId, weightKg: w, reps, via: r() > 0.7 ? 'voice' : 'manual', loggedAt: new Date(start.getTime() + sets.length * 150000).toISOString() });
      }
      if (allTop && w > 0) bump[pe.exerciseId] = (bump[pe.exerciseId] ?? 0) + (ex?.loadType === 'barbell' ? 2.5 : 2);
    }
    const end = new Date(start.getTime() + 55 * 60000).toISOString();
    sessions.push({ id: newId(), date, planId: plan.id, dayId: day.id, name: day.name, startedAt: start.toISOString(), finishedAt: end, sets, updatedAt: end });
  }

  return {
    ...state,
    profile,
    targets,
    weights,
    foodLog,
    plan,
    sessions,
    activity: simulatedHealthConnectPull(today),
    integrations: [{ id: 'health_connect', status: 'connected', lastSyncAt: now, message: 'Simulated data (no real device connected)' }],
    chat: [
      {
        id: newId(),
        role: 'coach',
        text: "Hi Alex, I'm your coach. I'll keep an eye on your food, training and weight trend, and suggest changes when the data supports them. You approve every change. Ask me anything, e.g. \"I only have 20 minutes today\".",
        createdAt: created,
        updatedAt: created,
        simulated: true,
      },
    ],
  };
}
