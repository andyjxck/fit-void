-- external_id on nutrition_entries + liquid_entries so health-platform
-- imports (Google Health food/hydration logs) can dedupe across devices.
alter table public.nutrition_entries add column if not exists external_id text;
alter table public.liquid_entries add column if not exists external_id text;
