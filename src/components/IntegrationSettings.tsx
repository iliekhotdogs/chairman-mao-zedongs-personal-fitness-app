import React, { useState } from 'react';
import { Linking } from 'react-native';

import { Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Field, Muted, Row, Stack, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useStore } from '@/store/AppStore';
import { searchFdc } from '@/lib/nutrition/lookup';
import {
  getSupabaseConfig, getUsdaKey, removeSupabaseConfig, removeUsdaKey,
  saveSupabaseConfig, saveUsdaKey, useIntegrationConfig, validateSupabaseConfig,
} from '@/lib/integrations/config';

export function IntegrationSettings() {
  const managedProject = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { sync } = useStore();
  const toast = useToast();
  const { config } = useIntegrationConfig();
  const [url, setUrl] = useState('');
  const [publishableKey, setPublishableKey] = useState('');
  const [usdaKey, setUsdaKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string>();
  const [editingSupabase, setEditingSupabase] = useState(false);
  const [editingUsda, setEditingUsda] = useState(false);
  const effectiveSupabase = getSupabaseConfig();
  const supabaseSource = config.supabaseUrl ? 'Saved on this device' : sync.configured ? 'Build configuration' : 'Not connected';
  const usdaSource = config.usdaKey ? 'Saved on this device' : process.env.EXPO_PUBLIC_USDA_API_KEY ? 'Build configuration' : 'DEMO_KEY';

  if (managedProject) return (
    <Card style={{ gap: Space.sm }}>
      <Text variant="h3">API connections</Text>
      <Badge kind="info" label="Managed by FitCoach" />
      <Muted variant="small">Your account uses the app&apos;s Supabase project. Groq and USDA keys are kept on the server; you do not need to enter API keys.</Muted>
    </Card>
  );

  const saveSupabase = async () => {
    setBusy(true);
    try {
      await saveSupabaseConfig(url, publishableKey);
      setUrl('');
      setPublishableKey('');
      setEditingSupabase(false);
      toast('Supabase project saved. Sign in below to start syncing.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save Supabase settings.', 'error');
    } finally { setBusy(false); }
  };

  const saveUsda = async () => {
    setBusy(true);
    try {
      const trimmed = usdaKey.trim();
      if (!/^[A-Za-z0-9]{40}$/.test(trimmed)) throw new Error('Paste only the 40-character API key from your USDA email.');
      const results = await searchFdc('apple', trimmed);
      await saveUsdaKey(usdaKey);
      setUsdaKey('');
      setEditingUsda(false);
      setTestResult(`Your USDA key works: ${results.length} results for apple.`);
      toast('USDA key verified and saved on this device.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not verify USDA key.';
      setTestResult(message);
      toast(message, 'error');
    } finally { setBusy(false); }
  };

  const testUsda = async () => {
    setBusy(true);
    setTestResult(undefined);
    try {
      const results = await searchFdc('apple', getUsdaKey());
      setTestResult(`${config.usdaKey ? 'Your saved USDA key' : usdaSource === 'DEMO_KEY' ? 'DEMO_KEY' : 'Build-configured USDA key'} works: ${results.length} results for apple.`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'USDA connection failed.');
    } finally { setBusy(false); }
  };

  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">API connections</Text>
      <Muted variant="small">These settings stay on this device. On the web, anyone with access to this browser profile can read saved keys. Only enter Supabase publishable keys here.</Muted>

      <Stack gap={Space.sm}>
        <Row wrap gap={Space.sm}>
          <Text variant="bodyStrong">Supabase sync</Text>
          <Badge kind={sync.configured ? 'info' : 'neutral'} label={supabaseSource} />
        </Row>
        {sync.configured ? <Muted variant="small">Project: {effectiveSupabase.url}</Muted> : <Muted variant="small">Connect your project to enable accounts and cross-device sync.</Muted>}
        {sync.session ? <Banner kind="info">Sign out below before changing the Supabase project.</Banner> : null}
        {!sync.session && (editingSupabase || !sync.configured) ? (
          <Stack gap={Space.sm}>
            <Field label="Project URL" value={url} onChangeText={setUrl} placeholder="https://your-project.supabase.co" autoCapitalize="none" autoCorrect={false} />
            <Field label="Publishable key" value={publishableKey} onChangeText={setPublishableKey} placeholder="sb_publishable_…" secureTextEntry autoCapitalize="none" autoCorrect={false} />
            {url && publishableKey && validateSupabaseConfig(url, publishableKey) ? <Muted variant="small">{validateSupabaseConfig(url, publishableKey)}</Muted> : null}
            <Row wrap gap={Space.sm}>
              <Button title="Save Supabase" size="sm" loading={busy} disabled={busy || !!validateSupabaseConfig(url, publishableKey)} onPress={saveSupabase} />
              {editingSupabase ? <Button title="Cancel" kind="ghost" size="sm" onPress={() => { setEditingSupabase(false); setUrl(''); setPublishableKey(''); }} /> : null}
            </Row>
          </Stack>
        ) : !sync.session ? (
          <Row wrap gap={Space.sm}>
            <Button title="Change project" kind="secondary" size="sm" onPress={() => setEditingSupabase(true)} />
            {config.supabaseUrl ? <Button title="Remove saved project" kind="danger" size="sm" onPress={() => { void removeSupabaseConfig().then(() => toast('Saved Supabase project removed.')).catch(() => toast('Could not remove Supabase settings.', 'error')); }} /> : null}
          </Row>
        ) : null}
      </Stack>

      <Stack gap={Space.sm}>
        <Row wrap gap={Space.sm}>
          <Text variant="bodyStrong">USDA FoodData Central</Text>
          <Badge kind={usdaSource === 'DEMO_KEY' ? 'neutral' : 'info'} label={usdaSource} />
        </Row>
        <Muted variant="small">Used for manual food search and to source AI photo estimates. The demo key has strict rate limits.</Muted>
        {editingUsda || !config.usdaKey ? (
          <Stack gap={Space.sm}>
            <Field label="USDA API key" value={usdaKey} onChangeText={setUsdaKey} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <Row wrap gap={Space.sm}>
              <Button title="Save USDA key" size="sm" loading={busy} disabled={busy || !usdaKey.trim()} onPress={saveUsda} />
              {editingUsda ? <Button title="Cancel" kind="ghost" size="sm" onPress={() => { setEditingUsda(false); setUsdaKey(''); }} /> : null}
            </Row>
          </Stack>
        ) : (
          <Row wrap gap={Space.sm}>
            <Button title="Change key" kind="secondary" size="sm" onPress={() => setEditingUsda(true)} />
            <Button title="Remove key" kind="danger" size="sm" onPress={() => { void removeUsdaKey().then(() => toast('Saved USDA key removed.')).catch(() => toast('Could not remove USDA key.', 'error')); }} />
          </Row>
        )}
        <Row wrap gap={Space.sm}>
          <Button title={config.usdaKey ? 'Test saved USDA key' : usdaSource === 'DEMO_KEY' ? 'Test DEMO_KEY' : 'Test build USDA key'} kind="secondary" size="sm" loading={busy} onPress={testUsda} />
          <Button title="Get a USDA key" kind="ghost" size="sm" onPress={() => Linking.openURL('https://fdc.nal.usda.gov/api-key-signup')} />
        </Row>
        {testResult ? <Banner kind={testResult.includes(' works:') ? 'success' : 'warning'}>{testResult}</Banner> : null}
      </Stack>

      <Muted variant="small">For a shared-account build, put the Groq key in Supabase Edge Function secrets; see docs/SETUP.md.</Muted>
    </Card>
  );
}
