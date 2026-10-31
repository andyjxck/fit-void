import { importGoogleHealthData } from '@/lib/googleHealthImport';
import { importHealthData } from '@/lib/healthImport';
import { useSettings } from '@/store/settings';

/** Rate limit: max 2 health pulls per hour (one attempt per 30 minutes). */
const MIN_INTERVAL_MS = 30 * 60 * 1000;
/** Incremental look-back for launch pulls - the initial connect already
 *  backfilled 90 days, and external_id dedupe makes repeats cheap. */
const LOOKBACK_DAYS = 14;

let ranThisProcess = false;

/**
 * Pulls new data from connected health platforms (Apple Health / Health
 * Connect, plus Google Health which covers Fitbit) on cold launch only.
 * Called once from the root layout's mount effect - deliberately NOT wired
 * to the AppState foreground listener, so returning to a backgrounded app
 * never re-triggers it.
 */
export async function autoImportHealthOnLaunch(): Promise<void> {
  // Process-level guard covers double-mount (dev StrictMode, remounts).
  if (ranThisProcess) return;
  ranThisProcess = true;

  const s = useSettings.getState();
  if (!s.health_connected && !s.fitbit_connected) return;

  const last = s.last_health_import_at ? Date.parse(s.last_health_import_at) : 0;
  if (Date.now() - last < MIN_INTERVAL_MS) return;

  // Stamp the attempt before running: the rate limit counts attempts, so a
  // failing import still consumes the slot and can't be retried in a loop.
  const stamp = new Date().toISOString();
  s.set({ last_health_import_at: stamp });

  try {
    if (s.health_connected) {
      await importHealthData(s.supabase_user_id, { days: LOOKBACK_DAYS });
    }
    if (s.fitbit_connected) {
      await importGoogleHealthData(s.supabase_user_id, { days: LOOKBACK_DAYS });
    }
  } catch (e) {
    console.warn('[health] launch import failed', e);
  }
}
