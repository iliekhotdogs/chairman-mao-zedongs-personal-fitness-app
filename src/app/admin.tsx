import React, { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Badge, Banner, Button, Card, Chip, Columns, Divider, Field, KeyValue, Muted, NumberField, PageHeader, Row, Screen, Stack, Text, Toggle } from '@/components/ui';
import { Space } from '@/constants/theme';
import { supabase } from '@/lib/sync/supabase';
import { functionErrorMessage } from '@/lib/ai/provider';
import { useToast } from '@/components/Toast';

type Stats = {
  accounts: number; active7Days: number; disabledAccounts: number; foodEntries: number;
  workoutSessions: number; chatMessages: number; aiRequestsToday: number; openInvites: number;
  measuredAt: string;
};
type Model = { id: string; label: string };
type ProviderEntry = { id: string; label: string; keyEnv: string; keySet: boolean; chatModels: Model[]; visionModels: Model[] };
type AiConfig = { provider: string; chat_model: string; vision_model: string; per_user_daily_limit: number; global_daily_limit: number; per_ip_daily_limit?: number; ai_enabled: boolean };
type Invite = { code: string; created_at: string; expires_at: string | null; used_at: string | null; used_email: string | null; note: string | null; status: 'open' | 'used' | 'expired' | 'burned' };
type AdminUser = { user_id: string; email: string; created_at: string; last_sign_in_at: string | null; email_confirmed_at: string | null; role: 'admin' | 'user'; disabled: boolean; ai_requests_today: number };

/** Calls one action of the admin Edge Function and returns its JSON, or throws the server's reason. */
async function adminCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase is not connected.');
  const { data, error } = await sb.functions.invoke('admin-stats', { body: { action, ...extra } });
  if (error) throw new Error(await functionErrorMessage(error, 'Admin request failed.'));
  return data as T;
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function Admin() {
  return (
    <Screen maxWidth={1080}>
      <PageHeader title="Admin" right={<Button title="Back" kind="ghost" onPress={() => router.back()} />} />
      <Columns>
        {[
          <Stack key="l" gap={Space.lg}>
            <StatsSection />
            <AiConfigSection />
          </Stack>,
          <Stack key="r" gap={Space.lg}>
            <InvitesSection />
            <UsersSection />
          </Stack>,
        ]}
      </Columns>
    </Screen>
  );
}

function StatsSection() {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const data = await adminCall<Stats>('stats');
      if (typeof data?.accounts !== 'number') throw new Error('Admin access is unavailable. Sign in as an admin and check the Edge Function setup.');
      setStats(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load stats.'); setStats(undefined); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  return (
    <Card style={{ gap: Space.md }}>
      <Stack gap={Space.sm}>
        <Badge kind="info" label="Admin only" />
        <Text variant="h3">App activity</Text>
      </Stack>
      {error ? <Banner kind="warning">{error}</Banner> : null}
      {stats ? (
        <Stack gap={Space.sm}>
          <KeyValue k="Accounts" v={stats.accounts.toLocaleString()} />
          <KeyValue k="Signed in over 7 days" v={stats.active7Days.toLocaleString()} />
          <KeyValue k="Disabled accounts" v={stats.disabledAccounts.toLocaleString()} />
          <KeyValue k="Open invites" v={stats.openInvites.toLocaleString()} />
          <KeyValue k="Food entries" v={stats.foodEntries.toLocaleString()} />
          <KeyValue k="Workout sessions" v={stats.workoutSessions.toLocaleString()} />
          <KeyValue k="Chat messages" v={stats.chatMessages.toLocaleString()} />
          <KeyValue k="AI requests today (UTC)" v={stats.aiRequestsToday.toLocaleString()} />
          <Muted variant="small">Updated {new Date(stats.measuredAt).toLocaleString()}. Aggregate counts only; personal records stay private.</Muted>
        </Stack>
      ) : null}
      <Button title="Refresh stats" kind="secondary" loading={busy} onPress={refresh} />
    </Card>
  );
}

function AiConfigSection() {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [saved, setSaved] = useState<AiConfig>();
  const [draft, setDraft] = useState<AiConfig>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminCall<{ config: AiConfig; providers: ProviderEntry[] }>('get_config');
      setProviders(data.providers ?? []);
      setSaved(data.config);
      setDraft(data.config);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the AI configuration.'); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const data = await adminCall<{ config: AiConfig }>('set_config', { config: draft });
      setSaved(data.config);
      setDraft(data.config);
      toast('AI configuration saved');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  const provider = providers.find((p) => p.id === draft?.provider);
  const pickProvider = (next: ProviderEntry) => draft && setDraft({ ...draft, provider: next.id, chat_model: next.chatModels[0]?.id ?? '', vision_model: next.visionModels[0]?.id ?? '' });
  const changed = JSON.stringify(saved) !== JSON.stringify(draft);

  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">AI configuration</Text>
      <Muted variant="small">Applies to every account. Keys are Supabase secrets and never leave the server.</Muted>
      {error ? <Banner kind="warning">{error}</Banner> : null}
      {draft ? (
        <>
          <Toggle label="AI enabled" description="Off is a kill switch: chat and meal photos fall back to built-in answers." value={draft.ai_enabled} onChange={(ai_enabled) => setDraft({ ...draft, ai_enabled })} />
          <Text variant="smallStrong">Provider</Text>
          <Row wrap gap={6}>
            {providers.map((p) => (
              <Chip key={p.id} label={p.keySet ? p.label : `${p.label} (no key)`} selected={draft.provider === p.id} onPress={() => pickProvider(p)} />
            ))}
          </Row>
          {provider && !provider.keySet ? <Banner kind="warning">{`${provider.keyEnv} is not set in Supabase Edge Function secrets, so ${provider.label} requests will fail.`}</Banner> : null}
          <Text variant="smallStrong">Chat model</Text>
          <Row wrap gap={6}>
            {provider?.chatModels.map((m) => <Chip key={m.id} label={m.label} selected={draft.chat_model === m.id} onPress={() => setDraft({ ...draft, chat_model: m.id })} />)}
          </Row>
          <Text variant="smallStrong">Meal photo model</Text>
          <Row wrap gap={6}>
            {provider?.visionModels.map((m) => <Chip key={m.id} label={m.label} selected={draft.vision_model === m.id} onPress={() => setDraft({ ...draft, vision_model: m.id })} />)}
          </Row>
          <NumberField label="Requests per user per day" value={draft.per_user_daily_limit} onChange={(v) => setDraft({ ...draft, per_user_daily_limit: Math.max(0, Math.round(v ?? 0)) })} />
          <NumberField label="Requests for everyone per day" value={draft.global_daily_limit} onChange={(v) => setDraft({ ...draft, global_daily_limit: Math.max(0, Math.round(v ?? 0)) })} />
          {draft.per_ip_daily_limit !== undefined ? (
            <NumberField label="Requests per network (IP) per day, 0 = no cap" value={draft.per_ip_daily_limit} onChange={(v) => setDraft({ ...draft, per_ip_daily_limit: Math.max(0, Math.round(v ?? 0)) })} />
          ) : null}
          <Row gap={Space.sm}>
            <Button title="Save AI settings" loading={busy} disabled={!changed} onPress={save} />
            {changed ? <Button title="Discard" kind="ghost" onPress={() => setDraft(saved)} /> : null}
          </Row>
        </>
      ) : null}
    </Card>
  );
}

function InvitesSection() {
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [days, setDays] = useState<number | undefined>(14);
  const [note, setNote] = useState('');
  const [created, setCreated] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminCall<{ invites: Invite[] }>('list_invites');
      setInvites(data.invites ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load invites.'); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await adminCall<{ code: string }>('create_invite', { expiresInDays: days || null, note });
      setCreated(data.code);
      setNote('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the invite.'); }
    finally { setBusy(false); }
  };

  const revoke = async (code: string) => {
    try {
      await adminCall('revoke_invite', { code });
      toast('Invite revoked');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke the invite.'); }
  };

  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Invites</Text>
      <Muted variant="small">Signup is invite-only. Each code works once.</Muted>
      {error ? <Banner kind="warning">{error}</Banner> : null}
      {created ? <Banner kind="success" title="New invite code">{`${created} — share it with one person.`}</Banner> : null}
      <NumberField label="Expires after (days, empty = never)" value={days} onChange={setDays} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Who is it for?" maxLength={200} />
      <Button title="Create invite" icon="add" loading={busy} onPress={create} />
      {invites.length ? <Divider /> : null}
      {invites.map((invite) => (
        <Stack key={invite.code} gap={4}>
          <Row wrap gap={Space.sm}>
            <Text variant="bodyStrong">{invite.code}</Text>
            <Badge kind={invite.status === 'open' ? 'saved' : invite.status === 'used' ? 'neutral' : 'rejected'} label={invite.status} />
            {invite.status === 'open' ? <Button title="Revoke" kind="ghost" size="sm" onPress={() => revoke(invite.code)} /> : null}
          </Row>
          <Muted variant="small">
            {[invite.note, `created ${date(invite.created_at)}`, invite.expires_at ? `expires ${date(invite.expires_at)}` : null, invite.used_email ? `used by ${invite.used_email}` : null].filter(Boolean).join(' · ')}
          </Muted>
        </Stack>
      ))}
    </Card>
  );
}

function UsersSection() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    try {
      const data = await adminCall<{ users: AdminUser[] }>('list_users');
      setUsers(data.users ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load users.'); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const act = async (userId: string, action: 'set_disabled' | 'reset_quota', extra: Record<string, unknown>, message: string) => {
    setBusy(userId + action);
    setError('');
    try {
      await adminCall(action, { userId, ...extra });
      toast(message);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed.'); }
    finally { setBusy(undefined); }
  };

  return (
    <Card style={{ gap: Space.md }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>Users</Text>
        <Button title="Refresh" kind="ghost" size="sm" icon="refresh" onPress={load} />
      </Row>
      {error ? <Banner kind="warning">{error}</Banner> : null}
      {users.map((user, index) => (
        <Stack key={user.user_id} gap={6}>
          {index ? <Divider /> : null}
          <Row wrap gap={Space.sm}>
            <Text variant="bodyStrong">{user.email}</Text>
            {user.role === 'admin' ? <Badge kind="info" label="admin" /> : null}
            {user.disabled ? <Badge kind="danger" label="disabled" /> : null}
            {!user.email_confirmed_at ? <Badge kind="pending" label="unconfirmed" /> : null}
          </Row>
          <Muted variant="small">{`Joined ${date(user.created_at)} · last sign-in ${date(user.last_sign_in_at)} · AI today ${user.ai_requests_today}`}</Muted>
          <Row wrap gap={Space.sm}>
            <Button title={user.disabled ? 'Enable' : 'Disable'} kind={user.disabled ? 'secondary' : 'danger'} size="sm" loading={busy === user.user_id + 'set_disabled'}
              onPress={() => act(user.user_id, 'set_disabled', { disabled: !user.disabled }, user.disabled ? 'Account enabled' : 'Account disabled')} />
            <Button title="Reset AI quota" kind="ghost" size="sm" loading={busy === user.user_id + 'reset_quota'} disabled={!user.ai_requests_today}
              onPress={() => act(user.user_id, 'reset_quota', {}, 'Quota reset for today')} />
          </Row>
        </Stack>
      ))}
    </Card>
  );
}
