import { useSettings } from '@/store/settings';
import { notify } from '@/store/notify';
import { getSupabase } from '@/supabase/client';

let prompted = false;

/**
 * After the auth-storage switch to expo-secure-store, existing installs lose
 * their persisted session and get signed out silently - sync just stops with
 * no visible cue. If the user previously linked an account
 * (supabase_user_id set) but no session exists, surface a nudge. Fires at
 * most once per app launch.
 */
export async function promptIfSignedOut(): Promise<void> {
  if (prompted) return;
  const sb = getSupabase();
  if (!sb) return;
  if (!useSettings.getState().supabase_user_id) return;
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) return;
  prompted = true;
  notify('Signed out', {
    body: 'Sign back in on the Social tab to resume cloud sync',
    tone: 'info',
  });
}
