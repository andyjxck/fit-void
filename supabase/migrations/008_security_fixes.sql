-- ============================================================================
-- GYM VOID — Security hardening migration (008_security_fixes.sql)
-- 1. friend_codes: stop exposing every user's code; add lookup_friend_code RPC.
-- 2. feedback-attachments: make bucket private, owner-only select.
-- 3. post-photos / avatars / shared-photos: require an authenticated session
--    to read objects (they stay public buckets so public URLs still resolve).
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- friend_codes — only the owner can read their code row; add-friend-by-code
-- goes through the SECURITY DEFINER lookup_friend_code() RPC instead.
-- ----------------------------------------------------------------------------
drop policy if exists friend_codes_select_all on public.friend_codes;
drop policy if exists friend_codes_select_own on public.friend_codes;
create policy friend_codes_select_own on public.friend_codes
  for select using (user_id = auth.uid());

-- Look up the owner of a friend code without exposing the whole table.
-- Returns null when the code doesn't exist. SECURITY DEFINER so it bypasses
-- RLS; it only ever returns the user_id for an exact code match.
create or replace function public.lookup_friend_code(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
stable
as $$
declare
  uid uuid;
begin
  select user_id into uid
    from public.friend_codes
   where code = upper(trim(p_code));
  return uid;
end;
$$;

-- ----------------------------------------------------------------------------
-- feedback-attachments — private bucket; only the uploader can read objects.
-- The client sends signed URLs (7d expiry) in feedback emails instead of
-- public URLs.
-- ----------------------------------------------------------------------------
update storage.buckets set public = false where id = 'feedback-attachments';

drop policy if exists "feedback_read_all" on storage.objects;
drop policy if exists "feedback_read_own" on storage.objects;
create policy "feedback_read_own" on storage.objects
  for select using (
    bucket_id = 'feedback-attachments'
    and (owner_id::text = auth.uid()::text or owner::text = auth.uid()::text)
  );

-- ----------------------------------------------------------------------------
-- post-photos / avatars / shared-photos — still public buckets (friend-visible
-- content uses public URLs everywhere), but listing/reading objects now
-- requires an authenticated role instead of anon.
-- ----------------------------------------------------------------------------
drop policy if exists "post_photos_read_all" on storage.objects;
create policy "post_photos_read_all" on storage.objects
  for select using (bucket_id = 'post-photos' and auth.role() = 'authenticated');

drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all" on storage.objects
  for select using (bucket_id = 'avatars' and auth.role() = 'authenticated');

drop policy if exists "shared_photos_read_all" on storage.objects;
create policy "shared_photos_read_all" on storage.objects
  for select using (bucket_id = 'shared-photos' and auth.role() = 'authenticated');
