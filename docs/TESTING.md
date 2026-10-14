# Verification

## Automated

Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build:web`. CI runs the same on every push and pull request (`.github/workflows/ci.yml`), plus a Deno type-check of `supabase/functions`.

Unit tests (`src/lib/__tests__`) cover:

- core fitness rules: targets, workout generation, progression, the reducer's confirmation/approval rules;
- sync: last-write-wins merge, tombstones, the keyset pull cursor across page boundaries (mocked Supabase client), cursor backwards compatibility, clock-skew clamping;
- stored state: schema validation, migrations, pruning of old tombstones and chat history;
- data export (JSON, food log and weight CSV);
- helpers: selectors, dates across DST, units, notification quiet hours and daily cap;
- the client side of the server AI gateway and the USDA request format.

Tests run in the `America/New_York` time zone (`jest.global-setup.js`) so date logic is exercised across DST.

## Manual checks (before a release)

- Accounts: two separate accounts never see each other's records or photos.
- AI: a live coach chat and meal photo through the server AI gateway, with owner credentials, after deploying the Edge Functions (see [SETUP.md](SETUP.md)).
- Sync: log food on one device and see it on another within ~2 minutes; delete it and it disappears.
- Export: JSON and CSV export download on web and open the share sheet on Android.
- Web: after `npm run build:web`, serve `dist/` and refresh on a nested route.

Health syncing and push delivery are still simulated or limited to local notification behaviour.
