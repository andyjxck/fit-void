import type { RealtimeChannel } from '@supabase/supabase-js';

import { getDb } from '@/db/client';
import { pullRoutineTree, syncNow } from '@/db/sync';
import { isPro } from '@/lib/tiers';
import { getSupabase } from '@/supabase/client';

/**
 * Collaborative routines. Membership lives remote-only in
 * routine_collaborators (like friendships) - the sync engine pulls shared
 * routine trees through RLS and flags them routines.is_shared = 1.
 * Guests never reach this module: callers gate on supabase_user_id.
 */

export type CollabStatus = 'pending' | 'accepted' | 'declined';

export interface RoutineMember {
  /** routine_collaborators row id */
  id: string;
  user_id: string;
  status: CollabStatus;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  void_tier: string | null;
}

export interface RoutineInvite {
  id: string;
  routine_id: string;
  routine_title: string | null;
  invited_by: string;
  inviter_name: string | null;
  inviter_username: string | null;
  created_at: string;
}

/** Members (pending + accepted + declined) of a routine I own or share. */
export async function listRoutineMembers(routineId: string): Promise<RoutineMember[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('routine_collaborators')
    .select('id, user_id, status, profiles!routine_collaborators_user_id_fkey(display_name, username, avatar_url, void_tier)')
    .eq('routine_id', routineId)
    .order('created_at', { ascending: true });
  return (data ?? []).map((r: Record<string, unknown>) => {
    const p = (r.profiles ?? null) as Record<string, unknown> | null;
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      status: r.status as CollabStatus,
      display_name: (p?.display_name ?? null) as string | null,
      username: (p?.username ?? null) as string | null,
      avatar_url: (p?.avatar_url ?? null) as string | null,
      void_tier: (p?.void_tier ?? null) as string | null,
    };
  });
}

/** Remote Pro check for a user - profiles.has_void_pro is mirrored at sync. */
export async function profileHasPro(userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb
    .from('profiles')
    .select('has_void_pro')
    .eq('id', userId)
    .maybeSingle();
  return data?.has_void_pro === true;
}

/** Invite a friend. Re-invites flip a declined/left row back to pending. */
export async function inviteToRoutine(
  routineId: string,
  friendId: string
): Promise<{ ok: boolean; error?: string; code?: 'needs_pro' }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Not connected' };
  const {
    data: { session },
  } = await sb.auth.getSession();
  const me = session?.user?.id;
  if (!me) return { ok: false, error: 'Not signed in' };

  // Collaboration unlocks when at least one member has Void Pro. Enforcing
  // at invite time means a collab is never created between two free users.
  // 'needs_pro' lets the UI route to the paywall instead of a dead toast.
  if (!isPro() && !(await profileHasPro(friendId))) {
    return { ok: false, error: 'Collaboration needs Void Pro - either you or your friend must have it.', code: 'needs_pro' as const };
  }

  // The insert policy requires the routine to exist remotely under my
  // user_id - a just-created routine is still local+dirty. Push it first.
  const remoteCheck = () =>
    sb.from('routines').select('id').eq('id', routineId).maybeSingle();
  let remote = await remoteCheck();
  if (!remote.data) {
    await syncNow();
    remote = await remoteCheck();
    if (!remote.data) {
      return { ok: false, error: 'Routine has not synced yet - try again in a moment.' };
    }
  }

  // Re-invite after a decline/leave: the row's UPDATE policy belongs to the
  // invitee, so the owner can't flip status - delete the stale row and
  // insert a fresh pending one instead of upserting.
  await sb
    .from('routine_collaborators')
    .delete()
    .eq('routine_id', routineId)
    .eq('user_id', friendId);
  const { error } = await sb.from('routine_collaborators').insert({
    routine_id: routineId,
    user_id: friendId,
    invited_by: me,
    status: 'pending',
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Pending invites addressed to me, with routine title + inviter profile. */
export async function listRoutineInvites(userId: string): Promise<RoutineInvite[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('routine_collaborators')
    .select(
      'id, routine_id, invited_by, created_at, routines!routine_collaborators_routine_id_fkey(title), inviter:profiles!routine_collaborators_invited_by_fkey(display_name, username)'
    )
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    routine_id: r.routine_id as string,
    routine_title: (r.routines as Record<string, unknown> | null)?.title as string | null,
    invited_by: r.invited_by as string,
    inviter_name: (r.inviter as Record<string, unknown> | null)?.display_name as string | null,
    inviter_username: (r.inviter as Record<string, unknown> | null)?.username as string | null,
    created_at: r.created_at as string,
  }));
}

/**
 * Accept: flips status remotely, then pulls the tree right away - the
 * routine's updated_at may be older than the sync watermark, so waiting for
 * the incremental pull could leave it invisible.
 */
export async function acceptRoutineInvite(invite: RoutineInvite): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Not connected' };
  const {
    data: { session },
  } = await sb.auth.getSession();
  const me = session?.user?.id;
  if (!me) return { ok: false, error: 'Not signed in' };

  const { error } = await sb
    .from('routine_collaborators')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invite.id);
  if (error) return { ok: false, error: error.message };

  const pulled = await pullRoutineTree(sb, invite.routine_id, me);
  if (!pulled) {
    // Rare: routine deleted between invite and accept. Next sync cleans up.
    void syncNow();
  }
  return { ok: true };
}

export async function declineRoutineInvite(inviteId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('routine_collaborators')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', inviteId);
}

/** Hard-delete a shared routine's local tree (incl. tabs) - never a
 * tombstone, or the next push would delete the owner's cloud copy. */
async function dropSharedRoutineLocal(routineId: string) {
  const db = await getDb();
  const tabs = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM routines WHERE parent_routine_id = ?',
    routineId
  );
  for (const tab of tabs) {
    await db.runAsync('DELETE FROM routine_exercises WHERE routine_id = ?', tab.id);
    await db.runAsync('DELETE FROM routines WHERE id = ?', tab.id);
  }
  await db.runAsync('DELETE FROM routine_exercises WHERE routine_id = ?', routineId);
  await db.runAsync('DELETE FROM routine_folder_assignments WHERE routine_id = ?', routineId);
  await db.runAsync('DELETE FROM routines WHERE id = ?', routineId);
}

/** Collaborator leaves: removes my membership, my live-session rows, and the
 * local shared copy. */
export async function leaveSharedRoutine(routineId: string): Promise<void> {
  const sb = getSupabase();
  const {
    data: { session },
  } = sb ? await sb.auth.getSession() : { data: { session: null } };
  const me = session?.user?.id;
  if (sb && me) {
    // Scrub my lobby/live-set rows for this routine's sessions (own-row
    // scope inside the RPC).
    void sb.rpc('purge_routine_sessions', { p_routine: routineId, p_user: me });
    await sb
      .from('routine_collaborators')
      .delete()
      .eq('routine_id', routineId)
      .eq('user_id', me);
  }
  await dropSharedRoutineLocal(routineId);
}

/** Owner removes a collaborator (or rescinds a pending invite): deletes the
 * membership row and their live-session rows on this routine. */
export async function removeCollaborator(inviteId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: row } = await sb
    .from('routine_collaborators')
    .select('routine_id, user_id')
    .eq('id', inviteId)
    .maybeSingle();
  if (row) {
    void sb.rpc('purge_routine_sessions', {
      p_routine: row.routine_id as string,
      p_user: row.user_id as string,
    });
  }
  await sb.from('routine_collaborators').delete().eq('id', inviteId);
}

/** Live pending-invite feed for the signed-in user (social tab). */
export function subscribeToRoutineInvites(
  userId: string,
  cb: (invites: RoutineInvite[]) => void
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listRoutineInvites(userId));
  void refresh();
  channel = sb
    .channel(`routine-invites:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'routine_collaborators', filter: `user_id=eq.${userId}` },
      () => void refresh()
    )
    .subscribe();
  return () => {
    void channel?.unsubscribe();
  };
}
