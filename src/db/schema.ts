/**
 * Local SQLite DDL. Mirrors the Supabase schema with additions required by the
 * offline-first merge engine:
 *   dirty      INTEGER 1 = row needs to be pushed
 *   updated_at TEXT    ISO-8601, stamped on every local mutation
 *   deleted_at TEXT    soft-delete tombstone (propagates to cloud as a row)
 *   user_id    TEXT    NULL while the owner is a guest; claimed on account link
 *
 * secondary_muscles is stored as a JSON array string (SQLite has no TEXT[]).
 */
export const LOCAL_SCHEMA_VERSION = 3;

export const LOCAL_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Guest settings live locally; merged into profiles on account link.
CREATE TABLE IF NOT EXISTS local_profile (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  display_name       TEXT,
  weight_unit        TEXT NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg','lbs')),
  default_bar_weight REAL NOT NULL DEFAULT 20,
  has_void_pro       INTEGER NOT NULL DEFAULT 0,
  void_tier          TEXT NOT NULL DEFAULT 'free' CHECK (void_tier IN ('free','pro','promax')),
  -- void_pro_owner: which account this device's entitlement belongs to.
  -- NULL = unclaimed device/guest purchase - claims to the first signed-in
  -- account on push; bound purchases (appAccountToken) can't be claimed by
  -- a different account.
  void_pro_owner     TEXT,
  supabase_user_id   TEXT,
  -- Body profile fields (see migrateColumns - kept in sync so fresh installs
  -- and upgraded databases converge on the same column set).
  height_cm          REAL,
  birth_year         INTEGER,
  sex                TEXT,
  activity_level     TEXT NOT NULL DEFAULT 'moderate',
  goal               TEXT NOT NULL DEFAULT 'maintain',
  calorie_override   INTEGER,
  water_target_ml    INTEGER,
  health_connected   INTEGER NOT NULL DEFAULT 0,
  fitbit_connected   INTEGER NOT NULL DEFAULT 0,
  last_sync_at       TEXT,
  last_sync_error    TEXT,
  last_health_import_at TEXT,
  -- Free-tier health-import quota: Monday key (YYYY-MM-DD) + runs this week.
  health_import_week TEXT,
  health_import_count INTEGER NOT NULL DEFAULT 0,
  -- Focus/intent system (local-only, never synced).
  primary_goal       TEXT,
  unlock_speed       TEXT NOT NULL DEFAULT 'all_at_once',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  active_intents     TEXT NOT NULL DEFAULT '[]',
  unlocked_modules   TEXT NOT NULL DEFAULT '["lift","habits"]',
  seeded_intents     TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id                TEXT PRIMARY KEY,
  created_by        TEXT,
  name              TEXT NOT NULL,
  target_muscle     TEXT NOT NULL,
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  equipment         TEXT NOT NULL,
  -- How a set of this exercise is logged: 'strength' (weight+reps, default),
  -- 'cardio' (distance/duration/HR - also mirrors into cardio_sessions),
  -- 'hold' (timed hold, e.g. planks/stretches), 'carry' (weight + distance
  -- or duration, e.g. farmer's walk).
  tracking_type     TEXT NOT NULL DEFAULT 'strength',
  instructions      TEXT,
  is_custom         INTEGER NOT NULL DEFAULT 0,
  is_favourite      INTEGER NOT NULL DEFAULT 0,
  github_image_id   TEXT,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  dirty             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle ON exercises (target_muscle);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON exercises (equipment);

CREATE TABLE IF NOT EXISTS routine_folders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty      INTEGER NOT NULL DEFAULT 1
);

-- is_template marks bundled example routines: rendered locally, never
-- claimed, pushed or pulled.
CREATE TABLE IF NOT EXISTS routines (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  title       TEXT NOT NULL,
  notes       TEXT,
  folder_name TEXT NOT NULL DEFAULT 'My Routines',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  -- is_shared: pulled routine owned by someone else that I collaborate on.
  -- Local-only (never in the remote column map); keeps the owner's user_id.
  is_shared   INTEGER NOT NULL DEFAULT 0,
  -- parent_routine_id: when set this row is a tab (sub-routine) of the parent
  -- routine. Tabs don't appear in top-level lists; their exercises live in
  -- routine_exercises like any routine. Synced remotely.
  parent_routine_id TEXT REFERENCES routines (id) ON DELETE CASCADE,
  -- archived_at: delete moves a routine here for 28 days before the purge
  -- tombstones it - same pattern as workouts.archived_at.
  archived_at TEXT,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_routines_folder ON routines (folder_name, sort_order);

CREATE TABLE IF NOT EXISTS routine_exercises (
  id           TEXT PRIMARY KEY,
  routine_id   TEXT NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
  exercise_id  TEXT NOT NULL REFERENCES exercises (id) ON DELETE RESTRICT,
  superset_id  TEXT,
  order_index  INTEGER NOT NULL,
  rest_seconds INTEGER NOT NULL DEFAULT 120,
  target_sets  INTEGER NOT NULL DEFAULT 3,
  target_reps  TEXT NOT NULL DEFAULT '[]',
  target_weights TEXT NOT NULL DEFAULT '[]',
  target_types TEXT NOT NULL DEFAULT '[]',
  notes        TEXT,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  dirty        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine ON routine_exercises (routine_id, order_index);

CREATE TABLE IF NOT EXISTS workouts (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  routine_id       TEXT REFERENCES routines (id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Workout',
  notes            TEXT,
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  duration_seconds INTEGER,
  total_volume_kg  REAL NOT NULL DEFAULT 0,
  is_completed     INTEGER NOT NULL DEFAULT 0,
  feel             INTEGER, -- 1-5 session rating set on the finish summary
  archived_at      TEXT,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  dirty            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_workouts_started ON workouts (started_at DESC);

CREATE TABLE IF NOT EXISTS workout_sets (
  id           TEXT PRIMARY KEY,
  workout_id   TEXT NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  exercise_id  TEXT NOT NULL REFERENCES exercises (id) ON DELETE RESTRICT,
  superset_id  TEXT,
  set_order    INTEGER NOT NULL,
  set_type     TEXT NOT NULL DEFAULT 'normal'
               CHECK (set_type IN ('normal','warmup','drop','failure')),
  weight_kg    REAL,
  reps         INTEGER,
  rpe          REAL,
  -- Non-strength tracking (cardio/hold/carry) - all nullable, unused by
  -- ordinary weight+reps sets.
  duration_seconds INTEGER,
  distance_m       REAL,
  avg_hr           INTEGER,
  -- JSON bag of optional per-set extras (incline_pct, resistance, ...).
  meta         TEXT,
  is_completed INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  dirty        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_workout_sets_workout ON workout_sets (workout_id, set_order);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets (exercise_id);

CREATE TABLE IF NOT EXISTS personal_records (
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
CREATE INDEX IF NOT EXISTS idx_pr_user_ex ON personal_records (user_id, exercise_id, record_type);

CREATE TABLE IF NOT EXISTS body_measurements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  metric_type TEXT NOT NULL,
  value       REAL NOT NULL,
  logged_at   TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_bm_user_metric ON body_measurements (user_id, metric_type, logged_at DESC);

-- Cardio sessions - runs, rides, swims etc. Distance canonical in metres.
-- zone_minutes is a JSON array [z1..z5] of minutes spent per HR zone.
-- external_id dedupes health-platform imports (e.g. 'hk:<uuid>').
CREATE TABLE IF NOT EXISTS cardio_sessions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  external_id      TEXT UNIQUE,
  activity         TEXT NOT NULL,
  distance_m       REAL,
  duration_seconds INTEGER NOT NULL,
  avg_hr           INTEGER,
  max_hr           INTEGER,
  zone_minutes     TEXT,
  calories         INTEGER,
  -- JSON bag of activity extras (incline_pct, stroke_rate, ...).
  meta             TEXT,
  source           TEXT NOT NULL DEFAULT 'manual',
  started_at       TEXT NOT NULL,
  notes            TEXT,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  dirty            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cardio_started ON cardio_sessions (started_at DESC);

-- Food / calorie log. One row per item eaten; logged_on is the local
-- calendar day (YYYY-MM-DD) so "today" queries are timezone-safe.
CREATE TABLE IF NOT EXISTS nutrition_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  logged_on   TEXT NOT NULL,
  name        TEXT NOT NULL,
  calories    REAL NOT NULL DEFAULT 0,
  protein_g   REAL NOT NULL DEFAULT 0,
  carbs_g     REAL NOT NULL DEFAULT 0,
  fat_g       REAL NOT NULL DEFAULT 0,
  sugar_g     REAL NOT NULL DEFAULT 0,
  is_drink    INTEGER NOT NULL DEFAULT 0,
  serving     TEXT,
  barcode     TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_nutrition_day ON nutrition_entries (user_id, logged_on DESC);

-- Liquid intake (water, soda, coffee, …). logged_on matches nutrition_entries
-- (local calendar day). calories is 0 for water; sugary drinks count into the
-- day totals. amount_ml is the canonical volume.
CREATE TABLE IF NOT EXISTS liquid_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  logged_on   TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'water',
  amount_ml   REAL NOT NULL DEFAULT 0,
  calories    REAL NOT NULL DEFAULT 0,
  sugar_g     REAL NOT NULL DEFAULT 0,
  -- Links a hydration shadow row to its nutrition_entries row so deleting
  -- the drink can cascade. Plain TEXT (no FK): pull order isn't guaranteed.
  nutrition_id TEXT,
  -- Dedupes health-platform imports (e.g. 'ghealth:<dp-id>').
  external_id TEXT,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_liquid_day ON liquid_entries (user_id, logged_on DESC);

-- Meals (recipes). Ingredient macros are stored per ingredient for the
-- quantity listed; per-serving values are derived at read time.
CREATE TABLE IF NOT EXISTS meals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  name         TEXT NOT NULL,
  description  TEXT,
  servings     REAL NOT NULL DEFAULT 1,
  method       TEXT NOT NULL DEFAULT '[]',
  tags         TEXT NOT NULL DEFAULT '[]',
  source_url   TEXT,
  pitch        TEXT,
  minutes      INTEGER,
  goal         TEXT,
  meal_type    TEXT,
  image_uri    TEXT,
  is_favourite INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  dirty        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id          TEXT PRIMARY KEY,
  meal_id     TEXT NOT NULL REFERENCES meals (id),
  name        TEXT NOT NULL,
  quantity    REAL,
  unit        TEXT,
  calories    REAL NOT NULL DEFAULT 0,
  protein_g   REAL NOT NULL DEFAULT 0,
  carbs_g     REAL NOT NULL DEFAULT 0,
  fat_g       REAL NOT NULL DEFAULT 0,
  barcode     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_meal_ingredients_meal ON meal_ingredients (meal_id, sort_order);

CREATE TABLE IF NOT EXISTS meal_plans (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  name         TEXT NOT NULL,
  description  TEXT,
  days         INTEGER NOT NULL DEFAULT 7,
  pitch        TEXT,
  goal         TEXT,
  tags         TEXT NOT NULL DEFAULT '[]',
  is_favourite INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  dirty        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meal_plan_items (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES meal_plans (id),
  meal_id     TEXT NOT NULL REFERENCES meals (id),
  day_index   INTEGER NOT NULL,
  slot        TEXT NOT NULL,
  servings    REAL NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_items_plan ON meal_plan_items (plan_id, day_index, sort_order);

CREATE TABLE IF NOT EXISTS day_status (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  date        TEXT NOT NULL, -- YYYY-MM-DD
  status      TEXT NOT NULL CHECK (status IN ('rest','missed')),
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_day_status_date ON day_status (date);

-- Scanned barcode results - persisted so a product is only ever looked up
-- once (offline rescans hit this table). per100g is a JSON object string.
CREATE TABLE IF NOT EXISTS food_items (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  barcode      TEXT NOT NULL,
  name         TEXT NOT NULL,
  brand        TEXT,
  serving      TEXT,
  calories     REAL NOT NULL DEFAULT 0,
  protein_g    REAL NOT NULL DEFAULT 0,
  carbs_g      REAL NOT NULL DEFAULT 0,
  fat_g        REAL NOT NULL DEFAULT 0,
  sugar_g      REAL NOT NULL DEFAULT 0,
  is_drink     INTEGER NOT NULL DEFAULT 0,
  per100g      TEXT NOT NULL DEFAULT '{}',
  image_url    TEXT,
  last_used_at TEXT,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  dirty        INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_items_barcode
  ON food_items (COALESCE(user_id, ''), barcode) WHERE deleted_at IS NULL;

-- Per-user favourites on the shared exercise library.
CREATE TABLE IF NOT EXISTS exercise_favourites (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  exercise_id TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_favourites_key
  ON exercise_favourites (COALESCE(user_id, ''), exercise_id) WHERE deleted_at IS NULL;

-- Many-to-many: routines can be in multiple folders
CREATE TABLE IF NOT EXISTS routine_folder_assignments (
  id          TEXT PRIMARY KEY,
  routine_id  TEXT NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (routine_id, folder_name)
);
CREATE INDEX IF NOT EXISTS idx_routine_folder_assignments ON routine_folder_assignments (routine_id, folder_name);

-- Per-table high-water mark for incremental cloud pulls.
CREATE TABLE IF NOT EXISTS sync_meta (
  table_name   TEXT PRIMARY KEY,
  last_pull_at TEXT
);

-- Train-tab widget layout. Each row is one widget tile on the home page.
-- config is JSON for widget-specific data (e.g. routineId, folderName).
CREATE TABLE IF NOT EXISTS train_widgets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  widget_type TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',
  size        TEXT NOT NULL DEFAULT '2x1',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  dirty       INTEGER NOT NULL DEFAULT 1
);
`;
