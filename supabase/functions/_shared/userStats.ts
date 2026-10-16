// Server-side whitelist for admin per-user stats and bug reports. Pure TypeScript so Jest
// can test it (src/lib/__tests__/userStats.test.ts). Anything not listed here never leaves the function.

export type UserStats = {
  userId: string; signedUpAt: string | null; lastActiveAt: string | null;
  foodEntries: number; sessions: number; weighIns: number; currentStreak: number;
  goal: string | null; avgKcal7d: number | null; targetKcal: number | null;
  aiRequestsTotal: number; disabled: boolean;
};

const GOALS = ['fat_loss', 'muscle_gain', 'strength', 'maintenance'];
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const count = (v: unknown) => Math.max(0, num(v) ?? 0);

/** Rebuilds the payload from known keys only, so extra database columns cannot leak. */
export function pickUserStats(raw: unknown): UserStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string') return null;
  const goal = str(r.goal);
  return {
    userId: r.userId,
    signedUpAt: str(r.signedUpAt),
    lastActiveAt: str(r.lastActiveAt),
    foodEntries: count(r.foodEntries),
    sessions: count(r.sessions),
    weighIns: count(r.weighIns),
    currentStreak: count(r.currentStreak),
    goal: goal && GOALS.includes(goal) ? goal : null,
    avgKcal7d: num(r.avgKcal7d),
    targetKcal: num(r.targetKcal),
    aiRequestsTotal: count(r.aiRequestsTotal),
    disabled: r.disabled === true,
  };
}

export const BUG_STATUSES = ['open', 'triaged', 'closed'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export const isBugStatus = (v: unknown): v is BugStatus => typeof v === 'string' && (BUG_STATUSES as readonly string[]).includes(v);

export type BugReport = { id: string; userId: string; body: string; route: string | null; appVersion: string | null; platform: string | null; status: BugStatus; createdAt: string };

/** Whitelist for bug rows returned to the admin console. */
export function pickBugReport(row: Record<string, unknown>): BugReport | null {
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string' || typeof row.body !== 'string' || !isBugStatus(row.status)) return null;
  return {
    id: row.id, userId: row.user_id, body: row.body.slice(0, 2000), route: str(row.route), appVersion: str(row.app_version),
    platform: str(row.platform), status: row.status, createdAt: str(row.created_at) ?? '',
  };
}
