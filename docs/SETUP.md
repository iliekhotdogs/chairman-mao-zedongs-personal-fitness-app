# FitCoach account setup (fitdih)

This repository is configured locally for the `fitdih` Supabase project (ref `nmovowhobqeaokzdspfp`). Every person has an email/password account with a unique Supabase Auth user ID. The app caches each account's data under that ID and syncs only rows owned by it; Row Level Security in `0001_init.sql` enforces the boundary in Postgres.

Accounts are **invite-only**: the admin creates invite codes, and the `redeem-invite` Edge Function creates the account. Public signup in Supabase Auth is switched off.

## 1. Database

Apply the migrations in order (Supabase **SQL Editor**, or `supabase db push` after `supabase link`). Skip any that are already applied:

1. `supabase/migrations/0001_init.sql` (already applied to fitdih as `init`).
2. `supabase/migrations/20261003000000_shared_accounts_ai.sql` (already applied to fitdih).
3. `supabase/migrations/20261013000000_roles_invites_ai_config.sql` (new). It adds:
   - `profiles` (role `admin`/`user`, `disabled`), filled for existing users and by a trigger for new ones. Users can read only their own row.
   - `invites`, `signup_attempts` (per-IP limit for signups), `app_config` (admin's AI choice, limits, kill switch). Service role only.
   - RPCs: `claim_invite`, `release_invite`, `claim_signup_attempt`, `release_ai_request`, `admin_stats`, `admin_list_users`, `admin_list_invites`.
   - Data caps: at most **50,000 `records` rows per account** (new rows only; edits always work) and **2,000 food photos per account** (storage insert policy). Change the numbers in `records_row_cap()` and `food_photo_count()`/the "food-photos: owner write" policy if you need more.
4. `supabase/migrations/20261014000000_progress_photos.sql` (progress photos, if present in your branch).
5. `supabase/migrations/20261014000100_ai_ip_limit.sql`: `app_config.per_ip_daily_limit` (default 100), the `ai_ip_usage` table and the `claim_ai_ip_request` / `release_ai_ip_request` RPCs (service role only).
6. `supabase/migrations/20261014000200_records_synced_at_clock.sql`: `records.synced_at` is stamped with `clock_timestamp()`, and a `server_time()` RPC (signed-in users) lets sync re-read rows that committed late. App builds from before this keep working; new builds without this migration fall back to re-reading a fixed 15 s window.
7. `supabase/migrations/20261014000300_push_token_registration.sql`: the `register_push_token` RPC (signed-in users), which moves a device's push token to the account signed in on it and keeps at most 10 devices per account.
8. `supabase/migrations/20261015000000_security_hardening.sql`: security hardening. Apply it **before** redeploying the Edge Functions (step 5); the updated functions depend on it.

Migrations 5 to 7 only add columns, tables and functions, so they can be applied before or after the app update. Apply 5 **before** redeploying `ai` and `admin-stats`: the new functions read and write `per_ip_daily_limit`. Apply 8 before deploying any function from this version.

Back up important data before applying a migration.

## 2. Authentication (Supabase dashboard)

1. **Authentication → Sign In / Providers → Email**: turn **Allow new users to sign up** OFF. The `redeem-invite` function still creates accounts, because it uses the service role. Turn **Confirm email** ON (invite-created accounts are confirmed at creation; the AI gateway refuses unconfirmed accounts).
2. **Authentication → URL Configuration**: set **Site URL** to the production domain (for example `https://fitcoach.vercel.app`) and list only these exact **Redirect URLs**:
   - `https://<your-production-domain>/**`
   - `http://localhost:8081/**` (local web development)
   - `fitcoach://**` (the Android app; reset links requested in the app return to it)

   Don't add a wildcard for preview deployments (such as `https://*-<team>.vercel.app/**`): anyone can create a Vercel preview URL that matches it, and a matching redirect would receive a user's sign-in code. Test auth flows on production or localhost instead. Password-reset links return to `<origin>/reset-password` (web) or `fitcoach://reset-password` (app). Sign-in uses the PKCE flow, so a reset link only works in the browser or app that asked for it.
3. **Authentication → Providers → Email** (or **Sign In / Providers → Email**): turn **Secure password change** ON, so changing the password of a signed-in session needs a recent sign-in. Also keep **Secure email change** ON.
4. Password reset uses Supabase's built-in email. For real users, configure a custom SMTP sender under **Authentication → Emails → SMTP Settings**; the default sender is heavily rate limited.

## 3. Public app configuration

Create `.env.local` from `.env.example` and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for fitdih. These values are public and bundled into the app. Restart Expo after editing. Use the same values in Vercel's environment variables and in EAS builds.

Optional: `EXPO_PUBLIC_SENTRY_DSN` turns on crash and error reporting through Sentry (see [RELEASE.md](RELEASE.md#error-reporting-sentry)). Leave it empty to send nothing. A DSN is public by design; the Sentry auth token for source maps is not, and goes only in EAS/Vercel secrets as `SENTRY_AUTH_TOKEN`. After changing any `EXPO_PUBLIC_*` value locally, restart with `npx expo start --clear` (or `npx expo export --clear`), because Metro caches the inlined values.

## 4. Secrets

In **Edge Functions → Secrets** (or `supabase secrets set NAME=value --project-ref nmovowhobqeaokzdspfp`):

| Secret | Needed | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | if provider is Groq (the default) | Groq key |
| `GEMINI_API_KEY` | if provider is Gemini | Google AI Studio key (needs billing/credits) |
| `NVIDIA_API_KEY` | if provider is NVIDIA | NVIDIA API catalog key (`nvapi-…`) |
| `FDC_API_KEY` | recommended | USDA FoodData Central key; otherwise the restricted `DEMO_KEY` |
| `ADMIN_USER_ID` | recommended | Bootstrap admin: this auth user UUID is always admin |
| `IP_HASH_SECRET` | optional | HMAC key used to hash client IPs for the per-IP limits. Falls back to the service-role key when unset; set it so the hashes don't depend on that key. |
| `ALLOWED_ORIGINS` | for launch | Comma-separated web origins allowed by CORS, e.g. `https://fitcoach.vercel.app,http://localhost:8081`. Unset means `*`. |
| `EXPO_ACCESS_TOKEN` | only with EAS "enhanced push security" | Expo access token the `notify` function sends to Expo's push API. Not needed otherwise. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. Never put any secret in `.env.local`, Expo public variables, Git or app settings. The old `OPENROUTER_API_KEY`, `AI_DAILY_LIMIT` and `AI_GLOBAL_DAILY_LIMIT` secrets are no longer read and can be deleted; limits now live in `app_config`.

## 5. Deploy order

1. Apply the new migrations (step 1), in order. The deployed functions keep working against them.
2. Set the secrets (step 4).
3. Deploy the functions. `_shared/` is bundled automatically.

   ```sh
   supabase functions deploy ai --project-ref nmovowhobqeaokzdspfp
   supabase functions deploy admin-stats --project-ref nmovowhobqeaokzdspfp
   supabase functions deploy delete-account --project-ref nmovowhobqeaokzdspfp
   supabase functions deploy notify --project-ref nmovowhobqeaokzdspfp
   # No account exists yet when someone signs up, so this one runs without JWT verification:
   supabase functions deploy redeem-invite --no-verify-jwt --project-ref nmovowhobqeaokzdspfp
   ```

4. Make yourself admin (step 6) and create a test invite.
5. Deploy the web app (Vercel). Only then turn off public signups (step 2.1), so you are never without a way to create accounts.

## 6. Admin accounts

Admin = a `profiles` row with `role = 'admin'`, or the user whose UUID is in `ADMIN_USER_ID` (bootstrap). Roles are never read from `user_metadata`, which users can edit.

To make yourself admin, find your UUID in **Authentication → Users**, then either set the `ADMIN_USER_ID` secret to it, or run in the SQL Editor:

```sql
update public.profiles set role = 'admin' where user_id = '<your-uuid>';
```

The admin signs in with the normal form. **Settings → Account & sync → Admin** appears after a server check and opens the admin screen: app statistics, AI configuration (provider, chat and photo model, daily limits, AI on/off), invites (create with optional expiry and note, revoke unused) and users (disable/enable, reset today's AI quota). Disabling a user also bans their sign-in and ends their active sessions. The `ADMIN_USER_ID` owner can't be disabled, and only that owner can disable other admins. The bootstrap admin cannot delete its own account from the app.

## 7. Check the result

1. As admin, create an invite. Sign out, choose **I have an invite code**, and create an account with it. A wrong code, a reused code and an expired code are rejected.
2. Create a second account and confirm it starts blank and cannot see the first account's data or photos.
3. Log food and a workout, sign out, sign back in and confirm they return.
4. A non-admin account has no Admin button, and direct requests to `admin-stats` return 403.
5. Switch the provider in the admin screen; the next coach chat and meal photo use it (Settings → Coach AI shows the new model). Switch AI off and confirm chat falls back to a built-in answer with the notice.
6. Optional, against a **staging** project only: `npm run check:rls -- --yes` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` set runs the automated isolation checks (see [TESTING.md](TESTING.md#rls-isolation-check)).
7. **Forgot password?** sends a link that returns to `/reset-password`, where the new password is set. Open it in the same browser you requested it from.
8. **Settings → Delete account** removes the login, synced rows and photos.

If you used FitCoach before accounts existed, sign in to a new empty account and use **Import earlier data from this device**.
