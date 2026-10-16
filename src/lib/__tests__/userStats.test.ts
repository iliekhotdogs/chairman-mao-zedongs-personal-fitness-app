import { isBugStatus, pickBugReport, pickUserStats } from '../../../supabase/functions/_shared/userStats';

describe('pickUserStats', () => {
  it('keeps only whitelisted keys', () => {
    const out = pickUserStats({
      userId: 'u1', signedUpAt: '2026-01-01', lastActiveAt: null, foodEntries: '12', sessions: 3, weighIns: 4, currentStreak: 2,
      goal: 'fat_loss', avgKcal7d: 2100, targetKcal: 2200, aiRequestsTotal: 5, disabled: false,
      email: 'a@b.c', chat: 'hi', weightKg: 80, pushToken: 'ExponentPushToken[x]', items: [{ name: 'egg' }],
    })!;
    expect(Object.keys(out).sort()).toEqual([
      'aiRequestsTotal', 'avgKcal7d', 'currentStreak', 'disabled', 'foodEntries', 'goal', 'lastActiveAt',
      'sessions', 'signedUpAt', 'targetKcal', 'userId', 'weighIns',
    ]);
    expect(out.foodEntries).toBe(12);
  });

  it('rejects junk and unknown goals', () => {
    expect(pickUserStats(null)).toBeNull();
    expect(pickUserStats({ foodEntries: 1 })).toBeNull();
    expect(pickUserStats({ userId: 'u', goal: '<script>' })!.goal).toBeNull();
  });
});

describe('bug reports', () => {
  it('validates status and drops extra columns', () => {
    expect(isBugStatus('triaged')).toBe(true);
    expect(isBugStatus('deleted')).toBe(false);
    const row = pickBugReport({ id: 'i', user_id: 'u', body: 'x', status: 'open', created_at: 't', secret: 1 })!;
    expect('secret' in row).toBe(false);
    expect(pickBugReport({ id: 'i', user_id: 'u', body: 'x', status: 'nope' })).toBeNull();
  });
});
