import type { Intent } from '@/lib/intents';

import { all } from './helpers';

/** Start of the current week (Monday, local midnight). */
function startOfWeek(): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

const weekdayFromDateStr = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
};
const weekdayFromIso = (iso: string): number => (new Date(iso).getDay() + 6) % 7;

/** Weekday indices (Mon=0) with activity this week, adapted to the given
 *  focus - nutrition logging days, hydration days, cardio days, etc.
 *  Falls back to workout days for focuses with no local day-level signal
 *  (lift, progress, habits, social). */
export async function consistencyDaysThisWeek(intent: Intent | null): Promise<{ days: Set<number>; label: string }> {
  const since = startOfWeek();

  switch (intent) {
    case 'nutrition': {
      const rows = await all<{ logged_on: string }>(
        `SELECT DISTINCT logged_on FROM nutrition_entries WHERE deleted_at IS NULL AND is_drink = 0 AND logged_on >= ?`,
        since.toISOString().slice(0, 10)
      );
      return { days: new Set(rows.map((r) => weekdayFromDateStr(r.logged_on))), label: 'meals logged' };
    }
    case 'hydration': {
      const rows = await all<{ logged_on: string }>(
        `SELECT DISTINCT logged_on AS logged_on FROM liquid_entries WHERE deleted_at IS NULL AND logged_on >= ?
         UNION SELECT DISTINCT logged_on FROM nutrition_entries WHERE deleted_at IS NULL AND is_drink = 1 AND logged_on >= ?`,
        since.toISOString().slice(0, 10),
        since.toISOString().slice(0, 10)
      );
      return { days: new Set(rows.map((r) => weekdayFromDateStr(r.logged_on))), label: 'hydration logged' };
    }
    case 'cardio': {
      const rows = await all<{ started_at: string }>(
        `SELECT started_at FROM cardio_sessions WHERE deleted_at IS NULL AND started_at >= ?`,
        since.toISOString()
      );
      return { days: new Set(rows.map((r) => weekdayFromIso(r.started_at))), label: 'cardio sessions' };
    }
    case 'body_comp': {
      const rows = await all<{ logged_at: string }>(
        `SELECT logged_at FROM body_measurements WHERE deleted_at IS NULL AND metric_type = 'weight' AND logged_at >= ?`,
        since.toISOString()
      );
      return { days: new Set(rows.map((r) => weekdayFromIso(r.logged_at))), label: 'weigh-ins' };
    }
    case 'recovery': {
      const rows = await all<{ logged_at: string }>(
        `SELECT logged_at FROM body_measurements WHERE deleted_at IS NULL AND metric_type IN ('sleep_hours', 'resting_hr') AND logged_at >= ?`,
        since.toISOString()
      );
      return { days: new Set(rows.map((r) => weekdayFromIso(r.logged_at))), label: 'recovery logged' };
    }
    case 'progress': {
      // "Active" days across every trackable domain - the overall momentum
      // picture, not just lifting.
      const [w, c, b] = await Promise.all([
        all<{ started_at: string }>(
          `SELECT started_at FROM workouts WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL AND started_at >= ?`,
          since.toISOString()
        ),
        all<{ started_at: string }>(
          `SELECT started_at FROM cardio_sessions WHERE deleted_at IS NULL AND started_at >= ?`,
          since.toISOString()
        ),
        all<{ logged_at: string }>(
          `SELECT logged_at FROM body_measurements WHERE deleted_at IS NULL AND metric_type = 'weight' AND logged_at >= ?`,
          since.toISOString()
        ),
      ]);
      const days = new Set<number>();
      for (const r of w) days.add(weekdayFromIso(r.started_at));
      for (const r of c) days.add(weekdayFromIso(r.started_at));
      for (const r of b) days.add(weekdayFromIso(r.logged_at));
      return { days, label: 'active days' };
    }
    case 'social': {
      // No local day-level signal (check-ins/likes live in Supabase) -
      // an honest empty grid rather than borrowing workout data.
      return { days: new Set(), label: 'check the feed for activity' };
    }
    default: {
      const rows = await all<{ started_at: string }>(
        `SELECT started_at FROM workouts WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL AND started_at >= ?`,
        since.toISOString()
      );
      return { days: new Set(rows.map((r) => weekdayFromIso(r.started_at))), label: 'sessions this week' };
    }
  }
}

/** Given the active focus selection, pick which single focus should drive
 *  the adaptive consistency widget. Lift/progress/habits/social/ALL show
 *  training days; anything else drives its own day-tracked stat. */
export function primaryConsistencyIntent(active: Intent[]): Intent | null {
  const adaptive: Intent[] = ['nutrition', 'hydration', 'cardio', 'body_comp', 'recovery', 'progress', 'social'];
  const hit = active.find((i) => adaptive.includes(i));
  return hit ?? null;
}
