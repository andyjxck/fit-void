import type { CardioActivity } from '@/lib/cardio';
import type { CardioSession } from '@/lib/types';

import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

interface CardioRow extends Omit<CardioSession, 'zone_minutes'> {
  zone_minutes: string | null;
}

function toSession(r: CardioRow): CardioSession {
  return {
    ...r,
    zone_minutes: r.zone_minutes ? (JSON.parse(r.zone_minutes) as CardioSession['zone_minutes']) : null,
  };
}

export async function listCardio(limit = 200): Promise<CardioSession[]> {
  const rows = await all<CardioRow>(
    `SELECT * FROM cardio_sessions
      WHERE deleted_at IS NULL
      ORDER BY started_at DESC
      LIMIT ?`,
    limit
  );
  return rows.map(toSession);
}

export async function logCardio(input: {
  activity: CardioActivity;
  distance_m?: number | null;
  duration_seconds: number;
  avg_hr?: number | null;
  max_hr?: number | null;
  zone_minutes?: CardioSession['zone_minutes'];
  calories?: number | null;
  /** Activity extras (incline_pct, stroke_rate, ...) - stored as JSON. */
  meta?: Record<string, number> | null;
  started_at?: string;
  notes?: string | null;
  user_id?: string | null;
}): Promise<string> {
  const id = uuid();
  const t = touch();
  await run(
    `INSERT INTO cardio_sessions
       (id, user_id, activity, distance_m, duration_seconds, avg_hr, max_hr,
        zone_minutes, calories, meta, source, started_at, notes, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.activity,
    input.distance_m ?? null,
    Math.round(input.duration_seconds),
    input.avg_hr ?? null,
    input.max_hr ?? null,
    input.zone_minutes ? JSON.stringify(input.zone_minutes) : null,
    input.calories ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    input.started_at ?? t,
    input.notes ?? null,
    t
  );
  return id;
}

/**
 * Insert a health-platform session. external_id is UNIQUE so a re-import is a
 * silent no-op; returns true when a new row was actually written.
 */
export async function importCardio(input: {
  external_id: string;
  activity: CardioActivity;
  distance_m?: number | null;
  duration_seconds: number;
  avg_hr?: number | null;
  max_hr?: number | null;
  zone_minutes?: CardioSession['zone_minutes'];
  calories?: number | null;
  source: 'healthkit' | 'healthconnect' | 'googlehealth';
  started_at: string;
  notes?: string;
  user_id?: string | null;
}): Promise<boolean> {
  const t = touch();
  const res = await run(
    `INSERT OR IGNORE INTO cardio_sessions
       (id, user_id, external_id, activity, distance_m, duration_seconds,
        avg_hr, max_hr, zone_minutes, calories, source, started_at, notes, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    uuid(),
    input.user_id ?? (await ownerId()),
    input.external_id,
    input.activity,
    input.distance_m ?? null,
    Math.round(input.duration_seconds),
    input.avg_hr ?? null,
    input.max_hr ?? null,
    input.zone_minutes ? JSON.stringify(input.zone_minutes) : null,
    input.calories ?? null,
    input.source,
    input.started_at,
    input.notes ?? null,
    t
  );
  return (res.changes ?? 0) > 0;
}

/**
 * True when a session already exists within `toleranceS` of `startIso` -
 * cross-source dedupe so a workout synced via two platforms (e.g. Fitbit →
 * Apple Health → us, plus the Fitbit API) doesn't land twice. Also catches
 * same-source dupes: HealthKit can hold identical workouts under different
 * UUIDs, which external_id alone cannot collapse. `activity` scopes the
 * match so a real different-activity session in the window isn't skipped.
 */
export async function hasCardioNear(
  startIso: string,
  toleranceS = 600,
  activity?: CardioActivity
): Promise<boolean> {
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM cardio_sessions
      WHERE deleted_at IS NULL
        AND ABS(strftime('%s', started_at) - strftime('%s', ?)) <= ?
        ${activity ? 'AND activity = ?' : ''}`,
    ...(activity ? [startIso, toleranceS, activity] : [startIso, toleranceS])
  );
  return (r?.n ?? 0) > 0;
}

export async function deleteCardio(id: string) {
  await softDelete('cardio_sessions', id);
}
