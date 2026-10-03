# AI provider: what it does, what it costs, how it's protected

## Current state

The app ships with a **simulated** AI that runs on the device for free:

- Food "photo" estimates come from your *hint* matched to built-in USDA-based reference foods. The image itself isn't analysed.
- The coach recognises common requests ("20 minutes", "eating out", pain, goal or schedule changes, progress questions) and answers from your data with fixed rules.

Every simulated result is labelled **Simulated** in the UI.

## Server AI (implemented, not yet connected)

`supabase/functions/ai/index.ts` calls Anthropic's **Claude API** (model `claude-opus-5-5`):

| Feature | What it does |
| --- | --- |
| `estimate_food` | Vision: identifies foods and portions from the photo + hint. Then replaces visual guesses with **sourced values**: official restaurant nutrition found by web search (only accepted with an official URL), otherwise USDA FoodData Central values scaled to the portion. Items with no source stay marked as **Visual estimate**. |
| `coach` | Conversational coaching with your context (goal, today's food and workout, weight trend). Returns structured *intents* (short workout, pain swap, goal change, schedule change). The app turns these into the same Accept/Decline cards using its own safe, rule-based code, so the AI never edits plans directly. |

Safety: the system prompt forbids diagnosis and extreme diets, requires professional referral for red flags, and tells the coach never to claim a change was made. Refusals are handled, and the server fallback is enabled (`fallbacks: "default"`).

## Accounts and costs

- **Anthropic API account** (console.anthropic.com). Pay-as-you-go: you need a payment method, and you can set a hard monthly spend limit.
- Pricing for `claude-opus-5-5` at the time of writing: **$4 per million input tokens, $20 per million output tokens**. Web search has a small per-search fee. Check the current pricing page before launch.
- Rough per-use estimates, which you should verify with real traffic:
  - Photo estimate: image plus prompt ≈ 2–3k input tokens and ~600 output tokens, so about **$0.02–0.03**. With an official-restaurant web search, about **$0.05–0.10**.
  - Coach message: ≈ 2–4k input and ~300 output tokens, so about **$0.01–0.02**.
  - Example: 1,000 active users × 3 photos + 2 chats per day ≈ **$100–200 per day**. A cheaper model (for example Claude Sonnet 5.5 at $2/$10) roughly halves this, but that is a quality/price decision for you to make. Change `MODEL` in the function.
- Cost controls already built in: sign-in required, `AI_DAILY_LIMIT` requests per user per day (default 60), and token usage recorded per user in `ai_usage`.

**The business model is undecided.** No subscriptions or paywalls exist in the app. AI costs are the main reason to discuss this before a public launch.

## Keys stay on the server

- `ANTHROPIC_API_KEY` is set with `supabase secrets set` and read only inside the Edge Function.
- The app contains only the public Supabase URL and publishable key. Database privacy is enforced by Row Level Security.
