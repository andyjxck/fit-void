import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WorkoutSummary } from '@/components/workout/WorkoutSummary';
import { getDb } from '@/db/client';
import { deleteWorkout, setWorkoutFeel } from '@/db/repo/workouts';
import { ACTIVITY_EXTRAS, formatExtras, hkActivityToCardio, mergeCardioExtras } from '@/lib/cardio';
import { brzycki } from '@/lib/onerm';
import type { FinalizeSummary } from '@/store/activeWorkout';
import { confirm } from '@/store/notify';
import { Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

interface WorkoutRow {
  id: string;
  title: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  total_volume_kg: number | null;
  feel: number | null;
}

interface SetRow {
  exercise_id: string;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  meta: string | null;
  is_completed: number;
  set_type: string;
  set_order: number;
}

interface PrRow {
  exercise_id: string;
  record_type: string;
  value: number;
}

interface ExName {
  id: string;
  name: string;
  tracking_type: string;
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<FinalizeSummary | null>(null);
  const [feel, setFeel] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const db = await getDb();
      const workout = await db.getFirstAsync<WorkoutRow>(
        `SELECT id, title, started_at, completed_at, duration_seconds, total_volume_kg, feel
           FROM workouts WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
        id
      );
      if (!workout) {
        router.back();
        return;
      }
      setFeel(workout.feel);
      const sets = await db.getAllAsync<SetRow>(
        `SELECT exercise_id, weight_kg, reps, rpe, duration_seconds, distance_m, meta, is_completed, set_type, set_order
           FROM workout_sets WHERE workout_id = ? AND deleted_at IS NULL ORDER BY set_order`,
        id
      );
      const prs = await db.getAllAsync<PrRow>(
        `SELECT exercise_id, record_type, value FROM personal_records WHERE workout_id = ? AND deleted_at IS NULL`,
        id
      );
      const exIds = [...new Set(sets.map((s) => s.exercise_id))];
      const exNames: Record<string, string> = {};
      const exTracking: Record<string, string> = {};
      for (const eid of exIds) {
        const ex = await db.getFirstAsync<ExName>(
          `SELECT id, name, tracking_type FROM exercises WHERE id = ?`,
          eid
        );
        if (ex) {
          exNames[eid] = ex.name;
          exTracking[eid] = ex.tracking_type;
        }
      }

      // Build exercise breakdown
      const byExercise = new Map<string, { sets: SetRow[] }>();
      for (const s of sets) {
        if (!byExercise.has(s.exercise_id)) byExercise.set(s.exercise_id, { sets: [] });
        byExercise.get(s.exercise_id)!.sets.push(s);
      }

      const exercises: FinalizeSummary['exercises'] = [];
      for (const [eid, { sets: exSets }] of byExercise) {
        let bestE1rm = 0;
        let bestWeightKg: number | null = null;
        let bestReps: number | null = null;
        let bestDurationSeconds: number | null = null;
        let bestDistanceM: number | null = null;
        let completedCount = 0;
        let rpeSum = 0;
        let rpeCount = 0;
        for (const s of exSets) {
          if (!s.is_completed) continue;
          completedCount++;
          if (s.rpe != null) {
            rpeSum += s.rpe;
            rpeCount++;
          }
          const w = s.weight_kg ?? 0;
          const r = s.reps ?? 0;
          const e1rm = w > 0 && r > 0 ? brzycki(w, r) : 0;
          if (e1rm > bestE1rm) {
            bestE1rm = e1rm;
            bestWeightKg = w;
            bestReps = r;
          }
          if (s.duration_seconds != null && (bestDurationSeconds == null || s.duration_seconds > bestDurationSeconds)) {
            bestDurationSeconds = s.duration_seconds;
          }
          if (s.distance_m != null && (bestDistanceM == null || s.distance_m > bestDistanceM)) {
            bestDistanceM = s.distance_m;
          }
        }
        // Cardio extras (incline, stroke rate...) merge exactly like at
        // finalize so the history line matches the session row.
        const name = exNames[eid] ?? 'Unknown';
        const activity = hkActivityToCardio(name);
        const merged =
          exTracking[eid] === 'cardio'
            ? mergeCardioExtras(
                exSets.map((s) => ({
                  meta: s.meta ? (JSON.parse(s.meta) as Record<string, number>) : undefined,
                })),
                ACTIVITY_EXTRAS[activity]
              )
            : null;
        exercises.push({
          name,
          setCount: completedCount,
          bestWeightKg,
          bestReps,
          bestE1rm,
          bestDurationSeconds,
          bestDistanceM,
          avgRpe: rpeCount ? Math.round((rpeSum / rpeCount) * 10) / 10 : null,
          extrasText: merged ? formatExtras(merged, activity) : null,
        });
      }

      setSummary({
        workoutId: workout.id,
        title: workout.title,
        completedAt: workout.completed_at ?? workout.started_at,
        durationSec: workout.duration_seconds ?? 0,
        volumeKg: workout.total_volume_kg ?? 0,
        setCount: sets.filter((s) => s.is_completed).length,
        exerciseCount: byExercise.size,
        prs: prs.map((p) => ({
          exerciseName: exNames[p.exercise_id] ?? 'Unknown',
          recordType: p.record_type,
          value: p.value,
        })),
        exercises,
      });
    })();
  }, [id, router]);

  if (!summary) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Void.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => goBack()} hitSlop={8}>
          <ChevronLeft color={Void.text} size={24} />
        </Pressable>
        <Pressable
          onPress={() => {
            void (async () => {
              const ok = await confirm({
                title: 'Archive workout?',
                body: summary.title,
                confirmText: 'ARCHIVE',
              });
              if (!ok) return;
              await deleteWorkout(id);
              router.back();
            })();
          }}
          hitSlop={8}>
          <Trash2 color={Void.textSecondary} size={20} />
        </Pressable>
      </View>
      <WorkoutSummary
        summary={summary}
        onClose={() => router.back()}
        initialFeel={feel}
        onRate={(n) => {
          setFeel(n);
          void setWorkoutFeel(summary.workoutId, n);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Void.canvas },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  loading: { flex: 1, backgroundColor: Void.canvas, alignItems: 'center', justifyContent: 'center' },
});
