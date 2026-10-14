# Verification

## Automated

Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build:web`. CI runs the same on every push and pull request (`.github/workflows/ci.yml`), plus a Deno type-check of `supabase/functions`.

Unit tests (`src/lib/__tests__`) cover:

- core fitness rules: targets, workout generation, progression, the reducer's confirmation/approval rules;
- sync: last-write-wins merge, tombstones, the keyset pull cursor across page boundaries (mocked Supabase client), re-reading the settle window so late-committing rows are not skipped (with and without the `server_time` RPC), cursor backwards compatibility, clock-skew clamping;
- stored state: schema validation, migrations, pruning of old tombstones and chat history;
- data export (JSON, food log and weight CSV);
- helpers: selectors, dates across DST, units, notification quiet hours and daily cap;
- the client side of the server AI gateway and the USDA request format;
- the AI provider registry: verified model ids, config repair and validation, including the per-IP limit;
- error reporting: Sentry stays off without a DSN, and events/breadcrumbs are scrubbed of personal data.

Tests run in the `America/New_York` time zone (`jest.global-setup.js`) so date logic is exercised across DST.

## RLS isolation check

`scripts/rls-check.mjs` (`npm run check:rls`) checks Row Level Security against a live project. It creates two throwaway confirmed users with the admin API, writes a record and a food photo as user A, and asserts that user B:

- reads 0 of A's records and cannot update, delete or forge them (verified afterwards with the service role);
- cannot download, sign, list, overwrite or delete A's photo, or upload into A's folder;
- gets 403 from the `admin-stats` function (`stats` action) and cannot call `admin_stats` or `claim_ai_request` directly;
- cannot read `app_config`, `invites`, `ai_global_usage`, `signup_attempts`, `ai_ip_usage`, `food_search_global_usage`, or A's rows in `profiles`, `push_tokens`, `notification_log`, `ai_usage`, `food_search_usage`; cannot make itself admin or change `app_config`;

and that a signed-out client reads no records or photos. Both users and the photo are deleted at the end, also on failure.

```sh
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
SUPABASE_SECRET_KEY=sb_secret_... \
npm run check:rls -- --yes
```

Run it against a **staging** project with all migrations applied and `admin-stats` deployed. It needs the secret (service-role) key, so it is not part of CI; never commit the key. Exit code 0 means every check passed, 1 that one failed, 2 a setup problem.

## Manual checks (before a release)

- Accounts: two separate accounts never see each other's records or photos.
- AI: a live coach chat and meal photo through the server AI gateway, with owner credentials, after deploying the Edge Functions (see [SETUP.md](SETUP.md)).
- Sync: log food on one device and see it on another within ~2 minutes; delete it and it disappears.
- Export: JSON and CSV export download on web and open the share sheet on Android.
- Web: after `npm run build:web`, serve `dist/` and refresh on a nested route.

- Push: with a release or development build and FCM credentials (docs/RELEASE.md), a check-in raised on the website arrives on the signed-in phone; after signing out on the phone, it no longer does.
- Error reporting (if `EXPO_PUBLIC_SENTRY_DSN` is set): a test error appears in Sentry without e-mail, user or request data.

Health syncing is still simulated.
