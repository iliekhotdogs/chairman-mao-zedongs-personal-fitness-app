import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Field, Muted, Row, Text } from './ui';
import { useStore } from '@/store/AppStore';
import { useToast } from './Toast';
import { supabase } from '@/lib/sync/supabase';

/** Sign in / create account / sync status. Used in Settings and on the welcome screen. */
export function AccountCard({ intro }: { intro?: string }) {
  const { state, sync } = useStore();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [adminUserId, setAdminUserId] = useState('');

  useEffect(() => {
    let active = true;
    if (sync.session) {
      supabase()?.functions.invoke('admin-stats', { body: { action: 'check' } })
        .then(({ data, error }) => { if (active && !error && data?.admin === true) setAdminUserId(sync.session!.user.id); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [sync.session]);

  const auth = async (mode: 'in' | 'up') => {
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setErr(undefined);
    const { data, error } = mode === 'in'
      ? await sb.auth.signInWithPassword({ email: email.trim(), password })
      : await sb.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setPassword('');
      toast(mode === 'in' ? 'Signed in' : data.session ? 'Account created and signed in.' : 'Check your email to confirm your account, then sign in.');
    }
  };

  return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">Account &amp; sync</Text>
      {!sync.configured ? (
        <>
          <Badge kind="neutral" label="This device only" icon="phone-portrait-outline" />
          <Muted variant="small">Cloud accounts aren&apos;t set up yet, so your data is saved only on this device/browser. Once the Supabase backend is configured (see docs/SETUP.md), you can sign in here and your data syncs between Android and the website.</Muted>
        </>
      ) : sync.session ? (
        <>
          <Row wrap gap={6}>
            <Badge kind={sync.status === 'error' ? 'danger' : 'saved'} label={sync.status === 'syncing' ? 'Syncing…' : sync.status === 'error' ? 'Sync error' : 'Synced'} />
            <Muted variant="small">{sync.session.user.email}</Muted>
          </Row>
          {sync.error ? <Text variant="small" color={C.danger}>{sync.error}</Text> : null}
          {sync.lastSyncAt ? <Muted variant="small">Last sync {new Date(sync.lastSyncAt).toLocaleTimeString()}</Muted> : null}
          {sync.legacyAvailable && !state.profile ? (
            <Button title="Import earlier data from this device" kind="secondary" size="sm" onPress={() => {
              void sync.importLocalData().then(() => toast('Earlier device data imported into this account.')).catch((error) => setErr(error instanceof Error ? error.message : 'Import failed.'));
            }} />
          ) : null}
          <Row gap={Space.sm}>
            <Button title="Sync now" kind="secondary" size="sm" icon="refresh" onPress={() => sync.syncNow()} />
            {adminUserId === sync.session.user.id ? <Button title="Admin stats" kind="secondary" size="sm" onPress={() => router.push('/admin')} /> : null}
            <Button title="Sign out" kind="ghost" size="sm" onPress={() => supabase()?.auth.signOut()} />
          </Row>
        </>
      ) : (
        <>
          <Muted variant="small">{intro ?? 'Sign in to sync your data between your phone and computer.'}</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
          {err ? <Text variant="small" color={C.danger}>{err}</Text> : null}
          <Row gap={Space.sm}>
            <Button title="Sign in" loading={busy} onPress={() => auth('in')} disabled={!email || password.length < 8} />
            <Button title="Create account" kind="secondary" onPress={() => auth('up')} disabled={!email || password.length < 8 || busy} />
          </Row>
        </>
      )}
    </Card>
  );
}
