import { todayWorkout } from '../todayWorkout';
import { emptyState, type AppState } from '../../state';
import type { WorkoutDay, WorkoutPlan, WorkoutSession } from '../../types';

const NOW = '2026-10-02T12:00:00.000Z';
const TODAY = '2026-10-02'; // Friday (weekday 4 if Mon=0, 5 if Sun=0)
const ex = [{ exerciseId: 'squat', sets: 3, repsMin: 5, repsMax: 5, restSec: 90 }] as unknown as WorkoutDay['exercises'];
const mk = (id: string, weekday?: number): WorkoutDay => ({ id, name: id, focus: 'x', weekday, exercises: ex }) as WorkoutDay;
const sess = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({ id: 's1', date: TODAY, name: 'A', startedAt: NOW, sets: [], updatedAt: NOW, ...over });

function build(extra: Partial<AppState> = {}, weekdays = [0, 1, 2, 3, 4, 5, 6]): AppState {
  const plan = { id: 'p', name: 'P', days: weekdays.map((w) => mk(`d${w}`, w)), rationale: [], updatedAt: NOW } as unknown as WorkoutPlan;
  return { ...emptyState('d', NOW), plan, ...extra };
}

describe('todayWorkout', () => {
  it('no plan', () => expect(todayWorkout(emptyState('d', NOW), TODAY).status).toBe('no_plan'));
  it('rest day when no plan day matches', () => expect(todayWorkout(build({}, []), TODAY).status).toBe('rest'));
  it('planned', () => {
    const r = todayWorkout(build(), TODAY);
    expect(r).toMatchObject({ status: 'planned', overridden: false });
  });
  it('overridden uses the override day', () => {
    const day = { ...mk('ov'), sourceDayId: 'd1', name: '20 min' };
    const r = todayWorkout(build({ workoutOverrides: [{ id: 'o', date: TODAY, day, updatedAt: NOW }] as AppState['workoutOverrides'] }), TODAY);
    expect(r).toMatchObject({ status: 'planned', overridden: true });
    expect((r as { day: WorkoutDay }).day.name).toBe('20 min');
  });
  it('active session resumes', () => {
    const s = sess();
    expect(todayWorkout(build({ sessions: [s], activeSessionId: s.id }), TODAY).status).toBe('active');
  });
  it('finished session is done', () => {
    const s = sess({ finishedAt: NOW });
    expect(todayWorkout(build({ sessions: [s] }), TODAY).status).toBe('done');
  });
});
