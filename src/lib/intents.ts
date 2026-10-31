/**
 * Focus/intent system. Nine chips - ALL is just "all on".
 * Social is ambient: the Feed tab and gym map are never muted; the 'social'
 * intent only controls social-flavoured widgets.
 *
 * Every route, tab and widget belongs to at least one focus.
 */

import type { WidgetType } from './widgetTypes';

export type Intent =
  | 'lift'
  | 'cardio'
  | 'nutrition'
  | 'hydration'
  | 'body_comp'
  | 'recovery'
  | 'progress'
  | 'social'
  | 'habits';

export const ALL_INTENTS: Intent[] = [
  'lift',
  'cardio',
  'nutrition',
  'hydration',
  'body_comp',
  'recovery',
  'progress',
  'social',
  'habits',
];

export const INTENT_LABELS: Record<Intent, string> = {
  lift: 'LIFT',
  cardio: 'CARDIO',
  nutrition: 'NUTRITION',
  hydration: 'HYDRATION',
  body_comp: 'BODY COMP',
  recovery: 'RECOVERY',
  progress: 'PROGRESS',
  social: 'SOCIAL',
  habits: 'HABITS',
};

/** Parse the JSON intent list persisted on local_profile. */
export function parseIntents(raw: string | null | undefined): Intent[] {
  try {
    const v = JSON.parse(raw || '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((i): i is Intent => ALL_INTENTS.includes(i));
  } catch {
    return [];
  }
}

/** Which focuses each widget type belongs to. Empty array = always visible.
 *  Several widgets deliberately belong to more than one focus (e.g. a
 *  stat that's both a lift metric and part of the overall PROGRESS
 *  picture) so a narrowed focus never feels emptier than it should. */
export const WIDGET_INTENTS: Record<WidgetType, Intent[]> = {
  weekly_consistency: [], // adaptive - always shown, content changes per focus
  routine: ['lift'],
  example_routine: ['lift'],
  folder: ['lift'],
  readiness: ['recovery', 'progress', 'body_comp'],
  streak: ['habits', 'lift', 'progress'],
  strength_score: ['lift', 'progress'],
  today_calories: ['nutrition'],
  today_protein: ['nutrition'],
  hydration: ['hydration'],
  body_weight: ['body_comp', 'progress'],
  resting_hr: ['recovery'],
  sleep: ['recovery', 'body_comp'],
  week_volume: ['lift', 'progress'],
  last_pr: ['lift'],
  recent_prs: ['lift'],
  hard_sets: ['lift'],
  top_lifts: ['lift', 'progress'],
  cardio_weekly: ['cardio', 'body_comp', 'progress'],
  last_workout: ['lift'],
  plate_calculator: ['lift'],
  rest_timer: ['lift'],
  quick_cardio: ['cardio'],
  exercise_quick_add: ['lift'],
  text_goal: [], // personal goal - always shown
  friends_snapshot: ['social'],
};

/** Tab route name → owning focuses. Missing = always allowed. These are
 *  deliberately broad: a tab stays live if ANY of its content is relevant
 *  to the focus (each tab filters its own sections internally), so a focus
 *  never strands the user on a greyed-out shell. */
export const TAB_INTENTS: Record<string, Intent[]> = {
  // Body tab: measurements (body_comp), vitals (recovery), health/activity
  // + cardio sessions (cardio).
  body: ['body_comp', 'recovery', 'cardio'],
  // Meals tab: food+drink log - fueling matters to cardio and cutting too.
  meals: ['nutrition', 'hydration', 'body_comp', 'cardio'],
  // Analytics internally adapts - every data focus owns a sub-tab in it.
  analytics: ['progress', 'habits', 'lift', 'cardio', 'nutrition', 'hydration', 'body_comp', 'recovery'],
  logbook: ['lift', 'progress', 'habits'],
  library: ['lift'],
  cardio: ['cardio'], // More-menu entry to the cardio hub
  // index/more/social/policies/onboarding/feedback: always allowed -
  // Train is home, More is navigation, Feed is ambient, the rest is system.
};

/** Curated widget types to seed the first time a user activates a given
 *  focus - gives every focus (other than ALL) its own starting layout.
 *  Multi-instance types (routine/folder/text_goal) are seeded separately. */
export const FOCUS_SEED_WIDGETS: Record<Intent, WidgetType[]> = {
  lift: ['week_volume', 'last_pr', 'recent_prs', 'top_lifts', 'plate_calculator', 'rest_timer', 'streak'],
  cardio: ['cardio_weekly', 'quick_cardio'],
  nutrition: ['today_calories', 'today_protein'],
  hydration: ['hydration'],
  body_comp: ['body_weight', 'sleep', 'readiness', 'cardio_weekly'],
  recovery: ['sleep', 'resting_hr', 'readiness'],
  progress: ['strength_score', 'readiness', 'week_volume', 'streak', 'top_lifts', 'body_weight', 'cardio_weekly'],
  social: ['friends_snapshot'],
  habits: ['streak'],
};

/** Marker stored in config.hidden_intents for widgets hidden under ALL -
 *  it isn't an Intent, so it never matches a narrowed focus. Lets ALL keep
 *  its own remembered layout like every other focus. */
export const ALL_HIDE_KEY = 'all';

/** Empty active-intent list means ALL. Every other selection is a real
 *  narrowed focus with its own remembered layout. */
export function isEverything(active: Intent[]): boolean {
  return active.length === 0;
}

/** A widget renders when: focus is ALL and it isn't 'all'-hidden, or one of
 *  its owning focuses is active and it hasn't been hidden under the current
 *  focus selection. */
export function isWidgetVisible(
  type: WidgetType,
  config: Record<string, unknown>,
  active: Intent[]
): boolean {
  const hiddenIn = Array.isArray(config.hidden_intents) ? (config.hidden_intents as string[]) : [];
  if (isEverything(active)) return !hiddenIn.includes(ALL_HIDE_KEY);
  const owns = WIDGET_INTENTS[type];
  if (owns.length > 0 && !owns.some((i) => active.includes(i))) return false;
  return !hiddenIn.some((i) => active.includes(i as Intent));
}

/** Visible=1 but hidden under the current selection - 'all'-hidden under
 *  ALL, or hidden_intents-matching under a narrowed focus. Shown in the
 *  picker as RESTORE. */
export function isFocusHidden(
  type: WidgetType,
  config: Record<string, unknown>,
  active: Intent[]
): boolean {
  const hiddenIn = Array.isArray(config.hidden_intents) ? (config.hidden_intents as string[]) : [];
  if (isEverything(active)) return hiddenIn.includes(ALL_HIDE_KEY);
  const owns = WIDGET_INTENTS[type];
  if (owns.length > 0 && !owns.some((i) => active.includes(i))) return false;
  return hiddenIn.some((i) => active.includes(i as Intent));
}

export function isTabMuted(tab: string, active: Intent[]): boolean {
  if (isEverything(active)) return false;
  const owns = TAB_INTENTS[tab];
  return owns != null && !owns.some((i) => active.includes(i));
}

/** Gradual-mode unlock rules - each earns a focus through real usage. */
export interface UnlockRule {
  intent: Intent;
  hint: string;
}

export const UNLOCK_RULES: UnlockRule[] = [
  { intent: 'nutrition', hint: 'Log your first meal to unlock NUTRITION' },
  { intent: 'hydration', hint: 'Log a drink to unlock HYDRATION' },
  { intent: 'body_comp', hint: 'Log a body measurement to unlock BODY COMP' },
  { intent: 'recovery', hint: 'Sync sleep or a check-in to unlock RECOVERY' },
  { intent: 'cardio', hint: 'Log a cardio session to unlock CARDIO' },
  { intent: 'progress', hint: 'Finish 3 workouts to unlock PROGRESS' },
  { intent: 'social', hint: 'Add a friend to unlock SOCIAL widgets' },
];

/** Evaluate usage milestones and return newly-earned intents (gradual mode).
 *  Local data only - social requires an account and is skipped for guests. */
export async function checkUnlocks(
  alreadyUnlocked: Intent[],
  userId: string | null
): Promise<Intent[]> {
  const { getDb } = await import('@/db/client');
  const db = await getDb();
  const earned: Intent[] = [];

  const count = async (sql: string, ...args: (string | number)[]) => {
    const r = await db.getFirstAsync<{ n: number }>(sql, ...args);
    return r?.n ?? 0;
  };

  if (!alreadyUnlocked.includes('nutrition')) {
    const n = await count(
      `SELECT COUNT(*) AS n FROM nutrition_entries WHERE deleted_at IS NULL`
    );
    if (n > 0) earned.push('nutrition');
  }
  if (!alreadyUnlocked.includes('hydration')) {
    const n = await count(
      `SELECT COUNT(*) AS n FROM nutrition_entries WHERE deleted_at IS NULL AND is_drink = 1`
    );
    if (n > 0) earned.push('hydration');
  }
  if (!alreadyUnlocked.includes('body_comp')) {
    const n = await count(
      `SELECT COUNT(*) AS n FROM body_measurements WHERE deleted_at IS NULL`
    );
    if (n > 0) earned.push('body_comp');
  }
  if (!alreadyUnlocked.includes('recovery')) {
    const n = await count(
      `SELECT COUNT(*) AS n FROM body_measurements WHERE deleted_at IS NULL AND metric_type IN ('sleep_hours', 'resting_hr')`
    );
    if (n > 0) earned.push('recovery');
  }
  if (!alreadyUnlocked.includes('cardio')) {
    const n = await count(
      `SELECT COUNT(*) AS n FROM cardio_sessions WHERE deleted_at IS NULL`
    );
    if (n > 0) earned.push('cardio');
  }
  if (!alreadyUnlocked.includes('progress')) {
    const n = await count(
      `SELECT COUNT(*) AS n FROM workouts WHERE deleted_at IS NULL AND ended_at IS NOT NULL`
    );
    if (n >= 3) earned.push('progress');
  }
  if (!alreadyUnlocked.includes('social') && userId) {
    try {
      const { listFriends } = await import('./social');
      const friends = await listFriends(userId);
      if (friends.length > 0) earned.push('social');
    } catch {
      // network/RLS failure - leave locked, retry next focus
    }
  }
  return earned;
}
