import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { UserMinus, UserPlus, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TierBadge } from '@/components/TierBadge';
import {
    inviteToRoutine,
    leaveSharedRoutine,
    listRoutineMembers,
    removeCollaborator,
    type RoutineMember,
} from '@/lib/routineCollab';
import { getSupabaseProfile, listFriendsWithAvatars, type FriendWithAvatar } from '@/lib/social';
import { showUpgradePrompt } from '@/lib/tiers';
import type { Routine } from '@/lib/types';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  routine: Routine;
  /** Called after I leave a shared routine (the local copy is gone). */
  onLeft: () => void;
}

function Initials({ name, size = 36, url }: { name: string; size?: number; url?: string | null }) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
      />
    );
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

function memberName(m: RoutineMember) {
  return m.display_name ?? (m.username ? `@${m.username}` : 'Friend');
}

export function CollabSheet({ visible, onClose, routine, onLeft }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useSettings((s) => s.supabase_user_id);
  const isOwner = routine.user_id === me;
  const isShared = routine.is_shared === 1;

  const [members, setMembers] = useState<RoutineMember[]>([]);
  const [friends, setFriends] = useState<FriendWithAvatar[]>([]);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!visible || !me) return;
    const [ms, fs] = await Promise.all([
      listRoutineMembers(routine.id),
      isOwner ? listFriendsWithAvatars(me) : Promise.resolve([] as FriendWithAvatar[]),
    ]);
    setMembers(ms);
    setFriends(fs);
    if (!isOwner && routine.user_id) {
      const p = await getSupabaseProfile(routine.user_id);
      setOwnerName(p?.display_name ?? (p?.username ? `@${p.username}` : null) ?? 'Owner');
    }
  }, [visible, me, routine.id, routine.user_id, isOwner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invitedIds = new Set(members.map((m) => m.user_id));
  const invitable = friends.filter((f) => !invitedIds.has(f.user_id));

  const invite = async (friend: FriendWithAvatar) => {
    setBusy(friend.user_id);
    const res = await inviteToRoutine(routine.id, friend.user_id);
    setBusy(null);
    if (res.ok) {
      notify('Invite sent', { body: `${friend.display_name ?? friend.username ?? 'Friend'} can now collaborate on ${routine.title}.`, tone: 'success' });
      void refresh();
    } else if (res.code === 'needs_pro') {
      // Neither side has Pro - this is the collab upsell moment, not an error.
      showUpgradePrompt(
        'Collab routines',
        'Share this routine and train together in a live session. Collab unlocks when one member has Void Pro.'
      );
    } else {
      notify('Could not invite', { body: res.error ?? 'Try again.', tone: 'error' });
    }
  };

  const leave = async () => {
    await leaveSharedRoutine(routine.id);
    notify('Left routine', { body: routine.title, tone: 'info' });
    onLeft();
    onClose();
  };

  const memberLabel = (m: RoutineMember) =>
    m.status === 'accepted' ? 'COLLABORATOR' : m.status === 'pending' ? 'INVITED' : 'DECLINED';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>COLLABORATORS</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X color={Void.textSecondary} size={20} />
            </Pressable>
          </View>

          {!me ? (
            <>
              <Text style={styles.empty}>
                Sign in to collaborate — invites go through friends you've added on the Social tab.
              </Text>
              <Pressable
                style={styles.signInBtn}
                onPress={() => {
                  onClose();
                  router.push('/auth/link');
                }}>
                <Text style={styles.signInText}>SIGN IN</Text>
              </Pressable>
            </>
          ) : (
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {/* Owner row */}
            <View style={styles.row}>
              <Initials name={isOwner ? 'You' : (ownerName ?? 'Owner')} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {isOwner ? 'You' : (ownerName ?? 'Owner')}
                </Text>
              </View>
              <Text style={styles.ownerTag}>OWNER</Text>
            </View>

            {members.map((m) => (
              <View key={m.id} style={styles.row}>
                <Initials name={memberName(m)} url={m.avatar_url} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {m.user_id === me ? 'You' : memberName(m)}<TierBadge tier={m.void_tier} />
                  </Text>
                  <Text style={styles.status}>{memberLabel(m)}</Text>
                </View>
                {isOwner && (
                  <Pressable
                    onPress={() => void removeCollaborator(m.id).then(refresh)}
                    hitSlop={8}>
                    <UserMinus color={Void.textTertiary} size={17} />
                  </Pressable>
                )}
              </View>
            ))}

            {isOwner && (
              <>
                <Text style={styles.sectionLabel}>INVITE FRIENDS</Text>
                <Text style={styles.disclosure}>
                  Collaborators can see each other's weights, reps and sets on shared
                  workouts. Heart rate is never shared.
                </Text>
                {invitable.length === 0 ? (
                  <Text style={styles.empty}>
                    {friends.length === 0
                      ? 'Add friends from the Social tab first.'
                      : 'All friends are already invited.'}
                  </Text>
                ) : (
                  invitable.map((f) => (
                    <View key={f.user_id} style={styles.row}>
                      <Initials name={f.display_name ?? f.username ?? '?'} url={f.avatar_url} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>
                          {f.display_name ?? f.username ?? 'Friend'}
                        </Text>
                        {f.username ? <Text style={styles.status}>@{f.username}</Text> : null}
                      </View>
                      <Pressable
                        style={styles.inviteBtn}
                        disabled={busy === f.user_id}
                        onPress={() => void invite(f)}
                        hitSlop={4}>
                        <UserPlus color={Void.accentText} size={13} strokeWidth={2.6} />
                        <Text style={styles.inviteText}>
                          {busy === f.user_id ? '…' : 'INVITE'}
                        </Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </>
            )}

            {isShared && !isOwner && (
              <Pressable style={styles.leaveBtn} onPress={() => void leave()}>
                <Text style={styles.leaveText}>LEAVE ROUTINE</Text>
              </Pressable>
            )}
          </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Void.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderWidth: 1,
    borderColor: Void.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: Void.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  name: { color: Void.text, fontSize: 14, fontWeight: '600' },
  status: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  ownerTag: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sectionLabel: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 4,
  },
  empty: { color: Void.textTertiary, fontSize: 12, paddingVertical: 10 },
  disclosure: { color: Void.textTertiary, fontSize: 11, lineHeight: 15, marginBottom: 8 },
  avatar: {
    backgroundColor: Void.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Void.border,
  },
  avatarText: { color: Void.accent, fontWeight: '800' },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Void.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  inviteText: { color: Void.accentText, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  signInBtn: {
    backgroundColor: Void.accent,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 12,
  },
  signInText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  leaveBtn: {
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 16,
  },
  leaveText: { color: Void.failure, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
