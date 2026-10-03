import React, { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Badge, Banner, Button, Card, KeyValue, PageHeader, Screen, Stack, Text } from '@/components/ui';
import { Space } from '@/constants/theme';
import { supabase } from '@/lib/sync/supabase';

type Stats = {
  accounts: number; active7Days: number; foodEntries: number;
  workoutSessions: number; chatMessages: number; aiRequestsToday: number;
  measuredAt: string;
};

export default function AdminStats() {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    const sb = supabase();
    if (!sb) { setError('Supabase is not connected.'); setBusy(false); return; }
    try {
      const { data, error: invokeError } = await sb.functions.invoke('admin-stats', { body: { action: 'stats' } });
      if (invokeError || !data || typeof data.accounts !== 'number') throw new Error('Admin access is unavailable. Sign in as the owner and check the Edge Function setup.');
      setStats(data as Stats);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load stats.'); setStats(undefined); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  return (
    <Screen maxWidth={680}>
      <PageHeader title="Admin stats" right={<Button title="Back" kind="ghost" onPress={() => router.back()} />} />
      <Card style={{ gap: Space.md }}>
        <Stack gap={Space.sm}>
          <Badge kind="info" label="Owner only" />
          <Text variant="h3">App activity</Text>
        </Stack>
        {error ? <Banner kind="warning">{error}</Banner> : null}
        {stats ? (
          <Stack gap={Space.sm}>
            <KeyValue k="Accounts" v={stats.accounts.toLocaleString()} />
            <KeyValue k="Signed in over 7 days" v={stats.active7Days.toLocaleString()} />
            <KeyValue k="Food entries" v={stats.foodEntries.toLocaleString()} />
            <KeyValue k="Workout sessions" v={stats.workoutSessions.toLocaleString()} />
            <KeyValue k="Chat messages" v={stats.chatMessages.toLocaleString()} />
            <KeyValue k="AI requests today (UTC)" v={stats.aiRequestsToday.toLocaleString()} />
            <Text variant="small">Updated {new Date(stats.measuredAt).toLocaleString()}. Stats are aggregate counts; personal records stay private.</Text>
          </Stack>
        ) : null}
        <Button title="Refresh stats" kind="secondary" loading={busy} onPress={refresh} />
      </Card>
    </Screen>
  );
}
