import React, { useEffect, useRef, useState } from 'react';
import { Platform, type TextInput } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Field, Muted, Row, Sheet, Text } from './ui';
import { useStore } from '@/store/AppStore';
import { useToast } from './Toast';
import { supabase } from '@/lib/sync/supabase';
import { functionErrorMessage } from '@/lib/ai/provider';
import { log } from '@/lib/log';
import { authErrorMessage, friendlySyncError, isEmail } from '@/lib/uiText';

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
export function AccountCard({ intro, flat }: { intro?: string; flat?: boolean }) {
  const { state, sync } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    let active = true;
    const uid = sync.session?.user.id;
    // Own profiles row (RLS: owner read) decides whether to show the button; /admin re-checks on the server.
    if (uid) {
      supabase()?.from('profiles').select('role, disabled').eq('user_id', uid).maybeSingle()
        .then(({ data, error }) => {
          if (error) log.warn('account', 'Could not read account role.', error);
          if (active) setIsAdmin(data?.role === 'admin' && !data.disabled);
        });
    }
    return () => { active = false; setIsAdmin(false); };
  }, [sync.session]);

  const run = async (task: () => Promise<string | void>) => {
    setBusy(true);
    setErr(undefined);
    setNotice(undefined);
    try {
      const message = await task();
      if (message) toast(message);
    } catch (e) {
      setErr(authErrorMessage(e instanceof Error ? e.message : 'Something went wrong.'));
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
    setNotice('If that email has an account, a reset link is on its way. Check your inbox, then sign in with your new password.');
  });

  const doSignOut = async () => {
    setSigningOut(true);
    const { remoteOk } = await sync.signOut();
    setSigningOut(false);
    setConfirmOut(false);
    if (!remoteOk) toast('Signed out on this device. We could not reach the server, so unsynced changes may not be saved.', 'error');
  };

  const passwordError = password && password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : undefined;
  const emailOk = isEmail(email);
  const canSignIn = emailOk && Boolean(password) && !busy;
  const canReset = emailOk && !busy;
  const signInBlocker = !email.trim() ? 'Enter your email and password to sign in.'
    : !emailOk ? 'Enter a valid email address, like name@example.com.'
    : !password ? 'Enter your password to sign in.'
    : undefined;
  // Offline (or the last sync failed): signing out can't upload, and the wipe drops anything unsent.
  const cantFlush = sync.status === 'offline' || sync.status === 'error';
  const signUpBlocker = !emailOk ? 'Enter your email address.'
    : password.length < MIN_PASSWORD ? `Choose a password of at least ${MIN_PASSWORD} characters.`
    : inviteCodeLength(code) < INVITE_CODE_LENGTH ? 'Enter your invite code. Invite codes look like ABCD-2345.'
    : undefined;
  const errorText = err ? <Text variant="small" color={C.danger} accessibilityRole="alert" accessibilityLiveRegion="assertive">{err}</Text>
    : notice ? <Text variant="small" color={C.success} accessibilityLiveRegion="polite">{notice}</Text> : null;

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
            <Button title={cantFlush ? 'Sign out anyway' : 'Sign out'} kind="danger" style={{ flex: 1 }} loading={signingOut} onPress={doSignOut} />
          </Row>
        }>
        <Muted>{cantFlush
          ? sync.status === 'offline'
            ? "You're offline. Unsynced changes on this device will be lost."
            : "We can't reach the server right now. Unsynced changes on this device will be lost."
          : 'Your changes are synced first, then data for this account is removed from this device. Sign in again to get it back.'}</Muted>
      </Sheet>
      {!sync.configured ? (
        <>
          <Badge kind="neutral" label="This device only" icon="phone-portrait-outline" />
          <Muted variant="small">Accounts aren&apos;t available in this version, so your data is saved only on this device.</Muted>
        </>
      ) : sync.session ? (
        <>
          <Row wrap gap={6}>
            <Badge kind={sync.status === 'error' ? 'danger' : sync.status === 'offline' ? 'pending' : 'saved'} label={sync.status === 'syncing' ? 'Syncing…' : sync.status === 'error' ? 'Sync error' : sync.status === 'offline' ? 'Offline' : 'Synced'} icon={sync.status === 'offline' ? 'cloud-offline-outline' : undefined} />
            <Muted variant="small">{sync.session.user.email}</Muted>
          </Row>
          {errorText}
          {sync.error ? <Text variant="small" color={C.danger} accessibilityRole="alert">{friendlySyncError(sync.error)}</Text> : null}
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
          </Row>
        </>
      ) : mode === 'forgot' ? (
        <>
          <Muted variant="small">Enter your account email and we&apos;ll send a link to set a new password.</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="name@example.com"
            error={email.trim() && !emailOk ? 'Enter a valid email address.' : undefined}
            returnKeyType="send" onSubmitEditing={() => { if (canReset) void sendReset(); }} />
          {errorText}
          <Row gap={Space.sm}>
            <Button title="Send reset link" loading={busy} onPress={sendReset} disabled={!emailOk} />
            <Button title="Back to sign in" kind="ghost" onPress={() => { setErr(undefined); setMode('in'); }} />
          </Row>
        </>
      ) : (
        <>
          <Muted variant="small">{mode === 'up'
            ? 'FitCoach is invite-only. Enter the invite code you were given to create your account.'
            : intro ?? 'Sign in to sync your data between your phone and computer.'}</Muted>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="name@example.com"
            returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
          <Field ref={passwordRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder={mode === 'up' ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
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
                <Button title="Sign in" loading={busy} onPress={signIn} disabled={!canSignIn} />
                <Button title="I have an invite code" kind="secondary" onPress={() => { setErr(undefined); setMode('up'); }} disabled={busy} />
              </Row>
              {signInBlocker ? <Muted variant="small" accessibilityLiveRegion="polite">{signInBlocker}</Muted> : null}
              <Button title="Forgot password?" kind="ghost" size="sm" onPress={() => { setErr(undefined); setNotice(undefined); setMode('forgot'); }} />
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
