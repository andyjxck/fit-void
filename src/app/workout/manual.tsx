import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { Calendar, Minus, Plus, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { Card, Screen, ScreenHeader } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { listExercises } from '@/db/repo/exercises';
import { latestWeightKg } from '@/db/repo/measurements';
import { logManualWorkout } from '@/db/repo/workouts';
import { getExerciseImageUrl } from '@/lib/exerciseImages';
import { parseWeight } from '@/lib/format';
import type { Exercise } from '@/lib/types';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

interface ManualSet {
  weight: string;
  reps: string;
}

interface ManualExercise {
  exercise: Exercise;
  sets: ManualSet[];
}

// Unambiguous YYYY-MM-DD - toLocaleDateString() renders DD/MM on en-GB devices
// while the old parser assumed MM/DD, silently swapping the fields.
function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Strict YYYY-MM-DD (or YYYY/MM/DD); rejects 2-digit years and impossible dates. */
function parseDateInput(v: string): Date | null {
  const m = v.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export default function ManualWorkoutScreen() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const unit = useSettings((s) => s.weight_unit);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [duration, setDuration] = useState('45');
  const [exercises, setExercises] = useState<ManualExercise[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      void listExercises().then(setAllExercises);
    }, [])
  );

  const filtered = allExercises.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  const addExercise = (ex: Exercise) => {
    setExercises((prev) => [...prev, { exercise: ex, sets: [{ weight: '', reps: '' }] }]);
    setPickerOpen(false);
    setSearch('');
  };

  const removeExercise = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
  };

  const addSet = (index: number) => {
    setExercises((prev) =>
      prev.map((e, i) =>
        i === index ? { ...e, sets: [...e.sets, { weight: '', reps: '' }] } : e
      )
    );
  };

  const removeSet = (exIndex: number, setIndex: number) => {
    setExercises((prev) =>
      prev.map((e, i) =>
        i === exIndex
          ? { ...e, sets: e.sets.filter((_, si) => si !== setIndex) }
          : e
      )
    );
  };

  const updateSet = (exIndex: number, setIndex: number, field: 'weight' | 'reps', value: string) => {
    setExercises((prev) =>
      prev.map((e, i) =>
        i === exIndex
          ? {
              ...e,
              sets: e.sets.map((s, si) =>
                si === setIndex ? { ...s, [field]: value } : s
              ),
            }
          : e
      )
    );
  };

  const save = async () => {
    if (!title.trim()) {
      notify('Title required', { body: 'Give your workout a name.', tone: 'info' });
      return;
    }
    if (exercises.length === 0) {
      notify('No exercises', { body: 'Add at least one exercise.', tone: 'info' });
      return;
    }

    const startedAt = new Date(date).toISOString();
    const completedAt = new Date(new Date(date).getTime() + (parseInt(duration) || 45) * 60 * 1000).toISOString();

    // Bodyweight exercises: the weight field is ADDED load - bake
    // bodyweight + added into weight_kg so it matches what the live-workout
    // finalizer persists (and ghosts/e1RM/volume agree).
    const hasBw = exercises.some((e) => e.exercise.equipment === 'bodyweight');
    const bwKg = hasBw ? await latestWeightKg() : null;

    await logManualWorkout({
      title: title.trim(),
      started_at: startedAt,
      completed_at: completedAt,
      duration_seconds: (parseInt(duration) || 45) * 60,
      user_id: userId,
      exercises: exercises.map((e) => {
        const isBw = e.exercise.equipment === 'bodyweight';
        return {
          exercise_id: e.exercise.id,
          sets: e.sets
            .filter((s) => s.weight || s.reps)
            .map((s) => {
              // Weight is typed in display units - convert to canonical kg.
              // parseWeight/parseInt can yield NaN; keep it out of SQLite.
              const repsN = s.reps ? parseInt(s.reps, 10) : NaN;
              const entered = s.weight ? (parseWeight(s.weight, unit) ?? 0) : 0;
              return {
                weight_kg: (Number.isFinite(entered) ? entered : 0) + (isBw ? (bwKg ?? 0) : 0),
                reps: Number.isFinite(repsN) ? repsN : null,
              };
            }),
        };
      }),
    });

    router.back();
  };

  return (
    <Screen>
      <ScreenHeader
        title="Log Workout"
        right={
          <Pressable onPress={() => goBack()} hitSlop={8}>
            <X color={Void.textSecondary} size={22} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Title */}
        <TextInput
          style={styles.input}
          placeholder="Workout title"
          placeholderTextColor={Void.textTertiary}
          value={title}
          onChangeText={setTitle}
        />

        {/* Date & duration */}
        <View style={styles.metaRow}>
          <View style={styles.metaField}>
            <Calendar color={Void.textTertiary} size={14} />
            <TextInput
              style={styles.metaInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Void.textTertiary}
              value={formatDateInput(date)}
              onChangeText={(v) => {
                const d = parseDateInput(v);
                if (d) setDate(d);
              }}
            />
          </View>
          <View style={styles.metaField}>
            <Text style={styles.metaLabel}>MIN</Text>
            <TextInput
              style={styles.metaInput}
              placeholder="45"
              placeholderTextColor={Void.textTertiary}
              value={duration}
              onChangeText={setDuration}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Exercises */}
        {exercises.map((ex, exIndex) => {
          const imgUrl = getExerciseImageUrl(ex.exercise.id, 1, ex.exercise.github_image_id);
          return (
            <Card key={exIndex} style={styles.exCard}>
              <View style={styles.exHeader}>
                <View style={styles.exInfo}>
                  {imgUrl && (
                    <Image source={{ uri: imgUrl }} style={styles.exThumb} contentFit="contain" cachePolicy="memory-disk" transition={150} />
                  )}
                  <Text style={styles.exName}>{ex.exercise.name}</Text>
                </View>
                <Pressable onPress={() => removeExercise(exIndex)} hitSlop={8}>
                  <X color={Void.textTertiary} size={16} />
                </Pressable>
              </View>

              {/* Set header */}
              <View style={styles.setHeader}>
                <Text style={styles.setLabel}>SET</Text>
                <Text style={styles.setLabel}>
                  {ex.exercise.equipment === 'bodyweight' ? `ADDED (${unit})` : `WEIGHT (${unit})`}
                </Text>
                <Text style={styles.setLabel}>REPS</Text>
                <View style={{ width: 24 }} />
              </View>

              {ex.sets.map((s, setIndex) => (
                <View key={setIndex} style={styles.setRow}>
                  <Text style={styles.setNumber}>{setIndex + 1}</Text>
                  <TextInput
                    style={styles.setInput}
                    placeholder="-"
                    placeholderTextColor={Void.textTertiary}
                    value={s.weight}
                    onChangeText={(v) => updateSet(exIndex, setIndex, 'weight', v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={styles.setInput}
                    placeholder="-"
                    placeholderTextColor={Void.textTertiary}
                    value={s.reps}
                    onChangeText={(v) => updateSet(exIndex, setIndex, 'reps', v)}
                    keyboardType="numeric"
                  />
                  <Pressable
                    onPress={() => ex.sets.length > 1 && removeSet(exIndex, setIndex)}
                    disabled={ex.sets.length <= 1}
                    hitSlop={8}>
                    <Minus
                      color={ex.sets.length > 1 ? Void.textTertiary : Void.border}
                      size={16}
                    />
                  </Pressable>
                </View>
              ))}

              <Pressable
                style={({ pressed }) => [styles.addSetBtn, pressed && { opacity: 0.85 }]}
                onPress={() => addSet(exIndex)}>
                <Plus color={Void.accent} size={14} />
                <Text style={styles.addSetText}>ADD SET</Text>
              </Pressable>
            </Card>
          );
        })}

        {/* Add exercise button */}
        <Pressable
          style={({ pressed }) => [styles.addExBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setPickerOpen(true)}>
          <Plus color={Void.accent} size={18} />
          <Text style={styles.addExText}>ADD EXERCISE</Text>
        </Pressable>
      </ScrollView>

      {/* Save button */}
      <View style={styles.saveBar}>
        <Pressable
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
          onPress={() => void save()}>
          <Text style={styles.saveBtnText}>SAVE WORKOUT</Text>
        </Pressable>
      </View>

      {/* Exercise picker */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="ADD EXERCISE">
        <TextInput
              style={styles.pickerSearch}
              placeholder="Search exercises"
              placeholderTextColor={Void.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
            <FlatList
              data={filtered.slice(0, 30)}
              keyExtractor={(e) => e.id}
              style={{ maxHeight: 350 }}
              renderItem={({ item }) => {
                const imgUrl = getExerciseImageUrl(item.id, 1, item.github_image_id);
                return (
                  <Pressable
                    style={({ pressed }) => [styles.pickerItem, pressed && { backgroundColor: Void.surface }]}
                    onPress={() => addExercise(item)}>
                    {imgUrl && (
                      <Image source={{ uri: imgUrl }} style={styles.pickerThumb} contentFit="contain" cachePolicy="memory-disk" transition={150} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerItemName}>{item.name}</Text>
                      <Text style={styles.pickerItemMeta}>
                        {item.target_muscle} · {item.equipment}
                      </Text>
                    </View>
                    <Plus color={Void.accent} size={18} />
                  </Pressable>
                );
              }}
            />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Void.text,
    fontSize: 16,
    fontWeight: '600',
  },
  metaRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  metaField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metaLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  metaInput: { flex: 1, color: Void.text, fontSize: 14 },
  exCard: { marginHorizontal: 16, marginBottom: 12, padding: 14 },
  exHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  exInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  exThumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: Void.canvas },
  exName: { color: Void.text, fontSize: 15, fontWeight: '700', flex: 1 },
  setHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  setLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, flex: 1 },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  setNumber: { color: Void.textTertiary, fontSize: 13, fontWeight: '600', width: 20 },
  setInput: {
    flex: 1,
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: Void.text,
    fontSize: 14,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  addSetText: { color: Void.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  addExBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 12,
  },
  addExText: { color: Void.accent, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 34,
    backgroundColor: Void.canvas,
  },
  saveBtn: {
    backgroundColor: Void.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: { color: Void.accentText, fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  // Picker
  pickerSearch: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Void.text,
    fontSize: 15,
    marginBottom: 10,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  pickerThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Void.canvas },
  pickerItemName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  pickerItemMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
});
