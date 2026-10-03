import React, { useEffect, useState } from 'react';
import { Platform, Share } from 'react-native';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Chip, Columns, Expandable, Field, IconButton, KeyValue, Muted, NumberField, OptionCard, PageHeader, Row, Screen, Segmented, Sheet, Stack, Text, Toggle } from '@/components/ui';
import { useStore, clearLocalData } from '@/store/AppStore';
import { AccountCard } from '@/components/AccountCard';
import { AiSettings } from '@/components/AiSettings';
import { useAiEngine } from '@/hooks/useAiEngine';
import { useAct, useToast } from '@/components/Toast';
import { computeTargets, macrosFor } from '@/lib/nutrition/targets';
import { latestWeight } from '@/lib/selectors';
import { nowISO, WEEKDAY_SHORT } from '@/lib/dates';
import { displayWeight } from '@/lib/units';
import { emptyState } from '@/lib/state';
import { buildSampleState } from '@/lib/sampleData';
import { newId } from '@/lib/id';
import { permissionStatus, requestPermission } from '@/lib/notifications/deliver';
import { MAX_COACH_NOTIFICATIONS_PER_DAY, remainingToday } from '@/lib/notifications/policy';
import { supabase } from '@/lib/sync/supabase';
import { deleteCloudData } from '@/lib/sync/sync';
import type { BodyArea, GoalPriority, NutritionTargets, Profile } from '@/lib/types';

const GOALS: { value: GoalPriority; label: string }[] = [
  { value: 'fat_loss', label: 'Lose fat' }, { value: 'muscle_gain', label: 'Build muscle' }, { value: 'strength', label: 'Get stronger' }, { value: 'maintenance', label: 'Maintain' },
];

export default function Settings() {
  return (
    <Screen maxWidth={1080}>
      <PageHeader title="Settings" right={<IconButton icon="close" label="Close settings" onPress={() => router.back()} />} />
      <Columns>
        {[
          <Stack key="l" gap={Space.lg}>
            <GoalSection />
            <TargetsSection />
            <ProfileSection />
            <CoachSection />
            <AiSettings />
          </Stack>,
          <Stack key="r" gap={Space.lg}>
            <NotificationsSection />
            <AccountCard />
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
            <Button title="Confirm change" kind="accept" icon="checkmark" style={{ flex: 1 }} onPress={() => { if (preview && doAct({ type: 'SET_GOAL', goal: preview.goal, targets: preview.t, now: nowISO(), confirmed: true }, 'Priority updated')) setPreview(null); }} />
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
        <Stack gap={0}><Text variant="h2">{t.calories.toLocaleString()}</Text><Muted variant="small">kcal</Muted></Stack>
        <Stack gap={0}><Text variant="h2" color={C.protein}>{t.proteinG} g</Text><Muted variant="small">protein</Muted></Stack>
        <Stack gap={0}><Text variant="h2" color={C.carbs}>{t.carbsG} g</Text><Muted variant="small">carbs</Muted></Stack>
        <Stack gap={0}><Text variant="h2" color={C.fat}>{t.fatG} g</Text><Muted variant="small">fat</Muted></Stack>
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
  const upd = (patch: Partial<Omit<Profile, 'goal' | 'createdAt'>>) => doAct({ type: 'UPDATE_PROFILE', patch, now: nowISO() });
  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Profile</Text>
      <Field label="Name" value={p.name === 'there' ? '' : p.name} onChangeText={(name) => upd({ name: name || 'there' })} />
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

  const exportData = async () => {
    const json = JSON.stringify({ exportedAt: nowISO(), app: 'FitCoach', data: state }, null, 2);
    if (Platform.OS === 'web') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitcoach-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      await Share.share({ message: json, title: 'FitCoach data export' });
    }
  };

  const wipe = async () => {
    try {
      if (confirm === 'cloud' && sync.session) await deleteCloudData(sync.session.user.id);
      // sign out before clearing, so background sync can't re-upload or re-download meanwhile
      if (sync.session) await supabase()?.auth.signOut();
      await clearLocalData();
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
      <Muted variant="small">Your food log, photos, body weight, workouts and chat are private to you. With an account, cloud data is protected so only your signed-in account can read it. Data is never sold. AI requests send only what&apos;s needed for that request.</Muted>
      <Row wrap gap={Space.sm}>
        <Button title="Export my data" kind="secondary" size="sm" icon="download-outline" onPress={exportData} />
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

function AboutSection() {
  const { state, today } = useStore();
  const engine = useAiEngine();
  const doAct = useAct();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">Prototype &amp; design review</Text>
      <Row wrap gap={6}>
        {engine === 'simulated' ? <Badge kind="simulated" label="Built-in AI answers" /> : <Badge kind="info" label={engine === 'nvidia' ? 'NVIDIA AI' : 'Server AI'} />}
        <Badge kind="simulated" label="Simulated health sync" />
        <Badge kind="info" label="USDA lookup is live" />
      </Row>
      <Row wrap gap={Space.sm}>
        <Button title="UI states gallery" kind="secondary" size="sm" icon="color-palette-outline" onPress={() => router.push('/states')} />
        <Button title="Load sample data" kind="ghost" size="sm" icon="flask-outline" onPress={() => setConfirm(true)} />
      </Row>
      <Muted variant="small">FitCoach v1.0.0 (prototype) · Not medical advice. Consult a professional for injuries, medical conditions, or eating-disorder concerns.</Muted>
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
