import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Radius, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Chip, EmptyState, IconButton, Muted, Row, Segmented, Sheet, Stack, Text, ErrorState } from '@/components/ui';
import { InsightCard, ProposalCard } from '@/components/coaching';
import { useStore } from '@/store/AppStore';
import { useAct, useToast } from '@/components/Toast';
import { useAiEngine } from '@/hooks/useAiEngine';
import { useLayout } from '@/hooks/useLayout';
import { coachReply } from '@/lib/ai/provider';
import { pendingProposals, visibleChat } from '@/lib/selectors';
import { newId } from '@/lib/id';
import { formatTime, nowISO } from '@/lib/dates';
import type { ChatMessage, CoachTone } from '@/lib/types';

const PROMPTS = ['I only have 20 minutes today', "I'm eating out tonight", 'My knee hurts', 'How am I doing?', 'What should I eat for dinner?'];

export default function Coach() {
  const { state, today } = useStore();
  const doAct = useAct();
  const { isDesktop, isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<{ msg: string; retry: string } | null>(null);
  const [tab, setTab] = useState<'chat' | 'suggestions'>('chat');
  const [confirmClear, setConfirmClear] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const messages = visibleChat(state);
  const pending = pendingProposals(state);
  const decided = state.proposals.filter((p) => p.status !== 'pending').sort((a, b) => (b.decidedAt ?? b.updatedAt).localeCompare(a.decidedAt ?? a.updatedAt)).slice(0, 6);
  const engine = useAiEngine('chat');
  const simulated = engine === 'simulated';
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, thinking]);

  const send = async (msg: string) => {
    const body = msg.trim();
    if (!body || thinking) return;
    setText('');
    setError(null);
    const now = nowISO();
    const userMsg: ChatMessage = { id: newId(), role: 'user', text: body, createdAt: now, updatedAt: now };
    doAct({ type: 'ADD_CHAT', messages: [userMsg] });
    setThinking(true);
    try {
      const reply = await coachReply({ ...state, chat: [...state.chat, userMsg] }, body, today);
      if (reply.aiNotice) toast(`OpenRouter didn't answer (${reply.aiNotice}) Showing a built-in reply.`, 'error');
      if (reply.proposals.length) doAct({ type: 'ADD_PROPOSALS', proposals: reply.proposals });
      const t = nowISO();
      doAct({ type: 'ADD_CHAT', messages: [{ id: newId(), role: 'coach', text: reply.text, createdAt: t, updatedAt: t, proposalIds: reply.proposals.map((p) => p.id), simulated: reply.simulated, safety: reply.safety }] });
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : 'The coach could not reply.', retry: body });
    } finally {
      setThinking(false);
    }
  };

  const toneSwitch = (
    <Segmented<CoachTone>
      label="Coach tone"
      value={state.settings.coachTone}
      onChange={(v) => doAct({ type: 'UPDATE_SETTINGS', patch: { coachTone: v }, now: nowISO() }, v === 'supportive' ? 'Supportive coach' : 'Direct trainer')}
      options={[{ value: 'supportive', label: 'Supportive' }, { value: 'direct', label: 'Direct' }]}
    />
  );

  const suggestions = (
    <Stack gap={Space.md}>
      <Text variant="h3">Waiting for your decision ({pending.length})</Text>
      {pending.length ? pending.map((p) => <ProposalCard key={p.id} proposal={p} compact />) : <Muted variant="small">No pending suggestions.</Muted>}
      {state.insights.slice(0, 3).map((i) => (
        <InsightCard key={i.id} insight={i} />
      ))}
      {decided.length ? (
        <>
          <Text variant="h3">Recent decisions</Text>
          {decided.map((p) => (
            <Card key={p.id} tone="muted" style={{ padding: Space.md, gap: 4 }}>
              <Row wrap gap={6}>
                <Badge kind={p.status === 'accepted' ? 'saved' : 'rejected'} label={p.status === 'accepted' ? 'Accepted' : p.status === 'expired' ? 'Expired' : 'Declined'} />
                <Muted variant="small">{p.scope === 'today' ? 'Today only' : 'Ongoing'}</Muted>
              </Row>
              <Text variant="smallStrong">{p.title}</Text>
            </Card>
          ))}
        </>
      ) : null}
    </Stack>
  );

  const chat = (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: isPhone ? Space.lg : Space.xl, gap: Space.md, paddingBottom: Space.xl }} keyboardShouldPersistTaps="handled">
        {simulated ? (
          <Banner kind="simulated" title="Simulated coach">
            Replies are built-in answers generated on this device from your data. Sign in to use the shared OpenRouter coach chat.
          </Banner>
        ) : null}
        {messages.length === 0 ? <EmptyState icon="chatbubbles-outline" title="Ask your coach anything" body="It knows your goal, plan, food log and recent progress." /> : null}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {thinking ? (
          <Row gap={6} accessibilityLiveRegion="polite">
            <Badge kind="neutral" label="Coach is typing…" icon="ellipsis-horizontal" />
          </Row>
        ) : null}
        {error ? <ErrorState title="No reply" body={error.msg} onRetry={() => send(error.retry)} /> : null}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.surface, padding: Space.md, gap: Space.sm }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {PROMPTS.map((p) => (
            <Chip key={p} label={p} asButton onPress={() => send(p)} />
          ))}
        </ScrollView>
        <Row gap={Space.sm}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message your coach"
            placeholderTextColor={C.textMuted}
            onSubmitEditing={() => send(text)}
            returnKeyType="send"
            accessibilityLabel="Message your coach"
            style={[{ flex: 1, borderWidth: 1, borderColor: C.borderStrong, borderRadius: Radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: C.text, minHeight: 44 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          />
          <IconButton icon="send" label="Send" color={text.trim() ? C.primary : C.borderStrong} onPress={() => send(text)} />
        </Row>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: isPhone ? Math.max(insets.top, 12) + 8 : Space.xl, paddingHorizontal: isPhone ? Space.lg : Space.xl, paddingBottom: Space.md, gap: Space.md, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface }}>
        <Row>
          <Stack gap={0} style={{ flex: 1 }}>
            <Text variant="h1" accessibilityRole="header">Coach</Text>
            <Muted variant="small">Suggestions are never applied without your OK.</Muted>
          </Stack>
          {messages.length ? <IconButton icon="trash-outline" label="Clear chat" color={C.textSecondary} onPress={() => setConfirmClear(true)} /> : null}
          {!isPhone ? <View style={{ width: 240 }}>{toneSwitch}</View> : null}
        </Row>
        {isPhone ? toneSwitch : null}
        {!isDesktop ? (
          <Segmented label="Coach view" value={tab} onChange={setTab} options={[{ value: 'chat', label: 'Chat' }, { value: 'suggestions', label: `Suggestions${pending.length ? ` (${pending.length})` : ''}` }]} />
        ) : null}
      </View>
      {isDesktop ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 3, borderRightWidth: 1, borderRightColor: C.border }}>{chat}</View>
          <ScrollView style={{ flex: 2 }} contentContainerStyle={{ padding: Space.xl }}>{suggestions}</ScrollView>
        </View>
      ) : tab === 'chat' ? (
        chat
      ) : (
        <ScrollView contentContainerStyle={{ padding: Space.lg, paddingBottom: 80 }}>{suggestions}</ScrollView>
      )}
      <Sheet
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear the chat?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setConfirmClear(false)} />
            <Button
              title="Clear chat"
              kind="danger"
              style={{ flex: 1 }}
              onPress={() => {
                doAct({ type: 'CLEAR_CHAT', now: nowISO() }, 'Chat cleared');
                setError(null);
                setConfirmClear(false);
              }}
            />
          </Row>
        }>
        <Muted>This deletes all coach messages on this device, and on your other devices if you&apos;re signed in. Suggestions waiting for your decision stay in the Suggestions list.</Muted>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const { state } = useStore();
  const mine = m.role === 'user';
  const proposals = (m.proposalIds ?? []).map((id) => state.proposals.find((p) => p.id === id)).filter(Boolean);
  return (
    <Stack gap={Space.sm} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View style={{ maxWidth: '88%', backgroundColor: mine ? C.primary : C.surface, borderRadius: Radius.lg, borderWidth: mine ? 0 : 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, gap: 6 }}>
        {!mine && (m.simulated || m.safety) ? (
          <Row wrap gap={4}>
            {m.safety ? <Badge kind="danger" label="Safety guidance, not medical advice" icon="medkit-outline" /> : null}
            {m.simulated ? <Badge kind="simulated" label="Simulated" /> : null}
          </Row>
        ) : null}
        <Text color={mine ? C.onPrimary : C.text}>{m.text}</Text>
        <Text variant="caption" color={mine ? '#D1FADF' : C.textMuted}>{formatTime(m.createdAt)}</Text>
      </View>
      {proposals.map((p) => (
        <View key={p!.id} style={{ width: '100%', maxWidth: 560 }}>
          <ProposalCard proposal={p!} compact />
        </View>
      ))}
    </Stack>
  );
}
