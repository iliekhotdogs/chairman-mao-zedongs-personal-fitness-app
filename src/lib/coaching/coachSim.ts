import type { AppState } from '../state';
import type { BodyArea, CoachTone, GoalPriority, ISODate, Proposal } from '../types';
import { addDays, nowISO } from '../dates';
import { newId } from '../id';
import { condensedDay, dayMinutes, generatePlan, swapForArea } from '../workouts/generator';
import { exerciseName } from '../workouts/exercises';
import { remainingForDay, workoutForDay, latestWeight, loggedDays, live } from '../selectors';
import { computeTargets } from '../nutrition/targets';
import { weightSlopePerDay } from './adaptive';
import { displayWeight } from '../units';

/**
 * SIMULATED coach used until a real AI provider is connected. It recognises common
 * requests and builds replies from the user's actual data. Every proposed change is
 * returned as a Proposal that the user must accept; nothing is applied here.
 */
export interface CoachReply {
  text: string;
  proposals: Proposal[];
  safety: boolean;
}

const AREAS: { area: BodyArea; re: RegExp }[] = [
  { area: 'knee', re: /\bknees?\b/ },
  { area: 'lower_back', re: /\b(lower back|low back|back)\b/ },
  { area: 'shoulder', re: /\bshoulders?\b/ },
  { area: 'wrist', re: /\bwrists?\b/ },
  { area: 'elbow', re: /\belbows?\b/ },
  { area: 'hip', re: /\bhips?\b/ },
  { area: 'ankle', re: /\bankles?\b/ },
  { area: 'neck', re: /\bneck\b/ },
];

const URGENT = /\b(chest pain|chest tight|can'?t breathe|short of breath|faint|passed out|dizz)/;
const RED_FLAGS = /\b(swell|swollen|numb|tingl|sharp|pop(ped)?|snap|can'?t (walk|bear|put weight|move)|fell|fall|bruis|locked|gave way|giving way|worse at night|radiat)/;

function tone(t: CoachTone, supportive: string, direct: string) {
  return t === 'supportive' ? supportive : direct;
}

function mkProposal(p: Omit<Proposal, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'origin'>): Proposal {
  const now = nowISO();
  return { ...p, id: newId(), status: 'pending', createdAt: now, updatedAt: now, origin: 'coach_chat' };
}

export function simulateCoachReply(state: AppState, message: string, today: ISODate): CoachReply {
  const t = message.toLowerCase();
  const tn = state.settings.coachTone;
  const { day } = workoutForDay(state, today);
  const rem = remainingForDay(state, today);
  const profile = state.profile;

  // 1. Safety first: pain, injury, urgent symptoms
  if (URGENT.test(t)) {
    return {
      safety: true,
      proposals: [],
      text:
        'Please stop exercising now. Chest pain, trouble breathing, or feeling faint can be serious. If it is severe or does not settle quickly, call your local emergency number. Otherwise, contact a doctor today before training again.\n\nI can\'t assess medical symptoms, but I\'ll adjust your training once you have been cleared.',
    };
  }
  if (/\b(hurt|hurts|pain|painful|sore|injur|ache|aching|tweak|strain|sprain)/.test(t)) {
    const area = AREAS.find((a) => a.re.test(t))?.area;
    const redFlag = RED_FLAGS.test(t);
    const proposals: Proposal[] = [];
    const lines: string[] = [];
    lines.push(tone(tn, "Sorry to hear that. Let's work around it.", 'Understood. We work around it, not through it.'));
    lines.push("I can't diagnose pain. These are general precautions, not medical advice:");
    lines.push('• Skip any movement that causes pain during or after the set. Mild muscle soreness is normal; sharp or joint pain is not.');
    if (redFlag) {
      lines.push('• Swelling, numbness, sharp pain, a "pop", or trouble bearing weight should be checked by a doctor or physiotherapist before you train that area again.');
    } else {
      lines.push("• If it doesn't improve within a week or two, or gets worse, see a physiotherapist or doctor.");
    }
    if (area && profile) {
      if (day) {
        const swapped = swapForArea(day, area, profile.equipment);
        if (swapped.changes.length) {
          proposals.push(
            mkProposal({
              kind: 'today_workout_swap',
              scope: 'today',
              title: `Today's workout without heavy ${area.replace('_', ' ')} loading`,
              summary: swapped.changes.join(' · '),
              rationale: ['Replaces exercises that heavily load that area with the closest alternatives that load it less.', 'Applies to today only. Stop any exercise that still hurts.'],
              change: { type: 'today_workout_swap', date: today, day: swapped.day },
              expiresOn: today,
              dedupeKey: `swap-${area}-${today}`,
            }),
          );
        }
      }
      proposals.push(
        mkProposal({
          kind: 'add_limitation',
          scope: 'ongoing',
          title: `Note a ${area.replace('_', ' ')} limitation for 2 weeks`,
          summary: 'New plans and suggestions will avoid heavy loading of this area until it expires.',
          rationale: ['You can remove it any time in Settings → Profile.', 'This does not change your current saved plan unless you also generate a new plan.'],
          change: { type: 'add_limitation', limitation: { area, note: message.slice(0, 120), until: addDays(today, 14) } },
          dedupeKey: `limit-${area}-${today}`,
        }),
      );
      lines.push(proposals.length > 1 ? "\nI've prepared two optional changes below. Nothing changes unless you accept." : '\nOptional change below. Nothing changes unless you accept.');
    } else if (!area) {
      lines.push('\nWhich area is it (knee, shoulder, lower back…)? Then I can suggest exercise swaps.');
    }
    return { safety: true, proposals, text: lines.join('\n') };
  }

  // 2. Short on time
  const minM = t.match(/(\d+)\s*(?:min|mins|minutes)\b/);
  if (minM || /short on time|in a rush|quick workout|not much time/.test(t)) {
    const minutes = minM ? parseInt(minM[1], 10) : 25;
    if (!day) {
      return { safety: false, proposals: [], text: tone(tn, `No workout is scheduled today, so you're free. If you want to move for ${minutes} minutes, a brisk walk or some easy mobility work is a great choice.`, `Rest day. If you want to do something in ${minutes} minutes, walk briskly. Don't add extra lifting.`) };
    }
    const short = condensedDay(day, minutes);
    const est = Math.min(minutes, dayMinutes(short));
    return {
      safety: false,
      text: tone(
        tn,
        `${minutes} minutes is plenty to keep momentum. I've cut ${day.name} to the ${short.exercises.length} most important lifts, 2 hard sets each, paired as supersets (≈${est} min). Accept it below to make it today's workout.`,
        `${minutes} minutes: do the big lifts only. ${short.exercises.map((e) => exerciseName(e.exerciseId)).join(', ')}, 2 sets each, supersetted, ≈${est} min. Accept below.`,
      ),
      proposals: [
        mkProposal({
          kind: 'today_workout_swap',
          scope: 'today',
          title: `${minutes}-minute version of ${day.name}`,
          summary: short.exercises.map((e) => exerciseName(e.exerciseId)).join(' · '),
          rationale: ['Keeps the compound lifts that drive most of your progress.', 'Two working sets keeps most of the training effect when time is short.', 'Today only. Your saved plan is unchanged.'],
          change: { type: 'today_workout_swap', date: today, day: short },
          expiresOn: today,
          dedupeKey: `short-${minutes}-${today}`,
        }),
      ],
    };
  }

  // 3. Eating out
  if (/eat(ing)? out|restaurant|dinner out|takeout|take-out|take away|party|date night|drinks|brunch/.test(t)) {
    const left = rem ? Math.max(0, rem.remaining.calories) : undefined;
    const protein = rem ? Math.max(0, rem.remaining.proteinG) : undefined;
    const lines = [
      tone(tn, 'Enjoy it. One meal out never derails progress. A little planning helps:', 'Plan it and it fits. Here is how:'),
      left !== undefined ? `• You have about ${left.toLocaleString()} kcal and ${protein} g protein left today. Keep earlier meals lighter and protein-focused to leave room.` : '• Keep earlier meals lighter and protein-focused to leave room.',
      '• Pick a protein-centred main (grilled meat or fish, steak, chicken, tofu), then choose either the bread, fries, or dessert rather than all three.',
      '• Ask for sauces and dressings on the side. They are often the biggest hidden calories.',
      '• Drinks count: a cocktail or two beers can be 300–500 kcal.',
      '• Snap a photo with a hint like "ribeye and fries" to log it. You\'ll review the estimate before it is saved.',
    ];
    if (profile?.goal === 'fat_loss') lines.push(tone(tn, "If you go over, that's fine. Just get back to normal tomorrow. Don't try to \"make up\" for it.", 'Over target? Resume normal eating tomorrow. No compensating.'));
    return { safety: false, proposals: [], text: lines.join('\n') };
  }

  // 4. Goal change
  const goalMap: { re: RegExp; goal: GoalPriority }[] = [
    { re: /\b(cut|lose fat|fat loss|lose weight|lean out)\b/, goal: 'fat_loss' },
    { re: /\b(bulk|gain muscle|muscle gain|build muscle|put on size)\b/, goal: 'muscle_gain' },
    { re: /\b(get stronger|strength)\b/, goal: 'strength' },
    { re: /\b(maintain|maintenance)\b/, goal: 'maintenance' },
  ];
  if (profile && /\b(switch|change|start|want to|move to|focus on)\b/.test(t)) {
    const g = goalMap.find((x) => x.re.test(t));
    if (g && g.goal !== profile.goal) {
      const w = latestWeight(state)?.weightKg ?? profile.startWeightKg;
      const next = computeTargets({ ...profile, goal: g.goal }, w);
      return {
        safety: false,
        text: tone(tn, `Happy to shift your focus to ${g.goal.replace('_', ' ')}. Here's what would change. Review it and accept if it looks right.`, `Switching to ${g.goal.replace('_', ' ')}. New numbers below. Accept to apply.`),
        proposals: [
          mkProposal({
            kind: 'goal_change',
            scope: 'ongoing',
            title: `Change priority to ${g.goal.replace('_', ' ')}`,
            summary: `${state.targets?.calories.toLocaleString() ?? '—'} → ${next.calories.toLocaleString()} kcal/day · ${next.proteinG} g protein`,
            rationale: [next.method, 'Your workout plan stays the same. Ask me for a new plan if you also want different training.'],
            change: { type: 'goal_change', goal: g.goal, next: { calories: next.calories, proteinG: next.proteinG, carbsG: next.carbsG, fatG: next.fatG } },
            dedupeKey: `goal-${g.goal}-${today}`,
          }),
        ],
      };
    }
  }

  // 5. Schedule change → new plan
  const daysM = t.match(/\b([2-6])\s*days?\s*(a|per|each)?\s*week\b/);
  if (profile && daysM && /\b(only|can|plan|schedule|train|instead|now)\b/.test(t)) {
    const n = parseInt(daysM[1], 10);
    const spread: Record<number, number[]> = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };
    const plan = generatePlan({ ...profile, trainingDays: spread[n] }, today);
    return {
      safety: false,
      text: tone(tn, `No problem. I've drafted a ${n}-day plan that fits. Have a look and accept it to replace your current plan.`, `${n}-day plan drafted. Accept to replace the current one.`),
      proposals: [
        mkProposal({
          kind: 'new_plan',
          scope: 'ongoing',
          title: `Switch to a ${n}-day plan`,
          summary: plan.days.map((d) => d.name).join(' · '),
          rationale: plan.rationale,
          change: { type: 'new_plan', plan },
          dedupeKey: `plan-${n}-${today}`,
        }),
      ],
    };
  }

  // 6. Tired / sick / poor sleep
  if (/\b(tired|exhausted|no energy|slept badly|bad sleep|didn'?t sleep|sick|ill|cold|flu|fever)\b/.test(t)) {
    const sick = /\b(sick|ill|cold|flu|fever)\b/.test(t);
    if (sick) {
      return { safety: true, proposals: [], text: tone(tn, "Rest is the right call when you're unwell, especially with a fever or chest symptoms. Your plan will be here when you're better. Focus on fluids, sleep and eating enough. When you return, start at about 80% of your usual weights for the first session.", 'Sick = rest. No training with a fever or chest symptoms. Come back at ~80% of your usual weights for one session.') };
    }
    const proposals: Proposal[] = [];
    if (day) {
      const lighter = { ...day, id: newId(), name: `${day.name} (lighter)`, exercises: day.exercises.map((e) => ({ ...e, sets: Math.max(2, e.sets - 1), note: 'Leave 3+ reps in reserve today' })) };
      proposals.push(
        mkProposal({
          kind: 'today_workout_swap',
          scope: 'today',
          title: `Lighter ${day.name} for today`,
          summary: 'One fewer set per exercise, easier effort',
          rationale: ['A lighter session keeps the habit without digging a recovery hole.', 'Today only.'],
          change: { type: 'today_workout_swap', date: today, day: lighter },
          expiresOn: today,
          dedupeKey: `lighter-${today}`,
        }),
      );
    }
    return {
      safety: false,
      proposals,
      text: tone(tn, `Low-energy days happen. ${day ? 'A lighter session often feels better than skipping entirely. One option is below.' : "It's a rest day anyway, so take it easy."} Try to get to bed a little earlier tonight.`, `${day ? 'Train lighter, not zero. Option below.' : 'Rest day. Sleep earlier tonight.'}`),
    };
  }

  // 7. Hunger
  if (/\b(hungry|starving|cravings?|snack)\b/.test(t)) {
    const left = rem?.remaining.calories ?? 0;
    return {
      safety: false,
      proposals: [],
      text: [
        left > 150 ? `You still have ~${left} kcal today, so eat something.` : "You're close to today's target.",
        'High-volume, filling options: Greek yogurt with berries, a big salad with lean protein, vegetable soup, popcorn, an apple with a little peanut butter, or a protein shake.',
        profile?.goal === 'fat_loss' ? 'If hunger is constant for more than a week, tell me. Your deficit may be too aggressive and I can suggest a small increase.' : '',
      ].filter(Boolean).join('\n'),
    };
  }

  // 8. Progress question
  if (/\b(how am i doing|progress|on track|plateau|stuck|not losing|not gaining)\b/.test(t)) {
    const ws = live(state.weights).filter((w) => w.date > addDays(today, -21)).sort((a, b) => a.date.localeCompare(b.date));
    const logged = loggedDays(state, 14, today);
    const sessions = live(state.sessions).filter((s) => s.finishedAt && s.date > addDays(today, -14)).length;
    const lines = ['Here is your last 2–3 weeks:'];
    if (ws.length >= 4) {
      const perWeek = weightSlopePerDay(ws) * 7;
      lines.push(`• Weight trend: ${perWeek >= 0 ? '+' : ''}${displayWeight(perWeek, state.settings.units)} per week (${ws.length} weigh-ins).`);
    } else lines.push('• Not enough weigh-ins yet for a trend. Weigh in 4+ mornings a week.');
    lines.push(`• Food logged on ${logged} of 14 days.`);
    lines.push(`• ${sessions} workouts completed in the last 2 weeks.`);
    lines.push(tone(tn, "I check these automatically and will suggest an adjustment when the data supports one. You'll always approve it first.", 'I adjust targets only when the data is solid, and only with your approval.'));
    return { safety: false, proposals: [], text: lines.join('\n') };
  }

  // 9. What should I eat / remaining
  if (/\b(what should i eat|what to eat|left today|remaining|macros|dinner idea|meal idea)\b/.test(t) && rem) {
    const r = rem.remaining;
    return {
      safety: false,
      proposals: [],
      text: `Remaining today: ${r.calories} kcal · ${r.proteinG} g protein · ${r.carbsG} g carbs · ${r.fatG} g fat.\n${r.proteinG > 30 ? 'Prioritise protein: e.g. chicken or tofu with rice and vegetables, a salmon fillet with potatoes, or Greek yogurt and berries.' : 'Protein is nearly covered, so fill the rest with whatever you enjoy, ideally with some vegetables.'}`,
    };
  }

  // Default
  return {
    safety: false,
    proposals: [],
    text: tone(
      tn,
      `I'm here to help.${day ? ` Today's workout is ${day.name}.` : ' No workout is scheduled today.'}${rem ? ` You have ${Math.max(0, rem.remaining.calories)} kcal left.` : ''}\nYou can ask me things like:\n• "I only have 20 minutes today"\n• "I'm eating out tonight"\n• "My knee hurts"\n• "How am I doing?"\n• "I can only train 3 days a week now"`,
      `${day ? `Today: ${day.name}.` : 'Rest day.'}${rem ? ` ${Math.max(0, rem.remaining.calories)} kcal left.` : ''} Try: "20 minutes today", "eating out tonight", "knee hurts", "how am I doing?", "3 days a week".`,
    ),
  };
}
