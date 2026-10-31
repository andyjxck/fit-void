import { create } from 'zustand';

import { getProfile, updateProfile, type LocalProfile } from '@/db/repo/settings';
import type { WeightUnit } from '@/lib/types';

interface SettingsState extends LocalProfile {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: (patch: Partial<LocalProfile>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  display_name: null,
  weight_unit: 'kg',
  default_bar_weight: 20,
  has_void_pro: false,
  void_tier: 'free' as 'free' | 'pro' | 'promax',
  void_pro_owner: null as string | null,
  supabase_user_id: null,
  height_cm: null,
  birth_year: null,
  sex: null,
  activity_level: 'moderate',
  goal: 'maintain',
  calorie_override: null,
  water_target_ml: null,
  health_connected: false,
  fitbit_connected: false,
  last_sync_at: null,
  last_sync_error: null,
  last_health_import_at: null,
  primary_goal: null,
  unlock_speed: 'all_at_once' as 'gradual' | 'all_at_once',
  onboarding_completed: false,
  active_intents: '[]',
  unlocked_modules: '["lift","habits"]',
  seeded_intents: '[]',
  hydrated: false,

  hydrate: async () => {
    const p = await getProfile();
    set({ ...p, hydrated: true });
  },

  set: (patch) => {
    const prev = get();
    set(patch);
    updateProfile(patch).catch((e) => {
      console.warn('[settings] updateProfile failed', e, patch);
      // Roll back only keys this patch set that haven't since been
      // overwritten by a later (possibly successful) set().
      const cur = get();
      const rollback = Object.fromEntries(
        (Object.keys(patch) as (keyof LocalProfile)[])
          .filter((k) => cur[k] === patch[k])
          .map((k) => [k, prev[k]])
      ) as Partial<LocalProfile>;
      if (Object.keys(rollback).length > 0) set(rollback);
    });
  },
}));

/** Convenience hook for the display weight unit. */
export const useWeightUnit = (): WeightUnit => useSettings((s) => s.weight_unit);
