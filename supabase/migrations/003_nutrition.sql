-- Migration 003 — nutrition log + body profile fields
-- Run against a project that already has 001 and 002 applied. Idempotent.

-- nutrition_entries ------------------------------------------------------------
create table if not exists public.nutrition_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  logged_on  text not null,               -- local calendar day YYYY-MM-DD
  name       text not null,
  calories   real not null default 0,
  protein_g  real not null default 0,
  carbs_g    real not null default 0,
  fat_g      real not null default 0,
  serving    text,
  barcode    text,
  source     text not null default 'manual' check (source in ('manual','barcode','quick')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists nutrition_entries_user_day_idx on public.nutrition_entries (user_id, logged_on desc);

drop trigger if exists nutrition_entries_set_updated_at on public.nutrition_entries;
create trigger nutrition_entries_set_updated_at
  before update on public.nutrition_entries
  for each row execute function public.set_updated_at();

alter table public.nutrition_entries enable row level security;
drop policy if exists nutrition_entries_all_own on public.nutrition_entries;
create policy nutrition_entries_all_own on public.nutrition_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- body profile on profiles --------------------------------------------------------
alter table public.profiles
  add column if not exists height_cm        real,
  add column if not exists birth_year       integer,
  add column if not exists sex              text check (sex in ('male','female')),
  add column if not exists activity_level   text not null default 'moderate',
  add column if not exists goal             text not null default 'maintain',
  add column if not exists calorie_override integer;
