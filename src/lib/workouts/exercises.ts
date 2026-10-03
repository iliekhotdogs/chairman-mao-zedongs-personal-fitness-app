import type { Equipment, Exercise } from '../types';

const GYM: Equipment[] = ['full_gym'];
const BARBELL: Equipment[] = ['full_gym', 'home_barbell'];
const DB: Equipment[] = ['full_gym', 'home_barbell', 'dumbbells'];
const ANY: Equipment[] = ['full_gym', 'home_barbell', 'dumbbells', 'bodyweight'];

export const EXERCISES: Exercise[] = [
  // Push
  { id: 'bench_press', name: 'Bench Press', aliases: ['bench', 'barbell bench', 'flat bench', 'bench press'], primary: 'chest', pattern: 'push', equipment: BARBELL, loadType: 'barbell', stresses: ['shoulder', 'wrist', 'elbow'], compound: true },
  { id: 'db_bench_press', name: 'Dumbbell Bench Press', aliases: ['dumbbell bench', 'db bench', 'dumbbell press'], primary: 'chest', pattern: 'push', equipment: DB, loadType: 'dumbbell', stresses: ['shoulder'], compound: true },
  { id: 'incline_db_press', name: 'Incline Dumbbell Press', aliases: ['incline press', 'incline dumbbell', 'incline bench'], primary: 'chest', pattern: 'push', equipment: DB, loadType: 'dumbbell', stresses: ['shoulder'], compound: true },
  { id: 'push_up', name: 'Push-up', aliases: ['push up', 'pushups', 'push-ups', 'press up'], primary: 'chest', pattern: 'push', equipment: ANY, loadType: 'bodyweight', stresses: ['wrist', 'shoulder'], compound: true },
  { id: 'overhead_press', name: 'Overhead Press', aliases: ['ohp', 'military press', 'shoulder press', 'overhead press'], primary: 'shoulders', pattern: 'push', equipment: BARBELL, loadType: 'barbell', stresses: ['shoulder', 'lower_back', 'wrist'], compound: true },
  { id: 'db_shoulder_press', name: 'Seated Dumbbell Shoulder Press', aliases: ['dumbbell shoulder press', 'db shoulder press', 'seated press'], primary: 'shoulders', pattern: 'push', equipment: DB, loadType: 'dumbbell', stresses: ['shoulder'], compound: true },
  { id: 'lateral_raise', name: 'Lateral Raise', aliases: ['lateral raises', 'side raise', 'laterals'], primary: 'shoulders', pattern: 'isolation', equipment: DB, loadType: 'dumbbell', stresses: [], compound: false },
  { id: 'triceps_pushdown', name: 'Triceps Pushdown', aliases: ['pushdown', 'tricep pushdown', 'rope pushdown'], primary: 'triceps', pattern: 'isolation', equipment: GYM, loadType: 'cable', stresses: ['elbow'], compound: false },
  { id: 'db_overhead_triceps', name: 'Overhead Dumbbell Triceps Extension', aliases: ['overhead extension', 'tricep extension', 'triceps extension'], primary: 'triceps', pattern: 'isolation', equipment: DB, loadType: 'dumbbell', stresses: ['elbow', 'shoulder'], compound: false },
  { id: 'chest_press_machine', name: 'Machine Chest Press', aliases: ['chest press', 'machine press'], primary: 'chest', pattern: 'push', equipment: GYM, loadType: 'machine', stresses: [], compound: true },
  // Pull
  { id: 'barbell_row', name: 'Barbell Row', aliases: ['row', 'bent over row', 'barbell row', 'bb row'], primary: 'back', pattern: 'pull', equipment: BARBELL, loadType: 'barbell', stresses: ['lower_back'], compound: true },
  { id: 'db_row', name: 'One-arm Dumbbell Row', aliases: ['dumbbell row', 'db row', 'one arm row'], primary: 'back', pattern: 'pull', equipment: DB, loadType: 'dumbbell', stresses: [], compound: true },
  { id: 'lat_pulldown', name: 'Lat Pulldown', aliases: ['pulldown', 'lat pull down', 'pull down'], primary: 'back', pattern: 'pull', equipment: GYM, loadType: 'cable', stresses: ['shoulder'], compound: true },
  { id: 'pull_up', name: 'Pull-up', aliases: ['pull up', 'pullups', 'chin up', 'chin-up'], primary: 'back', pattern: 'pull', equipment: ['full_gym', 'home_barbell', 'bodyweight'], loadType: 'bodyweight', stresses: ['shoulder', 'elbow'], compound: true },
  { id: 'seated_cable_row', name: 'Seated Cable Row', aliases: ['cable row', 'seated row'], primary: 'back', pattern: 'pull', equipment: GYM, loadType: 'cable', stresses: [], compound: true },
  { id: 'inverted_row', name: 'Inverted Row', aliases: ['inverted row', 'table row', 'australian pull up'], primary: 'back', pattern: 'pull', equipment: ['bodyweight', 'home_barbell'], loadType: 'bodyweight', stresses: [], compound: true },
  { id: 'face_pull', name: 'Face Pull', aliases: ['face pulls'], primary: 'shoulders', pattern: 'isolation', equipment: GYM, loadType: 'cable', stresses: [], compound: false },
  { id: 'db_curl', name: 'Dumbbell Curl', aliases: ['curl', 'curls', 'bicep curl', 'biceps curl', 'dumbbell curl'], primary: 'biceps', pattern: 'isolation', equipment: DB, loadType: 'dumbbell', stresses: ['elbow'], compound: false },
  // Legs
  { id: 'back_squat', name: 'Back Squat', aliases: ['squat', 'squats', 'back squat', 'barbell squat'], primary: 'quads', pattern: 'squat', equipment: BARBELL, loadType: 'barbell', stresses: ['knee', 'lower_back', 'hip'], compound: true },
  { id: 'goblet_squat', name: 'Goblet Squat', aliases: ['goblet', 'goblet squat'], primary: 'quads', pattern: 'squat', equipment: DB, loadType: 'dumbbell', stresses: ['knee'], compound: true },
  { id: 'leg_press', name: 'Leg Press', aliases: ['leg press'], primary: 'quads', pattern: 'squat', equipment: GYM, loadType: 'machine', stresses: ['knee'], compound: true },
  { id: 'deadlift', name: 'Deadlift', aliases: ['deadlift', 'deadlifts', 'conventional deadlift'], primary: 'hamstrings', pattern: 'hinge', equipment: BARBELL, loadType: 'barbell', stresses: ['lower_back', 'hip'], compound: true },
  { id: 'romanian_deadlift', name: 'Romanian Deadlift', aliases: ['rdl', 'romanian deadlift', 'stiff leg deadlift'], primary: 'hamstrings', pattern: 'hinge', equipment: BARBELL, loadType: 'barbell', stresses: ['lower_back'], compound: true },
  { id: 'db_rdl', name: 'Dumbbell Romanian Deadlift', aliases: ['dumbbell rdl', 'db rdl', 'dumbbell romanian deadlift'], primary: 'hamstrings', pattern: 'hinge', equipment: DB, loadType: 'dumbbell', stresses: ['lower_back'], compound: true },
  { id: 'hip_thrust', name: 'Hip Thrust', aliases: ['hip thrust', 'glute bridge', 'hip thrusts'], primary: 'glutes', pattern: 'hinge', equipment: ANY, loadType: 'barbell', stresses: [], compound: true },
  { id: 'split_squat', name: 'Bulgarian Split Squat', aliases: ['split squat', 'bulgarian', 'bulgarian split squat'], primary: 'quads', pattern: 'lunge', equipment: ANY, loadType: 'dumbbell', stresses: ['knee', 'hip'], compound: true },
  { id: 'walking_lunge', name: 'Walking Lunge', aliases: ['lunge', 'lunges', 'walking lunges'], primary: 'quads', pattern: 'lunge', equipment: ANY, loadType: 'dumbbell', stresses: ['knee'], compound: true },
  { id: 'leg_curl', name: 'Leg Curl', aliases: ['hamstring curl', 'leg curls', 'lying leg curl'], primary: 'hamstrings', pattern: 'isolation', equipment: GYM, loadType: 'machine', stresses: [], compound: false },
  { id: 'leg_extension', name: 'Leg Extension', aliases: ['leg extensions', 'quad extension'], primary: 'quads', pattern: 'isolation', equipment: GYM, loadType: 'machine', stresses: ['knee'], compound: false },
  { id: 'calf_raise', name: 'Standing Calf Raise', aliases: ['calf raise', 'calf raises', 'calves'], primary: 'calves', pattern: 'isolation', equipment: ANY, loadType: 'bodyweight', stresses: ['ankle'], compound: false },
  { id: 'box_squat_bw', name: 'Bodyweight Box Squat', aliases: ['box squat', 'bodyweight squat', 'air squat'], primary: 'quads', pattern: 'squat', equipment: ANY, loadType: 'bodyweight', stresses: ['knee'], compound: true },
  { id: 'glute_bridge_bw', name: 'Single-leg Glute Bridge', aliases: ['single leg bridge', 'single leg glute bridge'], primary: 'glutes', pattern: 'hinge', equipment: ANY, loadType: 'bodyweight', stresses: [], compound: false },
  // Core / carry
  { id: 'plank', name: 'Plank', aliases: ['plank', 'planks'], primary: 'core', pattern: 'core', equipment: ANY, loadType: 'bodyweight', stresses: [], compound: false, timed: true },
  { id: 'dead_bug', name: 'Dead Bug', aliases: ['dead bug', 'deadbug'], primary: 'core', pattern: 'core', equipment: ANY, loadType: 'bodyweight', stresses: [], compound: false },
  { id: 'farmer_carry', name: "Farmer's Carry", aliases: ['farmer carry', 'farmers walk', "farmer's walk"], primary: 'full_body', pattern: 'carry', equipment: DB, loadType: 'dumbbell', stresses: ['wrist'], compound: true, timed: true },
];

export const EXERCISE_BY_ID: Record<string, Exercise> = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/** "3×8–12" or "3×30–45 s" for timed holds. */
export function formatPrescription(p: { exerciseId: string; sets: number; repMin: number; repMax: number }, sep = '×'): string {
  const timed = EXERCISE_BY_ID[p.exerciseId]?.timed;
  return `${p.sets}${sep}${p.repMin}–${p.repMax}${timed ? ' s' : ''}`;
}

export function exerciseName(id: string): string {
  return EXERCISE_BY_ID[id]?.name ?? id;
}

/** Find an exercise from spoken/typed text using aliases (longest alias wins). */
export function findExercise(text: string): Exercise | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ')} `;
  let best: { e: Exercise; len: number } | undefined;
  for (const e of EXERCISES) {
    for (const a of [e.name.toLowerCase(), ...e.aliases]) {
      if (t.includes(` ${a} `) || t.includes(` ${a}s `)) {
        if (!best || a.length > best.len) best = { e, len: a.length };
      }
    }
  }
  return best?.e;
}
