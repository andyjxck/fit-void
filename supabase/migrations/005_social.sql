-- ============================================================================
-- GYM VOID — Social feature migration (005_social.sql)
-- Friend codes, friendships, gym check-ins, shared photos, public stats.
-- Requires 001_init.sql (profiles, auth triggers).
-- Idempotent — safe to re-run.
-- ============================================================================

-- Fallback in case 001_init.sql's set_updated_at() is missing.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- friend_codes — 6-char alphanumeric, one per user
-- ----------------------------------------------------------------------------
create table if not exists public.friend_codes (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists friend_codes_code_idx on public.friend_codes (code);

-- Generate a random 6-char code (uppercase, no ambiguous chars O/0/I/1).
create or replace function public.gen_friend_code()
returns text
language plpgsql
as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(chars, floor(random() * length(chars))::int + 1, 1);
  end loop;
  return out;
end;
$$;

-- Auto-provision a friend code when a profile is created.
create or replace function public.handle_new_profile_code()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.friend_codes (user_id, code)
  values (new.id, public.gen_friend_code())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- SECURITY DEFINER function to set a user's friend code (bypasses RLS).
create or replace function public.set_friend_code(p_code text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.friend_codes (user_id, code) values (auth.uid(), p_code)
  on conflict (user_id) do update set code = excluded.code;
end;
$$;

drop trigger if exists on_profile_created_code on public.profiles;
create trigger on_profile_created_code
  after insert on public.profiles
  for each row execute function public.handle_new_profile_code();

alter table public.friend_codes enable row level security;
drop policy if exists friend_codes_select_own on public.friend_codes;
drop policy if exists friend_codes_select_all on public.friend_codes;
create policy friend_codes_select_all on public.friend_codes
  for select using (true);
drop policy if exists friend_codes_insert_own on public.friend_codes;
create policy friend_codes_insert_own on public.friend_codes
  for insert with check (user_id = auth.uid());
drop policy if exists friend_codes_update_own on public.friend_codes;
create policy friend_codes_update_own on public.friend_codes
  for update using (user_id = auth.uid());
drop policy if exists friend_codes_delete_own on public.friend_codes;
create policy friend_codes_delete_own on public.friend_codes
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- friendships — bidirectional, accepted-only (codes are private)
-- ----------------------------------------------------------------------------
create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'accepted' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, friend_id),
  check (user_id != friend_id)
);

create index if not exists friendships_user_idx   on public.friendships (user_id, status);
create index if not exists friendships_friend_idx on public.friendships (friend_id, status);

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at before update on public.friendships
  for each row execute function public.set_updated_at();

alter table public.friendships enable row level security;
drop policy if exists friendships_select_participant on public.friendships;
create policy friendships_select_participant on public.friendships
  for select using (
    user_id = auth.uid() or friend_id = auth.uid()
  );
drop policy if exists friendships_insert_participant on public.friendships;
create policy friendships_insert_participant on public.friendships
  for insert with check (
    user_id = auth.uid() or friend_id = auth.uid()
  );
drop policy if exists friendships_update_participant on public.friendships;
create policy friendships_update_participant on public.friendships
  for update using (
    user_id = auth.uid() or friend_id = auth.uid()
  ) with check (
    user_id = auth.uid() or friend_id = auth.uid()
  );
drop policy if exists friendships_delete_participant on public.friendships;
create policy friendships_delete_participant on public.friendships
  for delete using (
    user_id = auth.uid() or friend_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- gym_checkins — check in at a gym, optionally with photo
-- ----------------------------------------------------------------------------
create table if not exists public.gym_checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  gym_name   text not null,
  lat        numeric,
  lng        numeric,
  photo_url  text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists gym_checkins_user_idx   on public.gym_checkins (user_id, created_at desc);
create index if not exists gym_checkins_updated_idx on public.gym_checkins (updated_at);

drop trigger if exists gym_checkins_set_updated_at on public.gym_checkins;
create trigger gym_checkins_set_updated_at before update on public.gym_checkins
  for each row execute function public.set_updated_at();

alter table public.gym_checkins enable row level security;

-- Helper: is the given user a friend of auth.uid()?
create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.friendships f
     where f.deleted_at is null and f.status = 'accepted'
       and ((f.user_id = a and f.friend_id = b)
         or (f.user_id = b and f.friend_id = a))
  );
$$;

-- ----------------------------------------------------------------------------
-- profiles additions — avatar_url + friends can see each other's profiles
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists fav_pbs jsonb not null default '[]';

drop policy if exists profiles_select_own_or_friends on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own_or_friends on public.profiles
  for select using (
    id = auth.uid() or public.is_friend(auth.uid(), id)
  );

drop policy if exists gym_checkins_select_own_or_friends on public.gym_checkins;
create policy gym_checkins_select_own_or_friends on public.gym_checkins
  for select using (
    user_id = auth.uid() or public.is_friend(auth.uid(), user_id)
  );
drop policy if exists gym_checkins_insert_own on public.gym_checkins;
create policy gym_checkins_insert_own on public.gym_checkins
  for insert with check (user_id = auth.uid());
drop policy if exists gym_checkins_update_own on public.gym_checkins;
create policy gym_checkins_update_own on public.gym_checkins
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists gym_checkins_delete_own on public.gym_checkins;
create policy gym_checkins_delete_own on public.gym_checkins
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- shared_photos — photos shared to friends, optionally tagging users
-- ----------------------------------------------------------------------------
create table if not exists public.shared_photos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  url             text not null,
  caption         text,
  tagged_user_ids uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists shared_photos_user_idx   on public.shared_photos (user_id, created_at desc);
create index if not exists shared_photos_updated_idx on public.shared_photos (updated_at);

drop trigger if exists shared_photos_set_updated_at on public.shared_photos;
create trigger shared_photos_set_updated_at before update on public.shared_photos
  for each row execute function public.set_updated_at();

alter table public.shared_photos enable row level security;

drop policy if exists shared_photos_select_own_or_friends on public.shared_photos;
create policy shared_photos_select_own_or_friends on public.shared_photos
  for select using (
    user_id = auth.uid()
    or public.is_friend(auth.uid(), user_id)
    or auth.uid() = any(tagged_user_ids)
  );
drop policy if exists shared_photos_insert_own on public.shared_photos;
create policy shared_photos_insert_own on public.shared_photos
  for insert with check (user_id = auth.uid());
drop policy if exists shared_photos_update_own on public.shared_photos;
create policy shared_photos_update_own on public.shared_photos
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists shared_photos_delete_own on public.shared_photos;
create policy shared_photos_delete_own on public.shared_photos
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- posts — Instagram-style feed posts with multiple images
-- ----------------------------------------------------------------------------
create table if not exists public.posts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  caption         text,
  image_urls      text[] not null,
  tagged_user_ids uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists posts_user_idx   on public.posts (user_id, created_at desc);
create index if not exists posts_updated_idx on public.posts (updated_at);

-- Backfill columns for older partially-applied versions of this table.
alter table public.posts add column if not exists tagged_user_ids uuid[] not null default '{}';
alter table public.posts add column if not exists image_urls text[] not null default '{}';
alter table public.posts add column if not exists caption text;
alter table public.posts add column if not exists updated_at timestamptz not null default now();
alter table public.posts add column if not exists deleted_at timestamptz;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

drop policy if exists posts_select_own_or_friends on public.posts;
create policy posts_select_own_or_friends on public.posts
  for select using (
    user_id = auth.uid() or public.is_friend(auth.uid(), user_id)
  );
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert with check (user_id = auth.uid());
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- post_likes — one like per user per post
-- ----------------------------------------------------------------------------
create table if not exists public.post_likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists post_likes_post_idx on public.post_likes (post_id);
create index if not exists post_likes_user_idx on public.post_likes (user_id);

alter table public.post_likes enable row level security;

drop policy if exists post_likes_select_friends on public.post_likes;
create policy post_likes_select_friends on public.post_likes
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_id
        and (p.user_id = auth.uid() or public.is_friend(auth.uid(), p.user_id))
    )
  );
drop policy if exists post_likes_insert_own on public.post_likes;
create policy post_likes_insert_own on public.post_likes
  for insert with check (user_id = auth.uid());
drop policy if exists post_likes_delete_own on public.post_likes;
create policy post_likes_delete_own on public.post_likes
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- post_comments — comments on posts
-- ----------------------------------------------------------------------------
create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

drop trigger if exists post_comments_set_updated_at on public.post_comments;
create trigger post_comments_set_updated_at before update on public.post_comments
  for each row execute function public.set_updated_at();

alter table public.post_comments enable row level security;

drop policy if exists post_comments_select_friends on public.post_comments;
create policy post_comments_select_friends on public.post_comments
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_id
        and (p.user_id = auth.uid() or public.is_friend(auth.uid(), p.user_id))
    )
  );
drop policy if exists post_comments_insert_own on public.post_comments;
create policy post_comments_insert_own on public.post_comments
  for insert with check (user_id = auth.uid());
drop policy if exists post_comments_update_own on public.post_comments;
create policy post_comments_update_own on public.post_comments
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists post_comments_delete_own on public.post_comments;
create policy post_comments_delete_own on public.post_comments
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- public_stats — weekly aggregate stats visible to friends
-- ----------------------------------------------------------------------------
create table if not exists public.public_stats (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  week_volume_kg numeric not null default 0,
  week_workouts  integer not null default 0,
  week_calories  integer not null default 0,
  bench_1rm      numeric,
  squat_1rm      numeric,
  deadlift_1rm   numeric,
  updated_at     timestamptz not null default now()
);

drop trigger if exists public_stats_set_updated_at on public.public_stats;
create trigger public_stats_set_updated_at before update on public.public_stats
  for each row execute function public.set_updated_at();

alter table public.public_stats enable row level security;

drop policy if exists public_stats_select_own_or_friends on public.public_stats;
create policy public_stats_select_own_or_friends on public.public_stats
  for select using (
    user_id = auth.uid() or public.is_friend(auth.uid(), user_id)
  );
drop policy if exists public_stats_upsert_own on public.public_stats;
create policy public_stats_upsert_own on public.public_stats
  for insert with check (user_id = auth.uid());
drop policy if exists public_stats_update_own on public.public_stats;
create policy public_stats_update_own on public.public_stats
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists public_stats_delete_own on public.public_stats;
create policy public_stats_delete_own on public.public_stats
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Storage bucket for shared photos (public read for signed URLs)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('shared-photos', 'shared-photos', true)
on conflict (id) do nothing;

drop policy if exists "shared_photos_upload_own" on storage.objects;
create policy "shared_photos_upload_own" on storage.objects
  for insert with check (bucket_id = 'shared-photos' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "shared_photos_read_all" on storage.objects;
create policy "shared_photos_read_all" on storage.objects
  for select using (bucket_id = 'shared-photos');
drop policy if exists "shared_photos_delete_own" on storage.objects;
create policy "shared_photos_delete_own" on storage.objects
  for delete using (bucket_id = 'shared-photos' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "shared_photos_update_own" on storage.objects;
create policy "shared_photos_update_own" on storage.objects
  for update using (bucket_id = 'shared-photos' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));

-- ----------------------------------------------------------------------------
-- Storage bucket for post photos (public read, owner write/delete)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', true)
on conflict (id) do nothing;

drop policy if exists "post_photos_upload_own" on storage.objects;
create policy "post_photos_upload_own" on storage.objects
  for insert with check (bucket_id = 'post-photos' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "post_photos_read_all" on storage.objects;
create policy "post_photos_read_all" on storage.objects
  for select using (bucket_id = 'post-photos');
drop policy if exists "post_photos_delete_own" on storage.objects;
create policy "post_photos_delete_own" on storage.objects
  for delete using (bucket_id = 'post-photos' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "post_photos_update_own" on storage.objects;
create policy "post_photos_update_own" on storage.objects
  for update using (bucket_id = 'post-photos' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));

-- ----------------------------------------------------------------------------
-- Storage bucket for avatars (public read, owner write/delete)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_upload_own" on storage.objects;
create policy "avatars_upload_own" on storage.objects
  for insert with check (bucket_id = 'avatars' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all" on storage.objects
  for select using (bucket_id = 'avatars');
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete using (bucket_id = 'avatars' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update using (bucket_id = 'avatars' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));

-- ----------------------------------------------------------------------------
-- blocked_users — block other users
-- ----------------------------------------------------------------------------
create table if not exists public.blocked_users (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.blocked_users enable row level security;
drop policy if exists blocked_select_own on public.blocked_users;
create policy blocked_select_own on public.blocked_users
  for select using (blocker_id = auth.uid() or blocked_id = auth.uid());
drop policy if exists blocked_insert_own on public.blocked_users;
create policy blocked_insert_own on public.blocked_users
  for insert with check (blocker_id = auth.uid());
drop policy if exists blocked_delete_own on public.blocked_users;
create policy blocked_delete_own on public.blocked_users
  for delete using (blocker_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime — publish changes for social tables
-- ----------------------------------------------------------------------------
-- Replica identity + realtime publication — guarded per table so a missing
-- table can't abort the whole script.
do $$
declare
  t text;
begin
  foreach t in array array[
    'friendships','gym_checkins','shared_photos','public_stats',
    'posts','post_likes','post_comments','blocked_users','friend_codes','profiles'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I replica identity full', t);
    end if;
  end loop;
end $$;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'friendships','gym_checkins','shared_photos','public_stats',
      'posts','post_likes','post_comments','blocked_users','friend_codes','profiles'
    ] loop
      if to_regclass('public.' || t) is not null
         and not exists (
           select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public' and tablename = t
         ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- post_reports - user reports for moderation (App Store guideline 1.2)
-- ----------------------------------------------------------------------------
create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);
alter table public.post_reports enable row level security;

drop policy if exists "post_reports_insert_own" on public.post_reports;
create policy "post_reports_insert_own" on public.post_reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists "post_reports_select_own" on public.post_reports;
create policy "post_reports_select_own" on public.post_reports
  for select using (reporter_id = auth.uid());

-- ----------------------------------------------------------------------------
-- delete_account() - self-service account deletion (GDPR erasure).
-- Runs as definer so the client can delete its own auth.users row; cascades
-- clean up profiles, posts, friendships, etc. via FK on delete cascade.
-- ----------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Remove social data first (FK order), then the profile and auth row.
  delete from public.post_reports where reporter_id = auth.uid();
  delete from public.post_comments where user_id = auth.uid();
  delete from public.post_likes where user_id = auth.uid();
  delete from public.posts where user_id = auth.uid();
  delete from public.friendships where user_id = auth.uid() or friend_id = auth.uid();
  delete from public.blocked_users where blocker_id = auth.uid() or blocked_id = auth.uid();
  delete from public.gym_checkins where user_id = auth.uid();
  delete from public.shared_photos where user_id = auth.uid();
  delete from public.public_stats where user_id = auth.uid();
  delete from public.friend_codes where user_id = auth.uid();
  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- feedback - in-app feedback submissions (emailed via notify edge function)
-- ----------------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  message text not null,
  attachments text[] not null default '{}',
  app_version text,
  platform text,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert with check (user_id = auth.uid() or user_id is null);

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select using (user_id = auth.uid());

-- Storage bucket for feedback attachments (own read/write, not public-listed)
insert into storage.buckets (id, name, public)
values ('feedback-attachments', 'feedback-attachments', true)
on conflict (id) do nothing;

drop policy if exists "feedback_upload_own" on storage.objects;
create policy "feedback_upload_own" on storage.objects
  for insert with check (bucket_id = 'feedback-attachments' and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text));
drop policy if exists "feedback_read_all" on storage.objects;
create policy "feedback_read_all" on storage.objects
  for select using (bucket_id = 'feedback-attachments');
