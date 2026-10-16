# FitCoach

A fitness app for **Android and desktop browsers** that cuts down food-logging effort, tracks gym progress, and gives personalised coaching. Built with Expo, React Native and TypeScript, so one codebase serves both.

> **Status: working prototype.** Accounts and per-user sync use Supabase. Coach chat and meal photos go through the server AI gateway, a Supabase Edge Function that holds the provider key. Database migration and functions must be deployed before these features work end to end. See [setup](docs/SETUP.md) and [verification](docs/TESTING.md).

See the [change log](docs/CHANGELOG.md) for dated, signed notes on repository changes.

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

## Run it

```bash
npm ci
npx expo start --web --port 8082
```

Then open http://localhost:8082. The default `npm run web` uses port 8081, which can collide with another Expo project on the same machine; pass `--port` to pick a free one.

Without Supabase configured the app runs on this device only and the first screen offers **Explore with sample data** (dev builds): made-up meals and workouts so you can try every screen, marked by a "Sample data" banner. Meal photo analysis and the shared AI coach need an account. Sign-up is **invite-only** while in beta: create the account with an invite code. AI requests go through the Supabase `ai` Edge Function to **OpenRouter** (and Groq); see [docs/AI_PROVIDER.md](docs/AI_PROVIDER.md).

On an Android phone: install **Expo Go** from the Play Store, run `npx expo start`, and scan the QR code (the phone and computer must be on the same Wi-Fi).

```bash
npm test          # unit tests (business rules, sync, storage, export)
npm run typecheck # TypeScript
npm run lint      # ESLint
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

## Web deploy (Vercel)

The website is a static export served by Vercel. `vercel.json` at the repo root already sets the build command, output folder, SPA rewrite and asset caching.

1. Import the repository in Vercel. Build command: `npm run build:web` (runs `expo export --platform web`). Output directory: `dist`. Node 20 or 22.
2. Set environment variables (Production and Preview):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - optional `EXPO_PUBLIC_USDA_API_KEY` (otherwise USDA's rate-limited `DEMO_KEY` is used)

   These are public values baked into the bundle. Never put secret or service-role keys in `EXPO_PUBLIC_*` variables.
3. In Supabase, **Authentication > URL Configuration**: set the Site URL to the Vercel domain and add it (and any preview or custom domains) to the Redirect URLs, so sign-up confirmation and password-reset links return to the site.
4. To check locally: `npm run build:web`, then serve `dist/` (for example `npx serve -s dist`) and refresh on a nested route.

## Next steps

See [docs/SETUP.md](docs/SETUP.md) to connect accounts (Supabase, AI provider) and [docs/RELEASE.md](docs/RELEASE.md) for Google Play preparation.
