# Review round 1

Two simulated users reviewed the app before round 2 (see `PRD_ROUND_2.md`). Their reports are reproduced below, lightly formatted. Neither had Supabase configured, so signed-in features (AI chat, sync, invites, admin) were not tested.

## Marcus: experienced lifter (3.5/5)

### 1) Review

> Solid bones. Sample mode loads fast, today's workout and macros are on one screen, suggestions explain themselves ("fell short of 6 reps, repeat weight"), and the 1RM trend chart is what I want. But there is no RPE anywhere, the set log accepts nonsense, and I can't see sets/volume per muscle. Good tracker, not yet a lifter's tool. **3.5/5.**

Mode: no .env, so I used "Explore with sample data" and drove it with Playwright + Chrome on desktop width. Signed-in features not exercised.

### 2) Bugs

- Weight of 99999 lb is accepted and logged (Train > Start > Upper B, type 99999, Log set). No cap or confirm, and it would pollute e1RM/PRs.
- Rapid taps on "Log set" log duplicates: 6 taps gave 6/3 sets, with no cap and no debounce.
- Voice/text parser: "asdf" still produces a saveable entry with a warning; "lateral raise 0 reps 20 lb" shows reps 0 while the stepper min is 1; "@ rpe 9" is silently ignored.
- Weight field: typing "abc" or "-50" is accepted/cleared silently, no validation message.
- Suggestion says "Some sets fell short of 6 reps" while the default reps field is prefilled with 10, which is confusing.
- Unconfirmed: clicking "Finish" in the session and "Generate a new plan" produced no visible change in my script (still on /workouts/session; the Generate click showed no dialog). It may be a confirm sheet I missed, or a real bug. Needs a manual look.
- Console: RN-web warnings (useNativeDriver, pointerEvents deprecated). No page errors.

### 3) UI changes (priority order)

1. Add an RPE/RIR chip per set; show it in the set history line.
2. Show a previous-session column ("last: 57.3 x 8") beside the weight/reps inputs.
3. Stepper for the weight field on Pull-up (bodyweight) to add weight.
4. Show each set's check/edit/delete affordance and a warm-up toggle.
5. The 10 coach cards on Today are heavy; collapse into one row.

### 4) UX changes (priority order)

1. Validate sets: weight/reps bounds, and warn when jumping more than ~50% from last time.
2. Disable "Log set" briefly after a tap, or support undo.
3. Let the parser handle RPE and "x" notation (135x8, 3x10@50).
4. Add a plan-wide "same as last time" quick-fill, and auto-advance to the next set after logging.
5. Show weekly volume per muscle in Progress.
6. Back navigation mid-session resumes correctly (good); add a visible "resume" banner on Today.

### 5) Could not test

- Real AI chat, invite signup, sync, and admin console: no Supabase env.
- Camera/photo food capture, barcode scan, and native notifications: need a device and permissions.
- Real voice (Speak button) in headless mode.
- Progress photos upload, export file download, and delete data (destructive actions not clicked).
- Coach accept/reject was read from rendered cards only, not clicked.

## Dana: beginner (2.5/5, welcome screen only)

Important limit: the reviewer had no interactive browser tool. Only the welcome screen was loaded (headless Chrome screenshots); everything past it is from reading source, not observed. No `.env.local` (Supabase not configured).

### 1) Review

> The welcome page looks sharp and tells me what the app does in plain words, and "Takes about 2 minutes" is reassuring. But "Get started" versus "Explore with sample data" is confusing, and the note that photos are not analysed until I connect an account makes the headline photo feature feel fake. I can't judge the rest. I'm worried that typing a minus in a calorie box silently turns into a positive number. **2.5/5.**

### 2) Bugs

- Port 8081 was already used by another project. Environmental, not an app bug; 8099 was used instead.
- Probable: at a 420px-wide headless viewport, the welcome headline, buttons and info cards are clipped on the right edge. At 1280px it is fine. Could be a headless-window artifact; needs verification at 360–390px on a real phone or emulation.
- By source (`src/components/ui.tsx` NumberField): the filter `replace(/[^0-9.]/g,'')` strips "-" silently, so "-500" becomes 500 with no error. Inputs such as "1.2.3" are also accepted and parse as 1.2. Steps: Add food > custom item > Calories "-500". Expected an error; actual is +500 kcal.
- By source (FoodItemEditor): the edit sheet only checks `Number.isFinite(calories)` and the name, so an existing item can be saved with 0 kcal, while the custom-add path requires >0. Inconsistent.

### 3) UI changes (prioritized)

1. Verify and fix mobile-width overflow on the welcome screen.
2. Make "Get started" visually primary and explain "sample data" in one line.
3. Show a visible "Sample data" banner across all tabs.
4. Show field-level validation text such as "Enter a number above 0", not silent stripping or a disabled button with no reason.

### 4) UX changes (prioritized)

1. Say on the welcome screen, not only in a small card, that photo analysis needs an account. Otherwise photo logging looks broken in demo mode.
2. Explain why "Log meal" is disabled when no items are added.
3. Reject negative or implausible values (calories above 5000, etc.) with a message.
4. Add undo for meal delete, and make "Delete my data" explicit about local vs cloud. Source has a confirm step, which is good.
5. Offer a quick "re-log yesterday's meal" shortcut for beginners.

### 5) Could not test

Needs interaction that wasn't possible without a browser driver: onboarding, Today dashboard, photo capture, barcode (needs camera and device), coach chat (logging food or changing targets via chat, needs real AI/Supabase), progress and activity charts, settings (units, tone, AI model, notifications), export and delete, and empty/error states. Also untestable without Supabase env: invite signup, sync, real AI, admin.

## Round 1.5 findings

Issues the owner reported before promoting the round 2 build:

1. **Plan out of step with the goal.** Settings shows "Build muscle" and a 2,450 kcal target, but "Why this plan?" still says the rep ranges are for fat loss. Settings explains that a plan must be regenerated, but a prompt to do that is expected after changing goals.
2. **Misleading accepted-change card.** The coach's accepted-change card headline says the calorie target changed from 1,780 to 2,450, while the detailed comparison shows 2,450 on both sides.
3. **Farmer's Carry reps tip.** Farmer's Carry is measured in seconds, but its first-time weight tip talks about doing 47–48 reps.
4. **Coach missed the question.** A question about whether looking at feet burns calories got a generic workout-and-calories response; a repeated question got a relevant answer.
5. **Banana search ordering.** Searching "banana" put unusual branded products above "Banana, raw", making the common choice harder to find.
