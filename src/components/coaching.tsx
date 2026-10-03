import React from 'react';
import { View } from 'react-native';
import type { Insight, Proposal } from '@/lib/types';
import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Expandable, IconButton, Muted, Row, Stack, Text } from './ui';
import { useAct } from './Toast';
import { useStore } from '@/store/AppStore';
import { exerciseName } from '@/lib/workouts/exercises';
import { nowISO } from '@/lib/dates';

const STATUS = {
  pending: { tone: 'pending' as const, badge: 'pending' as const, label: 'Needs your approval' },
  accepted: { tone: 'saved' as const, badge: 'saved' as const, label: 'Accepted · saved' },
  rejected: { tone: 'muted' as const, badge: 'rejected' as const, label: 'Declined · nothing changed' },
  expired: { tone: 'muted' as const, badge: 'rejected' as const, label: 'Expired · nothing changed' },
};

/**
 * A coaching suggestion. Visual language:
 *   violet "Suggestion" tag = AI-generated idea
 *   amber card = waiting for your decision
 *   green card = accepted and saved
 */
export function ProposalCard({ proposal, compact, preview }: { proposal: Proposal; compact?: boolean; preview?: boolean }) {
  const doAct = useAct();
  const { today } = useStore();
  const s = STATUS[proposal.status];
  const pending = proposal.status === 'pending';
  const scopeLabel = proposal.scope === 'today' ? 'Today only' : 'Ongoing change';

  return (
    <Card tone={s.tone} style={{ gap: Space.sm }} accessibilityLabel={`${proposal.title}. ${s.label}`}>
      <Row wrap gap={6}>
        <Badge kind="suggestion" label="Suggestion" />
        <Badge kind={s.badge} label={s.label} />
        <Badge kind="neutral" label={scopeLabel} icon={proposal.scope === 'today' ? 'today-outline' : 'repeat'} />
      </Row>
      <Text variant="h3">{proposal.title}</Text>
      <Muted>{proposal.summary}</Muted>
      <ChangeDetails proposal={proposal} />
      <Expandable title="Why this suggestion?" icon="help-circle-outline" initiallyOpen={!compact && pending}>
        {proposal.rationale.map((r, i) => (
          <Row key={i} align="flex-start" gap={6}>
            <Text variant="small" color={C.textSecondary}>•</Text>
            <Text variant="small" color={C.textSecondary} style={{ flex: 1 }}>
              {r}
            </Text>
          </Row>
        ))}
      </Expandable>
      {pending ? (
        <Row wrap gap={Space.sm} style={{ marginTop: 2 }}>
          <Button
            title={proposal.scope === 'today' ? 'Accept for today' : 'Accept change'}
            kind="accept"
            icon="checkmark"
            disabled={preview}
            onPress={() => doAct({ type: 'ACCEPT_PROPOSAL', id: proposal.id, now: nowISO(), today }, 'Change saved')}
          />
          <Button title="Decline" kind="reject" icon="close" disabled={preview} onPress={() => doAct({ type: 'REJECT_PROPOSAL', id: proposal.id, now: nowISO() }, 'Declined. Your plan is unchanged')} />
        </Row>
      ) : null}
    </Card>
  );
}

function ChangeDetails({ proposal }: { proposal: Proposal }) {
  const { state } = useStore();
  const c = proposal.change;
  if (c.type === 'target_change' || c.type === 'goal_change') {
    const t = state.targets;
    const rows: [string, number | undefined, number][] = [
      ['Calories', t?.calories, c.next.calories],
      ['Protein (g)', t?.proteinG, c.next.proteinG],
      ['Carbs (g)', t?.carbsG, c.next.carbsG],
      ['Fat (g)', t?.fatG, c.next.fatG],
    ];
    return (
      <Card style={{ padding: Space.md, gap: 4 }}>
        {rows.map(([k, from, to]) => (
          <Row key={k}>
            <Muted variant="small" style={{ flex: 1 }}>{k}</Muted>
            <Text variant="small" color={C.textSecondary}>{from ?? '—'}</Text>
            <Text variant="small" color={C.textSecondary}>→</Text>
            <Text variant="smallStrong" style={{ minWidth: 48, textAlign: 'right' }}>{to}</Text>
          </Row>
        ))}
      </Card>
    );
  }
  if (c.type === 'day_calorie_adjustment') {
    return (
      <Card style={{ padding: Space.md }}>
        <Row>
          <Muted variant="small" style={{ flex: 1 }}>Today&apos;s calories</Muted>
          <Text variant="smallStrong">+{c.calorieDelta} kcal (+{c.carbsDeltaG} g carbs)</Text>
        </Row>
      </Card>
    );
  }
  if (c.type === 'today_workout_swap') {
    return (
      <Card style={{ padding: Space.md, gap: 4 }}>
        <Text variant="smallStrong">{c.day.name}</Text>
        {c.day.exercises.map((e, i) => (
          <Muted key={i} variant="small">
            {exerciseName(e.exerciseId)} · {e.sets} × {e.repMin}–{e.repMax}
          </Muted>
        ))}
      </Card>
    );
  }
  if (c.type === 'new_plan') {
    return (
      <Card style={{ padding: Space.md, gap: 4 }}>
        {c.plan.days.map((d) => (
          <Muted key={d.id} variant="small">
            {d.name}: {d.exercises.map((e) => exerciseName(e.exerciseId)).join(', ')}
          </Muted>
        ))}
      </Card>
    );
  }
  return null;
}

export function InsightCard({ insight }: { insight: Insight }) {
  const doAct = useAct();
  return (
    <Card style={{ gap: 6 }}>
      <Row align="flex-start">
        <View style={{ flex: 1, gap: 4 }}>
          <Row gap={6}>
            <Badge kind="info" label="Coach check-in" icon="chatbubble-ellipses-outline" />
          </Row>
          <Text variant="bodyStrong">{insight.title}</Text>
        </View>
        <IconButton icon="close" label="Dismiss" size={18} color={C.textSecondary} onPress={() => doAct({ type: 'DISMISS_INSIGHT', dedupeKey: insight.dedupeKey })} />
      </Row>
      <Muted variant="small">{insight.body}</Muted>
    </Card>
  );
}

export function ProposalList({ proposals, empty }: { proposals: Proposal[]; empty?: React.ReactNode }) {
  if (!proposals.length) return <>{empty ?? null}</>;
  return (
    <Stack gap={Space.md}>
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
    </Stack>
  );
}
