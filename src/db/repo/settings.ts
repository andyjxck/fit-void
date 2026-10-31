import type { ActivityLevel, Goal, Sex } from '@/lib/body';
import type { WeightUnit } from '@/lib/types';

import { first, run } from './helpers';

export interface LocalProfile {
  display_name: string | null;
  weight_unit: WeightUnit;
  default_bar_weight: number;
  has_void_pro: boolean;
  void_tier: 'free' | 'pro' | 'promax';
  /** Account this device's entitlement is bound to; null = unclaimed device
   *  purchase (claims to the first signed-in account on push). */
  void_pro_owner: string | null;
  supabase_user_id: string | null;
  // Body profile - metric, converted at display.
  height_cm: number | null;
  birth_year: number | null;
  sex: Sex | null;
  activity_level: ActivityLevel;
  goal: Goal;
  /** Manual daily kcal target; null = use the computed TDEE-based target. */
  calorie_override: number | null;
  /** Manual daily water target in ml; null = weight-derived (35ml/kg) or 2L. */
  water_target_ml: number | null;
  /** User granted health-platform access - enables silent auto-import. */
  health_connected: boolean;
  /** Fitbit OAuth connected - enables silent Web-API auto-import. */
  fitbit_connected: boolean;
  /** Last completed cloud-sync attempt; null when guest / never synced. */
  last_sync_at: string | null;
  /** Non-null when the last sync cycle had failures - surfaced in the UI. */
  last_sync_error: string | null;
  /** Last cold-launch health-platform import attempt - rate-limits to 2/hr. */
  last_health_import_at: string | null;
  // Focus/intent system - local-only, never mirrored to profiles.
  primary_goal: string | null;
  unlock_speed: 'gradual' | 'all_at_once';
  onboarding_completed: boolean;
  /** JSON array of active Intent ids; all-on = Everything. */
  active_intents: string;
  /** JSON array of earned Intent ids (gradual mode only). */
  unlocked_modules: string;
  /** JSON array of Intent ids that have already had their starter widgets seeded. */
  seeded_intents: string;
}

interface Row {
  display_name: string | null;
  weight_unit: WeightUnit;
  default_bar_weight: number;
  has_void_pro: number;
  void_tier: string | null;
  void_pro_owner: string | null;
  supabase_user_id: string | null;
  height_cm: number | null;
  birth_year: number | null;
  sex: Sex | null;
  activity_level: ActivityLevel | null;
  goal: Goal | null;
  calorie_override: number | null;
  water_target_ml: number | null;
  health_connected: number | null;
  fitbit_connected: number | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_health_import_at: string | null;
  primary_goal: string | null;
  unlock_speed: string | null;
  onboarding_completed: number | null;
  active_intents: string | null;
  unlocked_modules: string | null;
  seeded_intents: string | null;
}

export async function getProfile(): Promise<LocalProfile> {
  const r = await first<Row>('SELECT * FROM local_profile WHERE id = 1');
  return {
    display_name: r?.display_name ?? null,
    weight_unit: r?.weight_unit ?? 'kg',
    default_bar_weight: r?.default_bar_weight ?? 20,
    has_void_pro: r?.has_void_pro === 1,
    void_tier: (r?.void_tier as 'free' | 'pro' | 'promax') ?? 'free',
    void_pro_owner: r?.void_pro_owner ?? null,
    supabase_user_id: r?.supabase_user_id ?? null,
    height_cm: r?.height_cm ?? null,
    birth_year: r?.birth_year ?? null,
    sex: r?.sex ?? null,
    activity_level: r?.activity_level ?? 'moderate',
    goal: r?.goal ?? 'maintain',
    calorie_override: r?.calorie_override ?? null,
    water_target_ml: r?.water_target_ml ?? null,
    health_connected: r?.health_connected === 1,
    fitbit_connected: r?.fitbit_connected === 1,
    last_sync_at: r?.last_sync_at ?? null,
    last_sync_error: r?.last_sync_error ?? null,
    last_health_import_at: r?.last_health_import_at ?? null,
    primary_goal: r?.primary_goal ?? null,
    unlock_speed: (r?.unlock_speed as 'gradual' | 'all_at_once') ?? 'all_at_once',
    onboarding_completed: r?.onboarding_completed === 1,
    active_intents: r?.active_intents ?? '[]',
    unlocked_modules: r?.unlocked_modules ?? '["lift","habits"]',
    seeded_intents: r?.seeded_intents ?? '[]',
  };
}

export async function updateProfile(patch: Partial<LocalProfile>) {
  const cur = await getProfile();
  const next = { ...cur, ...patch };
  try {
    await run(
      `UPDATE local_profile
       SET display_name = ?, weight_unit = ?, default_bar_weight = ?,
           has_void_pro = ?, void_tier = ?, void_pro_owner = ?, supabase_user_id = ?,
           height_cm = ?, birth_year = ?, sex = ?, activity_level = ?, goal = ?, calorie_override = ?,
           water_target_ml = ?, health_connected = ?, fitbit_connected = ?,
           last_health_import_at = ?,
           primary_goal = ?, unlock_speed = ?, onboarding_completed = ?,
           active_intents = ?, unlocked_modules = ?, seeded_intents = ?
     WHERE id = 1`,
      next.display_name,
      next.weight_unit,
      next.default_bar_weight,
      next.has_void_pro ? 1 : 0,
      next.void_tier,
      next.void_pro_owner,
      next.supabase_user_id,
      next.height_cm,
      next.birth_year,
      next.sex,
      next.activity_level,
      next.goal,
      next.calorie_override,
      next.water_target_ml,
      next.health_connected ? 1 : 0,
      next.fitbit_connected ? 1 : 0,
      next.last_health_import_at,
      next.primary_goal,
      next.unlock_speed,
      next.onboarding_completed ? 1 : 0,
      next.active_intents,
      next.unlocked_modules,
      next.seeded_intents
    );
  } catch (e) {
    console.error('[settings] UPDATE local_profile failed', e, { patch, next });
    throw e;
  }
}
