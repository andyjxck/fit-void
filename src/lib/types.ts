import type { CardioActivity } from './cardio';

export type WeightUnit = 'kg' | 'lbs';
export type SetType = 'normal' | 'warmup' | 'drop' | 'failure';
export type RecordType = '1rm' | 'max_weight' | 'max_volume' | 'max_hold_seconds' | 'max_distance';
export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'machine'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'other';
/** How a set is logged - most exercises are weight+reps, but cardio,
 *  timed holds (planks, stretches) and loaded carries track differently. */
export type TrackingType = 'strength' | 'cardio' | 'hold' | 'carry';
export type MetricType =
  | 'weight'
  | 'body_fat'
  | 'waist'
  | 'chest'
  | 'arm'
  | 'thigh'
  | 'resting_hr'
  | 'hrv'
  | 'sleep_hours';

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  weight_unit: WeightUnit;
  default_bar_weight: number;
  has_void_pro: boolean;
  created_at: string;
}

export interface Exercise {
  id: string;
  created_by: string | null; // NULL = global default library
  name: string;
  target_muscle: string;
  secondary_muscles: string[]; // TEXT[] in cloud, JSON text locally
  equipment: Equipment;
  tracking_type: TrackingType;
  instructions: string | null;
  is_custom: boolean;
  is_favourite: boolean;
  github_image_id: string | null;
}

export interface Routine {
  id: string;
  user_id: string | null;
  title: string;
  notes: string | null;
  folder_name: string;
  sort_order: number;
  /** Local-only: 1 when this row is a shared copy owned by someone else. */
  is_shared: number;
  /** When set, this row is a tab (sub-routine) of the parent routine. */
  parent_routine_id: string | null;
  /** Set while the routine sits in the Archive awaiting purge (28 days). */
  archived_at?: string | null;
}

export interface RoutineExercise {
  id: string;
  routine_id: string;
  exercise_id: string;
  superset_id: string | null;
  order_index: number;
  rest_seconds: number;
  target_sets: number;
  /** Per-set rep targets, e.g. [12, 10, 8, 6]. May be shorter than target_sets. */
  target_reps: (number | null)[];
  /** Per-set weight targets in kg; null = leave blank / use history. */
  target_weights: (number | null)[];
  /** Per-set kind, e.g. ['warmup','normal','normal']. Missing entries = normal. */
  target_types: SetType[];
  notes: string | null;
}

export interface Workout {
  id: string;
  user_id: string | null;
  routine_id: string | null;
  title: string;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  total_volume_kg: number;
  is_completed: boolean;
  feel: number | null;
}

export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  superset_id: string | null;
  set_order: number;
  set_type: SetType;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  /** Hold time (hold), or cardio/carry duration. */
  duration_seconds: number | null;
  /** Cardio or carry distance, metres. */
  distance_m: number | null;
  /** Optional heart rate for cardio/hold sets. */
  avg_hr: number | null;
  /** JSON bag of optional per-set extras (incline_pct, resistance, ...). */
  meta: string | null;
  is_completed: boolean;
  /** Last write - approximates when the set was completed. */
  updated_at: string;
}

export interface PersonalRecord {
  id: string;
  user_id: string | null;
  exercise_id: string;
  record_type: RecordType;
  value: number;
  achieved_at: string;
  workout_id: string | null;
}

export type NutritionSource = 'manual' | 'barcode' | 'quick' | 'googlehealth';

export interface NutritionEntry {
  id: string;
  user_id: string | null;
  /** Local calendar day, YYYY-MM-DD. */
  logged_on: string;
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  /** 1 when this entry is a beverage - also shadowed into liquid_entries. */
  is_drink: number;
  serving: string | null;
  barcode: string | null;
  source: NutritionSource;
}

export interface Macros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MealIngredient extends Macros {
  id: string;
  meal_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  barcode: string | null;
  sort_order: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'snack';

export interface Meal {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  servings: number;
  method: string[];
  tags: string[];
  source_url: string | null;
  pitch: string | null;
  minutes: number | null;
  goal: 'cut' | 'maintain' | 'bulk' | 'any' | null;
  meal_type: MealType | null;
  image_uri: string | null;
  is_favourite: boolean;
  sort_order: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealPlan {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  days: number;
  is_favourite: boolean;
  sort_order: number;
  pitch: string | null;
  goal: 'cut' | 'maintain' | 'bulk' | 'any' | null;
  tags: string[];
}

export interface MealPlanItem {
  id: string;
  plan_id: string;
  meal_id: string;
  day_index: number;
  slot: MealSlot;
  servings: number;
  sort_order: number;
}

export interface CardioSession {
  id: string;
  user_id: string | null;
  external_id: string | null;
  activity: CardioActivity;
  distance_m: number | null;
  duration_seconds: number;
  avg_hr: number | null;
  max_hr: number | null;
  zone_minutes: [number, number, number, number, number] | null;
  calories: number | null;
  /** JSON bag of activity extras (incline_pct, resistance, stroke_rate...). */
  meta: string | null;
  source: 'manual' | 'healthkit' | 'healthconnect';
  started_at: string;
  notes: string | null;
}

export interface BodyMeasurement {
  id: string;
  user_id: string | null;
  metric_type: MetricType;
  value: number;
  logged_at: string;
}
