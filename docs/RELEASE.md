# Google Play release checklist (do not publish automatically)

## Before building

- [ ] Final app name, icon (512×512) and adaptive icon. "FitCoach" is a placeholder, so check trademark availability.
- [ ] Unique Android package (currently `com.fitcoach.app` in `app.json`). **It cannot change after the first upload.**
- [ ] Supabase project in production mode, email confirmation on, SMTP configured.
- [ ] Decide the AI provider and model, set the spend limit, and deploy the `ai` and `notify` functions (docs/SETUP.md §5).
- [ ] Replace simulated Health Connect with the real integration (docs/WEARABLES.md), or hide that card for v1.
- [ ] Push notifications: configure FCM credentials in EAS, register Expo push tokens into `push_tokens`.
- [ ] Privacy policy URL (required). It must cover health and fitness data, photos, AI processing by Anthropic, account deletion, and data retention.
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
