-- ============================================================================
-- Migration 015 — sugar tracking + food/drink distinction.
-- Drinks logged via the food sheet write a nutrition_entries row (is_drink,
-- full macros incl. sugar) plus a volume-only liquid_entries shadow row so
-- they count toward hydration without double-counting calories.
-- Idempotent. Requires 003, 010, 013.
-- ============================================================================

alter table public.nutrition_entries
  add column if not exists sugar_g  real    not null default 0,
  add column if not exists is_drink boolean not null default false;

alter table public.liquid_entries
  add column if not exists sugar_g real not null default 0,
  -- Links a hydration shadow row to its nutrition_entries row so deleting
  -- the drink can cascade.
  add column if not exists nutrition_id uuid;

alter table public.food_items
  add column if not exists sugar_g  real    not null default 0,
  add column if not exists is_drink boolean not null default false;
