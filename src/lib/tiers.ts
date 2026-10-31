import { router } from 'expo-router';

import { first, run } from '@/db/repo/helpers';
import { useSettings } from '@/store/settings';
import type { Tier } from './entitlements';

/**
 * Tier caps. Free is generous but bounded; Pro raises the create caps but
 * keeps soft ceilings on the bulky things; Pro Max removes every cap.
 * Anything not listed here is unlimited for everyone.
 */
export const FREE_LIMITS = {
  routines: 8,
  folders: 3,
  /** Sub-routine tabs per routine (Main doesn't count). */
  routineTabs: 2,
  customExercises: 9,
  mealPlans: 1,
  /** Manual + automatic health pulls per calendar week (Mon-Sun). */
  weeklyHealthImports: 2,
} as const;

export const PRO_LIMITS = {
  routines: Infinity,
  folders: 10,
  routineTabs: 10,
  customExercises: Infinity,
  mealPlans: 15,
  weeklyHealthImports: Infinity,
} as const;

export type LimitedKind = keyof typeof FREE_LIMITS;

/** The cap that applies to `kind` for the caller's tier. Infinity = no cap. */
export function limitFor(kind: LimitedKind): number {
  if (isProMax()) return Infinity;
  if (isPro()) return PRO_LIMITS[kind];
  return FREE_LIMITS[kind];
}

export function currentTier(): Tier {
  const s = useSettings.getState();
  // A grant bound to a different account isn't this user's entitlement.
  if (s.void_pro_owner != null && s.void_pro_owner !== s.supabase_user_id) return 'free';
  return s.void_tier ?? (s.has_void_pro ? 'pro' : 'free');
}

export function isPro(): boolean {
  return currentTier() !== 'free';
}

export function isProMax(): boolean {
  return currentTier() === 'promax';
}

/**
 * Every upsell routes straight to the paywall, carrying the reason so the
 * screen can say *why* it opened (e.g. "8/8 routines"). No Alert dialogs -
 * the paywall itself is the pitch; the user dismisses it with X.
 */
export function showUpgradePrompt(title: string, body: string): void {
  router.push({ pathname: '/paywall', params: { title, body } });
}

/** Standard cap hit: paywall opens with "8/8 ROUTINES" as context. */
export function showLimitPrompt(kind: LimitedKind, used: number): void {
  const max = limitFor(kind);
  showUpgradePrompt(
    `${used}/${max} ${kind.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toUpperCase()}`,
    isPro()
      ? 'That\'s the Pro ceiling. Pro Max removes every cap, forever.'
      : 'That\'s the free limit. Void Pro raises every cap - and adds sync, collab routines and health imports.'
  );
}

/** Count rows for a cap check. `where`/`params` scope to the owner. */
async function countOwned(table: string, where: string, params: (string | null)[]): Promise<number> {
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL AND ${where}`,
    ...params
  );
  return r?.n ?? 0;
}

/**
 * Returns true when the create is allowed. On a cap hit it shows the upgrade
 * prompt and returns false - callers just bail.
 * `used` is supplied by the caller when the count needs a non-standard scope
 * (tabs count per-parent, shared collabs bypass the check entirely).
 */
export function allowedOrPrompt(kind: LimitedKind, used: number): boolean {
  if (used < limitFor(kind)) return true;
  showLimitPrompt(kind, used);
  return false;
}

// -- Scoped counters ---------------------------------------------------------

export async function countMyRoutines(userId: string | null): Promise<number> {
  // Top-level only: tabs are children (separate cap), templates and shared
  // routines aren't the user's own.
  return countOwned(
    'routines',
    `is_template = 0 AND is_shared = 0 AND parent_routine_id IS NULL AND archived_at IS NULL AND user_id IS ?`,
    [userId]
  );
}

export async function countMyFolders(userId: string | null): Promise<number> {
  return countOwned('routine_folders', `user_id IS ?`, [userId]);
}

export async function countRoutineTabs(parentRoutineId: string): Promise<number> {
  return countOwned('routines', `parent_routine_id = ?`, [parentRoutineId]);
}

export async function countMyCustomExercises(userId: string | null): Promise<number> {
  // GitHub-imported library rows aren't user-authored customs; auto-created
  // cardio stubs (Run/Row/...) shouldn't eat the cap either.
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM exercises
      WHERE is_custom = 1 AND github_image_id IS NULL AND tracking_type != 'cardio'
        AND created_by IS ?`,
    userId
  );
  return r?.n ?? 0;
}

export async function countMyMealPlans(userId: string | null): Promise<number> {
  return countOwned('meal_plans', `user_id IS ?`, [userId]);
}

// -- Weekly health-import quota ----------------------------------------------

/** Calendar week key: the Monday (YYYY-MM-DD) containing `d`. */
export function weekKey(d = new Date()): string {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Imports used so far this week; resets when the stored Monday differs. */
export async function healthImportsUsedThisWeek(): Promise<number> {
  const r = await first<{ health_import_week: string | null; health_import_count: number | null }>(
    'SELECT health_import_week, health_import_count FROM local_profile WHERE id = 1'
  );
  if (!r || r.health_import_week !== weekKey()) return 0;
  return r.health_import_count ?? 0;
}

export async function healthImportsRemaining(): Promise<number> {
  const cap = limitFor('weeklyHealthImports');
  if (cap === Infinity) return Infinity;
  return Math.max(0, cap - (await healthImportsUsedThisWeek()));
}

export class HealthQuotaError extends Error {
  constructor() {
    super('Weekly health import limit reached');
    this.name = 'HealthQuotaError';
  }
}

/** Throws when the user is out of weekly imports for their tier. */
export async function assertHealthImportAllowed(): Promise<void> {
  const cap = limitFor('weeklyHealthImports');
  if (cap === Infinity) return;
  const used = await healthImportsUsedThisWeek();
  if (used >= cap) throw new HealthQuotaError();
}

/** Stamp a completed import against the weekly counter. */
export async function recordHealthImport(): Promise<void> {
  const wk = weekKey();
  const cur = await first<{ health_import_week: string | null; health_import_count: number | null }>(
    'SELECT health_import_week, health_import_count FROM local_profile WHERE id = 1'
  );
  const count = cur?.health_import_week === wk ? (cur.health_import_count ?? 0) + 1 : 1;
  await run(
    'UPDATE local_profile SET health_import_week = ?, health_import_count = ? WHERE id = 1',
    wk,
    count
  );
}

/** Friendly message for surfaces that surface a blocked import. */
export const HEALTH_QUOTA_MESSAGE = `Free tier includes ${FREE_LIMITS.weeklyHealthImports} health imports per week (Mon-Sun). Void Pro imports automatically, as often as you like.`;
