# AI providers

Signed-in accounts reach AI only through the Supabase Edge Function `supabase/functions/ai/index.ts`. The function checks the user's token, that the email is confirmed and the account is not disabled, and the daily quota, then calls the provider. Provider keys are Supabase function secrets and never reach a device.

## Who picks the model

The **admin** picks one provider and its models for everyone, in **Settings → Account & sync → Admin → AI configuration**. Users do not choose. Settings → Coach AI shows them a read-only line such as "Groq · GPT-OSS 120B" (from the function's `info` action).

The choice is stored in the single-row `app_config` table (service role only): `provider`, `chat_model`, `vision_model`, `per_user_daily_limit`, `global_daily_limit`, `per_ip_daily_limit`, `ai_enabled`.

## Provider registry

`supabase/functions/_shared/providers.ts` is the only list of providers and models. Every provider is called through its OpenAI-compatible chat-completions endpoint.

| Provider | Secret | Endpoint | Chat models | Photo models |
| --- | --- | --- | --- | --- |
| Groq | `GROQ_API_KEY` | `api.groq.com/openai/v1/chat/completions` | `openai/gpt-oss-120b` (default), `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` | `qwen/qwen3.8-27b` |
| Gemini | `GEMINI_API_KEY` | `generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-3.5-flash-lite` (default), `gemini-3.8-flash`, `gemini-3.1-flash-lite` | same as chat |
| NVIDIA | `NVIDIA_API_KEY` | `integrate.api.nvidia.com/v1/chat/completions` | `moonshotai/kimi-k2.6` (default), `deepseek-ai/deepseek-v4.1-flash`, `nvidia/nemotron-3-super-120b-a12b` | `meta/llama-3.2-90b-vision-instruct` (default), `meta/llama-3.2-11b-vision-instruct`, `moonshotai/kimi-k2.6` |

### Model verification (2026-10-13)

Every id above was checked against the provider's own catalog:

- **Groq** ([models](https://console.groq.com/docs/models), [vision](https://console.groq.com/docs/vision)): `openai/gpt-oss-120b` and `-20b` are production models; `qwen/qwen3.8-27b` is a *preview* model and Groq's only image model (base64 data URIs accepted, at most 3 images and 20 MB per request). Preview models can be withdrawn at short notice.
- **Gemini** ([models](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)): `gemini-3.8-flash`, `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` are stable, have a free tier and read images. `gemini-2.5-pro` was removed from the list because Google now limits the 2.5 family to existing users. The OpenAI-compatible endpoint accepts `image_url` parts with `data:image/...;base64,` URIs and `reasoning_effort` (`minimal`/`low`/`medium`/`high`, mapped to `thinking_level` on 3.x models); thinking cannot be switched off on 3.x, so the registry sends `reasoning_effort: "low"` to keep it short. Default is 3.5 Flash-Lite as the cheapest current model with image input ($0.30 / $2.50 per million tokens); 3.8 Flash is better but costs more (from 2027-01-01 its price doubles).
- **NVIDIA** ([LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis), [multimodal API reference](https://docs.api.nvidia.com/nim/reference/multimodal-apis), and the live catalog `GET https://integrate.api.nvidia.com/v1/models`): `moonshotai/kimi-k2-instruct` and `meta/llama-3.3-70b-instruct` are no longer in the live catalog, so they were replaced with `moonshotai/kimi-k2.6` (text, image and video input) and `nvidia/nemotron-3-super-120b-a12b`. `deepseek-ai/deepseek-v4.1-flash` and both Llama 3.2 Vision models are listed. Thinking is turned off with `chat_template_kwargs` where the model's chat template supports it, and `<think>` blocks are stripped from replies anyway. NVIDIA's forum has reports of Kimi K2.6 returning 404 for some keys; switch to another model in the admin screen if that happens.

To re-check: `curl https://integrate.api.nvidia.com/v1/models` (no key needed), and the Groq/Gemini pages above. The admin screen surfaces a 404 from a provider as "<provider> doesn't offer <model> to this key".

`set_config` rejects a model that is not in the chosen provider's list. If a stored model later disappears from the list, the function falls back to that provider's first model. To add a model, edit the registry, run `npm test` (see `src/lib/__tests__/aiRegistry.test.ts`) and redeploy `ai` and `admin-stats`.

The admin screen shows "(no key)" next to a provider whose secret is not set. The key itself is never returned.

## Quotas and kill switch

- Each AI call claims one request from the user's daily allowance and the shared daily allowance (UTC days), using `per_user_daily_limit` and `global_daily_limit` from `app_config` (defaults 5 and 40). A limit of 0 switches AI off.
- Each AI call also claims one request from its network's allowance: `per_ip_daily_limit` (default 100, set in the admin screen; 0 = no per-network cap). This stops one network from spending the shared allowance through many accounts. The table `ai_ip_usage` stores only an HMAC of the IP (keyed with the service-role key), and rows older than a week are deleted. Requests without a client IP header skip this cap. The IP is taken from `x-forwarded-for` as set by Supabase's gateway (the same helper as the signup limit).
- If the provider fails or returns an unusable reply, the request is given back (`release_ai_request` and `release_ai_ip_request`), so failures do not use up the quota. A request refused by the per-user or global cap gives its network claim back too.
- `ai_enabled = false` is a kill switch: chat and meal photos get a 503 with a friendly message, and the app shows its built-in answer with that notice.
- The admin can reset one user's quota for today from the Users section.
- USDA food search has its own allowance (30 per user, 500 overall per day).

## Features

- **Coach chat:** the configured chat model. The reply is JSON with suggested intents; proposals still need the user to accept them.
- **Meal photos:** the configured photo model. Photos are reduced before upload; the server checks MIME type and size (bodies over about 7 MB are refused before they are read). Estimates are checked against USDA FoodData Central when possible. Groq's free tier allows about 1000 output tokens per minute for its photo model, so Groq photo replies are capped at 900 tokens.
- **Without Supabase:** built-in rule-based replies and hint-based meal estimates. Photos are not analyzed.

Chat messages, a short fitness summary and reduced meal photos are sent to the chosen provider. See [SETUP.md](SETUP.md) for deployment and secrets.
