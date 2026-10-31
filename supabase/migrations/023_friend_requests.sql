-- ============================================================================
-- GYM VOID — Friend requests (023_friend_requests.sql)
-- Replaces instant bidirectional friending with a pending-request flow:
-- requester inserts a 'pending' row; only the recipient can accept.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tighten inserts: you may only create PENDING requests, as the requester.
-- (Previously any participant could insert status='accepted' directly.)
-- ----------------------------------------------------------------------------
drop policy if exists friendships_insert_participant on public.friendships;
create policy friendships_insert_participant on public.friendships
  for insert with check (
    user_id = auth.uid() and status = 'pending'
  );

-- ----------------------------------------------------------------------------
-- Guard trigger: the requester must not flip their own pending row to
-- accepted - acceptance requires the recipient (friend_id = auth.uid()) or a
-- SECURITY DEFINER function running outside auth.uid() context.
-- ----------------------------------------------------------------------------
create or replace function public.guard_friend_accept()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted'
     and auth.uid() is not null and auth.uid() = old.user_id then
    raise exception 'friend requests can only be accepted by the recipient';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard_accept on public.friendships;
create trigger friendships_guard_accept
  before update on public.friendships
  for each row execute function public.guard_friend_accept();

-- ----------------------------------------------------------------------------
-- accept_friend_request — recipient accepts an incoming pending request:
-- flips it to accepted and creates the reciprocal accepted row atomically.
-- ----------------------------------------------------------------------------
create or replace function public.accept_friend_request(p_requester uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_requester is null or p_requester = auth.uid() then
    raise exception 'invalid friend request';
  end if;
  update public.friendships
     set status = 'accepted', deleted_at = null
   where user_id = p_requester
     and friend_id = auth.uid()
     and status = 'pending'
     and deleted_at is null;
  if not found then
    raise exception 'no pending request from that user';
  end if;
  insert into public.friendships (user_id, friend_id, status)
  values (auth.uid(), p_requester, 'accepted')
  on conflict (user_id, friend_id)
  do update set status = 'accepted', deleted_at = null;
end;
$$;

-- ----------------------------------------------------------------------------
-- remove_friend — soft-deletes BOTH directions of an accepted friendship.
-- The participant update policy can only reach rows where the caller is
-- friend_id, so the reciprocal row needs a definer path.
-- ----------------------------------------------------------------------------
create or replace function public.remove_friend(p_friend uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.friendships
     set deleted_at = now()
   where deleted_at is null
     and status = 'accepted'
     and ((user_id = auth.uid() and friend_id = p_friend)
       or (user_id = p_friend and friend_id = auth.uid()));
end;
$$;

-- ----------------------------------------------------------------------------
-- Profiles: pending-request counterparties can see each other's profile so
-- the recipient can see who is asking and the requester sees who they asked.
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select_own_or_friends on public.profiles;
create policy profiles_select_own_or_friends on public.profiles
  for select using (
    id = auth.uid()
    or public.is_friend(auth.uid(), id)
    or exists (
      select 1 from public.friendships r
       where r.status = 'pending' and r.deleted_at is null
         and ((r.friend_id = auth.uid() and r.user_id = profiles.id)
           or (r.user_id = auth.uid() and r.friend_id = profiles.id))
    )
  );
