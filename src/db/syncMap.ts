/**
 * Pure local<->remote row mapping for the sync engine: table order, ownership
 * scoping, column whitelists and JSON/bool/timestamp conversions. Kept
 * dependency-free so it can be unit-tested outside React Native.
 */

export const SYNCED_TABLES = [
  'exercises',
  'routine_folders',
  'routines',
  'routine_exercises',
  'routine_folder_assignments',
  'workouts',
  'workout_sets',
  'personal_records',
  'body_measurements',
  'nutrition_entries',
  'liquid_entries',
  'meals',
  'meal_ingredients',
  'meal_plans',
  'meal_plan_items',
  'food_items',
  'exercise_favourites',
  'day_status',
  'cardio_sessions',
  'train_widgets',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

// Columns stored as INTEGER locally but boolean in Postgres.
export const BOOL_COLUMNS: Record<SyncedTable, string[]> = {
  exercises: ['is_custom'],
  routine_folders: [],
  routines: [],
  routine_exercises: [],
  routine_folder_assignments: [],
  workouts: ['is_completed'],
  workout_sets: ['is_completed'],
  personal_records: [],
  body_measurements: [],
  nutrition_entries: ['is_drink'],
  liquid_entries: [],
  meals: ['is_favourite'],
  meal_ingredients: [],
  meal_plans: ['is_favourite'],
  meal_plan_items: [],
  food_items: ['is_drink'],
  exercise_favourites: [],
  day_status: [],
  cardio_sessions: [],
  train_widgets: ['visible'],
};

// Postgres array/jsonb columns stored as JSON text locally.
export const ARRAY_COLUMNS: Record<SyncedTable, string[]> = {
  exercises: ['secondary_muscles'],
  routine_folders: [],
  routines: [],
  routine_exercises: ['target_reps', 'target_weights', 'target_types'],
  routine_folder_assignments: [],
  workouts: [],
  workout_sets: [],
  personal_records: [],
  body_measurements: [],
  nutrition_entries: [],
  liquid_entries: [],
  meals: ['method', 'tags'],
  meal_ingredients: [],
  meal_plans: ['tags'],
  meal_plan_items: [],
  food_items: ['per100g'],
  exercise_favourites: [],
  day_status: [],
  cardio_sessions: [], // zone_minutes stays TEXT remotely - opaque JSON
  train_widgets: ['config'],
};

// Tables carrying their own user_id. Child tables (routine_exercises,
// workout_sets, routine_folder_assignments, meal_ingredients,
// meal_plan_items) have no user_id - ownership is enforced transitively by
// RLS via the parent row, so they pull/push unscoped.
export const DIRECT_OWNED: ReadonlySet<SyncedTable> = new Set([
  'routine_folders',
  'routines',
  'workouts',
  'personal_records',
  'body_measurements',
  'nutrition_entries',
  'liquid_entries',
  'meals',
  'meal_plans',
  'food_items',
  'exercise_favourites',
  'day_status',
  'cardio_sessions',
  'train_widgets',
]);

// Extra WHERE fragments for the dirty-row select. The built-in exercise
// library lives server-side (pulled, never pushed); example routines are
// local-only templates - neither they nor their children ever leave the
// device.
export const PUSH_FILTER: Partial<Record<SyncedTable, string>> = {
  exercises: 'AND is_custom = 1 AND created_by IS NOT NULL',
  routines: 'AND is_template = 0',
  routine_exercises:
    'AND routine_id NOT IN (SELECT id FROM routines WHERE is_template = 1)',
  routine_folder_assignments:
    'AND routine_id NOT IN (SELECT id FROM routines WHERE is_template = 1)',
  // __meta__ / __all_seed__ are local widget-schema markers - not user data.
  train_widgets: "AND id NOT IN ('__meta__', '__all_seed__')",
};

// Parent -> child foreign keys. Used when a pushed row collides with a cloud
// copy owned by a different account: the local row gets a fresh id and every
// child reference follows it, so the data re-uploads under the new owner.
export const CHILD_FKS: Partial<Record<SyncedTable, { table: string; fk: string }[]>> = {
  routines: [
    { table: 'routine_exercises', fk: 'routine_id' },
    { table: 'routine_folder_assignments', fk: 'routine_id' },
    { table: 'workouts', fk: 'routine_id' },
  ],
  exercises: [
    { table: 'routine_exercises', fk: 'exercise_id' },
    { table: 'workout_sets', fk: 'exercise_id' },
    { table: 'exercise_favourites', fk: 'exercise_id' },
    { table: 'personal_records', fk: 'exercise_id' },
  ],
  workouts: [
    { table: 'workout_sets', fk: 'workout_id' },
    { table: 'personal_records', fk: 'workout_id' },
  ],
  meals: [
    { table: 'meal_ingredients', fk: 'meal_id' },
    { table: 'meal_plan_items', fk: 'meal_id' },
  ],
  meal_plans: [{ table: 'meal_plan_items', fk: 'plan_id' }],
  nutrition_entries: [{ table: 'liquid_entries', fk: 'nutrition_id' }],
};

export const LOCAL_ONLY = new Set(['dirty']);

// Canonical local columns per synced table (schema.ts). Remote rows may carry
// unexpected keys - pull only writes columns that exist locally.
export const TABLE_COLUMNS: Record<SyncedTable, ReadonlySet<string>> = {
  // is_favourite stays out: it is per-user state synced via
  // exercise_favourites, not a field on the shared library row.
  exercises: new Set([
    'id', 'created_by', 'name', 'target_muscle', 'secondary_muscles',
    'equipment', 'tracking_type', 'instructions', 'is_custom',
    'github_image_id', 'updated_at', 'deleted_at', 'dirty',
  ]),
  routine_folders: new Set([
    'id', 'user_id', 'name', 'sort_order', 'updated_at', 'deleted_at', 'dirty',
  ]),
  // is_template is local-only: templates never push and pulls leave it alone.
  routines: new Set([
    'id', 'user_id', 'title', 'notes', 'folder_name', 'sort_order',
    'parent_routine_id', 'archived_at',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  routine_exercises: new Set([
    'id', 'routine_id', 'exercise_id', 'superset_id', 'order_index',
    'rest_seconds', 'target_sets', 'target_reps', 'target_weights',
    'target_types', 'notes',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  routine_folder_assignments: new Set([
    'id', 'routine_id', 'folder_name',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  workouts: new Set([
    'id', 'user_id', 'routine_id', 'title', 'notes', 'started_at',
    'completed_at', 'duration_seconds', 'total_volume_kg', 'is_completed',
    'feel', 'archived_at', 'updated_at', 'deleted_at', 'dirty',
  ]),
  workout_sets: new Set([
    'id', 'workout_id', 'exercise_id', 'superset_id', 'set_order', 'set_type',
    'weight_kg', 'reps', 'rpe', 'duration_seconds', 'distance_m', 'avg_hr',
    'meta', 'is_completed', 'updated_at', 'deleted_at', 'dirty',
  ]),
  personal_records: new Set([
    'id', 'user_id', 'exercise_id', 'record_type', 'value', 'achieved_at',
    'workout_id', 'updated_at', 'deleted_at', 'dirty',
  ]),
  body_measurements: new Set([
    'id', 'user_id', 'metric_type', 'value', 'logged_at',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  nutrition_entries: new Set([
    'id', 'user_id', 'logged_on', 'name', 'calories', 'protein_g', 'carbs_g',
    'fat_g', 'sugar_g', 'is_drink', 'serving', 'barcode', 'source',
    'external_id', 'updated_at', 'deleted_at', 'dirty',
  ]),
  liquid_entries: new Set([
    'id', 'user_id', 'logged_on', 'name', 'kind', 'amount_ml', 'calories',
    'sugar_g', 'nutrition_id', 'external_id', 'updated_at', 'deleted_at', 'dirty',
  ]),
  meals: new Set([
    'id', 'user_id', 'name', 'description', 'servings', 'method', 'tags',
    'source_url', 'pitch', 'minutes', 'goal', 'meal_type', 'image_uri',
    'is_favourite', 'sort_order', 'updated_at', 'deleted_at', 'dirty',
  ]),
  meal_ingredients: new Set([
    'id', 'meal_id', 'name', 'quantity', 'unit', 'calories', 'protein_g',
    'carbs_g', 'fat_g', 'barcode', 'sort_order',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  meal_plans: new Set([
    'id', 'user_id', 'name', 'description', 'days', 'pitch', 'goal', 'tags',
    'is_favourite', 'sort_order', 'updated_at', 'deleted_at', 'dirty',
  ]),
  meal_plan_items: new Set([
    'id', 'plan_id', 'meal_id', 'day_index', 'slot', 'servings', 'sort_order',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  food_items: new Set([
    'id', 'user_id', 'barcode', 'name', 'brand', 'serving', 'calories',
    'protein_g', 'carbs_g', 'fat_g', 'sugar_g', 'is_drink', 'per100g',
    'image_url', 'last_used_at', 'updated_at', 'deleted_at', 'dirty',
  ]),
  exercise_favourites: new Set([
    'id', 'user_id', 'exercise_id',
    'updated_at', 'deleted_at', 'dirty',
  ]),
  day_status: new Set([
    'id', 'user_id', 'date', 'status', 'updated_at', 'deleted_at', 'dirty',
  ]),
  cardio_sessions: new Set([
    'id', 'user_id', 'external_id', 'activity', 'distance_m',
    'duration_seconds', 'avg_hr', 'max_hr', 'zone_minutes', 'calories',
    'meta', 'source', 'started_at', 'notes', 'updated_at', 'deleted_at', 'dirty',
  ]),
  train_widgets: new Set([
    'id', 'user_id', 'widget_type', 'config', 'size', 'sort_order', 'visible',
    'updated_at', 'deleted_at', 'dirty',
  ]),
};

export type Row = Record<string, unknown>;

/** Whitelisted remote payload for one local row - exported for tests. */
export function remotePayload(table: string, row: Row): Row {
  const t = table as SyncedTable;
  const remote = toRemote(t, row);
  const out: Row = {};
  for (const col of TABLE_COLUMNS[t] ?? []) {
    if (col !== 'dirty' && col in remote) out[col] = remote[col];
  }
  return out;
}

export function toRemote(table: SyncedTable, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (LOCAL_ONLY.has(k)) continue;
    out[k] = v;
  }
  for (const col of BOOL_COLUMNS[table]) {
    if (out[col] != null) out[col] = out[col] === 1;
  }
  for (const col of ARRAY_COLUMNS[table]) {
    if (typeof out[col] === 'string') out[col] = JSON.parse(out[col] as string);
  }
  return out;
}

export function toLocal(table: SyncedTable, row: Row): Row {
  const out: Row = { ...row };
  for (const col of BOOL_COLUMNS[table]) {
    if (out[col] != null) out[col] = out[col] === true ? 1 : 0;
  }
  for (const col of ARRAY_COLUMNS[table]) {
    // Covers both text[] arrays and jsonb objects (train_widgets.config,
    // food_items.per100g).
    if (out[col] != null && typeof out[col] === 'object') out[col] = JSON.stringify(out[col]);
  }
  // Normalize Postgres timestamptz (+00:00) to JS ISO (Z) so local string
  // comparisons stay monotonic.
  for (const col of ['updated_at', 'deleted_at', 'created_at', 'started_at', 'completed_at', 'achieved_at', 'logged_at', 'last_used_at', 'archived_at']) {
    if (typeof out[col] === 'string') out[col] = new Date(out[col] as string).toISOString();
  }
  out.dirty = 0;
  return out;
}

