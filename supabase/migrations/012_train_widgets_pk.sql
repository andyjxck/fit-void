-- ============================================================================
-- Migration 012 — train_widgets: composite PK (user_id, id)
--
-- Local widget ids are deterministic strings shared by every user
-- ('w_0_quick_start', 'w_1_my_routines', …). With `id` as the lone primary
-- key, the second user to sync upserts onto the FIRST user's row; the UPDATE
-- path then fails RLS: "new row violates row-level security policy (USING
-- expression)". Scoping the PK per user gives everyone their own rows.
-- ============================================================================

alter table public.train_widgets drop constraint if exists train_widgets_pkey;
alter table public.train_widgets add primary key (user_id, id);
