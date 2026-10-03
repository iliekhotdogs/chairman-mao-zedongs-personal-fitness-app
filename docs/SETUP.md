# Setup guide (Windows, beginner friendly)

You can skip any section until you need it. The app works without accounts. Each step below unlocks one more real feature.

**Quick map:**
- Sections 1–2: test the app.
- Section 4: accounts and phone↔website sync (Supabase).
- Section 5: real AI with your NVIDIA key.

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

Supabase is the online database. Without it, everything stays on one device. With it, you sign in, and your phone and the website share the same data. The free plan is enough to start; paid plans begin at about $25/month once you grow.

Allow about 15 minutes. You need an email address and this project open on the PC.

### Step 1: Create a Supabase account and project

1. Go to https://supabase.com and click **Start your project**. Sign up with GitHub or email.
2. If it asks you to create an **organization**, give it any name (e.g. "FitCoach") and pick the **Free** plan.
3. Click **New project** and fill in:
   - **Name**: `fitcoach`
   - **Database password**: click **Generate a password**, then save it in a password manager. You rarely need it, but you can't see it again later.
   - **Region**: the one closest to where you and your users live.
4. Click **Create new project** and wait 1–2 minutes until the dashboard says the project is ready.

### Step 2: Create the tables (one copy-paste)

1. In VS Code (or Notepad), open `fitness-app/supabase/migrations/0001_init.sql`. Select everything (Ctrl+A) and copy it (Ctrl+C).
2. In the Supabase dashboard, open **SQL Editor** in the left sidebar, then click **New query**.
3. Paste (Ctrl+V) and click **Run** (or press Ctrl+Enter).
4. You should see **Success. No rows returned**. If Supabase warns about "destructive operations", that's because the script contains `drop policy if exists`. It's safe; click **Run this query**.
5. Check it worked:
   - **Table Editor** should list `records`, `push_tokens`, `notification_log` and `ai_usage`.
   - **Storage** should list a bucket called `food-photos`, marked **Private**.

What this created:
- One table that holds all your synced data.
- Privacy rules, so each signed-in user can only see their own rows.
- A private photo folder per user.
- The server-side cap of 3 notifications per day.

Running the script twice is harmless.

### Step 3: Turn on email sign-in

1. Go to **Authentication** → **Sign In / Providers**. **Email** should already be enabled.
2. **For testing only**, turn **Confirm email** off and click **Save**. New accounts can then sign in straight away instead of waiting for a confirmation email. Free projects can only send a few emails per hour, and those emails can land in spam.
3. **Before a public launch**, turn **Confirm email** back on and set up your own email sender under **Authentication** → **Emails** → **SMTP Settings**.

### Step 4: Copy two public values into the app

1. In Supabase, click **Connect** at the top of the project page, or go to **Project Settings** → **API Keys**.
2. Copy:
   - **Project URL**: looks like `https://abcdefghijklm.supabase.co`
   - **Publishable key**: starts with `sb_publishable_`. Older projects show an **anon** key starting with `eyJ`; that works too.
3. In the `fitness-app` folder, make a copy of `.env.example` and name it `.env.local`.
4. Open `.env.local` and fill in the two lines (no quotes, no spaces around `=`):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://abcdefghijklm.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxx
   ```
5. Save the file. `.env.local` is already excluded from git, so it won't be uploaded to GitHub.

> **Never** paste the **secret** key (`sb_secret_…`) or the legacy **service_role** key into `.env.local` or anywhere in the app. Those keys bypass all privacy rules. The publishable key is meant to be public; the privacy rules from Step 2 protect the data.

### Step 5: Restart the app and create your account

1. Stop the dev server (click the terminal and press Ctrl+C), then start it again. Expo only reads `.env.local` at startup.
   ```bash
   npx expo start
   ```
2. Open http://localhost:8081, then go to **Settings** → **Account & sync**. Instead of "This device only", it now shows a sign-in form.
3. Choose **Create account**, enter your email and a password, and submit. With **Confirm email** off, you're signed in immediately.
4. Your existing data on this device uploads automatically, and the card shows "Synced" with a time.
5. Check it in Supabase: **Table Editor** → `records` should now contain rows. Each row belongs to your user ID only.

### Step 6: Sign in on your phone

1. Make sure the dev server is running, then open the app in Expo Go on your phone (see section 2).
2. On the first screen choose **I already have an account**, or go to **Settings** → **Account & sync**, and sign in with the same email and password.
3. Your data downloads within a few seconds. From then on:
   - Changes sync in the background about every 2 minutes.
   - They also sync a few seconds after an edit, and whenever the app comes back to the foreground.
   - Meal photos upload to your private photo folder.

**Quick sync test:** log a food on the phone, then reload the website within about 2 minutes. It appears. Delete it on the website, and it disappears from the phone after the next sync.

### If something goes wrong

| What you see | What to do |
| --- | --- |
| Settings still says "This device only" | `.env.local` isn't being read. Check that it's in the `fitness-app` folder (not the outer folder) and is named exactly `.env.local`, not `.env.local.txt` (in File Explorer, turn on View → File name extensions). Then restart `npx expo start`. |
| "Invalid API key" when signing in | The publishable key was copied incompletely. Copy it again with the copy button. |
| "Email not confirmed" | Turn off **Confirm email** (Step 3), or click the link in the confirmation email. |
| "Email rate limit exceeded" | The free plan sends very few emails. Turn off **Confirm email** for testing, or wait an hour. |
| Sync shows an error mentioning `records` | The SQL from Step 2 didn't run. Run it again and look for a red error message. |
| Phone can't load the app at all | That's an Expo connection problem, not Supabase. Use `npx expo start --tunnel`. |

### Deleting data

- **Settings** → **Privacy** → **Delete my cloud data** removes your rows and photos from Supabase, then clears the device and signs you out.
- To delete a test user completely, go to **Authentication** → **Users**, open the user's row, and choose **Delete user**.

## 5. Use your own NVIDIA API key (simplest way to get real AI)

Without a key, the app uses **built-in answers**: the coach follows fixed rules, and photo estimates come only from your hint. With an NVIDIA key, photos are actually analysed and the coach holds a real conversation.

1. Go to https://build.nvidia.com and sign in (a free NVIDIA account).
2. Open any model page, for example *llama-3.2-90b-vision-instruct*, and click **Get API Key** → **Generate Key**. Copy the key; it starts with `nvapi-`.
3. In the app, go to **Settings** → **AI**, paste the key into **NVIDIA API key**, and click **Save key**. The app immediately tests both models. It shows **Connected**, or tells you what's wrong.

Two separate models are used. You can change either one under **Settings** → **AI** → **Models**.

| Job | Default model | Why |
| --- | --- | --- |
| Food photos | `meta/llama-3.2-90b-vision-instruct` | Understands images |
| Coach chat | `deepseek-ai/deepseek-v4.1-flash` | Fast DeepSeek model; its slow "thinking" mode is switched off for chat |

Good to know:
- **Where the key lives:** only on this device. On Android it's in encrypted secure storage; on the web it's in this browser. It's never synced through Supabase and never included in data exports. Paste it once on each device (phone, browser).
- **Web version:** NVIDIA blocks requests coming straight from web pages. While `npx expo start` is running, the dev server passes them on for you (see `metro.config.js`). A published website would need a server-side relay instead, for example a Supabase Edge Function. The Android app talks to NVIDIA directly.
- **If NVIDIA fails** (wrong key, no internet, out of credits, model not available), you get the built-in answer instead, with a note saying why.
- **"Didn't answer within … s" (timed out):** NVIDIA's free models are queued when busy, and big models can take a minute or more. The app waits up to 90 s for the connection test, 2 min for chat, and 2.5 min for photos. **Test connection** shows how long each model took. If the photo model keeps timing out, choose `meta/llama-3.2-11b-vision-instruct` (smaller and faster). On the web version, the dev server terminal prints a line like `[nvidia] deepseek-ai/deepseek-v4.1-flash -> 200 in 4.2s` for each request (never the key).
- **Safety stays the same:** suggestions still need your **Accept**. Emergencies (chest pain, fainting, trouble breathing) always get fixed safety text and are never sent to the model.
- **Cost:** NVIDIA gives free credits for development; check your balance on build.nvidia.com. Their free API is meant for development and testing. For a public app, plan a paid provider and route requests through your server (section 6).

## 6. Claude through your own server (optional, for a public launch)

This is a separate decision from using Claude to write code. **Read [AI_PROVIDER.md](AI_PROVIDER.md) for costs first.** It needs section 4 done. Steps once you decide:

1. Create an API key at https://console.anthropic.com (requires a payment method; set a monthly spend limit there).
2. In the `fitness-app` folder, log in to the Supabase CLI and deploy the functions. Your project ref is the `abcdefghijklm` part of your Project URL.
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... FDC_API_KEY=<free usda key> AI_DAILY_LIMIT=60
   npx supabase functions deploy ai
   npx supabase functions deploy notify
   ```
   If the app later reports `Invalid JWT` from the function, redeploy with `--no-verify-jwt` added. The functions check the signed-in user themselves.
3. In the app, remove any NVIDIA key, then go to **Settings** → **AI** → **Advanced** → **Server (Claude)**. You must be signed in.

The Anthropic key lives only in Supabase secrets. The app sends the signed-in user's token; the function checks it and applies a per-user daily limit.

## 7. Free USDA key (optional, for live food search)

Get a key at https://fdc.nal.usda.gov/api-key-signup and add `EXPO_PUBLIC_USDA_API_KEY=...` to `.env.local`. Without it, the app uses `DEMO_KEY`, which allows only a few dozen searches per hour. The key is used by manual food search and by the USDA values added to NVIDIA photo estimates.
