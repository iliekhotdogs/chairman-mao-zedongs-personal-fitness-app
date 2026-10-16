import { activityBonus, missedWorkoutInsight, runEngine, targetChangeRows, trendAdjustment, weightSlopePerDay, progressionProposal } from '../coaching/adaptive';
import { reducer } from '../reducer';
import { simulateCoachReply } from '../coaching/coachSim';
import { buildSampleState } from '../sampleData';
import { emptyState, STATE_VERSION, type AppState } from '../state';
import { decide, inQuietHours, MAX_COACH_NOTIFICATIONS_PER_DAY, type Candidate } from '../notifications/policy';
import { generatePlan, planGoal, stalePlanGoal } from '../workouts/generator';
import type { NotificationPrefs, NotificationRecord } from '../types';

const TODAY = '2026-10-02';

function sample(): AppState {
  return { ...buildSampleState('dev', TODAY), proposals: [] };
}

describe('activity bonus (no double counting)', () => {
  it('offers half of the extra above baseline, capped, today only', () => {
    const s = sample(); // simulated data: 14,800 steps today, baseline 5,000
    const { proposal } = activityBonus(s, TODAY);
    expect(proposal).toBeDefined();
    const c = proposal!.change as { type: 'day_calorie_adjustment'; calorieDelta: number; date: string };
    // (14800 - 5000) * 0.04 * 0.5 = 196 → rounded to 200
    expect(c.calorieDelta).toBe(200);
    expect(c.date).toBe(TODAY);
    expect(proposal!.scope).toBe('today');
    expect(proposal!.expiresOn).toBe(TODAY);
  });

  it('offers nothing for normal days or missing data', () => {
    const s = sample();
    const normal = { ...s, activity: s.activity.map((a) => ({ ...a, steps: 6000 })) };
    expect(activityBonus(normal, TODAY).proposal).toBeUndefined();
    expect(activityBonus({ ...s, activity: [] }, TODAY).proposal).toBeUndefined();
  });

  it('counts only one device per day', () => {
    const s = sample();
    const p = activityBonus(s, TODAY).proposal!;
    expect(p.rationale.join(' ')).toMatch(/avoid double counting/);
  });
});

describe('weight trend adjustment', () => {
  it('computes a regression slope', () => {
    const pts = [0, 7, 14].map((d, i) => ({ date: `2026-09-${String(1 + d).padStart(2, '0')}`, weightKg: 80 - i * 0.5 }));
    expect(weightSlopePerDay(pts) * 7).toBeCloseTo(-0.5, 5);
  });

  it('suggests lowering calories when fat loss is too slow and logging is good', () => {
    const s = sample();
    const r = trendAdjustment(s, TODAY);
    // sample data: ~-0.1%/week (too slow for fat loss) with good logging and adherence
    expect(r.proposal).toBeDefined();
    expect(r.proposal!.scope).toBe('ongoing');
    const next = (r.proposal!.change as { type: 'target_change'; next: { calories: number } }).next.calories;
    expect(next).toBe(s.targets!.calories - 150);
  });
  it('the accepted card compares against the target captured on the proposal, not the applied one', () => {
    const s = sample();
    const before = s.targets!.calories;
    const p = trendAdjustment(s, TODAY).proposal!;
    const done = reducer({ ...s, proposals: [p] }, { type: 'ACCEPT_PROPOSAL', id: p.id, now: '2026-10-15T12:00:00.000Z', today: TODAY });
    const accepted = done.proposals.find((x) => x.id === p.id)!;
    if (accepted.change.type !== 'target_change') throw new Error('expected target_change');
    expect(done.targets!.calories).toBe(before - 150);
    const [label, from, to] = targetChangeRows(accepted.change, done.targets, false)[0];
    expect([label, from, to]).toEqual(['Calories', before, before - 150]);
    // An old accepted proposal without `before` shows no "from" rather than the already-applied value.
    expect(targetChangeRows({ type: 'target_change', next: accepted.change.next }, done.targets, false)[0][1]).toBeUndefined();
    expect(targetChangeRows({ type: 'target_change', next: accepted.change.next }, s.targets, true)[0][1]).toBe(before);
  });
  it('does not create a target change below the configured floor', () => {
    const s = sample();
    const floor = 1500;
    const ratio = floor / s.targets!.calories;
    const low = { ...s, targets: { ...s.targets!, calories: floor }, foodLog: s.foodLog.map((entry) => ({ ...entry, items: entry.items.map((item) => ({ ...item, calories: Math.round(item.calories * ratio) })) })) };
    expect(trendAdjustment(low, TODAY).proposal).toBeUndefined();
  });

  it('does not change targets without enough weigh-ins', () => {
    const s = { ...sample(), weights: sample().weights.slice(-3) };
    expect(trendAdjustment(s, TODAY)).toEqual({});
  });

  it('respects a declined target change for a week', () => {
    const s = sample();
    const first = trendAdjustment(s, TODAY).proposal!;
    const declined = { ...first, status: 'rejected' as const, decidedAt: `${TODAY}T12:00:00` };
    expect(trendAdjustment({ ...s, proposals: [declined] }, '2026-10-05')).toEqual({});
  });

  it('does not re-propose while a target change is pending', () => {
    const s = sample();
    const first = trendAdjustment(s, TODAY).proposal;
    if (!first) return;
    expect(trendAdjustment({ ...s, proposals: [first] }, TODAY)).toEqual({});
  });
});

describe('insights', () => {
  it('a brand-new user has no missed workouts', () => {
    const s = sample();
    const fresh = { ...s, plan: { ...s.plan!, createdAt: `${TODAY}T08:00:00` }, sessions: [] };
    expect(missedWorkoutInsight(fresh, TODAY)).toBeUndefined();
  });

  it('engine output is de-duplicated against decided proposals', () => {
    const s = sample();
    const out = runEngine(s, TODAY, 12);
    const again = runEngine({ ...s, proposals: out.proposals.map((p) => ({ ...p, status: 'rejected' as const })) }, TODAY, 12);
    expect(again.proposals).toHaveLength(0);
  });
});

describe('progression proposal', () => {
  it('proposes plan updates after a session on the plan', () => {
    const s = sample();
    const last = s.sessions[s.sessions.length - 1];
    const p = progressionProposal(s, last);
    expect(progressionProposal(s, { ...last, pain: true })).toBeUndefined();
    if (p) {
      expect(p.kind).toBe('plan_weight_update');
      expect(p.status).toBe('pending');
    }
  });
  it('withholds progression after a pain check-in', () => {
    const s = sample();
    const last = s.sessions[s.sessions.length - 1];
    expect(progressionProposal(s, { ...last, pain: true, painNote: 'knee' })).toBeUndefined();
  });
});

describe('coach chat (simulated)', () => {
  const s = sample();
  it('handles "I only have 20 minutes" with a today-only proposal, if a workout is scheduled', () => {
    const r = simulateCoachReply(s, 'I only have 20 minutes today', TODAY);
    expect(r.text).toBeTruthy();
    for (const p of r.proposals) expect(p.scope).toBe('today');
  });

  it('pain triggers safety guidance without diagnosis', () => {
    const r = simulateCoachReply(s, 'My knee hurts when I squat', TODAY);
    expect(r.safety).toBe(true);
    expect(r.text).toMatch(/can't diagnose/);
    expect(r.proposals.some((p) => p.kind === 'add_limitation')).toBe(true);
  });

  it('red flags recommend professional care', () => {
    const r = simulateCoachReply(s, 'my knee is swollen and hurts', TODAY);
    expect(r.text).toMatch(/doctor or physiotherapist/);
  });

  it('urgent symptoms: stop and seek care, no proposals', () => {
    const r = simulateCoachReply(s, 'I have chest pain during my workout', TODAY);
    expect(r.proposals).toHaveLength(0);
    expect(r.text).toMatch(/emergency/);
  });

  it('eating out gives guidance using remaining calories', () => {
    const r = simulateCoachReply(s, "I'm eating out tonight", TODAY);
    expect(r.text).toMatch(/kcal/);
  });

  it('respects tone', () => {
    const direct = simulateCoachReply({ ...s, settings: { ...s.settings, coachTone: 'direct' } }, 'hello', TODAY);
    const supportive = simulateCoachReply(s, 'hello', TODAY);
    expect(direct.text).not.toEqual(supportive.text);
  });

  it('goal change produces an approval-gated proposal', () => {
    const r = simulateCoachReply(s, 'I want to switch to building muscle', TODAY);
    expect(r.proposals[0]?.kind).toBe('goal_change');
  });
});

describe('notification policy', () => {
  const prefs: NotificationPrefs = { enabled: true, quietStart: '21:30', quietEnd: '07:30', categories: { nutrition: true, workouts: true, checkins: true } };
  const c: Candidate = { category: 'nutrition', title: 't', body: 'b', dedupeKey: 'x', priority: 2 };
  const rec = (i: number, device: string): NotificationRecord => ({ id: `${i}`, date: TODAY, sentAt: '', category: 'checkins', title: '', body: '', dedupeKey: `k${i}`, deviceId: device, delivered: 'system', updatedAt: '' });

  it('enforces a hard cap of 3 per day across devices', () => {
    expect(MAX_COACH_NOTIFICATIONS_PER_DAY).toBe(3);
    const records = [rec(1, 'phone'), rec(2, 'laptop'), rec(3, 'phone')];
    expect(decide(c, prefs, records.slice(0, 2), TODAY, 12 * 60).send).toBe(true);
    expect(decide(c, prefs, records, TODAY, 12 * 60)).toEqual({ send: false, reason: expect.stringMatching(/limit/) });
  });

  it('respects quiet hours that cross midnight', () => {
    expect(inQuietHours(prefs, 23 * 60)).toBe(true);
    expect(inQuietHours(prefs, 6 * 60)).toBe(true);
    expect(inQuietHours(prefs, 12 * 60)).toBe(false);
    expect(decide(c, prefs, [], TODAY, 23 * 60).send).toBe(false);
  });

  it('does not send low-priority or duplicate messages, or when disabled', () => {
    expect(decide({ ...c, priority: 1 }, prefs, [], TODAY, 720).send).toBe(false);
    expect(decide(c, prefs, [{ ...rec(1, 'p'), dedupeKey: 'x' }], TODAY, 720).send).toBe(false);
    expect(decide(c, { ...prefs, enabled: false }, [], TODAY, 720).send).toBe(false);
    expect(decide(c, { ...prefs, categories: { ...prefs.categories, nutrition: false } }, [], TODAY, 720).send).toBe(false);
  });
});

describe('plan generator', () => {
  const s = emptyState('d', '');
  const base = buildSampleState('d', TODAY).profile!;
  it('avoids exercises that load limited areas', () => {
    const plan = generatePlan({ ...base, limitations: [{ area: 'knee' }, { area: 'lower_back' }] }, TODAY);
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('back_squat');
    expect(ids).not.toContain('deadlift');
    expect(ids).not.toContain('leg_extension');
    expect(s.version).toBe(STATE_VERSION);
  });

  it('only uses available equipment', () => {
    const plan = generatePlan({ ...base, equipment: 'bodyweight', trainingDays: [1, 3, 5] }, TODAY);
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('bench_press');
    expect(ids.length).toBeGreaterThan(5);
    expect(plan.days).toHaveLength(3);
  });

  it('fits the time budget and schedules on chosen weekdays', () => {
    const plan = generatePlan({ ...base, sessionMinutes: 30, trainingDays: [2, 4] }, TODAY);
    expect(plan.days.map((d) => d.weekday)).toEqual([2, 4]);
  });

  it('explains flexible days when the profile has no training schedule', () => {
    const plan = generatePlan({ ...base, trainingDays: [] }, TODAY);
    expect(plan.days).toHaveLength(3);
    expect(plan.days.every((d) => d.weekday === undefined)).toBe(true);
    expect(plan.rationale[0]).toContain('flexible days');
  });

  it('stores the goal and flags a plan built for a different goal', () => {
    const plan = generatePlan({ ...base, goal: 'fat_loss' }, TODAY);
    expect(plan.goal).toBe('fat_loss');
    expect(plan.rationale.join(' ')).toContain('lose fat');
    expect(stalePlanGoal(plan, { goal: 'fat_loss' })).toBeUndefined();
    expect(stalePlanGoal(plan, { goal: 'muscle_gain' })).toBe('fat_loss');
    expect(stalePlanGoal(undefined, { goal: 'muscle_gain' })).toBeUndefined();
  });

  it('reads the goal of older plans from their rationale, ignores user routines', () => {
    const { goal: _goal, ...plan } = generatePlan({ ...base, goal: 'fat_loss' }, TODAY);
    const legacy = { ...plan, rationale: ['Rep ranges are set for fat loss at a beginner level.'] };
    expect(planGoal(legacy)).toBe('fat_loss');
    expect(stalePlanGoal(legacy, { goal: 'strength' })).toBe('fat_loss');
    expect(stalePlanGoal({ ...legacy, source: 'user_created' }, { goal: 'strength' })).toBeUndefined();
  });
});
