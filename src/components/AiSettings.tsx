import React, { useState } from 'react';
import { Linking } from 'react-native';

import { Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Chip, Expandable, Field, KeyValue, Muted, Row, Segmented, Stack, Text } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { useAct, useToast } from '@/components/Toast';
import { useAiEngine } from '@/hooks/useAiEngine';
import { looksLikeNvidiaKey, maskKey, removeApiKey, saveApiKey, useApiKey } from '@/lib/ai/apiKey';
import { NVIDIA_DEFAULT_MODELS, NVIDIA_SUGGESTED_MODELS, testNvidia, type ModelTest } from '@/lib/ai/nvidia';
import { aiModels } from '@/lib/ai/provider';
import { nowISO } from '@/lib/dates';

type TestResult = { vision: ModelTest; chat: ModelTest };

/**
 * Settings → AI. Paste an NVIDIA API key to use real AI; with no key the app uses its
 * built-in (pre-determined) answers. The key never leaves this device except to NVIDIA.
 */
export function AiSettings() {
  const { state, sync } = useStore();
  const doAct = useAct();
  const toast = useToast();
  const engine = useAiEngine();
  const { key } = useApiKey();
  const models = aiModels(state.settings);

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = async (k: string) => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testNvidia(k, models));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const k = draft.trim();
    if (!k) return;
    setSaving(true);
    try {
      await saveApiKey(k);
      setDraft('');
      toast('NVIDIA key saved on this device');
      void runTest(k);
    } catch {
      toast("The key couldn't be saved on this device.", 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await removeApiKey();
    setResult(null);
    toast('Key removed. Using built-in answers.', 'info');
  };

  const setModel = (which: 'vision' | 'chat', id: string) => {
    const v = id.trim();
    if (!v || v === models[which]) return;
    setResult(null);
    doAct({ type: 'UPDATE_SETTINGS', patch: { aiModels: { ...models, [which]: v } }, now: nowISO() });
  };

  return (
    <Card style={{ gap: Space.md }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>AI</Text>
        {engine === 'nvidia' ? <Badge kind="info" label="Using your NVIDIA key" /> : engine === 'server' ? <Badge kind="info" label="Server AI" /> : <Badge kind="simulated" label="Built-in answers" />}
      </Row>

      {key ? (
        <Stack gap={Space.sm}>
          <KeyValue k="NVIDIA API key" v={maskKey(key)} />
          <Row wrap gap={Space.sm}>
            <Button title="Test connection" kind="secondary" size="sm" icon="pulse-outline" loading={testing} onPress={() => runTest(key)} />
            <Button title="Remove key" kind="danger" size="sm" onPress={remove} />
          </Row>
        </Stack>
      ) : (
        <Stack gap={Space.sm}>
          <Muted variant="small">
            Without a key, photo estimates and coach replies use built-in answers made on this device (free, but they can&apos;t really see photos or hold a conversation). Paste an NVIDIA API key to use real AI.
          </Muted>
          <Field
            label="NVIDIA API key"
            value={draft}
            onChangeText={setDraft}
            placeholder="nvapi-…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            error={draft.trim() && !looksLikeNvidiaKey(draft) ? 'NVIDIA keys usually start with "nvapi-". Check you copied the whole key.' : undefined}
            hint="Get one free at build.nvidia.com → sign in → any model → Get API Key."
          />
          <Row wrap gap={Space.sm}>
            <Button title="Save key" icon="key-outline" size="sm" loading={saving} disabled={!draft.trim()} onPress={save} />
            <Button title="Open build.nvidia.com" kind="ghost" size="sm" icon="open-outline" onPress={() => Linking.openURL('https://build.nvidia.com')} />
          </Row>
        </Stack>
      )}

      {testing ? (
        <Banner kind="info" title="Testing both models…">NVIDIA&apos;s free models can take up to a minute to answer when they&apos;re busy. Please wait.</Banner>
      ) : null}
      {result ? (
        result.vision.ok && result.chat.ok ? (
          <Banner kind="success" title="Connected">
            {`Photo model answered in ${result.vision.seconds} s, chat model in ${result.chat.seconds} s. Photo estimates and coach chat now use NVIDIA.`}
          </Banner>
        ) : (
          <Banner kind="warning" title="Something isn't working yet">
            {[
              result.vision.ok ? `Photo model: OK (${result.vision.seconds} s)` : `Photo model (after ${result.vision.seconds} s): ${result.vision.error}`,
              result.chat.ok ? `Chat model: OK (${result.chat.seconds} s)` : `Chat model (after ${result.chat.seconds} s): ${result.chat.error}`,
              'Until it works, the app uses its built-in answers for the failing part.',
            ].join('\n')}
          </Banner>
        )
      ) : null}

      <Expandable title="Models (one for photos, one for chat)" icon="hardware-chip-outline">
        <ModelPicker label="Photo model (must understand images)" value={models.vision} suggestions={NVIDIA_SUGGESTED_MODELS.vision} defaultId={NVIDIA_DEFAULT_MODELS.vision} onSave={(v) => setModel('vision', v)} />
        <ModelPicker label="Chat model (coach conversation)" value={models.chat} suggestions={NVIDIA_SUGGESTED_MODELS.chat} defaultId={NVIDIA_DEFAULT_MODELS.chat} onSave={(v) => setModel('chat', v)} />
        <Muted variant="small">Any model id from build.nvidia.com works. After changing one, press Test connection.</Muted>
      </Expandable>

      <Expandable title="Privacy, cost & safety" icon="shield-checkmark-outline">
        <Muted variant="small">• Your key is stored only on this device ({'Android: encrypted secure storage; web: this browser'}). It is never synced, exported, or sent anywhere except NVIDIA.</Muted>
        <Muted variant="small">• When the AI is used, the photo (shrunk to ~768 px) or your message plus a short summary of your goal, today&apos;s numbers and plan is sent to NVIDIA.</Muted>
        <Muted variant="small">• NVIDIA&apos;s free developer credits cover each request; check your balance at build.nvidia.com. NVIDIA&apos;s free API is meant for development and testing, not for a public app.</Muted>
        <Muted variant="small">• Whatever the AI says, nothing in your log or plan changes until you press Accept. Emergencies (chest pain, fainting, trouble breathing) always get fixed safety advice.</Muted>
        <Muted variant="small">• If NVIDIA fails (wrong key, no internet, out of credits), you get the built-in answer instead, with a note saying why.</Muted>
      </Expandable>

      {!key ? (
        <Expandable title="Advanced: Claude via your own server" icon="server-outline">
          <Segmented
            label="Engine when no key is saved"
            value={state.settings.aiMode}
            onChange={(aiMode) => doAct({ type: 'UPDATE_SETTINGS', patch: { aiMode }, now: nowISO() })}
            options={[{ value: 'simulated', label: 'Built-in answers' }, { value: 'server', label: 'Server (Claude)' }]}
          />
          {state.settings.aiMode === 'server' && (!sync.configured || !sync.session) ? (
            <Banner kind="warning" title="Server AI isn't available yet">It needs the Supabase backend with the AI function deployed, and you need to be signed in. See docs/SETUP.md.</Banner>
          ) : null}
        </Expandable>
      ) : null}
    </Card>
  );
}

function ModelPicker({ label, value, suggestions, defaultId, onSave }: { label: string; value: string; suggestions: string[]; defaultId: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <Stack gap={6}>
      <Field label={label} value={text} onChangeText={setText} onBlur={() => onSave(text)} onSubmitEditing={() => onSave(text)} autoCapitalize="none" autoCorrect={false} />
      <Row wrap gap={6}>
        {suggestions.map((s) => (
          <Chip
            key={s}
            label={s === defaultId ? `${s} (default)` : s}
            selected={value === s}
            onPress={() => {
              setText(s);
              onSave(s);
            }}
          />
        ))}
      </Row>
    </Stack>
  );
}
