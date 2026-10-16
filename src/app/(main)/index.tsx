import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Columns, Muted, PageHeader, Row, Screen, Stack, Text, Ionicons, ProgressBar } from '@/components/ui';
import { CaloriesRing, MacroBars } from '@/components/nutrition';
import { WeightSheet } from '@/components/WeightSheet';
import { LogMealSheet } from '@/components/LogMealSheet';
import { useStore } from '@/store/AppStore';
import { useLayout } from '@/hooks/useLayout';
import { activeSession, activityForDay, hasActivitySource, latestWeight, pendingProposals, remainingForDay } from '@/lib/selectors';
import { exerciseName, formatPrescription } from '@/lib/workouts/exercises';
import { todayWorkout } from '@/lib/workouts/todayWorkout';
import { dayMinutes } from '@/lib/workouts/generator';
import { displayWeight } from '@/lib/units';
import { formatDateLabel } from '@/lib/dates';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { state, today, storageError } = useStore();
  const { isPhone } = useLayout();
  const [weightOpen, setWeightOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const rem = remainingForDay(state, today)!;
  const pending = pendingProposals(state);
  const insight = state.insights[0];
  const name = state.profile?.name && state.profile.name !== 'there' ? `, ${state.profile.name}` : '';
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const nutrition = (
    <Card style={{ gap: Space.lg }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>Nutrition today</Text>
        {rem.target.adjustment ? <Badge kind="saved" label={`+${rem.target.adjustment.calorieDelta} kcal today`} /> : null}
      </Row>
      <Row wrap gap={Space.xl} align="center" style={isPhone ? { justifyContent: 'center' } : undefined}>
        <CaloriesRing eaten={rem.eaten.calories} target={rem.target.calories} size={isPhone ? 140 : 156} />
        <MacroBars eaten={rem.eaten} target={rem.target} />
      </Row>
      <Muted variant="small">
        {Math.round(rem.eaten.calories).toLocaleString()} eaten of {rem.target.calories.toLocaleString()} kcal
        {rem.target.adjustment ? ` (includes today's approved +${rem.target.adjustment.calorieDelta} kcal)` : ''}
      </Muted>
      <Button title="Log meal" icon="add" onPress={() => setMealOpen(true)} />
    </Card>
  );

  // One summary row instead of a stack of coach cards; details live on the Coach tab.
  const coachCount = pending.length + (insight ? 1 : 0);
  const coach = (
    <Pressable onPress={() => router.push('/coach')} accessibilityRole="button" accessibilityLabel="Open coach">
      <Card tone={pending.length ? 'suggestion' : 'muted'}>
        <Row>
          <Ionicons name={coachCount ? 'chatbubbles-outline' : 'checkmark-done'} size={18} color={coachCount ? C.primary : C.success} />
          <Stack gap={0} style={{ flex: 1 }}>
            <Text variant="bodyStrong">{pending.length ? `Coach: ${pending.length} suggestion${pending.length > 1 ? 's' : ''} waiting for your OK` : insight ? 'Coach: 1 new insight' : 'Coach: nothing needs your attention'}</Text>
            {pending[0] ? <Muted variant="small" numberOfLines={1}>{pending[0].title}</Muted> : insight ? <Muted variant="small" numberOfLines={1}>{insight.title}</Muted> : null}
          </Stack>
          <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
        </Row>
      </Card>
    </Pressable>
  );

  return (
    <Screen>
      <PageHeader
        title={`${greeting()}${name}`}
        subtitle={dateLabel}
      />
      {activeSession(state) ? (
        <Banner kind="info" title="Workout in progress" action={<Button title="Resume workout" size="sm" icon="play" onPress={() => router.push('/workouts/session')} />}>
          {activeSession(state)?.name}
        </Banner>
      ) : null}
      {storageError ? <Banner kind="danger" title="Storage problem">{storageError}</Banner> : null}
      <Columns ratio={[1.35, 1]}>
        {[
          <Stack key="a" gap={Space.lg}>{nutrition}</Stack>,
          <Stack key="b" gap={Space.lg}>
            <WorkoutCard />
            <ActivityCard onLogWeight={() => setWeightOpen(true)} />
            {coach}
          </Stack>,
        ]}
      </Columns>
      <WeightSheet visible={weightOpen} onClose={() => setWeightOpen(false)} />
      <LogMealSheet visible={mealOpen} onClose={() => setMealOpen(false)} />
    </Screen>
  );
}

function WorkoutCard() {
  const { state, today } = useStore();
  const w = todayWorkout(state, today);

  if (w.status === 'no_plan') {
    return (
      <Card style={{ gap: Space.sm }}>
        <Text variant="h3">Today&apos;s workout</Text>
        <Muted>No training plan yet.</Muted>
        <Button title="Set up a plan" kind="secondary" icon="barbell-outline" onPress={() => router.push('/workouts')} />
      </Card>
    );
  }
  if (w.status === 'rest' || !w.day) {
    return (
      <Card style={{ gap: Space.sm }}>
        <Row>
          <Text variant="h3" style={{ flex: 1 }}>Today&apos;s workout</Text>
          <Badge kind="neutral" label="Rest day" icon="moon-outline" />
        </Row>
        <Muted>Recovery is when you get stronger. A walk is a great way to stay active.</Muted>
        <Button title="Log a workout anyway" kind="ghost" size="sm" onPress={() => router.push('/workouts/session')} />
      </Card>
    );
  }
  const { day } = w;
  return (
    <Card style={{ gap: Space.sm }}>
      <Row wrap>
        <Text variant="h3" style={{ flex: 1 }}>Today&apos;s workout</Text>
        {w.overridden ? <Badge kind="saved" label="Adjusted for today" /> : null}
        {w.status === 'done' ? <Badge kind="saved" label="Done" /> : null}
      </Row>
      <Text variant="bodyStrong">{day.name}</Text>
      <Muted variant="small">{day.focus} · ~{dayMinutes(day)} min</Muted>
      <Stack gap={2}>
        {day.exercises.slice(0, 5).map((e, i) => (
          <Muted key={i} variant="small">
            {exerciseName(e.exerciseId)} · {formatPrescription(e)}
          </Muted>
        ))}
        {day.exercises.length > 5 ? <Muted variant="small">+{day.exercises.length - 5} more</Muted> : null}
      </Stack>
      {w.status === 'done' && w.session ? (
        <Button title="View session" kind="secondary" size="sm" onPress={() => router.push({ pathname: '/workouts/session', params: { id: w.session!.id } })} />
      ) : (
        <Button title={w.status === 'active' ? 'Resume workout' : 'Start workout'} icon="play" onPress={() => router.push('/workouts/session')} />
      )}
    </Card>
  );
}

function ActivityCard({ onLogWeight }: { onLogWeight: () => void }) {
  const { state, today } = useStore();
  const a = activityForDay(state, today);
  const showActivity = hasActivitySource(state);
  const w = latestWeight(state);
  const baseline = state.targets?.baselineSteps ?? 7000;
  return (
    <Card style={{ gap: Space.md }}>
      {showActivity ? <Text variant="h3">Daily activity</Text> : null}
      {!showActivity ? null : a.missing ? (
        <Stack gap={Space.sm}>
          <Muted variant="small">No activity has synced for today yet.</Muted>
          <Button title="View activity" kind="secondary" size="sm" icon="footsteps-outline" onPress={() => router.push('/activity')} />
        </Stack>
      ) : (
        <Pressable onPress={() => router.push('/activity')} accessibilityRole="button" accessibilityLabel="Open activity details" style={{ gap: Space.sm }}>
          <Row align="flex-end" gap={6}>
            <Text variant="number">{(a.steps ?? 0).toLocaleString()}</Text>
            <Muted style={{ marginBottom: 4 }}>steps</Muted>
          </Row>
          <ProgressBar value={a.steps ?? 0} max={baseline} color={C.info} label="Steps today" />
          <Muted variant="small">
            Your target assumes ~{baseline.toLocaleString()} steps. {a.activeKcal ? `~${a.activeKcal} active kcal (device estimate)` : ''}
          </Muted>
          
        </Pressable>
      )}
      {showActivity ? <View style={{ height: 1, backgroundColor: C.border }} /> : null}
      <Row>
        <Stack gap={0} style={{ flex: 1 }}>
          <Muted variant="caption">BODY WEIGHT</Muted>
          <Text variant="bodyStrong">{w ? displayWeight(w.weightKg, state.settings.units) : 'Not logged'}</Text>
          {w ? <Muted variant="small">{formatDateLabel(w.date, today)}</Muted> : null}
        </Stack>
        <Button title={w?.date === today ? 'Update' : 'Log weight'} kind="secondary" size="sm" icon="scale-outline" onPress={onLogWeight} />
      </Row>
    </Card>
  );
}
