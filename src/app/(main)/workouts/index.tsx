import React, { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, EmptyState, Expandable, Menu, Muted, PageHeader, Row, Screen, Segmented, Sheet, Stack, Text, IconButton, Ionicons } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { live, activeSession, workoutForDay } from '@/lib/selectors';
import { generatePlan, dayMinutes } from '@/lib/workouts/generator';
import { exerciseName, formatPrescription } from '@/lib/workouts/exercises';
import { formatDateLabel, nowISO, WEEKDAY_SHORT } from '@/lib/dates';
import { displayWeight } from '@/lib/units';
import type { WorkoutPlan } from '@/lib/types';
import { useLayout } from '@/hooks/useLayout';

type Tab = 'plan' | 'routines' | 'history';

export default function Workouts() {
  const { state, today } = useStore();
  const doAct = useAct();
  const { isWide } = useLayout();
  const [tab, setTab] = useState<Tab>('plan');
  const [preview, setPreview] = useState<WorkoutPlan | null>(null);
  const [toDelete, setToDelete] = useState<WorkoutPlan | null>(null);
  const { preview: previewParam } = useLocalSearchParams<{ preview?: string }>();
  const openedFromSettings = useRef(false);
  const units = state.settings.units;
  const active = activeSession(state);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const todayDayId = workoutForDay(state, today).day?.sourceDayId ?? workoutForDay(state, today).day?.id;

  const proposeNewPlan = () => state.profile && setPreview(generatePlan(state.profile, today));
  useEffect(() => {
    if (previewParam === '1' && state.profile && !openedFromSettings.current) {
      openedFromSettings.current = true;
      setPreview(generatePlan(state.profile, today));
    }
  }, [previewParam, state.profile, today]);

  return (
    <Screen>
      <PageHeader
        title="Training"
        subtitle={state.plan ? state.plan.name : 'No plan yet'}
        right={<Button title={active ? 'Continue workout' : 'Start workout'} icon="play" onPress={() => router.push('/workouts/session')} />}
      />
      <Segmented label="Training sections" value={tab} onChange={setTab} options={[{ value: 'plan', label: 'My plan' }, ...(tab === 'routines' ? [{ value: 'routines' as Tab, label: 'My routines' }] : []), { value: 'history', label: 'History' }]} />

      {tab === 'plan' &&
        (state.plan ? (
          <Stack gap={Space.md}>
            <Card style={{ gap: Space.sm }}>
              <Row wrap gap={6}>
                <Badge kind={state.plan.source === 'ai_generated' ? 'suggestion' : 'neutral'} label={state.plan.source === 'ai_generated' ? 'Generated for you' : 'Your routine'} icon={state.plan.source === 'ai_generated' ? 'sparkles' : 'person-outline'} />
              </Row>
              <Text variant="h2">{state.plan.name}</Text>
              <Expandable title="Why this plan?" icon="help-circle-outline">
                {state.plan.rationale.map((r) => (
                  <Muted key={r} variant="small">• {r}</Muted>
                ))}
              </Expandable>
              <Menu
                title="Change plan"
                trigger="Change plan"
                items={[
                  { label: 'Generate a new plan', icon: 'sparkles-outline', onPress: proposeNewPlan },
                  { label: 'Build my own', icon: 'create-outline', onPress: () => router.push('/workouts/routine') },
                  { label: 'My routines', icon: 'list-outline', onPress: () => setTab('routines') },
                ]}
              />
            </Card>
            <Stack gap={Space.md} style={isWide ? { flexDirection: 'row', flexWrap: 'wrap' } : undefined}>
              {state.plan.days.map((d) => {
                const isToday = d.id === todayDayId;
                const open = isToday || openDay === d.id;
                return (
                  <Card key={d.id} style={[{ gap: 6 }, isWide ? { width: '48.5%' } : null]}>
                    <Pressable disabled={isToday} onPress={() => setOpenDay(openDay === d.id ? null : d.id)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${d.name}, ${d.focus}`}>
                      <Row>
                        <Stack gap={0} style={{ flex: 1 }}>
                          <Muted variant="caption">{isToday ? 'TODAY' : d.weekday !== undefined ? WEEKDAY_SHORT[d.weekday].toUpperCase() : 'ANY DAY'}</Muted>
                          <Text variant="h3">{d.name}</Text>
                        </Stack>
                        <Muted variant="small">~{dayMinutes(d)} min</Muted>
                        {!isToday ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSecondary} /> : null}
                      </Row>
                      <Muted variant="small">{d.focus}</Muted>
                    </Pressable>
                    {open
                      ? d.exercises.map((e, i) => (
                          <Row key={i}>
                            <Text variant="small" style={{ flex: 1 }}>{exerciseName(e.exerciseId)}</Text>
                            <Muted variant="small">
                              {formatPrescription(e)}
                              {e.targetWeightKg !== undefined && e.targetWeightKg > 0 ? ` @ ${displayWeight(e.targetWeightKg, units)}` : ''}
                            </Muted>
                          </Row>
                        ))
                      : null}
                    {isToday ? <Button title="Start this workout" kind="secondary" size="sm" icon="play-outline" onPress={() => router.push({ pathname: '/workouts/session', params: { dayId: d.id } })} /> : null}
                  </Card>
                );
              })}
            </Stack>
          </Stack>
        ) : (
          <EmptyState
            icon="barbell-outline"
            title="No training plan yet"
            body="Get a plan built from your goal, experience, equipment and schedule, or build your own routine."
            action={
              <Row wrap gap={Space.sm}>
                <Button title="Generate a plan for me" icon="sparkles" onPress={proposeNewPlan} />
                <Button title="Build my own" kind="secondary" icon="create-outline" onPress={() => router.push('/workouts/routine')} />
              </Row>
            }
          />
        ))}

      {tab === 'routines' && (
        <Stack gap={Space.md}>
          <Button title="New routine" icon="add" onPress={() => router.push('/workouts/routine')} />
          {live(state.routines).length === 0 ? (
            <EmptyState icon="list-outline" title="No custom routines" body="Create a routine with your own exercises, sets and rep ranges. You can make it your active plan." />
          ) : (
            live(state.routines).map((r) => (
              <Card key={r.id} style={{ gap: 6 }}>
                <Row>
                  <Text variant="h3" style={{ flex: 1 }}>{r.name}</Text>
                  {state.plan?.id === r.id ? <Badge kind="saved" label="Active plan" /> : null}
                  <IconButton icon="trash-outline" label={`Delete ${r.name}`} color={C.textSecondary} size={18} onPress={() => setToDelete(r)} />
                </Row>
                <Muted variant="small">{r.days.map((d) => d.name).join(' · ')}</Muted>
                <Row wrap gap={Space.sm}>
                  <Button title="Edit" kind="secondary" size="sm" icon="create-outline" onPress={() => router.push({ pathname: '/workouts/routine', params: { id: r.id } })} />
                  {state.plan?.id !== r.id ? <Button title="Use as my plan" size="sm" icon="checkmark" onPress={() => setPreview(r)} /> : null}
                </Row>
              </Card>
            ))
          )}
        </Stack>
      )}

      {tab === 'history' && <History />}

      <Sheet
        visible={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.source === 'ai_generated' ? 'Suggested plan' : 'Use this routine as your plan?'}
        footer={
          <Row gap={Space.sm}>
            <Button title="Keep current" kind="reject" onPress={() => setPreview(null)} style={{ flex: 1 }} />
            <Button
              title="Use this plan"
              kind="accept"
              icon="checkmark"
              style={{ flex: 1 }}
              onPress={() => {
                if (preview && doAct({ type: 'SET_PLAN', plan: preview, confirmed: true }, 'Plan saved')) setPreview(null);
              }}
            />
          </Row>
        }>
        {preview ? (
          <>
            <Row wrap gap={6}>
              <Badge kind="pending" label="Needs your approval" />
            </Row>
            <Text variant="h3">{preview.name}</Text>
            {preview.days.map((d) => (
              <Stack key={d.id} gap={2}>
                <Text variant="smallStrong">{d.weekday !== undefined ? `${WEEKDAY_SHORT[d.weekday]} · ` : ''}{d.name}</Text>
                <Muted variant="small">{d.exercises.map((e) => `${exerciseName(e.exerciseId)} ${formatPrescription(e)}`).join(' · ')}</Muted>
              </Stack>
            ))}
            {preview.rationale.map((r) => (
              <Muted key={r} variant="small">• {r}</Muted>
            ))}
            {state.plan ? <Muted variant="small">Your current plan and its target weights will be replaced. Workout history is kept.</Muted> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete routine?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" onPress={() => setToDelete(null)} style={{ flex: 1 }} />
            <Button title="Delete" kind="danger" style={{ flex: 1 }} onPress={() => { if (toDelete) doAct({ type: 'DELETE_ROUTINE', id: toDelete.id, now: nowISO() }, 'Routine deleted'); setToDelete(null); }} />
          </Row>
        }>
        <Muted>{toDelete?.name}. Your workout history is not affected.</Muted>
      </Sheet>
    </Screen>
  );
}

function History() {
  const { state, today } = useStore();
  const sessions = live(state.sessions).filter((s) => s.finishedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!sessions.length) return <EmptyState icon="time-outline" title="No workouts logged yet" body="Finished workouts appear here with sets, reps and weights." />;
  return (
    <Stack gap={Space.sm}>
      {sessions.map((s) => {
        const volume = s.sets.reduce((v, x) => v + x.weightKg * x.reps, 0);
        const exercises = [...new Set(s.sets.map((x) => x.exerciseId))];
        return (
          <Pressable key={s.id} onPress={() => router.push({ pathname: '/workouts/session', params: { id: s.id } })} accessibilityRole="button">
            <Card style={{ gap: 4, padding: Space.md }}>
              <Row>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{s.name}</Text>
                <Muted variant="small">{formatDateLabel(s.date, today)}</Muted>
              </Row>
              <Muted variant="small">
                {exercises.length} exercises · {s.sets.length} sets · {displayWeight(volume, state.settings.units, 0)} total volume
              </Muted>
              <Muted variant="small" numberOfLines={1}>{exercises.map(exerciseName).join(', ')}</Muted>
            </Card>
          </Pressable>
        );
      })}
    </Stack>
  );
}
