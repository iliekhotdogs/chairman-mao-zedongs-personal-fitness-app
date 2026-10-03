import React, { useState } from 'react';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Expandable, Muted, NumberField, PageHeader, Row, Screen, Sheet, Stack, Text, Columns } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { activityHistory } from '@/lib/activity/activity';
import { healthConnectSupport, simulatedSync } from '@/lib/activity/providers';
import { formatDateLabel, nowISO, parseISODate } from '@/lib/dates';
import { newId } from '@/lib/id';

const SUPPORT = [
  ['Android Health Connect', 'Planned, needs development build', 'Steps, active calories, exercise sessions from apps that write to Health Connect (e.g. Samsung Health, Fitbit, Google Fit, Garmin via its app, Oura, Withings).'],
  ['Manual entry', 'Available', 'Type in steps for any day.'],
  ['Simulated data', 'Available (prototype)', 'Generated sample data to try the full flow.'],
  ['Apple Health', 'Not planned', 'Requires an iPhone app; this release targets Android and web.'],
  ['Direct Garmin/Fitbit/Whoop APIs', 'Not planned yet', 'Most of these reach Health Connect through their own apps.'],
];

export default function Activity() {
  const { state, today } = useStore();
  const doAct = useAct();
  const [manualOpen, setManualOpen] = useState(false);
  const [steps, setSteps] = useState<number | undefined>();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const hc = state.integrations.find((i) => i.id === 'health_connect') ?? { id: 'health_connect' as const, status: 'not_connected' as const };
  const support = healthConnectSupport();
  const history = activityHistory(state.activity, 14, today);
  const baseline = state.targets?.baselineSteps ?? 7000;
  const isSim = hc.status === 'connected' && hc.message?.includes('Simulated');
  const missing = history.filter((h) => h.missing && h.date !== today).length;
  const dupDays = history.filter((h) => h.otherSources.length).length;

  const connectSimulated = () => {
    const r = simulatedSync(today);
    doAct({ type: 'MERGE_ACTIVITY', records: r.records });
    doAct({ type: 'SET_INTEGRATION', integration: r.integration }, 'Simulated activity synced');
  };

  const saveManual = () => {
    if (!steps) return;
    const now = nowISO();
    doAct({ type: 'MERGE_ACTIVITY', records: [{ id: newId(), date: today, source: 'manual', origin: 'Entered by you', steps: Math.round(steps), syncedAt: now, updatedAt: now }] }, 'Steps saved');
    setManualOpen(false);
  };

  return (
    <Screen>
      <PageHeader title="Activity" subtitle="Steps and activity from connected apps and devices" right={<Button title="Back" kind="ghost" onPress={() => router.back()} />} />
      <Columns ratio={[2, 3]}>
        {[
          <Stack key="l" gap={Space.lg}>
            <Card style={{ gap: Space.sm }}>
              <Row>
                <Text variant="h3" style={{ flex: 1 }}>Health Connect</Text>
                {hc.status === 'connected' ? <Badge kind={isSim ? 'simulated' : 'saved'} label={isSim ? 'Simulated connection' : 'Connected'} /> : hc.status === 'permission_denied' ? <Badge kind="danger" label="Permission denied" /> : <Badge kind="neutral" label="Not connected" />}
              </Row>
              <Muted variant="small">{support.reason}</Muted>
              {hc.lastSyncAt ? <Muted variant="small">Last sync: {new Date(hc.lastSyncAt).toLocaleString()}</Muted> : null}
              {hc.status === 'permission_denied' ? <Banner kind="warning">Health Connect permission was denied. Open Health Connect → App permissions → FitCoach to allow Steps and Active calories.</Banner> : null}
              <Row wrap gap={Space.sm}>
                {hc.status === 'connected' ? (
                  <>
                    <Button title="Sync now" kind="secondary" size="sm" icon="refresh" onPress={connectSimulated} />
                    <Button title="Disconnect" kind="danger" size="sm" onPress={() => setDisconnectOpen(true)} />
                  </>
                ) : (
                  <Button title="Use simulated data" kind="secondary" size="sm" icon="flask-outline" onPress={connectSimulated} />
                )}
                <Button title="Add steps manually" kind="secondary" size="sm" icon="create-outline" onPress={() => setManualOpen(true)} />
              </Row>
            </Card>
            <Card tone="muted" style={{ gap: 6 }}>
              <Text variant="h3">How activity affects your targets</Text>
              <Muted variant="small">Your daily target already assumes about {baseline.toLocaleString()} steps plus your planned workouts. Only activity well above that can trigger a one-day food suggestion, and only half of the device&apos;s calorie estimate is used, because wearables often overestimate.</Muted>
              <Muted variant="small">When several devices report the same day, one is counted (manual entries first, then the source with the most steps) so nothing is double counted.</Muted>
            </Card>
            <Expandable title="Supported integrations & limitations" icon="information-circle-outline">
              {SUPPORT.map(([n, s, d]) => (
                <Stack key={n} gap={2} style={{ paddingVertical: 4 }}>
                  <Row gap={6}>
                    <Text variant="smallStrong">{n}</Text>
                    <Badge kind={s.startsWith('Available') ? 'saved' : s.startsWith('Planned') ? 'pending' : 'neutral'} label={s} icon={null} />
                  </Row>
                  <Muted variant="small">{d}</Muted>
                </Stack>
              ))}
            </Expandable>
          </Stack>,
          <Stack key="r" gap={Space.lg}>
            <Card style={{ gap: Space.md }}>
              <Text variant="h3">Last 14 days</Text>
              <BarChart label="Daily steps for the last 14 days" bars={history.map((h) => ({ x: parseISODate(h.date).toLocaleDateString(undefined, { day: 'numeric' }), y: h.missing ? null : (h.steps ?? 0) }))} target={baseline} color={C.info} format={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))} />
              <Row wrap gap={6}>
                {missing ? <Badge kind="pending" label={`${missing} day${missing > 1 ? 's' : ''} with no data`} /> : null}
                {dupDays ? <Badge kind="info" label={`${dupDays} days had multiple sources (de-duplicated)`} /> : null}
              </Row>
            </Card>
            {history.length === 0 || history.every((h) => h.missing) ? (
              <Card tone="muted"><Muted>No activity yet. Connect a source or add steps manually.</Muted></Card>
            ) : (
              <Card style={{ gap: 2 }}>
                {[...history].reverse().map((h) => (
                  <Row key={h.date} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
                    <Text variant="small" style={{ width: 110 }}>{formatDateLabel(h.date, today)}</Text>
                    {h.missing ? (
                      <Muted variant="small" style={{ flex: 1 }}>No data. Device not worn or not synced.</Muted>
                    ) : (
                      <Stack gap={0} style={{ flex: 1 }}>
                        <Text variant="smallStrong">{(h.steps ?? 0).toLocaleString()} steps{h.activeKcal ? ` · ~${h.activeKcal} active kcal` : ''}</Text>
                        <Muted variant="small">
                          {h.chosen?.origin}
                          {h.otherSources.length ? ` (ignored: ${h.otherSources.map((o) => `${o.origin} ${(o.steps ?? 0).toLocaleString()}`).join(', ')})` : ''}
                        </Muted>
                      </Stack>
                    )}
                  </Row>
                ))}
              </Card>
            )}
          </Stack>,
        ]}
      </Columns>

      <Sheet visible={manualOpen} onClose={() => setManualOpen(false)} title="Add today's steps" footer={<Button title="Save" icon="checkmark" full onPress={saveManual} disabled={!steps} />}>
        <NumberField label="Steps" value={steps} onChange={setSteps} suffix="steps" autoFocus />
        <Muted variant="small">Manual entries take priority over device data for that day.</Muted>
      </Sheet>
      <Sheet
        visible={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect Health Connect?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setDisconnectOpen(false)} />
            <Button
              title="Disconnect"
              kind="danger"
              style={{ flex: 1 }}
              onPress={() => {
                doAct({ type: 'SET_INTEGRATION', integration: { id: 'health_connect', status: 'not_connected' } }, 'Disconnected');
                setDisconnectOpen(false);
              }}
            />
          </Row>
        }>
        <Muted>New activity will stop syncing. Already-synced days stay in your history. Activity-based suggestions pause until data arrives again.</Muted>
      </Sheet>
    </Screen>
  );
}
