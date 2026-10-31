import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase } from '@/supabase/client';

/**
 * Live collaborative workout sessions. Remote-only (like routineCollab) —
 * nothing here touches SQLite; each participant still writes their own
 * workouts/workout_sets locally through the normal workout store.
 *
 * Flow: a member opens a shared routine's workout -> ensureSession finds or
 * creates a lobby row -> joinSession adds a member row -> each member picks
 * a tab (tab_routine_id, null = the parent's own exercise list) and sets
 * ready -> when everyone *present* (presence channel) is ready, any client
 * flips status to 'active' -> live sets stream through routine_session_sets.
 * Guests never reach this module.
 */

export type SessionStatus = 'lobby' | 'active' | 'ended';

export interface RoutineSession {
  id: string;
  routine_id: string;
  created_by: string;
  status: SessionStatus;
  started_at: string | null;
  ended_at: string | null;
}

export interface SessionMember {
  session_id: string;
  user_id: string;
  /** routines.id of the tab they chose; null = parent's main list. */
  tab_routine_id: string | null;
  ready: boolean;
  display_name: string | null;
  username: string | null;
  void_tier: string | null;
}

export interface SessionSet {
  session_id: string;
  user_id: string;
  exercise_id: string;
  set_order: number;
  set_type: string | null;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  done: boolean;
  updated_at: string;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function myId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const {
    data: { session },
  } = await sb.auth.getSession();
  return session?.user?.id ?? null;
}

/**
 * The session other members would join for this routine: the newest
 * lobby/active row under 24h old. Creates one if none exists. Also sweeps
 * stale rows (owner-delete only via RLS; failures are ignored).
 */
export async function ensureSession(routineId: string): Promise<RoutineSession | null> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return null;

  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  // Best-effort sweep of stale sessions on this routine.
  void sb
    .from('routine_sessions')
    .delete()
    .eq('routine_id', routineId)
    .lt('created_at', cutoff)
    .then(() => undefined);

  const { data: existing } = await sb
    .from('routine_sessions')
    .select('id, routine_id, created_by, status, started_at, ended_at')
    .eq('routine_id', routineId)
    .in('status', ['lobby', 'active'])
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as RoutineSession;

  const { data, error } = await sb
    .from('routine_sessions')
    .insert({ routine_id: routineId, created_by: me, status: 'lobby' })
    .select('id, routine_id, created_by, status, started_at, ended_at')
    .single();
  if (error) return null;
  return data as RoutineSession;
}

/** Join (or rejoin) a session as a member. */
export async function joinSession(sessionId: string): Promise<boolean> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return false;
  const { error } = await sb
    .from('routine_session_members')
    .upsert({ session_id: sessionId, user_id: me }, { onConflict: 'session_id,user_id' });
  return !error;
}

/** Pick which tab I'll work out on (null = parent's main list). Resets ready
 *  so a tab change can't sneak past the all-ready gate. */
export async function setSessionTab(sessionId: string, tabRoutineId: string | null): Promise<void> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return;
  await sb
    .from('routine_session_members')
    .update({ tab_routine_id: tabRoutineId, ready: false })
    .eq('session_id', sessionId)
    .eq('user_id', me);
}

export async function setReady(sessionId: string, ready: boolean): Promise<void> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return;
  await sb
    .from('routine_session_members')
    .update({ ready })
    .eq('session_id', sessionId)
    .eq('user_id', me);
}

/** Remove me from the session entirely (leaving the lobby/workout). */
export async function leaveSession(sessionId: string): Promise<void> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return;
  await sb
    .from('routine_session_members')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', me);
}

/** Flip the lobby to active. Idempotent — every client may try at once. */
export async function startSession(sessionId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('routine_sessions')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'lobby');
}

export async function endSession(sessionId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('routine_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function listSessionMembers(sessionId: string): Promise<SessionMember[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('routine_session_members')
    .select('session_id, user_id, tab_routine_id, ready, profiles!routine_session_members_user_id_fkey(display_name, username, void_tier)')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true });
  return (data ?? []).map((r: Record<string, unknown>) => {
    const p = (r.profiles ?? null) as Record<string, unknown> | null;
    return {
      session_id: r.session_id as string,
      user_id: r.user_id as string,
      tab_routine_id: (r.tab_routine_id ?? null) as string | null,
      ready: Boolean(r.ready),
      display_name: (p?.display_name ?? null) as string | null,
      username: (p?.username ?? null) as string | null,
      void_tier: (p?.void_tier ?? null) as string | null,
    };
  });
}

/** All live sets in the session (everyone's). */
export async function listSessionSets(sessionId: string): Promise<SessionSet[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('routine_session_sets')
    .select('*')
    .eq('session_id', sessionId);
  return (data ?? []) as SessionSet[];
}

/** Upsert one of my live sets so other members see it. */
export async function pushSessionSet(
  sessionId: string,
  set: {
    exercise_id: string;
    set_order: number;
    set_type?: string | null;
    weight_kg?: number | null;
    reps?: number | null;
    rpe?: number | null;
    duration_seconds?: number | null;
    distance_m?: number | null;
    done: boolean;
  }
): Promise<void> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return;
  await sb.from('routine_session_sets').upsert(
    { session_id: sessionId, user_id: me, updated_at: new Date().toISOString(), ...set },
    { onConflict: 'session_id,user_id,exercise_id,set_order' }
  );
}

export async function deleteSessionSet(
  sessionId: string,
  exerciseId: string,
  setOrder: number
): Promise<void> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb || !me) return;
  await sb
    .from('routine_session_sets')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', me)
    .eq('exercise_id', exerciseId)
    .eq('set_order', setOrder);
}

export interface SessionFeed {
  members: SessionMember[];
  session: RoutineSession | null;
  sets: SessionSet[];
  /** user_ids currently connected to the session channel (presence). */
  present: string[];
  me: string | null;
}

/**
 * Live subscription to a session: postgres_changes on the three tables plus
 * presence for who's actually connected right now (drives the "all present
 * must be ready" start gate). Calls back with the full snapshot each change.
 */
export async function subscribeSession(
  sessionId: string,
  cb: (feed: SessionFeed) => void
): Promise<() => void> {
  const sb = getSupabase();
  const me = await myId();
  if (!sb) return () => {};

  let members: SessionMember[] = [];
  let session: RoutineSession | null = null;
  let sets: SessionSet[] = [];
  let present: string[] = [];

  const emit = () => cb({ members, session, sets, present, me });

  const refresh = async () => {
    const [m, s, st] = await Promise.all([
      listSessionMembers(sessionId),
      sb
        .from('routine_sessions')
        .select('id, routine_id, created_by, status, started_at, ended_at')
        .eq('id', sessionId)
        .maybeSingle(),
      listSessionSets(sessionId),
    ]);
    members = m;
    session = (s.data ?? null) as RoutineSession | null;
    sets = st;
    emit();
  };

  const channel: RealtimeChannel = sb
    .channel(`routine-session:${sessionId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'routine_session_members', filter: `session_id=eq.${sessionId}` },
      () => void refresh()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'routine_sessions', filter: `id=eq.${sessionId}` },
      () => void refresh()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'routine_session_sets', filter: `session_id=eq.${sessionId}` },
      () => void refresh()
    )
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ user_id: string }>();
      present = Object.values(state)
        .flat()
        .map((p) => p.user_id)
        .filter(Boolean);
      emit();
    });

  await new Promise<void>((resolve) => {
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        if (me) await channel.track({ user_id: me });
        resolve();
      }
    });
  });
  await refresh();

  return () => {
    void channel.unsubscribe();
  };
}
