# Setup guide (Windows, beginner friendly)

You can skip any section until you need it. The app works without accounts. Each step below unlocks one more real feature.

## 0. Already done on this computer

- Node.js 24 LTS + npm 11 and Git 2.55 were installed with `winget`.
- The project lives in `fitness-app/`. Run `npm install` once if `node_modules` is missing.
- Git history exists, and the project is connected to GitHub (`origin`).

## 1. Test in the browser (no accounts)

```bash
npm run web
```

Open http://localhost:8081 in Chrome or Edge. Voice logging uses the browser's speech recognition, which works in Chrome and Edge.

## 2. Test on your Android phone with Expo Go (no accounts)

1. Install **Expo Go** from Google Play.
2. Run `npx expo start` in the `fitness-app` folder.
3. Scan the QR code with Expo Go. The phone and PC must be on the same Wi-Fi. If they can't connect, run `npx expo start --tunnel`.

What works in Expo Go: everything except real Health Connect, remote push notifications, and in-app speech recognition. For speech, use the microphone key on the Android keyboard in the "Log by voice or text" box.

**When you need more:** an *Expo development build* is required for Health Connect, push notifications, and a native speech module. Build it in the cloud (no Android Studio needed):

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android
```

**Android Studio** is only needed if you want an Android *emulator* on Windows, or to build locally with `npx expo run:android`. A physical phone plus EAS cloud builds avoids it.

## 3. GitHub (code history and collaboration)

The repo is already connected. Daily workflow:

```bash
git add -A
git commit -m "Describe the change"
git push
```

Collaborators clone with `git clone <repo url>`, then run `npm install`.

## 4. Supabase: accounts, sync between phone and website, photo storage

Free tier is enough to start (paid plans from about $25/month when you grow).

1. Create a project at https://supabase.com. Pick a region near your users and save the database password in a password manager.
2. **SQL Editor → New query**: paste all of `supabase/migrations/0001_init.sql` and run it. This creates the tables, the private photo bucket, the 3-per-day notification cap, and the privacy rules.
3. **Settings → API**: copy the *Project URL* and the *publishable (anon) key* into a new file `fitness-app/.env.local`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   ```
   These two values are designed to be public. **Never** put the `service_role` key in the app.
4. **Authentication → Providers**: email is on by default. For testing you can turn off "Confirm email".
5. Restart `npm run web`. In **Settings → Account & sync** you can now create an account. Sign in with the same account on your phone and both sync.

## 5. AI provider (real photo recognition and chat)

This is a separate decision from using Claude to write code. **Read [AI_PROVIDER.md](AI_PROVIDER.md) for costs first.** Steps once you decide:

1. Create an API key at https://console.anthropic.com (requires a payment method; set a monthly spend limit there).
2. Install the Supabase CLI and deploy the functions:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... FDC_API_KEY=<free usda key> AI_DAILY_LIMIT=60
   npx supabase functions deploy ai
   npx supabase functions deploy notify
   ```
3. In the app: **Settings → Coach → AI engine → Server AI**.

The API key lives only in Supabase secrets. The app sends the signed-in user's token, and the function checks it and applies a per-user daily limit.

## 6. Free USDA key (optional, for live food search)

Get a key at https://fdc.nal.usda.gov/api-key-signup and add `EXPO_PUBLIC_USDA_API_KEY=...` to `.env.local`. Without it the app uses `DEMO_KEY`, which is limited to a few dozen searches per hour.
