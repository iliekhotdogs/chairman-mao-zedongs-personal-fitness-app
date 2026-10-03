# FitCoach

A fitness app for **Android and desktop browsers** that cuts down food-logging effort, tracks gym progress, and gives personalised coaching. Built with Expo, React Native and TypeScript, so one codebase serves both.

> **Status: working prototype.** Accounts and per-user sync use Supabase. Coach chat uses the owner’s OpenRouter key; meal photos keep the owner’s NVIDIA key and original vision model. Both keys belong in Supabase Edge Function secrets. Database migration and functions must be deployed before these features work end to end. See [setup](docs/SETUP.md) and [verification](docs/TESTING.md).

## What's in it

| Area | What works now |
| --- | --- |
| Onboarding | Goals, body stats, experience, equipment, schedule, diet, injuries. Explains why each is asked. Proposes calorie/macro targets and a workout plan for approval. |
| Dashboard | Calories and macros remaining, today's workout, daily activity, body weight, and at most 1–2 coaching items. Separate phone and desktop layouts. |
| Photo food logging | Photo + optional hint → itemised estimate with portions, sources, confidence, and follow-up questions. **Nothing is logged until you press Accept.** Manual entry, editing and deletion included. |
| Adaptive nutrition | Weight-trend target adjustments and one-day activity bonuses (no double counting; wearable estimates discounted). Accept/Decline; today-only vs ongoing clearly marked. |
| Workouts | Generated plans (goal/experience/equipment/schedule/injuries/time), your own routines, fast manual logging, voice/text logging with review, double-progression suggestions that update the plan only after approval. |
| AI coach | Chat that uses your data; handles "20 minutes", "eating out", "my knee hurts"; safety rules for pain; supportive or direct tone. |
| Progress | Calories vs target, weight trend with 7-day average, estimated 1RM per lift, activity review with de-duplication. |
| Notifications | Preferences, quiet hours, **hard cap of 3/day across devices** (enforced locally and in the database). |
| Privacy | Per-user Row Level Security, private photo storage, data export, delete device data, delete cloud data. |

## Run it (Windows)

```bash
npm install
npm run web
```

Then open http://localhost:8081. On the first screen choose **Explore with sample data** to see every feature with three weeks of realistic data, or **Get started** to onboard as yourself.

On an Android phone: install **Expo Go** from the Play Store, run `npx expo start`, and scan the QR code (the phone and PC must be on the same Wi-Fi).

```bash
npm test          # 74 unit tests for the business rules
npm run typecheck # TypeScript
```

## Project layout

```
src/app/            screens (Expo Router). (main)/ = signed-in area with the nav shell
src/components/     UI kit (ui.tsx), charts, coaching cards, food editors
src/lib/            all business logic, no UI: nutrition, workouts, coaching, sync, notifications
src/lib/reducer.ts  the single place state changes; enforces confirmation/approval rules
src/store/          persistence, coaching engine scheduler, cloud sync
supabase/           database schema (RLS) + Edge Functions (AI, notification cap)
docs/               setup, AI provider & costs, wearables, testing report, release checklist
```

## Next steps

See [docs/SETUP.md](docs/SETUP.md) to connect accounts (Supabase, AI provider) and [docs/RELEASE.md](docs/RELEASE.md) for Google Play preparation.
