import React from 'react';
import { Space } from '@/constants/theme';
import { Badge, Card, Chip, Muted, Row, Stack, Text } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { nowISO } from '@/lib/dates';
import { OPENROUTER_CHAT_MODELS, selectedChatModel } from '@/lib/ai/openrouterModels';
import { NVIDIA_DEFAULT_MODELS } from '@/lib/ai/nvidia';

const IMAGE_MODELS = [
  { id: NVIDIA_DEFAULT_MODELS.vision, label: 'Llama 3.2 90B Vision' },
  { id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision' },
] as const;

export function AiSettings() {
  const { state, sync } = useStore();
  const doAct = useAct();
  const chat = selectedChatModel(state.settings.openRouterChatModel);
  const vision = IMAGE_MODELS.some((model) => model.id === state.settings.aiModels?.vision)
    ? state.settings.aiModels!.vision : NVIDIA_DEFAULT_MODELS.vision;

  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">AI models</Text>
      <Row wrap gap={Space.sm}>
        <Badge kind={sync.configured ? 'info' : 'simulated'} label={sync.configured ? 'Shared AI via Supabase' : 'Built-in answers'} />
      </Row>
      <Muted variant="small">{sync.configured
        ? 'Coach chat uses the app owner’s OpenRouter key. Meal photos use the owner’s NVIDIA key and the original NVIDIA vision model. Both keys stay on the server; each account has a daily limit.'
        : 'Connect the app to Supabase to enable shared AI. Until then, coaching and meal estimates use built-in answers.'}</Muted>
      <Stack gap={Space.sm}>
        <Text variant="bodyStrong">Coach chat · OpenRouter</Text>
        <Row wrap gap={Space.sm}>
          {OPENROUTER_CHAT_MODELS.map((model) => (
            <Chip key={model.id} label={model.label} selected={chat === model.id} onPress={() => doAct({ type: 'UPDATE_SETTINGS', patch: { openRouterChatModel: model.id }, now: nowISO() })} />
          ))}
        </Row>
      </Stack>
      <Stack gap={Space.sm}>
        <Text variant="bodyStrong">Meal photos · NVIDIA</Text>
        <Row wrap gap={Space.sm}>
          {IMAGE_MODELS.map((model) => (
            <Chip key={model.id} label={model.label} selected={vision === model.id} onPress={() => doAct({ type: 'UPDATE_SETTINGS', patch: { aiModels: { ...state.settings.aiModels, vision: model.id, chat: state.settings.aiModels?.chat ?? NVIDIA_DEFAULT_MODELS.chat } }, now: nowISO() })} />
          ))}
        </Row>
        <Muted variant="small">The original 90B vision model is the default. Check estimates before adding them to your log.</Muted>
      </Stack>
      <Muted variant="small">Chat messages and a short fitness summary go through Supabase to OpenRouter. Reduced meal photos go through Supabase to NVIDIA. Free models have shared rate limits and may be unavailable.</Muted>
    </Card>
  );
}
