import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Chip, Columns, Expandable, Field, KeyValue, Muted, NumberField, OptionCard, PageHeader, Row, Screen, Segmented, Sheet, Stack, Stepper, Text, Toggle } from '@/components/ui';
import { useStore, clearLocalData } from '@/store/AppStore';
import { AccountCard } from '@/components/AccountCard';
import { AiSettings } from '@/components/AiSettings';
import { IntegrationSettings } from '@/components/IntegrationSettings';
import { useAiEngine } from '@/hooks/useAiEngine';
import { useAct, useToast } from '@/components/Toast';
import { ageFromBirthYear, computeTargets, macrosFor } from '@/lib/nutrition/targets';
import { latestWeight } from '@/lib/selectors';
import { nowISO, WEEKDAY_SHORT } from '@/lib/dates';
import { displayWeight } from '@/lib/units';
import { emptyState } from '@/lib/state';
import { buildSampleState } from '@/lib/sampleData';
import { newId } from '@/lib/id';
import { permissionStatus, requestPermission } from '@/lib/notifications/deliver';
import { forgetPushToken } from '@/lib/notifications/push';
import { MAX_COACH_NOTIFICATIONS_PER_DAY, remainingToday } from '@/lib/notifications/policy';
import { signOut, supabase } from '@/lib/sync/supabase';
import { functionErrorMessage } from '@/lib/ai/provider';
import { deleteCloudData } from '@/lib/sync/sync';
import { csvExports, jsonExport } from '@/lib/export';
import { saveExportFile } from '@/lib/exportFile';
import { clearIntegrationConfig } from '@/lib/integrations/config';
import { formatRest, REST_MAX_SEC, REST_MIN_SEC, REST_STEP_SEC, sanitizeRestPrefs } from '@/lib/workouts/restTimer';
import type { BodyArea, DailyActivity, GoalPriority, NutritionTargets, Profile, Sex } from '@/lib/types';

const GOALS: { value: GoalPriority; label: string }[] = [
  { value: 'fat_loss', label: 'Lose fat' }, { value: 'muscle_gain', label: 'Build muscle' }, { value: 'strength', label: 'Get stronger' }, { value: 'maintenance', label: 'Maintain' },
];

export default function Settings() {
  return (
    <Screen size="medium">
      <PageHeader title="Settings" />
      <Columns>
        {[
          <Stack key="l" gap={Space.lg}>
            <GoalSection />
            <TargetsSection />
            <ProfileSection />
            <CoachSection />
            <RestSection />
            <AiSettings />
          </Stack>,
          <Stack key="r" gap={Space.lg}>
            <NotificationsSection />
            <IntegrationSettings />
            <AccountCard />
            <DeleteAccountSection />
            <PrivacySection />
            <AboutSection />
          </Stack>,
        ]}
      </Columns>
    </Screen>
  );
}

function GoalSection() {
  const { state } = useStore();
  const doAct = useAct();
  const [preview, setPreview] = useState<{ goal: GoalPriority; t: NutritionTargets } | null>(null);
  const [offerPlan, setOfferPlan] = useState(false);
  const p = state.profile!;
  const w = latestWeight(state)?.weightKg ?? p.startWeightKg;
  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Current priority</Text>
      <Row wrap gap={6}>
        {GOALS.map((g) => (
          <Chip key={g.value} label={g.label} selected={p.goal === g.value} onPress={() => g.value !== p.goal && setPreview({ goal: g.value, t: computeTargets({ ...p, goal: g.value }, w) })} />
        ))}
      </Row>
      <Muted variant="small">Changing priority recalculates your calorie and macro targets. You&apos;ll see the new numbers before anything changes.</Muted>
      <Sheet
        visible={!!preview}
        onClose={() => setPreview(null)}
        title="Change priority?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Keep current" kind="reject" style={{ flex: 1 }} onPress={() => setPreview(null)} />
            <Button title="Confirm change" kind="accept" icon="checkmark" style={{ flex: 1 }} onPress={() => { if (preview && doAct({ type: 'SET_GOAL', goal: preview.goal, targets: preview.t, now: nowISO(), confirmed: true })) { setPreview(null); setOfferPlan(true); } }} />
          </Row>
        }>
        {preview ? (
          <>
            <Badge kind="pending" label="Needs your confirmation" />
            <KeyValue k="Calories" v={`${state.targets!.calories.toLocaleString()} → ${preview.t.calories.toLocaleString()} kcal`} />
            <KeyValue k="Protein" v={`${state.targets!.proteinG} → ${preview.t.proteinG} g`} />
            <KeyValue k="Carbs" v={`${state.targets!.carbsG} → ${preview.t.carbsG} g`} />
            <KeyValue k="Fat" v={`${state.targets!.fatG} → ${preview.t.fatG} g`} />
            <Muted variant="small">Your workout plan isn&apos;t changed. Generate a new plan from Training if you want one tailored to the new priority.</Muted>
          </>
        ) : null}
      </Sheet>
      {offerPlan ? <Banner kind="info" title="Priority updated"><Button title="Update your plan" kind="secondary" size="sm" onPress={() => { setOfferPlan(false); router.push('/workouts?preview=1'); }} /></Banner> : null}
    </Card>
  );
}

function TargetsSection() {
  const { state } = useStore();
  const doAct = useAct();
  const t = state.targets!;
  const [edit, setEdit] = useState(false);
  const [cal, setCal] = useState<number | undefined>(t.calories);
  const [prot, setProt] = useState<number | undefined>(t.proteinG);
  const w = latestWeight(state)?.weightKg ?? state.profile!.startWeightKg;
  const [recalc, setRecalc] = useState<NutritionTargets | null>(null);

  const saveManual = () => {
    if (!cal || !prot) return;
    const m = macrosFor(cal, w, state.profile!.goal);
    const fatG = Math.round((cal * 0.27) / 9);
    const carbsG = Math.max(0, Math.round((cal - prot * 4 - fatG * 9) / 4));
    if (doAct({ type: 'SET_TARGETS', targets: { ...t, ...m, proteinG: Math.round(prot), carbsG, fatG, method: 'Set manually by you', updatedAt: nowISO() }, confirmed: true }, 'Targets updated')) setEdit(false);
  };

  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">Nutrition targets</Text>
      <Row wrap gap={Space.xl}>
        <Stack gap={0}><Text variant="numberSm">{t.calories.toLocaleString()}</Text><Muted variant="small">kcal</Muted></Stack>
        <Stack gap={0}><Text variant="numberSm" color={C.protein}>{t.proteinG} g</Text><Muted variant="small">protein</Muted></Stack>
        <Stack gap={0}><Text variant="numberSm" color={C.carbs}>{t.carbsG} g</Text><Muted variant="small">carbs</Muted></Stack>
        <Stack gap={0}><Text variant="numberSm" color={C.fat}>{t.fatG} g</Text><Muted variant="small">fat</Muted></Stack>
      </Row>
      <Expandable title="How this was set" icon="calculator-outline">
        <Muted variant="small">{t.method}</Muted>
        <Muted variant="small">Maintenance estimate {t.maintenance.toLocaleString()} kcal · assumes ~{t.baselineSteps.toLocaleString()} steps/day and {t.baselineTrainingKcal} kcal/day of planned training.</Muted>
        <Muted variant="small">Last changed {new Date(t.updatedAt).toLocaleDateString()}</Muted>
      </Expandable>
      <Row wrap gap={Space.sm}>
        <Button title="Edit manually" kind="secondary" size="sm" icon="create-outline" onPress={() => { setCal(t.calories); setProt(t.proteinG); setEdit(true); }} />
        <Button title="Recalculate from latest weight" kind="ghost" size="sm" icon="refresh" onPress={() => setRecalc(computeTargets(state.profile!, w))} />
      </Row>
      <Sheet visible={edit} onClose={() => setEdit(false)} title="Edit targets" footer={<Button title="Save targets" icon="checkmark" full onPress={saveManual} disabled={!cal || cal < 1000 || !prot} />}>
        <NumberField label="Daily calories" value={cal} onChange={setCal} suffix="kcal" error={cal !== undefined && cal < 1000 ? 'Below 1,000 kcal is not supported. Please talk to a professional.' : undefined} />
        <NumberField label="Protein" value={prot} onChange={setProt} suffix="g" />
        <Muted variant="small">Fat is set to ~27% of calories and carbs fill the rest.</Muted>
      </Sheet>
      <Sheet
        visible={!!recalc}
        onClose={() => setRecalc(null)}
        title="Recalculate targets?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="reject" style={{ flex: 1 }} onPress={() => setRecalc(null)} />
            <Button title="Use new targets" kind="accept" icon="checkmark" style={{ flex: 1 }} onPress={() => { if (recalc && doAct({ type: 'SET_TARGETS', targets: recalc, confirmed: true }, 'Targets updated')) setRecalc(null); }} />
          </Row>
        }>
        {recalc ? (
          <>
            <Muted>Based on {displayWeight(w, state.settings.units)}:</Muted>
            <KeyValue k="Calories" v={`${t.calories.toLocaleString()} → ${recalc.calories.toLocaleString()} kcal`} />
            <KeyValue k="Protein" v={`${t.proteinG} → ${recalc.proteinG} g`} />
            <Muted variant="small">This replaces any adjustments made from your progress so far.</Muted>
          </>
        ) : null}
      </Sheet>
    </Card>
  );
}

const AREAS: BodyArea[] = ['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip', 'ankle', 'neck'];

function ProfileSection() {
  const { state } = useStore();
  const doAct = useAct();
  const p = state.profile!;
  const [draft, setDraft] = useState<Profile | null>(null);
  const [offerPlan, setOfferPlan] = useState(false);
  const currentWeight = latestWeight(state)?.weightKg ?? p.startWeightKg;
  const previewTargets = draft ? computeTargets(draft, currentWeight) : null;
  const set = (patch: Partial<Profile>) => setDraft((value) => value ? { ...value, ...patch } : value);
  const valid = draft && ageFromBirthYear(draft.birthYear) >= 16 && ageFromBirthYear(draft.birthYear) <= 90 && draft.heightCm > 120 && draft.heightCm < 230 && draft.sessionMinutes >= 15 && draft.sessionMinutes <= 180;
  const saveBasics = () => {
    if (!draft || !valid || !previewTargets) return;
    const { birthYear, heightCm, sex, dailyActivity, dietPreferences, sessionMinutes } = draft;
    if (!doAct({ type: 'UPDATE_PROFILE', patch: { birthYear, heightCm, sex, dailyActivity, dietPreferences, sessionMinutes }, now: nowISO() })) return;
    doAct({ type: 'SET_TARGETS', targets: previewTargets, confirmed: true }, 'Profile and targets updated');
    setDraft(null); setOfferPlan(true);
  };
  const upd = (patch: Partial<Omit<Profile, 'goal' | 'createdAt'>>) => {
    const saved = doAct({ type: 'UPDATE_PROFILE', patch, now: nowISO() });
    if (saved && !('name' in patch)) setOfferPlan(true);
    return saved;
  };
  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Profile</Text>
      <Field label="Name" value={p.name === 'there' ? '' : p.name} onChangeText={(name) => upd({ name: name || 'there' })} />
      <Button title="Edit body & lifestyle" kind="secondary" size="sm" onPress={() => setDraft({ ...p, dietPreferences: [...p.dietPreferences] })} />
      <Muted variant="small">Age {ageFromBirthYear(p.birthYear)} · {p.heightCm} cm · {p.sessionMinutes} min sessions · {p.dailyActivity.replace('_', ' ')}</Muted>
      <Text variant="smallStrong">Units</Text>
      <Segmented label="Units" value={state.settings.units} onChange={(units) => doAct({ type: 'UPDATE_SETTINGS', patch: { units }, now: nowISO() })} options={[{ value: 'imperial', label: 'lb / ft' }, { value: 'metric', label: 'kg / cm' }]} />
      <Text variant="smallStrong">Training days</Text>
      <Row wrap gap={6}>
        {WEEKDAY_SHORT.map((d, i) => (
          <Chip key={d} label={d} selected={p.trainingDays.includes(i)} onPress={() => upd({ trainingDays: p.trainingDays.includes(i) ? p.trainingDays.filter((x) => x !== i) : [...p.trainingDays, i].sort() })} />
        ))}
      </Row>
      <Text variant="smallStrong">Equipment</Text>
      <Segmented label="Equipment" value={p.equipment} onChange={(equipment) => upd({ equipment })} options={[{ value: 'full_gym', label: 'Gym' }, { value: 'home_barbell', label: 'Home bar' }, { value: 'dumbbells', label: 'Dumbbells' }, { value: 'bodyweight', label: 'None' }]} />
      <Text variant="smallStrong">Experience</Text>
      <Segmented label="Experience" value={p.experience} onChange={(experience) => upd({ experience })} options={[{ value: 'beginner', label: 'New' }, { value: 'intermediate', label: '1–3 yrs' }, { value: 'advanced', label: '3+ yrs' }]} />
      <Text variant="smallStrong">Injuries / limitations</Text>
      <Row wrap gap={6}>
        {AREAS.map((a) => {
          const l = p.limitations.find((x) => x.area === a);
          return <Chip key={a} label={`${a.replace('_', ' ')}${l?.until ? ` (until ${l.until})` : ''}`} selected={!!l} onPress={() => upd({ limitations: l ? p.limitations.filter((x) => x.area !== a) : [...p.limitations, { area: a }] })} />;
        })}
      </Row>
      <Muted variant="small">Changes to schedule, equipment, experience and limitations apply the next time you generate a plan. Your current plan isn&apos;t changed automatically.</Muted>
      {offerPlan ? <Banner kind="info" title="Profile updated"><Button title="Update your plan" kind="secondary" size="sm" onPress={() => { setOfferPlan(false); router.push('/workouts?preview=1'); }} /></Banner> : null}
      <Sheet visible={!!draft} onClose={() => setDraft(null)} title="Edit body & lifestyle" footer={<Row gap={Space.sm}><Button title="Cancel" kind="secondary" onPress={() => setDraft(null)} /><Button title="Save profile & targets" kind="accept" disabled={!valid} onPress={saveBasics} /></Row>}>
        {draft ? <>
          <NumberField label="Age" value={ageFromBirthYear(draft.birthYear)} onChange={(age) => age && set({ birthYear: new Date().getFullYear() - age })} suffix="years" />
          <NumberField label="Height" value={draft.heightCm} onChange={(heightCm) => set({ heightCm: heightCm ?? 0 })} suffix="cm" />
          <Segmented<Sex> label="Sex" value={draft.sex} onChange={(sex) => set({ sex })} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'unspecified', label: 'Prefer not to say' }]} />
          <Segmented<DailyActivity> label="Daily activity" value={draft.dailyActivity} onChange={(dailyActivity) => set({ dailyActivity })} options={[{ value: 'mostly_sitting', label: 'Sitting' }, { value: 'on_feet', label: 'On my feet' }, { value: 'physical_job', label: 'Physical work' }]} />
          <NumberField label="Workout session length" value={draft.sessionMinutes} onChange={(sessionMinutes) => set({ sessionMinutes: sessionMinutes ?? 0 })} suffix="minutes" />
          <Text variant="smallStrong">Food preferences</Text>
          <Row wrap gap={6}>{[['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['pescatarian', 'Pescatarian'], ['dairy_free', 'Dairy-free'], ['gluten_free', 'Gluten-free'], ['halal', 'Halal'], ['no_pork', 'No pork'], ['low_carb', 'Lower carb']].map(([value, label]) => <Chip key={value} label={label} selected={draft.dietPreferences.includes(value)} onPress={() => set({ dietPreferences: draft.dietPreferences.includes(value) ? draft.dietPreferences.filter((item) => item !== value) : [...draft.dietPreferences, value] })} />)}</Row>
          {previewTargets ? <Card tone="pending" style={{ gap: Space.sm }}><Text variant="smallStrong">New daily targets</Text><KeyValue k="Calories" v={`${state.targets?.calories ?? '—'} → ${previewTargets.calories} kcal`} /><KeyValue k="Protein" v={`${state.targets?.proteinG ?? '—'} → ${previewTargets.proteinG} g`} /><KeyValue k="Carbs" v={`${state.targets?.carbsG ?? '—'} → ${previewTargets.carbsG} g`} /><KeyValue k="Fat" v={`${state.targets?.fatG ?? '—'} → ${previewTargets.fatG} g`} /></Card> : null}
          {!valid ? <Muted variant="small">Age must be 16–90, height 121–229 cm, and sessions 15–180 minutes.</Muted> : null}
        </> : null}
      </Sheet>
    </Card>
  );
}

function CoachSection() {
  const { state } = useStore();
  const doAct = useAct();
  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Coach</Text>
      <Text variant="smallStrong">Tone</Text>
      <OptionCard title="Supportive coach" body="Encouraging and explains the why." selected={state.settings.coachTone === 'supportive'} onPress={() => doAct({ type: 'UPDATE_SETTINGS', patch: { coachTone: 'supportive' }, now: nowISO() })} />
      <OptionCard title="Direct trainer" body="Short, to the point, no fluff." selected={state.settings.coachTone === 'direct'} onPress={() => doAct({ type: 'UPDATE_SETTINGS', patch: { coachTone: 'direct' }, now: nowISO() })} />
    </Card>
  );
}

function RestSection() {
  const { state } = useStore();
  const doAct = useAct();
  const rest = sanitizeRestPrefs(state.settings.rest);
  const set = (patch: Partial<typeof rest>) => doAct({ type: 'UPDATE_SETTINGS', patch: { rest: sanitizeRestPrefs({ ...rest, ...patch }) }, now: nowISO() });
  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">Rest timer</Text>
      <Muted variant="small">Starts after every logged set. Plan days with their own rest times use those instead.</Muted>
      <Row>
        <Stack gap={0} style={{ flex: 1 }}>
          <Text variant="bodyStrong">Compound lifts</Text>
          <Muted variant="small">Squat, bench, rows, presses</Muted>
        </Stack>
        <Stepper value={rest.compoundSec} onChange={(compoundSec) => set({ compoundSec })} step={REST_STEP_SEC} min={REST_MIN_SEC} max={REST_MAX_SEC} format={formatRest} />
      </Row>
      <Row>
        <Stack gap={0} style={{ flex: 1 }}>
          <Text variant="bodyStrong">Accessories</Text>
          <Muted variant="small">Curls, raises, isolation work</Muted>
        </Stack>
        <Stepper value={rest.accessorySec} onChange={(accessorySec) => set({ accessorySec })} step={REST_STEP_SEC} min={REST_MIN_SEC} max={REST_MAX_SEC} format={formatRest} />
      </Row>
    </Card>
  );
}

function NotificationsSection() {
  const { state, today } = useStore();
  const doAct = useAct();
  const toast = useToast();
  const n = state.settings.notifications;
  const [perm, setPerm] = useState<string>('undetermined');
  useEffect(() => {
    permissionStatus().then(setPerm);
  }, []);
  const set = (patch: Partial<typeof n>) => doAct({ type: 'UPDATE_SETTINGS', patch: { notifications: { ...n, ...patch } }, now: nowISO() });
  const enable = async (v: boolean) => {
    if (!v) return set({ enabled: false });
    const r = await requestPermission();
    setPerm(r);
    if (r === 'granted') set({ enabled: true });
    else if (r === 'unsupported') {
      set({ enabled: true });
      toast('System notifications are not available here. Check-ins will appear in the app only.', 'info');
    } else toast('Notification permission was denied. You can allow it in your device or browser settings.', 'error');
  };
  const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const todays = state.notifications.filter((r) => r.date === today && !r.deleted);
  return (
    <Card style={{ gap: Space.sm }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>Coaching notifications</Text>
        <Badge kind="simulated" label="Local delivery only" />
      </Row>
      <Toggle label="Allow coaching notifications" description={`At most ${MAX_COACH_NOTIFICATIONS_PER_DAY} per day across all your devices, and only when something is worth your attention.`} value={n.enabled} onChange={enable} />
      {perm === 'denied' ? <Banner kind="warning">Notifications are blocked for this app/browser. Check-ins will still appear in the app.</Banner> : null}
      {n.enabled ? (
        <>
          <Toggle label="Nutrition" description="e.g. an activity bonus or a target adjustment" value={n.categories.nutrition} onChange={(v) => set({ categories: { ...n.categories, nutrition: v } })} />
          <Toggle label="Workouts" description="e.g. new weight targets after a session" value={n.categories.workouts} onChange={(v) => set({ categories: { ...n.categories, workouts: v } })} />
          <Toggle label="Check-ins" description="e.g. protein running low, missed sessions" value={n.categories.checkins} onChange={(v) => set({ categories: { ...n.categories, checkins: v } })} />
          <QuietHours start={n.quietStart} end={n.quietEnd} onSave={(quietStart, quietEnd) => validTime(quietStart) && validTime(quietEnd) && set({ quietStart, quietEnd })} />
          <Muted variant="small">Today: {todays.length} sent · {remainingToday(state.notifications, today)} remaining</Muted>
          {todays.map((r) => (
            <Muted key={r.id} variant="small">• {new Date(r.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: {r.body} ({r.delivered === 'system' ? 'notification' : 'in-app'})</Muted>
          ))}
        </>
      ) : null}
    </Card>
  );
}

function QuietHours({ start, end, onSave }: { start: string; end: string; onSave: (s: string, e: string) => void }) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const ok = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  return (
    <Stack gap={6}>
      <Text variant="smallStrong">Quiet hours (no notifications)</Text>
      <Row gap={Space.sm} align="flex-start">
        <Field value={s} onChangeText={setS} onBlur={() => ok(s) && ok(e) && onSave(s, e)} placeholder="21:30" style={{ width: 100 }} accessibilityLabel="Quiet hours start (HH:MM)" error={ok(s) ? undefined : 'HH:MM'} />
        <Muted style={{ paddingTop: 12 }}>to</Muted>
        <Field value={e} onChangeText={setE} onBlur={() => ok(s) && ok(e) && onSave(s, e)} placeholder="07:30" style={{ width: 100 }} accessibilityLabel="Quiet hours end (HH:MM)" error={ok(e) ? undefined : 'HH:MM'} />
      </Row>
    </Stack>
  );
}


function PrivacySection() {
  const { state, sync } = useStore();
  const doAct = useAct();
  const toast = useToast();
  const [confirm, setConfirm] = useState<'local' | 'cloud' | null>(null);

  const exportData = async (format: 'json' | 'csv') => {
    try {
      const files = format === 'json' ? [jsonExport(state, nowISO())] : csvExports(state, nowISO());
      for (const f of files) await saveExportFile(f);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    }
  };

  const wipe = async () => {
    try {
      if (confirm === 'cloud' && sync.session) await deleteCloudData(sync.session.user.id);
      // sign out before clearing, so background sync can't re-upload or re-download meanwhile
      if (sync.session) await signOut();
      await clearLocalData(sync.session?.user.id);
      if (!sync.configured) {
        await clearIntegrationConfig();
      }
      doAct({ type: 'REPLACE_STATE', state: emptyState(newId(), nowISO()) });
      setConfirm(null);
      router.replace('/onboarding');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Deletion failed', 'error');
    }
  };

  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">Privacy &amp; your data</Text>
      <Muted variant="small">Your food log, photos, body weight, workouts and chat are private to you. With an account, cloud data is protected so only your signed-in account can read it. AI requests send a short context summary or reduced photo to the selected provider.</Muted>
      <Row wrap gap={Space.sm}>
        <Button title="Export my data" kind="secondary" size="sm" icon="download-outline" onPress={() => exportData('json')} />
        <Button title="Export food & weights (CSV)" kind="secondary" size="sm" icon="document-text-outline" onPress={() => exportData('csv')} />
        <Button title="Delete data on this device" kind="danger" size="sm" onPress={() => setConfirm('local')} />
        {sync.session ? <Button title="Delete my cloud data" kind="danger" size="sm" onPress={() => setConfirm('cloud')} /> : null}
      </Row>
      <Sheet
        visible={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'cloud' ? 'Delete all cloud data?' : 'Delete all data on this device?'}
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setConfirm(null)} />
            <Button title="Delete permanently" kind="danger" style={{ flex: 1 }} onPress={wipe} />
          </Row>
        }>
        <Muted>
          {confirm === 'cloud'
            ? 'This permanently removes your synced records and food photos from the server, then clears this device and signs you out. Other signed-in devices will keep only their local copy until they are cleared.'
            : sync.session
              ? 'This clears this device and signs you out. Your cloud copy stays and downloads again when you sign back in.'
              : 'This permanently removes your profile, logs and history from this device. Consider exporting first.'}
        </Muted>
      </Sheet>
    </Card>
  );
}

/** Permanently deletes the signed-in account (photos, synced rows, login) on the server. */
function DeleteAccountSection() {
  const { sync } = useStore();
  const doAct = useAct();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  if (!sync.session) return null;
  const userId = sync.session.user.id;

  const deleteAccount = async () => {
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { error } = await sb.functions.invoke('delete-account', { body: {} });
      if (error) throw new Error(await functionErrorMessage(error, 'Account deletion failed.'));
      // The server session is gone; sign out locally, then clear this account's cache.
      forgetPushToken(); // the server rows went with the account
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      await clearLocalData(userId);
      doAct({ type: 'REPLACE_STATE', state: emptyState(newId(), nowISO()) });
      setConfirm(false);
      toast('Your account was deleted.');
      router.replace('/onboarding');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Account deletion failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">Delete account</Text>
      <Muted variant="small">Permanently deletes your account, your synced records and your food photos from the server. This cannot be undone. Export your data first if you want a copy.</Muted>
      <Row>
        <Button title="Delete account" kind="danger" size="sm" icon="trash-outline" onPress={() => { setTyped(''); setConfirm(true); }} />
      </Row>
      <Sheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Delete your account?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setConfirm(false)} />
            <Button title="Delete forever" kind="danger" style={{ flex: 1 }} loading={busy} disabled={typed.trim().toUpperCase() !== 'DELETE'} onPress={deleteAccount} />
          </Row>
        }>
        <Muted>Your login, synced data and photos for {sync.session.user.email} are removed for good, and you are signed out on this device. Type DELETE to confirm.</Muted>
        <Field value={typed} onChangeText={setTyped} autoCapitalize="characters" placeholder="DELETE" accessibilityLabel="Type DELETE to confirm" />
      </Sheet>
    </Card>
  );
}

function AboutSection() {
  const { state, today, sync } = useStore();
  const imageEngine = useAiEngine('food');
  const chatEngine = useAiEngine('chat');
  const doAct = useAct();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">About FitCoach</Text>
      <Row wrap gap={6}>
        {__DEV__ ? <Badge kind={imageEngine === 'simulated' ? 'simulated' : 'info'} label={imageEngine === 'server' ? 'Server images' : 'Built-in image estimates'} /> : null}
        {__DEV__ ? <Badge kind={chatEngine === 'simulated' ? 'simulated' : 'info'} label={chatEngine === 'server' ? 'Server chat' : 'Built-in chat'} /> : null}
        {__DEV__ && !sync.configured ? <Badge kind="simulated" label="Simulated health sync" /> : null}
        <Badge kind="info" label="USDA lookup is live" />
      </Row>
      <Row wrap gap={Space.sm}>
        {__DEV__ ? <Button title="UI states gallery" kind="secondary" size="sm" icon="color-palette-outline" onPress={() => router.push('/states')} /> : null}
        {!sync.configured ? <Button title="Load sample data" kind="ghost" size="sm" icon="flask-outline" onPress={() => setConfirm(true)} /> : null}
      </Row>
      <Muted variant="small">FitCoach v1.0.0 · Consult a professional for injuries, medical conditions, or eating-disorder concerns.</Muted>
      <Sheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Replace your data with sample data?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setConfirm(false)} />
            <Button title="Load sample data" kind="danger" style={{ flex: 1 }} onPress={() => { doAct({ type: 'REPLACE_STATE', state: buildSampleState(state.deviceId, today) }, 'Sample data loaded'); setConfirm(false); router.replace('/'); }} />
          </Row>
        }>
        <Muted>This replaces everything on this device with 3 weeks of realistic example data for review.</Muted>
      </Sheet>
    </Card>
  );
}
