import * as SQLite from 'expo-sqlite';

import { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION } from './schema';
import { seedExercisesIfEmpty } from './seed';
import { classifyNameTracking } from '@/lib/trackingType';

const DB_NAME = 'gymvoid.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Lazily opens the database, applies migrations and seeds the default exercise
 * library. All callers share the same promise so init happens exactly once.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

async function init(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(LOCAL_SCHEMA_SQL);
  await db.runAsync(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    LOCAL_SCHEMA_VERSION,
    new Date().toISOString()
  );
  // Singleton guest profile row.
  await db.runAsync(
    `INSERT OR IGNORE INTO local_profile (id, weight_unit, default_bar_weight, created_at)
     VALUES (1, 'kg', 20, ?)`,
    new Date().toISOString()
  );
  // Lightweight column migrations - CREATE TABLE IF NOT EXISTS won't add
  // columns to an existing table, so ALTER TABLE is needed for upgrades.
  await migrateColumns(db);
  await seedExercisesIfEmpty(db);
  return db;
}

/** Adds columns that were introduced after the initial schema creation. */
async function migrateColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(routine_exercises)`
  );
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('target_reps')) {
    await db.execAsync(
      `ALTER TABLE routine_exercises ADD COLUMN target_reps TEXT NOT NULL DEFAULT '[]'`
    );
  }
  if (!has('target_weights')) {
    await db.execAsync(
      `ALTER TABLE routine_exercises ADD COLUMN target_weights TEXT NOT NULL DEFAULT '[]'`
    );
  }
  if (!has('target_types')) {
    await db.execAsync(
      `ALTER TABLE routine_exercises ADD COLUMN target_types TEXT NOT NULL DEFAULT '[]'`
    );
  }

  const workoutCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(workouts)`
  );
  const hasWorkout = (name: string) => workoutCols.some((c) => c.name === name);
  if (!hasWorkout('archived_at')) {
    await db.execAsync(`ALTER TABLE workouts ADD COLUMN archived_at TEXT`);
  }
  if (!hasWorkout('feel')) {
    await db.execAsync(`ALTER TABLE workouts ADD COLUMN feel INTEGER`);
  }

  const exCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(exercises)`
  );
  const hasEx = (name: string) => exCols.some((c) => c.name === name);
  if (!hasEx('is_favourite')) {
    await db.execAsync(`ALTER TABLE exercises ADD COLUMN is_favourite INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasEx('github_image_id')) {
    await db.execAsync(`ALTER TABLE exercises ADD COLUMN github_image_id TEXT`);
  }
  if (!hasEx('tracking_type')) {
    await db.execAsync(`ALTER TABLE exercises ADD COLUMN tracking_type TEXT NOT NULL DEFAULT 'strength'`);
  }
  // Plank predates tracking_type - it's a timed hold, not weight+reps.
  // Backfill for installs that already seeded the default library.
  await db.execAsync(
    `UPDATE exercises SET tracking_type = 'hold'
      WHERE id = 'e0000000-0000-4000-8000-000000000043' AND tracking_type != 'hold'`
  );
  // Exercises created before tracking_type existed (or custom exercises made
  // before the picker offered it) are stuck on 'strength' - reclassify by
  // name so cardio machines, holds and carries stop asking for kg x reps.
  // Never downgrades a non-strength tag.
  const staleTracking = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM exercises WHERE tracking_type = 'strength' AND deleted_at IS NULL`
  );
  for (const row of staleTracking) {
    const reclassified = classifyNameTracking(row.name);
    if (reclassified !== 'strength') {
      await db.runAsync(
        `UPDATE exercises SET tracking_type = ? WHERE id = ?`,
        reclassified,
        row.id
      );
    }
  }
  // Library rows are global cloud data - never pushed as user rows.
  await db.execAsync(
    `UPDATE exercises SET dirty = 0 WHERE is_custom = 0 AND created_by IS NULL`
  );

  const setCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(workout_sets)`);
  const hasSet = (name: string) => setCols.some((c) => c.name === name);
  if (!hasSet('duration_seconds')) await db.execAsync(`ALTER TABLE workout_sets ADD COLUMN duration_seconds INTEGER`);
  if (!hasSet('distance_m')) await db.execAsync(`ALTER TABLE workout_sets ADD COLUMN distance_m REAL`);
  if (!hasSet('avg_hr')) await db.execAsync(`ALTER TABLE workout_sets ADD COLUMN avg_hr INTEGER`);
  if (!hasSet('meta')) await db.execAsync(`ALTER TABLE workout_sets ADD COLUMN meta TEXT`);

  const cardioCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(cardio_sessions)`);
  if (!cardioCols.some((c) => c.name === 'meta')) {
    await db.execAsync(`ALTER TABLE cardio_sessions ADD COLUMN meta TEXT`);
  }
  if (!cardioCols.some((c) => c.name === 'external_id')) {
    await db.execAsync(`ALTER TABLE cardio_sessions ADD COLUMN external_id TEXT`);
  }



  // personal_records.record_type's CHECK constraint is baked in at CREATE
  // TABLE time and ALTER TABLE can't widen it - rebuild once for installs
  // predating the hold/carry record types.
  const prSql = await db.getFirstAsync<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'personal_records'`
  );
  if (prSql && !prSql.sql.includes('max_hold_seconds')) {
    await db.execAsync(`
      ALTER TABLE personal_records RENAME TO personal_records_old;
      CREATE TABLE personal_records (
        id          TEXT PRIMARY KEY,
        user_id     TEXT,
        exercise_id TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
        record_type TEXT NOT NULL CHECK (record_type IN ('1rm','max_weight','max_volume','max_hold_seconds','max_distance')),
        value       REAL NOT NULL,
        achieved_at TEXT NOT NULL,
        workout_id  TEXT REFERENCES workouts (id) ON DELETE SET NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT,
        dirty       INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO personal_records SELECT * FROM personal_records_old;
      DROP TABLE personal_records_old;
      CREATE INDEX IF NOT EXISTS idx_pr_user_ex ON personal_records (user_id, exercise_id, record_type);
    `);
  }

  // Body profile fields on the singleton local_profile row.
  const profCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(local_profile)`);
  const hasProf = (name: string) => profCols.some((c) => c.name === name);
  const profileAdds: [string, string][] = [
    // CREATE TABLE-only columns are listed too so databases created by very
    // old builds converge on the full column set.
    ['display_name', 'TEXT'],
    ['has_void_pro', 'INTEGER NOT NULL DEFAULT 0'],
    ['supabase_user_id', 'TEXT'],
    ['created_at', 'TEXT'],
    ['height_cm', 'REAL'],
    ['birth_year', 'INTEGER'],
    ['sex', 'TEXT'],
    ['activity_level', "TEXT NOT NULL DEFAULT 'moderate'"],
    ['goal', "TEXT NOT NULL DEFAULT 'maintain'"],
    ['calorie_override', 'INTEGER'],
    ['water_target_ml', 'INTEGER'],
    ['void_tier', "TEXT NOT NULL DEFAULT 'free'"],
    ['health_connected', 'INTEGER NOT NULL DEFAULT 0'],
    ['fitbit_connected', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_sync_at', 'TEXT'],
    ['last_sync_error', 'TEXT'],
    ['last_health_import_at', 'TEXT'],
    ['health_import_week', 'TEXT'],
    ['health_import_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['primary_goal', 'TEXT'],
    ['unlock_speed', "TEXT NOT NULL DEFAULT 'all_at_once'"],
    ['onboarding_completed', 'INTEGER NOT NULL DEFAULT 0'],
    ['active_intents', "TEXT NOT NULL DEFAULT '[]'"],
    ['unlocked_modules', "TEXT NOT NULL DEFAULT '[\"lift\",\"habits\"]'"],
    ['seeded_intents', "TEXT NOT NULL DEFAULT '[]'"],
    ['void_pro_owner', 'TEXT'],
  ];
  for (const [col, type] of profileAdds) {
    if (!hasProf(col)) await db.execAsync(`ALTER TABLE local_profile ADD COLUMN ${col} ${type}`);
  }

  // Meal metadata columns (pitch, minutes, goal) - added to match recommended meals.
  const mealCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(meals)`);
  const hasMeal = (name: string) => mealCols.some((c) => c.name === name);
  const mealAdds: [string, string][] = [
    ['pitch', 'TEXT'],
    ['minutes', 'INTEGER'],
    ['goal', 'TEXT'],
    ['meal_type', 'TEXT'],
    ['image_uri', 'TEXT'],
  ];
  for (const [col, type] of mealAdds) {
    if (!hasMeal(col)) await db.execAsync(`ALTER TABLE meals ADD COLUMN ${col} ${type}`);
  }

  // Plan metadata columns (pitch, goal, tags) - added to match recommended plans.
  const planCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(meal_plans)`);
  const hasPlan = (name: string) => planCols.some((c) => c.name === name);
  const planAdds: [string, string][] = [
    ['pitch', 'TEXT'],
    ['goal', 'TEXT'],
    ['tags', "TEXT NOT NULL DEFAULT '[]'"],
  ];
  for (const [col, type] of planAdds) {
    if (!hasPlan(col)) await db.execAsync(`ALTER TABLE meal_plans ADD COLUMN ${col} ${type}`);
  }

  // Nutrition: sugar tracking + food/drink distinction.
  const nutCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(nutrition_entries)`);
  const hasNut = (name: string) => nutCols.some((c) => c.name === name);
  if (!hasNut('sugar_g')) await db.execAsync(`ALTER TABLE nutrition_entries ADD COLUMN sugar_g REAL NOT NULL DEFAULT 0`);
  if (!hasNut('is_drink')) await db.execAsync(`ALTER TABLE nutrition_entries ADD COLUMN is_drink INTEGER NOT NULL DEFAULT 0`);
  // external_id dedupes health-platform imports (e.g. 'ghealth:<dp-id>').
  if (!hasNut('external_id')) await db.execAsync(`ALTER TABLE nutrition_entries ADD COLUMN external_id TEXT`);

  const liqCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(liquid_entries)`);
  const hasLiq = (name: string) => liqCols.some((c) => c.name === name);
  if (!hasLiq('sugar_g')) {
    await db.execAsync(`ALTER TABLE liquid_entries ADD COLUMN sugar_g REAL NOT NULL DEFAULT 0`);
  }
  if (!hasLiq('nutrition_id')) {
    await db.execAsync(`ALTER TABLE liquid_entries ADD COLUMN nutrition_id TEXT`);
  }
  if (!hasLiq('external_id')) {
    await db.execAsync(`ALTER TABLE liquid_entries ADD COLUMN external_id TEXT`);
  }

  const foodCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(food_items)`);
  const hasFood = (name: string) => foodCols.some((c) => c.name === name);
  if (!hasFood('sugar_g')) await db.execAsync(`ALTER TABLE food_items ADD COLUMN sugar_g REAL NOT NULL DEFAULT 0`);
  if (!hasFood('is_drink')) await db.execAsync(`ALTER TABLE food_items ADD COLUMN is_drink INTEGER NOT NULL DEFAULT 0`);
  if (!hasFood('image_url')) await db.execAsync(`ALTER TABLE food_items ADD COLUMN image_url TEXT`);

  // routines.is_template - bundled examples never sync.
  const routineCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(routines)`);
  if (!routineCols.some((c) => c.name === 'is_template')) {
    await db.execAsync(`ALTER TABLE routines ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0`);
    await db.execAsync(`UPDATE routines SET is_template = 1 WHERE folder_name LIKE 'Examples ·%'`);
  }
  // routines.is_shared - collaborator copies keep the owner's user_id.
  if (!routineCols.some((c) => c.name === 'is_shared')) {
    await db.execAsync(`ALTER TABLE routines ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`);
  }
  // routines.parent_routine_id - tab routines hang off a shared parent.
  if (!routineCols.some((c) => c.name === 'parent_routine_id')) {
    await db.execAsync(`ALTER TABLE routines ADD COLUMN parent_routine_id TEXT REFERENCES routines (id) ON DELETE CASCADE`);
  }
  // routines.archived_at - deleted routines park in the Archive for 28 days.
  if (!routineCols.some((c) => c.name === 'archived_at')) {
    await db.execAsync(`ALTER TABLE routines ADD COLUMN archived_at TEXT`);
  }

  // train_widgets gains the sync contract columns.
  const widgetCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(train_widgets)`);
  const hasWidget = (name: string) => widgetCols.some((c) => c.name === name);
  if (!hasWidget('user_id')) await db.execAsync(`ALTER TABLE train_widgets ADD COLUMN user_id TEXT`);
  if (!hasWidget('deleted_at')) await db.execAsync(`ALTER TABLE train_widgets ADD COLUMN deleted_at TEXT`);
  if (!hasWidget('dirty')) await db.execAsync(`ALTER TABLE train_widgets ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1`);

  // Duplicate cleanup: health platforms can vendor the same workout/reading
  // under different ids, and older dedupes were check-then-insert. Extras are
  // tombstoned (not deleted) so the removal pushes to the cloud copy.
  // Runs before the unique indexes below - they can't be created over dupes.
  const t = now();
  await db.execAsync(
    `UPDATE cardio_sessions SET deleted_at = '${t}', updated_at = '${t}', dirty = 1
      WHERE deleted_at IS NULL AND id NOT IN (
        SELECT MIN(id) FROM cardio_sessions WHERE deleted_at IS NULL
        GROUP BY COALESCE(user_id, ''), activity, started_at)`
  );
  await db.execAsync(
    `UPDATE body_measurements SET deleted_at = '${t}', updated_at = '${t}', dirty = 1
      WHERE deleted_at IS NULL AND id NOT IN (
        SELECT MIN(id) FROM body_measurements WHERE deleted_at IS NULL
        GROUP BY COALESCE(user_id, ''), metric_type, logged_at, value)`
  );
  for (const tbl of ['nutrition_entries', 'liquid_entries']) {
    await db.execAsync(
      `UPDATE ${tbl} SET deleted_at = '${t}', updated_at = '${t}', dirty = 1
        WHERE deleted_at IS NULL AND external_id IS NOT NULL AND id NOT IN (
          SELECT MIN(id) FROM ${tbl}
          WHERE deleted_at IS NULL AND external_id IS NOT NULL
          GROUP BY external_id)`
    );
  }

  // Unique indexes backing the import dedupes - a re-imported health row
  // updates in place instead of forking a duplicate. Partial (live rows only)
  // so a tombstoned import can be re-imported and pulled tombstones never
  // collide. Matches the remote indexes (migrations 010/024).
  await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_external
    ON nutrition_entries (external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL`);
  await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_liquid_external
    ON liquid_entries (external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL`);
  // cardio's column UNIQUE covers fresh installs; this catches databases
  // created before the constraint existed.
  await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cardio_external
    ON cardio_sessions (external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL`);
}

export const now = () => new Date().toISOString();
