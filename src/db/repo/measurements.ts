import type { BodyMeasurement, MetricType } from '@/lib/types';

import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

export async function logMeasurement(input: {
  metric_type: MetricType;
  value: number;
  user_id?: string | null;
  logged_at?: string;
}): Promise<string> {
  const id = uuid();
  const t = touch();
  await run(
    `INSERT INTO body_measurements (id, user_id, metric_type, value, logged_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.metric_type,
    input.value,
    input.logged_at ?? t,
    t
  );
  return id;
}

export async function listMeasurements(metric?: MetricType): Promise<BodyMeasurement[]> {
  if (metric) {
    return all<BodyMeasurement>(
      `SELECT * FROM body_measurements
        WHERE metric_type = ? AND deleted_at IS NULL
        ORDER BY logged_at DESC`,
      metric
    );
  }
  return all<BodyMeasurement>(
    `SELECT * FROM body_measurements WHERE deleted_at IS NULL ORDER BY logged_at DESC`
  );
}

export async function deleteMeasurement(id: string) {
  await softDelete('body_measurements', id);
}

/** Most recent weigh-in, kg. Used to load bodyweight exercises (pull-ups etc). */
export async function latestWeightKg(): Promise<number | null> {
  const r = await first<{ value: number }>(
    `SELECT value FROM body_measurements
      WHERE metric_type = 'weight' AND deleted_at IS NULL
      ORDER BY logged_at DESC LIMIT 1`
  );
  return r?.value ?? null;
}
