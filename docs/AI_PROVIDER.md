# AI providers

Signed-in accounts reach AI only through the Supabase Edge Function `supabase/functions/ai/index.ts`. The function checks the user's token, that the email is confirmed and the account is not disabled, and the daily quota, then calls the provider. Provider keys are Supabase function secrets and never reach a device.

## Who picks the model

The **admin** sets the default provider and models in **Settings → Account & sync → Admin → AI configuration**, chooses whether users may choose, and controls which providers are allowed. Signed-in users can choose Groq or OpenRouter and one of three chat models in **Settings → Coach AI**. NVIDIA is admin-only. A choice is saved in the server-only `user_ai_prefs` table and applies on every device. With no valid choice, the admin default is used. The photo model is the chosen chat model when it reads images; otherwise it is the provider's default photo model (Qwen3.8 27B on Groq, GLM 5.3 Flash on OpenRouter).

The defaults and controls are stored in single-row `app_config` (service role only): `provider`, `chat_model`, `vision_model`, `allowed_providers`, `allow_user_choice`, `per_user_daily_limit`, `global_daily_limit`, `per_ip_daily_limit`, `ai_enabled`. User choices never enter synced app state or exports.

## Provider registry

`supabase/functions/_shared/providers.ts` is the only list of providers and models. Every provider is called through its OpenAI-compatible chat-completions endpoint.

| Provider | Secret | Endpoint | Chat models | Photo models |
| --- | --- | --- | --- | --- |
| Groq | `GROQ_API_KEY` | `api.groq.com/openai/v1/chat/completions` | `openai/gpt-oss-20b` (default), `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` | `qwen/qwen3.8-27b` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter.ai/api/v1/chat/completions` | `z-ai/glm-5.3-flash` (default), `nvidia/nemotron-3.5-lightning`, `deepseek/deepseek-v4.1-flash` | GLM and DeepSeek; Nemotron uses GLM for photos |
| NVIDIA | `NVIDIA_API_KEY` | `integrate.api.nvidia.com/v1/chat/completions` | `moonshotai/kimi-k2.6` (default), `deepseek-ai/deepseek-v4.1-flash`, `nvidia/nemotron-3-super-120b-a12b` | `meta/llama-3.2-90b-vision-instruct` (default), `meta/llama-3.2-11b-vision-instruct`, `moonshotai/kimi-k2.6` |

### Model verification (2026-10-15)

Every id above was checked against the provider's own catalog:

- **Groq** ([models](https://console.groq.com/docs/models), [vision](https://console.groq.com/docs/vision)): `openai/gpt-oss-120b` and `-20b` are production models; `qwen/qwen3.8-27b` is a *preview* model and Groq's only image model (base64 data URIs accepted, at most 3 images and 20 MB per request). Preview models can be withdrawn at short notice.
- **OpenRouter** ([catalog](https://openrouter.ai/models), [API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)): the live `/api/v1/models` catalog lists all three IDs above. GLM 5.3 Flash and DeepSeek V4.1 Flash accept text and images; Nemotron 3.5 Lightning accepts text only. DeepSeek reasoning is disabled for short, usable coach and photo replies. Published prices and provider routes can change, so recheck the live catalog before changing defaults. OpenRouter billing is separate from the old Gemini key.
- **NVIDIA** ([LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis), [multimodal API reference](https://docs.api.nvidia.com/nim/reference/multimodal-apis), and the live catalog `GET https://integrate.api.nvidia.com/v1/models`): `moonshotai/kimi-k2-instruct` and `meta/llama-3.3-70b-instruct` are no longer in the live catalog, so they were replaced with `moonshotai/kimi-k2.6` (text, image and video input) and `nvidia/nemotron-3-super-120b-a12b`. `deepseek-ai/deepseek-v4.1-flash` and both Llama 3.2 Vision models are listed. Thinking is turned off with `chat_template_kwargs` where the model's chat template supports it, and `<think>` blocks are stripped from replies anyway. NVIDIA's forum has reports of Kimi K2.6 returning 404 for some keys; switch to another model in the admin screen if that happens.

To re-check for a particular account, query the provider's model catalog using its server-held key before deployment and consult the Groq/OpenRouter pages above. The published catalogs confirm the IDs; availability to a particular key can still differ. Provider errors remain generic in the app.

`set_config` and `set_preference` reject models outside their provider's list. A stale user preference falls back to the admin default. To add a model, edit the registry, run `npm test` (see `src/lib/__tests__/aiRegistry.test.ts`) and redeploy `ai` and `admin-stats`.

The admin screen shows "(no key)" next to a provider whose secret is not set. The key itself is never returned.

## Quotas and kill switch

- Each AI call claims one request from the user's daily allowance and the shared daily allowance (UTC days), using `per_user_daily_limit` and `global_daily_limit` from `app_config` (defaults 25 and 250). A limit of 0 switches AI off.
- Each AI call also claims one request from its network's allowance: `per_ip_daily_limit` (default 250, set in the admin screen; 0 = no per-network cap). This stops one network from spending the shared allowance through many accounts. The table `ai_ip_usage` stores only an HMAC of the IP, and rows older than a week are deleted. The HMAC key is the optional `IP_HASH_SECRET` function secret, or the service-role key when it is unset (setting or changing it restarts today's per-network counts, nothing else). Requests without a client IP skip this cap. The IP comes from `cf-connecting-ip` (set by Cloudflare, which overwrites any client value), else the **rightmost** `x-forwarded-for` entry (appended by the proxy), else `x-real-ip`; never the leftmost `x-forwarded-for` entry, which the caller controls. The reasoning and sources are in `supabase/functions/_shared/ip.ts`; the signup limit uses the same helper.
- Refunds: a request is given back (`release_ai_request` and `release_ai_ip_request`) only when no billed provider call happened: bad input caught by the function, a missing key, a network error or timeout before a response, or a provider refusal for rate limit (429), outage (5xx) or our own configuration (401/403/404/408). Once the provider has returned 2xx, the request counts even if the reply is empty or unusable, and its token usage is still recorded (`record_ai_tokens`); otherwise a user could make the model produce unusable output on purpose and get unlimited provider calls. A malformed request the provider rejects (400/413/422) also counts. A request refused by the per-user or global cap gives its network claim back too.
- Errors shown to users are generic ("Coach AI is not available right now", "Coach AI is busy", "...could not be used"). They never name the provider, model, HTTP status or secret. The details (status, provider message, which secret to check) are in the function logs: Supabase dashboard → Edge Functions → `ai` → Logs.
- `ai_enabled = false` is a kill switch: chat and meal photos get a 503 with a friendly message, and the app shows its built-in answer with that notice.
- The admin can reset one user's quota for today from the Users section.
- USDA food search has its own allowance (30 per user, 500 overall per day).

## Features

- **Coach chat:** the user's selected chat model, or the admin default. The reply is JSON with suggested intents; proposals still need the user to accept them.
- **Meal photos:** the derived photo model for the user's provider, or the admin default. Photos are reduced before upload; the server checks MIME type and size (bodies over about 7 MB are refused before they are read). Estimates are checked against USDA FoodData Central when possible. Groq's free tier allows about 1000 output tokens per minute for its photo model, so Groq photo replies are capped at 900 tokens.
- **Without Supabase:** built-in rule-based replies and hint-based meal estimates. Photos are not analyzed.

Chat messages, a short fitness summary and reduced meal photos are sent to the chosen provider. See [SETUP.md](SETUP.md) for deployment and secrets.
