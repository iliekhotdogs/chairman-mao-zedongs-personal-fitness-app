# Verification

Run `npm run typecheck`, `npm run lint`, and `npm test -- --runInBand`. As of 3 October 2026, all pass, with 98 unit tests. Tests cover account-build provider selection, NVIDIA image model preservation, OpenRouter chat model selection, USDA request format, sync merge logic, and core fitness rules.

The Supabase migration and both Edge Functions were deployed to fitdih. The owner account successfully loaded aggregate admin stats. Separate-account isolation and live AI requests still need end-to-end checks with a second account and the owner’s API keys. A real NVIDIA/OpenRouter request was not made in this workspace because the owner's keys remain private. Follow [SETUP.md](SETUP.md) and test with owner credentials after deployment.

Health syncing and push delivery are still simulated or limited to local notification behavior; they are not part of this account/AI change.
