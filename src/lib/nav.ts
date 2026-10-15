import { router, type Href } from 'expo-router';

/**
 * Go back if there is somewhere to go back to, otherwise replace the current
 * screen with `fallback`. A page opened directly (deep link, refresh, new tab)
 * has no history, and a bare `router.back()` would do nothing.
 */
export function goBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
