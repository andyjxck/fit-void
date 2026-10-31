-- ============================================================================
-- GYM VOID — Initial schema migration (001_init.sql)
-- Target: Supabase PostgreSQL. Safe to paste into the SQL editor or apply via
-- `supabase db push`.
--
-- Sync contract: every user-owned table carries `updated_at` (maintained by
-- trigger) and `deleted_at` (soft-delete tombstone). The local SQLite merge
-- engine pulls `WHERE updated_at > last_pull_at` and pushes dirty rows as
-- upserts — including tombstones, which are upserted rather than hard-deleted
-- so last-write-wins stays correct across devices. A periodic purge job can
-- hard-delete rows whose deleted_at is older than N days (not included here).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- updated_at trigger function (shared by all tables)
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — 1:1 with auth.users
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           text unique,
  display_name       text,
  weight_unit        text not null default 'kg' check (weight_unit in ('kg', 'lbs')),
  default_bar_weight numeric not null default 20,
  has_void_pro       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- exercises — global library (created_by IS NULL) + user customs
-- ----------------------------------------------------------------------------
create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid references public.profiles (id) on delete cascade,
  name              text not null,
  target_muscle     text not null,
  secondary_muscles text[] not null default '{}',
  equipment         text not null check (equipment in (
                      'barbell', 'dumbbell', 'cable', 'machine',
                      'bodyweight', 'kettlebell', 'band', 'other')),
  instructions      text,
  is_custom         boolean not null default false,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index exercises_target_muscle_idx on public.exercises (target_muscle);
create index exercises_equipment_idx     on public.exercises (equipment);
create index exercises_global_idx        on public.exercises (id) where created_by is null;
create index exercises_created_by_idx    on public.exercises (created_by) where created_by is not null;
create index exercises_updated_at_idx    on public.exercises (updated_at);

create trigger exercises_set_updated_at
  before update on public.exercises
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- routine_folders — named folders for organizing routine templates
-- ----------------------------------------------------------------------------
create table public.routine_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);

create index routine_folders_user_idx on public.routine_folders (user_id, sort_order);

create trigger routine_folders_set_updated_at
  before update on public.routine_folders
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- routines
-- ----------------------------------------------------------------------------
create table public.routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  notes       text,
  folder_name text not null default 'My Routines',
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index routines_user_id_idx   on public.routines (user_id, folder_name, sort_order);
create index routines_updated_at_idx on public.routines (updated_at);

create trigger routines_set_updated_at
  before update on public.routines
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- routine_exercises — template rows inside a routine
-- ----------------------------------------------------------------------------
create table public.routine_exercises (
  id           uuid primary key default gen_random_uuid(),
  routine_id   uuid not null references public.routines (id) on delete cascade,
  exercise_id  uuid not null references public.exercises (id) on delete restrict,
  superset_id  uuid,
  order_index  integer not null,
  rest_seconds integer not null default 120,
  target_sets  integer not null default 3,
  target_reps  integer[] not null default '{}', -- per-set rep targets, e.g. {12,10,8,6}
  notes        text,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index routine_exercises_routine_idx  on public.routine_exercises (routine_id, order_index);
create index routine_exercises_updated_idx  on public.routine_exercises (updated_at);

create trigger routine_exercises_set_updated_at
  before update on public.routine_exercises
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- workouts — logged sessions
-- ----------------------------------------------------------------------------
create table public.workouts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  routine_id       uuid references public.routines (id) on delete set null,
  title            text not null default 'Workout',
  notes            text,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  duration_seconds integer,
  total_volume_kg  numeric not null default 0,
  is_completed     boolean not null default false,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index workouts_user_started_idx on public.workouts (user_id, started_at desc);
create index workouts_updated_at_idx   on public.workouts (updated_at);

create trigger workouts_set_updated_at
  before update on public.workouts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- workout_sets — individual sets inside a session
-- ----------------------------------------------------------------------------
create table public.workout_sets (
  id           uuid primary key default gen_random_uuid(),
  workout_id   uuid not null references public.workouts (id) on delete cascade,
  exercise_id  uuid not null references public.exercises (id) on delete restrict,
  superset_id  uuid,
  set_order    integer not null,
  set_type     text not null default 'normal'
               check (set_type in ('normal', 'warmup', 'drop', 'failure')),
  weight_kg    numeric,
  reps         integer,
  rpe          numeric check (rpe is null or (rpe >= 0 and rpe <= 10)),
  is_completed boolean not null default false,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index workout_sets_workout_idx   on public.workout_sets (workout_id, set_order);
create index workout_sets_exercise_idx  on public.workout_sets (exercise_id);
create index workout_sets_updated_idx   on public.workout_sets (updated_at);

create trigger workout_sets_set_updated_at
  before update on public.workout_sets
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- personal_records
-- ----------------------------------------------------------------------------
create table public.personal_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  record_type text not null check (record_type in ('1rm', 'max_weight', 'max_volume')),
  value       numeric not null,
  achieved_at timestamptz not null default now(),
  workout_id  uuid references public.workouts (id) on delete set null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index personal_records_user_ex_idx on public.personal_records (user_id, exercise_id, record_type);
create index personal_records_updated_idx on public.personal_records (updated_at);

create trigger personal_records_set_updated_at
  before update on public.personal_records
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- body_measurements
-- ----------------------------------------------------------------------------
create table public.body_measurements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  metric_type text not null check (metric_type in (
                'weight', 'body_fat', 'waist', 'chest', 'arm', 'thigh')),
  value       numeric not null,
  logged_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index body_measurements_user_metric_idx on public.body_measurements (user_id, metric_type, logged_at desc);
create index body_measurements_updated_idx     on public.body_measurements (updated_at);

create trigger body_measurements_set_updated_at
  before update on public.body_measurements
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- day_status — rest/missed day tracking
-- ----------------------------------------------------------------------------
create table public.day_status (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       text not null,
  status     text not null check (status in ('rest','missed')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, date)
);

create index day_status_date_idx on public.day_status (date);
create index day_status_updated_idx on public.day_status (updated_at);

create trigger day_status_set_updated_at
  before update on public.day_status
  for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.exercises         enable row level security;
alter table public.routine_folders   enable row level security;
alter table public.routines          enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workouts          enable row level security;
alter table public.workout_sets      enable row level security;
alter table public.day_status        enable row level security;
alter table public.personal_records  enable row level security;
alter table public.body_measurements enable row level security;

-- profiles: a user can only see and modify their own row ----------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- exercises: global library is publicly readable; customs are owner-only ------
create policy "exercises_select_global_or_own" on public.exercises
  for select using (created_by is null or created_by = auth.uid());
create policy "exercises_insert_own" on public.exercises
  for insert with check (created_by = auth.uid());
create policy "exercises_update_own" on public.exercises
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "exercises_delete_own" on public.exercises
  for delete using (created_by = auth.uid());

-- routine_folders: owner only --------------------------------------------------
create policy "routine_folders_all_own" on public.routine_folders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- routines: owner only ---------------------------------------------------------
create policy "routines_all_own" on public.routines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- routine_exercises: allowed iff the parent routine is owned by the user ------
create policy "routine_exercises_all_own" on public.routine_exercises
  for all
  using (exists (select 1 from public.routines r
                 where r.id = routine_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.routines r
                      where r.id = routine_id and r.user_id = auth.uid()));

-- workouts: owner only ---------------------------------------------------------
create policy "workouts_all_own" on public.workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- workout_sets: allowed iff the parent workout is owned by the user -----------
create policy "workout_sets_all_own" on public.workout_sets
  for all
  using (exists (select 1 from public.workouts w
                 where w.id = workout_id and w.user_id = auth.uid()))
  with check (exists (select 1 from public.workouts w
                      where w.id = workout_id and w.user_id = auth.uid()));

-- personal_records: owner only -------------------------------------------------
create policy "personal_records_all_own" on public.personal_records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- body_measurements: owner only ------------------------------------------------
create policy "body_measurements_all_own" on public.body_measurements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- day_status: owner only --------------------------------------------------------
create policy "day_status_all_own" on public.day_status
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
