import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { AccentRule, Badge, Banner, Button, Card, Chip, Columns, Field, HeightField, Muted, NumberField, OptionCard, ProgressBar, Row, Screen, Segmented, Stack, Text, Expandable, Ionicons } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { LogoMark } from '@/components/Brand';
import type { BodyArea, DailyActivity, Equipment, Experience, GoalPriority, Profile, Sex, UnitSystem } from '@/lib/types';
import { calorieFloor, computeTargets, macrosFor } from '@/lib/nutrition/targets';
import { generatePlan, dayMinutes } from '@/lib/workouts/generator';
import { exerciseName, formatPrescription } from '@/lib/workouts/exercises';
import { nowISO, toISODate, WEEKDAY_SHORT } from '@/lib/dates';
import { newId } from '@/lib/id';
import { displayWeight, kgToLb, lbToKg, round } from '@/lib/units';
import { MAX_CALORIES } from '@/lib/inputRules';
import { ACTIVITY_LABEL, formatHeight, SEX_LABEL } from '@/lib/uiText';
import { buildSampleState } from '@/lib/sampleData';
import { useLayout } from '@/hooks/useLayout';
import { AccountCard } from '@/components/AccountCard';

const STEPS = ['Welcome', 'Goal', 'About you', 'Training', 'Lifestyle', 'Optional', 'Your plan'];
const OPTIONAL_STEP = 5;
const PLAN_STEP = 6;

const GOALS: { value: GoalPriority; title: string; body: string; icon: React.ComponentProps<typeof OptionCard>['icon'] }[] = [
  { value: 'fat_loss', title: 'Lose fat', body: 'Moderate calorie deficit with high protein to keep muscle.', icon: 'flame-outline' },
  { value: 'muscle_gain', title: 'Build muscle', body: 'Small surplus and training focused on muscle growth.', icon: 'body-outline' },
  { value: 'strength', title: 'Get stronger', body: 'Heavier, lower-rep training on the main lifts.', icon: 'barbell-outline' },
  { value: 'maintenance', title: 'Maintain', body: 'Keep your weight steady while training consistently.', icon: 'sync-outline' },
];

const AREAS: { value: BodyArea; label: string }[] = [
  { value: 'knee', label: 'Knee' }, { value: 'lower_back', label: 'Lower back' }, { value: 'shoulder', label: 'Shoulder' },
  { value: 'wrist', label: 'Wrist' }, { value: 'elbow', label: 'Elbow' }, { value: 'hip', label: 'Hip' }, { value: 'ankle', label: 'Ankle' }, { value: 'neck', label: 'Neck' },
];

const DIETS = [
  { value: 'vegetarian', label: 'Vegetarian' }, { value: 'vegan', label: 'Vegan' }, { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'dairy_free', label: 'Dairy-free' }, { value: 'gluten_free', label: 'Gluten-free' }, { value: 'halal', label: 'Halal' }, { value: 'no_pork', label: 'No pork' }, { value: 'low_carb', label: 'Prefer lower carb' },
];

function Why({ children }: { children: string }) {
  return (
    <Row align="flex-start" gap={6}>
      <Badge kind="info" label="Why we ask" />
      <Muted variant="small" style={{ flex: 1 }}>{children}</Muted>
    </Row>
  );
}

export default function Onboarding() {
  const { state, today, sync } = useStore();
  const doAct = useAct();
  const { isPhone } = useLayout();
  const [step, setStep] = useState(0);

  const [units, setUnits] = useState<UnitSystem>(state.settings.units);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<GoalPriority>('fat_loss');
  const [sex, setSex] = useState<Sex>('unspecified');
  const [age, setAge] = useState<number | undefined>();
  const [heightCm, setHeightCm] = useState<number | undefined>();
  const [heightBad, setHeightBad] = useState(false);
  const [weightKg, setWeightKg] = useState<number | undefined>();
  const [experience, setExperience] = useState<Experience>('beginner');
  const [equipment, setEquipment] = useState<Equipment>('full_gym');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [minutes, setMinutes] = useState(60);
  const [activity, setActivity] = useState<DailyActivity>('mostly_sitting');
  const [diet, setDiet] = useState<string[]>([]);
  const [limits, setLimits] = useState<BodyArea[]>([]);
  const [limitNote, setLimitNote] = useState('');
  const [calorieOverride, setCalorieOverride] = useState<number | undefined>();
  const [wantPlan, setWantPlan] = useState(true);

  const profile: Profile | undefined = useMemo(() => {
    if (!age || !heightCm || !weightKg) return undefined;
    const now = nowISO();
    return {
      name: name.trim() || 'there',
      sex,
      birthYear: new Date().getFullYear() - age,
      heightCm,
      startWeightKg: weightKg,
      goal,
      experience,
      equipment,
      trainingDays: [...days].sort(),
      sessionMinutes: minutes,
      dailyActivity: activity,
      dietPreferences: diet,
      limitations: limits.map((a) => ({ area: a, note: limitNote || undefined })),
      createdAt: now,
      updatedAt: now,
    };
  }, [name, sex, age, heightCm, weightKg, goal, experience, equipment, days, minutes, activity, diet, limits, limitNote]);

  const targets = useMemo(() => (profile ? computeTargets(profile, profile.startWeightKg) : undefined), [profile]);
  const plan = useMemo(() => (profile && days.length ? generatePlan(profile, today) : undefined), [profile, days.length, today]);

  if (state.profile && state.targets) return <Redirect href="/" />;

  const ageBad = age !== undefined && (age < 16 || age > 90);
  const weightBad = weightKg !== undefined && (weightKg <= 35 || weightKg >= 300);
  const validBody = age !== undefined && !ageBad && heightCm !== undefined && !heightBad && weightKg !== undefined && !weightBad;
  const floor = calorieFloor(sex);
  const calorieError = calorieOverride !== undefined && (calorieOverride < floor || calorieOverride > MAX_CALORIES) ? `Enter ${floor.toLocaleString()}–${MAX_CALORIES.toLocaleString()} kcal, or leave it empty.` : undefined;
  const calories = calorieError ? undefined : calorieOverride;
  const canNext = step !== 2 || validBody;
  // Signed in but the first sync of this session hasn't finished: a profile may still be on its
  // way from the server, and finishing now would overwrite it. A failed sync releases the hold.
  const firstSyncPending = sync.configured && !!sync.session && !sync.lastSyncAt && sync.status !== 'error';
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = () => {
    if (!profile || !targets || firstSyncPending || calorieError) return;
    const finalTargets = calories && Math.abs(calories - targets.calories) >= 10 ? { ...targets, ...macrosFor(calories, profile.startWeightKg, profile.goal), method: `${targets.method} · adjusted by you` } : targets;
    doAct({ type: 'UPDATE_SETTINGS', patch: { units }, now: nowISO() });
    const ok = doAct({
      type: 'COMPLETE_ONBOARDING',
      profile,
      targets: finalTargets,
      weight: { id: newId(), date: toISODate(), weightKg: profile.startWeightKg, updatedAt: nowISO() },
      plan: wantPlan ? plan : undefined,
    });
    if (ok) router.replace('/');
  };

  const loadSample = () => {
    if (firstSyncPending) return;
    doAct({ type: 'REPLACE_STATE', state: buildSampleState(state.deviceId, today) }, 'Sample data loaded');
    router.replace('/');
  };

  return (
    <Screen size="narrow">
      {step > 0 ? (
        <Stack gap={6}>
          <Row>
            <Muted variant="small" style={{ flex: 1 }}>Step {step} of {STEPS.length - 1} · {STEPS[step]}</Muted>
          </Row>
          <ProgressBar value={step} max={STEPS.length - 1} label="Setup progress" />
        </Stack>
      ) : null}

      {step === 0 && (
        <Stack gap={Space.lg} style={{ paddingTop: isPhone ? Space.xl : Space.xxxl }}>
          <LogoMark size={56} />
          <Text variant="display">Your coach for food, training, and progress</Text>
          <AccentRule width={48} />
          <Muted>
            Log meals from a photo, follow a training plan built around you, and get suggestions that adapt to your real results. You approve every change.
          </Muted>
          <Card style={{ gap: Space.sm }}>
            {[
              ['camera-outline', 'Photo food logging. You confirm every estimate before it is saved'],
              ['barbell-outline', 'Workout plans and logging, including by voice'],
              ['sparkles-outline', 'Adaptive coaching based on your weight trend and activity'],
            ].map(([icon, t]) => (
              <Row key={t} gap={Space.sm}>
                <Ionicons name={icon as never} size={18} color={C.primary} />
                <Text variant="small" style={{ flex: 1 }}>{t}</Text>
              </Row>
            ))}
          </Card>
          <Text variant="smallStrong">Takes about 2 minutes.</Text>
          <Field label="What should we call you? (optional)" value={name} onChangeText={setName} placeholder="First name" autoComplete="given-name" />
          <Row wrap gap={Space.sm}>
            <Button title="Get started" size="lg" icon="arrow-forward" onPress={next} loading={firstSyncPending} disabled={firstSyncPending} />
            {__DEV__ && !sync.configured ? <Button title="Explore with sample data" kind="secondary" size="lg" icon="flask-outline" onPress={loadSample} disabled={firstSyncPending} /> : null}
          </Row>
          {firstSyncPending ? <Muted variant="small" accessibilityLiveRegion="polite">Checking your account for existing data…</Muted> : null}
          {sync.configured ? (
            <>
              <AccountCard intro="Sign in and your profile, plan and history download from the cloud. No need to set up again." />
              {sync.session && !state.profile ? <Muted variant="small">Signed in. Downloading your data… If you are new, tap Get started.</Muted> : null}
            </>
          ) : null}
          {!sync.configured ? <Muted variant="small">Your data is saved on this device. Meal estimates use your text hint; notifications stay on this device.</Muted> : null}
        </Stack>
      )}

      {step === 1 && (
        <Stack gap={Space.md}>
          <Text variant="h1">What&apos;s your priority right now?</Text>
          <Why>Your priority sets your calorie target and how your workouts are structured. You can change it any time.</Why>
          {GOALS.map((g) => (
            <OptionCard key={g.value} title={g.title} body={g.body} icon={g.icon} selected={goal === g.value} onPress={() => setGoal(g.value)} />
          ))}
        </Stack>
      )}

      {step === 2 && (
        <Stack gap={Space.md}>
          <Text variant="h1">About you</Text>
          <Why>Height, weight, age and sex are used to estimate how much energy your body uses. They stay private to your account.</Why>
          <Segmented label="Units" value={units} onChange={(u) => { setUnits(u); setHeightBad(false); }} options={[{ value: 'imperial', label: 'lb / ft' }, { value: 'metric', label: 'kg / cm' }]} />
          <Columns>
            {[
              <NumberField key="age" label="Age" value={age} onChange={setAge} suffix="years" placeholder="e.g. 30" error={ageBad ? 'This app is for ages 16–90.' : undefined} />,
              units === 'imperial' ? (
                <NumberField key="w" label="Weight" value={weightKg ? round(kgToLb(weightKg), 1) : undefined} onChange={(v) => setWeightKg(v ? lbToKg(v) : undefined)} suffix="lb" placeholder="e.g. 175" error={weightBad ? 'Enter a weight between 80 and 660 lb.' : undefined} />
              ) : (
                <NumberField key="w" label="Weight" value={weightKg ? round(weightKg, 1) : undefined} onChange={setWeightKg} suffix="kg" placeholder="e.g. 80" error={weightBad ? 'Enter a weight between 36 and 299 kg.' : undefined} />
              ),
            ]}
          </Columns>
          <HeightField key={units} units={units} value={heightCm} onChange={(cm, bad) => { setHeightCm(cm); setHeightBad(bad); }} />
          <Text variant="smallStrong">Sex (for the calorie equation)</Text>
          <Segmented label="Sex" value={sex} onChange={setSex} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'unspecified', label: 'Not saying' }]} />
          {!validBody ? <Muted variant="small" accessibilityLiveRegion="polite">{ageBad || heightBad || weightBad ? 'Fix the highlighted fields to continue.' : 'Please fill in age, height and weight to continue.'}</Muted> : null}
        </Stack>
      )}

      {step === 3 && (
        <Stack gap={Space.md}>
          <Text variant="h1">Your training</Text>
          <Why>Experience, equipment and schedule decide which exercises, how many sets, and how long each workout is.</Why>
          <Text variant="smallStrong">Experience</Text>
          <Segmented label="Experience" value={experience} onChange={setExperience} options={[{ value: 'beginner', label: 'New (<1 yr)' }, { value: 'intermediate', label: '1–3 yrs' }, { value: 'advanced', label: '3+ yrs' }]} />
          <Text variant="smallStrong">Equipment</Text>
          {([
            ['full_gym', 'Full gym', 'Barbells, machines, cables, dumbbells'],
            ['home_barbell', 'Home gym with barbell', 'Barbell, rack, bench, some dumbbells'],
            ['dumbbells', 'Dumbbells only', 'Adjustable or a few pairs'],
            ['bodyweight', 'No equipment', 'Bodyweight exercises'],
          ] as [Equipment, string, string][]).map(([v, t, b]) => (
            <OptionCard key={v} title={t} body={b} selected={equipment === v} onPress={() => setEquipment(v)} />
          ))}
          <Text variant="smallStrong">Which days can you train?</Text>
          <Row wrap gap={6}>
            {WEEKDAY_SHORT.map((d, i) => (
              <Chip key={d} label={d} selected={days.includes(i)} onPress={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))} />
            ))}
          </Row>
          {days.length === 0 ? <Muted variant="small">Pick at least one day, or skip the plan in the last step.</Muted> : <Muted variant="small">{days.length} day{days.length > 1 ? 's' : ''} per week</Muted>}
          <Text variant="smallStrong">Time per workout</Text>
          <Segmented label="Minutes" value={String(minutes)} onChange={(v) => setMinutes(parseInt(v, 10))} options={['30', '45', '60', '75', '90'].map((m) => ({ value: m, label: `${m} min` }))} />
        </Stack>
      )}

      {step === 4 && (
        <Stack gap={Space.md}>
          <Text variant="h1">Your daily life</Text>
          <Why>Your daily movement outside the gym affects your calorie needs.</Why>
          <Text variant="smallStrong">Outside of workouts, your day is mostly…</Text>
          {([
            ['mostly_sitting', 'Sitting', 'Desk work, under ~5,000 steps'],
            ['on_feet', 'On my feet', 'Teaching, retail, walking a lot (~8,000 steps)'],
            ['physical_job', 'Physical work', 'Construction, nursing, labour (12,000+ steps)'],
          ] as [DailyActivity, string, string][]).map(([v, t, b]) => (
            <OptionCard key={v} title={t} body={b} selected={activity === v} onPress={() => setActivity(v)} />
          ))}
        </Stack>
      )}

      {step === OPTIONAL_STEP && (
        <Stack gap={Space.md}>
          <Text variant="h1">Anything else? (optional)</Text>
          <Why>Food preferences shape suggestions. Injuries help us avoid exercises that could aggravate them. You can skip this and add it later in Settings.</Why>
          <Text variant="smallStrong">Food preferences (optional)</Text>
          <Row wrap gap={6}>
            {DIETS.map((d) => (
              <Chip key={d.value} label={d.label} selected={diet.includes(d.value)} onPress={() => setDiet((cur) => (cur.includes(d.value) ? cur.filter((x) => x !== d.value) : [...cur, d.value]))} />
            ))}
          </Row>
          <Text variant="smallStrong">Any injuries or areas to be careful with? (optional)</Text>
          <Row wrap gap={6}>
            {AREAS.map((a) => (
              <Chip key={a.value} label={a.label} selected={limits.includes(a.value)} onPress={() => setLimits((cur) => (cur.includes(a.value) ? cur.filter((x) => x !== a.value) : [...cur, a.value]))} />
            ))}
          </Row>
          {limits.length ? <Field label="Anything we should know? (optional)" value={limitNote} onChangeText={setLimitNote} placeholder="e.g. old ACL repair, avoid deep squats" /> : null}
          {limits.length ? <Banner kind="info">The app avoids exercises that load these areas heavily. It is not medical advice. If something hurts, stop and check with a professional.</Banner> : null}
        </Stack>
      )}

      {step === PLAN_STEP && profile && targets && (
        <Stack gap={Space.md}>
          <Text variant="h1">Here&apos;s your starting plan</Text>
          <Muted>These are starting estimates. Your coach will suggest adjustments as your real weight trend comes in, and you approve each one.</Muted>
          <Card tone="muted" style={{ gap: Space.sm }}>
            <Muted variant="small">Based on age {age}, {formatHeight(profile.heightCm, units)}, {displayWeight(profile.startWeightKg, units, 0)}, {SEX_LABEL[sex]}, and {ACTIVITY_LABEL[activity]}.</Muted>
            <Button title="Edit body stats" kind="ghost" size="sm" onPress={() => setStep(2)} />
          </Card>
          <Card tone="pending" style={{ gap: Space.md }}>
            <Row wrap gap={6}>
              <Badge kind="suggestion" label="Proposed" />
              <Badge kind="pending" label="Needs your approval" />
            </Row>
            <Text variant="h3">Daily nutrition target</Text>
            <Row wrap gap={Space.xl}>
              <Stack gap={0}><Text variant="number">{(calories ?? targets.calories).toLocaleString()}</Text><Muted variant="small">kcal / day</Muted></Stack>
              {(() => {
                const m = calories ? macrosFor(calories, profile.startWeightKg, goal) : targets;
                return (
                  <Row gap={Space.lg}>
                    <Stack gap={0}><Text variant="numberSm" color={C.protein}>{m.proteinG} g</Text><Muted variant="small">protein</Muted></Stack>
                    <Stack gap={0}><Text variant="numberSm" color={C.carbs}>{m.carbsG} g</Text><Muted variant="small">carbs</Muted></Stack>
                    <Stack gap={0}><Text variant="numberSm" color={C.fat}>{m.fatG} g</Text><Muted variant="small">fat</Muted></Stack>
                  </Row>
                );
              })()}
            </Row>
            <Expandable title="How this was calculated" icon="calculator-outline">
              <Muted variant="small">Estimated resting burn: {targets.bmr.toLocaleString()} kcal</Muted>
              <Muted variant="small">Estimated maintenance: {targets.maintenance.toLocaleString()} kcal (includes ~{targets.baselineSteps.toLocaleString()} steps/day and your planned workouts)</Muted>
              <Muted variant="small">{targets.method}</Muted>
              <Muted variant="small">These equations are usually accurate to within about 10%, which is why the coach adjusts from your real results.</Muted>
            </Expandable>
            <NumberField label="Prefer a different calorie target? (optional)" value={calorieOverride} onChange={setCalorieOverride} suffix="kcal" hint="Leave empty to use the suggested number." error={calorieError} />
          </Card>

          <Card tone={wantPlan ? 'pending' : 'muted'} style={{ gap: Space.md }}>
            {plan ? (
              <>
                <Text variant="h3">{plan.name}</Text>
                {plan.days.map((d) => (
                  <Stack key={d.id} gap={2}>
                    <Text variant="smallStrong">
                      {d.weekday !== undefined ? WEEKDAY_SHORT[d.weekday] : ''} · {d.name} <Muted variant="small">(~{dayMinutes(d)} min)</Muted>
                    </Text>
                    <Muted variant="small">{d.exercises.map((e) => `${exerciseName(e.exerciseId)} ${formatPrescription(e)}`).join(' · ')}</Muted>
                  </Stack>
                ))}
                <Expandable title="Why this plan?" icon="help-circle-outline">
                  {plan.rationale.map((r) => (
                    <Muted key={r} variant="small">• {r}</Muted>
                  ))}
                </Expandable>
              </>
            ) : (
              <Muted>No training days selected. You can create a plan later.</Muted>
            )}
            <Segmented label="Plan choice" value={wantPlan && plan ? 'yes' : 'no'} onChange={(v) => setWantPlan(v === 'yes')} options={[{ value: 'yes', label: 'Use this plan' }, { value: 'no', label: "I'll build my own" }]} />
          </Card>
          <Button title="Accept and start" size="lg" icon="checkmark" onPress={finish} full={isPhone} loading={firstSyncPending} disabled={firstSyncPending || !!calorieError} />
          {firstSyncPending ? <Muted variant="small" accessibilityLiveRegion="polite">Waiting for your account to finish syncing, so existing data isn&apos;t overwritten…</Muted> : null}
        </Stack>
      )}

      {step > 0 ? (
        <Row style={{ marginTop: Space.md }}>
          <Button title="Back" kind="ghost" icon="arrow-back" onPress={back} />
          <View style={{ flex: 1 }} />
          {step === OPTIONAL_STEP ? <Button title="Skip" kind="ghost" onPress={next} /> : null}
          {step < STEPS.length - 1 ? <Button title="Continue" icon="arrow-forward" onPress={next} disabled={!canNext} /> : null}
        </Row>
      ) : null}
    </Screen>
  );
}
