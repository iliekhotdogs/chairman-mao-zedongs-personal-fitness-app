# Verification

## Automated

Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build:web`. CI runs the same on every push and pull request (`.github/workflows/ci.yml`), plus `deno check supabase/functions/*/index.ts` and `deno test --allow-read supabase/functions`.

Unit tests (`src/lib/__tests__`) cover:

- core fitness rules: targets, workout generation, progression, the reducer's confirmation/approval rules;
- sync: last-write-wins merge, tombstones, the keyset pull cursor across page boundaries (mocked Supabase client), re-reading the settle window so late-committing rows are not skipped (with and without the `server_time` RPC), cursor backwards compatibility, clock-skew clamping;
- stored state: schema validation, migrations, pruning of old tombstones and chat history;
- data export (JSON, food log and weight CSV);
- helpers: selectors, dates across DST, units, notification quiet hours and daily cap;
- the client side of the server AI gateway and the USDA request format;
- the AI provider registry: verified model ids, config repair and validation, including the per-IP limit;
- Edge Function helpers (`src/lib/__tests__/edgeShared.test.ts`): client-IP selection (never the spoofable leftmost `x-forwarded-for`), the fixed push-notification copy (client text is ignored) and the `local_date` window for `notify`;
- error reporting: Sentry stays off without a DSN, and events/breadcrumbs are scrubbed of personal data.

Tests run in the `America/New_York` time zone (`jest.global-setup.js`) so date logic is exercised across DST.

## RLS isolation check

`scripts/rls-check.mjs` (`npm run check:rls`) checks Row Level Security against a live project. It creates two throwaway confirmed users with the admin API, writes a record and a food photo as user A, and asserts that user B:

- reads 0 of A's records and cannot update, delete or forge them (verified afterwards with the service role);
- cannot download, sign, list, overwrite or delete A's photo, or upload into A's folder;
- gets 403 from the `admin-stats` function (`stats` action) and cannot call `admin_stats` or `claim_ai_request` directly;
- cannot read server-only tables, including `restaurant_sources` and `bug_report_counts`, or A's rows in user tables and saved foods; cannot make itself admin or change `app_config`;
- can read the signed-in restaurant catalog but cannot write it or call its replacement RPC; a signed-out client cannot read it;
- cannot call the service-role RPCs `user_storage_objects` (list A's photos) or `admin_revoke_sessions`;

It also checks, as user A, that:

- uploads follow the app's path pattern: `<uid>/<id>.jpg` and `<uid>/progress/<id>.jpg` work, while a nested folder, a folder below `progress/` and a non-image extension are refused;
- push tokens are written only through `register_push_token`: a direct `insert` or `update` on `push_tokens` is refused, while reading and deleting A's own token (sign-out) still work;

and that a signed-out client reads no records or photos. Both users and the photo are deleted at the end, also on failure.

```sh
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
SUPABASE_SECRET_KEY=sb_secret_... \
npm run check:rls -- --yes
```

Run it against a **staging** project with all migrations applied (including the restaurant catalog and saved foods migrations) and `admin-stats` deployed. It needs the secret (service-role) key, so it is not part of CI; never commit the key. Exit code 0 means every check passed, 1 that one failed, 2 a setup problem.

## Manual checks (before a release)

- Accounts: two separate accounts never see each other's records or photos.
- AI: a live coach chat and meal photo through the server AI gateway, with owner credentials, after deploying the Edge Functions (see [SETUP.md](SETUP.md)).
- Sync: log food on one device and see it on another within ~2 minutes; delete it and it disappears.
- Export: JSON and CSV export download on web and open the share sheet on Android.
- Web: after `npm run build:web`, serve `dist/` and refresh on a nested route.

- Push: with a release or development build and FCM credentials (docs/RELEASE.md), a check-in raised on the website arrives on the signed-in phone; after signing out on the phone, it no longer does.
- Error reporting (if `EXPO_PUBLIC_SENTRY_DSN` is set): a test error appears in Sentry without e-mail, user or request data.

Health syncing is still simulated.
