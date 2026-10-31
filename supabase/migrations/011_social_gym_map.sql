-- ============================================================================
-- Migration 011 — social posts: text-only posts, gym tags, image aspects;
-- gym check-in "cooldown" for the friends map.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- posts — gym tag + per-image aspect ratios (portrait/landscape feeds)
-- ----------------------------------------------------------------------------
alter table public.posts
  add column if not exists gym_name text,
  add column if not exists gym_lat numeric,
  add column if not exists gym_lng numeric,
  add column if not exists image_aspects numeric[] not null default '{}';

create index if not exists posts_gym_idx on public.posts (gym_name)
  where gym_name is not null;

-- ----------------------------------------------------------------------------
-- gym_checkins — cooldown: friends can only see a check-in 2 hours after it
-- happened, and the map only shows the last 24h. Your own check-ins are always
-- visible to you. Enforced in RLS so it can't be bypassed via the API.
-- ----------------------------------------------------------------------------
drop policy if exists gym_checkins_select_own_or_friends on public.gym_checkins;
create policy gym_checkins_select_own_or_friends on public.gym_checkins
  for select using (
    user_id = auth.uid()
    or (
      public.is_friend(auth.uid(), user_id)
      and created_at <= now() - interval '2 hours'
    )
  );
