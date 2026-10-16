# Change log

## 2026-10-16 11:51 PDT — Claude

- UX fixes from a local QA pass (mocked Supabase session; signup is invite-only):
  - Coach: short greeting reply; unmatched input says "I can't answer that offline."; server failure shows one "Coach unavailable" banner (announced to screen readers) instead of stacked generic bubbles; Retry reuses the failed message; replies render **bold**, lists and headings; raw server errors map to a friendly message; thousands separators.
  - Training: "Today's workout" card under the header with one action (Start, Resume or View session), override badge and rest-day state via new `todayWorkout` helper; duplicate Start buttons removed; weekly plan uses a grid. "Continue" is now "Resume" everywhere.
  - Today: desktop right column holds workout, activity and weight, then the Coach row.
  - Progress: average intake, protein and days near target show "—" until 3 completed logged days ("N of 3 logged days needed", today excluded); responsive 320 px range control, tabs, axis labels and round y-ticks.
  - Food: "Add meal" in empty states; recent meals use two lines with "+N items" and a full accessible label; Recent meals no longer lose older meals to the selected day.
- Visual redesign toward the FC88 look: #181818 base with grain, soft sage-mint accent (#9BD8B3), uppercase Barlow Condensed headings, blob-cornered buttons and cards, hover wiggle (off under reduced motion), hidden scrollbars, landing marquee. New tokens `Blob`, `Ease`, `glyph`; `chartBar` recoloured.
- Softened the palette (sage-mint accent #9BD8B3, slightly warmer text) and rewrote landing copy from first person ("I train. I eat.") to second person ("Train. Eat. Feel better.").
- Local verification: TypeScript, 440 Jest tests, web export, Deno typecheck and 6 Edge Function tests passed; lint has 0 errors (1 existing warning in usda.test.ts). Not run against a real account or deployed.

Signed off: Claude

## 2026-10-16 11:14 PDT — Codex

- Added web main landmarks and keyboard skip links to app screens and the public landing page. Progress bars now name the metric they show, and segmented options can wrap long labels on narrow screens.
- Clarified Progress milestones by calling the profile entry the setup weight. Confirmed the single-weigh-in view already hides change and has one Log weight button.
- Traced "ANY DAY" to regenerating a plan after all training days are cleared in Settings. Such plans now say "Flexible day" and explain the missing schedule.
- CI runs the restaurant Edge Function's Deno tests. The staging RLS check now covers saved foods, restaurant catalog access, import sources, and the privileged replacement RPC; verification docs were updated.
- Local verification: TypeScript, lint, 423 Jest tests, web export, Deno typecheck, 6 Edge Function tests, and script syntax passed. Browser automation and the live staging RLS run still need an accessible browser/server and staging credentials.

Signed off: Codex

## 2026-10-15 23:32 PDT — Claude

- UX fixes from a local Playwright test pass (5 test accounts on a local Supabase stack):
  - Bounded numeric input everywhere it was missing: onboarding calorie override (calorie floor–6000), protein target (≤60% of calories), food editor and custom items (5000 kcal, 1000 g macros, 5000 g amount; Save blocked while a field has an error), steps (1–100,000), age/height/session. Negative numbers say "Can't be negative."
  - New shared `HeightField` (cm or ft/in, inches 0–11) used by onboarding and Settings; Settings honours imperial units; onboarding plan summary uses units and labels.
  - Sign-in: placeholders, email check, hint on the disabled button, friendly wrong-password copy, inline reset notice, `current-password`.
  - Sign-out while offline or with sync failing warns that unsynced changes will be lost ("Sign out anyway"). Sync shows an Offline state and "Can't reach the server. We'll retry." instead of raw fetch errors.
  - Profile is saved immediately when onboarding finishes (closing the tab within the debounce lost it).
  - Admin button reads the user's own `profiles` row instead of calling `admin-stats` (no 403 for every non-admin load).
  - Enter submits: workout weight, steps, weigh-in, food search. Undo for deleted sets, weigh-ins and meals (toast now supports an action and lifts above the coach input).
  - Workouts: confirm before logging 0 on a weighted lift, rest-day start view shows plan days and a Freestyle button, routine Cancel confirms when dirty, plural/target copy fixes, larger RPE/More targets.
  - Activity: edit/delete manual days, month on the chart axis, "No steps entered" copy; `mergeActivity` restores a re-entered deleted manual day.
  - Progress tab kept in the URL; single weigh-in shows "—" change; duplicate empty-state buttons removed. Coach input capped at 2,000 characters; desktop proposal shown once.
  - Barcode: typed lookups scroll the result into view; camera start state; "no camera" vs "blocked" copy.
  - Accessibility: `aria-checked` on Chip/Segmented/OptionCard/Toggle, `aria-current` on sidebar links, labelled progress bars, 44 px expanders and links, per-route web titles. Cloud data delete needs typed DELETE (case-sensitive, as does Delete account). Export confirms with a toast.
- Food AI and personal database:
  - New synced `savedFoods` collection (STATE_VERSION 3, migration 2→3) for confirmed barcode products, restaurant dishes and custom foods; migration `20261016000100_saved_foods.sql` adds it to `records_collection_check` (not applied to fitdih).
  - Barcode: saved personal products are added immediately; new Open Food Facts products open a verify form (name, brand, flavour, package size, serving basis g/mL/per serving). Nutrition Facts photo option reads a label through the existing `estimateFood` client; every value is editable and must be confirmed. Missing macros stay missing (`FoodItem.missing`, shown "—"), and mL is never treated as grams.
  - Food screen: Recent meals with Log again (independent copy), Restaurants visited, Save as restaurant dish.
  - Restaurant catalog: migration `20261016000000_restaurant_catalog.sql` (read-only `restaurant_items` for signed-in users, service-role writes, atomic replace RPC, weekly pg_cron job reading Vault secrets) and the `restaurant-import` Edge Function with per-source parsers, zod validation, and needs_review on failure or suspicious drops. Boston Pizza and Olive Garden Canada are seeded **disabled**: both sites' terms forbid scraping/automated access (checked 2026-10-15). Enable only with written permission.
  - `estimate_food` returns restaurant and dish guesses in the same model call, up to 3 official candidates (stale >30 days labelled), a disagreement note, and a menu/label suggestion for unknown restaurants. Candidate picker on the capture screen.
  - Coach context includes confirmed food totals (14 days) and finished sessions with top sets (28 days); context cap 9,000 characters.
- Not deployed: run `supabase db push`, `supabase functions deploy ai` and `supabase functions deploy restaurant-import`, and add Vault secrets `project_url` and `service_role_key`. See docs/SETUP.md.

Signed off: Claude

## 2026-10-15 19:20 PDT — Claude

- Barcode scanner hardening (branch `barcode-hardening`, local only): lookups try the EAN-13 form first, then the raw code; UPC-E codes are expanded to UPC-A (only when the expanded check digit holds) and UPC-E check digits are validated on the expansion. Scanned codes with a bad check digit are ignored silently (no request, scanner stays armed).
- Open Food Facts replies are parsed with zod, lookups time out after 8 s and abort on unmount or a new scan, and results are cached on device (30 days found, 1 day missing).
- When Open Food Facts has no product or no calories, one USDA branded-food search by GTIN runs (exact GTIN match only, once per code per session). The `ai` edge function's `search_food` now returns `gtinUpc`: needs `supabase functions deploy ai` before signed-in accounts get the fallback (not deployed).
- Scanner screen: torch toggle (native), scan hint, success haptic.

Signed off: Claude

## 2026-10-15 18:02 PDT — Claude

- New migration `20261015000500_admin_stats_safe_casts_bug_delete.sql` (not applied): `admin_user_stats` reads record dates and numbers through `safe_date` / `safe_numeric` (null on bad values) and ignores non-array `items`, so one malformed record no longer breaks a user's stats. Still service role only.
- Users can delete their own bug reports (owner delete policy and grant; trash button with a confirm sheet in Settings). The daily cap of 10 now counts sends in `bug_report_counts` (UTC day), so deleting does not free quota. The Settings list shows only the signed-in user's reports (admins could see everyone's there).
- `admin-stats` audits fail closed (503): `list_bugs` now writes an audit row; `set_bug_status`, `set_disabled` and `reset_quota` write the audit row before the change and stop if it cannot be saved. `set_role` was already audited inside its RPC.
- `rls-check` also confirms `bug_report_counts` is closed to users.

Signed off: Claude

## 2026-10-15 16:00 PDT — Claude

- Coach history hardening: the `ai` function no longer replays client chat history as model turns. It keeps the last 8 user/assistant turns (1,000 chars each; other roles dropped), folds them into one quoted `<history>` transcript in the user turn, and states that `coach:` lines are not the model's own words. Server-stored history is still the only full fix (noted as a `shortcut:`).
- Scope: the system prompt is now the primary off-topic control (exact `OFF_TOPIC_REPLY`, intents `[]`). The `isOffTopic` regex is a cheap pre-filter only; removed words that hit real fitness questions (program, translate, assignment, java, solve this problem, who won the).
- The coach answers the latest message first: it is sent last inside `<latest_message>`, and the prompt says to answer it directly and use data only to support it. The offline coach says it has no built-in answer to an unmatched question instead of a generic status reply.
- The app validates every coach intent with zod (non-action intents too) before building a proposal; invalid ones are dropped with `log.warn`.
- Target and goal change cards compare against the targets captured on the proposal (`change.before`), so an accepted card no longer shows the new value on both sides. Older proposals without it show "—" once accepted.

Signed off: Claude

## 2026-10-15 16:30 PDT — Claude

- Generated plans store the goal they were built for. When the profile goal no longer matches (older plans are read from their rationale), Training and Settings > Current priority show "Your plan was built for <goal>. Regenerate?" with a button that opens the existing plan preview. "Why this plan?" names the goal by its Settings label.
- Progression tips are unit-aware: timed exercises (Farmer's Carry, Plank) talk about seconds, never reps. The edit-set sheet and "last session" line show seconds for timed sets.
- Food search: built-in results rank exact, then prefix, then whole-word name matches, then shorter names; USDA results put generic entries (e.g. "Banana, raw") before branded ones.
- Added docs/REVIEW_ROUND_1.md (Marcus and Dana reviews, Round 1.5 owner findings).

Signed off: Claude

## 2026-10-15 15:10 PDT — Claude

- Security audit fixes: bug report insert is column-limited (no client `id`/`created_at`, so the daily cap cannot be bypassed), `user_stats` fails closed when the audit row cannot be written, and `<` is escaped in the coach prompt's user-data fence.

Signed off: Claude

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

## 2026-10-15 12:30 PDT — Claude

- Added `bug_reports` migration (RLS: own insert/select, admin select/update; 10 per day limit) and an idempotent seed of the owner email into `admin_bootstrap_emails`.
- Added `admin_user_stats` RPC and the `list_bugs`, `set_bug_status` and `user_stats` admin-stats actions; stats go through a server-side key whitelist (`_shared/userStats.ts`), and status changes and stat views are written to `admin_audit`.
- Added a Bug reports section and per-user stats detail to the admin console, and a Report a bug form in Settings that attaches only route, app version and platform.
- Migration is not applied and the function is not deployed.

Signed off: Claude

## 2026-10-15 17:50 PDT — Claude

- Coach (F1): moved the server system prompt to `_shared/coachPrompt.ts`; coaching-only scope with a fixed redirect for off-topic asks (no provider call), user data fenced as data, optional sanitized coach name plus the existing tone. The offline coach mirrors the refusal; medical wording still takes the safety path first.
- Coach (F2): new intents `log_food`, `edit_food`, `delete_food`, `log_workout`, validated server and client side (reps 1-300, weight 20-400 kg, kcal 0-5000, at least 1 item; rejected, not clamped). They become proposals that map to LOG_FOOD / UPDATE_FOOD / DELETE_FOOD / START_SESSION + ADD_SETS + FINISH_SESSION only when accepted (`confirmedAt` is stamped at accept). Proposal cards show the exact change.
- Added `coachActions` tests for mapping, bounds and scope.

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
