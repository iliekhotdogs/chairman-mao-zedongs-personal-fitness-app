import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Radius, Space } from '@/constants/theme';
import { AccentRule, Badge, Banner, Button, Card, Chip, EmptyState, IconButton, Menu, Muted, Row, Sheet, Stack, Text, ErrorState } from '@/components/ui';
import { InsightCard, ProposalCard } from '@/components/coaching';
import { useStore } from '@/store/AppStore';
import { useAct, useToastLift } from '@/components/Toast';
import { useAiEngine } from '@/hooks/useAiEngine';
import { useLayout } from '@/hooks/useLayout';
import { router } from 'expo-router';
import { coachReply, type AiNoticeKind } from '@/lib/ai/provider';
import { pendingProposals, visibleChat } from '@/lib/selectors';
import { newId } from '@/lib/id';
import { formatTime, nowISO } from '@/lib/dates';
import type { ChatMessage } from '@/lib/types';
import { PrivacyNotice } from '@/components/PrivacyNotice';

const MAX_MESSAGE = 2000; // matches the server's message cap
const PROMPTS = ['How am I doing?', 'I only have 20 minutes today', "I'm eating out tonight", 'My knee hurts', 'What should I eat for dinner?'];

export default function Coach() {
  const { state, today } = useStore();
  const doAct = useAct();
  const { isDesktop, isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<{ msg: string; retry: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: AiNoticeKind; retry: string } | null>(null);
  const [tab, setTab] = useState<'chat' | 'suggestions'>('chat');
  const [confirmClear, setConfirmClear] = useState(false);
  const [moreIdeas, setMoreIdeas] = useState(false);
  const [sent, setSent] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const messages = visibleChat(state);
  const pending = pendingProposals(state);
  const decided = state.proposals.filter((p) => p.status !== 'pending').sort((a, b) => (b.decidedAt ?? b.updatedAt).localeCompare(a.decidedAt ?? a.updatedAt)).slice(0, 6);
  const engine = useAiEngine('chat');
  const simulated = engine === 'simulated';
  useToastLift(isDesktop ? 120 : 130);

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, thinking]);

  const send = async (msg: string) => {
    const body = msg.trim();
    if (!body || thinking) return;
    setText('');
    setSent((n) => n + 1);
    setError(null);
    setNotice(null);
    const now = nowISO();
    const userMsg: ChatMessage = { id: newId(), role: 'user', text: body, createdAt: now, updatedAt: now };
    doAct({ type: 'ADD_CHAT', messages: [userMsg] });
    setThinking(true);
    try {
      const reply = await coachReply({ ...state, chat: [...state.chat, userMsg] }, body, today);
      if (reply.aiNotice) setNotice({ text: reply.aiNotice, kind: reply.aiNoticeKind ?? 'other', retry: body });
      if (reply.proposals.length) doAct({ type: 'ADD_PROPOSALS', proposals: reply.proposals });
      const t = nowISO();
      doAct({ type: 'ADD_CHAT', messages: [{ id: newId(), role: 'coach', text: reply.text, createdAt: t, updatedAt: t, proposalIds: reply.proposals.map((p) => p.id), simulated: reply.simulated, safety: reply.safety }] });
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : 'The coach could not reply.', retry: body });
    } finally {
      setThinking(false);
    }
  };

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
          <Banner kind="simulated" title="Built-in coach">
            Replies are built-in answers generated on this device from your data. Sign in to use the shared AI coach chat.
          </Banner>
        ) : null}
        {messages.length === 0 ? <EmptyState icon="chatbubbles-outline" title="Ask your coach anything" body="It knows your goal, plan, food log and recent progress." /> : null}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} hidePending={isDesktop} />
        ))}
        {thinking ? (
          <Row gap={6} accessibilityLiveRegion="polite">
            <Badge kind="neutral" label="Coach is typing…" icon="ellipsis-horizontal" />
          </Row>
        ) : null}
        {notice ? (
          <Banner
            kind="warning"
            title="Showing a built-in reply"
            action={notice.kind === 'signed_out' ? <Button title="Sign in" size="sm" onPress={() => router.push('/settings')} /> : notice.kind === 'unavailable' ? <Button title="Retry" size="sm" onPress={() => send(notice.retry)} /> : undefined}>
            {notice.text.replace(/([^.!?])$/, '$1.')}
          </Banner>
        ) : null}
        {error ? <ErrorState title="No reply" body={error.msg} onRetry={() => send(error.retry)} /> : null}
      </ScrollView>
      <View style={styles.composer}>
        {!simulated ? <PrivacyNotice kind="chat" dismissSignal={sent} /> : null}
        <Row wrap gap={6}>
          {(moreIdeas ? PROMPTS : PROMPTS.slice(0, 2)).map((p) => (
            <Chip key={p} label={p} asButton onPress={() => send(p)} />
          ))}
          {!moreIdeas ? <Chip label="More ideas" asButton icon="ellipsis-horizontal" onPress={() => setMoreIdeas(true)} /> : null}
        </Row>
        <Row gap={Space.sm}>
          <TextInput
            value={text}
            onChangeText={setText}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Message your coach"
            placeholderTextColor={C.textMuted}
            onSubmitEditing={() => send(text)}
            returnKeyType="send"
            maxLength={MAX_MESSAGE}
            accessibilityLabel="Message your coach"
            style={[styles.input, inputFocused ? { borderColor: C.primary, borderWidth: 2 } : null]}
          />
          <IconButton icon="send" label="Send" color={text.trim() ? C.primary : C.borderStrong} onPress={() => send(text)} disabled={!text.trim() || thinking} />
        </Row>
        {text.length > MAX_MESSAGE - 200 ? <Muted variant="small" style={{ textAlign: 'right' }} accessibilityLiveRegion="polite">{text.length}/{MAX_MESSAGE}</Muted> : null}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: isPhone ? Math.max(insets.top, 12) + 8 : Space.xl, paddingHorizontal: isPhone ? Space.lg : Space.xl }]}>
        <Row>
          <Stack gap={0} style={{ flex: 1 }}>
            <Text variant="h1" accessibilityRole="header">Coach</Text>
            <AccentRule style={{ marginVertical: 6 }} />
            <Muted variant="small">Suggestions are never applied without your OK.</Muted>
          </Stack>
          {!isDesktop ? (
            <Pressable onPress={() => setTab(tab === 'chat' ? 'suggestions' : 'chat')} accessibilityRole="button" accessibilityLabel={tab === 'chat' ? `Suggestions, ${pending.length} waiting` : 'Back to chat'}>
              {tab === 'chat' ? <Badge kind={pending.length ? 'pending' : 'neutral'} label={`Suggestions${pending.length ? ` · ${pending.length}` : ''}`} icon="bulb-outline" /> : <Badge kind="neutral" label="Back to chat" icon="chatbubbles-outline" />}
            </Pressable>
          ) : null}
          {messages.length ? <Menu title="Chat options" items={[{ label: 'Clear chat', icon: 'trash-outline', danger: true, onPress: () => setConfirmClear(true) }]} /> : null}
        </Row>
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

function Bubble({ m, hidePending }: { m: ChatMessage; hidePending: boolean }) {
  const { state } = useStore();
  const mine = m.role === 'user';
  // on desktop, pending suggestions live in the side panel; showing them here too duplicates Accept/Decline
  const all = (m.proposalIds ?? []).map((id) => state.proposals.find((p) => p.id === id)).filter(Boolean);
  const proposals = all.filter((p) => !(hidePending && p!.status === 'pending'));
  return (
    <Stack gap={Space.sm} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : null]}>
        {!mine && (m.simulated || m.safety) ? (
          <Row wrap gap={4}>
            {m.safety ? <Badge kind="danger" label="Safety guidance, not medical advice" icon="medkit-outline" /> : null}
            {m.simulated ? <Badge kind="neutral" label="Built-in reply" /> : null}
          </Row>
        ) : null}
        <Text color={mine ? C.onPrimary : C.text}>{m.text}</Text>
        <Text variant="caption" color={mine ? C.onPrimary : C.textMuted} style={mine ? { opacity: 0.65 } : undefined}>{formatTime(m.createdAt)}</Text>
      </View>
      {proposals.length < all.length ? <Muted variant="small">Suggestion waiting in the panel on the right.</Muted> : null}
      {proposals.map((p) => (
        <View key={p!.id} style={{ width: '100%', maxWidth: 560 }}>
          <ProposalCard proposal={p!} compact />
        </View>
      ))}
    </Stack>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: Space.md, gap: Space.md, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgDeep },
  composer: { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bgDeep, padding: Space.md, gap: Space.sm },
  input: { flex: 1, borderWidth: 1, borderColor: C.borderStrong, borderRadius: Radius.pill, backgroundColor: C.surface, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: C.text, minHeight: 44 },
  bubble: { maxWidth: '88%', backgroundColor: C.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  bubbleMine: { backgroundColor: C.primary, borderWidth: 0, borderBottomRightRadius: Radius.sm },
});
