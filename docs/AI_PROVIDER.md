# AI providers

Signed-in accounts use a Supabase Edge Function (`supabase/functions/ai/index.ts`). The server checks the Supabase user token and shared quota before calling a model. The owner's API keys are Supabase function secrets, never sent to users' devices.

- **Coach chat:** OpenRouter. Users can choose among the free text models listed in `src/lib/ai/openrouterModels.ts`. The server allowlist matches the client list. If a free model is unavailable or the daily quota is reached, the app shows a built-in coaching fallback.
- **Meal photo analysis:** NVIDIA using the owner's existing key. The original default remains `meta/llama-3.2-90b-vision-instruct`; `meta/llama-3.2-11b-vision-instruct` is an optional smaller model. Images are reduced before upload, and the server checks MIME type and size. Estimates can be checked against USDA nutrition records when a key is configured.
- **Without Supabase configuration:** Built-in rule-based replies and hint-based meal estimates. Photos are not analyzed in this mode.

The earlier on-device NVIDIA/Gemini clients and development proxies remain in the repository for compatibility with saved settings and tests, but the account build routes AI through Supabase. Coach proposals still require explicit acceptance. See [SETUP.md](SETUP.md) for deployment and secrets.
