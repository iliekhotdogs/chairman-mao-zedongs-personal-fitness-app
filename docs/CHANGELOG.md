# Change log

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
