/**
 * Widget type definitions for the customizable Train tab.
 * Grid is 2 columns wide. Size format is WxH where W=width (1=half, 2=full),
 * H=height (1=short, 2=tall).
 */

export type WidgetSize = '1x1' | '1x2' | '2x1' | '2x2';

export type WidgetType =
  | 'weekly_consistency'
  | 'routine'
  | 'example_routine'
  | 'folder'
  | 'readiness'
  | 'streak'
  | 'strength_score'
  | 'today_calories'
  | 'today_protein'
  | 'hydration'
  | 'body_weight'
  | 'resting_hr'
  | 'sleep'
  | 'week_volume'
  | 'last_pr'
  | 'recent_prs'
  | 'hard_sets'
  | 'top_lifts'
  | 'cardio_weekly'
  | 'last_workout'
  | 'plate_calculator'
  | 'rest_timer'
  | 'quick_cardio'
  | 'exercise_quick_add'
  | 'text_goal'
  | 'friends_snapshot';

export interface WidgetItem {
  id: string;
  widget_type: WidgetType;
  config: Record<string, unknown>;
  size: WidgetSize;
  sort_order: number;
  visible: number;
}

/** Which sizes each widget type supports. */
export const WIDGET_SIZES: Record<WidgetType, WidgetSize[]> = {
  weekly_consistency: ['2x1', '2x2'],
  routine: ['1x1', '1x2', '2x1', '2x2'],
  example_routine: ['1x1', '1x2', '2x1', '2x2'],
  folder: ['1x1', '1x2', '2x1', '2x2'],
  readiness: ['2x1'],
  streak: ['2x1'],
  strength_score: ['2x1'],
  today_calories: ['1x1'],
  today_protein: ['1x1'],
  hydration: ['1x1'],
  body_weight: ['1x1'],
  resting_hr: ['1x1'],
  sleep: ['1x1'],
  week_volume: ['1x1'],
  last_pr: ['1x1'],
  recent_prs: ['1x2'],
  hard_sets: ['2x1'],
  top_lifts: ['2x1'],
  cardio_weekly: ['2x1'],
  last_workout: ['2x2'],
  plate_calculator: ['2x1'],
  rest_timer: ['1x1'],
  quick_cardio: ['1x1'],
  exercise_quick_add: ['1x2'],
  text_goal: ['1x1', '1x2', '2x1', '2x2'],
  friends_snapshot: ['1x1'],
};

/** Human-readable labels for the widget picker. */
export const WIDGET_LABELS: Record<WidgetType, string> = {
  weekly_consistency: 'Weekly Consistency',
  routine: 'Routine',
  example_routine: 'Example Routine',
  folder: 'Folder',
  readiness: 'Readiness Score',
  streak: 'Streak',
  strength_score: 'Strength Score',
  today_calories: "Today's Calories",
  today_protein: "Today's Protein",
  hydration: 'Hydration',
  body_weight: 'Body Weight',
  resting_hr: 'Resting HR',
  sleep: 'Sleep',
  week_volume: "This Week's Volume",
  last_pr: 'Last PR',
  recent_prs: 'Recent PRs',
  hard_sets: 'Hard Sets This Week',
  top_lifts: 'Top Lifts',
  cardio_weekly: 'Cardio This Week',
  last_workout: 'Last Workout',
  plate_calculator: 'Plate Calculator',
  rest_timer: 'Rest Timer',
  quick_cardio: 'Quick Log Cardio',
  exercise_quick_add: 'Exercise Quick-Add',
  text_goal: 'Custom Goal',
  friends_snapshot: 'Friends',
};

/** Widget types that can have multiple instances (one per entity). */
export const MULTI_INSTANCE_TYPES: WidgetType[] = ['routine', 'example_routine', 'folder', 'text_goal'];

/** Default widget layout - reproduces the existing Train tab.
 *  Routines and folders are seeded dynamically from the DB in ensureDefaultWidgets. */
export const DEFAULT_WIDGETS: Omit<WidgetItem, 'id'>[] = [
  { widget_type: 'weekly_consistency', config: {}, size: '2x1', sort_order: 0, visible: 1 },
  { widget_type: 'hydration', config: {}, size: '1x1', sort_order: 1, visible: 1 },
];

/** Parse size string into width and height in grid units. */
export function sizeDims(size: WidgetSize): { w: number; h: number } {
  const [w, h] = size.split('x').map(Number);
  return { w, h };
}
