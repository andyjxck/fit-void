-- Allow heart-rate-variability measurements to sync.
alter table public.body_measurements drop constraint if exists body_measurements_metric_type_check;
alter table public.body_measurements add constraint body_measurements_metric_type_check
  check (metric_type in (
    'weight', 'body_fat', 'waist', 'chest', 'arm', 'thigh', 'resting_hr', 'hrv', 'sleep_hours'));
