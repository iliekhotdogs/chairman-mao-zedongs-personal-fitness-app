# Testing report: what was actually tested

Last run: 2 Oct 2026, Windows 11, Node 24.19, Expo SDK 57.

## Automated

| Check | Result |
| --- | --- |
| Unit tests (`npm test`) | **76 / 76 pass**: food-confirmation rule, accept/reject/expiry of suggestions, one-day vs ongoing changes, permanent limitations not downgraded, notification cap (3/day across devices, quiet hours, dedupe, low priority), voice parsing, progression, activity de-duplication, LWW sync merge incl. tombstones and new-device defaults, plan generator (injuries, equipment, time, weekdays), coach safety replies. |
| TypeScript (`npm run typecheck`) | Pass |
| ESLint (`npx expo lint`, React Compiler rules) | 0 problems |
| `npx expo-doctor` | 21/21 checks pass |
| Production web build (`npx expo export --platform web`) | Builds |
| Android JS bundle (`npx expo export --platform android --no-bytecode`) | Builds. The local Hermes bytecode step could not launch in this sandbox; EAS cloud builds do that step themselves. |

## Manually tested in a desktop browser (Chromium, localhost)

- Onboarding end to end (goal, body, training with knee limitation, lifestyle, plan review, accept). Targets were checked by hand against Mifflin–St Jeor. The knee limitation correctly removed squats.
- Dashboard (desktop 3-column and **phone 375 px**), with and without sample data.
- Photo-logging flow using hints: multi-item estimate, restaurant follow-up question, answer → re-estimate, **Accept & log** → appears in Food log; nothing is logged before Accept.
- Coach chat: "20 minutes" → today-only proposal → accepted → dashboard shows the adjusted workout; "My knee hurts" → safety guidance plus approval-gated change.
- Adaptive nutrition with sample data: activity bonus accepted (today's target 1,890 → 2,090, ongoing unchanged); weight-trend change declined (targets unchanged).
- Workout session: text "voice" input parsed into a reviewable card → saved 3 sets → finished → progression proposal → accepted → plan shows the new target weight.
- Progress → Calories chart; Settings → load sample data.
- Bugs found and fixed during this testing are listed in the git history (e.g. "medium fries", "no cheese", new-user "missed workouts", knee limitation downgrade, plank in seconds).

**Not re-checked visually after the final audit fixes** (compiled, typechecked and linted only): Activity screen, routine editor, manual-entry screen, UI-states gallery, and Settings → Account section. The browser pane was suspended at the end of the session.

## Simulated (labelled in the app)

- **AI**: photo recognition (hint-based only) and coach chat (rule-based).
- **Health Connect**: generated phone + watch data.
- **Notifications**: local browser/device notifications only. No remote push.

## Implemented but unverified (needs accounts or devices)

- Supabase sign-in, cross-device sync, photo upload, RLS policies (`supabase/migrations/0001_init.sql`).
- Edge Functions `ai` (Claude vision + USDA + official-restaurant web search) and `notify` (server-side 3/day cap). They have not been deployed or type-checked with Deno.
- Physical Android phone via Expo Go: not tested (no device connected to this PC).
- Camera capture, Android keyboard dictation, Android notification permission.
- Real meal photos on web (thumbnail persistence path).

## How to test on your phone next

1. `npx expo start`, scan the QR with Expo Go.
2. Run through: onboarding → snap a real meal photo (with hint) → accept → start workout → dictate a set with the keyboard mic → finish → accept suggestion.
3. Note anything odd and paste it to Claude Code.
