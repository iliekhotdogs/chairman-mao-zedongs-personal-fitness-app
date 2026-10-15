import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Field, Muted, Row, Sheet, Text } from './ui';
import { useStore } from '@/store/AppStore';
import { useToast } from './Toast';
import { supabase } from '@/lib/sync/supabase';

/** Sign in / create account / sync status. Used in Settings and on the welcome screen. */
export function AccountCard({ intro, flat }: { intro?: string; flat?: boolean }) {
  const { state, sync } = useStore();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [adminUserId, setAdminUserId] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  const forgot = async () => {
    if (!email.trim()) { setErr('Enter your email above first.'); return; }
    const { error } = (await supabase()?.auth.resetPasswordForEmail(email.trim())) ?? {};
    if (error) setErr(error.message);
    else { setErr(undefined); toast('If that email has an account, a reset link is on its way.'); }
  };

  const doSignOut = async () => {
    setSigningOut(true);
    const { remoteOk } = await sync.signOut();
    setSigningOut(false);
    setConfirmOut(false);
    router.replace('/onboarding');
    if (!remoteOk) toast('Signed out on this device. We could not reach the server, so unsynced changes may not be saved.', 'error');
  };

  return (
    <Card style={[{ gap: Space.sm }, flat ? { borderWidth: 0, padding: 0, backgroundColor: 'transparent' } : null]}>
      {flat ? null : <Text variant="h3">Account &amp; sync</Text>}
      {sync.session ? <Button title="Sign out" kind="secondary" size="sm" icon="log-out-outline" onPress={() => setConfirmOut(true)} /> : null}
      <Sheet
        visible={confirmOut}
        onClose={() => !signingOut && setConfirmOut(false)}
        title="Sign out?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" style={{ flex: 1 }} disabled={signingOut} onPress={() => setConfirmOut(false)} />
            <Button title="Sign out" kind="danger" style={{ flex: 1 }} loading={signingOut} onPress={doSignOut} />
          </Row>
        }>
        <Muted>Your changes are synced first, then data for this account is removed from this device. Sign in again to get it back.</Muted>
      </Sheet>
      {!sync.configured ? (
        <>
          <Badge kind="neutral" label="This device only" icon="phone-portrait-outline" />
          <Muted variant="small">Accounts aren&apos;t available in this version, so your data is saved only on this device.</Muted>
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
          </Row>
        </>
      ) : (
        <>
          <Muted variant="small">{intro ?? 'Sign in to sync your data between your phone and computer.'}</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
          <Muted variant="small">Password must be at least 8 characters.</Muted>
          {err ? <Text variant="small" color={C.danger}>{err}</Text> : null}
          <Button title="Forgot password?" kind="ghost" size="sm" onPress={forgot} />
          <Row gap={Space.sm}>
            <Button title="Sign in" loading={busy} onPress={() => auth('in')} disabled={!email || password.length < 8} />
            <Button title="Create account" kind="secondary" onPress={() => auth('up')} disabled={!email || password.length < 8 || busy} />
          </Row>
        </>
      )}
    </Card>
  );
}
