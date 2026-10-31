-- ============================================================================
-- Migration 017 — product images on scanned food items.
-- Open Food Facts / Nutritionix return a small thumbnail; it rides along on
-- food_items so lists and sheets can render it without a fresh lookup.
-- Idempotent. Requires 010, 015.
-- ============================================================================

alter table public.food_items
  add column if not exists image_url text;
