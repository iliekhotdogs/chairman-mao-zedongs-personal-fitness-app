# PRD: FitCoach Round 2 (maozedong fitness app)

Repo: `/Users/wesleypang/Documents/GitHub/chairman-mao-zedongs-personal-fitness-app` · Expo/RN web + Supabase · rules in `AGENTS.md` (pure logic in `src/lib` with tests, `log.warn/error` not empty catches, no secrets in `EXPO_PUBLIC_*`, kg/cm, local `YYYY-MM-DD`, new synced data needs `SYNCED_COLLECTIONS` + `records_collection_check`, **every change gets a top entry in `docs/CHANGELOG.md`**).

## 1. Context
Two simulated users reviewed the app (Marcus 3.5/5, Dana 2.5/5 – welcome screen only). Findings + the owner's feature asks become this PRD. Decisions made by owner:
- Agent profile = **an AI coach prompt optimized for coaching, replying to coaching topics only**.
- AI log edits = **confirm tap** (proposal flow, reducer `confirmedAt`).
- Admin = **wesley.pang1@gmail.com**.
- Signed-in review coverage later via **staging Supabase + invite code**.

Reuse, don't rebuild: admin console `src/app/admin.tsx` + `supabase/functions/admin-stats`; `profiles.role`, `admin_bootstrap_emails`, `admin_audit`; coach intents -> `proposalsForIntents` (`src/lib/ai/provider.ts`); sole state writer `src/lib/reducer.ts`; `_shared/coachSafety.ts`; `_shared/foodValidation.ts`; `user_ai_prefs`; `NumberField` in `src/components/ui.tsx`.

## 2. Requirements (each = one work package; ID used by subagents)

### P0 – Owner features
**F1 Coach prompt / agent profile**
- Server-side system prompt in `supabase/functions/ai/index.ts` (`coach` action), moved to `_shared/coachPrompt.ts`: role = fitness/nutrition/training coach; scope-limited. Off-topic (code, politics, homework, etc.) -> short polite redirect, no answer. Medical/injury/eating-disorder topics -> existing `coachSafety.ts` path.
- Output stays structured JSON `{reply, safety, intents[]}`; prompt documents the allowed intents (F2) and the user's context (goal, targets remaining, today's workout, recent weights/sessions from `coachContext()`).
- User-tunable: tone (existing setting) + optional coach name; no free-text prompt injection into system prompt (treat user text as data).
- Mirror scope refusal in `coachSim.ts` (offline sim) so behavior matches.
- Tests: off-topic refused, on-topic answered (unit test on prompt builder + sim; live provider checked manually).
- AC: asking "write me a Python script" gets a redirect; "how much protein today?" gets a coaching answer using the user's targets.

**F2 AI edits food + workout log (confirm tap)**
- New intents `log_food`, `edit_food`, `delete_food`, `log_workout` (food name, qty, kcal/macros; exercise, sets/reps/weight/RPE). Server validates via `foodValidation.ts` + bounds (reps 1–300, weight 20–400 kg, kcal 0–5000, >=1 item).
- `proposalsForIntents` maps to reducer actions `LOG_FOOD`/`UPDATE_FOOD`/`DELETE_FOOD`/`START_SESSION`+`ADD_SETS`; proposal card shows exactly what will change; Accept sets `confirmedAt`; Reject discards. No silent writes.
- Edits to "calories" = edit item kcal on an existing entry (`UPDATE_FOOD`), nothing else.
- Tests in `src/lib/__tests__` for intent->action mapping and rejection of out-of-range values.
- AC: "log 2 eggs and a 30 min run" -> proposals -> accept -> appear in Food/Today and Train; "that lunch was 600 kcal not 800" -> edit proposal.

**F3 Bug reports + admin view**
- Migration `bug_reports(id uuid pk, user_id, body text (<=2000), route, app_version, platform, status 'open'|'triaged'|'closed', created_at)`; RLS: user insert + select own; admin select/update all (`profiles.role='admin'` check, fail-closed like `_shared/profile.ts`). Rate-limit: max 10/day/user.
- Settings: "Report a bug" form (body, auto-attach route/version/platform; **no** state dump or PII). Show success + own-reports list.
- Admin console: "Bug reports" tab with status filter and status change (new `admin-stats` actions `list_bugs`, `set_bug_status`; write to `admin_audit`).
- AC: user files bug; admin sees it; non-admin cannot read others'.

**F4 Admin account + non-secret user stats**
- Seed `wesley.pang1@gmail.com` in `admin_bootstrap_emails` (migration); verify bootstrap promotes on signup/login. Account must still be created via invite.
- `list_users` / new `user_stats` action returns **whitelist only**: signup date, last active, counts (food entries, sessions, weigh-ins), current streak, goal type, avg kcal vs target (7d), AI usage count, disabled flag. **Never**: chat text, photos, raw weights/food items, push tokens, email-level secrets (email shown to admin only if already shown today).
- `admin.tsx` user detail view. Server-side whitelist in the Edge Function (not client filtering).
- AC: admin sees the stats table; non-admin gets 403; response payload contains only whitelisted keys (test).

### P1 – Review fixes: input safety (from both reviewers)
- **R1 Shared numeric validation:** rewrite `NumberField` (`src/components/ui.tsx`): no silent stripping; reject `-`, multiple dots; per-field min/max props; inline message ("Enter a number above 0"). Apply to calories, set weight, reps, body weight. Unit tests for parser.
- **R2 Set bounds:** UI blocks weight/reps outside reducer limits (99999 lb bug); warn when >50% jump vs last session; surface reducer `RuleViolation` as a message not a no-op.
- **R3 Double-tap guard:** "Log set" disabled ~400 ms after tap + undo toast.
- **R4 Food edit parity:** `FoodItemEditor` requires kcal > 0 like custom-add (or explicit "0 kcal" confirm).
- **R5 Voice/text parser** (`src/lib/workouts/voiceParser.ts`): reject unparseable input ("asdf") instead of saveable entry; 0 reps invalid; parse `@ rpe 9`, `135x8`, `3x10@50`. Tests.
- **R6 Copy fix:** "fell short of 6 reps" vs prefilled 10 – prefill reps from the plan/last set.

### P2 – UX/UI improvements
- U1 RPE/RIR chip per set, shown in history line (data field `rpe` already exists on `LoggedSet`).
- U2 "Last session" column (last: 57.3 x 8) next to weight/reps; auto-advance to next set; "same as last time" quick-fill.
- U3 Pull-up/bodyweight: allow added weight; per-set edit/delete/warm-up toggle visible.
- U4 Weekly volume per muscle in Progress.
- U5 Today: collapse the 10 coach cards into one summary row; "Resume workout" banner.
- U6 Welcome: make "Get started" primary; one-line explanation of "sample data"; say up front that photo analysis needs an account; persistent "Sample data" banner on all tabs.
- U7 Explain disabled "Log meal"; undo on meal delete; "re-log yesterday's meal"; "Delete my data" copy distinguishes local vs cloud.
- U8 Verify/fix welcome layout clipping at 360–390 px.
- U9 Investigate unconfirmed bugs: session "Finish" and "Generate a new plan" showed no effect (may be a confirm sheet).

### P3 – Housekeeping
- H1 README refresh (stale: Windows/"Gemini"; now OpenRouter, invite-only signup).
- H2 Replace RN-web deprecated `useNativeDriver`/`pointerEvents` warnings where practical.
- H3 Dev-server port: use a documented free port or `--port` flag note in README (8081 collides with `~/fitcoach`).
- H4 Add `docs/REVIEW_ROUND_1.md` with the reviewer reports; save this PRD to `docs/PRD_ROUND_2.md`.
- H5 Second review round (after P0–P2): staging Supabase env + invite; two reviewers with Playwright cover onboarding, coach, progress, settings, export, admin.

## 3. Execution (subagents edit; I orchestrate)
Single main thread owns merge order. After approval:
1. Write `docs/PRD_ROUND_2.md`, `docs/REVIEW_ROUND_1.md` (me).
2. Launch parallel `general-purpose` subagents, each in its own git worktree (`isolation: "worktree"`) on a branch, one per package, with disjoint file sets:
   - **A:** F3 + F4 (migrations, `admin-stats`, `admin.tsx`, settings bug form)
   - **B:** F1 + F2 (`supabase/functions/ai`, `_shared`, `provider.ts`, `coachSim.ts`, proposals)
   - **C:** R1–R6 (`ui.tsx`, `FoodItemEditor`, `voiceParser.ts`, session screen)
   - **D:** U1–U9 + H1–H3 (screens, welcome, Today, Progress) – start after C merges (shares `ui.tsx`/session screen)
3. Each agent: tests first for pure logic, run `npm run typecheck && npm run lint && npm test`, add CHANGELOG entry, commit on its branch. Do not push; do not run `check:rls` against anything but staging; do not apply migrations to prod.
4. I merge A, B, C, then D; resolve conflicts (CHANGELOG, `types.ts`); run full checks.
5. Code review pass (`agent-skills:code-reviewer` + `security-auditor` on F3/F4 RLS and the admin whitelist).
6. Migrations and edge-function deploys are **left for the owner to apply** (outward-facing).

## 4. Verification
- `npm run typecheck && npm run lint && npm test`, all green; new tests for parser, NumberField, intent mapping, admin whitelist, coach scope.
- Manual in `npm run web`: negative/huge inputs rejected; double-tap logs one set; coach scope + log proposals accept/reject; bug report round trip; admin sees stats, non-admin blocked.
- Staging only: `npm run check:rls -- --yes`; confirm `bug_reports` and admin whitelist.
- H5 second review round once staging env exists.

## 5. Risks / not decided
- Real coach-scope quality depends on the live provider; needs a manual prompt test (no keys locally).
- Admin email must be created via invite signup; the PRD seeds the allowlist only.
- D depends on C merging first (shared files); cost is serial time.
- Out of scope: wearables, native Android release, new providers.
