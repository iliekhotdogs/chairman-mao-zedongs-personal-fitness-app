# AI providers

Signed-in accounts reach AI only through the Supabase Edge Function `supabase/functions/ai/index.ts`. The function checks the user's token, that the email is confirmed and the account is not disabled, and the daily quota, then calls the provider. Provider keys are Supabase function secrets and never reach a device.

## Who picks the model

The **admin** picks one provider and its models for everyone, in **Settings → Account & sync → Admin → AI configuration**. Users do not choose. Settings → Coach AI shows them a read-only line such as "Groq · GPT-OSS 120B" (from the function's `info` action).

The choice is stored in the single-row `app_config` table (service role only): `provider`, `chat_model`, `vision_model`, `per_user_daily_limit`, `global_daily_limit`, `ai_enabled`.

## Provider registry

`supabase/functions/_shared/providers.ts` is the only list of providers and models. Every provider is called through its OpenAI-compatible chat-completions endpoint.

| Provider | Secret | Endpoint | Chat models | Photo models |
| --- | --- | --- | --- | --- |
| Groq | `GROQ_API_KEY` | `api.groq.com/openai/v1/chat/completions` | `openai/gpt-oss-120b` (default), `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` | `qwen/qwen3.8-27b` |
| Gemini | `GEMINI_API_KEY` | `generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-3.8-flash` (default), `gemini-3.5-flash-lite`, `gemini-2.5-pro` | same as chat |
| NVIDIA | `NVIDIA_API_KEY` | `integrate.api.nvidia.com/v1/chat/completions` | `moonshotai/kimi-k2-instruct` (default), `deepseek-ai/deepseek-v4.1-flash`, `meta/llama-3.3-70b-instruct` | `meta/llama-3.2-90b-vision-instruct`, `meta/llama-3.2-11b-vision-instruct` |

`set_config` rejects a model that is not in the chosen provider's list. If a stored model later disappears from the list, the function falls back to that provider's first model. To add a model, edit the registry, run `npm test` (see `src/lib/__tests__/aiRegistry.test.ts`) and redeploy `ai` and `admin-stats`.

The admin screen shows "(no key)" next to a provider whose secret is not set. The key itself is never returned.

## Quotas and kill switch

- Each AI call claims one request from the user's daily allowance and the shared daily allowance (UTC days), using `per_user_daily_limit` and `global_daily_limit` from `app_config` (defaults 5 and 40). A limit of 0 switches AI off.
- If the provider fails or returns an unusable reply, the request is given back (`release_ai_request`), so failures do not use up the quota.
- `ai_enabled = false` is a kill switch: chat and meal photos get a 503 with a friendly message, and the app shows its built-in answer with that notice.
- The admin can reset one user's quota for today from the Users section.
- USDA food search has its own allowance (30 per user, 500 overall per day).

## Features

- **Coach chat:** the configured chat model. The reply is JSON with suggested intents; proposals still need the user to accept them.
- **Meal photos:** the configured photo model. Photos are reduced before upload; the server checks MIME type and size (bodies over about 7 MB are refused before they are read). Estimates are checked against USDA FoodData Central when possible. Groq's free tier allows about 1000 output tokens per minute for its photo model, so Groq photo replies are capped at 900 tokens.
- **Without Supabase:** built-in rule-based replies and hint-based meal estimates. Photos are not analyzed.

Chat messages, a short fitness summary and reduced meal photos are sent to the chosen provider. See [SETUP.md](SETUP.md) for deployment and secrets.
