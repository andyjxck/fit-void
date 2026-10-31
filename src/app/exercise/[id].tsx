import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronLeft, ListPlus, Star, Trash2, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';

import { Card, Screen, SectionLabel, Stat } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { deleteExercise, getExercise, toggleFavourite } from '@/db/repo/exercises';
import { listMeasurements } from '@/db/repo/measurements';
import { addRoutineExercise, getRoutineExercises, listRoutines } from '@/db/repo/routines';
import { bestPRs, oneRMHistory } from '@/db/repo/workouts';
import { getExerciseImages } from '@/lib/exerciseImages';
import { formatDate, formatVolume } from '@/lib/format';
import type { Exercise, Routine } from '@/lib/types';
import { confirm } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

function Sparkline({ data, width = 320, height = 120 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 8;
  const pts = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Polyline points={pts} fill="none" stroke={Void.accent} strokeWidth={2} />
    </Svg>
  );
}

export default function ExerciseDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [prs, setPrs] = useState<Record<string, number | undefined>>({});
  const [history, setHistory] = useState<{ achieved_at: string; value: number }[]>([]);
  const [bodyweightKg, setBodyweightKg] = useState<number | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinePickerOpen, setRoutinePickerOpen] = useState(false);
  const [addedToRoutine, setAddedToRoutine] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      void getExercise(id).then(setExercise);
      void bestPRs(id).then(setPrs);
      void oneRMHistory(id).then(setHistory);
      void listMeasurements('weight').then((w) => setBodyweightKg(w[0]?.value ?? null));
      void listRoutines().then((rs) => setRoutines(rs.filter((r) => !r.folder_name.startsWith('Examples ·'))));
    }, [id])
  );

  if (!exercise) return <Screen />;

  const images = getExerciseImages(id, exercise.github_image_id);

  const addToRoutine = async (routineId: string, routineTitle: string) => {
    const existing = await getRoutineExercises(routineId);
    const maxOrder = existing.reduce((m, e) => Math.max(m, e.order_index), -1) + 1;
    await addRoutineExercise({
      routine_id: routineId,
      exercise_id: id,
      order_index: maxOrder,
    });
    setAddedToRoutine(routineId);
    setTimeout(() => setAddedToRoutine(null), 2000);
    void setRoutinePickerOpen(false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack()} hitSlop={8}>
          <ChevronLeft color={Void.text} size={24} />
        </Pressable>
        <Pressable
          onPress={() => {
            if (!exercise) return;
            setExercise({ ...exercise, is_favourite: !exercise.is_favourite });
            void toggleFavourite(id);
          }}
          hitSlop={8}>
          <Star
            color={exercise.is_favourite ? Void.accent : Void.textTertiary}
            fill={exercise.is_favourite ? Void.accent : 'transparent'}
            size={22}
          />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <Text style={styles.name}>{exercise.name}</Text>
        <Text style={styles.meta}>
          {exercise.target_muscle}
          {exercise.secondary_muscles.length > 0 ? ` + ${exercise.secondary_muscles.join(', ')}` : ''}
          {'  ·  '}
          {exercise.equipment}
        </Text>

        {/* Quick actions */}
        {images.start && (
          <View style={styles.imageRow}>
            <Pressable style={{ flex: 1 }} onPress={() => setViewerImage(images.start)}>
              <Image source={{ uri: images.start }} style={styles.exerciseImage} contentFit="contain" cachePolicy="memory-disk" transition={150} />
            </Pressable>
            {images.end && (
              <Pressable style={{ flex: 1 }} onPress={() => setViewerImage(images.end)}>
                <Image source={{ uri: images.end }} style={styles.exerciseImage} contentFit="contain" cachePolicy="memory-disk" transition={150} />
              </Pressable>
            )}
          </View>
        )}

        <SectionLabel>PERSONAL RECORDS</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row' }}>
            <Stat
              label="EST. 1RM"
              value={prs['1rm'] ? formatVolume(prs['1rm'], unit) : '-'}
              accent
            />
            <Stat
              label="MAX WEIGHT"
              value={prs['max_weight'] ? `${formatVolume(prs['max_weight'], unit)} ${unit}` : '-'}
            />
            <Stat
              label="MAX VOLUME"
              value={prs['max_volume'] ? formatVolume(prs['max_volume'], unit) : '-'}
            />
            <Stat
              label="× BODYWEIGHT"
              value={
                prs['1rm'] && bodyweightKg
                  ? `${(prs['1rm'] / bodyweightKg).toFixed(2)}×`
                  : '-'
              }
            />
          </View>
        </Card>

        <SectionLabel>1RM PROGRESSION</SectionLabel>
        <Card>
          {history.length < 2 ? (
            <Text style={styles.empty}>
              Beat your estimated 1RM in two sessions to draw the curve.
            </Text>
          ) : (
            <>
              <Sparkline data={history.map((h) => h.value)} />
              <View style={styles.histRow}>
                {history.slice(-6).map((h, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={styles.histVal}>{formatVolume(h.value, unit)}</Text>
                    <Text style={styles.histDate}>{formatDate(h.achieved_at)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </Card>

        {exercise.instructions ? (
          <>
            <SectionLabel>INSTRUCTIONS</SectionLabel>
            <Card>
              <Text style={styles.instructions}>{exercise.instructions}</Text>
            </Card>
          </>
        ) : null}

        {/* Add to routine - fixed at bottom */}
        {exercise.is_custom && (
          <Pressable
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
            onPress={() => {
              void (async () => {
                const ok = await confirm({
                  title: 'Remove exercise?',
                  body: exercise.name,
                  confirmText: 'REMOVE',
                  destructive: true,
                });
                if (!ok) return;
                await deleteExercise(id);
                router.back();
              })();
            }}>
            <Trash2 color={Void.textTertiary} size={16} />
            <Text style={styles.deleteBtnText}>REMOVE FROM LIBRARY</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Add to routine - fixed at bottom */}
      <View style={styles.bottomBar}>
        <Pressable
          style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setRoutinePickerOpen(true)}>
          <ListPlus color={Void.accentText} size={16} />
          <Text style={styles.quickBtnText}>ADD TO ROUTINE</Text>
        </Pressable>
      </View>

      {/* Full-screen image viewer */}
      <Modal visible={viewerImage != null} transparent animationType="fade">
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerImage(null)}>
          <View style={[styles.viewerClose, { top: insets.top + 8 }]}>
            <X color={Void.text} size={24} />
          </View>
          {viewerImage && (
            <Image
              source={{ uri: viewerImage }}
              style={styles.viewerImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
        </Pressable>
      </Modal>

      {/* Add to routine picker */}
      <Sheet visible={routinePickerOpen} onClose={() => setRoutinePickerOpen(false)} title="ADD TO ROUTINE">
        {routines.length === 0 && (
          <Text style={styles.sheetEmpty}>No routines yet. Create one from the Train tab.</Text>
        )}
        <ScrollView style={{ maxHeight: 400 }}>
          {routines.map((r) => (
            <Pressable
              key={r.id}
              style={styles.routineOption}
              onPress={() => void addToRoutine(r.id, r.title)}>
              <Text style={styles.routineOptionText}>{r.title}</Text>
              {addedToRoutine === r.id && <Check color={Void.accent} size={18} />}
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => setRoutinePickerOpen(false)}
          style={[styles.sheetCloseBtn]}>
          <Text style={styles.sheetCloseText}>DONE</Text>
        </Pressable>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 4 },
  name: { color: Void.text, fontSize: 24, fontWeight: '800', paddingHorizontal: 16 },
  meta: { color: Void.textTertiary, fontSize: 13, paddingHorizontal: 16, marginTop: 4 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 16,
    paddingBottom: 34,
    backgroundColor: Void.canvas,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Void.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    minWidth: 220,
  },
  quickBtnText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  imageRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14 },
  exerciseImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: Void.surface,
  },
  empty: { color: Void.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  histRow: { flexDirection: 'row', marginTop: 8 },
  histVal: { color: Void.text, fontSize: 11, fontWeight: '600', ...tabular },
  histDate: { color: Void.textTertiary, fontSize: 9, marginTop: 2 },
  instructions: { color: Void.textSecondary, fontSize: 14, lineHeight: 21 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 12,
  },
  deleteBtnText: { color: Void.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  // Image viewer
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerClose: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
  },
  viewerImage: {
    width: '100%',
    height: '70%',
  },
  // Routine picker
  sheetEmpty: { color: Void.textTertiary, fontSize: 13, paddingVertical: 8 },
  routineOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  routineOptionText: { color: Void.text, fontSize: 15, fontWeight: '600' },
  sheetCloseBtn: {
    alignSelf: 'flex-end',
    marginTop: 14,
    backgroundColor: Void.accent,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  sheetCloseText: { color: Void.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});
