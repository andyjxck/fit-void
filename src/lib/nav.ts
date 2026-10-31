import { router } from 'expo-router';

/**
 * Header back buttons: deep links can land on a pushed screen as the ROOT
 * route - back() is unhandled there (dev 'GO_BACK' warning + a dead button).
 * Fall back to the tab root so the user is never stranded.
 */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
