import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronLeft, Users } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TierBadge } from '@/components/TierBadge';
import { Screen } from '@/components/ui';
import { getRoutine, listRoutineTabs } from '@/db/repo/routines';
import { goBack } from '@/lib/nav';
import {
    ensureSession,
    joinSession,
    leaveSession,
    setReady,
    setSessionTab,
    startSession,
    subscribeSession,
    type SessionFeed,
} from '@/lib/routineSession';
import type { Routine } from '@/lib/types';
import { useActiveWorkout } from '@/store/activeWorkout';
import { Void } from '@/theme/tokens';

/**
 * Collab workout lobby. Everyone who opens a shared routine's workout lands
 * here, picks a tab, and presses READY. When every member *present* on the
 * channel is ready the session flips to 'active' and all clients start their
 * own workout on the shared clock.
 */
export default function WorkoutLobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // parent routine id
  const router = useRouter();

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [tabs, setTabs] = useState<Routine[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [feed, setFeed] = useState<SessionFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const startedRef = useRef(false);
  const feedRef = useRef<SessionFeed | null>(null);
  feedRef.current = feed;

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let dead = false;
    void (async () => {
      if (!id) return;
      const [r, t] = await Promise.all([getRoutine(id), listRoutineTabs(id)]);
      if (dead) return;
      setRoutine(r);
      setTabs(t);
      const session = await ensureSession(id);
      if (!session) {
        setFailed(true);
        return;
      }
      if (dead) return;
      setSessionId(session.id);
      await joinSession(session.id);
      unsub = await subscribeSession(session.id, (f) => {
        setFeed(f);
        // Session went active while I'm a member - start my workout on the
        // shared clock using the tab I picked (null = parent's main list).
        if (f.session?.status === 'ended' && !startedRef.current) {
          setFailed(true);
          return;
        }
        if (f.session?.status === 'active' && !startedRef.current) {
          const meRow = f.members.find((m) => m.user_id === f.me);
          if (!meRow) return; // spectator / not joined
          startedRef.current = true;
          const tabId = meRow.tab_routine_id ?? id;
          const startedAtMs = f.session.started_at
            ? Date.parse(f.session.started_at)
            : Date.now();
          void useActiveWorkout
            .getState()
            .startWorkout({
              routineId: tabId,
              title: r?.title ?? 'Workout',
              session: { id: session.id, startedAtMs },
            })
            .then(() => router.replace('/workout/active'));
        }
      });
    })();
    return () => {
      dead = true;
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // All-ready gate: every member currently present must be ready. Any client
  // may flip the session - the update is idempotent on the server.
  useEffect(() => {
    if (!feed || !sessionId || feed.session?.status !== 'lobby') return;
    const presentMembers = feed.members.filter((m) => feed.present.includes(m.user_id));
    if (presentMembers.length > 0 && presentMembers.every((m) => m.ready)) {
      void startSession(sessionId);
    }
  }, [feed, sessionId]);

  const meRow = feed?.members.find((m) => m.user_id === feed.me);
  const presentMembers = feed
    ? feed.members.filter((m) => feed.present.includes(m.user_id))
    : [];
  const notReady = presentMembers.filter((m) => !m.ready).length;

  const back = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    if (sessionId) await leaveSession(sessionId);
    goBack();
  }, [leaving, sessionId]);

  const tabLabel = (tabId: string | null) =>
    tabId === null ? 'MAIN' : (tabs.find((t) => t.id === tabId)?.title ?? 'TAB').toUpperCase();

  const tabChoices: { id: string | null; title: string }[] = [
    { id: null, title: 'MAIN' },
    ...tabs.map((t) => ({ id: t.id as string | null, title: t.title })),
  ];

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => void back()} hitSlop={8}>
          <ChevronLeft color={Void.text} size={24} />
        </Pressable>
        <Users color={Void.textSecondary} size={19} />
      </View>

      <Text style={styles.title}>{routine?.title ?? 'Workout'}</Text>
      <Text style={styles.sub}>
        {failed
          ? 'Could not reach the session - check your connection.'
          : feed?.session?.status === 'active'
            ? 'Session live - joining…'
            : notReady > 0
              ? `Waiting on ${notReady} ${notReady === 1 ? 'person' : 'people'}…`
              : 'Everyone here is ready.'}
      </Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>YOUR TAB</Text>
        <View style={styles.tabRow}>
          {tabChoices.map((t) => {
            const sel = (meRow?.tab_routine_id ?? null) === t.id;
            return (
              <Pressable
                key={t.id ?? 'main'}
                style={[styles.tabChip, sel && styles.tabChipSel]}
                onPress={() => sessionId && void setSessionTab(sessionId, t.id)}>
                <Text style={[styles.tabChipText, sel && styles.tabChipTextSel]}>
                  {t.title.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section}>IN THE LOBBY</Text>
        {feed?.members.length ? (
          feed.members.map((m) => {
            const present = feed.present.includes(m.user_id);
            const isMe = m.user_id === feed.me;
            return (
              <View key={m.user_id} style={styles.memberRow}>
                <View style={[styles.dot, !present && styles.dotOff]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>
                    {(m.display_name ?? m.username ?? 'Athlete').toUpperCase()}
                    {isMe ? '  (YOU)' : ''}
                    <TierBadge tier={m.void_tier} />
                  </Text>
                  <Text style={styles.memberTab}>{tabLabel(m.tab_routine_id)}</Text>
                </View>
                {m.ready ? (
                  <View style={styles.readyPill}>
                    <Check size={11} color={Void.accentText} />
                    <Text style={styles.readyPillText}>READY</Text>
                  </View>
                ) : (
                  <Text style={styles.waiting}>{present ? 'NOT READY' : 'AWAY'}</Text>
                )}
              </View>
            );
          })
        ) : (
          <Text style={styles.empty}>Connecting…</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.disclosure}>
          Collaborators can see the weights, reps and sets you log on shared
          workouts. Heart rate is never shared.
        </Text>
        <Pressable
          style={[styles.readyBtn, meRow?.ready && styles.readyBtnOn]}
          onPress={() => sessionId && void setReady(sessionId, !(meRow?.ready ?? false))}>
          <Check size={16} color={meRow?.ready ? Void.accentText : Void.accent} />
          <Text style={[styles.readyText, meRow?.ready && { color: Void.accentText }]}>
            {meRow?.ready ? 'READY - WAITING' : "I'M READY"}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  title: {
    color: Void.text,
    fontSize: 24,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  sub: {
    color: Void.textSecondary,
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  body: { padding: 16, paddingBottom: 140, gap: 10 },
  section: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 8,
    marginBottom: 2,
  },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tabChip: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Void.surface,
  },
  tabChipSel: { borderColor: Void.accent, backgroundColor: Void.accent + '1A' },
  tabChipText: { color: Void.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  tabChipTextSel: { color: Void.accent },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    padding: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Void.accent },
  dotOff: { backgroundColor: Void.borderStrong },
  memberName: { color: Void.text, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  memberTab: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Void.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  readyPillText: { color: Void.accentText, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  waiting: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  empty: { color: Void.textTertiary, fontSize: 12, paddingVertical: 12 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: Void.canvas,
    borderTopWidth: 1,
    borderTopColor: Void.border,
  },
  readyBtn: {
    borderWidth: 1,
    borderColor: Void.accent,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  readyBtnOn: { backgroundColor: Void.accent },
  readyText: { color: Void.accent, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  disclosure: {
    color: Void.textTertiary,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginBottom: 10,
  },
});
