# Change log

## 2026-10-15 14:30 PDT — Claude

- Workout session: RPE chips per set (shown in the set line), last-session reference with a "Same as last" quick-fill, auto-advance to the next exercise when planned sets are done, "Added weight" for bodyweight lifts, visible edit / warm-up / delete buttons per set. Warm-up sets are ignored by volume and progression.
- Progress > Strength: weekly working sets per muscle vs the previous week.
- Today: coach cards collapsed into one summary row; "Resume workout" banner when a session is active.
- Welcome: "Get started" is the primary action; explains sample data and that photo analysis needs an account. A persistent "Sample data" banner shows on every tab while sample data is loaded.
- Food: explains why Log meal is disabled, Undo after deleting a meal, "Log again today" on past meals, clearer local vs cloud delete copy in Settings.
- Finish sheet shows a warning (not just a disabled button) when no sets are logged.
- RN-web warnings: `useNativeDriver` off on web, `pointerEvents` moved into style.
- README: invite-only signup, OpenRouter, dev-server port 8082 (8081 collides with another project); removed Windows/Gemini wording.

Signed off: Claude

## 2026-10-15 12:00 PDT — Claude

- NumberField no longer strips characters: '-', repeated dots and junk show an inline message; per-field min/max (calories, set weight, body weight, food item kcal).
- Set logging: weight/reps bounds checked in the UI (reducer now also caps a set at 700 kg), warning on a >50% jump vs last session, reducer rule violations shown inline, 400 ms double-tap guard and an Undo button.
- Reps prefill from the last set or the plan minimum so it matches the "fell short of N reps" copy.
- Food item editor requires kcal > 0 like custom add.
- Voice/text parser rejects unparseable input and 0 reps, and parses "@ rpe 9", "135x8" and "3x10@50" (RPE is saved on the set).
- Pure rules live in src/lib/inputRules.ts with tests in src/lib/__tests__/inputRules.test.ts.

Signed off: Claude

## 2026-10-15 00:43 PDT — Codex

- Replaced the user-selectable Gemini gateway with OpenRouter and added GLM 5.3 Flash, Nemotron 3.5 Lightning, and DeepSeek V4.1 Flash choices, with image-capable meal models and short DeepSeek responses.
- Made Groq GPT-OSS 20B the lower-cost default and raised the daily allowance to 25 per user, 250 shared, and 250 per network.
- Added a database migration for existing preferences and limits, and updated settings, tests, security checks, and provider documentation.

Signed off: Codex

## 2026-10-14 15:43 PDT — Codex

- Added a direct regression test for profile database failures returning the fail-closed 503 gate result, shared by AI and notifications.

Signed off: Codex

## 2026-10-14 15:42 PDT — Codex

- Added empty onboarding body fields and a visible plan basis; expanded profile editing with a target preview and plan update prompt.
- Improved phone sync errors, food review confirmation and manual handoff, date labels, workout feedback controls, touch targets, tab labels, and coach composer accessibility.
- Removed prototype wording from the main screens and kept developer status labels in development builds.

Signed off: Codex

## 2026-10-14 15:39 PDT — Codex

- Added server-held per-user Groq and Gemini model choices, derived photo models, admin provider controls, confirmed-email admin bootstrap, audited role changes, and RLS checks.
- Updated the AI and setup documentation for the new preference and admin flows.

Signed off: Codex

## 2026-10-14 15:33 PDT — Codex

- Fixed coach safety word matching and fail-closed profile checks; added regression tests.
- Repaired zero-limit AI status, USDA timeouts and concurrency, food-search refunds, atomic quota reset, signup metering, unclosed thinking blocks, admin user paging, and first-pull onboarding guard.

Signed off: Codex

Record each repository change here in the same commit as the change. Use the local date and time with a time zone, short point-form notes, and the name of the person or agent who made it. Newest entries go first. This log starts on October 14, 2026; earlier changes remain in Git history.

## 2026-10-14 15:28 PDT — Codex

- Expanded the benchmark CSV and report to record visible and detected food names, calculate actual food detection, list missed foods, and reject inconsistent paired measurements. Added deterministic selection from the official test split and kept private source images out of Git.

Signed off: Codex

## 2026-10-14 15:25 PDT — Codex

- Fixed the blocking Edge Function CI job by installing the repository's npm dependencies before Deno resolves `@supabase/supabase-js`.

Signed off: Codex

## 2026-10-14 15:19 PDT — Codex

- Added calorie floor checks when proposals are created and accepted, including proposals loaded from older state; routed urgent and injury red flags to fixed responses.
- Validated photo estimates before USDA lookup, reviewed up to eight conservative food matches, and saved confidence, portion assumptions, and estimate quality with a versioned migration.
- Added optional post-workout effort and pain check-in, kept progression behind approval, and labelled pilot AI and activity features accurately.
- Made the Edge Function type check block CI and added a paired photo benchmark template and report script. The 130 reference meals and provider access are still needed to produce measured results.
- Added safety, food validation, and migration tests. Retained the current `v2` photo deletion and retry implementation.

Signed off: Codex

## 2026-10-14 15:10 PDT — Codex

- Created this running change log for the FitCoach repository.
- Linked the log from the README and added an agent instruction to update it with future changes.

Signed off: Codex
