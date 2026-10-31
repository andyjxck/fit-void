-- Migration 004 — meals, ingredients, meal plans
-- Run against a project that already has 001–003 applied. Idempotent.

-- meals ------------------------------------------------------------------------
create table if not exists public.meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  description  text,
  servings     real not null default 1,
  method       text[] not null default '{}',
  tags         text[] not null default '{}',
  source_url   text,
  is_favourite boolean not null default false,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists meals_user_idx on public.meals (user_id, sort_order);
drop trigger if exists meals_set_updated_at on public.meals;
create trigger meals_set_updated_at before update on public.meals
  for each row execute function public.set_updated_at();
alter table public.meals enable row level security;
drop policy if exists meals_all_own on public.meals;
create policy meals_all_own on public.meals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- meal_ingredients -------------------------------------------------------------
create table if not exists public.meal_ingredients (
  id         uuid primary key default gen_random_uuid(),
  meal_id    uuid not null references public.meals (id) on delete cascade,
  name       text not null,
  quantity   real,
  unit       text,
  calories   real not null default 0,
  protein_g  real not null default 0,
  carbs_g    real not null default 0,
  fat_g      real not null default 0,
  barcode    text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists meal_ingredients_meal_idx on public.meal_ingredients (meal_id, sort_order);
drop trigger if exists meal_ingredients_set_updated_at on public.meal_ingredients;
create trigger meal_ingredients_set_updated_at before update on public.meal_ingredients
  for each row execute function public.set_updated_at();
alter table public.meal_ingredients enable row level security;
drop policy if exists meal_ingredients_all_own on public.meal_ingredients;
create policy meal_ingredients_all_own on public.meal_ingredients
  for all
  using (exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid()));

-- meal_plans -------------------------------------------------------------------
create table if not exists public.meal_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  description  text,
  days         integer not null default 7,
  is_favourite boolean not null default false,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists meal_plans_user_idx on public.meal_plans (user_id, sort_order);
drop trigger if exists meal_plans_set_updated_at on public.meal_plans;
create trigger meal_plans_set_updated_at before update on public.meal_plans
  for each row execute function public.set_updated_at();
alter table public.meal_plans enable row level security;
drop policy if exists meal_plans_all_own on public.meal_plans;
create policy meal_plans_all_own on public.meal_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- meal_plan_items --------------------------------------------------------------
create table if not exists public.meal_plan_items (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.meal_plans (id) on delete cascade,
  meal_id    uuid not null references public.meals (id) on delete cascade,
  day_index  integer not null,
  slot       text not null check (slot in ('breakfast','lunch','dinner','snack')),
  servings   real not null default 1,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists meal_plan_items_plan_idx on public.meal_plan_items (plan_id, day_index, sort_order);
drop trigger if exists meal_plan_items_set_updated_at on public.meal_plan_items;
create trigger meal_plan_items_set_updated_at before update on public.meal_plan_items
  for each row execute function public.set_updated_at();
alter table public.meal_plan_items enable row level security;
drop policy if exists meal_plan_items_all_own on public.meal_plan_items;
create policy meal_plan_items_all_own on public.meal_plan_items
  for all
  using (exists (select 1 from public.meal_plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.meal_plans p where p.id = plan_id and p.user_id = auth.uid()));
