# Change log

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
