import { reducer, checkAction, RuleViolation } from '../reducer';
import { emptyState, type AppState } from '../state';
import { buildSampleState } from '../sampleData';
import { computeTargets } from '../nutrition/targets';
import type { Proposal } from '../types';

const NOW = '2026-10-02T12:00:00.000Z';
const TODAY = '2026-10-02';

function withTargets(): AppState {
  const s = buildSampleState('device-1', TODAY);
  return { ...s, proposals: [] };
}

function proposal(over: Partial<Proposal>): Proposal {
  return {
    id: 'p1', kind: 'day_calorie_adjustment', scope: 'today', title: 't', summary: 's', rationale: [],
    change: { type: 'day_calorie_adjustment', date: TODAY, calorieDelta: 200, carbsDeltaG: 50 },
    status: 'pending', createdAt: NOW, updatedAt: NOW, dedupeKey: 'k1', origin: 'adaptive_engine', ...over,
  };
}

describe('food logging rule', () => {
  it('ignores food without a confirmation timestamp', () => {
    const s = emptyState('d', NOW);
    const entry = { id: 'f', date: TODAY, meal: 'lunch' as const, items: [{ name: 'x', portionLabel: '1', calories: 100, proteinG: 1, carbsG: 1, fatG: 1, source: { kind: 'visual_estimate' as const, sourced: false, label: 'AI' } }], origin: 'photo' as const, confirmedAt: '', createdAt: NOW, updatedAt: NOW };
    expect(() => checkAction(s, { type: 'LOG_FOOD', entry })).toThrow(RuleViolation);
    expect(reducer(s, { type: 'LOG_FOOD', entry })).toBe(s);
    const ok = reducer(s, { type: 'LOG_FOOD', entry: { ...entry, confirmedAt: NOW } });
    expect(ok.foodLog).toHaveLength(1);
  });

  it('deletes food as a tombstone so the deletion syncs', () => {
    const s = withTargets();
    const id = s.foodLog[0].id;
    const next = reducer(s, { type: 'DELETE_FOOD', id, now: NOW });
    expect(next.foodLog.find((f) => f.id === id)?.deleted).toBe(true);
  });
});

describe('proposal approval rules', () => {
  it('accepting a one-day adjustment changes only that day', () => {
    const s = { ...withTargets(), proposals: [proposal({})] };
    const before = s.targets!.calories;
    const next = reducer(s, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    expect(next.targets!.calories).toBe(before);
    expect(next.dayAdjustments.filter((a) => !a.deleted)).toHaveLength(1);
    expect(next.proposals[0].status).toBe('accepted');
  });

  it('rejecting leaves the plan and targets unchanged', () => {
    const p = proposal({ kind: 'target_change', scope: 'ongoing', change: { type: 'target_change', next: { calories: 1500, proteinG: 150, carbsG: 100, fatG: 50 } } });
    const s = { ...withTargets(), proposals: [p] };
    const next = reducer(s, { type: 'REJECT_PROPOSAL', id: 'p1', now: NOW });
    expect(next.targets).toBe(s.targets);
    expect(next.plan).toBe(s.plan);
    expect(next.dayAdjustments).toBe(s.dayAdjustments);
    expect(next.proposals[0].status).toBe('rejected');
  });

  it('accepting an ongoing target change updates targets', () => {
    const p = proposal({ kind: 'target_change', scope: 'ongoing', change: { type: 'target_change', next: { calories: 1999, proteinG: 150, carbsG: 200, fatG: 60 } } });
    const next = reducer({ ...withTargets(), proposals: [p] }, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    expect(next.targets!.calories).toBe(1999);
  });

  it('cannot accept twice, after rejection, or after expiry', () => {
    const s = { ...withTargets(), proposals: [proposal({})] };
    const accepted = reducer(s, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    expect(reducer(accepted, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY })).toBe(accepted);
    const rejected = reducer(s, { type: 'REJECT_PROPOSAL', id: 'p1', now: NOW });
    expect(() => checkAction(rejected, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY })).toThrow(/already rejected/);
    const old = { ...withTargets(), proposals: [proposal({ expiresOn: '2026-10-01' })] };
    expect(() => checkAction(old, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY })).toThrow(/expired/);
    const expired = reducer(old, { type: 'EXPIRE_PROPOSALS', today: TODAY, now: NOW });
    expect(expired.proposals[0].status).toBe('expired');
  });

  it('plan weight updates require the same plan', () => {
    const s = withTargets();
    const day = s.plan!.days[0];
    const ex = day.exercises[0];
    const p = proposal({ kind: 'plan_weight_update', scope: 'ongoing', change: { type: 'plan_weight_update', planId: s.plan!.id, updates: [{ dayId: day.id, exerciseId: ex.exerciseId, targetWeightKg: 99 }] } });
    const next = reducer({ ...s, proposals: [p] }, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    expect(next.plan!.days[0].exercises[0].targetWeightKg).toBe(99);
    const stale = { ...s, proposals: [{ ...p, change: { ...p.change, planId: 'other' } as Proposal['change'] }] };
    expect(() => checkAction(stale, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY })).toThrow(/plan changed/);
  });

  it('de-duplicates proposals by key', () => {
    const s = { ...withTargets(), proposals: [proposal({})] };
    const next = reducer(s, { type: 'ADD_PROPOSALS', proposals: [proposal({ id: 'p2' })] });
    expect(next.proposals).toHaveLength(1);
  });

  it('a temporary limitation never shortens a permanent one', () => {
    const s = withTargets();
    const perm = { ...s, profile: { ...s.profile!, limitations: [{ area: 'knee' as const }] } };
    const p = proposal({ kind: 'add_limitation', scope: 'ongoing', change: { type: 'add_limitation', limitation: { area: 'knee', until: '2026-10-16' } } });
    const next = reducer({ ...perm, proposals: [p] }, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    expect(next.profile!.limitations).toEqual([{ area: 'knee' }]);
    expect(next.proposals[0].status).toBe('accepted');
  });

  it('a today-only workout swap does not change the saved plan', () => {
    const s = withTargets();
    const day = { ...s.plan!.days[0], id: 'short', name: 'Short' };
    const p = proposal({ kind: 'today_workout_swap', change: { type: 'today_workout_swap', date: TODAY, day } });
    const next = reducer({ ...s, proposals: [p] }, { type: 'ACCEPT_PROPOSAL', id: 'p1', now: NOW, today: TODAY });
    expect(next.plan).toBe(s.plan);
    expect(next.workoutOverrides[0].day.name).toBe('Short');
  });
});

describe('confirmed changes', () => {
  it('requires confirmation for goal, targets and plan', () => {
    const s = withTargets();
    const t = computeTargets(s.profile!, 80);
    expect(reducer(s, { type: 'SET_TARGETS', targets: t, confirmed: false })).toBe(s);
    expect(reducer(s, { type: 'SET_GOAL', goal: 'maintenance', targets: t, now: NOW, confirmed: false })).toBe(s);
    expect(reducer(s, { type: 'SET_GOAL', goal: 'maintenance', targets: t, now: NOW, confirmed: true }).profile!.goal).toBe('maintenance');
  });
});

describe('workout logging', () => {
  it('validates sets and finishes sessions', () => {
    const s = emptyState('d', NOW);
    const started = reducer(s, { type: 'START_SESSION', session: { id: 's1', date: TODAY, name: 'W', startedAt: NOW, sets: [], updatedAt: NOW } });
    expect(started.activeSessionId).toBe('s1');
    const bad = reducer(started, { type: 'ADD_SETS', sessionId: 's1', now: NOW, sets: [{ id: 'x', exerciseId: 'bench_press', weightKg: 60, reps: 0, via: 'manual', loggedAt: NOW }] });
    expect(bad).toBe(started);
    const good = reducer(started, { type: 'ADD_SETS', sessionId: 's1', now: NOW, sets: [{ id: 'x', exerciseId: 'bench_press', weightKg: 60, reps: 8, via: 'voice', loggedAt: NOW }] });
    const done = reducer(good, { type: 'FINISH_SESSION', sessionId: 's1', now: NOW });
    expect(done.activeSessionId).toBeUndefined();
    expect(done.sessions[0].finishedAt).toBe(NOW);
  });

  it('keeps one weigh-in per day', () => {
    const s = emptyState('d', NOW);
    const a = reducer(s, { type: 'LOG_WEIGHT', entry: { id: 'w1', date: TODAY, weightKg: 80, updatedAt: NOW } });
    const b = reducer(a, { type: 'LOG_WEIGHT', entry: { id: 'w2', date: TODAY, weightKg: 79.5, updatedAt: NOW } });
    expect(b.weights).toHaveLength(1);
    expect(b.weights[0].weightKg).toBe(79.5);
    expect(reducer(b, { type: 'LOG_WEIGHT', entry: { id: 'w3', date: TODAY, weightKg: 5, updatedAt: NOW } })).toBe(b);
  });
});

describe('clearing the coach chat', () => {
  it('hides every message and keeps tombstones so the deletion syncs', () => {
    const s0 = emptyState('d', '2026-10-02T08:00:00.000Z');
    const msg = (id: string) => ({ id, role: 'user' as const, text: 'hi', createdAt: '2026-10-02T08:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z' });
    const s1 = reducer(s0, { type: 'ADD_CHAT', messages: [msg('a'), msg('b')] });
    const s2 = reducer(s1, { type: 'CLEAR_CHAT', now: '2026-10-02T09:00:00.000Z' });
    expect(s2.chat.filter((m) => !m.deleted)).toHaveLength(0);
    expect(s2.chat.every((m) => m.updatedAt === '2026-10-02T09:00:00.000Z')).toBe(true);
    expect(() => checkAction(s1, { type: 'CLEAR_CHAT', now: '2026-10-02T09:00:00.000Z' })).not.toThrow();
  });
});
