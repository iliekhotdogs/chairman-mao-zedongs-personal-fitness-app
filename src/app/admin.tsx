import React, { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { goBack } from '@/lib/nav';
import { Badge, Banner, Button, Card, Chip, Columns, Divider, Field, KeyValue, LoadingState, Muted, NumberField, PageHeader, Row, Screen, Stack, Text, Toggle } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { log } from '@/lib/log';
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
type AiConfig = { provider: string; chat_model: string; vision_model: string; per_user_daily_limit: number; global_daily_limit: number; per_ip_daily_limit?: number; ai_enabled: boolean; allowed_providers: string[]; allow_user_choice: boolean };
type Invite = { code: string; created_at: string; expires_at: string | null; used_at: string | null; used_email: string | null; note: string | null; status: 'open' | 'used' | 'expired' | 'burned' };
type BugReport = { id: string; userId: string; body: string; route: string | null; appVersion: string | null; platform: string | null; status: 'open' | 'triaged' | 'closed'; createdAt: string };
type UserStats = { userId: string; signedUpAt: string | null; lastActiveAt: string | null; foodEntries: number; sessions: number; weighIns: number; currentStreak: number; goal: string | null; avgKcal7d: number | null; targetKcal: number | null; aiRequestsTotal: number; disabled: boolean };
type AdminUser = { user_id: string; email: string; created_at: string; last_sign_in_at: string | null; email_confirmed_at: string | null; role: 'admin' | 'user'; disabled: boolean; ai_requests_today: number; ai_provider: string | null; ai_chat_model: string | null };

/** Calls one action of the admin Edge Function and returns its JSON, or throws the server's reason. */
async function adminCall<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase is not connected.');
  const { data, error } = await sb.functions.invoke('admin-stats', { body: { action, ...extra } });
  if (error) throw new Error(await functionErrorMessage(error, 'Admin request failed.'));
  return data as T;
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

/**
 * The console renders only after the server confirms this account is an admin (the
 * `check` action of admin-stats). Everyone else is sent home; every admin action is
 * also authorised server-side, so this only keeps the page itself private.
 */
export default function Admin() {
  const { sync } = useStore();
  const userId = sync.session?.user.id;
  const [checked, setChecked] = useState<{ userId: string; admin: boolean }>();

  useEffect(() => {
    const sb = supabase();
    if (!sb || !userId) return;
    let active = true;
    sb.functions.invoke('admin-stats', { body: { action: 'check' } })
      .then(({ data, error }) => { if (active) setChecked({ userId, admin: !error && data?.admin === true }); })
      .catch((e) => {
        log.warn('admin', 'Admin check failed.', e);
        if (active) setChecked({ userId, admin: false });
      });
    return () => { active = false; };
  }, [userId]);

  if (!sync.configured || !userId) return <Redirect href="/" />;
  if (checked?.userId !== userId) {
    return (
      <Screen maxWidth={1080}>
        <LoadingState label="Checking access…" lines={2} />
      </Screen>
    );
  }
  if (!checked.admin) return <Redirect href="/" />;
  return <AdminConsole />;
}

function AdminConsole() {
  return (
    <Screen maxWidth={1080}>
      <PageHeader title="Admin" right={<Button title="Back" kind="ghost" onPress={() => goBack('/settings')} />} />
      <Columns>
        {[
          <Stack key="l" gap={Space.lg}>
            <StatsSection />
            <AiConfigSection />
          </Stack>,
          <Stack key="r" gap={Space.lg}>
            <BugsSection />
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
      <Muted variant="small">Default AI applies until a user chooses an allowed provider. Keys are Supabase secrets.</Muted>
      {error ? <Banner kind="warning">{error}</Banner> : null}
      {draft ? (
        <>
          <Toggle label="AI enabled" description="Off is a kill switch: chat and meal photos fall back to built-in answers." value={draft.ai_enabled} onChange={(ai_enabled) => setDraft({ ...draft, ai_enabled })} />
          <Toggle label="Let users choose AI" value={draft.allow_user_choice} onChange={(allow_user_choice) => setDraft({ ...draft, allow_user_choice })} />
          <Text variant="smallStrong">Providers users may choose</Text>
          <Row wrap gap={6}>{providers.filter((p) => p.id !== 'nvidia').map((p) => <Chip key={p.id} label={`${p.label}${p.keySet ? '' : ' · key unset'}`} selected={draft.allowed_providers?.includes(p.id)} onPress={() => setDraft({ ...draft, allowed_providers: draft.allowed_providers.includes(p.id) ? draft.allowed_providers.filter((id) => id !== p.id) : [...draft.allowed_providers, p.id] })} />)}</Row>
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

const BUG_FILTERS = ['open', 'triaged', 'closed', 'all'] as const;

function BugsSection() {
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof BUG_FILTERS)[number]>('open');
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminCall<{ bugs: BugReport[] }>('list_bugs', { status: filter });
      setBugs(data.bugs ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load bug reports.'); }
  }, [filter]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const setStatus = async (id: string, status: BugReport['status']) => {
    try {
      await adminCall('set_bug_status', { id, status });
      toast(`Marked ${status}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the report.'); }
  };
  return (
    <Card style={{ gap: Space.md }}>
      <Text variant="h3">Bug reports</Text>
      <Row wrap gap={6}>{BUG_FILTERS.map((f) => <Chip key={f} label={f} selected={filter === f} onPress={() => setFilter(f)} />)}</Row>
      {error ? <Banner kind="warning">{error}</Banner> : null}
      {!bugs.length && !error ? <Muted variant="small">No reports.</Muted> : null}
      {bugs.map((bug, index) => (
        <Stack key={bug.id} gap={6}>
          {index ? <Divider /> : null}
          <Text>{bug.body}</Text>
          <Muted variant="small">{[date(bug.createdAt), bug.route, bug.appVersion, bug.platform, `user ${bug.userId.slice(0, 8)}`].filter(Boolean).join(' · ')}</Muted>
          <Row wrap gap={Space.sm}>
            <Badge kind={bug.status === 'open' ? 'pending' : bug.status === 'triaged' ? 'info' : 'neutral'} label={bug.status} />
            {(['open', 'triaged', 'closed'] as const).filter((s) => s !== bug.status).map((s) => <Button key={s} title={`Mark ${s}`} kind="ghost" size="sm" onPress={() => setStatus(bug.id, s)} />)}
          </Row>
        </Stack>
      ))}
    </Card>
  );
}

function UserStatsDetail({ userId }: { userId: string }) {
  const [stats, setStats] = useState<UserStats>();
  const [error, setError] = useState('');
  useEffect(() => {
    adminCall<{ stats: UserStats }>('user_stats', { userId }).then((d) => setStats(d.stats)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load stats.'));
  }, [userId]);
  if (error) return <Banner kind="warning">{error}</Banner>;
  if (!stats) return <Muted variant="small">Loading…</Muted>;
  return (
    <Stack gap={4}>
      <KeyValue k="Signed up" v={date(stats.signedUpAt)} />
      <KeyValue k="Last active" v={date(stats.lastActiveAt)} />
      <KeyValue k="Food entries" v={stats.foodEntries.toLocaleString()} />
      <KeyValue k="Sessions" v={stats.sessions.toLocaleString()} />
      <KeyValue k="Weigh-ins" v={stats.weighIns.toLocaleString()} />
      <KeyValue k="Current streak" v={`${stats.currentStreak} days`} />
      <KeyValue k="Goal" v={stats.goal ?? '—'} />
      <KeyValue k="Avg kcal (7d) vs target" v={`${stats.avgKcal7d ?? '—'} / ${stats.targetKcal ?? '—'}`} />
      <KeyValue k="AI requests (all time)" v={stats.aiRequestsTotal.toLocaleString()} />
      <KeyValue k="Disabled" v={stats.disabled ? 'yes' : 'no'} />
    </Stack>
  );
}

function UsersSection() {
  const toast = useToast();
  const [detail, setDetail] = useState<string>();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async (more = false) => {
    try {
      const data = await adminCall<{ users: AdminUser[] }>('list_users', { offset: more ? users.length : 0 });
      const page = data.users ?? [];
      setUsers(more ? [...users, ...page] : page);
      setHasMore(page.length === 200);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load users.'); }
  }, [users]);
  useEffect(() => { void adminCall<{ users: AdminUser[] }>('list_users').then((data) => { setUsers(data.users ?? []); setHasMore((data.users ?? []).length === 200); }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load users.')); }, []);

  const act = async (userId: string, action: 'set_disabled' | 'reset_quota' | 'set_role', extra: Record<string, unknown>, message: string) => {
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
        <Button title="Refresh" kind="ghost" size="sm" icon="refresh" onPress={() => void load()} />
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
          <Muted variant="small">{`Joined ${date(user.created_at)} · last sign-in ${date(user.last_sign_in_at)} · AI today ${user.ai_requests_today} · ${user.ai_provider ? `${user.ai_provider} / ${user.ai_chat_model}` : 'Admin default AI'}`}</Muted>
          <Row wrap gap={Space.sm}>
            <Button title={user.disabled ? 'Enable' : 'Disable'} kind={user.disabled ? 'secondary' : 'danger'} size="sm" loading={busy === user.user_id + 'set_disabled'}
              onPress={() => act(user.user_id, 'set_disabled', { disabled: !user.disabled }, user.disabled ? 'Account enabled' : 'Account disabled')} />
            <Button title={detail === user.user_id ? 'Hide stats' : 'Stats'} kind="ghost" size="sm" onPress={() => setDetail(detail === user.user_id ? undefined : user.user_id)} />
            <Button title="Reset AI quota" kind="ghost" size="sm" loading={busy === user.user_id + 'reset_quota'} disabled={!user.ai_requests_today}
              onPress={() => act(user.user_id, 'reset_quota', {}, 'Quota reset for today')} />
            <Button title={user.role === 'admin' ? 'Remove admin' : 'Make admin'} kind="ghost" size="sm" loading={busy === user.user_id + 'set_role'}
              onPress={() => act(user.user_id, 'set_role', { role: user.role === 'admin' ? 'user' : 'admin' }, 'Role updated')} />
          </Row>
          {detail === user.user_id ? <UserStatsDetail userId={user.user_id} /> : null}
        </Stack>
      ))}
      {hasMore ? <Button title="Load more" kind="secondary" onPress={() => void load(true)} /> : null}
    </Card>
  );
}
