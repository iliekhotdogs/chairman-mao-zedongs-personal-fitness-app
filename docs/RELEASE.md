# Google Play release checklist (do not publish automatically)

## Before building

- [ ] Final app name, icon (512×512) and adaptive icon. "FitCoach" is a placeholder, so check trademark availability.
- [ ] Unique Android package (currently `com.fitcoach.app` in `app.json`). **It cannot change after the first upload.**
- [ ] Supabase project in production mode, email confirmation on, SMTP configured.
- [ ] Set the shared `GROQ_API_KEY` secret, choose daily limits (see docs/AI_PROVIDER.md) and deploy the `ai` and `admin-stats` functions (docs/SETUP.md).
- [ ] Replace simulated Health Connect with the real integration (docs/WEARABLES.md), or hide that card for v1.
- [ ] Push notifications: link the app to EAS and add FCM V1 credentials (see [Push notifications](#push-notifications) below). Token registration and sending are built in.
- [ ] Optional: crash reporting with Sentry (see [Error reporting](#error-reporting-sentry) below).
- [ ] Privacy policy URL (required). It must cover health and fitness data, photos, AI processing by Groq (or the provider the admin selects), account deletion, and data retention.
- [ ] In-app account deletion exists (Settings → Delete my cloud data). Play also requires a **web link** for deletion requests.
- [ ] Medical disclaimer reviewed (the coach avoids diagnosis; check wording with a professional).
- [ ] The business model is decided before adding any paywall (none exist now).

## Build and test

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android     # installable APK for testers
npx eas-cli@latest build --profile production --platform android  # .aab for Play
```

- [ ] Test the APK on at least 2 physical Android phones (different Android versions and screen sizes).
- [ ] Re-run `docs/TESTING.md` manual checks on the phone and on Windows Chrome/Edge.
- [ ] Verify cross-device sync: log food on the phone and see it on the website within ~2 minutes. Delete it on the web and it disappears on the phone.
- [ ] Verify the notification cap: force 4+ eligible check-ins and confirm only 3 arrive across phone and web.

## Play Console (manual steps, done by you)

1. Create a developer account ($25 one-time) at https://play.google.com/console.
2. Create the app, then complete **App content**: privacy policy, data safety form (health info, photos, email; encrypted in transit; deletion available), target audience (adults; not for children), health apps declaration, and **Health Connect permissions declaration** if used.
3. Upload the `.aab` to **Internal testing** first (`eas submit` defaults to the internal track as a *draft*), and add testers.
4. New personal developer accounts must run a **closed test with at least 12 testers for 14 days** before production access. Check the current Play policy.
5. Promote to production only after closed testing feedback.

## Push notifications

The app registers an Expo push token on Android/iOS builds once the user has allowed notifications and is signed in (`src/lib/notifications/push.ts`), stores it through the `register_push_token` RPC, and removes it on sign-out. When the coaching engine shows a check-in, the `notify` function claims one of the 3 daily slots and pushes the same message to the user's *other* devices (the device that triggered it shows it locally). Tokens Expo reports as `DeviceNotRegistered` are deleted. Web does not register (browser notifications stay local). Expo Go on Android cannot receive remote push; use a development or release build.

One-time setup (owner):

1. Link the project to EAS: `npx eas-cli@latest init`. This writes `extra.eas.projectId` (and `owner`) into `app.json`; commit it. Without a project id the app skips push registration and logs a warning.
2. Firebase: create a project at <https://console.firebase.google.com>, add an Android app with package `com.fitcoach.app`, download `google-services.json` to the repository root (it holds only public identifiers and can be committed) and add to `app.json`:

   ```json
   { "expo": { "android": { "googleServicesFile": "./google-services.json" } } }
   ```

3. FCM V1 key for EAS: Firebase Console → Project settings → Service accounts → **Generate new private key**. Upload it with `npx eas-cli@latest credentials` → Android → production → Google Service Account → *Manage your FCM V1 service account key*, or on expo.dev → project → Credentials → Android → **FCM V1 service account key**. Do not commit this JSON (add it to `.gitignore`).
4. iOS (only if you ship iOS): `eas credentials` creates the APNs key for you during `eas build --platform ios`.
5. Optional: if you turn on **Enhanced push security** in the EAS dashboard, create an access token on expo.dev and set it as the `EXPO_ACCESS_TOKEN` Edge Function secret.
6. Apply `20261014000300_push_token_registration.sql`, deploy `notify`, then build (`eas build --profile preview --platform android`).
7. Check: sign in on the phone, allow notifications, then sign in on the website with the same account. A coaching check-in raised on the website arrives on the phone (subject to the 3-per-day cap and quiet hours). `select platform, created_at from push_tokens;` in the SQL editor shows the registered device.

Expo docs: <https://docs.expo.dev/push-notifications/fcm-credentials/>, <https://docs.expo.dev/push-notifications/sending-notifications/>.

Not implemented yet: push *receipts* (the second, delayed delivery check). Dead tokens are cleaned up from the immediate tickets only.

## Error reporting (Sentry)

`@sentry/react-native` (~7.11.0, the version Expo SDK 57 pins) is installed. Reporting is off unless `EXPO_PUBLIC_SENTRY_DSN` is set at build time. When on, `log.error` calls and render crashes become Sentry events and `log.warn` lines become breadcrumbs. It works on web too (the SDK uses its browser integrations there). Nothing personal is sent: `sendDefaultPii` is off; the user, request, device name and server name are removed; e-mail addresses are redacted; console and touch breadcrumbs are dropped; network breadcrumbs keep only method, status and the URL without its query string; tracing, replays and screenshots are off (`src/lib/errorReporting.ts`).

To turn it on:

1. Create a Sentry project (platform React Native) and copy its DSN.
2. Set `EXPO_PUBLIC_SENTRY_DSN` in Vercel (web), in EAS (`eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility plaintext`) and optionally in `.env.local`.
3. For readable native stack traces, add the config plugin to `app.json` `plugins` (it uploads source maps during EAS builds) and set `SENTRY_AUTH_TOKEN` as a **secret** EAS environment variable:

   ```json
   ["@sentry/react-native/expo", { "url": "https://sentry.io/", "organization": "<your-org>", "project": "<your-project>" }]
   ```

   For web source maps and Debug IDs, also switch `metro.config.js` to `const { getSentryExpoConfig } = require('@sentry/react-native/metro'); module.exports = getSentryExpoConfig(__dirname);`. Without these two steps errors are still reported, with minified stacks. With the plugin but no `SENTRY_AUTH_TOKEN`, the native build's upload step fails; set `SENTRY_DISABLE_AUTO_UPLOAD=true` in the build environment to skip uploads.
4. Rebuild the app (the native module needs a new build; a JS-only `eas update` is not enough the first time).
