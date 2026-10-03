# Wearables and activity data

## Supported today

| Source | Status | Notes |
| --- | --- | --- |
| Manual steps | ✅ Works everywhere | Takes priority over device data for that day. |
| Simulated Health Connect | ✅ Prototype only | Generated phone and watch data, a missing-data day, and a very active day, to exercise the full flow. Labelled "Simulated". |
| Android Health Connect | 🟡 Planned next | Needs a development build (below). |
| Apple Health | ❌ Not planned | iPhone app isn't in scope. |
| Direct Garmin / Fitbit / Whoop / Oura APIs | ❌ Not planned yet | Most of these already write to Health Connect through their own Android apps. |

**Do not promise "every device".** The honest claim is: *any app that writes steps/active calories to Android Health Connect* (Samsung Health, Google Fit/Fitbit, Garmin Connect, Oura, Withings, and others, depending on each app's own settings).

## How the app uses activity (already implemented)

- The daily calorie target already includes the steps implied by the user's lifestyle answer (5,000, 8,500 or 12,000) and their planned workouts.
- Only steps **≥ 3,000 above that baseline** can trigger a suggestion. Extra steps × 0.04 kcal is discounted **50%** for wearable over-estimation and capped at **+400 kcal**. The result is offered as a **today-only** Accept/Decline card.
- Logged gym workouts are never added again, because they're in the baseline.
- **Duplicates:** re-syncing the same upstream record updates it in place. When several devices report the same day, one is counted (manual first, then most steps), and the others are shown as "ignored".
- **Missing data:** shown as "No data" days. No suggestion is made from missing data.
- **Disconnected:** history stays, and suggestions pause.
- Activity is reviewable on the desktop website (Progress → Activity) once accounts sync.

## Adding real Health Connect (next stage)

1. `npx expo install react-native-health-connect expo-health-connect expo-build-properties expo-dev-client`
2. Add the `expo-health-connect` config plugin and set `minSdkVersion` 26 via `expo-build-properties` in `app.json`. Follow the library's current README, because versions change.
3. Request read permissions for `Steps`, `ActiveCaloriesBurned` and `ExerciseSession`.
4. Implement a provider in `src/lib/activity/providers.ts` that reads the last 14 days, maps each record to `ActivityRecord` (`source: 'health_connect'`, `externalId` = Health Connect record id, `origin` = data-origin package name), and dispatches `MERGE_ACTIVITY`. The merge and de-duplication logic is already tested.
5. Handle `permission_denied` and `unavailable` (Health Connect not installed) with the existing UI states.
6. Build with `npx eas-cli@latest build --profile development --platform android` and test on a physical phone.
7. Google Play requires a **Health Connect permissions declaration** and a privacy policy that explains the health data use (see RELEASE.md).
