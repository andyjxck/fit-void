-- Session feel rating + recovery metric types.
-- Local SQLite added workouts.feel and body_measurements metric types
-- 'resting_hr' / 'sleep_hours'; the cloud schema must accept them for sync.

alter table public.workouts add column if not exists feel integer;

alter table public.body_measurements drop constraint if exists body_measurements_metric_type_check;
alter table public.body_measurements add constraint body_measurements_metric_type_check
  check (metric_type in (
    'weight', 'body_fat', 'waist', 'chest', 'arm', 'thigh', 'resting_hr', 'sleep_hours'));
