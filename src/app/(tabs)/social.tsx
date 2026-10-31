import * as AppleAuthentication from 'expo-apple-authentication';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import { Camera, Check, ChevronLeft, ChevronRight, Copy, Film, ImagePlus, LogOut, MapPin, MessageCircle, MoreHorizontal, Plus, Send, Trophy, UserPlus, Volume2, VolumeX, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    Image as RNImage,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';

import { GymSearchModal } from '@/components/social/GymSearchModal';
import { PhotoEditorModal } from '@/components/social/PhotoEditorModal';
import { PhotoViewer } from '@/components/social/PhotoViewer';
import { TierBadge } from '@/components/TierBadge';
import { Card, cardChrome, CardSheen, Screen, ScreenHeader } from '@/components/ui';
import { NotifyHost } from '@/components/ui/Notify';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Sheet } from '@/components/ui/Sheet';
import { signOutWipe, wipeLocalUserData } from '@/db/sync';
import type { GymPlace } from '@/lib/gyms';
import { personalBests } from '@/lib/insights';
import {
    acceptRoutineInvite,
    declineRoutineInvite,
    subscribeToRoutineInvites,
    type RoutineInvite,
} from '@/lib/routineCollab';
import {
    acceptFriendRequest,
    addComment,
    addFriendByCode,
    blockUser,
    cancelFriendRequest,
    createPost,
    declineFriendRequest,
    deleteAccount,
    deletePost,
    getFriendCount,
    getOrCreateFriendCode,
    getPostCount,
    getSupabaseProfile,
    getUserPosts,
    isBlocked,
    isVideoMedia,
    likePost,
    listComments,
    listFeed,
    listFriendsWithAvatars,
    listLikedPosts,
    listPostLikers,
    removeFriend,
    reportPost,
    searchUsers,
    sendFriendRequestById,
    subscribeToComments,
    subscribeToFeed,
    subscribeToFriendRequests,
    subscribeToFriendships,
    unblockUser,
    unlikePost,
    updateSupabaseProfile,
    uploadAvatar,
    type FeedPost,
    type Friend,
    type FriendRequest,
    type FriendWithAvatar,
    type PostComment,
    type PostLiker,
    type UserSearchResult
} from '@/lib/social';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { getSupabase } from '@/supabase/client';
import { tabular, Void } from '@/theme/tokens';

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// -- Sign In Screen --------------------------------------------------------

function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const attempts = useRef<Record<string, number>>({});
  const sb = getSupabase();

  const fail = (e: unknown) => {
    if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
      console.warn('Sign-in failed', e);
      setErr('Sign-in failed. Check your details and try again.');
    }
  };

  const signInApple = async () => {
    if (!sb) return;
    setBusy(true);
    setErr(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identity token');
      const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
      if (error) throw error;
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const signInGoogle = async () => {
    if (!sb) return;
    setBusy(true);
    setErr(null);
    try {
      const redirectTo = 'gymvoid://auth/callback';
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Google sign-in is unavailable');
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== 'success' || !res.url) return;
      const code = new URL(res.url).searchParams.get('code');
      if (!code) throw new Error('Google sign-in did not complete');
      const { error: exchErr } = await sb.auth.exchangeCodeForSession(code);
      if (exchErr) throw exchErr;
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const signInEmail = async () => {
    if (!sb || !email.trim() || !password) return;
    const key = email.trim().toLowerCase();
    if (mode === 'signin' && (attempts.current[key] ?? 0) >= 5) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'signup') {
        const { error } = await sb.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          attempts.current[key] = (attempts.current[key] ?? 0) + 1;
          if (attempts.current[key] >= 5) {
            void sb.functions.invoke('password-reset', { body: { email: email.trim() } })
              .catch((e) => {
                console.warn('password-reset invoke failed', e);
                notify('Could not send reset', { body: 'Check your connection and try again.', tone: 'error' });
              });
            setErr('Too many attempts - we emailed you a password reset link.');
          } else {
            throw error;
          }
        }
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = () => {
    if (!sb || !email.trim()) return;
    void sb.functions.invoke('password-reset', { body: { email: email.trim() } })
      .then(() => notify('Reset email sent', { tone: 'success' }))
      .catch((e) => {
        console.warn('password-reset invoke failed', e);
        notify('Could not send reset', { body: 'Check your connection and try again.', tone: 'error' });
      });
  };

  const locked = mode === 'signin' && (attempts.current[email.trim().toLowerCase()] ?? 0) >= 5;

  return (
    <Screen>
      <ScreenHeader title="Feed" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.signInWrap}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.signInTitle}>SIGN IN</Text>
        <Text style={styles.signInBody}>Sign in to share workouts, follow friends, and sync across devices.</Text>
        <Pressable style={[styles.appleBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void signInApple()}>
          <Text style={styles.appleBtnText}>Continue with Apple</Text>
        </Pressable>
        <Pressable style={[styles.googleBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void signInGoogle()}>
          <Text style={styles.googleBtnText}>Continue with Google</Text>
        </Pressable>
        <View style={styles.signInDivider}>
          <View style={styles.signInDividerLine} />
          <Text style={styles.signInDividerText}>OR</Text>
          <View style={styles.signInDividerLine} />
        </View>
        <TextInput
          style={styles.signInEmailInput}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={Void.textTertiary}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <View style={{ width: '100%' }}>
          <PasswordInput value={password} onChangeText={setPassword} placeholder="Password" showStrength={mode === 'signup'} />
        </View>
        {err && <Text style={styles.signInErr}>{err}</Text>}
        <Pressable
          style={[styles.signInBtn, (busy || !email.trim() || !password || locked) && { opacity: 0.4 }]}
          disabled={busy || !email.trim() || !password || locked}
          onPress={() => void signInEmail()}>
          <Text style={styles.signInBtnText}>
            {locked ? 'RESET EMAIL SENT' : busy ? 'WORKING…' : mode === 'signup' ? 'CREATE ACCOUNT' : 'CONTINUE WITH EMAIL'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.forgotBtn}
          onPress={() => {
            if (!email.trim()) { notify('Enter your email', { body: 'Type your email above first so we know where to send the reset link.', tone: 'info' }); return; }
            forgotPassword();
          }}>
          <Text style={styles.forgotBtnText}>FORGOT PASSWORD</Text>
        </Pressable>
        <Pressable
          style={styles.modeSwitch}
          onPress={() => { setMode((m) => (m === 'signin' ? 'signup' : 'signin')); setErr(null); }}>
          <Text style={styles.modeSwitchText}>
            {mode === 'signin' ? 'New here? Create account with email' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// -- Main Social Tab ------------------------------------------------------

export default function SocialTab() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [addInput, setAddInput] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [viewProfile, setViewProfile] = useState<{ userId: string; isOwn: boolean } | null>(null);
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [myName, setMyName] = useState('?');

  useEffect(() => {
    if (!userId) return;
    void getOrCreateFriendCode(userId).then(setCode);
    const unsubFeed = subscribeToFeed(userId, setFeed);
    const unsubFriends = subscribeToFriendships(userId, setFriends);
    return () => { unsubFeed(); unsubFriends(); };
  }, [userId]);

  // Refresh own avatar/name whenever the profile modal closes (after a save).
  useEffect(() => {
    if (!userId || viewProfile) return;
    void getSupabaseProfile(userId).then((p) => {
      setMyAvatar(p?.avatar_url ?? null);
      setMyName(p?.display_name ?? p?.username ?? '?');
    });
  }, [userId, viewProfile]);

  const doAddFriend = async () => {
    if (!userId || addInput.length !== 6) return;
    const res = await addFriendByCode(userId, addInput.toUpperCase());
    if (res.ok) {
      setAddInput('');
      if (res.accepted) {
        notify('Friend added', { body: 'You can now see each other\'s posts and stats.', tone: 'success' });
      } else {
        notify('Request sent', { body: 'They\'ll need to accept it before you can see each other\'s posts.', tone: 'success' });
      }
    } else {
      notify('Could not send', { body: res.error ?? 'Check the code and try again.', tone: 'error' });
    }
  };

  const signOut = async () => {
    const res = await signOutWipe();
    if (res === 'sync-failed') {
      const proceed = await confirm({
        title: 'Sync incomplete',
        body: 'Some changes have not been backed up. Sign out anyway? Unsynced data will be lost.',
        confirmText: 'SIGN OUT',
        destructive: true,
      });
      if (!proceed) return;
      const sb = getSupabase();
      await wipeLocalUserData();
      useSettings.getState().set({ supabase_user_id: null });
      await sb?.auth.signOut();
    }
  };

  if (!userId) {
    return <SignInScreen />;
  }

  return (
    <Screen>
      <ScreenHeader
        title="Feed"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => setViewProfile({ userId, isOwn: true })} hitSlop={8}>
              <Avatar url={myAvatar} name={myName} size={32} />
            </Pressable>
            <Pressable onPress={() => setCreateOpen((o) => !o)} hitSlop={8}>
              <Plus color={Void.accent} size={26} />
            </Pressable>
            <Pressable
              onPress={() => {
                void confirm({ title: 'Sign out?', body: 'You will need to sign in again to see your feed.', confirmText: 'SIGN OUT', destructive: true })
                  .then((ok) => { if (ok) void signOut(); });
              }}
              hitSlop={8}>
              <LogOut color={Void.textTertiary} size={22} />
            </Pressable>
          </View>
        }
      />
      <NestableScrollContainer contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Friend code + add */}
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <View style={styles.codeRow}>
            <View>
              <Text style={styles.codeLabel}>YOUR CODE</Text>
              <Text style={styles.codeText}>{code ?? '······'}</Text>
            </View>
            <Pressable
              style={styles.copyBtn}
              onPress={() => {
                if (code) {
                  void Clipboard.setStringAsync(code).then(() => notify('Code copied', { body: code, tone: 'success' }));
                }
              }}>
              <Copy color={Void.textSecondary} size={18} />
            </Pressable>
          </View>
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={addInput}
              onChangeText={(v) => setAddInput(v.toUpperCase().slice(0, 6))}
              placeholder="6-char code"
              placeholderTextColor={Void.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Pressable style={[styles.addBtn, addInput.length !== 6 && { opacity: 0.4 }]} onPress={() => void doAddFriend()} disabled={addInput.length !== 6}>
              <Text style={styles.addBtnText}>ADD</Text>
            </Pressable>
          </View>
        </Card>

        {/* Friends' gym check-ins live on the map page (24h, 2h cooldown) */}
        <Card style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
          <Pressable
            style={({ pressed }) => [styles.mapEntry, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/map')}>
            <View style={styles.mapEntryIcon}>
              <MapPin color={Void.accent} size={16} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mapEntryTitle}>FRIENDS AT THE GYM</Text>
              <Text style={styles.mapEntrySub}>Last 24h · live map</Text>
            </View>
            <ChevronRight color={Void.textTertiary} size={20} />
          </Pressable>
        </Card>

        {/* Inline create-post composer at the top of the feed - collapsed onebox
            that expands on tap or via the header + button */}
        <CreatePostCard
          userId={userId}
          open={createOpen}
          avatarUrl={myAvatar}
          avatarName={myName}
          onClose={() => setCreateOpen(false)}
          onPosted={() => { setCreateOpen(false); void listFeed(userId).then(setFeed); }}
        />

        {/* Feed */}
        {feed.length === 0 ? (
          <View style={styles.emptyFeed}>
            <Text style={styles.emptyFeedText}>No posts yet. Tap + to share your first post.</Text>
          </View>
        ) : (
          feed.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              userId={userId}
              onOpenProfile={(uid, own) => setViewProfile({ userId: uid, isOwn: own })}
              onDeleted={() => void listFeed(userId).then(setFeed)}
            />
          ))
        )}
      </NestableScrollContainer>

      <ProfileModal
        visible={viewProfile != null}
        targetUserId={viewProfile?.userId ?? null}
        isOwn={viewProfile?.isOwn ?? false}
        currentUserId={userId}
        friends={friends}
        onClose={() => setViewProfile(null)}
        onOpenProfile={(uid, own) => setViewProfile({ userId: uid, isOwn: own })}
      />
    </Screen>
  );
}

// -- Post Card -------------------------------------------------------------

function PostCard({ post, userId, onOpenProfile, onDeleted }: {
  post: FeedPost;
  userId: string;
  onOpenProfile: (uid: string, isOwn: boolean) => void;
  onDeleted: () => void;
}) {
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [imgIdx, setImgIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [likersOpen, setLikersOpen] = useState(false);
  const [likers, setLikers] = useState<PostLiker[]>([]);
  const isOwn = post.user_id === userId;

  // Realtime refreshes replace `post` for the same key - resync local state
  // seeded from props. Deps on the values themselves so an unrelated field
  // change doesn't clobber an in-flight optimistic like/comment.
  useEffect(() => {
    setLiked(post.liked_by_me);
    setLikeCount(post.like_count);
    setCommentCount(post.comment_count);
  }, [post.liked_by_me, post.like_count, post.comment_count]);

  useEffect(() => {
    if (!commentsOpen) return;
    return subscribeToComments(post.id, (cs) => { setComments(cs); setCommentCount(cs.length); });
  }, [commentsOpen, post.id]);

  const toggleLike = async () => {
    if (liked) { setLiked(false); setLikeCount((c) => c - 1); await unlikePost(userId, post.id); }
    else { setLiked(true); setLikeCount((c) => c + 1); await likePost(userId, post.id); }
  };

  const report = (reason: string) => {
    void reportPost(userId, post.id, reason).then((ok) =>
      ok
        ? notify('Reported', { body: 'Thanks - we will review this post.', tone: 'success' })
        : notify('Error', { body: 'Could not send report.', tone: 'error' })
    );
  };

  const submitComment = async () => {
    const t = commentText.trim();
    if (!t) return;
    setCommentText('');
    setCommentCount((c) => c + 1);
    await addComment(userId, post.id, t);
    void listComments(post.id).then(setComments);
  };

  return (
    <Card style={{ marginBottom: 12, overflow: 'hidden' }}>
      {/* Header */}
      <View style={styles.postHeader}>
        <Pressable style={styles.postAuthor} onPress={() => onOpenProfile(post.user_id, isOwn)}>
          <Avatar url={post.author_avatar_url} name={post.author_display_name ?? post.author_username ?? '?'} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={styles.postName} numberOfLines={1}>{post.author_display_name ?? 'Unknown'}<TierBadge tier={post.author_tier} /></Text>
            <Text style={styles.postTime} numberOfLines={1}>
              {timeAgo(post.created_at)}
              {post.gym_name && (
                <>
                  {' · at '}
                  <Text style={styles.postGymName}>{post.gym_name}</Text>
                </>
              )}
              {post.tagged_users.length > 0 && (
                <>
                  {' · with '}
                  {post.tagged_users.map((t, i) => (
                    <Text key={t.user_id} style={styles.postTaggedName} onPress={() => onOpenProfile(t.user_id, t.user_id === userId)}>
                      @{t.username ?? t.display_name}{i < post.tagged_users.length - 1 ? ',' : ''}
                    </Text>
                  ))}
                </>
              )}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8}>
          <MoreHorizontal color={Void.textTertiary} size={20} />
        </Pressable>
      </View>

      {/* Images - full card bleed (negative margin escapes Card padding so
          each page is exactly viewport width; no mid-photo drift), per-image
          aspect so portrait & landscape both fit. Tap opens fullscreen zoom. */}
      {post.image_urls.length > 0 && (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / (e.nativeEvent.layoutMeasurement.width || 1)))}
          scrollEventThrottle={16}
          style={styles.postImages}
        >
          {post.image_urls.map((url, i) => {
            const ar = Math.min(1.91, Math.max(0.75, post.image_aspects?.[i] || 16 / 9));
            if (isVideoMedia(url)) {
              return <FeedVideo key={i} url={url} aspect={ar} />;
            }
            const imageIdx = post.image_urls.slice(0, i + 1).filter((u) => !isVideoMedia(u)).length - 1;
            return (
              <Pressable key={i} onPress={() => setViewerIdx(imageIdx)}>
                <Image source={{ uri: url }} style={[styles.postImage, { aspectRatio: ar }]} contentFit="cover" cachePolicy="memory-disk" transition={150} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {post.image_urls.length > 1 && (
        <View style={styles.dotsRow}>
          {post.image_urls.map((_, i) => (
            <View key={i} style={[styles.dot, i === imgIdx && styles.dotOn]} />
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.postActions}>
        <Pressable onPress={() => void toggleLike()} hitSlop={8}>
          <Trophy color={liked ? Void.accent : Void.textSecondary} fill={liked ? Void.accent : 'transparent'} size={24} />
        </Pressable>
        <Pressable onPress={() => setCommentsOpen((o) => !o)} hitSlop={8} style={{ marginLeft: 16 }}>
          <MessageCircle color={commentsOpen ? Void.accent : Void.textSecondary} size={24} />
        </Pressable>
      </View>

      {/* Likes + caption - the count opens the liker list on your own posts */}
      <View style={styles.postBody}>
        <Pressable
          disabled={!isOwn || likeCount === 0}
          onPress={() => {
            setLikersOpen(true);
            void listPostLikers(post.id).then(setLikers);
          }}
          hitSlop={4}>
          <Text style={[styles.postLikes, isOwn && likeCount > 0 && { color: Void.accent }]}>
            {likeCount} {likeCount === 1 ? 'trophy' : 'trophies'}
          </Text>
        </Pressable>
        {post.caption && (
          <Text style={styles.postCaption}>
            <Text style={styles.postCaptionName}>{post.author_display_name ?? 'Unknown'}</Text>{' '}
            {post.caption}
          </Text>
        )}
        {commentCount > 0 && !commentsOpen && (
          <Pressable onPress={() => setCommentsOpen(true)}>
            <Text style={styles.postCommentsLink}>View all {commentCount} comment{commentCount === 1 ? '' : 's'}</Text>
          </Pressable>
        )}
      </View>

      {/* Inline comments */}
      {commentsOpen && (
        <View style={styles.commentsSection}>
          {comments.map((c) => (
            <View key={c.id} style={styles.commentRow}>
              <Avatar url={c.author_avatar_url} name={c.author_display_name ?? c.author_username ?? '?'} size={26} />
              <View style={styles.commentBubble}>
                <Text style={styles.commentAuthor}>{c.author_display_name ?? c.author_username ?? 'Unknown'}</Text>
                <Text style={styles.commentText}>{c.text}</Text>
              </View>
            </View>
          ))}
          {comments.length === 0 && <Text style={styles.commentEmpty}>No comments yet.</Text>}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment…"
              placeholderTextColor={Void.textTertiary}
              onSubmitEditing={() => void submitComment()}
            />
            <Pressable onPress={() => void submitComment()} disabled={!commentText.trim()} hitSlop={8}>
              <Send color={commentText.trim() ? Void.accent : Void.textTertiary} size={20} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Post options - centred dialog */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="POST OPTIONS">
        {!isOwn && (
          <>
            <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); onOpenProfile(post.user_id, false); }}>
              <Text style={styles.menuItemText}>View profile</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}>
              <Text style={styles.menuItemText}>Report post</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                void confirm({
                  title: 'Block user?',
                  body: 'They won\'t be able to see your posts or add you as a friend.',
                  confirmText: 'BLOCK',
                  destructive: true,
                }).then((ok) => {
                  if (ok) void blockUser(userId, post.user_id).then(() => notify('Blocked', { body: 'User has been blocked.', tone: 'success' }));
                });
              }}>
              <Text style={[styles.menuItemText, { color: Void.danger }]}>Block user</Text>
            </Pressable>
          </>
        )}
        {isOwn && (
          <Pressable style={styles.menuItem} onPress={() => {
            setMenuOpen(false);
            void confirm({ title: 'Delete post?', body: 'This cannot be undone.', confirmText: 'DELETE', destructive: true })
              .then((ok) => {
                if (ok) void deletePost(userId, post.id).then(() => { onDeleted(); notify('Post deleted', { tone: 'success' }); });
              });
          }}>
            <Text style={[styles.menuItemText, { color: Void.danger }]}>Delete post</Text>
          </Pressable>
        )}
        <Pressable style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={() => setMenuOpen(false)}>
          <Text style={styles.menuItemText}>Cancel</Text>
        </Pressable>
      </Sheet>

      {/* Report reason picker */}
      <Sheet visible={reportOpen} onClose={() => setReportOpen(false)} title="REPORT POST">
        {([
          ['Spam', 'spam'],
          ['Harassment', 'harassment'],
          ['Inappropriate content', 'inappropriate'],
          ['Other', 'other'],
        ] as const).map(([label, reason], i, arr) => (
          <Pressable
            key={reason}
            style={[styles.menuItem, i === arr.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => { setReportOpen(false); report(reason); }}>
            <Text style={styles.menuItemText}>{label}</Text>
          </Pressable>
        ))}
      </Sheet>

      {/* Trophy list - own posts only */}
      <Sheet visible={likersOpen} onClose={() => setLikersOpen(false)} title="TROPHIES">
        <ScrollView style={{ maxHeight: 320 }}>
          {likers.map((l) => (
            <Pressable
              key={l.user_id}
              style={styles.likerRow}
              onPress={() => {
                setLikersOpen(false);
                onOpenProfile(l.user_id, l.user_id === userId);
              }}>
              <Avatar url={l.avatar_url} name={l.display_name ?? l.username ?? '?'} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.likerName}>{l.display_name ?? l.username ?? 'Unknown'}</Text>
                {l.username && <Text style={styles.likerHandle}>@{l.username}</Text>}
              </View>
              <Trophy color={Void.accent} size={14} fill={Void.accent} />
            </Pressable>
          ))}
          {likers.length === 0 && <Text style={styles.commentEmpty}>Loading…</Text>}
        </ScrollView>
      </Sheet>

      {/* Fullscreen zoomable photo viewer */}
      {viewerIdx != null && (
        <PhotoViewer
          urls={post.image_urls.filter((u) => !isVideoMedia(u))}
          aspects={post.image_urls.map((u, i) => ({ u, i })).filter((x) => !isVideoMedia(x.u)).map((x) => post.image_aspects?.[x.i] ?? 0.8)}
          initialIndex={viewerIdx}
          onClose={() => setViewerIdx(null)}
        />
      )}
    </Card>
  );
}

// -- Feed video (muted autoplay loop, sized like images) ---------------------

function FeedVideo({ url, aspect }: { url: string; aspect: number }) {
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View style={[styles.postImage, { aspectRatio: aspect }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <Pressable
        style={styles.videoMuteBtn}
        hitSlop={8}
        onPress={() => {
          const next = !muted;
          player.muted = next;
          setMuted(next);
        }}
      >
        {muted
          ? <VolumeX color="#fff" size={14} />
          : <Volume2 color="#fff" size={14} />}
      </Pressable>
    </View>
  );
}

// -- Avatar ---------------------------------------------------------------

function Avatar({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  const initial = (name[0] ?? '?').toUpperCase();
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" cachePolicy="memory-disk" transition={150} />;
  }
  return (
    <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

// -- Create Post Card (compact onebox at top of feed) ------------------------

type MediaItem = { key: string; uri: string; aspect: number; type: 'image' | 'video' };

/** First-frame thumbnail for a video attachment in the composer. */
function ComposerVideoThumb({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.muted = true; });
  return <VideoView player={player} style={styles.createImage} contentFit="cover" nativeControls={false} />;
}

function CreatePostCard({ userId, open, avatarUrl, avatarName, onClose, onPosted }: {
  userId: string;
  /** External expand request (header + button). */
  open: boolean;
  avatarUrl: string | null;
  avatarName: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [caption, setCaption] = useState('');
  const [gym, setGym] = useState<GymPlace | null>(null);
  const [gymModalOpen, setGymModalOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [tagResults, setTagResults] = useState<UserSearchResult[]>([]);
  const [tagged, setTagged] = useState<UserSearchResult[]>([]);
  const [posting, setPosting] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const mediaCounter = useRef(0);

  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  const reset = () => {
    setMedia([]); setCaption(''); setGym(null);
    setTagOpen(false); setTagQuery(''); setTagged([]); setPosting(false);
  };

  const collapse = () => { reset(); setExpanded(false); onClose(); };

  const pickMedia = async (kind: 'image' | 'video') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { notify('Permission needed', { body: 'Allow photo library access to share posts.', tone: 'error' }); return; }
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'video' ? ['videos'] : ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.8,
        allowsEditing: false,
        // 'compatible' makes iOS transcode the asset - fixes
        // FailedToReadImageException on PNG/iCloud representations.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
    } catch (e) {
      console.warn('[pickMedia]', e);
      notify('Could not read photo', { body: 'That image could not be loaded. Try another one.', tone: 'error' });
      return;
    }
    if (!result.canceled) {
      setMedia((prev) => [
        ...prev,
        ...result.assets.map((a) => ({
          key: `m${mediaCounter.current++}`,
          uri: a.uri,
          aspect: a.width && a.height ? a.width / a.height : (a.type === 'video' ? 16 / 9 : 1),
          type: (a.type === 'video' ? 'video' : 'image') as 'image' | 'video',
        })),
      ].slice(0, 10));
    }
  };

  useEffect(() => {
    if (!tagQuery.trim()) { setTagResults([]); return; }
    const t = setTimeout(() => void searchUsers(tagQuery).then(setTagResults), 300);
    return () => clearTimeout(t);
  }, [tagQuery]);

  const canPost = media.length > 0 || caption.trim().length > 0 || gym != null;

  const post = async () => {
    if (!canPost) { notify('Nothing to post', { body: 'Add a photo, write a caption, or tag a gym.', tone: 'info' }); return; }
    setPosting(true);
    const res = await createPost(userId, {
      imageUris: media.map((m) => m.uri),
      imageAspects: media.map((m) => m.aspect),
      caption,
      taggedUserIds: tagged.map((t) => t.user_id),
      gym,
    });
    if (res.ok) { reset(); setExpanded(false); notify('Posted', { tone: 'success' }); onPosted(); }
    else { notify('Post failed', { body: res.error ?? 'Could not create post. Try again.', tone: 'error' }); setPosting(false); }
  };

  const editingItem = editingKey != null ? media.find((m) => m.key === editingKey) : undefined;

  const renderMediaItem = ({ item, drag, isActive }: RenderItemParams<MediaItem>) => {
    const isCover = media[0]?.key === item.key;
    return (
      <ScaleDecorator activeScale={1.05}>
        <View style={[styles.createImageCell, isActive && { opacity: 0.85 }]}>
          <Pressable
            onLongPress={drag}
            delayLongPress={180}
            disabled={isActive}
            onPress={() => { if (item.type === 'image') setEditingKey(item.key); }}>
            {item.type === 'video'
              ? <ComposerVideoThumb uri={item.uri} />
              : <Image source={{ uri: item.uri }} style={styles.createImage} contentFit="cover" />}
            {item.type === 'image' ? (
              <View style={styles.createImageEdit}>
                <Text style={styles.createImageEditText}>EDIT</Text>
              </View>
            ) : (
              <View style={styles.createImageEdit}>
                <Film color="#fff" size={10} />
              </View>
            )}
          </Pressable>
          <Pressable style={styles.createImageRemove} onPress={() => setMedia((s) => s.filter((m) => m.key !== item.key))}>
            <X color="#fff" size={14} />
          </Pressable>
          {isCover && <View style={styles.createImageBadge}><Text style={styles.createImageBadgeText}>COVER</Text></View>}
        </View>
      </ScaleDecorator>
    );
  };

  if (!expanded) {
    return (
      <Pressable style={[styles.createCard, styles.createCollapsed]} onPress={() => setExpanded(true)}>
        <CardSheen />
        <Avatar url={avatarUrl} name={avatarName} size={30} />
        <Text style={styles.createCollapsedText}>What&apos;s on your mind?</Text>
        <ImagePlus color={Void.textTertiary} size={20} />
      </Pressable>
    );
  }

  return (
    <View style={styles.createCard}>
      <CardSheen />
      {/* Caption row */}
      <View style={styles.createInputRow}>
        <Avatar url={avatarUrl} name={avatarName} size={30} />
        <TextInput
          style={styles.createCaptionInput}
          value={caption}
          onChangeText={setCaption}
          placeholder="What's on your mind?"
          placeholderTextColor={Void.textTertiary}
          multiline
          autoFocus
        />
        <Pressable onPress={collapse} hitSlop={8}>
          <X color={Void.textSecondary} size={20} />
        </Pressable>
      </View>

      {/* Media strip - long-press + drag to reorder */}
      {media.length > 0 && (
        <NestableDraggableFlatList
          horizontal
          data={media}
          keyExtractor={(m) => m.key}
          renderItem={renderMediaItem}
          onDragEnd={({ data }) => setMedia(data)}
          activationDistance={0}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.createMediaStrip}
          ListFooterComponent={
            media.length < 10 ? (
              <Pressable style={styles.createImageAdd} onPress={() => void pickMedia('image')}>
                <Plus color={Void.accent} size={24} />
              </Pressable>
            ) : null
          }
        />
      )}

      {/* Gym tag chip */}
      {gym && (
        <View style={styles.taggedRow}>
          <View style={styles.tagChip}>
            <MapPin color={Void.accent} size={12} />
            <Text style={styles.tagChipText} numberOfLines={1}>{gym.name}</Text>
            <Pressable onPress={() => setGym(null)} hitSlop={6}>
              <X color={Void.accent} size={12} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Tagged friends chips */}
      {tagged.length > 0 && (
        <View style={styles.taggedRow}>
          {tagged.map((t) => (
            <View key={t.user_id} style={styles.tagChip}>
              <Text style={styles.tagChipText} numberOfLines={1}>@{t.username || t.display_name || 'user'}</Text>
              <Pressable onPress={() => setTagged((s) => s.filter((x) => x.user_id !== t.user_id))} hitSlop={6}>
                <X color={Void.accent} size={12} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Friend-tag search (toggled by the UserPlus icon) */}
      {tagOpen && (
        <View>
          <TextInput
            style={styles.createTagInput}
            value={tagQuery}
            onChangeText={setTagQuery}
            placeholder="Search by username…"
            placeholderTextColor={Void.textTertiary}
            autoCapitalize="none"
          />
          {tagResults.length > 0 && (
            <View style={styles.tagResults}>
              {tagResults.slice(0, 5).map((u) => (
                <Pressable
                  key={u.user_id}
                  style={styles.tagResult}
                  onPress={() => { setTagged((s) => [...s.filter((x) => x.user_id !== u.user_id), u]); setTagQuery(''); setTagResults([]); }}>
                  <Avatar url={u.avatar_url} name={u.display_name ?? u.username ?? '?'} size={28} />
                  <Text style={styles.tagResultName}>{u.display_name ?? u.username}</Text>
                  <Plus color={Void.accent} size={16} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Icon action bar */}
      <View style={styles.createActionBar}>
        <Pressable onPress={() => void pickMedia('image')} hitSlop={8}>
          <ImagePlus color={media.some((m) => m.type === 'image') ? Void.accent : Void.textTertiary} size={20} />
        </Pressable>
        <Pressable onPress={() => void pickMedia('video')} hitSlop={8} style={styles.createActionIcon}>
          <Film color={media.some((m) => m.type === 'video') ? Void.accent : Void.textTertiary} size={20} />
        </Pressable>
        <Pressable onPress={() => setGymModalOpen(true)} hitSlop={8} style={styles.createActionIcon}>
          <MapPin color={gym ? Void.accent : Void.textTertiary} size={20} />
        </Pressable>
        <Pressable onPress={() => setTagOpen((o) => !o)} hitSlop={8} style={styles.createActionIcon}>
          <UserPlus color={tagOpen || tagged.length > 0 ? Void.accent : Void.textTertiary} size={20} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          style={[styles.createSubmitBtn, (posting || !canPost) && { opacity: 0.4 }]}
          disabled={posting || !canPost}
          onPress={() => void post()}>
          <Text style={styles.createSubmitBtnText}>{posting ? 'POSTING…' : 'POST'}</Text>
        </Pressable>
      </View>

      <PhotoEditorModal
        visible={editingItem != null}
        imageUri={editingItem?.uri ?? null}
        onSave={(uri) => {
          const key = editingKey;
          setMedia((s) => s.map((m) => (m.key === key ? { ...m, uri } : m)));
          RNImage.getSize(uri, (w, h) => {
            if (w && h) setMedia((s) => s.map((m) => (m.key === key ? { ...m, aspect: w / h } : m)));
          }, () => {});
          setEditingKey(null);
        }}
        onClose={() => setEditingKey(null)}
      />
      <GymSearchModal
        visible={gymModalOpen}
        onClose={() => setGymModalOpen(false)}
        onPick={(g) => { setGym(g); setGymModalOpen(false); }}
      />
    </View>
  );
}

// -- Profile Modal ---------------------------------------------------------

type ProfileTab = 'posts' | 'liked';

function ProfileModal({ visible, targetUserId, isOwn, currentUserId, friends, onClose, onOpenProfile }: {
  visible: boolean;
  targetUserId: string | null;
  isOwn: boolean;
  currentUserId: string;
  friends: Friend[];
  onClose: () => void;
  onOpenProfile: (uid: string, isOwn: boolean) => void;
}) {
  const unit = useSettings((s) => s.weight_unit);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [likedPosts, setLikedPosts] = useState<FeedPost[]>([]);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [postCount, setPostCount] = useState(0);
  const [friendCount, setFriendCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [profileTier, setProfileTier] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pbs, setPbs] = useState<{ name: string; exercise_id: string; record_type: string; weight_kg: number; reps: number }[]>([]);
  const [allLifts, setAllLifts] = useState<{ exerciseId: string; name: string; recordType: string; weight_kg: number; reps: number; label: string }[]>([]);
  const [targetFriends, setTargetFriends] = useState<FriendWithAvatar[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [routineInvites, setRoutineInvites] = useState<RoutineInvite[]>([]);
  const [view, setView] = useState<'profile' | 'friends'>('profile');
  const [saving, setSaving] = useState(false);
  const lastTarget = useRef<string | null>(null);

  // Pending requests in both directions - live while the modal is open.
  useEffect(() => {
    if (!visible) return;
    return subscribeToFriendRequests(currentUserId, (inc, out) => {
      setIncoming(inc);
      setOutgoing(out);
    });
  }, [visible, currentUserId]);

  // Pending routine-collab invites - live while the modal is open.
  useEffect(() => {
    if (!visible) return;
    return subscribeToRoutineInvites(currentUserId, setRoutineInvites);
  }, [visible, currentUserId]);

  useEffect(() => {
    if (!visible || !targetUserId) return;
    // Only reset view state when switching to a different profile - iOS can
    // remount this modal when the image picker presents, and we don't want a
    // remount to exit edit mode.
    const isNewTarget = lastTarget.current !== targetUserId;
    lastTarget.current = targetUserId;
    if (isNewTarget) {
      setTab('posts');
      setView('profile');
      setEditMode(false);
    }
    void getUserPosts(targetUserId, currentUserId).then(setPosts);
    void getPostCount(targetUserId).then(setPostCount);
    void getFriendCount(targetUserId).then(setFriendCount);
    void listFriendsWithAvatars(targetUserId).then(setTargetFriends);
    void getSupabaseProfile(targetUserId).then((p) => {
      if (!p) return;
      setDisplayName(p.display_name ?? '');
      setUsername(p.username ?? '');
      setBio(p.bio ?? '');
      setAvatarUri(p.avatar_url);
      setProfileTier(p.void_tier);
      if (p.fav_pbs.length > 0) setPbs(p.fav_pbs);
    });
    if (isOwn) {
      void listLikedPosts(currentUserId).then(setLikedPosts);
      // Load all PRs (incl. bodyweight rep records) so the user can pick 3.
      void personalBests(60).then((lifts) => {
        const all = lifts.map((l) => ({ exerciseId: l.exerciseId, name: l.name, recordType: l.recordType, weight_kg: l.weight_kg, reps: l.reps, label: l.label }));
        setAllLifts(all);
        // Auto-select top 3 only if nothing stored yet.
        setPbs((prev) => (prev.length === 0 ? all.slice(0, 3).map((l) => ({ name: l.name, exercise_id: l.exerciseId, record_type: l.recordType, weight_kg: l.weight_kg, reps: l.reps })) : prev));
      });
    } else {
      void isBlocked(currentUserId, targetUserId).then(setBlocked);
    }
  }, [visible, targetUserId, currentUserId, isOwn]);

  const isFriend = friends.some((f) => f.user_id === targetUserId);
  const gridPosts = tab === 'posts' ? posts : likedPosts;

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1], preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (!result.canceled) setAvatarUri(result.assets[0].uri);
    } catch (e) {
      console.warn('[pickAvatar]', e);
      notify('Could not read photo', { body: 'That image could not be loaded. Try another one.', tone: 'error' });
    }
  };

  const saveProfile = async () => {
    if (!targetUserId) return;
    setSaving(true);
    let avatarUrl: string | null | undefined;
    if (avatarUri && !avatarUri.startsWith('http')) avatarUrl = await uploadAvatar(targetUserId, avatarUri);
    await updateSupabaseProfile(targetUserId, {
      display_name: displayName,
      username,
      bio,
      fav_pbs: pbs,
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    });
    // Write back to local_profile too - otherwise the next sync re-pushes the
    // stale local display_name and clobbers this edit.
    if (isOwn) useSettings.getState().set({ display_name: displayName });
    setSaving(false);
    setEditMode(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
        {/* Confirms/notifies fired inside this modal (delete account, remove
            friend, block) need a host INSIDE the presented VC - the root
            host's Sheet renders beneath this Modal and eats all touches
            invisibly. */}
        <NotifyHost />
        {/* Header */}
        <View style={styles.profileHeader}>
          <Pressable onPress={view === 'friends' ? () => setView('profile') : onClose} hitSlop={8}>
            <ChevronLeft color={Void.text} size={26} />
          </Pressable>
          <Text style={styles.profileTitle}>{view === 'friends' ? 'FRIENDS' : isOwn ? 'YOUR PROFILE' : 'PROFILE'}</Text>
          {view === 'friends' ? (
            <View style={{ width: 40 }} />
          ) : isOwn && !editMode ? (
            <Pressable onPress={() => setEditMode(true)} hitSlop={8}>
              <Text style={styles.profileEditBtn}>EDIT</Text>
            </Pressable>
          ) : isOwn && editMode ? (
            <Pressable onPress={() => void saveProfile()} disabled={saving}>
              <Text style={[styles.profileEditBtn, saving && { opacity: 0.4 }]}>{saving ? 'SAVING…' : 'SAVE'}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        {view === 'friends' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Routine-collab invites - accepting pulls the shared routine
                tree into the local DB so it lands on the Train tab. */}
            {isOwn && routineInvites.length > 0 && (
              <>
                <Text style={styles.requestsLabel}>ROUTINE INVITES</Text>
                {routineInvites.map((inv) => (
                  <View key={inv.id} style={styles.friendListRow}>
                    <View style={styles.friendListMain}>
                      <Avatar url={null} name={inv.routine_title ?? '?'} size={44} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.friendListName} numberOfLines={1}>{inv.routine_title ?? 'Routine'}</Text>
                        <Text style={styles.friendListUsername} numberOfLines={1}>
                          from {inv.inviter_name ?? (inv.inviter_username ? `@${inv.inviter_username}` : 'a friend')}
                        </Text>
                        <Text style={styles.friendListUsername} numberOfLines={2}>
                          Accepting shares your logged weights, reps and sets on shared workouts.
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      style={styles.friendActionBtn}
                      onPress={() => {
                        void acceptRoutineInvite(inv).then((res) => {
                          if (res.ok) {
                            notify('Routine shared with you', { body: `${inv.routine_title ?? 'Routine'} is in My Routines - you can edit it.`, tone: 'success' });
                          } else {
                            notify('Could not accept', { body: res.error ?? 'Try again.', tone: 'error' });
                          }
                        });
                      }}>
                      <Text style={styles.friendActionAccept}>ACCEPT</Text>
                    </Pressable>
                    <Pressable
                      style={styles.friendActionBtn}
                      onPress={() => void declineRoutineInvite(inv.id)}>
                      <Text style={styles.friendActionRemove}>DECLINE</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
            {/* Pending requests - own profile only; accepting creates the
                friendship both directions via accept_friend_request. */}
            {isOwn && incoming.length > 0 && (
              <>
                <Text style={styles.requestsLabel}>REQUESTS</Text>
                {incoming.map((r) => (
                  <View key={r.user_id} style={styles.friendListRow}>
                    <Pressable style={styles.friendListMain} onPress={() => onOpenProfile(r.user_id, false)}>
                      <Avatar url={r.avatar_url} name={r.display_name ?? r.username ?? '?'} size={44} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.friendListName} numberOfLines={1}>{r.display_name ?? 'Unknown'}<TierBadge tier={r.void_tier} /></Text>
                        {r.username ? <Text style={styles.friendListUsername} numberOfLines={1}>@{r.username}</Text> : null}
                      </View>
                    </Pressable>
                    <Pressable
                      style={styles.friendActionBtn}
                      onPress={() => {
                        void acceptFriendRequest(r.user_id).then((res) => {
                          if (res.ok) {
                            void listFriendsWithAvatars(targetUserId!).then(setTargetFriends);
                            setFriendCount((c) => c + 1);
                            notify('Friend added', { body: 'You can now see each other\'s posts and stats.', tone: 'success' });
                          } else {
                            notify('Could not accept', { body: res.error ?? 'Try again.', tone: 'error' });
                          }
                        });
                      }}>
                      <Text style={styles.friendActionAccept}>ACCEPT</Text>
                    </Pressable>
                    <Pressable
                      style={styles.friendActionBtn}
                      onPress={() => void declineFriendRequest(currentUserId, r.user_id)}>
                      <Text style={styles.friendActionRemove}>DECLINE</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
            {isOwn && outgoing.length > 0 && (
              <>
                <Text style={styles.requestsLabel}>SENT</Text>
                {outgoing.map((r) => (
                  <View key={r.user_id} style={styles.friendListRow}>
                    <Pressable style={styles.friendListMain} onPress={() => onOpenProfile(r.user_id, false)}>
                      <Avatar url={r.avatar_url} name={r.display_name ?? r.username ?? '?'} size={44} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.friendListName} numberOfLines={1}>{r.display_name ?? 'Unknown'}<TierBadge tier={r.void_tier} /></Text>
                        {r.username ? <Text style={styles.friendListUsername} numberOfLines={1}>@{r.username}</Text> : null}
                      </View>
                    </Pressable>
                    <Pressable
                      style={styles.friendActionBtn}
                      onPress={() => void cancelFriendRequest(currentUserId, r.user_id)}>
                      <Text style={styles.friendActionRemove}>CANCEL</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
            {(incoming.length > 0 || outgoing.length > 0) && isOwn && <Text style={styles.requestsLabel}>FRIENDS</Text>}
            {targetFriends.length === 0 ? (
              <Text style={styles.profileNoPosts}>No friends yet.</Text>
            ) : (
              targetFriends.map((f) => (
                <View key={f.user_id} style={styles.friendListRow}>
                  <Pressable style={styles.friendListMain} onPress={() => onOpenProfile(f.user_id, f.user_id === currentUserId)}>
                    <Avatar url={f.avatar_url} name={f.display_name ?? f.username ?? '?'} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.friendListName} numberOfLines={1}>{f.display_name ?? 'Unknown'}<TierBadge tier={f.void_tier} /></Text>
                      {f.username ? <Text style={styles.friendListUsername} numberOfLines={1}>@{f.username}</Text> : null}
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.friendActionBtn}
                    onPress={() => {
                      void confirm({ title: 'Remove friend?', body: 'You will no longer see their posts.', confirmText: 'REMOVE', destructive: true })
                        .then((ok) => {
                          if (ok) void removeFriend(currentUserId, f.user_id).then(() => { setTargetFriends((s) => s.filter((x) => x.user_id !== f.user_id)); setFriendCount((c) => Math.max(0, c - 1)); });
                        });
                    }}>
                    <Text style={styles.friendActionRemove}>REMOVE</Text>
                  </Pressable>
                  <Pressable
                    style={styles.friendActionBtn}
                    onPress={() => {
                      void confirm({ title: 'Block user?', body: 'They won\'t see your posts or add you.', confirmText: 'BLOCK', destructive: true })
                        .then((ok) => {
                          if (ok) void blockUser(currentUserId, f.user_id).then(() => { setTargetFriends((s) => s.filter((x) => x.user_id !== f.user_id)); setFriendCount((c) => Math.max(0, c - 1)); });
                        });
                    }}>
                    <Text style={styles.friendActionBlock}>BLOCK</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        ) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Avatar + stats */}
          <View style={styles.profileTop}>
            <Pressable onPress={isOwn && editMode ? () => void pickAvatar() : undefined}>
              <Avatar url={avatarUri} name={displayName || '?'} size={80} />
              {isOwn && editMode && (
                <View style={styles.avatarEditBadge}>
                  <Camera color={Void.accentText} size={12} />
                </View>
              )}
            </Pressable>
            <View style={styles.profileStats}>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatVal}>{postCount}</Text>
                <Text style={styles.profileStatLabel}>POSTS</Text>
              </View>
              <Pressable style={styles.profileStat} onPress={() => setView('friends')} hitSlop={8}>
                <Text style={styles.profileStatVal}>{friendCount}</Text>
                <Text style={styles.profileStatLabel}>FRIENDS</Text>
              </Pressable>
            </View>
          </View>

          {/* Name + bio */}
          {isOwn && editMode ? (
            <View style={styles.profileEditSection}>
              <TextInput style={styles.profileEditInput} value={displayName} onChangeText={setDisplayName} placeholder="Display name" placeholderTextColor={Void.textTertiary} />
              <TextInput style={styles.profileEditInput} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={Void.textTertiary} autoCapitalize="none" />
              <TextInput style={[styles.profileEditInput, { minHeight: 60 }]} value={bio} onChangeText={setBio} placeholder="Bio" placeholderTextColor={Void.textTertiary} multiline textAlignVertical="top" />

              {/* PB picker */}
              {allLifts.length > 0 && (
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.pbPickerLabel}>FAVOURITE PBs (pick up to 3)</Text>
                  <ScrollView style={styles.pbList} nestedScrollEnabled>
                    {allLifts.map((l) => {
                      const selected = pbs.some((p) => p.exercise_id === l.exerciseId && p.record_type === l.recordType);
                      return (
                        <Pressable
                          key={`${l.exerciseId}:${l.recordType}`}
                          style={[styles.pbRow, selected && styles.pbRowActive]}
                          onPress={() => {
                            if (selected) setPbs((s) => s.filter((p) => !(p.exercise_id === l.exerciseId && p.record_type === l.recordType)));
                            else if (pbs.length < 3) setPbs((s) => [...s, { name: l.name, exercise_id: l.exerciseId, record_type: l.recordType, weight_kg: l.weight_kg, reps: l.reps }]);
                          }}>
                          <View style={[styles.pbCheck, selected && styles.pbCheckActive]}>
                            {selected && <Check color={Void.accentText} size={12} />}
                          </View>
                          <Text style={[styles.pbRowName, selected && { color: Void.accent }]} numberOfLines={1}>{l.name}</Text>
                          <Text style={styles.pbRowValue} numberOfLines={1}>
                            {l.recordType === 'max_reps' ? `${l.reps} reps` : `${Math.round(l.weight_kg * (unit === 'lbs' ? 2.20462 : 1))}${unit} · ${l.label}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <Pressable
                style={styles.deleteAccountBtn}
                onPress={() => {
                  void confirm({
                    title: 'Delete account?',
                    body: 'Your account and all synced data will be permanently deleted, and local data on this device will be wiped.',
                    confirmText: 'DELETE ACCOUNT',
                    destructive: true,
                  }).then((ok) => {
                    if (!ok) return;
                    void (async () => {
                      // The confirm Sheet is an RN Modal still mid-dismiss -
                      // closing the profile Modal in the same window strands
                      // its view controller and eats every touch.
                      await new Promise((r) => setTimeout(r, 350));
                      const deleted = await deleteAccount();
                      if (deleted) {
                        useSettings.getState().set({ supabase_user_id: null });
                        onClose();
                      } else {
                        notify('Failed', { body: 'Could not delete account. Try again.', tone: 'error' });
                      }
                    })();
                  });
                }}>
                <Text style={styles.deleteAccountText}>Delete account</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{displayName || 'Unknown'}<TierBadge tier={profileTier} /></Text>
              {username ? <Text style={styles.profileUsername}>@{username}</Text> : null}
              {bio ? <Text style={styles.profileBio}>{bio}</Text> : null}
            </View>
          )}

          {/* Trophy case */}
          {pbs.length > 0 && (
            <View style={styles.pbsRow}>
              {pbs.map((pb) => (
                <View key={`${pb.exercise_id}:${pb.record_type}`} style={styles.pbChip}>
                  <View style={styles.pbTrophy}>
                    <Trophy color={Void.accent} size={22} />
                  </View>
                  <Text style={styles.pbWeight} numberOfLines={1}>
                    {pb.record_type === 'max_reps'
                      ? `${pb.reps} reps`
                      : `${Math.round(pb.weight_kg * (unit === 'lbs' ? 2.20462 : 1))}${unit}`}
                  </Text>
                  <Text style={styles.pbName} numberOfLines={1}>{pb.name}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions for other people's profiles */}
          {!isOwn && (
            <View style={styles.profileActions}>
              {isFriend ? (
                <>
                  <Pressable style={[styles.profileActionBtn, styles.profileActionPrimary]}>
                    <Text style={styles.profileActionPrimaryText}>FRIENDS</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.profileActionBtn, styles.profileActionDanger]}
                    onPress={() => {
                      void confirm({ title: 'Remove friend?', body: 'You will no longer see their posts.', confirmText: 'REMOVE', destructive: true })
                        .then((ok) => {
                          if (ok) void removeFriend(currentUserId, targetUserId!).then(onClose);
                        });
                    }}>
                    <Text style={styles.profileActionDangerText}>REMOVE</Text>
                  </Pressable>
                </>
              ) : blocked ? (
                <Pressable
                  style={[styles.profileActionBtn, styles.profileActionPrimary]}
                  onPress={() => void unblockUser(currentUserId, targetUserId!).then(() => { setBlocked(false); notify('Unblocked', { body: 'User has been unblocked.', tone: 'success' }); })}>
                  <Text style={styles.profileActionPrimaryText}>UNBLOCK</Text>
                </Pressable>
              ) : (
                <>
                  {incoming.some((r) => r.user_id === targetUserId) ? (
                    <Pressable
                      style={[styles.profileActionBtn, styles.profileActionPrimary]}
                      onPress={() => {
                        void acceptFriendRequest(targetUserId!).then((res) => {
                          if (res.ok) notify('Friend added', { body: 'You can now see each other\'s posts and stats.', tone: 'success' });
                        });
                      }}>
                      <Text style={styles.profileActionPrimaryText}>ACCEPT REQUEST</Text>
                    </Pressable>
                  ) : outgoing.some((r) => r.user_id === targetUserId) ? (
                    <Pressable
                      style={[styles.profileActionBtn, styles.profileActionDanger]}
                      onPress={() => void cancelFriendRequest(currentUserId, targetUserId!)}>
                      <Text style={styles.profileActionDangerText}>REQUESTED · CANCEL</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.profileActionBtn, styles.profileActionPrimary]}
                      onPress={() => {
                        void sendFriendRequestById(currentUserId, targetUserId!).then((res) => {
                          if (res.ok) {
                            notify(res.accepted ? 'Friend added' : 'Request sent', { body: res.accepted ? 'You can now see each other\'s posts and stats.' : 'They\'ll need to accept it first.', tone: 'success' });
                          } else {
                            notify('Could not send', { body: res.error ?? 'Try again.', tone: 'error' });
                          }
                        });
                      }}>
                      <Text style={styles.profileActionPrimaryText}>ADD FRIEND</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.profileActionBtn, styles.profileActionDanger]}
                    onPress={() => {
                      void confirm({ title: 'Block user?', body: 'They won\'t see your posts or add you.', confirmText: 'BLOCK', destructive: true })
                        .then((ok) => {
                          if (ok) void blockUser(currentUserId, targetUserId!).then(() => { setBlocked(true); notify('Blocked', { body: 'User blocked.', tone: 'success' }); });
                        });
                    }}>
                    <Text style={styles.profileActionDangerText}>BLOCK</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {/* Posts / Liked tabs */}
          <View style={styles.profileTabs}>
            <Pressable onPress={() => setTab('posts')} style={styles.profileTab}>
              <Text style={[styles.profileTabText, tab === 'posts' && styles.profileTabTextActive]}>POSTS</Text>
              {tab === 'posts' && <View style={styles.profileTabBar} />}
            </Pressable>
            {isOwn && (
              <Pressable onPress={() => setTab('liked')} style={styles.profileTab}>
                <Text style={[styles.profileTabText, tab === 'liked' && styles.profileTabTextActive]}>LIKED</Text>
                {tab === 'liked' && <View style={styles.profileTabBar} />}
              </Pressable>
            )}
          </View>
          {gridPosts.length === 0 ? (
            <Text style={styles.profileNoPosts}>{tab === 'posts' ? 'No posts yet.' : 'No liked posts.'}</Text>
          ) : (
            <View style={styles.profileGrid}>
              {gridPosts.map((p) => (
                <Pressable key={p.id} style={styles.profileGridCell}>
                  {p.image_urls[0] && <Image source={{ uri: p.image_urls[0] }} style={styles.profileGridImage} contentFit="cover" cachePolicy="memory-disk" transition={150} />}
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
        )}
        </View>
      </View>
    </Modal>
  );
}

// -- Styles ---------------------------------------------------------------

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 16 },
  modalSheet: { backgroundColor: Void.surface, borderRadius: 14, borderWidth: 1, borderColor: Void.border, flex: 1, maxHeight: '88%', overflow: 'hidden' },
  signInWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  signInTitle: { color: Void.text, fontSize: 22, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  signInBody: { color: Void.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  appleBtn: { width: '100%', backgroundColor: Void.text, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  appleBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  googleBtn: { width: '100%', backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  googleBtnText: { color: Void.text, fontWeight: '700', fontSize: 15 },
  signInDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', marginVertical: 18 },
  signInDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Void.border },
  signInDividerText: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  signInEmailInput: { width: '100%', backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: Void.text, fontSize: 14, marginBottom: 8 },
  signInErr: { color: Void.danger, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  signInBtn: { width: '100%', backgroundColor: Void.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  signInBtnText: { color: Void.accentText, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  forgotLink: { alignSelf: 'flex-end', marginBottom: 8 },
  forgotText: { color: Void.textTertiary, fontSize: 11 },
  forgotBtn: { width: '100%', borderWidth: 1, borderColor: Void.border, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  forgotBtnText: { color: Void.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  modeSwitch: { marginTop: 14, alignSelf: 'center' },
  modeSwitchText: { color: Void.textSecondary, fontSize: 12, textAlign: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: Void.text, fontSize: 20, fontWeight: '900', marginBottom: 8 },
  emptyBody: { color: Void.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  codeLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  codeText: { color: Void.accent, fontSize: 28, fontWeight: '900', letterSpacing: 6, ...tabular },
  copyBtn: { padding: 8 },
  addRow: { flexDirection: 'row', gap: 8 },
  addInput: { flex: 1, backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: Void.text, fontSize: 16, letterSpacing: 2 },
  addBtn: { backgroundColor: Void.accent, borderRadius: 10, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: Void.accentText, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  emptyFeed: { paddingVertical: 40, alignItems: 'center' },
  emptyFeedText: { color: Void.textTertiary, fontSize: 14, textAlign: 'center' },
  // Map entry row → /map
  mapEntry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  mapEntryIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: Void.accentDim, alignItems: 'center', justifyContent: 'center' },
  mapEntryTitle: { color: Void.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  mapEntrySub: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  // Post card
  postHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  postAuthor: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postName: { color: Void.text, fontSize: 14, fontWeight: '700' },
  postTime: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  postImages: {
    width: Dimensions.get('window').width - 32,
    marginHorizontal: -14,
    backgroundColor: Void.canvas,
  },
  postImage: { width: Dimensions.get('window').width - 32 },
  videoMuteBtn: {
    position: 'absolute', right: 8, bottom: 8, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  postGymName: { color: Void.accent, fontWeight: '700' },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Void.border },
  dotOn: { backgroundColor: Void.accent },
  postActions: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  postBody: { paddingHorizontal: 12, paddingBottom: 12 },
  postLikes: { color: Void.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  postCaption: { color: Void.text, fontSize: 13, lineHeight: 18 },
  postTaggedName: { color: Void.accent, fontWeight: '700' },
  postCaptionName: { fontWeight: '700' },
  postCommentsLink: { color: Void.textTertiary, fontSize: 12, marginTop: 4 },
  // Menu (inside Sheet dialog)
  menuItem: { paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border, alignItems: 'center' },
  menuItemText: { color: Void.text, fontSize: 15, fontWeight: '600' },
  // Avatar
  avatarPlaceholder: { backgroundColor: Void.accentDim, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Void.accent, fontWeight: '800' },
  // Create post (compact onebox card)
  createCard: { ...cardChrome, borderRadius: 12, padding: 12, marginHorizontal: 16, marginBottom: 12 },
  createCollapsed: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  createCollapsedText: { flex: 1, color: Void.textTertiary, fontSize: 14 },
  createInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  createCaptionInput: { flex: 1, color: Void.text, fontSize: 14, paddingTop: 4, paddingBottom: 4, minHeight: 32, maxHeight: 120 },
  createMediaStrip: { gap: 6, paddingTop: 10, paddingBottom: 2 },
  createImageCell: { width: 72, height: 72, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  createImage: { width: '100%', height: '100%' },
  createImageRemove: { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  createImageBadge: { position: 'absolute', bottom: 3, left: 3, backgroundColor: Void.accent, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  createImageBadgeText: { color: Void.accentText, fontSize: 8, fontWeight: '800' },
  createImageEdit: { position: 'absolute', bottom: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3 },
  createImageEditText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  createImageAdd: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: Void.border, alignItems: 'center', justifyContent: 'center' },
  createActionBar: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  createActionIcon: { marginLeft: 18 },
  createSubmitBtn: { backgroundColor: Void.accent, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 7 },
  createSubmitBtnText: { color: Void.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  createTagInput: { backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: Void.text, fontSize: 14, marginTop: 8 },
  taggedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Void.accentDim, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  tagChipText: { color: Void.accent, fontSize: 12, fontWeight: '700' },
  tagResults: { marginTop: 4, borderRadius: 10, backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, overflow: 'hidden' },
  tagResult: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  tagResultName: { flex: 1, color: Void.text, fontSize: 14, fontWeight: '600' },
  // Profile
  profileWrap: { flex: 1 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Void.border },
  profileTitle: { color: Void.text, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  profileEditBtn: { color: Void.accent, fontSize: 14, fontWeight: '800' },
  profileTop: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 20 },
  profileStats: { flex: 1, flexDirection: 'row', gap: 24 },
  profileStat: { alignItems: 'center' },
  profileStatVal: { color: Void.text, fontSize: 22, fontWeight: '900', ...tabular },
  profileStatLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  profileInfo: { paddingHorizontal: 16, paddingBottom: 8 },
  profileName: { color: Void.text, fontSize: 18, fontWeight: '800' },
  profileUsername: { color: Void.textSecondary, fontSize: 14, marginTop: 2 },
  profileBio: { color: Void.textSecondary, fontSize: 14, marginTop: 6, lineHeight: 20 },
  profileEditSection: { paddingHorizontal: 16, paddingBottom: 8 },
  profileEditInput: { backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: Void.text, fontSize: 14, marginBottom: 8 },
  profileActions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  profileActionBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1 },
  profileActionPrimary: { backgroundColor: Void.accent, borderColor: Void.accent },
  profileActionPrimaryText: { color: Void.accentText, fontSize: 13, fontWeight: '800' },
  profileActionDanger: { borderColor: Void.border },
  profileActionDangerText: { color: Void.textSecondary, fontSize: 13, fontWeight: '800' },
  profileNoPosts: { color: Void.textTertiary, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  profileGridCell: { width: '32.5%', aspectRatio: 1 },
  profileGridImage: { width: '100%', height: '100%' },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: Void.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Void.surface },
  pbsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  pbChip: { flex: 1, backgroundColor: Void.canvas, borderRadius: 10, borderWidth: 1, borderColor: Void.border, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  pbTrophy: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: Void.accent, backgroundColor: Void.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  pbWeight: { color: Void.accent, fontSize: 15, fontWeight: '800', ...tabular },
  pbName: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', marginTop: 2 },
  pbPickerLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  deleteAccountBtn: { marginTop: 20, alignItems: 'center', paddingVertical: 10 },
  deleteAccountText: { color: Void.danger, fontSize: 13, fontWeight: '700' },
  pbList: { borderRadius: 10, borderWidth: 1, borderColor: Void.border, maxHeight: 190 },
  pbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border, backgroundColor: Void.canvas },
  pbRowActive: { backgroundColor: Void.accentDim },
  pbCheck: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Void.border, alignItems: 'center', justifyContent: 'center' },
  pbCheckActive: { backgroundColor: Void.accent, borderColor: Void.accent },
  pbRowName: { flex: 1, color: Void.text, fontSize: 13, fontWeight: '600' },
  pbRowValue: { color: Void.textTertiary, fontSize: 12, fontWeight: '700', ...tabular },
  friendsRow: { gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  friendCell: { alignItems: 'center', width: 64 },
  friendName: { color: Void.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  friendListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  friendListMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  friendListName: { color: Void.text, fontSize: 15, fontWeight: '700' },
  friendListUsername: { color: Void.textTertiary, fontSize: 12, marginTop: 1 },
  friendActionBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  friendActionAccept: { color: Void.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  friendActionRemove: { color: Void.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  friendActionBlock: { color: Void.danger, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  requestsLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginTop: 8, marginBottom: 8 },
  profileTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Void.border, marginTop: 16 },
  profileTab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  profileTabText: { color: Void.textTertiary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  profileTabTextActive: { color: Void.accent },
  profileTabBar: { position: 'absolute', bottom: -1, left: '20%', right: '20%', height: 2, backgroundColor: Void.accent },
  // Comments
  commentsWrap: { flex: 1 },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Void.border },
  commentsTitle: { color: Void.text, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  commentsSection: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  commentsEmpty: { color: Void.textTertiary, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  commentEmpty: { color: Void.textTertiary, fontSize: 13, paddingVertical: 10 },
  commentRow: { flexDirection: 'row', gap: 10, marginBottom: 12, marginTop: 8 },
  likerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  likerName: { color: Void.text, fontSize: 14, fontWeight: '700' },
  likerHandle: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  commentBubble: { flex: 1, backgroundColor: Void.canvas, borderRadius: 12, borderWidth: 1, borderColor: Void.border, paddingHorizontal: 12, paddingVertical: 8 },
  commentAuthor: { color: Void.accent, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  commentText: { color: Void.text, fontSize: 14, lineHeight: 19 },
  commentName: { fontWeight: '700' },
  commentTime: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10 },
  commentInput: { flex: 1, backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: Void.text, fontSize: 14 },
});
