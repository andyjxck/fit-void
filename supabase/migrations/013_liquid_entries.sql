-- ============================================================================
-- Migration 013 — liquid_entries: hydration tracking (water, soda, coffee, …)
-- One row per drink; logged_on is the local calendar day like nutrition_entries.
-- ============================================================================

create table if not exists public.liquid_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  logged_on  text not null,               -- local calendar day YYYY-MM-DD
  name       text not null,
  kind       text not null default 'water'
             check (kind in ('water','soda','juice','coffee','tea','energy','alcohol','other')),
  amount_ml  real not null default 0 check (amount_ml >= 0),
  calories   real not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists liquid_entries_user_day_idx
  on public.liquid_entries (user_id, logged_on desc);
create index if not exists liquid_entries_updated_idx
  on public.liquid_entries (updated_at);

drop trigger if exists liquid_entries_set_updated_at on public.liquid_entries;
create trigger liquid_entries_set_updated_at
  before update on public.liquid_entries
  for each row execute function public.set_updated_at();

alter table public.liquid_entries enable row level security;
drop policy if exists liquid_entries_all_own on public.liquid_entries;
create policy liquid_entries_all_own on public.liquid_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
