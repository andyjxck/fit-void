-- Unique indexes for health-platform import keys on food + hydration.
-- Migration 022 added the columns; without an index a row re-pushed under a
-- different id (re-import on another device, or re-keyed after an RLS clash)
-- would insert a second copy instead of updating in place.
-- Partial (live rows only) so a deleted import can be re-imported and
-- tombstones never block the key.
create unique index if not exists nutrition_entries_external_idx
  on public.nutrition_entries (user_id, external_id)
  where external_id is not null and deleted_at is null;

create unique index if not exists liquid_entries_external_idx
  on public.liquid_entries (user_id, external_id)
  where external_id is not null and deleted_at is null;
