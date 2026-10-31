import type { RealtimeChannel } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { useSettings } from '@/store/settings';
import { getSupabase } from '@/supabase/client';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

// -- Privacy helpers ----------------------------------------------------------

/** Round to 2 decimal places (~1.1 km). Exact check-in coordinates are a
 *  stalker vector - the map only needs the gym's rough position. */
const fuzzCoord = (v: number | null | undefined): number | null =>
  v == null ? null : Math.round(v * 100) / 100;

/** How long a signed photo URL stays valid (1 hour). */
const PHOTO_URL_TTL = 3600;

/**
 * Signed-URL cache. Feeds/maps re-sign every stored path on every refresh;
 * the URLs are valid for an hour, so reuse them for ~50 min instead of
 * burning a Storage API call per image per poll.
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

/**
 * Photo columns store storage object paths in private buckets; rows written
 * before the switch still hold public URLs. Resolve either form to a signed
 * URL at read time - legacy `.../object/public/<bucket>/<path>` URLs have
 * their path extracted and re-signed so old photos keep working once the
 * bucket goes private.
 */
async function signStoredPhoto(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  bucket: string,
  stored: string | null
): Promise<string | null> {
  if (!stored) return null;
  let path = stored;
  if (stored.startsWith('http')) {
    const m = stored.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
    if (!m) return stored; // external URL - leave alone
    path = decodeURIComponent(m[1]);
  }
  const cacheKey = `${bucket}:${path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data } = await sb.storage.from(bucket).createSignedUrl(path, PHOTO_URL_TTL);
  const url = data?.signedUrl ?? null;
  if (url) signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
  return url;
}

const signMany = (
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  bucket: string,
  stored: (string | null)[]
) => Promise.all(stored.map((s) => signStoredPhoto(sb, bucket, s)));

/** Signed URLs for a photo list - drops any that fail to sign. */
const signList = async (
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  bucket: string,
  stored: (string | null)[]
): Promise<string[]> => (await signMany(sb, bucket, stored)).filter((u): u is string => u != null);

/**
 * Trailing-edge debounce for realtime refresh callbacks. Unfiltered
 * postgres_changes events arrive once per write anywhere in the table - a
 * like-storm on one post must collapse into a single refetch, not one per
 * event.
 */
const debounce = (fn: () => void, ms = 800) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};

// -- Types ------------------------------------------------------------------

export interface Friend {
  user_id: string;
  display_name: string | null;
  username: string | null;
}

export interface PublicStats {
  week_volume_kg: number;
  week_workouts: number;
  week_calories: number;
  week_steps: number;
  bench_1rm: number | null;
  squat_1rm: number | null;
  deadlift_1rm: number | null;
}

export interface FriendStats extends PublicStats {
  user_id: string;
  display_name: string | null;
}

export interface GymCheckinInput {
  gym_name: string;
  lat?: number | null;
  lng?: number | null;
  photo_uri?: string | null;
  note?: string | null;
}

export interface GymCheckin {
  id: string;
  user_id: string;
  gym_name: string;
  lat: number | null;
  lng: number | null;
  photo_url: string | null;
  note: string | null;
  created_at: string;
  display_name: string | null;
}

export interface PhotoInput {
  uri: string;
  caption?: string | null;
  tagged_user_ids?: string[];
}

export interface SharedPhoto {
  id: string;
  user_id: string;
  url: string;
  caption: string | null;
  tagged_user_ids: string[];
  created_at: string;
  display_name: string | null;
}

// -- Friend codes -----------------------------------------------------------

export async function getOrCreateFriendCode(userId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('friend_codes').select('code').eq('user_id', userId).maybeSingle();
  if (data?.code) return data.code;
  // Trigger should auto-create on profile insert; generate manually as fallback.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  const { data: ins, error } = await sb
    .from('friend_codes')
    .insert({ user_id: userId, code })
    .select('code')
    .maybeSingle();
  if (error) {
    // Race: another device inserted first - fetch it.
    const { data: existing } = await sb.from('friend_codes').select('code').eq('user_id', userId).maybeSingle();
    return existing?.code ?? null;
  }
  return ins?.code ?? null;
}

/** Set the user's friend code to a specific value (used after code-based login). */
export async function setFriendCode(userId: string, code: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const clean = code.trim().toUpperCase();
  const { error } = await sb.rpc('set_friend_code', { p_code: clean });
  if (error) console.warn('[setFriendCode] RPC failed:', error.message);
}

/** Shared request/accept logic: inserts a pending request, auto-accepts
 *  when the other side already asked, and no-ops on existing states. */
async function requestFriendship(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  userId: string,
  targetId: string
): Promise<{ ok: boolean; error?: string; accepted?: boolean }> {
  const { data: rel } = await sb
    .from('friendships')
    .select('user_id, status')
    .or(`and(user_id.eq.${userId},friend_id.eq.${targetId}),and(user_id.eq.${targetId},friend_id.eq.${userId})`)
    .is('deleted_at', null);
  const mine = (rel ?? []).find((r: { user_id: string }) => r.user_id === userId);
  const theirs = (rel ?? []).find((r: { user_id: string }) => r.user_id === targetId);
  if (mine?.status === 'accepted' || theirs?.status === 'accepted') {
    return { ok: false, error: 'Already friends' };
  }
  if (mine?.status === 'pending') return { ok: false, error: 'Request already sent' };
  // They already asked - entering the code both ways just accepts it.
  if (theirs?.status === 'pending') {
    const { error } = await sb.rpc('accept_friend_request', { p_requester: targetId });
    return error ? { ok: false, error: error.message } : { ok: true, accepted: true };
  }
  const { error } = await sb
    .from('friendships')
    .upsert({ user_id: userId, friend_id: targetId, status: 'pending', deleted_at: null }, { onConflict: 'user_id,friend_id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function addFriendByCode(
  userId: string,
  code: string
): Promise<{ ok: boolean; error?: string; accepted?: boolean }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Not connected' };
  const clean = code.trim().toUpperCase();
  if (clean.length !== 6) return { ok: false, error: 'Code must be 6 characters' };
  // friend_codes rows are owner-only under RLS - resolve codes via the
  // SECURITY DEFINER RPC which returns the user_id for an exact match.
  const { data: targetId, error: le } = await sb.rpc('lookup_friend_code', { p_code: clean });
  if (le || !targetId) return { ok: false, error: 'No one has that code' };
  if (targetId === userId) return { ok: false, error: "That's your own code" };
  return requestFriendship(sb, userId, targetId as string);
}

/** Send a friend request directly by user id (profile ADD FRIEND button). */
export async function sendFriendRequestById(
  userId: string,
  targetId: string
): Promise<{ ok: boolean; error?: string; accepted?: boolean }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Not connected' };
  if (targetId === userId) return { ok: false, error: 'That is you' };
  return requestFriendship(sb, userId, targetId);
}

export interface FriendRequest {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  void_tier: string | null;
}

/** Pending requests others have sent TO me. */
export async function listIncomingRequests(userId: string): Promise<FriendRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('friendships')
    .select('user_id, profiles!friendships_user_id_fkey(display_name, username, avatar_url, void_tier)')
    .eq('friend_id', userId)
    .eq('status', 'pending')
    .is('deleted_at', null);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: r.user_id as string,
    display_name: (r.profiles as Record<string, unknown>)?.display_name as string | null,
    username: (r.profiles as Record<string, unknown>)?.username as string | null,
    avatar_url: (r.profiles as Record<string, unknown>)?.avatar_url as string | null,
    void_tier: (r.profiles as Record<string, unknown>)?.void_tier as string | null,
  }));
}

/** Pending requests I have sent and are still awaiting a reply. */
export async function listOutgoingRequests(userId: string): Promise<FriendRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('friendships')
    .select('friend_id, profiles!friendships_friend_id_fkey(display_name, username, avatar_url, void_tier)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .is('deleted_at', null);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: r.friend_id as string,
    display_name: (r.profiles as Record<string, unknown>)?.display_name as string | null,
    username: (r.profiles as Record<string, unknown>)?.username as string | null,
    avatar_url: (r.profiles as Record<string, unknown>)?.avatar_url as string | null,
    void_tier: (r.profiles as Record<string, unknown>)?.void_tier as string | null,
  }));
}

export async function acceptFriendRequest(requesterId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Not connected' };
  const { error } = await sb.rpc('accept_friend_request', { p_requester: requesterId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Decline an incoming request - deletes the pending row (participant RLS). */
export async function declineFriendRequest(userId: string, requesterId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('friendships')
    .delete()
    .eq('user_id', requesterId)
    .eq('friend_id', userId)
    .eq('status', 'pending');
}

/** Cancel a pending request I sent. */
export async function cancelFriendRequest(userId: string, targetId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('friendships')
    .delete()
    .eq('user_id', userId)
    .eq('friend_id', targetId)
    .eq('status', 'pending');
}

/** Live incoming + outgoing pending requests for the signed-in user. */
export function subscribeToFriendRequests(
  userId: string,
  cb: (incoming: FriendRequest[], outgoing: FriendRequest[]) => void
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const refresh = async () => {
    const [inc, out] = await Promise.all([listIncomingRequests(userId), listOutgoingRequests(userId)]);
    cb(inc, out);
  };
  void refresh();
  const channel = sb
    .channel(`friend-requests:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, () => void refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `friend_id=eq.${userId}` }, () => void refresh())
    .subscribe();
  return () => { void channel.unsubscribe(); };
}

export async function listFriends(userId: string): Promise<Friend[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('friendships')
    .select('friend_id, profiles!friendships_friend_id_fkey(display_name, username)')
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .is('deleted_at', null);
  if (!data) return [];
  return data.map((r: Record<string, unknown>) => ({
    user_id: r.friend_id as string,
    display_name: (r.profiles as Record<string, unknown>)?.display_name as string | null,
    username: (r.profiles as Record<string, unknown>)?.username as string | null,
  }));
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // SECURITY DEFINER - clears both directions atomically.
  await sb.rpc('remove_friend', { p_friend: friendId });
}

export function subscribeToFriendships(userId: string, cb: (friends: Friend[]) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listFriends(userId));
  void refresh();
  channel = sb
    .channel(`friendships:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, () => void refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `friend_id=eq.${userId}` }, () => void refresh())
    .subscribe();
  return () => {
    void sb.removeChannel(channel!);
  };
}

// -- Public stats -----------------------------------------------------------

// Friends' stats don't need second-fresh numbers - the analytics tab calls
// this on every focus, so skip the write if the last one was recent.
let lastStatsUpsert = 0;
const STATS_UPSERT_MIN_INTERVAL_MS = 30 * 60 * 1000;

export async function upsertPublicStats(userId: string, stats: PublicStats): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const nowMs = Date.now();
  if (nowMs - lastStatsUpsert < STATS_UPSERT_MIN_INTERVAL_MS) return;
  lastStatsUpsert = nowMs;
  await sb.from('public_stats').upsert({ user_id: userId, ...stats });
}

export async function listFriendStats(userId: string): Promise<FriendStats[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const friends = await listFriends(userId);
  if (friends.length === 0) return [];
  const ids = friends.map((f) => f.user_id);
  const { data } = await sb
    .from('public_stats')
    .select('user_id, week_volume_kg, week_workouts, week_calories, week_steps, bench_1rm, squat_1rm, deadlift_1rm')
    .in('user_id', ids);
  if (!data) return [];
  const nameMap = new Map(friends.map((f) => [f.user_id, f.display_name]));
  return data.map((r: Record<string, unknown>) => ({
    user_id: r.user_id as string,
    display_name: nameMap.get(r.user_id as string) ?? null,
    week_volume_kg: Number(r.week_volume_kg ?? 0),
    week_workouts: Number(r.week_workouts ?? 0),
    week_calories: Number(r.week_calories ?? 0),
    week_steps: Number(r.week_steps ?? 0),
    bench_1rm: r.bench_1rm != null ? Number(r.bench_1rm) : null,
    squat_1rm: r.squat_1rm != null ? Number(r.squat_1rm) : null,
    deadlift_1rm: r.deadlift_1rm != null ? Number(r.deadlift_1rm) : null,
  }));
}

export function subscribeToFriendStats(userId: string, cb: (stats: FriendStats[]) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listFriendStats(userId));
  void refresh();
  const debounced = debounce(() => void refresh());
  channel = sb
    .channel(`friend_stats:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_stats' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, debounced)
    .subscribe();
  return () => {
    void sb.removeChannel(channel!);
  };
}

// -- Gym check-ins ----------------------------------------------------------

export async function createGymCheckin(userId: string, input: GymCheckinInput): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'not signed in' };
  let photoPath: string | null = null;
  if (input.photo_uri) photoPath = await uploadPhoto(sb, userId, input.photo_uri);
  const { error } = await sb.from('gym_checkins').insert({
    user_id: userId,
    gym_name: input.gym_name.trim(),
    // Fuzzed to ~1 km - exact check-in coordinates are a stalker vector.
    lat: fuzzCoord(input.lat),
    lng: fuzzCoord(input.lng),
    photo_url: photoPath,
    note: input.note ?? null,
  });
  if (error) { console.warn('[createGymCheckin] insert error:', error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Check-in expiry runs once per app session, not inside the read path - the
// map polls this function on a timer and each call used to fire an UPDATE.
let checkinPurgedThisSession = false;

export async function listFriendCheckins(userId: string): Promise<GymCheckin[]> {
  const sb = getSupabase();
  if (!sb) return [];
  // Hard-expire the caller's own check-ins past the feed window - exact
  // location history must not accumulate server-side.
  if (!checkinPurgedThisSession) {
    checkinPurgedThisSession = true;
    void sb
      .from('gym_checkins')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .then(({ error }) => {
        if (error) console.warn('[listFriendCheckins] purge error:', error.message);
      });
  }
  const friends = await listFriends(userId);
  const ids = [userId, ...friends.map((f) => f.user_id)];
  const { data } = await sb
    .from('gym_checkins')
    .select('id, user_id, gym_name, lat, lng, photo_url, note, created_at, profiles!gym_checkins_user_id_fkey(display_name)')
    .in('user_id', ids)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (!data) return [];
  const nameMap = new Map(friends.map((f) => [f.user_id, f.display_name]));
  nameMap.set(userId, 'You');
  const photoUrls = await signMany(sb, 'shared-photos', data.map((r: Record<string, unknown>) => r.photo_url as string | null));
  return data.map((r: Record<string, unknown>, i: number) => ({
    id: r.id as string,
    user_id: r.user_id as string,
    gym_name: r.gym_name as string,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    photo_url: photoUrls[i],
    note: r.note as string | null,
    created_at: r.created_at as string,
    display_name: (r.profiles as Record<string, unknown>)?.display_name as string | null ?? nameMap.get(r.user_id as string) ?? null,
  }));
}

/** Friends' gym check-ins for the map: last 24h, and (RLS) only once the
 *  2-hour cooldown has passed. The client-side filter mirrors the policy so
 *  the behaviour is obvious and testable. */
export async function listGymMapCheckins(userId: string): Promise<GymCheckin[]> {
  const all = await listFriendCheckins(userId);
  const nowMs = Date.now();
  return all.filter((c) => {
    const age = nowMs - new Date(c.created_at).getTime();
    const pastCooldown = c.user_id === userId || age >= 2 * 3600_000;
    return age <= 24 * 3600_000 && pastCooldown;
  });
}

export function subscribeToCheckins(userId: string, cb: (checkins: GymCheckin[]) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listFriendCheckins(userId));
  void refresh();
  const debounced = debounce(() => void refresh());
  channel = sb
    .channel(`checkins:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gym_checkins' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, debounced)
    .subscribe();
  return () => {
    void sb.removeChannel(channel!);
  };
}

// -- Shared photos ----------------------------------------------------------

/**
 * Downscale + re-encode a local image before upload. Phone cameras produce
 * 5-15MB HEIC/JPEGs that would bloat the private buckets; feeds never render
 * above ~1600px anyway. Returns the compressed file URI (JPEG).
 */
async function compressImage(uri: string, maxDim: number, quality = 0.8): Promise<string> {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: maxDim } }], // height auto-keeps aspect
      { compress: quality, format: SaveFormat.JPEG }
    );
    return result.uri;
  } catch (e) {
    console.warn('[compressImage] failed, uploading original:', e instanceof Error ? e.message : String(e));
    return uri;
  }
}

async function uploadPhoto(sb: ReturnType<typeof getSupabase>, userId: string, uri: string): Promise<string | null> {
  if (!sb) return null;
  try {
    const compressed = await compressImage(uri, 1600);
    const path = `${userId}/${Date.now()}.jpg`;
    const data = await new File(compressed).arrayBuffer();
    const { error } = await sb.storage.from('shared-photos').upload(path, data, { contentType: 'image/jpeg' });
    if (error) return null;
    // Bucket is private - store the path; signed URLs are minted at read time.
    return path;
  } catch {
    return null;
  }
}

export async function sharePhoto(userId: string, input: PhotoInput): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const url = await uploadPhoto(sb, userId, input.uri);
  if (!url) return;
  await sb.from('shared_photos').insert({
    user_id: userId,
    url,
    caption: input.caption ?? null,
    tagged_user_ids: input.tagged_user_ids ?? [],
  });
}

export async function listFriendPhotos(userId: string): Promise<SharedPhoto[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const friends = await listFriends(userId);
  const ids = [userId, ...friends.map((f) => f.user_id)];
  const { data } = await sb
    .from('shared_photos')
    .select('id, user_id, url, caption, tagged_user_ids, created_at, profiles!shared_photos_user_id_fkey(display_name)')
    .in('user_id', ids)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (!data) return [];
  const nameMap = new Map(friends.map((f) => [f.user_id, f.display_name]));
  nameMap.set(userId, 'You');
  const urls = await signMany(sb, 'shared-photos', data.map((r: Record<string, unknown>) => r.url as string));
  return data.map((r: Record<string, unknown>, i: number) => ({
    id: r.id as string,
    user_id: r.user_id as string,
    url: urls[i] ?? '',
    caption: r.caption as string | null,
    tagged_user_ids: r.tagged_user_ids as string[],
    created_at: r.created_at as string,
    display_name: (r.profiles as Record<string, unknown>)?.display_name as string | null ?? nameMap.get(r.user_id as string) ?? null,
  }));
}

export function subscribeToPhotos(userId: string, cb: (photos: SharedPhoto[]) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listFriendPhotos(userId));
  void refresh();
  channel = sb
    .channel(`photos:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_photos' }, () => void refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, () => void refresh())
    .subscribe();
  return () => {
    void sb.removeChannel(channel!);
  };
}

// -- Profiles ----------------------------------------------------------------

export interface SupabaseProfile {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  void_tier: string | null;
  fav_pbs: { name: string; exercise_id: string; record_type: string; weight_kg: number; reps: number }[];
}

export async function getSupabaseProfile(userId: string): Promise<SupabaseProfile | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('profiles')
    .select('username, display_name, avatar_url, bio, void_tier, fav_pbs')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return null;
  const rawPbs = (data as any).fav_pbs;
  return {
    username: data.username as string | null,
    display_name: data.display_name as string | null,
    avatar_url: await signStoredPhoto(sb, 'avatars', data.avatar_url as string | null),
    bio: (data as any).bio as string | null,
    void_tier: (data as any).void_tier as string | null,
    fav_pbs: Array.isArray(rawPbs)
      ? (rawPbs as any[]).map((p) => ({ name: String(p?.name ?? ''), exercise_id: String(p?.exercise_id ?? ''), record_type: String(p?.record_type ?? 'max_weight'), weight_kg: Number(p?.weight_kg ?? 0), reps: Number(p?.reps ?? 0) })).filter((p) => p.name)
      : [],
  };
}

export async function updateSupabaseProfile(
  userId: string,
  patch: { username?: string; display_name?: string; avatar_url?: string | null; bio?: string | null; fav_pbs?: { name: string; exercise_id: string; record_type: string; weight_kg: number; reps: number }[] }
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('profiles').update(patch).eq('id', userId);
  return !error;
}

export async function uploadAvatar(userId: string, uri: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const compressed = await compressImage(uri, 512, 0.85);
    const path = `${userId}/avatar_${Date.now()}.jpg`;
    const data = await new File(compressed).arrayBuffer();
    const { error } = await sb.storage.from('avatars').upload(path, data, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) { console.warn('[uploadAvatar] storage error:', error.message); return null; }
    // Private bucket - store the path; signed at read time.
    return path;
  } catch (e) {
    console.warn('[uploadAvatar] exception:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

// -- Posts (feed) -------------------------------------------------------------

const PLATFORM = Device.isDevice ? Platform.OS : `${Platform.OS} simulator`;
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

export interface FeedPost {
  id: string;
  user_id: string;
  caption: string | null;
  image_urls: string[];
  /** width/height per image - lets the feed size portrait vs landscape. */
  image_aspects: number[];
  tagged_user_ids: string[];
  gym_name: string | null;
  gym_lat: number | null;
  gym_lng: number | null;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_tier: string | null;
  tagged_users: { user_id: string; username: string | null; display_name: string | null }[];
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'webm']);

/** True when a stored post-media path (or signed URL) points at a video. */
export function isVideoMedia(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const ext = stored.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTS.has(ext);
}

async function uploadPostImage(sb: NonNullable<ReturnType<typeof getSupabase>>, userId: string, uri: string): Promise<{ url: string | null; error?: string }> {
  try {
    const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
    const isVideo = VIDEO_EXTS.has(ext);
    // Images get downscaled + JPEG'd; videos pass through untouched.
    const uploadUri = isVideo ? uri : await compressImage(uri, 1600);
    const safeExt = isVideo ? (/^[a-z0-9]+$/.test(ext) ? ext : 'mp4') : 'jpg';
    const contentType = isVideo
      ? `video/${safeExt === 'mov' ? 'quicktime' : safeExt}`
      : 'image/jpeg';
    const file = new File(uploadUri);
    // Supabase free tier caps uploads at 50MB; oversize files fail with an
    // unparseable error page, so check first and report cleanly.
    const size = file.size ?? 0;
    if (size > 45 * 1024 * 1024) {
      return { url: null, error: 'Video is too large (max ~45MB). Try a shorter clip.' };
    }
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const arrayBuffer = await file.arrayBuffer();
    const { error } = await sb.storage.from('post-photos').upload(path, arrayBuffer, { contentType, upsert: true });
    if (error) { console.warn('[uploadPostImage] storage error:', error.message); return { url: null, error: error.message }; }
    // Private bucket - store the path; signed at read time.
    return { url: path };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[uploadPostImage] exception:', msg);
    return { url: null, error: msg };
  }
}

export async function deletePost(userId: string, postId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  // Hard delete - simpler and avoids needing UPDATE policy.
  const { error } = await sb.from('posts').delete().eq('id', postId).eq('user_id', userId);
  if (error) console.warn('[deletePost] error:', error.message);
  return !error;
}

export async function createPost(
  userId: string,
  input: {
    imageUris: string[];
    /** width/height per image, parallel to imageUris. */
    imageAspects?: number[];
    caption?: string;
    taggedUserIds?: string[];
    /** Tag a gym = also records a gym check-in on the friends map. */
    gym?: { name: string; lat: number | null; lng: number | null } | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'not signed in' };
  const caption = input.caption?.trim() || null;
  if (input.imageUris.length === 0 && !caption && !input.gym) {
    return { ok: false, error: 'nothing to post' };
  }
  const urls: string[] = [];
  const aspects: number[] = [];
  let lastUploadErr: string | undefined;
  for (let i = 0; i < input.imageUris.length; i++) {
    const res = await uploadPostImage(sb, userId, input.imageUris[i]);
    if (res.url) {
      urls.push(res.url);
      aspects.push(input.imageAspects?.[i] ?? 1);
    } else {
      lastUploadErr = res.error;
    }
  }
  if (input.imageUris.length > 0 && urls.length === 0) {
    console.warn('[createPost] no images uploaded');
    return { ok: false, error: lastUploadErr ?? 'photo upload failed' };
  }
  const { error } = await sb.from('posts').insert({
    user_id: userId,
    caption,
    image_urls: urls,
    image_aspects: aspects,
    tagged_user_ids: input.taggedUserIds ?? [],
    gym_name: input.gym?.name ?? null,
    gym_lat: fuzzCoord(input.gym?.lat),
    gym_lng: fuzzCoord(input.gym?.lng),
  });
  if (error) { console.warn('[createPost] insert error:', error.message); return { ok: false, error: error.message }; }
  // Tagging a gym counts as a check-in (feeds the friends map). The post is
  // already committed, so this stays fire-and-forget - but failures get
  // logged instead of vanishing silently.
  if (input.gym) {
    void createGymCheckin(userId, {
      gym_name: input.gym.name,
      lat: input.gym.lat,
      lng: input.gym.lng,
      note: caption,
    })
      .then((r) => {
        if (!r.ok) console.warn('[createPost] gym check-in failed:', r.error);
      })
      .catch((e) => console.warn('[createPost] gym check-in threw:', e));
  }
  return { ok: true };
}

export async function listFeed(userId: string): Promise<FeedPost[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const friends = await listFriends(userId);
  const ids = [userId, ...friends.map((f) => f.user_id)];
  const { data, error } = await sb
    .from('posts')
    .select('id, user_id, caption, image_urls, image_aspects, tagged_user_ids, gym_name, gym_lat, gym_lng, created_at')
    .in('user_id', ids)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) console.warn('[listFeed] query error:', error.message);
  if (!data || data.length === 0) return [];

  const postIds = data.map((r: Record<string, unknown>) => r.id as string);
  const authorIds = [...new Set(data.map((r: Record<string, unknown>) => r.user_id as string))];
  const taggedIds = [...new Set(data.flatMap((r: Record<string, unknown>) => (r.tagged_user_ids as string[]) ?? []))];
  const allProfileIds = [...new Set([...authorIds, ...taggedIds])];

  const [{ data: likes }, { data: comments }, { data: myLikes }, { data: profiles }] = await Promise.all([
    sb.from('post_likes').select('post_id').in('post_id', postIds),
    sb.from('post_comments').select('post_id').in('post_id', postIds).is('deleted_at', null),
    sb.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', postIds),
    sb.from('profiles').select('id, username, display_name, avatar_url, void_tier').in('id', allProfileIds),
  ]);

  const profileMap = new Map<string, { username: string | null; display_name: string | null; avatar_url: string | null; void_tier: string | null }>();
  for (const p of (profiles ?? []) as Record<string, unknown>[]) {
    profileMap.set(p.id as string, {
      username: (p.username as string | null) ?? null,
      display_name: (p.display_name as string | null) ?? null,
      avatar_url: (p.avatar_url as string | null) ?? null,
      void_tier: (p.void_tier as string | null) ?? null,
    });
  }

  const likeMap = new Map<string, number>();
  for (const l of (likes ?? []) as Record<string, unknown>[]) {
    const pid = l.post_id as string;
    likeMap.set(pid, (likeMap.get(pid) ?? 0) + 1);
  }
  const commentMap = new Map<string, number>();
  for (const c of (comments ?? []) as Record<string, unknown>[]) {
    const pid = c.post_id as string;
    commentMap.set(pid, (commentMap.get(pid) ?? 0) + 1);
  }
  const myLikeSet = new Set<string>();
  for (const l of (myLikes ?? []) as Record<string, unknown>[]) myLikeSet.add(l.post_id as string);

  // Private buckets: sign avatar + post image paths for display.
  const signedAvatars = new Map<string, string | null>();
  await Promise.all(
    [...profileMap.entries()].map(async ([uid, p]) => {
      signedAvatars.set(uid, await signStoredPhoto(sb, 'avatars', p.avatar_url));
    })
  );

  return Promise.all(data.map(async (r: Record<string, unknown>) => {
    const profile = profileMap.get(r.user_id as string);
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      caption: r.caption as string | null,
      image_urls: await signList(sb, 'post-photos', (r.image_urls as string[]) ?? []),
      image_aspects: ((r.image_aspects as number[]) ?? []).map(Number),
      tagged_user_ids: r.tagged_user_ids as string[],
      gym_name: r.gym_name as string | null,
      gym_lat: r.gym_lat != null ? Number(r.gym_lat) : null,
      gym_lng: r.gym_lng != null ? Number(r.gym_lng) : null,
      created_at: r.created_at as string,
      author_username: profile?.username ?? null,
      author_display_name: profile?.display_name ?? null,
      author_avatar_url: signedAvatars.get(r.user_id as string) ?? null,
      author_tier: profile?.void_tier ?? null,
      tagged_users: ((r.tagged_user_ids as string[]) ?? []).map((uid) => {
        const p = profileMap.get(uid);
        return { user_id: uid, username: p?.username ?? null, display_name: p?.display_name ?? null };
      }).filter((t) => t.username != null || t.display_name != null),
      like_count: likeMap.get(r.id as string) ?? 0,
      comment_count: commentMap.get(r.id as string) ?? 0,
      liked_by_me: myLikeSet.has(r.id as string),
    };
  }));
}

export function subscribeToFeed(userId: string, cb: (posts: FeedPost[]) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listFeed(userId));
  void refresh();
  const debounced = debounce(() => void refresh());
  channel = sb
    .channel(`feed:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${userId}` }, debounced)
    .subscribe();
  return () => {
    void sb.removeChannel(channel!);
  };
}

export async function likePost(userId: string, postId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('post_likes').upsert({ post_id: postId, user_id: userId }, { onConflict: 'post_id,user_id' });
}

export async function unlikePost(userId: string, postId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
}

export interface PostLiker {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/** Who gave a post a trophy - only queried for the viewer's own posts. */
export async function listPostLikers(postId: string): Promise<PostLiker[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('post_likes')
    .select('user_id, created_at, profiles!post_likes_user_id_fkey(username, display_name, avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (!data) return [];
  return Promise.all(data.map(async (r: Record<string, unknown>) => {
    const profile = r.profiles as Record<string, unknown> | null;
    return {
      user_id: r.user_id as string,
      username: (profile?.username as string | null) ?? null,
      display_name: (profile?.display_name as string | null) ?? null,
      avatar_url: await signStoredPhoto(sb, 'avatars', (profile?.avatar_url as string | null) ?? null),
    };
  }));
}

// -- Comments ----------------------------------------------------------------

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
}

export async function listComments(postId: string): Promise<PostComment[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('post_comments')
    .select('id, post_id, user_id, text, created_at, profiles!post_comments_user_id_fkey(username, display_name, avatar_url)')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);
  if (!data) return [];
  return Promise.all(data.map(async (r: Record<string, unknown>) => {
    const profile = r.profiles as Record<string, unknown> | null;
    return {
      id: r.id as string,
      post_id: r.post_id as string,
      user_id: r.user_id as string,
      text: r.text as string,
      created_at: r.created_at as string,
      author_username: (profile?.username as string | null) ?? null,
      author_display_name: (profile?.display_name as string | null) ?? null,
      author_avatar_url: await signStoredPhoto(sb, 'avatars', (profile?.avatar_url as string | null) ?? null),
    };
  }));
}

export async function addComment(userId: string, postId: string, text: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !text.trim()) return;
  await sb.from('post_comments').insert({ post_id: postId, user_id: userId, text: text.trim() });
}

export function subscribeToComments(postId: string, cb: (comments: PostComment[]) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = null;
  const refresh = async () => cb(await listComments(postId));
  void refresh();
  const debounced = debounce(() => void refresh());
  channel = sb
    .channel(`comments:${postId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` }, debounced)
    .subscribe();
  return () => {
    void sb.removeChannel(channel!);
  };
}

// -- User search -------------------------------------------------------------

export interface UserSearchResult {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const sb = getSupabase();
  if (!sb || query.trim().length < 1) return [];
  // Escape PostgREST filter metacharacters and LIKE wildcards - a raw ","
  // or "(" in the query would corrupt the .or() filter or widen the match.
  const q = query.trim().replace(/[%_,()"]/g, (c) => `\\${c}`);
  const { data } = await sb
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(10);
  if (!data) return [];
  return Promise.all(data.map(async (r: Record<string, unknown>) => ({
    user_id: r.id as string,
    username: (r.username as string) ?? '',
    display_name: (r.display_name as string) ?? '',
    avatar_url: await signStoredPhoto(sb, 'avatars', (r.avatar_url as string | null) ?? null),
  })));
}

// -- Post & friend counts -----------------------------------------------------

export async function getPostCount(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { count } = await sb.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null);
  return count ?? 0;
}

export async function getFriendCount(userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { count } = await sb
    .from('friendships')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .is('deleted_at', null);
  return count ?? 0;
}

// -- Blocking --------------------------------------------------------------

export async function blockUser(userId: string, blockedId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  // Remove any existing friendship both directions.
  await sb.from('friendships').update({ status: 'blocked', deleted_at: new Date().toISOString() })
    .or(`and(user_id.eq.${userId},friend_id.eq.${blockedId}),and(user_id.eq.${blockedId},friend_id.eq.${userId})`);
  // Insert a block row.
  const { error } = await sb.from('blocked_users').upsert(
    { blocker_id: userId, blocked_id: blockedId },
    { onConflict: 'blocker_id,blocked_id' }
  );
  return !error;
}

export async function unblockUser(userId: string, blockedId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('blocked_users').delete()
    .eq('blocker_id', userId).eq('blocked_id', blockedId);
}

export async function listBlockedUsers(userId: string): Promise<{ user_id: string; display_name: string | null; username: string | null }[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('blocked_users')
    .select('blocked_id, profiles!blocked_users_blocked_id_fkey(display_name, username)')
    .eq('blocker_id', userId);
  return (data ?? []).map((r: any) => ({
    user_id: r.blocked_id,
    display_name: r.profiles?.display_name ?? null,
    username: r.profiles?.username ?? null,
  }));
}

export async function isBlocked(userId: string, otherId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.from('blocked_users')
    .select('id').or(`and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`)
    .maybeSingle();
  return !!data;
}

export async function getUserPosts(userId: string, viewerId: string): Promise<FeedPost[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('posts')
    .select(`
      id, user_id, caption, image_urls, image_aspects, tagged_user_ids,
      gym_name, gym_lat, gym_lng, created_at,
      profiles!posts_user_id_fkey(display_name, username, avatar_url, void_tier)
    `)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (!data) return [];
  return Promise.all((data as any[]).map(async (p) => {
    const [{ count: likes }, { count: comments }, { data: myLike }] = await Promise.all([
      sb.from('post_likes').select('id', { count: 'exact', head: true }).eq('post_id', p.id),
      sb.from('post_comments').select('id', { count: 'exact', head: true }).eq('post_id', p.id).is('deleted_at', null),
      sb.from('post_likes').select('id').eq('post_id', p.id).eq('user_id', viewerId).maybeSingle(),
    ]);
    const prof = p.profiles as any;
    return {
      id: p.id as string,
      user_id: p.user_id as string,
      caption: p.caption as string | null,
      image_urls: await signList(sb, 'post-photos', (p.image_urls as string[]) ?? []),
      image_aspects: ((p.image_aspects as number[]) ?? []).map(Number),
      tagged_user_ids: p.tagged_user_ids as string[],
      gym_name: p.gym_name as string | null,
      gym_lat: p.gym_lat != null ? Number(p.gym_lat) : null,
      gym_lng: p.gym_lng != null ? Number(p.gym_lng) : null,
      created_at: p.created_at as string,
      author_username: prof?.username ?? null,
      author_display_name: prof?.display_name ?? null,
      author_avatar_url: await signStoredPhoto(sb, 'avatars', prof?.avatar_url ?? null),
      author_tier: prof?.void_tier ?? null,
      tagged_users: [],
      like_count: likes ?? 0,
      comment_count: comments ?? 0,
      liked_by_me: !!myLike,
    } as FeedPost;
  }));
}

export async function listLikedPosts(userId: string): Promise<FeedPost[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: likes } = await sb.from('post_likes').select('post_id').eq('user_id', userId);
  if (!likes || likes.length === 0) return [];
  const postIds = likes.map((l: any) => l.post_id as string);
  const { data } = await sb
    .from('posts')
    .select(`
      id, user_id, caption, image_urls, image_aspects, tagged_user_ids,
      gym_name, gym_lat, gym_lng, created_at,
      profiles!posts_user_id_fkey(display_name, username, avatar_url, void_tier)
    `)
    .in('id', postIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (!data) return [];
  return Promise.all((data as any[]).map(async (p) => {
    const prof = p.profiles as any;
    return {
      id: p.id as string,
      user_id: p.user_id as string,
      caption: p.caption as string | null,
      image_urls: await signList(sb, 'post-photos', (p.image_urls as string[]) ?? []),
      image_aspects: ((p.image_aspects as number[]) ?? []).map(Number),
      tagged_user_ids: p.tagged_user_ids as string[],
      gym_name: p.gym_name as string | null,
      gym_lat: p.gym_lat != null ? Number(p.gym_lat) : null,
      gym_lng: p.gym_lng != null ? Number(p.gym_lng) : null,
      created_at: p.created_at as string,
      author_username: prof?.username ?? null,
      author_display_name: prof?.display_name ?? null,
      author_avatar_url: await signStoredPhoto(sb, 'avatars', prof?.avatar_url ?? null),
      author_tier: prof?.void_tier ?? null,
      tagged_users: [],
      like_count: 0,
      comment_count: 0,
      liked_by_me: true,
    } as FeedPost;
  }));
}

export interface FriendWithAvatar {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  void_tier: string | null;
}

export async function listFriendsWithAvatars(userId: string): Promise<FriendWithAvatar[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('friendships')
    .select('friend_id, profiles!friendships_friend_id_fkey(display_name, username, avatar_url, void_tier)')
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .is('deleted_at', null);
  if (!data) return [];
  return Promise.all((data as any[]).map(async (r) => {
    const prof = r.profiles as any;
    return {
      user_id: r.friend_id as string,
      display_name: prof?.display_name ?? null,
      username: prof?.username ?? null,
      avatar_url: await signStoredPhoto(sb, 'avatars', prof?.avatar_url ?? null),
      void_tier: prof?.void_tier ?? null,
    };
  }));
}

export async function reportPost(userId: string, postId: string, reason: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from('post_reports').insert({ post_id: postId, reporter_id: userId, reason });
  if (error) { console.warn('[reportPost] error:', error.message); return false; }
  // Fire-and-forget email to the owner.
  const profile = await getSupabaseProfile(userId);
  void sb.functions.invoke('notify', {
    body: {
      kind: 'report', post_id: postId, reason, reporter_id: userId,
      reporter_name: profile?.display_name ?? profile?.username ?? userId,
      app_version: APP_VERSION, platform: PLATFORM,
    },
  }).catch(() => {});
  return true;
}

export async function submitFeedback(
  userId: string | null,
  input: { message: string; attachmentUris?: { uri: string; type: string }[] }
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'not signed in' };
  const profile = userId ? await getSupabaseProfile(userId) : null;
  const reporterName = profile?.display_name ?? profile?.username ?? userId ?? 'guest';
  const appVersion = APP_VERSION;
  const urls: string[] = [];
  for (const a of input.attachmentUris ?? []) {
    const ext = a.type === 'video' ? 'mp4' : 'jpg';
    const path = `${userId ?? 'anon'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    try {
      const buf = await new File(a.uri).arrayBuffer();
      const { error } = await sb.storage.from('feedback-attachments').upload(path, buf, {
        contentType: a.type === 'video' ? 'video/mp4' : 'image/jpeg',
        upsert: true,
      });
      if (!error) {
        // Bucket is private - send a 7-day signed URL so the emailed link works.
        const { data: signed } = await sb.storage
          .from('feedback-attachments')
          .createSignedUrl(path, 604800);
        if (signed?.signedUrl) urls.push(signed.signedUrl);
      }
    } catch (e) {
      console.warn('[submitFeedback] upload failed:', e instanceof Error ? e.message : String(e));
    }
  }
  const { error } = await sb.from('feedback').insert({
    user_id: userId,
    message: input.message.trim(),
    attachments: urls,
    app_version: appVersion,
    platform: PLATFORM,
  });
  if (error) { console.warn('[submitFeedback] error:', error.message); return { ok: false, error: error.message }; }
  void sb.functions.invoke('notify', {
    body: { kind: 'feedback', message: input.message.trim(), attachments: urls, reporter_id: userId, reporter_name: reporterName, app_version: appVersion, platform: PLATFORM },
  }).catch(() => {});
  return { ok: true };
}

export async function deleteAccount(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.rpc('delete_account');
  if (error) { console.warn('[deleteAccount] error:', error.message); return false; }
  // The cloud copy is gone - wipe the local replica before dropping the session.
  const { wipeLocalUserData } = await import('@/db/sync');
  await wipeLocalUserData();
  useSettings.getState().set({ supabase_user_id: null });
  await sb.auth.signOut();
  return true;
}
