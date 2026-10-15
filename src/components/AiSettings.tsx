import React, { useEffect, useState } from 'react';
import { Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Chip, KeyValue, Muted, Row, Stack, Text } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { fetchAiInfo, saveAiPreference, type AiInfo } from '@/lib/ai/provider';
import { useToast } from '@/components/Toast';

export function AiSettings() {
  const { sync } = useStore();
  const toast = useToast();
  const [info, setInfo] = useState<AiInfo>();
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const signedIn = Boolean(sync.session);

  useEffect(() => {
    let active = true;
    if (!sync.configured || !signedIn) return;
    fetchAiInfo()
      .then((next) => { if (active) { setInfo(next); setProvider(next.provider); setModel(next.chatModel); setError(''); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'AI info is unavailable.'); });
    return () => { active = false; };
  }, [sync.configured, signedIn]);

  const badge = !sync.configured
    ? <Badge kind="simulated" label="Built-in answers" />
    : info && !info.enabled
      ? <Badge kind="neutral" label="AI switched off" />
      : <Badge kind="info" label="Shared AI via Supabase" />;
  const selected = info?.options?.find((option) => option.id === provider);
  const modelHint = (id: string) => ({
    'openai/gpt-oss-20b': 'Fastest, lowest cost', 'openai/gpt-oss-120b': 'Stronger reasoning', 'qwen/qwen3.8-27b': 'Reads meal photos',
    'z-ai/glm-5.3-flash': 'Fast, reads photos', 'nvidia/nemotron-3.5-lightning': 'Fast text chat', 'deepseek/deepseek-v4.1-flash': 'Stronger, reads photos',
  } as Record<string, string>)[id] ?? '';
  const save = async () => {
    setSaving(true); setError('');
    try { const next = await saveAiPreference(provider, model); setInfo(next); toast('AI choice saved'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save AI choice.'); }
    finally { setSaving(false); }
  };

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
          {info.allowUserChoice ? <>
            <Text variant="smallStrong">AI provider</Text>
            <Row wrap gap={Space.sm}>{info.options.map((option) => <Chip key={option.id} label={option.keyConfigured ? option.label : `${option.label} · Not available`} selected={provider === option.id} disabled={!option.keyConfigured} onPress={() => {
              setProvider(option.id); setModel(option.models[0]?.id ?? '');
            }} />)}</Row>
            {selected?.keyConfigured ? <>
              <Text variant="smallStrong">Chat model</Text>
              <Stack gap={Space.sm}>{selected.models.map((choice) => <Chip key={choice.id} label={`${choice.label} · ${modelHint(choice.id)}`} selected={model === choice.id} onPress={() => setModel(choice.id)} />)}</Stack>
              {provider === 'groq' ? <Muted variant="small">Meal photos use Qwen3.8 27B on Groq.</Muted> : null}
              {provider === 'openrouter' && model === 'nvidia/nemotron-3.5-lightning' ? <Muted variant="small">Meal photos use GLM 5.3 Flash on OpenRouter.</Muted> : null}
              <Button title="Save AI choice" loading={saving} disabled={provider === info.provider && model === info.chatModel} onPress={save} />
            </> : null}
          </> : null}
          {!info.enabled ? <Muted variant="small">The app owner has switched AI off for now. Coaching and meal estimates use built-in answers.</Muted> : null}
          {error ? <Banner kind="warning">{error}</Banner> : null}
        </Stack>
      ) : error ? (
        <Muted variant="small">{error}</Muted>
      ) : (
        <Muted variant="small">Loading…</Muted>
      )}
      <Muted variant="small">Keys stay on the server and each account has a daily limit. Chat messages, a short fitness summary and reduced meal photos go through Supabase to the selected provider; if it is busy, you get a built-in answer instead.</Muted>
    </Card>
  );
}
