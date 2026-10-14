import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Field, Muted, Row, Text } from './ui';
import { useStore } from '@/store/AppStore';
import { useToast } from './Toast';
import { supabase } from '@/lib/sync/supabase';
import { functionErrorMessage } from '@/lib/ai/provider';

const MIN_PASSWORD = 8;

/** A password-reset link signs the user in with type=recovery in the URL hash.
 * Supabase consumes the hash on start-up, often before this card mounts, so it
 * is read once at module load as well as from the PASSWORD_RECOVERY event. */
let recoveryFromUrl = Platform.OS === 'web' && typeof window !== 'undefined' && /type=recovery/.test(window.location.hash);

type Mode = 'in' | 'up' | 'forgot';

/** Sign in / invite signup / password reset / sync status. Used in Settings and on the welcome screen. */
export function AccountCard({ intro }: { intro?: string }) {
  const { state, sync } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [recovery, setRecovery] = useState(recoveryFromUrl);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, [sync.configured]);

  useEffect(() => {
    let active = true;
    if (sync.session) {
      supabase()?.functions.invoke('admin-stats', { body: { action: 'check' } })
        .then(({ data, error }) => { if (active) setIsAdmin(!error && data?.admin === true); })
        .catch(() => {});
    }
    return () => { active = false; setIsAdmin(false); };
  }, [sync.session]);

  const run = async (task: () => Promise<string | void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      const message = await task();
      if (message) toast(message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const signIn = () => run(async () => {
    const sb = supabase();
    if (!sb) return;
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    setPassword('');
    return 'Signed in';
  });

  const signUp = () => run(async () => {
    const sb = supabase();
    if (!sb) return;
    const { error } = await sb.functions.invoke('redeem-invite', { body: { email: email.trim(), password, code: code.trim() } });
    if (error) throw new Error(await functionErrorMessage(error, 'Could not create the account.'));
    const { error: signInError } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) throw new Error(`Account created, but sign-in failed: ${signInError.message}`);
    setPassword('');
    setCode('');
    return 'Account created and signed in.';
  });

  const sendReset = () => run(async () => {
    const sb = supabase();
    if (!sb) return;
    // On web the link returns to this site's Settings, where the new password is set.
    const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/settings` : undefined;
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
    setMode('in');
    return 'If that email has an account, a reset link is on its way.';
  });

  const saveNewPassword = () => run(async () => {
    const sb = supabase();
    if (!sb) return;
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    recoveryFromUrl = false;
    setRecovery(false);
    setNewPassword('');
    return 'Password updated.';
  });

  const passwordError = password && password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : undefined;

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
          {recovery ? (
            <>
              <Text variant="smallStrong">Set a new password</Text>
              <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoComplete="new-password"
                error={newPassword && newPassword.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : undefined} />
              {err ? <Text variant="small" color={C.danger}>{err}</Text> : null}
              <Row gap={Space.sm}>
                <Button title="Save password" size="sm" loading={busy} disabled={newPassword.length < MIN_PASSWORD} onPress={saveNewPassword} />
                <Button title="Not now" kind="ghost" size="sm" onPress={() => { recoveryFromUrl = false; setRecovery(false); }} />
              </Row>
            </>
          ) : null}
          {sync.error ? <Text variant="small" color={C.danger}>{sync.error}</Text> : null}
          {sync.lastSyncAt ? <Muted variant="small">Last sync {new Date(sync.lastSyncAt).toLocaleTimeString()}</Muted> : null}
          {sync.legacyAvailable && !state.profile ? (
            <Button title="Import earlier data from this device" kind="secondary" size="sm" onPress={() => {
              void sync.importLocalData().then(() => toast('Earlier device data imported into this account.')).catch((error) => setErr(error instanceof Error ? error.message : 'Import failed.'));
            }} />
          ) : null}
          <Row wrap gap={Space.sm}>
            <Button title="Sync now" kind="secondary" size="sm" icon="refresh" onPress={() => sync.syncNow()} />
            {isAdmin ? <Button title="Admin" kind="secondary" size="sm" onPress={() => router.push('/admin')} /> : null}
            <Button title="Sign out" kind="ghost" size="sm" onPress={() => supabase()?.auth.signOut()} />
          </Row>
        </>
      ) : mode === 'forgot' ? (
        <>
          <Muted variant="small">Enter your account email and we&apos;ll send a link to set a new password.</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          {err ? <Text variant="small" color={C.danger}>{err}</Text> : null}
          <Row gap={Space.sm}>
            <Button title="Send reset link" loading={busy} onPress={sendReset} disabled={!email.includes('@')} />
            <Button title="Back to sign in" kind="ghost" onPress={() => { setErr(undefined); setMode('in'); }} />
          </Row>
        </>
      ) : (
        <>
          <Muted variant="small">{mode === 'up'
            ? 'FitCoach is invite-only. Enter the invite code you were given to create your account.'
            : intro ?? 'Sign in to sync your data between your phone and computer.'}</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'up' ? 'new-password' : 'password'}
            hint={mode === 'up' ? `At least ${MIN_PASSWORD} characters.` : undefined} error={mode === 'up' ? passwordError : undefined} />
          {mode === 'up' ? (
            <Field label="Invite code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-2345" />
          ) : null}
          {err ? <Text variant="small" color={C.danger}>{err}</Text> : null}
          {mode === 'in' ? (
            <>
              <Row wrap gap={Space.sm}>
                <Button title="Sign in" loading={busy} onPress={signIn} disabled={!email || !password} />
                <Button title="I have an invite code" kind="secondary" onPress={() => { setErr(undefined); setMode('up'); }} disabled={busy} />
              </Row>
              <Button title="Forgot password?" kind="ghost" size="sm" onPress={() => { setErr(undefined); setMode('forgot'); }} />
            </>
          ) : (
            <Row wrap gap={Space.sm}>
              <Button title="Create account" loading={busy} onPress={signUp} disabled={!email || password.length < MIN_PASSWORD || code.trim().length < 8} />
              <Button title="Back to sign in" kind="ghost" onPress={() => { setErr(undefined); setMode('in'); }} disabled={busy} />
            </Row>
          )}
        </>
      )}
    </Card>
  );
}
