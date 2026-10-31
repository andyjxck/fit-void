import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronLeft, Lock, Minus, Play, Plus, Trash2, Users, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollabSheet } from '@/components/routine/CollabSheet';
import { Screen } from '@/components/ui';
import { ExercisePicker } from '@/components/workout/ExercisePicker';
import { getExercise } from '@/db/repo/exercises';
import {
    addRoutineExercise,
    createRoutineTab,
    deleteRoutine,
    deleteRoutineTab,
    getRoutine,
    getRoutineExercises,
    listRoutineTabs,
    removeRoutineExercise,
    renameRoutine,
    updateRoutineExercise
} from '@/db/repo/routines';
import { displayWeight, parseWeight } from '@/lib/format';
import { goBack } from '@/lib/nav';
import { allowedOrPrompt, countRoutineTabs, isPro, showUpgradePrompt } from '@/lib/tiers';
import type { Routine, RoutineExercise, SetType } from '@/lib/types';
import { useActiveWorkout } from '@/store/activeWorkout';
import { confirm } from '@/store/notify';
import { useSettings, useWeightUnit } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

interface Row extends RoutineExercise {
  exercise_name: string;
}

const TYPE_META: Record<SetType, { letter: string; color: string }> = {
  normal: { letter: 'N', color: Void.textSecondary },
  warmup: { letter: 'W', color: Void.warmup },
  drop: { letter: 'D', color: Void.drop },
  failure: { letter: 'F', color: Void.failure },
};

const NEXT_TYPE: Record<SetType, SetType> = {
  normal: 'warmup',
  warmup: 'drop',
  drop: 'failure',
  failure: 'normal',
};

export default function RoutineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const startWorkout = useActiveWorkout((s) => s.startWorkout);
  const live = useActiveWorkout((s) => s.workoutId !== null);

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  // Tabs: activeTab === null edits the parent's own list; otherwise a tab id.
  const [tabs, setTabs] = useState<Routine[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [tabDraft, setTabDraft] = useState('');
  const weight_unit = useWeightUnit();
  const me = useSettings((s) => s.supabase_user_id);

  // The routine row the exercise list belongs to - parent or selected tab.
  const targetRoutineId = activeTab ?? id;

  const refresh = useCallback(async () => {
    if (!id) return;
    setRoutine(await getRoutine(id));
    setTabs(await listRoutineTabs(id));
    const exs = await getRoutineExercises(targetRoutineId!);
    const named = await Promise.all(
      exs.map(async (re) => ({
        ...re,
        exercise_name: (await getExercise(re.exercise_id))?.name ?? 'Exercise',
      }))
    );
    setRows(named);
  }, [id, targetRoutineId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const addTab = useCallback(async () => {
    if (!id) return;
    if (routine?.is_shared === 1 && !isPro()) {
      // Collab is unlocked by a Pro member; only Pro members add tabs.
      showUpgradePrompt(
        'Only Pro members add tabs',
        'This collaboration is unlocked by a Pro member - tab creation stays with them. You can use every tab they make.'
      );
      return;
    }
    if (!(await allowedOrPrompt('routineTabs', await countRoutineTabs(id)))) {
      return;
    }
    const t = await createRoutineTab(id, `Tab ${tabs.length + 1}`);
    setActiveTab(t.id);
    setRenamingTab(t.id);
    setTabDraft(t.title);
  }, [id, tabs.length, routine?.is_shared]);

  const commitTabRename = useCallback(async () => {
    if (renamingTab && tabDraft.trim()) await renameRoutine(renamingTab, tabDraft);
    setRenamingTab(null);
    void refresh();
  }, [renamingTab, tabDraft, refresh]);

  const removeTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      const ok = await confirm({
        title: 'Delete tab?',
        body: `${tab?.title ?? 'Tab'} and its exercise list are removed for everyone.`,
        confirmText: 'DELETE',
        destructive: true,
      });
      if (!ok) return;
      await deleteRoutineTab(tabId);
      if (activeTab === tabId) setActiveTab(null);
      void refresh();
    },
    [tabs, activeTab, refresh]
  );

  const patchRow = useCallback((row: Row, patch: Partial<RoutineExercise>) => {
    void updateRoutineExercise(row.id, patch);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
  }, []);

  const bumpRest = useCallback(
    (row: Row, delta: number) => patchRow(row, { rest_seconds: Math.max(0, row.rest_seconds + delta) }),
    [patchRow]
  );

  // Per-set cell edits. Drafts hold the in-progress text so typing overwrites
  // cleanly (selectTextOnFocus) without the parsed value snapping back.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = (rowId: string, setIdx: number, field: 'w' | 'r') => `${rowId}:${setIdx}:${field}`;

  // Draft keys embed the set index, so they go stale when sets are added or
  // removed. Drop all drafts for the row on structural change.
  const clearRowDrafts = useCallback((rowId: string) => {
    setDrafts((d) => {
      const next = { ...d };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${rowId}:`)) delete next[k];
      }
      return next;
    });
  }, []);

  const setReps = useCallback(
    (row: Row, setIdx: number, text: string) => {
      setDrafts((d) => ({ ...d, [draftKey(row.id, setIdx, 'r')]: text }));
      const reps: (number | null)[] = [...row.target_reps];
      while (reps.length < row.target_sets) reps.push(reps[reps.length - 1] ?? 10);
      const n = parseInt(text, 10);
      // Blank or unparseable input stores null (like setWeight) - never 0.
      reps[setIdx] = text.trim() === '' ? null : Number.isFinite(n) && n >= 0 ? n : null;
      patchRow(row, { target_reps: reps.slice(0, row.target_sets) as number[] });
    },
    [patchRow]
  );

  const setWeight = useCallback(
    (row: Row, setIdx: number, text: string) => {
      setDrafts((d) => ({ ...d, [draftKey(row.id, setIdx, 'w')]: text }));
      const weights = [...row.target_weights];
      while (weights.length < row.target_sets) weights.push(null);
      weights[setIdx] = text.trim() === '' ? null : parseWeight(text, weight_unit);
      patchRow(row, { target_weights: weights.slice(0, row.target_sets) });
    },
    [patchRow, weight_unit]
  );

  const cycleType = useCallback(
    (row: Row, setIdx: number) => {
      const types = [...row.target_types];
      while (types.length < row.target_sets) types.push('normal');
      types[setIdx] = NEXT_TYPE[types[setIdx] ?? 'normal'];
      patchRow(row, { target_types: types.slice(0, row.target_sets) });
    },
    [patchRow]
  );

  const addSet = useCallback(
    (row: Row) => {
      clearRowDrafts(row.id);
      const n = row.target_sets + 1;
      const reps = [...row.target_reps];
      while (reps.length < n) reps.push(reps[reps.length - 1] ?? 10);
      const weights = [...row.target_weights];
      while (weights.length < n) weights.push(null);
      const types = [...row.target_types];
      while (types.length < n) types.push('normal');
      patchRow(row, {
        target_sets: n,
        target_reps: reps.slice(0, n),
        target_weights: weights.slice(0, n),
        target_types: types.slice(0, n),
      });
    },
    [patchRow, clearRowDrafts]
  );

  const removeSet = useCallback(
    (row: Row, setIdx: number) => {
      if (row.target_sets <= 1) return;
      clearRowDrafts(row.id);
      const n = row.target_sets - 1;
      const drop = <T,>(arr: T[]) => arr.filter((_, i) => i !== setIdx).slice(0, n);
      patchRow(row, {
        target_sets: n,
        target_reps: drop(row.target_reps),
        target_weights: drop(row.target_weights),
        target_types: drop(row.target_types),
      });
    },
    [patchRow, clearRowDrafts]
  );

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack()} hitSlop={8}>
          <ChevronLeft color={Void.text} size={24} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable onPress={() => setCollabOpen(true)} hitSlop={8}>
            <Users color={Void.textSecondary} size={19} />
            {!isPro() && routine?.is_shared !== 1 && (
              <View style={styles.collabLock}>
                <Lock color={Void.accent} size={9} />
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={() =>
              void (async () => {
                const shared = routine?.is_shared === 1;
                const ok = await confirm({
                  title: shared ? 'Delete routine for everyone?' : 'Delete routine?',
                  body: shared
                    ? routine?.title
                    : `${routine?.title ?? ''} - sits in Archive for 28 days`,
                  confirmText: 'DELETE',
                  destructive: true,
                });
                if (!ok) return;
                await deleteRoutine(id!);
                router.back();
              })()
            }
            hitSlop={8}>
            <Trash2 color={Void.textTertiary} size={18} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.title}>
        {routine?.title ?? 'Routine'}
        {routine?.is_shared === 1 ? <Text style={styles.sharedTag}>  SHARED</Text> : null}
      </Text>

      {/* Tab strip: appears once a routine has tabs or can host collaborators
          (signed-in). Each tab is its own exercise list - the parent's list is
          MAIN. Long-press a tab to rename/delete it. */}
      {(tabs.length > 0 || me) && (
        <View style={styles.tabStrip}>
          <Pressable
            style={[styles.tabChip, activeTab === null && styles.tabChipSel]}
            onPress={() => setActiveTab(null)}>
            <Text style={[styles.tabChipText, activeTab === null && styles.tabChipTextSel]}>
              MAIN
            </Text>
          </Pressable>
          {tabs.map((t) =>
            renamingTab === t.id ? (
              <View key={t.id} style={[styles.tabChip, styles.tabChipSel, styles.tabEditChip]}>
                <TextInput
                  style={styles.tabInput}
                  value={tabDraft}
                  onChangeText={setTabDraft}
                  autoFocus
                  onSubmitEditing={() => void commitTabRename()}
                  onBlur={() => void commitTabRename()}
                  placeholderTextColor={Void.ghost}
                />
                <Pressable onPress={() => void commitTabRename()} hitSlop={6}>
                  <Check size={13} color={Void.accent} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                key={t.id}
                style={[styles.tabChip, activeTab === t.id && styles.tabChipSel]}
                onPress={() => setActiveTab(t.id)}
                onLongPress={() => {
                  setRenamingTab(t.id);
                  setTabDraft(t.title);
                }}>
                <Text style={[styles.tabChipText, activeTab === t.id && styles.tabChipTextSel]}>
                  {t.title.toUpperCase()}
                </Text>
                {activeTab === t.id && (
                  <Pressable onPress={() => void removeTab(t.id)} hitSlop={8}>
                    <X size={11} color={Void.textTertiary} />
                  </Pressable>
                )}
              </Pressable>
            )
          )}
          <Pressable style={styles.tabChip} onPress={() => void addTab()} hitSlop={6}>
            <Plus size={12} color={Void.accent} />
            <Text style={styles.tabChipText}>TAB</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.order}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.exercise_name}</Text>
              </View>
              <Pressable
                onPress={() => {
                  clearRowDrafts(item.id);
                  void removeRoutineExercise(item.id).then(refresh);
                }}
                hitSlop={6}>
                <Trash2 size={15} color={Void.textTertiary} />
              </Pressable>
            </View>
            {/* Per-set rows - same shape as the live workout set row */}
            {Array.from({ length: item.target_sets }, (_, si) => {
              const type = item.target_types[si] ?? 'normal';
              const meta = TYPE_META[type];
              const wKg = item.target_weights[si] ?? null;
              const wDraft = drafts[draftKey(item.id, si, 'w')];
              const rDraft = drafts[draftKey(item.id, si, 'r')];
              const reps = item.target_reps[si] ?? item.target_reps[item.target_reps.length - 1] ?? 10;
              return (
                <View key={si} style={styles.setRow}>
                  <Pressable style={styles.setBadge} onPress={() => cycleType(item, si)} hitSlop={4}>
                    <Text style={[styles.setLetter, { color: meta.color }]}>{meta.letter}</Text>
                    <Text style={styles.setNum}>{si + 1}</Text>
                  </Pressable>

                  <View style={styles.setValueZone}>
                    <TextInput
                      style={styles.setInput}
                      value={wDraft ?? displayWeight(wKg, weight_unit)}
                      onChangeText={(t) => setWeight(item, si, t)}
                      keyboardType="decimal-pad"
                      placeholder="-"
                      placeholderTextColor={Void.ghost}
                      selectTextOnFocus
                    />
                    <Text style={styles.setUnit}> {weight_unit}</Text>
                  </View>

                  <Text style={styles.setTimes}>×</Text>

                  <View style={styles.setValueZone}>
                    <TextInput
                      style={styles.setInput}
                      value={rDraft ?? String(reps)}
                      onChangeText={(t) => setReps(item, si, t)}
                      keyboardType="number-pad"
                      placeholder="-"
                      placeholderTextColor={Void.ghost}
                      selectTextOnFocus
                    />
                  </View>

                  {item.target_sets > 1 ? (
                    <Pressable style={styles.setRemove} onPress={() => removeSet(item, si)} hitSlop={8}>
                      <X size={14} color={Void.textTertiary} />
                    </Pressable>
                  ) : (
                    <View style={styles.setRemove} />
                  )}
                </View>
              );
            })}

            <Pressable style={styles.addSetBtn} onPress={() => addSet(item)} hitSlop={6}>
              <Plus size={13} color={Void.accent} />
              <Text style={styles.addSetText}>ADD SET</Text>
            </Pressable>

            {/* Rest between sets */}
            <View style={styles.controlsRow}>
              <Stepper
                label="REST"
                value={`${item.rest_seconds}s`}
                onMinus={() => bumpRest(item, -15)}
                onPlus={() => bumpRest(item, 15)}
              />
            </View>
          </View>
        )}
        ListFooterComponent={
          <Pressable style={styles.addBtn} onPress={() => setPickerOpen(true)}>
            <Plus size={15} color={Void.accent} />
            <Text style={styles.addBtnText}>ADD EXERCISE</Text>
          </Pressable>
        }
      />

      <View style={styles.footer}>
        <Pressable
          style={styles.startBtn}
          onPress={() => {
            // A live session must not be silently replaced - jump to it instead.
            if (live) {
              router.push('/workout/active');
              return;
            }
            // Shared routines and tabbed routines go through the lobby so
            // everyone picks a tab and starts together.
            if (me && (routine?.is_shared === 1 || tabs.length > 0)) {
              router.push(`/workout/lobby/${id}`);
              return;
            }
            void startWorkout({ routineId: id, title: routine?.title }).then(() =>
              router.push('/workout/active')
            );
          }}>
          <Play size={16} color={Void.accentText} fill={Void.accentText} />
          <Text style={styles.startText}>START ROUTINE</Text>
        </Pressable>
      </View>

      {routine && (
        <CollabSheet
          visible={collabOpen}
          onClose={() => setCollabOpen(false)}
          routine={routine}
          onLeft={() => router.back()}
        />
      )}

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(ex) =>
          // rows.length collides after mid-list deletions - append after the max.
          void addRoutineExercise({
            routine_id: targetRoutineId!,
            exercise_id: ex.id,
            order_index: rows.reduce((m, r) => Math.max(m, r.order_index), -1) + 1,
          }).then(refresh)
        }
      />
    </Screen>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable onPress={onMinus} hitSlop={4} style={styles.stepBtn}>
          <Minus size={12} color={Void.textSecondary} />
        </Pressable>
        <Text style={styles.stepVal}>{value}</Text>
        <Pressable onPress={onPlus} hitSlop={4} style={styles.stepBtn}>
          <Plus size={12} color={Void.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  collabLock: {
    position: 'absolute',
    top: -5,
    right: -7,
    backgroundColor: Void.surfaceRaised,
    borderRadius: 6,
    padding: 2,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  title: { color: Void.text, fontSize: 24, fontWeight: '800', paddingHorizontal: 16, marginTop: 4, marginBottom: 8 },
  sharedTag: { color: Void.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  tabStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: Void.surface,
  },
  tabChipSel: { borderColor: Void.accent, backgroundColor: Void.accent + '1A' },
  tabChipText: { color: Void.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  tabChipTextSel: { color: Void.accent },
  tabEditChip: { paddingVertical: 4 },
  tabInput: {
    color: Void.text,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 60,
    paddingVertical: 2,
  },
  row: {
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    padding: 12,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  setBadge: { width: 30, flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  setLetter: { fontSize: 10, fontWeight: '800' },
  setNum: { color: Void.textTertiary, fontSize: 12, ...tabular },
  setValueZone: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  setInput: {
    color: Void.text,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    minWidth: 36,
    paddingVertical: 2,
    ...tabular,
  },
  setUnit: { color: Void.textTertiary, fontSize: 11, fontWeight: '400' },
  setTimes: { color: Void.textTertiary, fontSize: 14 },
  setRemove: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    marginTop: 4,
  },
  addSetText: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  rowName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  order: { color: Void.textTertiary, fontSize: 11, width: 14, textAlign: 'right', ...tabular },
  stepper: { alignItems: 'center' },
  stepperLabel: { color: Void.textTertiary, fontSize: 8, letterSpacing: 1, marginBottom: 2 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepVal: { color: Void.text, fontSize: 12, fontWeight: '700', minWidth: 30, textAlign: 'center', ...tabular },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Void.border,
    borderStyle: 'dashed',
    borderRadius: 10,
  },
  addBtnText: { color: Void.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: Void.canvas,
    borderTopWidth: 1,
    borderTopColor: Void.border,
  },
  startBtn: {
    backgroundColor: Void.accent,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  startText: { color: Void.accentText, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
});
