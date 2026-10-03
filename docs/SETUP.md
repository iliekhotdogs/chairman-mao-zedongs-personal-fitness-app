# FitCoach account setup (fitdih)

This repository is configured locally for the `fitdih` Supabase project. As of 3 October 2026, `ADMIN_USER_ID` is saved in fitdih for the existing Wesley account; the migration and functions are not deployed, and `OPENROUTER_API_KEY` is intentionally blank at the owner’s request. The saved NVIDIA key must be entered as a secret by the owner because browser storage could not be read safely. Every person creates an email/password account; Supabase Auth assigns a unique user ID. The app stores each account's browser/device cache under that ID and synchronizes only rows owned by that ID. RLS in `0001_init.sql` enforces the boundary in Postgres.

## 1. Database

In the **fitdih** Supabase dashboard, open **SQL Editor** and run these files in order if they have not already been applied:

1. `supabase/migrations/0001_init.sql` (the project's existing `init` migration already contains this schema).
2. `supabase/migrations/20261003000000_shared_accounts_ai.sql`.

The second script grants the signed-in role access to the existing RLS-protected tables, adds shared AI metering, and tightens the food-photo update policy. Review the SQL and back up important data before applying it. Do not run the first script again if it is already applied.

## 2. Authentication

In fitdih, email signup is already enabled, but email confirmation is currently off. Turn on **Confirm email** in **Authentication → Sign In / Providers** before public launch to reduce throwaway accounts. Configure the site URL and redirect URLs for your published app under **Authentication → URL Configuration**. In **Authentication → Users**, confirm the owner account. Its UUID is used for the admin secret. The owner signs in with the same email/password form as everyone else; the admin screen appears only for that UUID after a server check. Do not create a shared admin password or place the UUID in client code.

## 3. Public app configuration

Create `.env.local` from `.env.example` and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for fitdih. These two values are public, bundled into the app. Restart Expo after editing `.env.local`. Build the published web/Android app with the same two public values.

## 4. Private keys and functions

In **Edge Functions → Secrets**, set:

- `OPENROUTER_API_KEY`: the owner's OpenRouter key for coach chat.
- `NVIDIA_API_KEY`: the owner's existing NVIDIA key for meal photos. The default model remains `meta/llama-3.2-90b-vision-instruct`.
- `FDC_API_KEY`: the owner's USDA FoodData Central key, for manual search and optional photo-estimate sourcing. Without it, USDA's restricted `DEMO_KEY` is used.
- `ADMIN_USER_ID`: the owner account's Supabase Auth UUID.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never add any of these secret keys to `.env.local`, Expo public variables, Git, or app settings.

Deploy `supabase/functions/ai/index.ts` as function **ai** and `supabase/functions/admin-stats/index.ts` as function **admin-stats**, with JWT verification enabled on both. The deploy can be done in the Supabase dashboard's Edge Function editor or with the Supabase CLI after linking project `nmovowhobqeaokzdspfp`:

```sh
supabase functions deploy ai --project-ref nmovowhobqeaokzdspfp
supabase functions deploy admin-stats --project-ref nmovowhobqeaokzdspfp
```

Existing notification behavior uses `supabase/functions/notify/index.ts`; deploy it separately if cross-device notification claims are wanted.

The AI gateway validates each user's token and permits only the listed free OpenRouter chat models and the two NVIDIA vision models. It defaults to 5 AI calls per user per UTC day and 40 shared AI calls per UTC day. Set `AI_DAILY_LIMIT` and `AI_GLOBAL_DAILY_LIMIT` as optional function secrets to adjust these caps. OpenRouter free-tier limits can change; keep the global cap below your current account limit. USDA manual search has a separate quota.

## 5. Check the result

1. Create an account in the app. If email confirmation is enabled, click the confirmation email before signing in.
2. Create a second account and confirm that it starts with a blank profile and cannot see the first account's data.
3. Log food and a workout in one account, sign out, then sign back in and confirm they return.
4. In the owner account, open **Settings → Account & sync → Admin stats**. Other accounts should not see that button, and direct requests to `admin-stats` should return 403.
5. Test coach chat with OpenRouter and a meal photo with NVIDIA. If a provider fails, the app uses built-in responses with a visible warning.

If you already used FitCoach before accounts were added, sign in to a new empty account and use **Import earlier data from this device**. This is explicit so older local data cannot silently enter another person's account.
