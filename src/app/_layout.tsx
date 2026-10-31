import { DarkTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { NotifyHost } from '@/components/ui/Notify';
import { getDb } from '@/db/client';
import { purgeExpiredArchives } from '@/db/repo/workouts';
import { seedExercisesIfEmpty } from '@/db/seed';
import { seedExampleRoutines } from '@/db/seedRoutines';
import { claimGuestData, syncNow, wipeLocalUserData } from '@/db/sync';
import { promptIfSignedOut } from '@/lib/authGate';
import { reconcileEntitlements } from '@/lib/entitlements';
import { autoImportHealthOnLaunch } from '@/lib/healthAutoImport';
import { initWatchSync } from '@/lib/watchSync';
import { useActiveWorkout } from '@/store/activeWorkout';
import { useSettings } from '@/store/settings';
import { getSupabase } from '@/supabase/client';
import { Void } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

const VoidTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Void.canvas,
    card: Void.canvas,
    primary: Void.accent,
    text: Void.text,
    border: Void.border,
  },
};

export default function RootLayout() {
  const router = useRouter();
  // Bootstrap: open DB → hydrate settings + any in-flight workout → sync hooks.
  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let appStateSub: { remove: () => void } | null = null;
    let watchTeardown: (() => void) | null = null;

    (async () => {
      const db = await getDb();
      await seedExercisesIfEmpty(db);
      await seedExampleRoutines(db);
      await purgeExpiredArchives();
      await useSettings.getState().hydrate();
      await useActiveWorkout.getState().hydrate();
      await SplashScreen.hideAsync();

      // Watch bridge after hydration so the first snapshot is accurate.
      watchTeardown = initWatchSync();

      // Health pull runs here (mount effect = cold start only), not in the
      // AppState listener below - backgrounded->foreground never re-fires it.
      void autoImportHealthOnLaunch();

      if (!useSettings.getState().onboarding_completed) {
        router.replace('/onboarding');
      }

      const sb = getSupabase();
      if (sb) {
        const { data } = sb.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session?.user) {
            const prevId = useSettings.getState().supabase_user_id;
            // Account switch: the device holds one account's data at a time -
            // wipe the old owner's rows, then sync pulls the new account's
            // cloud copy down.
            // After the profile pull, reconcile the device receipt: sign-in
            // reset the local entitlement, so a StoreKit purchase that
            // qualifies for this account has to be re-granted here - the
            // cloud profile alone doesn't carry old/unpushed grants.
            const reconcile = () => reconcileEntitlements().then(() => void syncNow());
            if (prevId && prevId !== session.user.id) {
              void wipeLocalUserData()
                .then(() => claimGuestData(session.user.id))
                .then(reconcile);
            } else {
              void claimGuestData(session.user.id).then(reconcile);
            }
          }
        });
        sub = data.subscription;
        void syncNow();
        // Persisted sessions don't re-fire SIGNED_IN - reconcile the device
        // receipt on cold start so an existing account's Pro comes back.
        void reconcileEntitlements().then(() => void syncNow());
        void promptIfSignedOut();
      }

      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void syncNow();
      });
    })();

    return () => {
      sub?.unsubscribe();
      appStateSub?.remove();
      watchTeardown?.();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Void.canvas }}>
      <ThemeProvider value={VoidTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Void.canvas },
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen
            name="workout/active"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="workout/[id]"
            options={{ presentation: 'card', animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="workout/manual"
            options={{ presentation: 'card', animation: 'slide_from_right' }}
          />
          <Stack.Screen name="exercise/[id]" options={{ presentation: 'card' }} />
          <Stack.Screen name="meals/[id]" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          <Stack.Screen name="meals/plan/[id]" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          <Stack.Screen name="archive" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          <Stack.Screen name="map" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
          <Stack.Screen name="auth/link" options={{ presentation: 'modal' }} />
        </Stack>
        <NotifyHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
