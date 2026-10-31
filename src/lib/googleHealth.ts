/**
 * Google Health API client - the successor to the Fitbit Web API (which is
 * closed to new registrations and retires Sept 2026). Covers all Fitbit and
 * Pixel Watch devices.
 *
 * OAuth: Google OAuth 2.0 + PKCE against an iOS OAuth client in a Google Cloud
 * project with the Google Health API enabled.
 *   1. console.cloud.google.com → enable "Google Health API"
 *   2. Credentials → iOS OAuth client (bundle com.andysocial.voidgym) and/or
 *      Android OAuth client (package com.andysocial.fitvoid + cert SHA-1)
 *   3. Data Access → add scopes: activity_and_fitness, health_metrics_and_
 *      measurements, sleep (readonly variants)
 *   4. Audience → add your Gmail as a test user (Testing mode = 7-day tokens)
 *   5. Paste the client ID(s) below; add the redirect scheme to app.json:
 *      iOS "com.googleusercontent.apps.<ID>", Android "com.andysocial.fitvoid"
 *
 * Tokens live in SecureStore; imported rows land in normal synced tables.
 */
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

// ── Config ────────────────────────────────────────────────────────────────
// OAuth client IDs from the Google Cloud project (…apps.googleusercontent.com)
// iOS client: bundle com.andysocial.voidgym. Android client: same package name
// + SHA-1 of the signing keystore (eas credentials / keytool).
const GOOGLE_CLIENT_ID_IOS = '799964983377-i18qbtpo6oh4ul344l6u8m4joqdvo667.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID_ANDROID = ''; // TODO: paste Android client ID
const ANDROID_PACKAGE = 'com.andysocial.fitvoid';

function clientId(): string {
  return Platform.OS === 'android' ? GOOGLE_CLIENT_ID_ANDROID : GOOGLE_CLIENT_ID_IOS;
}
const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
  'https://www.googleapis.com/auth/googlehealth.profile.readonly',
  // People API - birth year + gender to auto-fill the local profile.
  'https://www.googleapis.com/auth/user.birthday.read',
  'https://www.googleapis.com/auth/user.gender.read',
].join(' ');
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://health.googleapis.com/v4';

const K_ACCESS = 'ghealth.access';
const K_REFRESH = 'ghealth.refresh';
const K_EXPIRES = 'ghealth.expiresAt';
const K_USER = 'ghealth.userId';

// iOS: reversed client-id scheme. Android: package-name scheme (registered
// against the signing cert in the Cloud console).
export const GOOGLE_REDIRECT_URI = () =>
  Platform.OS === 'android'
    ? `${ANDROID_PACKAGE}:/oauth2redirect`
    : `com.googleusercontent.apps.${clientId().replace(/\.apps\.googleusercontent\.com$/, '')}:/oauth2redirect`;

export function googleHealthConfigured(): boolean {
  return clientId().endsWith('apps.googleusercontent.com');
}

// ── PKCE ──────────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(await Crypto.getRandomBytesAsync(48));
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return { verifier, challenge: digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
}

// ── Token lifecycle ───────────────────────────────────────────────────────
async function saveTokens(t: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}) {
  await SecureStore.setItemAsync(K_ACCESS, t.access_token);
  if (t.refresh_token) await SecureStore.setItemAsync(K_REFRESH, t.refresh_token);
  await SecureStore.setItemAsync(K_EXPIRES, String(Date.now() + t.expires_in * 1000 - 60_000));
}

export async function isGoogleHealthConnected(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_REFRESH)) != null;
}

export async function disconnectGoogleHealth(): Promise<void> {
  await Promise.all([K_ACCESS, K_REFRESH, K_EXPIRES, K_USER].map((k) =>
    SecureStore.deleteItemAsync(k).catch(() => {})
  ));
}

/** fetch with a hard timeout - a stalled network must not wedge importers
 *  (they're serialized behind a shared lock). */
function fetchTimed(url: string, init?: RequestInit, ms = 20_000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

async function refreshTokens(): Promise<boolean> {
  const refresh = await SecureStore.getItemAsync(K_REFRESH);
  if (!refresh) return false;
  const res = await fetchTimed(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }).toString(),
  }).catch(() => null);
  if (res && !res.ok) {
    // invalid_grant = refresh token revoked/expired (Google "Testing" consent
    // screens kill them after 7 days). Nothing recovers it - disconnect so the
    // UI prompts a reconnect instead of silently importing nothing forever.
    const body = await res.json().catch(() => null) as { error?: string } | null;
    if (body?.error === 'invalid_grant') {
      await disconnectGoogleHealth();
      useSettings.getState().set({ fitbit_connected: false });
      notify('Fitbit disconnected', {
        body: 'Google Health session expired - reconnect in Settings → Integrations.',
        tone: 'error',
      });
    }
    return false;
  }
  if (!res?.ok) return false;
  await saveTokens(await res.json());
  return true;
}

/** Opens Google consent in the system browser; true when tokens were saved. */
export async function connectGoogleHealth(): Promise<'ok' | 'cancelled' | 'error'> {
  if (!googleHealthConfigured()) return 'error';
  const redirect = GOOGLE_REDIRECT_URI();
  try {
    const { verifier, challenge } = await pkcePair();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId(),
      redirect_uri: redirect,
      scope: SCOPES,
      access_type: 'offline',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const res = await WebBrowser.openAuthSessionAsync(`${AUTH_URL}?${params}`, redirect);
    if (res.type !== 'success') return 'cancelled';
    const code = new URL(res.url).searchParams.get('code');
    if (!code) return 'error';
    const tok = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
      }).toString(),
    });
    if (!tok.ok) return 'error';
    await saveTokens(await tok.json());
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Fresh access token, refreshing when expired. Throws when reconnect is needed. */
async function getAccessToken(): Promise<string> {
  let access = await SecureStore.getItemAsync(K_ACCESS);
  const expires = Number(await SecureStore.getItemAsync(K_EXPIRES) ?? 0);
  if (!access || Date.now() >= expires) {
    if (!(await refreshTokens())) throw new Error('Google Health session expired - reconnect');
    access = await SecureStore.getItemAsync(K_ACCESS);
  }
  return access!;
}

/** Authed GET with token refresh + one 401 retry. Throws on failure. */
async function ghealthGet<T>(path: string): Promise<T> {
  let access: string | null = await getAccessToken();
  const call = () =>
    fetchTimed(`${API}${path}`, {
      headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
    });
  let res = await call();
  if (res.status === 401 && (await refreshTokens())) {
    access = await SecureStore.getItemAsync(K_ACCESS);
    res = await call();
  }
  if (res.status === 429) throw new Error('Google Health rate limit - try again shortly');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Health ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── Data readers ──────────────────────────────────────────────────────────
interface DataPoint {
  name?: string;
  interval?: { startTime?: string; endTime?: string };
  [key: string]: unknown;
}

/**
 * List data points for a type. The API takes an AIP-160 `filter` expression
 * (no bare start/end params); each record kind has its own filter field:
 *   interval  →  steps.interval.start_time >= "<rfc3339>"
 *   sample    →  weight.sample_time.physical_time >= "<rfc3339>"
 *   daily     →  daily_resting_heart_rate.date >= "yyyy-MM-dd"
 *   session   →  exercise.interval.civil_start_time (sleep: civil_end_time)
 */
async function listPoints(dataType: string, filter: string): Promise<DataPoint[]> {
  const out: DataPoint[] = [];
  let token: string | undefined;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ filter, pageSize: '200' });
    if (token) q.set('pageToken', token);
    const res = await ghealthGet<{ dataPoints?: DataPoint[]; nextPageToken?: string }>(
      `/users/me/dataTypes/${dataType}/dataPoints?${q}`
    );
    out.push(...(res.dataPoints ?? []));
    token = res.nextPageToken;
    if (!token) break;
  }
  return out;
}

const civilDay = (t: Date) =>
  `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

/** Civil-day range filter for a field like `exercise.interval.civil_start_time`. */
function civilRange(field: string, start: Date, end: Date): string {
  const endNext = new Date(end.getTime() + 86400000); // inclusive end day
  return `${field} >= "${civilDay(start)}" AND ${field} < "${civilDay(endNext)}"`;
}

/** Physical-time range filter (RFC 3339 literals). */
function physRange(field: string, startIso: string, endIso: string): string {
  return `${field} >= "${startIso}" AND ${field} < "${endIso}"`;
}

/** First numeric value among known keys, tolerant of Google's string ints. */
function numField(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** '2026-04-20T08:00:00Z' or {year,month,day} → local day 'yyyy-MM-dd'. */
function pointDay(p: DataPoint): string | null {
  const iso = p.interval?.startTime;
  if (iso) {
    const t = new Date(iso);
    if (Number.isFinite(t.getTime()))
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  const civil = (p as Record<string, unknown>).date ?? (p as Record<string, unknown>).day;
  if (civil && typeof civil === 'object') {
    const c = civil as { year?: number; month?: number; day?: number };
    if (c.year && c.month && c.day)
      return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
  }
  return null;
}

/** '1800s' → 1800. */
function seconds(v: unknown): number | null {
  if (typeof v === 'string' && v.endsWith('s')) return Number(v.slice(0, -1)) || null;
  return typeof v === 'number' ? v : null;
}

export interface GoogleExercise {
  id: string; // data point name tail - dedupe key
  exerciseType: string; // RUNNING, WALKING, ...
  displayName: string;
  startIso: string;
  durationS: number;
  distanceM: number | null;
  calories: number | null;
  avgHr: number | null;
}

export async function getGoogleExercises(days = 90): Promise<GoogleExercise[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'exercise',
    civilRange('exercise.interval.civil_start_time', start, end)
  );
  const out: GoogleExercise[] = [];
  for (const p of pts) {
    const ex = p.exercise as {
      interval?: { startTime?: string; endTime?: string };
      exerciseType?: string;
      displayName?: string;
      activeDuration?: string;
      metricsSummary?: Record<string, unknown>;
    } | undefined;
    if (!ex?.interval?.startTime) continue;
    const startMs = new Date(ex.interval.startTime).getTime();
    const endMs = ex.interval.endTime ? new Date(ex.interval.endTime).getTime() : NaN;
    const dur =
      seconds(ex.activeDuration) ??
      (Number.isFinite(endMs) ? Math.max(0, (endMs - startMs) / 1000) : 0);
    if (dur <= 0) continue;
    const m = ex.metricsSummary ?? {};
    const distMm = numField(m, ['distanceMillimeters']);
    out.push({
      id: (p.name ?? '').split('/').pop() ?? `${startMs}`,
      exerciseType: ex.exerciseType ?? 'OTHER',
      displayName: ex.displayName ?? ex.exerciseType ?? 'Workout',
      startIso: new Date(startMs).toISOString(),
      durationS: dur,
      distanceM: distMm != null && distMm > 0 ? distMm / 1000 : null,
      calories: numField(m, ['caloriesKcal']),
      avgHr: numField(m, ['averageHeartRateBeatsPerMinute']),
    });
  }
  return out;
}

export async function getGoogleRestingHR(days = 30): Promise<{ date: string; bpm: number }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'daily-resting-heart-rate',
    civilRange('daily_resting_heart_rate.date', start, end)
  );
  const out: { date: string; bpm: number }[] = [];
  for (const p of pts) {
    const payload = p.dailyRestingHeartRate ?? p.restingHeartRate ?? p;
    const bpm = numField(payload, ['beatsPerMinute', 'restingHeartRate', 'beatsPerMinuteAvg', 'value']);
    const day = pointDay(payload as DataPoint) ?? pointDay(p);
    if (bpm != null && day) out.push({ date: day, bpm: Math.round(bpm) });
  }
  return out;
}

export async function getGoogleHRV(days = 30): Promise<{ date: string; ms: number }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'daily-heart-rate-variability',
    civilRange('daily_heart_rate_variability.date', start, end)
  );
  const out: { date: string; ms: number }[] = [];
  for (const p of pts) {
    const payload = p.dailyHeartRateVariability ?? p.heartRateVariability ?? p;
    const ms = numField(payload, ['rmssd', 'rmssdMilliseconds', 'dailyRmssd', 'value']);
    const day = pointDay(payload as DataPoint) ?? pointDay(p);
    if (ms != null && day) out.push({ date: day, ms: Math.round(ms * 10) / 10 });
  }
  return out;
}

const AWAKE_STAGES = new Set(['AWAKE', 'WAKE', 'OUT_OF_BED', 'RESTLESS_AWAKE']);

export async function getGoogleSleep(days = 14): Promise<{ date: string; hours: number; loggedAt: string }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'sleep',
    civilRange('sleep.interval.civil_end_time', start, end)
  );
  const out: { date: string; hours: number; loggedAt: string }[] = [];
  for (const p of pts) {
    const s = p.sleep as {
      interval?: { startTime?: string; endTime?: string };
      summary?: { minutesAsleep?: number };
      minutesAsleep?: number;
      sleepStages?: Array<{ startTime?: string; endTime?: string; type?: string }>;
    } | undefined;
    if (!s?.interval?.endTime) continue;
    let asleepMin = s.summary?.minutesAsleep ?? s.minutesAsleep ?? null;
    if (asleepMin == null && s.sleepStages?.length) {
      asleepMin = 0;
      for (const st of s.sleepStages) {
        if (!st.startTime || !st.endTime || (st.type && AWAKE_STAGES.has(st.type))) continue;
        asleepMin += (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000;
      }
    }
    if (asleepMin == null || asleepMin <= 0) continue;
    const endMs = new Date(s.interval.endTime).getTime();
    out.push({
      date: pointDay({ interval: { startTime: s.interval.endTime } })!,
      hours: Math.round((asleepMin / 60) * 100) / 100,
      loggedAt: new Date(endMs).toISOString(),
    });
  }
  return out;
}

export async function getGoogleWeights(days = 90): Promise<{ date: string; kg: number; loggedAt: string }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'weight',
    physRange('weight.sample_time.physical_time', start.toISOString(), end.toISOString())
  );
  const out: { date: string; kg: number; loggedAt: string }[] = [];
  for (const p of pts) {
    const w = (p.weight ?? p) as Record<string, unknown>;
    let kg = numField(w, ['kilograms', 'weightKg', 'kg']);
    if (kg == null) {
      const grams = numField(w, ['grams']);
      const lb = numField(w, ['pounds', 'weightPounds']);
      kg = grams != null ? grams / 1000 : lb != null ? lb * 0.453592 : numField(w, ['value']);
    }
    const at = p.interval?.startTime ?? (w.sampleTime as { physicalTime?: string })?.physicalTime;
    const day = at ? pointDay({ interval: { startTime: at } }) : pointDay(p);
    if (kg != null && at && day) {
      out.push({ date: day, kg: Math.round(kg * 100) / 100, loggedAt: new Date(at).toISOString() });
    }
  }
  return out;
}

/**
 * Intraday HR samples in [startIso, endIso] → epoch-ms points. Used to
 * backfill per-set HR at workout finalize - Google Health gives real 1-min
 * telemetry (unlike Fitbit's delayed Apple Health writes).
 */
/** Body-fat % samples (Aria scales etc.) for the last `days` days. */
export async function getGoogleBodyFat(days = 90): Promise<{ at: string; pct: number }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'body-fat',
    `body_fat.sample_time.physical_time >= "${start.toISOString()}" AND body_fat.sample_time.physical_time < "${end.toISOString()}"`
  );
  return pts
    .map((p) => {
      const bf = p.bodyFat as { sampleTime?: { physicalTime?: string }; percentage?: number } | undefined;
      const at = bf?.sampleTime?.physicalTime;
      const pct = bf?.percentage;
      return at && pct ? { at, pct } : null;
    })
    .filter((x): x is { at: string; pct: number } => x !== null);
}

export interface GoogleProfileFields {
  heightCm: number | null;
  birthYear: number | null;
  sex: 'male' | 'female' | null;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete' | null;
}

/**
 * Profile fields Google already knows - height from the `height` data type,
 * age from users/me/profile, real birth year + gender from the People API,
 * activity from Fitbit's daily activity-level classification. Local-only:
 * these fill the local profile, never sync.
 */
export async function getGoogleProfileFields(): Promise<GoogleProfileFields> {
  const out: GoogleProfileFields = { heightCm: null, birthYear: null, sex: null, activityLevel: null };

  // Height - latest sample wins
  try {
    const start = new Date(Date.now() - 3650 * 86400000);
    const pts = await listPoints(
      'height',
      physRange('height.sample_time.physical_time', start.toISOString(), new Date().toISOString())
    );
    const h = (pts[pts.length - 1]?.height ?? pts[pts.length - 1]) as Record<string, unknown> | undefined;
    if (h) {
      const m = numField(h, ['meters', 'value']);
      const cm = numField(h, ['centimeters']);
      const heightCm = m != null ? m * 100 : cm;
      if (heightCm != null && heightCm > 50 && heightCm < 260) {
        out.heightCm = Math.round(heightCm * 10) / 10;
      }
    }
  } catch (e) {
    console.warn('[ghealth] height read failed', e);
  }

  // Age + activity level from the health profile / daily activity data
  try {
    const profile = await ghealthGet('/users/me/profile');
    const age = numField(profile as Record<string, unknown>, ['age']);
    if (age != null && age > 5 && age < 120) {
      out.birthYear = new Date().getFullYear() - age;
    }
  } catch (e) {
    console.warn('[ghealth] profile read failed', e);
  }

  // Birth year + gender via the People API (more precise than age-derived year)
  try {
    const token = await getAccessToken();
    const res = await fetch(
      'https://people.googleapis.com/v1/people/me?personFields=birthdays,genders',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const person = (await res.json()) as {
        birthdays?: Array<{ date?: { year?: number } }>;
        genders?: Array<{ value?: string }>;
      };
      const year = person.birthdays?.find((b) => b.date?.year)?.date?.year;
      if (year != null && year > 1900 && year <= new Date().getFullYear()) out.birthYear = year;
      const g = person.genders?.[0]?.value?.toLowerCase();
      if (g === 'male' || g === 'female') out.sex = g;
    }
  } catch (e) {
    console.warn('[ghealth] people api read failed', e);
  }

  // Fitbit's daily activity classification - latest day wins
  try {
    const start = new Date(Date.now() - 30 * 86400000);
    const pts = await listPoints(
      'activity-level',
      civilRange('activity_level.date', start, new Date())
    );
    const lvl = (pts[pts.length - 1]?.activityLevel as Record<string, unknown> | undefined) ?? {};
    const raw = JSON.stringify(lvl).toLowerCase();
    if (raw.includes('athlete') || raw.includes('extra')) out.activityLevel = 'athlete';
    else if (raw.includes('very') || raw.includes('high')) out.activityLevel = 'active';
    else if (raw.includes('moderate') || raw.includes('fairly')) out.activityLevel = 'moderate';
    else if (raw.includes('light')) out.activityLevel = 'light';
    else if (raw.includes('sedentary')) out.activityLevel = 'sedentary';
  } catch (e) {
    console.warn('[ghealth] activity level read failed', e);
  }

  return out;
}

/** Fitbit water logs → per-entry ml keyed by local day. */
export async function getGoogleHydration(days = 14): Promise<{ id: string; day: string; ml: number }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'hydration-log',
    civilRange('hydration_log.interval.civil_start_time', start, end)
  );
  const out: { id: string; day: string; ml: number }[] = [];
  for (const p of pts) {
    const h = p.hydrationLog as {
      interval?: { startTime?: string };
      amountConsumed?: { milliliters?: number };
    } | undefined;
    const ml = h?.amountConsumed?.milliliters;
    const at = h?.interval?.startTime;
    if (!ml || ml <= 0 || !at) continue;
    const day = pointDay({ interval: { startTime: at } });
    if (!day) continue;
    out.push({
      id: (p.name ?? '').split('/').pop() ?? at,
      day,
      ml: Math.round(ml),
    });
  }
  return out;
}

export interface GoogleFoodLog {
  id: string;
  day: string;
  name: string;
  mealType: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Fitbit food logs → per-entry macro rows keyed by local day. */
export async function getGoogleFoodLogs(days = 30): Promise<GoogleFoodLog[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const pts = await listPoints(
    'nutrition-log',
    civilRange('nutrition_log.interval.civil_start_time', start, end)
  );
  const out: GoogleFoodLog[] = [];
  for (const p of pts) {
    const n = p.nutritionLog as {
      interval?: { startTime?: string };
      foodDisplayName?: string;
      mealType?: string;
      energy?: { kcal?: number };
      totalCarbohydrate?: { grams?: number };
      totalFat?: { grams?: number };
      nutrients?: Array<{ nutrient?: string; quantity?: { grams?: number } }>;
    } | undefined;
    const at = n?.interval?.startTime;
    if (!n || !at) continue;
    const day = pointDay({ interval: { startTime: at } });
    if (!day) continue;
    const protein = n.nutrients?.find((x) => x.nutrient === 'PROTEIN')?.quantity?.grams ?? 0;
    out.push({
      id: (p.name ?? '').split('/').pop() ?? at,
      day,
      name: n.foodDisplayName ?? 'Food',
      mealType: n.mealType ?? null,
      kcal: n.energy?.kcal ?? 0,
      proteinG: protein,
      carbsG: n.totalCarbohydrate?.grams ?? 0,
      fatG: n.totalFat?.grams ?? 0,
    });
  }
  return out;
}

export async function getGoogleIntradayHR(startIso: string, endIso: string): Promise<{ at: number; bpm: number }[]> {
  try {
    const pts = await listPoints(
      'heart-rate',
      physRange('heart_rate.sample_time.physical_time', startIso, endIso)
    );
    const out: { at: number; bpm: number }[] = [];
    for (const p of pts) {
      const hr = p.heartRate as {
        sampleTime?: { physicalTime?: string };
        interval?: { startTime?: string };
        beatsPerMinute?: string | number;
      } | undefined;
      if (!hr) continue;
      const t = hr.sampleTime?.physicalTime ?? hr.interval?.startTime;
      const bpm = hr.beatsPerMinute != null ? Number(hr.beatsPerMinute) : NaN;
      const at = t ? new Date(t).getTime() : NaN;
      if (Number.isFinite(at) && Number.isFinite(bpm) && bpm > 0) out.push({ at, bpm });
    }
    return out.sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}
