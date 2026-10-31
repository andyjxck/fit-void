import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDb } from '@/db/client';

const esc = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Free-tier CSV export: one row per completed set with workout + exercise
 * context. Shares via the native sheet.
 */
export async function exportWorkoutsCsv(): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT w.started_at   AS workout_started,
            w.completed_at AS workout_completed,
            w.title        AS workout_title,
            e.name         AS exercise,
            e.target_muscle,
            e.equipment,
            s.set_order,
            s.set_type,
            s.weight_kg,
            s.reps,
            s.rpe
       FROM workout_sets s
       JOIN workouts w  ON w.id = s.workout_id
       JOIN exercises e ON e.id = s.exercise_id
      WHERE s.is_completed = 1 AND s.deleted_at IS NULL
        AND w.is_completed = 1 AND w.deleted_at IS NULL
        -- archived_at rows are included: this is a full-history export.
      ORDER BY w.started_at, s.set_order`
  );

  const header = [
    'workout_started',
    'workout_completed',
    'workout_title',
    'exercise',
    'target_muscle',
    'equipment',
    'set_order',
    'set_type',
    'weight_kg',
    'reps',
    'rpe',
  ];
  const csv = [header.join(',')]
    .concat(rows.map((r) => header.map((h) => esc(r[h])).join(',')))
    .join('\n');

  const file = new File(Paths.cache, 'fit-void-export.csv');
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export workout data' });
}
