# FitCoach: notes for coding agents

FitCoach is a fitness app (food logging with photo estimates, workouts, adaptive nutrition targets, an AI coach) built with **Expo SDK 57 + Expo Router + React Native + react-native-web**, TypeScript throughout. One codebase ships as a website (deployed to Vercel) and an Android app (EAS). Accounts, sync and AI go through **Supabase** (Postgres with RLS, Storage, Edge Functions).

## Commands

```bash
npm ci                 # install (CI uses this; lockfile is authoritative)
npm run web            # dev server on http://localhost:8081
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint (ESLint flat config, eslint-config-expo)
npm test               # jest (jest-expo preset), tests in src/**/__tests__/*.test.ts
npm run build:web      # static web export to dist/ (what Vercel serves)
npx expo install <pkg> # add dependencies; resolves SDK-compatible versions
npm run check:rls -- --yes  # RLS isolation check against a STAGING project (needs SUPABASE_URL,
                            # SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY); never in CI
```

Run typecheck, lint and tests before calling a task done. CI (`.github/workflows/ci.yml`) runs all of them plus the web build on every push and PR, and type-checks `supabase/functions` with Deno.

## Layout

```
src/app/              routes (Expo Router). (main)/ is the signed-in shell; admin.tsx, onboarding.tsx
src/components/       UI kit (ui.tsx), charts, coaching cards, food editors, settings cards
src/hooks/            useAiEngine, useLayout, useSpeech
src/constants/        theme tokens
src/lib/              business logic, no UI:
  state.ts            AppState shape, STATE_VERSION, SYNCED_COLLECTIONS / SYNCED_SINGLETONS
  reducer.ts          the only place state changes; checkAction enforces confirmation/approval rules
  schema.ts           zod validation for stored state and pulled rows
  schemaMigrations.ts stored-state migrations (keyed by version), sanitizeState, pruneState
  sync/               Supabase client, last-write-wins merge, push/pull
  ai/                 client side of the AI gateway (calls the `ai` Edge Function)
  coaching/ nutrition/ workouts/ activity/ notifications/  domain rules
  export.ts           JSON/CSV export builders; exportFile.ts saves them (web download / native share)
  log.ts              logger; use it instead of empty catch blocks
  errorReporting.ts   optional Sentry (EXPO_PUBLIC_SENTRY_DSN); scrubs PII; feeds log.error/warn
src/store/AppStore.tsx  React provider: hydration, persistence, coaching engine scheduler, sync loop
supabase/migrations/  SQL schema with RLS; apply in filename order (see docs/SETUP.md)
scripts/              rls-check.mjs (live RLS isolation check)
supabase/functions/   Edge Functions (Deno): ai, admin-stats, notify, redeem-invite, delete-account; shared code in _shared/
docs/                 SETUP, AI_PROVIDER, WEARABLES, TESTING, RELEASE
```

## How state and sync work

- All app data is one `AppState` object, persisted to AsyncStorage (`localStorage` on web) per account (`fitapp:state:v1:user:<id>`). On load it is migrated (`MIGRATIONS` in `schemaMigrations.ts`) and validated. Invalid records are dropped and logged, not fatal. Old synced tombstones and chat beyond the last 500 messages are pruned locally at startup.
- To change the stored shape: bump `STATE_VERSION` in `state.ts` and add a migration step from the previous version.
- Every synced record has `id`, `updatedAt` and an optional `deleted` flag. Deletes are tombstones. Lists live in `SYNCED_COLLECTIONS`; whole documents (profile, targets, plan, settings) in `SYNCED_SINGLETONS`. Add new synced data there, and in the `records_collection_check` constraint if it is a new collection.
- Sync (`src/lib/sync/sync.ts`) pushes rows edited since the last push, then pulls rows from the `records` table with a keyset cursor on `(synced_at, collection, id)`. `synced_at` is stamped by the server (`clock_timestamp()`). Because a row becomes visible only when its transaction commits, each pull first reads the database clock (`server_time()` RPC) and the next pull re-reads rows stamped within 15 s of it (`settledAt` in the cursor), so late commits are never skipped. Conflicts resolve by last write on `updatedAt`, so re-reads are harmless. Edit times more than 5 minutes in the future are clamped (clock skew).
- The store syncs on sign-in, every 2 minutes, on app foreground, and 5 s after any change to synced data (detected with `contentSignature`).
- Business rules live in `checkAction` (reducer.ts). Screens dispatch through `act()`, which checks once and throws `RuleViolation` with a user-facing message.

## Notifications

Coaching notifications are capped at 3 per user per day by the `notify` function (`claim_notification_slot`). On Android/iOS builds the app registers an Expo push token once permission is granted and the user is signed in (`src/lib/notifications/push.ts`, `register_push_token` RPC); `notify` pushes to the user's other devices and deletes dead tokens. Sign out through `signOut()` in `src/lib/sync/supabase.ts`, which removes the device token first. Web uses local browser notifications only. Push credentials: docs/RELEASE.md.

## Accounts

Signup is invite-only: the admin creates invite codes and the `redeem-invite` Edge Function creates the account. Roles live in the `profiles` table (`admin` / `user`), never in user metadata. `delete-account` removes the auth user, and the schema cascades to their rows. Setup is in `docs/SETUP.md`.

## How AI works

The client never holds a provider key. Signed-in users call the Supabase `ai` Edge Function (the server AI gateway). The admin picks the provider and model globally (`app_config`); the function holds the secret keys and meters per-user quotas. Without Supabase, the app uses built-in simulated answers. AI output is always a *proposal*: nothing changes plans, targets or the food log until the user accepts. Quotas: per user, per network (IP, stored hashed) and global per day, all in `app_config`; failed provider calls are refunded. Provider details and the verified model ids are in `docs/AI_PROVIDER.md`.

## Conventions

- Weights are stored in kg, heights in cm; convert only for display (`src/lib/units.ts`). Dates are local `YYYY-MM-DD` strings (`src/lib/dates.ts`); timestamps are ISO UTC.
- Keep logic in `src/lib` as pure functions with tests; keep screens thin.
- Don't swallow errors: use `log.warn` / `log.error` from `src/lib/log.ts`.
- Secrets never go in `EXPO_PUBLIC_*` variables or client code. Only the Supabase URL, publishable key, an optional USDA key and an optional Sentry DSN are public.
- Never send health data or personal details to third parties other than the configured AI provider; error reports are scrubbed in `errorReporting.ts`.
- Tests run in `America/New_York` (set in `jest.global-setup.js`) so date logic is exercised across DST.

## Expo specifics

Expo ships breaking changes every SDK release, so don't rely on memory for Expo APIs. Check the versioned docs for SDK 57 (`https://docs.expo.dev/versions/v57.0.0/`) or `https://docs.expo.dev/llms.txt`.

- Routes live only in `src/app/`; every file there is a screen. Import `Link`, `router`, `useLocalSearchParams` from `expo-router`.
- `ios/` and `android/` are generated (Continuous Native Generation). Configure native behaviour in `app.json` and config plugins, never by hand.
- Native modules need a development build (`npx expo run:android` or `eas build --profile development`); Expo Go only includes bundled modules.
- Build and submit with EAS: `npx eas-cli@latest build|submit|update`.
