import type { BodyArea, Equipment, Exercise, GoalPriority, PlannedExercise, Profile, WorkoutDay, WorkoutPlan, Experience } from '../types';
import { newId } from '../id';
import { nowISO } from '../dates';
import { EXERCISE_BY_ID, EXERCISES } from './exercises';

type Slot = { candidates: string[]; role: 'main' | 'secondary' | 'accessory' };

const S = (role: Slot['role'], ...candidates: string[]): Slot => ({ role, candidates });

const FULL_BODY: { name: string; focus: string; slots: Slot[] }[] = [
  { name: 'Full Body A', focus: 'Squat · Push · Pull', slots: [S('main', 'back_squat', 'goblet_squat', 'leg_press', 'box_squat_bw', 'glute_bridge_bw'), S('main', 'bench_press', 'db_bench_press', 'chest_press_machine', 'push_up'), S('secondary', 'barbell_row', 'seated_cable_row', 'db_row', 'inverted_row'), S('secondary', 'romanian_deadlift', 'db_rdl', 'hip_thrust', 'glute_bridge_bw'), S('accessory', 'plank', 'dead_bug')] },
  { name: 'Full Body B', focus: 'Hinge · Press · Pull-down', slots: [S('main', 'deadlift', 'db_rdl', 'hip_thrust', 'glute_bridge_bw'), S('main', 'overhead_press', 'db_shoulder_press', 'push_up'), S('secondary', 'lat_pulldown', 'pull_up', 'db_row', 'inverted_row'), S('secondary', 'split_squat', 'walking_lunge', 'leg_press', 'box_squat_bw'), S('accessory', 'dead_bug', 'plank')] },
  { name: 'Full Body C', focus: 'Legs · Incline · Row', slots: [S('main', 'leg_press', 'goblet_squat', 'back_squat', 'box_squat_bw', 'glute_bridge_bw'), S('main', 'incline_db_press', 'db_bench_press', 'push_up'), S('secondary', 'seated_cable_row', 'db_row', 'inverted_row'), S('secondary', 'hip_thrust', 'glute_bridge_bw'), S('accessory', 'farmer_carry', 'plank')] },
];

const UPPER_LOWER: { name: string; focus: string; slots: Slot[] }[] = [
  { name: 'Upper A', focus: 'Chest · Back · Shoulders', slots: [S('main', 'bench_press', 'db_bench_press', 'chest_press_machine', 'push_up'), S('main', 'barbell_row', 'seated_cable_row', 'db_row', 'inverted_row'), S('secondary', 'db_shoulder_press', 'overhead_press', 'push_up'), S('secondary', 'lat_pulldown', 'pull_up', 'db_row'), S('accessory', 'lateral_raise', 'face_pull'), S('accessory', 'db_curl')] },
  { name: 'Lower A', focus: 'Squat · Hamstrings', slots: [S('main', 'back_squat', 'goblet_squat', 'leg_press', 'box_squat_bw', 'glute_bridge_bw'), S('secondary', 'romanian_deadlift', 'db_rdl', 'hip_thrust'), S('secondary', 'leg_curl', 'glute_bridge_bw'), S('accessory', 'calf_raise'), S('accessory', 'plank', 'dead_bug')] },
  { name: 'Upper B', focus: 'Incline · Vertical pull · Arms', slots: [S('main', 'incline_db_press', 'db_bench_press', 'push_up'), S('main', 'pull_up', 'lat_pulldown', 'db_row', 'inverted_row'), S('secondary', 'overhead_press', 'db_shoulder_press'), S('secondary', 'seated_cable_row', 'db_row', 'inverted_row'), S('accessory', 'triceps_pushdown', 'db_overhead_triceps'), S('accessory', 'db_curl')] },
  { name: 'Lower B', focus: 'Hinge · Single-leg', slots: [S('main', 'deadlift', 'db_rdl', 'hip_thrust', 'glute_bridge_bw'), S('secondary', 'split_squat', 'walking_lunge', 'leg_press', 'box_squat_bw'), S('secondary', 'hip_thrust', 'glute_bridge_bw'), S('accessory', 'leg_extension', 'calf_raise'), S('accessory', 'dead_bug', 'plank')] },
];

const PPL: { name: string; focus: string; slots: Slot[] }[] = [
  { name: 'Push', focus: 'Chest · Shoulders · Triceps', slots: [S('main', 'bench_press', 'db_bench_press', 'push_up'), S('secondary', 'overhead_press', 'db_shoulder_press'), S('secondary', 'incline_db_press', 'chest_press_machine', 'push_up'), S('accessory', 'lateral_raise'), S('accessory', 'triceps_pushdown', 'db_overhead_triceps')] },
  { name: 'Pull', focus: 'Back · Biceps', slots: [S('main', 'barbell_row', 'db_row', 'inverted_row'), S('secondary', 'pull_up', 'lat_pulldown', 'inverted_row'), S('secondary', 'seated_cable_row', 'db_row'), S('accessory', 'face_pull', 'lateral_raise'), S('accessory', 'db_curl')] },
  { name: 'Legs', focus: 'Quads · Hamstrings · Glutes', slots: [S('main', 'back_squat', 'goblet_squat', 'leg_press', 'box_squat_bw', 'glute_bridge_bw'), S('secondary', 'romanian_deadlift', 'db_rdl', 'hip_thrust'), S('secondary', 'split_squat', 'walking_lunge', 'leg_press'), S('accessory', 'leg_curl', 'glute_bridge_bw'), S('accessory', 'calf_raise')] },
];

interface Prescription {
  sets: number;
  repMin: number;
  repMax: number;
  restSec: number;
}

export function prescription(goal: GoalPriority, experience: Experience, role: Slot['role']): Prescription {
  const baseSets = experience === 'beginner' ? 3 : experience === 'intermediate' ? 3 : 4;
  if (role === 'accessory') return { sets: experience === 'beginner' ? 2 : 3, repMin: 10, repMax: 15, restSec: 60 };
  if (goal === 'strength') {
    return role === 'main' ? { sets: baseSets + (experience === 'beginner' ? 0 : 1), repMin: 3, repMax: 6, restSec: 180 } : { sets: baseSets, repMin: 6, repMax: 10, restSec: 120 };
  }
  if (goal === 'muscle_gain') return role === 'main' ? { sets: baseSets, repMin: 6, repMax: 10, restSec: 150 } : { sets: baseSets, repMin: 8, repMax: 12, restSec: 90 };
  return role === 'main' ? { sets: baseSets, repMin: 6, repMax: 10, restSec: 120 } : { sets: baseSets - (experience === 'beginner' ? 1 : 0), repMin: 8, repMax: 12, restSec: 90 };
}

export function isAllowed(ex: Exercise, equipment: Equipment, blocked: BodyArea[]): boolean {
  return ex.equipment.includes(equipment) && !ex.stresses.some((s) => blocked.includes(s));
}

/** Estimated minutes for a planned exercise (≈45 s per working set + rest + 2 min set-up for mains). */
export function estimateMinutes(p: PlannedExercise): number {
  const ex = EXERCISE_BY_ID[p.exerciseId];
  return Math.round((p.sets * (45 + p.restSec)) / 60 + (ex?.compound ? 2 : 1));
}

export function dayMinutes(day: WorkoutDay): number {
  return day.exercises.reduce((m, p) => m + estimateMinutes(p), 0) + 5; // + warm-up
}

export function activeLimitations(profile: Pick<Profile, 'limitations'>, today: string): BodyArea[] {
  return profile.limitations.filter((l) => !l.until || l.until >= today).map((l) => l.area);
}

export function generatePlan(profile: Profile, today: string): WorkoutPlan {
  const days = Math.max(1, Math.min(6, profile.trainingDays.length || 3));
  const blocked = activeLimitations(profile, today);
  let template = FULL_BODY;
  let split = 'Full-body';
  if (days === 4) {
    template = UPPER_LOWER;
    split = 'Upper/Lower';
  } else if (days >= 5) {
    template = days === 5 ? [...PPL, UPPER_LOWER[0], UPPER_LOWER[1]] : [...PPL, ...PPL.map((d) => ({ ...d, name: `${d.name} 2` }))];
    split = days === 5 ? 'Push/Pull/Legs + Upper/Lower' : 'Push/Pull/Legs ×2';
  }
  const chosenTemplates = Array.from({ length: days }, (_, i) => template[i % template.length]);
  const weekdays = [...profile.trainingDays].sort((a, b) => a - b);
  const notes: string[] = [];

  const workoutDays: WorkoutDay[] = chosenTemplates.map((t, i) => {
    const used = new Set<string>();
    const exercises: PlannedExercise[] = [];
    for (const slot of t.slots) {
      const pick = slot.candidates.map((id) => EXERCISE_BY_ID[id]).find((ex) => ex && !used.has(ex.id) && isAllowed(ex, profile.equipment, blocked));
      if (!pick) {
        notes.push(`${t.name}: skipped a ${slot.role} slot — no option fits your equipment/limitations.`);
        continue;
      }
      used.add(pick.id);
      const rx = prescription(profile.goal, profile.experience, slot.role);
      exercises.push({ exerciseId: pick.id, ...rx, ...(pick.timed ? { repMin: 30, repMax: 45 } : {}) });
    }
    const day: WorkoutDay = { id: newId(), name: t.name, focus: focusFor(exercises) || t.focus, weekday: weekdays[i], exercises };
    return fitToTime(day, profile.sessionMinutes);
  });

  const rationale = [
    `${split} split for ${days} training day${days > 1 ? 's' : ''} per week.`,
    `Rep ranges are set for ${profile.goal.replace('_', ' ')} at a ${profile.experience} level.`,
    `Sessions are trimmed to about ${profile.sessionMinutes} minutes.`,
    `Exercises use your equipment (${profile.equipment.replace('_', ' ')}).`,
  ];
  if (blocked.length) rationale.push(`Avoids exercises that heavily load: ${blocked.join(', ').replace(/_/g, ' ')}.`);
  rationale.push('Start each exercise with a weight you could lift 2–3 more reps with. The app suggests the next weights after each session.');

  const now = nowISO();
  return { id: newId(), name: `${split} plan`, source: 'ai_generated', days: workoutDays, rationale: [...rationale, ...notes], createdAt: now, updatedAt: now };
}

/** Focus label from what the day actually contains (templates can change after limitation swaps). */
export function focusFor(exercises: PlannedExercise[]): string {
  const names = [...new Set(exercises.map((e) => EXERCISE_BY_ID[e.exerciseId]?.primary).filter(Boolean))].slice(0, 3) as string[];
  return names.map((n) => n.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())).join(' · ');
}

/** Drop accessories (then reduce sets) until the session fits the time budget. */
export function fitToTime(day: WorkoutDay, minutes: number): WorkoutDay {
  const ex = [...day.exercises];
  while (ex.length > 2 && dayMinutes({ ...day, exercises: ex }) > minutes) {
    const lastAccessory = [...ex].reverse().findIndex((p) => !EXERCISE_BY_ID[p.exerciseId]?.compound);
    if (lastAccessory >= 0) ex.splice(ex.length - 1 - lastAccessory, 1);
    else ex.pop();
  }
  let trimmed = ex.map((p) => ({ ...p }));
  let guard = 0;
  while (dayMinutes({ ...day, exercises: trimmed }) > minutes && guard++ < 10) {
    trimmed = trimmed.map((p) => ({ ...p, sets: Math.max(2, p.sets - 1), restSec: Math.max(60, p.restSec - 30) }));
  }
  return { ...day, exercises: trimmed };
}

/** A short version of a day for "I only have N minutes". */
export function condensedDay(day: WorkoutDay, minutes: number): WorkoutDay {
  const compounds = day.exercises.filter((p) => EXERCISE_BY_ID[p.exerciseId]?.compound);
  const pick = (compounds.length ? compounds : day.exercises).slice(0, minutes <= 20 ? 3 : 4);
  const exercises = pick.map((p) => ({ ...p, sets: 2, restSec: 60, note: 'Superset with the next exercise to save time' }));
  return { ...day, id: newId(), sourceDayId: day.sourceDayId ?? day.id, name: `${day.name} (${minutes}-min version)`, exercises };
}

/** Replace exercises that load a painful area with the closest safe alternative, or drop them. */
export function swapForArea(day: WorkoutDay, area: BodyArea, equipment: Equipment): { day: WorkoutDay; changes: string[] } {
  const changes: string[] = [];
  const used = new Set(day.exercises.map((p) => p.exerciseId));
  const exercises: PlannedExercise[] = [];
  for (const p of day.exercises) {
    const ex = EXERCISE_BY_ID[p.exerciseId];
    if (!ex || !ex.stresses.includes(area)) {
      exercises.push(p);
      continue;
    }
    const alt = EXERCISES.find((e) => !used.has(e.id) && e.primary === ex.primary && isAllowed(e, equipment, [area]));
    if (alt) {
      used.add(alt.id);
      exercises.push({ ...p, exerciseId: alt.id, targetWeightKg: undefined, note: `Swapped from ${ex.name} to reduce ${area.replace('_', ' ')} load` });
      changes.push(`${ex.name} → ${alt.name}`);
    } else {
      changes.push(`Removed ${ex.name}`);
    }
  }
  return { day: { ...day, id: newId(), sourceDayId: day.sourceDayId ?? day.id, name: `${day.name} (${area.replace('_', ' ')}-friendly)`, exercises }, changes };
}

/** The plan day scheduled for a weekday, if any. */
export function dayForWeekday(plan: WorkoutPlan | undefined, wd: number): WorkoutDay | undefined {
  return plan?.days.find((d) => d.weekday === wd);
}
