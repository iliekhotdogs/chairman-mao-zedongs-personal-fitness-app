# Verification

Run `npm run typecheck`, `npm run lint`, and `npm test -- --runInBand`. As of 3 October 2026, all pass, with 98 unit tests. Tests cover account-build provider selection, NVIDIA image model preservation, OpenRouter chat model selection, USDA request format, sync merge logic, and core fitness rules.

The Supabase migration and Edge Functions still require deployment to the `fitdih` project before real account, admin, USDA, or AI integration can be verified end to end. A real NVIDIA/OpenRouter request was not made in this workspace because the owner's keys remain private. Follow [SETUP.md](SETUP.md) and test with owner credentials after deployment.

Health syncing and push delivery are still simulated or limited to local notification behavior; they are not part of this account/AI change.
