import React from 'react';
import { Space } from '@/constants/theme';
import { Badge, Card, Chip, Muted, Row, Stack, Text } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { nowISO } from '@/lib/dates';
import { GROQ_CHAT_MODELS, selectedChatModel } from '@/lib/ai/groqModels';

export function AiSettings() {
  const { state, sync } = useStore();
  const doAct = useAct();
  const chat = selectedChatModel(state.settings.chatModel);

  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">AI models</Text>
      <Row wrap gap={Space.sm}>
        <Badge kind={sync.configured ? 'info' : 'simulated'} label={sync.configured ? 'Shared AI via Supabase' : 'Built-in answers'} />
      </Row>
      <Muted variant="small">{sync.configured
        ? 'Coach chat and meal photos use the app owner’s Groq key. The key stays on the server; each account has a daily limit.'
        : 'Connect the app to Supabase to enable shared AI. Until then, coaching and meal estimates use built-in answers.'}</Muted>
      <Stack gap={Space.sm}>
        <Text variant="bodyStrong">Coach chat · Groq</Text>
        <Row wrap gap={Space.sm}>
          {GROQ_CHAT_MODELS.map((model) => (
            <Chip key={model.id} label={model.label} selected={chat === model.id} onPress={() => doAct({ type: 'UPDATE_SETTINGS', patch: { chatModel: model.id }, now: nowISO() })} />
          ))}
        </Row>
      </Stack>
      <Stack gap={Space.sm}>
        <Text variant="bodyStrong">Meal photos · Groq</Text>
        <Muted variant="small">Photos use Qwen3.8 27B, the Groq model that reads images. Check estimates before adding them to your log.</Muted>
      </Stack>
      <Muted variant="small">Chat messages, a short fitness summary and reduced meal photos go through Supabase to Groq. Groq has rate limits, so a request may occasionally fall back to a built-in answer.</Muted>
    </Card>
  );
}
