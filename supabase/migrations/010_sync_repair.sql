-- ============================================================================
-- Migration 010 — sync repair + new synced tables
--
-- Fixes a chain of sync failures:
--   1. The global exercise library was never seeded remotely, so every push of
--      routine_exercises / workout_sets / personal_records died on the
--      exercise_id FK — and one failing table aborted the whole sync cycle.
--   2. Several columns exist locally but not remotely (meals.pitch/minutes/goal,
--      meal_plans.pitch/goal/tags, workouts.archived_at, exercises.is_favourite
--      /github_image_id) — the pusher sent SELECT *, so those also hard-failed.
--   3. Example routines were claimed per-user and pushed — one redundant copy
--      of every example per account. They are now local-only templates, so the
--      pushed copies are deleted here.
--
-- Adds synced tables: food_items (scanned barcode library),
-- exercise_favourites (favourites on the global library), train_widgets
-- (Train-tab layout) and routine_folder_assignments.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Global exercise library — same ids as the bundled local seed so local
--    routine/workout rows resolve their FKs and pull merges by id.
-- ----------------------------------------------------------------------------
insert into public.exercises (id, name, target_muscle, secondary_muscles, equipment) values
('e0000000-0000-4000-8000-000000000001', 'Barbell Bench Press', 'Chest', '{"Triceps","Shoulders"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000002', 'Incline Barbell Bench Press', 'Chest', '{"Triceps","Shoulders"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000003', 'Dumbbell Bench Press', 'Chest', '{"Triceps","Shoulders"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000004', 'Incline Dumbbell Press', 'Chest', '{"Triceps","Shoulders"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000005', 'Cable Fly', 'Chest', '{"Shoulders"}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000006', 'Chest Dip', 'Chest', '{"Triceps","Shoulders"}'::text[], 'bodyweight'),
('e0000000-0000-4000-8000-000000000007', 'Push-Up', 'Chest', '{"Triceps","Shoulders"}'::text[], 'bodyweight'),
('e0000000-0000-4000-8000-000000000008', 'Machine Chest Press', 'Chest', '{"Triceps"}'::text[], 'machine'),
('e0000000-0000-4000-8000-000000000009', 'Conventional Deadlift', 'Back', '{"Glutes","Hamstrings","Traps"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000010', 'Sumo Deadlift', 'Back', '{"Glutes","Hamstrings"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000011', 'Barbell Row', 'Back', '{"Biceps","Lats"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000012', 'Pull-Up', 'Back', '{"Biceps","Lats"}'::text[], 'bodyweight'),
('e0000000-0000-4000-8000-000000000013', 'Chin-Up', 'Back', '{"Biceps"}'::text[], 'bodyweight'),
('e0000000-0000-4000-8000-000000000014', 'Lat Pulldown', 'Back', '{"Biceps"}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000015', 'Seated Cable Row', 'Back', '{"Biceps","Lats"}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000016', 'Single-Arm Dumbbell Row', 'Back', '{"Biceps","Lats"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000017', 'T-Bar Row', 'Back', '{"Biceps","Lats"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000018', 'Face Pull', 'Shoulders', '{"Rear Delts","Traps"}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000019', 'Overhead Press', 'Shoulders', '{"Triceps"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000020', 'Dumbbell Shoulder Press', 'Shoulders', '{"Triceps"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000021', 'Lateral Raise', 'Shoulders', '{}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000022', 'Rear Delt Fly', 'Shoulders', '{"Traps"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000023', 'Barbell Shrug', 'Traps', '{"Shoulders"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000024', 'Machine Shoulder Press', 'Shoulders', '{"Triceps"}'::text[], 'machine'),
('e0000000-0000-4000-8000-000000000025', 'Barbell Back Squat', 'Quads', '{"Glutes","Hamstrings"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000026', 'Front Squat', 'Quads', '{"Glutes","Core"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000027', 'Romanian Deadlift', 'Hamstrings', '{"Glutes","Lower Back"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000028', 'Leg Press', 'Quads', '{"Glutes"}'::text[], 'machine'),
('e0000000-0000-4000-8000-000000000029', 'Walking Lunge', 'Quads', '{"Glutes","Hamstrings"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000030', 'Leg Extension', 'Quads', '{}'::text[], 'machine'),
('e0000000-0000-4000-8000-000000000031', 'Lying Leg Curl', 'Hamstrings', '{}'::text[], 'machine'),
('e0000000-0000-4000-8000-000000000032', 'Hip Thrust', 'Glutes', '{"Hamstrings"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000033', 'Standing Calf Raise', 'Calves', '{}'::text[], 'machine'),
('e0000000-0000-4000-8000-000000000034', 'Bulgarian Split Squat', 'Quads', '{"Glutes"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000035', 'Barbell Curl', 'Biceps', '{"Forearms"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000036', 'Dumbbell Curl', 'Biceps', '{"Forearms"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000037', 'Hammer Curl', 'Biceps', '{"Forearms"}'::text[], 'dumbbell'),
('e0000000-0000-4000-8000-000000000038', 'Preacher Curl', 'Biceps', '{}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000039', 'Tricep Pushdown', 'Triceps', '{}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000040', 'Overhead Tricep Extension', 'Triceps', '{}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000041', 'Close-Grip Bench Press', 'Triceps', '{"Chest"}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000042', 'Skullcrusher', 'Triceps', '{}'::text[], 'barbell'),
('e0000000-0000-4000-8000-000000000043', 'Plank', 'Core', '{}'::text[], 'bodyweight'),
('e0000000-0000-4000-8000-000000000044', 'Hanging Leg Raise', 'Core', '{"Hip Flexors"}'::text[], 'bodyweight'),
('e0000000-0000-4000-8000-000000000045', 'Cable Crunch', 'Core', '{}'::text[], 'cable'),
('e0000000-0000-4000-8000-000000000046', 'Ab Wheel Rollout', 'Core', '{}'::text[], 'other')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Missing remote columns the app already writes locally
-- ----------------------------------------------------------------------------
alter table public.exercises
  add column if not exists is_favourite boolean not null default false,
  add column if not exists github_image_id text;

alter table public.workouts
  add column if not exists archived_at timestamptz;

alter table public.meals
  add column if not exists pitch text,
  add column if not exists minutes integer,
  add column if not exists goal text;

alter table public.meal_plans
  add column if not exists pitch text,
  add column if not exists goal text,
  add column if not exists tags text[] not null default '{}';

-- Tombstone-friendly uniques: a soft-deleted row must not block re-adding the
-- same natural key. Replace the table-level constraints with partial indexes.
alter table public.day_status
  drop constraint if exists day_status_user_id_date_key;
create unique index if not exists day_status_user_date_key
  on public.day_status (user_id, date) where deleted_at is null;

alter table public.routine_folders
  drop constraint if exists routine_folders_user_id_name_key;
create unique index if not exists routine_folders_user_name_key
  on public.routine_folders (user_id, name) where deleted_at is null;

-- cardio's unique was created as a partial index, not a table constraint.
drop index if exists public.cardio_sessions_external_idx;
create unique index if not exists cardio_sessions_external_idx
  on public.cardio_sessions (user_id, external_id)
  where external_id is not null and deleted_at is null;

-- ----------------------------------------------------------------------------
-- 3. Remove the per-user copies of bundled example routines. The app now keeps
--    them as local-only templates (is_template), so nothing is lost on device.
--    routine_exercises rows cascade via the routine_id FK.
-- ----------------------------------------------------------------------------
delete from public.routines where folder_name like 'Examples ·%';

-- ----------------------------------------------------------------------------
-- 4. food_items — persisted barcode scan results ("scan once, reuse forever")
-- ----------------------------------------------------------------------------
create table if not exists public.food_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  barcode      text not null,
  name         text not null,
  brand        text,
  serving      text,
  calories     real not null default 0,
  protein_g    real not null default 0,
  carbs_g      real not null default 0,
  fat_g        real not null default 0,
  per100g      jsonb not null default '{}',
  last_used_at timestamptz,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
-- Partial unique: tombstoned rows don't block re-adding the same barcode.
create unique index if not exists food_items_user_barcode_key
  on public.food_items (user_id, barcode) where deleted_at is null;
create index if not exists food_items_user_idx on public.food_items (user_id, last_used_at desc);
drop trigger if exists food_items_set_updated_at on public.food_items;
create trigger food_items_set_updated_at before update on public.food_items
  for each row execute function public.set_updated_at();
alter table public.food_items enable row level security;
drop policy if exists food_items_all_own on public.food_items;
create policy food_items_all_own on public.food_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5. exercise_favourites — per-user favourite flags on the shared library
-- ----------------------------------------------------------------------------
create table if not exists public.exercise_favourites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists exercise_favourites_user_ex_key
  on public.exercise_favourites (user_id, exercise_id) where deleted_at is null;
create index if not exists exercise_favourites_user_idx on public.exercise_favourites (user_id);
drop trigger if exists exercise_favourites_set_updated_at on public.exercise_favourites;
create trigger exercise_favourites_set_updated_at before update on public.exercise_favourites
  for each row execute function public.set_updated_at();
alter table public.exercise_favourites enable row level security;
drop policy if exists exercise_favourites_all_own on public.exercise_favourites;
create policy exercise_favourites_all_own on public.exercise_favourites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 6. routine_folder_assignments — child of routines (RLS via parent)
-- ----------------------------------------------------------------------------
create table if not exists public.routine_folder_assignments (
  id          uuid primary key default gen_random_uuid(),
  routine_id  uuid not null references public.routines (id) on delete cascade,
  folder_name text not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists routine_folder_assignments_key
  on public.routine_folder_assignments (routine_id, folder_name) where deleted_at is null;
create index if not exists routine_folder_assignments_routine_idx
  on public.routine_folder_assignments (routine_id);
drop trigger if exists routine_folder_assignments_set_updated_at on public.routine_folder_assignments;
create trigger routine_folder_assignments_set_updated_at before update on public.routine_folder_assignments
  for each row execute function public.set_updated_at();
alter table public.routine_folder_assignments enable row level security;
drop policy if exists routine_folder_assignments_all_own on public.routine_folder_assignments;
create policy routine_folder_assignments_all_own on public.routine_folder_assignments
  for all
  using (exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.routines r where r.id = routine_id and r.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 7. train_widgets — Train-tab widget layout. Local ids are plain strings, so
--    the remote id is text (not uuid).
-- ----------------------------------------------------------------------------
create table if not exists public.train_widgets (
  id          text not null,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  widget_type text not null,
  config      jsonb not null default '{}',
  size        text not null default '2x1',
  sort_order  integer not null default 0,
  visible     boolean not null default true,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  -- ids are deterministic strings shared by all users ('w_0_quick_start', …),
  -- so uniqueness must be scoped per user or upserts collide cross-account.
  primary key (user_id, id)
);
create index if not exists train_widgets_user_idx on public.train_widgets (user_id, sort_order);
drop trigger if exists train_widgets_set_updated_at on public.train_widgets;
create trigger train_widgets_set_updated_at before update on public.train_widgets
  for each row execute function public.set_updated_at();
alter table public.train_widgets enable row level security;
drop policy if exists train_widgets_all_own on public.train_widgets;
create policy train_widgets_all_own on public.train_widgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
