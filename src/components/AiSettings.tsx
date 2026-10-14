import React, { useEffect, useState } from 'react';
import { Space } from '@/constants/theme';
import { Badge, Card, KeyValue, Muted, Row, Stack, Text } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { fetchAiInfo, type AiInfo } from '@/lib/ai/provider';

/** Read-only view of the AI the app owner chose. Users do not pick models. */
export function AiSettings() {
  const { sync } = useStore();
  const [info, setInfo] = useState<AiInfo>();
  const [error, setError] = useState('');
  const signedIn = Boolean(sync.session);

  useEffect(() => {
    let active = true;
    if (!sync.configured || !signedIn) return;
    fetchAiInfo()
      .then((next) => { if (active) { setInfo(next); setError(''); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'AI info is unavailable.'); });
    return () => { active = false; };
  }, [sync.configured, signedIn]);

  const badge = !sync.configured
    ? <Badge kind="simulated" label="Built-in answers" />
    : info && !info.enabled
      ? <Badge kind="neutral" label="AI switched off" />
      : <Badge kind="info" label="Shared AI via Supabase" />;

  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Coach AI</Text>
      <Row wrap gap={Space.sm}>{badge}</Row>
      {!sync.configured ? (
        <Muted variant="small">Connect the app to Supabase to enable shared AI. Until then, coaching and meal estimates use built-in answers.</Muted>
      ) : !signedIn ? (
        <Muted variant="small">Sign in to use the shared coach AI.</Muted>
      ) : info ? (
        <Stack gap={Space.sm}>
          <KeyValue k="Coach AI" v={`${info.providerLabel} · ${info.chatModelLabel}`} />
          <KeyValue k="Meal photos" v={`${info.providerLabel} · ${info.visionModelLabel}`} />
          <KeyValue k="Used today" v={`${info.usedToday} of ${info.perUserDailyLimit}`} />
          {!info.enabled ? <Muted variant="small">The app owner has switched AI off for now. Coaching and meal estimates use built-in answers.</Muted> : null}
        </Stack>
      ) : error ? (
        <Muted variant="small">{error}</Muted>
      ) : (
        <Muted variant="small">Loading…</Muted>
      )}
      <Muted variant="small">The app owner chooses the AI provider and model. Keys stay on the server and each account has a daily limit. Chat messages, a short fitness summary and reduced meal photos go through Supabase to that provider; if it is busy, you get a built-in answer instead.</Muted>
    </Card>
  );
}
