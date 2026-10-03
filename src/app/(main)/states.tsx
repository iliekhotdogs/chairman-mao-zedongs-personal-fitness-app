import React from 'react';
import { router } from 'expo-router';

import { Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Columns, EmptyState, ErrorState, LoadingState, Muted, PageHeader, Row, Screen, SectionTitle, Stack, Text } from '@/components/ui';
import { ProposalCard } from '@/components/coaching';
import { nowISO, toISODate } from '@/lib/dates';
import type { Proposal } from '@/lib/types';

/** Design-review page: every UI state in one place, so it can be checked without forcing errors. */
const base = (over: Partial<Proposal>): Proposal => ({
  id: `demo-${over.status}`,
  kind: 'day_calorie_adjustment',
  scope: 'today',
  title: 'Add 250 kcal today for extra activity',
  summary: "You're at 14,800 steps, about 9,800 more than your target already assumes.",
  rationale: ['Your target already includes ~5,000 steps and planned workouts.', 'Only half of the wearable estimate is offered.', 'Today only.'],
  change: { type: 'day_calorie_adjustment', date: toISODate(), calorieDelta: 250, carbsDeltaG: 63 },
  status: 'pending',
  createdAt: nowISO(),
  updatedAt: nowISO(),
  dedupeKey: 'demo',
  origin: 'adaptive_engine',
  ...over,
});

export default function StatesGallery() {
  return (
    <Screen>
      <PageHeader title="UI states" subtitle="Design review: how each state looks" right={<Button title="Back" kind="ghost" onPress={() => router.back()} />} />

      <SectionTitle>Coaching suggestion lifecycle</SectionTitle>
      <Muted variant="small">Violet tag = AI suggestion · Amber = waiting for your approval · Green = accepted and saved · Grey = declined/expired (nothing changed).</Muted>
      <Columns>
        {[
          <ProposalCard key="p" proposal={base({ status: 'pending' })} preview />,
          <Stack key="o" gap={Space.md}>
            <ProposalCard proposal={base({ status: 'accepted', decidedAt: nowISO() })} preview />
            <ProposalCard proposal={base({ status: 'rejected', decidedAt: nowISO(), scope: 'ongoing', kind: 'target_change', title: 'Lower daily calories by 150', summary: '2,310 → 2,160 kcal/day', change: { type: 'target_change', next: { calories: 2160, proteinG: 172, carbsG: 210, fatG: 65 } } })} preview />
          </Stack>,
        ]}
      </Columns>

      <SectionTitle>Loading, empty, error</SectionTitle>
      <Columns>
        {[
          <LoadingState key="l" label="Identifying food and looking up nutrition sources…" />,
          <EmptyState key="e" icon="restaurant-outline" title="Nothing logged yet today" body="Snap a photo of your meal with a short hint." action={<Button title="Snap a meal" icon="camera" />} />,
          <ErrorState key="x" title="Couldn't create an estimate" body="The food estimator is unavailable (network error). You can enter the food manually." onRetry={() => {}} />,
        ]}
      </Columns>

      <SectionTitle>Permission denied</SectionTitle>
      <Columns>
        {[
          <Card key="c" tone="pending" style={{ gap: Space.sm }}>
            <Text variant="h3">Camera access is off</Text>
            <Muted>FitCoach needs camera permission to take meal photos. Turn it on in settings, or upload a photo instead.</Muted>
            <Row gap={Space.sm}>
              <Button title="Open settings" kind="secondary" size="sm" />
              <Button title="Upload instead" size="sm" />
            </Row>
          </Card>,
          <Banner key="n" kind="warning" title="Notifications blocked">Check-ins will still appear inside the app.</Banner>,
          <Banner key="h" kind="warning" title="Health Connect permission denied">Open Health Connect → App permissions → FitCoach to allow Steps.</Banner>,
        ]}
      </Columns>

      <SectionTitle>Uncertain AI estimate</SectionTitle>
      <Columns>
        {[
          <Card key="u" tone="pending" style={{ gap: Space.sm }}>
            <Row wrap gap={6}>
              <Badge kind="suggestion" label="AI estimate" />
              <Badge kind="simulated" label="Simulated" />
              <Badge kind="danger" label="Low confidence. Please check" />
            </Row>
            <Text variant="number">~640</Text>
            <Muted variant="small">Generic reference values. Portion assumed (the photo was not measured).</Muted>
          </Card>,
          <Card key="q" tone="info" style={{ gap: Space.sm }}>
            <Badge kind="info" label="Quick question" icon="help-circle-outline" />
            <Text variant="bodyStrong">Which exact Wendy&apos;s menu item and size was it?</Text>
            <Muted variant="small">A short answer updates the estimate.</Muted>
          </Card>,
          <Stack key="s" gap={6}>
            <Text variant="smallStrong">Source labels</Text>
            <Row wrap gap={6}>
              <Badge kind="sourced" label="Official restaurant data" />
              <Badge kind="sourced" label="Nutrition database" />
              <Badge kind="estimate" label="Visual estimate" />
              <Badge kind="neutral" label="Entered by you" icon="create-outline" />
            </Row>
          </Stack>,
        ]}
      </Columns>

      <SectionTitle>Simulated features</SectionTitle>
      <Banner kind="simulated" title="Simulated">Simulated AI, health syncing and notifications use a grey dashed style and a flask icon wherever they appear.</Banner>
      <Row wrap gap={6}>
        <Badge kind="simulated" label="Simulated AI" />
        <Badge kind="simulated" label="Simulated sync" />
        <Badge kind="simulated" label="Local delivery only" />
        <Badge kind="saved" label="Saved" />
        <Badge kind="pending" label="Needs your approval" />
        <Badge kind="suggestion" label="Suggestion" />
      </Row>
    </Screen>
  );
}
