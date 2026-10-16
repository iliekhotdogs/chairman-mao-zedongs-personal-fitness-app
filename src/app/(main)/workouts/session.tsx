import React, { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/nav';

import { C, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Chip, EmptyState, Expandable, Field, IconButton, Menu, Muted, NumberField, PageHeader, Row, Screen, Segmented, Sheet, Stack, Stepper, Text, Ionicons, Columns } from '@/components/ui';
import { ProposalCard } from '@/components/coaching';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { useSpeech } from '@/hooks/useSpeech';
import { useRestTimer, type RestTimerControls } from '@/hooks/useRestTimer';
import { RestTimerCard } from '@/components/RestTimer';
import { defaultRestSec } from '@/lib/workouts/restTimer';
import { activeSession, live, workoutForDay } from '@/lib/selectors';
import { EXERCISES, exerciseName, EXERCISE_BY_ID, formatPrescription } from '@/lib/workouts/exercises';
import { historyFor, recommendNext } from '@/lib/workouts/progression';
import { lastSessionSet } from '@/lib/workouts/sessionStats';
import { parseSetUtterance, type ParsedSet } from '@/lib/workouts/voiceParser';
import { progressionProposal } from '@/lib/coaching/adaptive';
import { newId } from '@/lib/id';
import { checkSet, jumpWarning, prefillReps, MAX_SET_WEIGHT_KG, MAX_REPS } from '@/lib/inputRules';
import { RuleViolation } from '@/lib/reducer';
import { formatDateLabel, formatTime, nowISO } from '@/lib/dates';
import { displayWeight, toKg, weightUnit, weightValue } from '@/lib/units';
import type { LoggedSet, PlannedExercise, WorkoutDay, WorkoutSession } from '@/lib/types';
import type { AppState } from '@/lib/state';

// Hidden to keep the set row to one primary action; the weight field accepts typed values.
const SHOW_WEIGHT_NUDGE = false;

export default function SessionScreen() {
  const { state } = useStore();
  const { id, dayId } = useLocalSearchParams<{ id?: string; dayId?: string }>();
  const viewing = id ? live(state.sessions).find((s) => s.id === id) : undefined;
  const active = activeSession(state);
  const session = viewing ?? active;

  if (id && !viewing) {
    return (
      <Screen size="narrow">
        <EmptyState icon="search-outline" title="Workout not found" body="It may have been deleted on another device." action={<Button title="Back to training" onPress={() => router.replace('/workouts')} />} />
      </Screen>
    );
  }
  if (!session) return <StartView preferredDayId={dayId} />;
  return <SessionView session={session} />;
}

function plannedDayFor(state: AppState, s: WorkoutSession): WorkoutDay | undefined {
  // an approved one-day version (e.g. 20-minute) wins over the full plan day
  const override = live(state.workoutOverrides).find((o) => o.date === s.date && o.day.name === s.name)?.day;
  return override ?? state.plan?.days.find((d) => d.id === s.dayId);
}

function StartView({ preferredDayId }: { preferredDayId?: string }) {
  const { state, today } = useStore();
  const doAct = useAct();
  const { day: todays, overridden } = workoutForDay(state, today);
  const preferred = state.plan?.days.find((d) => d.id === preferredDayId);
  const first = preferred ?? todays;

  const start = (day?: WorkoutDay, fromOverride = false) => {
    const now = nowISO();
    const session: WorkoutSession = {
      id: newId(),
      date: today,
      // one-day variants stay linked to their plan day so progression still works
      planId: day && (!fromOverride || state.plan?.days.some((d) => d.id === day.sourceDayId)) ? state.plan?.id : undefined,
      dayId: day ? (fromOverride ? day.sourceDayId : day.id) : undefined,
      name: day?.name ?? 'Freestyle workout',
      startedAt: now,
      sets: [],
      updatedAt: now,
    };
    doAct({ type: 'START_SESSION', session });
  };

  return (
    <Screen size="narrow">
      <PageHeader title="Start a workout" subtitle={formatDateLabel(today, today)} right={<Row gap={Space.sm}><Button title="Back" kind="ghost" onPress={() => goBack('/workouts')} /><Menu title="Other options" items={[{ label: 'Freestyle workout (no plan)', icon: 'add', onPress: () => start(undefined) }]} /></Row>} />
      {first ? (
        <Card tone={overridden && !preferred ? 'saved' : 'default'} style={{ gap: Space.sm }}>
          <Row wrap gap={6}>
            <Badge kind="neutral" label={preferred ? 'Selected' : 'Scheduled today'} icon="calendar-outline" />
            {overridden && !preferred ? <Badge kind="saved" label="Adjusted for today" /> : null}
          </Row>
          <Text variant="h2">{first.name}</Text>
          {first.exercises.map((e, i) => (
            <Muted key={i} variant="small">
              {exerciseName(e.exerciseId)} · {formatPrescription(e)}
            </Muted>
          ))}
          <Button title="Start" size="lg" icon="play" onPress={() => start(first, overridden && !preferred)} />
        </Card>
      ) : (
        <Card tone="muted">
          <Text variant="bodyStrong">Rest day</Text>
          <Muted>Nothing is scheduled today. You can still train with a plan day or log a freestyle workout.</Muted>
        </Card>
      )}
      {state.plan ? (
        <Expandable title="Other days in your plan">
          {state.plan.days
            .filter((d) => d.id !== first?.id)
            .map((d) => (
              <Card key={d.id} style={{ padding: Space.md }}>
                <Row>
                  <Stack gap={0} style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{d.name}</Text>
                    <Muted variant="small">{d.focus}</Muted>
                  </Stack>
                  <Button title="Start" kind="secondary" size="sm" onPress={() => start(d)} />
                </Row>
              </Card>
            ))}
        </Expandable>
      ) : null}
    </Screen>
  );
}

function SessionView({ session }: { session: WorkoutSession }) {
  const { state } = useStore();
  const doAct = useAct();
  const units = state.settings.units;
  const finished = Boolean(session.finishedAt);
  const planned = plannedDayFor(state, session);
  const [extra, setExtra] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [effort, setEffort] = useState<number | undefined>();
  const [pain, setPain] = useState(false);
  const [painNote, setPainNote] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [focusEx, setFocusEx] = useState<string | undefined>();
  const rest = useRestTimer();
  const startRestAfter = (exerciseId: string) => {
    if (finished) return;
    rest.start(defaultRestSec(EXERCISE_BY_ID[exerciseId], planned?.exercises.find((e) => e.exerciseId === exerciseId), state.settings.rest), exerciseId);
  };

  // The React Compiler memoizes this; a manual useMemo can't be preserved here.
  const exerciseIds = [...(planned?.exercises.map((e) => e.exerciseId) ?? [])];
  for (const s of session.sets) if (!exerciseIds.includes(s.exerciseId)) exerciseIds.push(s.exerciseId);
  for (const e of extra) if (!exerciseIds.includes(e)) exerciseIds.push(e);

  const progression = state.proposals.find((p) => p.dedupeKey === `progression-${session.id}`);
  const currentEx = focusEx ?? exerciseIds.find((id) => {
    const pe = planned?.exercises.find((e) => e.exerciseId === id);
    return session.sets.filter((s) => s.exerciseId === id).length < (pe?.sets ?? 1);
  }) ?? exerciseIds[0];

  // After a set: start rest; once the planned sets are done, move focus to the next unfinished exercise.
  const afterLog = (exId: string, workingCount: number) => {
    startRestAfter(exId);
    const pe = planned?.exercises.find((e) => e.exerciseId === exId);
    if (!pe || workingCount < pe.sets) return;
    const i = exerciseIds.indexOf(exId);
    const order = [...exerciseIds.slice(i + 1), ...exerciseIds.slice(0, i)];
    const next = order.find((id) => {
      const p = planned?.exercises.find((e) => e.exerciseId === id);
      return p && session.sets.filter((x) => x.exerciseId === id && !x.warmup).length < p.sets;
    });
    if (next) setFocusEx(next);
  };

  const finish = () => {
    const now = nowISO();
    if (!doAct({ type: 'FINISH_SESSION', sessionId: session.id, now, effort, pain, painNote: painNote.trim() || undefined }, 'Workout saved')) return;
    rest.skip();
    const completed = { ...session, finishedAt: now, effort, pain, painNote: painNote.trim() || undefined };
    const after: AppState = { ...state, sessions: state.sessions.map((s) => (s.id === session.id ? completed : s)) };
    const p = progressionProposal(after, completed);
    if (p) doAct({ type: 'ADD_PROPOSALS', proposals: [p] });
    setConfirmFinish(false);
    router.replace({ pathname: '/workouts/session', params: { id: session.id } });
  };

  const totalSets = session.sets.length;
  const volume = session.sets.reduce((v, s) => (s.warmup ? v : v + s.weightKg * s.reps), 0);

  return (
    <Screen size="medium">
      <PageHeader
        title={session.name}
        subtitle={finished ? `${formatDateLabel(session.date)} · ${totalSets} sets · ${displayWeight(volume, units, 0)} volume` : `Started ${formatTime(session.startedAt)} · ${totalSets} sets logged`}
        right={
          <Row gap={Space.sm}>
            {finished ? <Button title="Done" kind="ghost" onPress={() => router.replace('/workouts')} /> : <Button title="Finish" icon="flag" onPress={() => setConfirmFinish(true)} />}
            <Menu title="Workout options" items={[{ label: finished ? 'Delete workout' : 'Discard workout', icon: 'trash-outline', danger: true, onPress: () => setConfirmDiscard(true) }]} />
          </Row>
        }
      />
      {finished ? <Banner kind="success" title="Workout saved">You can still correct sets below.</Banner> : null}
      {progression ? <ProposalCard proposal={progression} /> : null}

      <Columns ratio={[3, 2]}>
        {[
          <Stack key="ex" gap={Space.md}>
            {exerciseIds.length === 0 ? <EmptyState icon="barbell-outline" title="No exercises yet" body="Add an exercise, or log a set by voice or text." /> : null}
            {exerciseIds.map((exId) => (
              <ExerciseBlock key={exId} session={session} exerciseId={exId} planned={planned?.exercises.find((e) => e.exerciseId === exId)} highlighted={!finished && exId === currentEx} onFocus={() => setFocusEx(exId)} onLogged={(n) => afterLog(exId, n)} rest={!finished && rest.timer?.exerciseId === exId ? rest : undefined} />
            ))}
            <Button title="Add exercise" kind="secondary" icon="add" onPress={() => setPickerOpen(true)} />
          </Stack>,
          <Stack key="voice" gap={Space.md}>
            <Expandable title="More" icon="ellipsis-horizontal">
              <VoiceLogger session={session} currentExerciseId={currentEx} onLogged={startRestAfter} />
              {!finished ? (
                <Card style={{ gap: Space.sm }}>
                  <Button title={pain ? 'Pain during workout: yes' : 'Pain during workout'} kind={pain ? 'danger' : 'secondary'} onPress={() => setPain(!pain)} />
                  {pain ? <Field label="Where or when did it hurt? (optional)" value={painNote} onChangeText={setPainNote} /> : null}
                  {pain ? <Banner kind="warning">Skip movements that hurt. No automatic progression will be suggested from this session.</Banner> : null}
                </Card>
              ) : null}
            </Expandable>
          </Stack>,
        ]}
      </Columns>

      <ExercisePicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(exId) => { setExtra([...extra, exId]); setFocusEx(exId); setPickerOpen(false); }} />

      <Sheet
        visible={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title="Finish workout?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Keep going" kind="secondary" onPress={() => setConfirmFinish(false)} style={{ flex: 1 }} />
            <Button title="Finish & save" icon="checkmark" onPress={finish} style={{ flex: 1 }} disabled={totalSets === 0} />
          </Row>
        }>
        {totalSets === 0 ? <Banner kind="warning">Log at least one set before finishing, or discard this workout.</Banner> : <Muted>{`${totalSets} sets logged. The coach will suggest next-session targets, and you choose whether to apply them.`}</Muted>}
        <Text variant="smallStrong">Effort (1–10, optional)</Text>
        <Row wrap gap={6}>{Array.from({ length: 10 }, (_, i) => i + 1).map((value) => <Chip key={value} label={String(value)} selected={effort === value} onPress={() => setEffort(effort === value ? undefined : value)} />)}</Row>
        <Segmented label="Pain during workout" value={pain ? 'yes' : 'no'} onChange={(value) => setPain(value === 'yes')} options={[{ value: 'no', label: 'No pain' }, { value: 'yes', label: 'Pain' }]} />
        {pain ? <Field label="Where and what did you feel?" value={painNote} onChangeText={setPainNote} placeholder="Describe the pain" /> : null}
        {pain ? <Banner kind="warning">The coach will not suggest a heavier workout when pain is reported.</Banner> : null}
      </Sheet>
      <Sheet
        visible={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={finished ? 'Delete this workout?' : 'Discard this workout?'}
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" onPress={() => setConfirmDiscard(false)} style={{ flex: 1 }} />
            <Button
              title={finished ? 'Delete' : 'Discard'}
              kind="danger"
              style={{ flex: 1 }}
              onPress={() => {
                doAct({ type: finished ? 'DELETE_SESSION' : 'DISCARD_SESSION', sessionId: session.id, now: nowISO() }, finished ? 'Workout deleted' : 'Workout discarded');
                setConfirmDiscard(false);
                router.replace('/workouts');
              }}
            />
          </Row>
        }>
        <Muted>All {totalSets} logged sets will be removed{finished ? ' from all your devices' : ''}.</Muted>
      </Sheet>
    </Screen>
  );
}

function ExerciseBlock({ session, exerciseId, planned, highlighted, onFocus, onLogged, rest }: { session: WorkoutSession; exerciseId: string; planned?: PlannedExercise; highlighted: boolean; onFocus: () => void; onLogged: (workingSets: number) => void; rest?: RestTimerControls }) {
  const { state, act } = useStore();
  const doAct = useAct();
  const units = state.settings.units;
  const ex = EXERCISE_BY_ID[exerciseId];
  const sets = session.sets.filter((s) => s.exerciseId === exerciseId);
  const workingCount = sets.filter((s) => !s.warmup).length;
  const finished = Boolean(session.finishedAt);
  // during a workout: advice for this session; after finishing: advice for next time
  const history = finished ? live(state.sessions) : live(state.sessions).filter((s) => s.id !== session.id);
  const rec = planned ? recommendNext(planned, history, units) : undefined;
  const last = sets[sets.length - 1];
  const bodyweight = ex?.loadType === 'bodyweight';
  const timed = Boolean(ex?.timed);
  const [weight, setWeight] = useState<number | undefined>(last ? weightValue(last.weightKg, units) : rec?.weightKg !== undefined ? weightValue(rec.weightKg, units) : bodyweight ? 0 : undefined);
  const [reps, setReps] = useState<number>(prefillReps({ lastReps: last?.reps, repMin: rec?.repMin ?? planned?.repMin }));
  const [editing, setEditing] = useState<LoggedSet | null>(null);
  const [rpe, setRpe] = useState<number | undefined>();
  const step = units === 'imperial' ? 5 : 2.5;

  const [msg, setMsg] = useState<string | undefined>();
  const [undoId, setUndoId] = useState<string | undefined>();
  const [ackJump, setAckJump] = useState<number | undefined>();
  const lastTap = useRef(0);
  const maxWeight = weightValue(MAX_SET_WEIGHT_KG, units);
  const prev = finished ? undefined : lastSessionSet(exerciseId, history, workingCount);
  const lastTopKg = Math.max(0, ...(historyFor(exerciseId, history)[0]?.sets.map((s) => s.weightKg) ?? []));

  const log = () => {
    if (weight === undefined) return;
    // guard against double taps (400 ms)
    if (Date.now() - lastTap.current < 400) return;
    lastTap.current = Date.now();
    const weightKg = toKg(weight, units);
    const bad = checkSet({ weightKg, reps });
    if (bad) return setMsg(bad);
    const jump = jumpWarning(weightKg, lastTopKg);
    if (jump && ackJump !== weight) {
      setAckJump(weight);
      return setMsg(jump);
    }
    const now = nowISO();
    const id = newId();
    try {
      act({ type: 'ADD_SETS', sessionId: session.id, now, sets: [{ id, exerciseId, weightKg, reps, rpe, via: 'manual', loggedAt: now }] });
    } catch (e) {
      return setMsg(e instanceof RuleViolation ? e.message : 'Could not log that set. Please try again.');
    }
    setMsg(undefined);
    setUndoId(id);
    setRpe(undefined);
    onFocus();
    onLogged(workingCount + 1);
  };

  return (
    <Card style={{ gap: Space.sm, borderColor: highlighted ? C.primary : C.border, borderWidth: highlighted ? 1.5 : 1 }}>
      <Row>
        <Stack gap={0} style={{ flex: 1 }}>
          <Text variant="h3">{exerciseName(exerciseId)}</Text>
          {planned ? (
            <Muted variant="small">
              Plan: {formatPrescription(planned, ' × ')} · rest {Math.round(planned.restSec / 60 * 10) / 10} min
              {planned.note ? ` · ${planned.note}` : ''}
            </Muted>
          ) : (
            <Muted variant="small">Added to this session</Muted>
          )}
        </Stack>
        <Badge kind={workingCount >= (planned?.sets ?? 1) ? 'saved' : 'neutral'} label={`${workingCount}/${planned?.sets ?? '–'} sets`} icon={null} />
      </Row>
      {rec ? (
        <Row align="flex-start" gap={6}>
          <Badge kind="suggestion" label={finished ? 'Next time' : 'Suggested'} />
          <Muted variant="small" style={{ flex: 1 }}>
            {rec.weightKg !== undefined && !bodyweight ? `${displayWeight(rec.weightKg, units)} × ${rec.repMin}–${rec.repMax}. ` : ''}
            {rec.reason}
          </Muted>
        </Row>
      ) : null}
      {sets.map((s, i) => (
        <Row key={s.id} style={{ paddingVertical: 2 }}>
          <Text variant="small" color={C.textSecondary} style={{ width: 44 }}>{s.warmup ? 'Warm' : `Set ${i + 1}`}</Text>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {bodyweight ? (s.weightKg === 0 ? 'Bodyweight' : `Bodyweight + ${displayWeight(s.weightKg, units)}`) : displayWeight(s.weightKg, units)} × {s.reps}{timed ? ' s' : ''}
            {s.rpe ? ` · RPE ${s.rpe}` : ''}
          </Text>
          {s.via === 'voice' ? <Ionicons name="mic-outline" size={14} color={C.textMuted} accessibilityLabel="Logged by voice" /> : null}
          <IconButton icon={s.warmup ? 'flame' : 'flame-outline'} label={s.warmup ? `Set ${i + 1} is a warm-up, tap to count it` : `Mark set ${i + 1} as warm-up`} size={18} color={s.warmup ? C.warning : C.textSecondary} onPress={() => doAct({ type: 'UPDATE_SET', sessionId: session.id, set: { ...s, warmup: !s.warmup }, now: nowISO() })} />
          <IconButton icon="create-outline" label={`Edit set ${i + 1}`} size={18} color={C.textSecondary} onPress={() => setEditing(s)} />
          <IconButton icon="close" label={`Delete set ${i + 1}`} size={18} color={C.danger} onPress={() => doAct({ type: 'DELETE_SET', sessionId: session.id, setId: s.id, now: nowISO() })} />
        </Row>
      ))}
      {prev ? (
        <Row gap={Space.sm}>
          <Muted variant="small" style={{ flex: 1 }}>Last session, set {workingCount + 1}: {bodyweight && prev.weightKg === 0 ? 'bodyweight' : displayWeight(prev.weightKg, units)} × {prev.reps}{prev.rpe ? ` @ RPE ${prev.rpe}` : ''}</Muted>
          <Button title="Same as last" kind="ghost" size="sm" onPress={() => { setWeight(weightValue(prev.weightKg, units)); setReps(prev.reps); setAckJump(undefined); setMsg(undefined); }} />
        </Row>
      ) : null}
      <Row wrap gap={Space.md} style={{ marginTop: 4 }}>
        <NumberField label={`${bodyweight ? 'Added weight' : 'Weight'} (${weightUnit(units)})`} value={weight} onChange={(v) => { setWeight(v); setAckJump(undefined); setMsg(undefined); }} min={0} max={maxWeight} style={{ width: 130 }} hint={bodyweight ? '0 = bodyweight only' : undefined} />
        <Stack gap={6}>
          <Text variant="smallStrong">{timed ? 'Seconds' : 'Reps'}</Text>
          <Stepper value={reps} onChange={setReps} min={1} max={timed ? MAX_REPS : 100} step={timed ? 5 : 1} />
        </Stack>
        <View style={{ justifyContent: 'flex-end', paddingBottom: bodyweight ? 22 : 0 }}>
          <Row gap={4}>
            {SHOW_WEIGHT_NUDGE && !bodyweight ? <IconButton icon="remove-circle-outline" label={`Decrease weight by ${step}`} onPress={() => setWeight(Math.max(0, (weight ?? 0) - step))} /> : null}
            {SHOW_WEIGHT_NUDGE && !bodyweight ? <IconButton icon="add-circle-outline" label={`Increase weight by ${step}`} onPress={() => setWeight((weight ?? 0) + step)} /> : null}
            <Button title="Log set" icon="checkmark" onPress={log} disabled={weight === undefined} />
          </Row>
        </View>
      </Row>
      <Row wrap gap={6}>
        <Muted variant="small">RPE</Muted>
        {[6, 7, 8, 9, 10].map((v) => <Chip key={v} label={String(v)} selected={rpe === v} onPress={() => setRpe(rpe === v ? undefined : v)} />)}
      </Row>
      {msg ? <Text variant="small" color={C.danger} accessibilityRole="alert">{msg}</Text> : null}
      {undoId && sets.some((s) => s.id === undoId) ? (
        <Row gap={Space.sm}>
          <Muted variant="small" style={{ flex: 1 }}>Set logged.</Muted>
          <Button title="Undo" kind="secondary" size="sm" onPress={() => { doAct({ type: 'DELETE_SET', sessionId: session.id, setId: undoId, now: nowISO() }); setUndoId(undefined); }} />
        </Row>
      ) : null}
      {rest ? <RestTimerCard rest={rest} label={exerciseName(exerciseId)} /> : null}
      <EditSetSheet key={editing?.id ?? 'none'} set={editing} onClose={() => setEditing(null)} sessionId={session.id} />
    </Card>
  );
}

function EditSetSheet({ set, onClose, sessionId }: { set: LoggedSet | null; onClose: () => void; sessionId: string }) {
  const { state } = useStore();
  const doAct = useAct();
  const units = state.settings.units;
  // remounted per set (key below), so initial state comes straight from the set
  const [w, setW] = useState<number | undefined>(set ? weightValue(set.weightKg, units) : undefined);
  const [r, setR] = useState(set?.reps ?? 8);
  const [rpe, setRpe] = useState<number | undefined>(set?.rpe);
  const [warm, setWarm] = useState(Boolean(set?.warmup));
  const bodyweight = set ? EXERCISE_BY_ID[set.exerciseId]?.loadType === 'bodyweight' : false;
  return (
    <Sheet
      visible={!!set}
      onClose={onClose}
      title={set ? `Edit ${exerciseName(set.exerciseId)} set` : 'Edit set'}
      footer={
        <Button
          title="Save"
          icon="checkmark"
          full
          disabled={w === undefined}
          onPress={() => {
            if (w !== undefined && checkSet({ weightKg: toKg(w, units), reps: r })) return;
            if (set && w !== undefined && doAct({ type: 'UPDATE_SET', sessionId, set: { ...set, weightKg: toKg(w, units), reps: r, rpe, warmup: warm || undefined }, now: nowISO() }, 'Set updated')) onClose();
          }}
        />
      }>
      <NumberField label={`${bodyweight ? 'Added weight' : 'Weight'} (${weightUnit(units)})`} value={w} onChange={setW} min={0} max={weightValue(MAX_SET_WEIGHT_KG, units)} />
      <Text variant="smallStrong">Reps</Text>
      <Stepper value={r} onChange={setR} min={1} max={100} />
      <Text variant="smallStrong">RPE (optional)</Text>
      <Row wrap gap={6}>{[6, 7, 8, 9, 10].map((v) => <Chip key={v} label={String(v)} selected={rpe === v} onPress={() => setRpe(rpe === v ? undefined : v)} />)}</Row>
      <Chip label="Warm-up set (not counted)" selected={warm} onPress={() => setWarm(!warm)} />
    </Sheet>
  );
}

function VoiceLogger({ session, currentExerciseId, onLogged }: { session: WorkoutSession; currentExerciseId?: string; onLogged: (exerciseId: string) => void }) {
  const { state } = useStore();
  const doAct = useAct();
  const units = state.settings.units;
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedSet | null>(null);
  const [voiceMsg, setVoiceMsg] = useState<string | undefined>();
  const speech = useSpeech((t) => {
    setText(t);
    interpret(t);
  });

  function interpret(input = text) {
    if (!input.trim()) return;
    const p = parseSetUtterance(input, { units, currentExerciseId });
    if (!p.understood) {
      setParsed(null);
      setVoiceMsg(p.issues[0]);
      return;
    }
    setVoiceMsg(undefined);
    if (p.repeatLast) {
      const last = session.sets.filter((s) => s.exerciseId === (p.exerciseId ?? '')).slice(-1)[0] ?? session.sets[session.sets.length - 1];
      if (last) {
        setParsed({ ...p, exerciseId: last.exerciseId, weight: weightValue(last.weightKg, units), unit: units === 'imperial' ? 'lb' : 'kg', weightKg: last.weightKg, reps: last.reps, issues: [] });
        return;
      }
      setParsed({ ...p, issues: ['No previous set to repeat yet.'] });
      return;
    }
    setParsed(p);
  }

  const save = () => {
    if (!parsed?.exerciseId || parsed.weight === undefined || !parsed.reps) return;
    const now = nowISO();
    const unitSys = parsed.unit === 'kg' ? 'metric' : 'imperial';
    const weightKg = toKg(parsed.weight, unitSys);
    const bad = checkSet({ weightKg, reps: parsed.reps });
    if (bad) return setVoiceMsg(bad);
    const sets: LoggedSet[] = Array.from({ length: parsed.sets }, (_, i) => ({ id: newId(), exerciseId: parsed.exerciseId!, weightKg, reps: parsed.reps!, rpe: parsed.rpe, via: 'voice', loggedAt: new Date(Date.now() + i).toISOString() }));
    if (doAct({ type: 'ADD_SETS', sessionId: session.id, sets, now }, `Logged ${sets.length} set${sets.length > 1 ? 's' : ''}`)) {
      onLogged(parsed.exerciseId);
      setParsed(null);
      setText('');
    }
  };

  return (
    <Card style={{ gap: Space.sm }}>
      <Row>
        <Ionicons name="mic" size={18} color={C.primary} />
        <Text variant="h3" style={{ flex: 1 }}>Log by voice or text</Text>
      </Row>
      <Muted variant="small">Say or type: &quot;bench press, 135 pounds, eight reps&quot;, &quot;squat 225 for 5&quot;, &quot;3 sets of 10 at 50 kilos&quot;, or &quot;same again&quot;.</Muted>
      <Field
        value={text}
        onChangeText={setText}
        placeholder="e.g. bench press 135 pounds 8 reps"
        onSubmitEditing={() => interpret()}
        returnKeyType="done"
        accessibilityLabel="Describe the set"
        hint={Platform.OS !== 'web' ? 'Tip: tap the microphone on your keyboard to dictate.' : undefined}
      />
      <Row wrap gap={Space.sm}>
        {speech.supported ? (
          <Button title={speech.listening ? 'Listening… tap to stop' : 'Speak'} kind={speech.listening ? 'primary' : 'secondary'} icon={speech.listening ? 'radio-button-on' : 'mic-outline'} onPress={speech.listening ? speech.stop : speech.start} />
        ) : null}
        <Button title="Interpret" kind="secondary" icon="color-wand-outline" onPress={() => interpret()} disabled={!text.trim()} />
      </Row>
      {speech.error ? <Text variant="small" color={C.danger}>{speech.error}</Text> : null}
      {voiceMsg ? <Text variant="small" color={C.danger} accessibilityRole="alert">{voiceMsg}</Text> : null}

      {parsed ? (
        <Card tone="pending" style={{ gap: Space.sm }}>
          <Row wrap gap={6}>
            <Badge kind="pending" label="Check before saving" />
            <Muted variant="small">Heard: &quot;{parsed.raw}&quot;</Muted>
          </Row>
          <Text variant="smallStrong">Exercise</Text>
          <Row wrap gap={6}>
            {[...new Set([parsed.exerciseId, currentExerciseId, ...session.sets.map((s) => s.exerciseId)].filter(Boolean) as string[])].slice(0, 6).map((id) => (
              <Chip key={id} label={exerciseName(id)} selected={parsed.exerciseId === id} onPress={() => setParsed({ ...parsed, exerciseId: id, exerciseFromContext: false })} />
            ))}
          </Row>
          {parsed.exerciseFromContext ? <Muted variant="small">No exercise name heard. Using the current exercise.</Muted> : null}
          <Row wrap gap={Space.md}>
            <NumberField label="Weight" value={parsed.weight} min={0} max={MAX_SET_WEIGHT_KG * 2.3} onChange={(v) => setParsed({ ...parsed, weight: v })} suffix={parsed.unit ?? weightUnit(units)} style={{ width: 130 }} />
            <Stack gap={6}>
              <Text variant="smallStrong">Unit</Text>
              <Row gap={4}>
                <Chip label="lb" selected={(parsed.unit ?? (units === 'imperial' ? 'lb' : 'kg')) === 'lb'} onPress={() => setParsed({ ...parsed, unit: 'lb' })} />
                <Chip label="kg" selected={(parsed.unit ?? (units === 'imperial' ? 'lb' : 'kg')) === 'kg'} onPress={() => setParsed({ ...parsed, unit: 'kg' })} />
              </Row>
            </Stack>
            <Stack gap={6}>
              <Text variant="smallStrong">Reps</Text>
              <Stepper value={parsed.reps ?? 0} onChange={(v) => setParsed({ ...parsed, reps: v })} min={1} max={100} />
            </Stack>
            <Stack gap={6}>
              <Text variant="smallStrong">Sets</Text>
              <Stepper value={parsed.sets} onChange={(v) => setParsed({ ...parsed, sets: v })} min={1} max={10} />
            </Stack>
          </Row>
          {parsed.issues.map((i) => (
            <Row key={i} gap={6}>
              <Ionicons name="alert-circle-outline" size={15} color={C.warning} />
              <Text variant="small" color={C.warning}>{i}</Text>
            </Row>
          ))}
          <Row gap={Space.sm}>
            <Button title={`Save ${parsed.sets > 1 ? `${parsed.sets} sets` : 'set'}`} kind="accept" icon="checkmark" onPress={save} disabled={!parsed.exerciseId || parsed.weight === undefined || !parsed.reps} />
            <Button title="Discard" kind="reject" onPress={() => setParsed(null)} />
          </Row>
        </Card>
      ) : null}
    </Card>
  );
}

function ExercisePicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = EXERCISES.filter((e) => !q.trim() || `${e.name} ${e.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet visible={visible} onClose={onClose} title="Add exercise">
      <Field placeholder="Search exercises" value={q} onChangeText={setQ} accessibilityLabel="Search exercises" />
      {list.map((e) => (
        <Row key={e.id} style={{ paddingVertical: 4 }}>
          <Stack gap={0} style={{ flex: 1 }}>
            <Text variant="smallStrong">{e.name}</Text>
            <Muted variant="small">{e.primary.replace('_', ' ')} · {e.loadType}</Muted>
          </Stack>
          <Button title="Add" kind="secondary" size="sm" onPress={() => onPick(e.id)} />
        </Row>
      ))}
    </Sheet>
  );
}
