# AI providers

Signed-in accounts use a Supabase Edge Function (`supabase/functions/ai/index.ts`). The server checks the Supabase user token and shared quota before calling a model. The owner's API keys are Supabase function secrets, never sent to users' devices.

- **Coach chat:** Groq. Users can choose among the models listed in `src/lib/ai/groqModels.ts` (default `openai/gpt-oss-120b`). The server allowlist matches the client list and maps unknown ids to the default. If Groq is rate-limited or the daily quota is reached, the app shows a built-in coaching fallback.
- **Meal photo analysis:** Groq `qwen/qwen3.8-27b`, the only Groq model on this account that accepts images. Images are reduced before upload, and the server checks MIME type and size. Estimates can be checked against USDA nutrition records when a key is configured. The free tier allows about 1000 output tokens per minute for this model, so the request caps replies at 900 tokens.
- **Without Supabase configuration:** Built-in rule-based replies and hint-based meal estimates. Photos are not analyzed in this mode.

The earlier on-device NVIDIA/Gemini clients and development proxies remain in the repository for compatibility with saved settings and tests, but the account build routes AI through Supabase. Coach proposals still require explicit acceptance. See [SETUP.md](SETUP.md) for deployment and secrets.
