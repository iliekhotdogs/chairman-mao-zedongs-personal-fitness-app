import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, type TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Button, Card, Field, LoadingState, Muted, Row, Screen, Text } from '@/components/ui';
import { LogoMark } from '@/components/Brand';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store/AppStore';
import { clearPasswordRecovery, isPasswordRecoveryPending, supabase } from '@/lib/sync/supabase';
import { log } from '@/lib/log';

const MIN_PASSWORD = 8;

/** Error details Supabase puts in the URL when a link is expired or already used. */
function linkErrorFromUrl(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const description = params.get('error_description') ?? hash.get('error_description');
  const code = params.get('error_code') ?? hash.get('error_code');
  if (code === 'otp_expired') return 'This reset link has expired or was already used. Request a new one.';
  return description ? description.replace(/\+/g, ' ') : undefined;
}

/** Read once at load: Supabase removes ?code= from the URL after exchanging it. */
const arrivedWithCode = Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code');

/**
 * Set a new password after following a reset link. Lives outside (main) so the
 * onboarding redirect can't swallow it, and is reachable while signed out so an
 * unusable link can explain itself.
 */
export default function ResetPassword() {
  const { sync } = useStore();
  const toast = useToast();
  const params = useLocalSearchParams<{ code?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [linkError, setLinkError] = useState(linkErrorFromUrl);
  // Native: the app opens fitcoach://reset-password?code=… and exchanges the code itself.
  const nativeCode = Platform.OS !== 'web' && typeof params.code === 'string' ? params.code : undefined;
  const [exchanging, setExchanging] = useState(Boolean(nativeCode));
  const confirmRef = useRef<TextInput>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    const sb = supabase();
    if (!nativeCode || !sb || exchanged.current) return;
    exchanged.current = true;
    sb.auth.exchangeCodeForSession(nativeCode)
      .then(({ error }) => {
        if (error) {
          log.warn('auth', 'Reset link code exchange failed.', error);
          setLinkError('This reset link could not be used. It may have expired, or it was requested on another device. Request a new one.');
        }
      })
      .finally(() => setExchanging(false));
  }, [nativeCode]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave = password.length >= MIN_PASSWORD && confirm === password && !busy;

  const save = async () => {
    if (!canSave) return;
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setErr(undefined);
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      clearPasswordRecovery();
      setPassword('');
      setConfirm('');
      toast('Password updated.');
      router.replace('/');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not update the password.';
      setErr(/reauthenticat|recent/i.test(message)
        ? 'For security, sign in again before changing your password, or use a fresh reset link.'
        : message);
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    clearPasswordRecovery();
    router.replace('/');
  };

  let body: React.ReactNode;
  if (!sync.configured) {
    body = (
      <>
        <Text variant="h2">Accounts aren&apos;t set up</Text>
        <Muted>This copy of FitCoach keeps data on this device only, so there is no password to reset.</Muted>
        <Button title="Go to FitCoach" onPress={() => router.replace('/')} />
      </>
    );
  } else if (exchanging) {
    body = <LoadingState label="Checking your reset link…" lines={2} />;
  } else if (!sync.session) {
    body = (
      <>
        <Text variant="h2">This link can&apos;t be used</Text>
        <View accessibilityRole="alert">
          <Muted>
            {linkError ?? (arrivedWithCode || nativeCode
              ? 'Reset links only work in the browser or app where you asked for them, and expire after a short time. Request a new link from the sign-in screen.'
              : 'Open the reset link from your email to set a new password, or request a new link from the sign-in screen.')}
          </Muted>
        </View>
        <Button title="Back to sign in" onPress={() => router.replace('/')} />
      </>
    );
  } else {
    const recovering = isPasswordRecoveryPending();
    body = (
      <>
        <Text variant="h2">{recovering ? 'Set a new password' : 'Change your password'}</Text>
        <Muted>Signed in as {sync.session.user.email}. Use at least {MIN_PASSWORD} characters.</Muted>
        <Field label="New password" value={password} onChangeText={(t) => { setPassword(t); setErr(undefined); }}
          secureTextEntry={!show} autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" autoCorrect={false}
          returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()}
          error={tooShort ? `At least ${MIN_PASSWORD} characters.` : undefined} />
        <Field ref={confirmRef} label="Confirm new password" value={confirm} onChangeText={(t) => { setConfirm(t); setErr(undefined); }}
          secureTextEntry={!show} autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" autoCorrect={false}
          returnKeyType="done" onSubmitEditing={() => void save()}
          error={mismatch ? "The passwords don't match." : undefined} />
        <Button title={show ? 'Hide passwords' : 'Show passwords'} kind="ghost" size="sm" icon={show ? 'eye-off-outline' : 'eye-outline'}
          onPress={() => setShow((v) => !v)} accessibilityState={{ checked: show }} />
        {err ? <Text variant="small" color={C.danger} accessibilityRole="alert">{err}</Text> : null}
        <Row wrap gap={Space.sm}>
          <Button title="Save password" loading={busy} disabled={!canSave} onPress={() => void save()} />
          <Button title={recovering ? 'Not now' : 'Cancel'} kind="ghost" onPress={leave} disabled={busy} />
        </Row>
      </>
    );
  }

  return (
    <Screen size="narrow" maxWidth={520}>
      <Row gap={Space.sm}>
        <LogoMark />
        <Text variant="h3">FitCoach</Text>
      </Row>
      <Card style={{ gap: Space.md }}>{body}</Card>
    </Screen>
  );
}
