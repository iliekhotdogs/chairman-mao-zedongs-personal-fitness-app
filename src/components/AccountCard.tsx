import React, { useEffect, useRef, useState } from 'react';
import { Platform, type TextInput } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Field, Muted, Row, Text } from './ui';
import { useStore } from '@/store/AppStore';
import { useToast } from './Toast';
import { signOut, supabase } from '@/lib/sync/supabase';
import { functionErrorMessage } from '@/lib/ai/provider';

const MIN_PASSWORD = 8;

/** Invite codes are 8 letters/digits, usually shown as ABCD-2345. */
const INVITE_CODE_LENGTH = 8;
const inviteCodeLength = (code: string) => code.replace(/[^a-z0-9]/gi, '').length;

/** Where a reset link returns: the web page on this site, or the app's deep link. */
function resetRedirectUrl(): string | undefined {
  if (Platform.OS === 'web') return typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
  return Linking.createURL('/reset-password');
}

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
  const passwordRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

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
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      // Supabase's wording when the build has a wrong or mistyped publishable key.
      setErr(/invalid api key/i.test(message)
        ? "Accounts are unavailable: this site's Supabase key is misconfigured. Check EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY and redeploy."
        : message);
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
    // The link returns to /reset-password (web) or the app, where the new password is set.
    const redirectTo = resetRedirectUrl();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
    setMode('in');
    return 'If that email has an account, a reset link is on its way.';
  });

  const passwordError = password && password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : undefined;
  const canSignIn = Boolean(email.trim() && password) && !busy;
  const canReset = email.includes('@') && !busy;
  const signUpBlocker = !email.trim().includes('@') ? 'Enter your email address.'
    : password.length < MIN_PASSWORD ? `Choose a password of at least ${MIN_PASSWORD} characters.`
    : inviteCodeLength(code) < INVITE_CODE_LENGTH ? 'Enter your invite code. Invite codes look like ABCD-2345.'
    : undefined;
  const errorText = err ? <Text variant="small" color={C.danger} accessibilityRole="alert" accessibilityLiveRegion="assertive">{err}</Text> : null;

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
          {errorText}
          {sync.error ? <Text variant="small" color={C.danger} accessibilityRole="alert">{sync.error}</Text> : null}
          {sync.lastSyncAt ? <Muted variant="small">Last sync {new Date(sync.lastSyncAt).toLocaleTimeString()}</Muted> : null}
          {sync.legacyAvailable && !state.profile ? (
            <Button title="Import earlier data from this device" kind="secondary" size="sm" onPress={() => {
              void sync.importLocalData().then(() => toast('Earlier device data imported into this account.')).catch((error) => setErr(error instanceof Error ? error.message : 'Import failed.'));
            }} />
          ) : null}
          <Row wrap gap={Space.sm}>
            <Button title="Sync now" kind="secondary" size="sm" icon="refresh" onPress={() => sync.syncNow()} />
            <Button title="Change password" kind="secondary" size="sm" icon="key-outline" onPress={() => router.push('/reset-password')} />
            {isAdmin ? <Button title="Admin" kind="secondary" size="sm" onPress={() => router.push('/admin')} /> : null}
            <Button title="Sign out" kind="ghost" size="sm" onPress={() => void signOut()} />
          </Row>
        </>
      ) : mode === 'forgot' ? (
        <>
          <Muted variant="small">Enter your account email and we&apos;ll send a link to set a new password.</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"
            returnKeyType="send" onSubmitEditing={() => { if (canReset) void sendReset(); }} />
          {errorText}
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
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"
            returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
          <Field ref={passwordRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'up' ? 'new-password' : 'password'}
            hint={mode === 'up' ? `At least ${MIN_PASSWORD} characters.` : undefined} error={mode === 'up' ? passwordError : undefined}
            returnKeyType={mode === 'up' ? 'next' : 'go'}
            onSubmitEditing={() => {
              if (mode === 'up') codeRef.current?.focus();
              else if (canSignIn) void signIn();
            }} />
          {mode === 'up' ? (
            <Field ref={codeRef} label="Invite code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-2345"
              returnKeyType="go" onSubmitEditing={() => { if (!signUpBlocker && !busy) void signUp(); }} />
          ) : null}
          {errorText}
          {mode === 'in' ? (
            <>
              <Row wrap gap={Space.sm}>
                <Button title="Sign in" loading={busy} onPress={signIn} disabled={!email || !password} />
                <Button title="I have an invite code" kind="secondary" onPress={() => { setErr(undefined); setMode('up'); }} disabled={busy} />
              </Row>
              <Button title="Forgot password?" kind="ghost" size="sm" onPress={() => { setErr(undefined); setMode('forgot'); }} />
            </>
          ) : (
            <>
              <Row wrap gap={Space.sm}>
                <Button title="Create account" loading={busy} onPress={signUp} disabled={!!signUpBlocker} />
                <Button title="Back to sign in" kind="ghost" onPress={() => { setErr(undefined); setMode('in'); }} disabled={busy} />
              </Row>
              {signUpBlocker && (email || password || code) ? <Muted variant="small" accessibilityLiveRegion="polite">{signUpBlocker}</Muted> : null}
            </>
          )}
        </>
      )}
    </Card>
  );
}
