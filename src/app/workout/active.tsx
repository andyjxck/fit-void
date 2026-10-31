import { useRouter } from 'expo-router';
import { ChevronDown, ChevronRight, Flame, HeartPulse, Link2, Plus, SkipForward, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardChrome, CardSheen } from '@/components/ui';
import { NotifyHost } from '@/components/ui/Notify';
import { ExercisePicker } from '@/components/workout/ExercisePicker';
import { NumPad } from '@/components/workout/NumPad';
import { PlateVisualizer } from '@/components/workout/PlateVisualizer';
import { RestPill } from '@/components/workout/RestPill';
import { SetRow, type ExtraField, type SetField } from '@/components/workout/SetRow';
import { WorkoutSummary } from '@/components/workout/WorkoutSummary';
import { getExercise } from '@/db/repo/exercises';
import { getRoutine, getRoutineExercises, listRoutineTabs } from '@/db/repo/routines';
import { setWorkoutFeel } from '@/db/repo/workouts';
import { ACTIVITIES, ACTIVITY_EXTRAS, ACTIVITY_META, hkActivityToCardio } from '@/lib/cardio';
import { clockDigitsToSeconds, displayWeight, formatDuration, parseWeight, secondsToClockDigits } from '@/lib/format';
import { subscribeSession, type SessionSet } from '@/lib/routineSession';
import type { Exercise, Routine } from '@/lib/types';
import {
    effectiveWeight,
    useActiveWorkout,
    type ExerciseBlock,
    type FinalizeSummary,
} from '@/store/activeWorkout';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

interface FocusedCell {
  blockKey: string;
  setId: string;
  field: SetField;
  metaKey?: string;
}

const FIELD_LABEL: Record<SetField, (unit: string, addedWeight?: boolean) => string> = {
  weight: (unit, addedWeight) => (addedWeight ? `+${unit.toUpperCase()}` : unit.toUpperCase()),
  reps: () => 'REPS',
  duration: () => 'MM:SS',
  distance: () => 'METRES',
  hr: () => 'BPM',
  rpe: () => 'RPE',
  meta: () => 'VALUE',
};

/** Optional per-set inputs shown under each row's expand chevron. */
function extrasFor(block: ExerciseBlock): ExtraField[] {
  if (block.trackingType === 'cardio') {
    return ACTIVITY_EXTRAS[hkActivityToCardio(block.name)].map((e) => ({
      field: 'meta' as const,
      metaKey: e.key,
      label: e.label,
      unit: e.unit,
    }));
  }
  if (block.trackingType === 'hold') {
    return [{ field: 'hr', label: 'HR', unit: 'bpm' }];
  }
  // strength + carry: RPE is the classic optional per-set input.
  return [{ field: 'rpe', label: 'RPE', unit: '' }];
}

/** A, B, C… labels for superset groups by first appearance. */
function supersetLabels(blocks: ExerciseBlock[]): Map<string, string> {
  const letters = 'ABCDEFGH';
  const map = new Map<string, string>();
  let next = 0;
  for (const b of blocks) {
    if (b.supersetId && !map.has(b.supersetId)) map.set(b.supersetId, letters[next++ % letters.length]);
  }
  return map;
}

const completedCount = (b: ExerciseBlock) => b.sets.filter((s) => s.isCompleted).length;
const nextIncomplete = (b: ExerciseBlock) => b.sets.find((s) => !s.isCompleted);

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const store = useActiveWorkout();
  const { weight_unit, default_bar_weight } = useSettings();
  const listRef = useRef<FlatList<ExerciseBlock>>(null);

  const [elapsed, setElapsed] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<FocusedCell | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardioAsk, setCardioAsk] = useState(false);
  const [summary, setSummary] = useState<FinalizeSummary | null>(null);
  const summaryPending = useRef(false);
  const leaving = useRef(false);
  const draftRef = useRef('');
  /** True right after a cell gains focus - the prefilled draft behaves like
   *  selected text, so the first keypress replaces instead of appending. */
  const freshDraft = useRef(false);
  const [, bumpDraft] = useState(0);

  // Collab session: tabs of the parent routine + which tab I'm viewing.
  const [tabs, setTabs] = useState<Routine[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<string | null>(null);
  // exercise-name cache for partner tabs (id -> name), filled lazily.
  const [tabExercises, setTabExercises] = useState<Record<string, { id: string; name: string }[]>>({});

  const blocks = store.blocks;
  const current = blocks[Math.min(currentIdx, blocks.length - 1)];

  // Elapsed + rest countdown ticker
  useEffect(() => {
    if (!store.startedAt) return;
    const id = setInterval(() => {
      const now = Date.now();
      setElapsed(Math.floor((now - store.startedAt!) / 1000));
      setNowMs(now);
    }, 250);
    return () => clearInterval(id);
  }, [store.startedAt]);

  // Session plumbing: subscribe once for partner feed; resolve the parent's
  // tab list so the strip can switch between routines.
  useEffect(() => {
    if (!store.sessionId || !store.routineId) return;
    let unsub: (() => void) | undefined;
    let dead = false;
    void (async () => {
      const r = await getRoutine(store.routineId!);
      if (dead) return;
      const pid = r?.parent_routine_id ?? store.routineId!;
      setParentId(pid);
      setTabs(await listRoutineTabs(pid));
      setViewTab(store.routineId);
      unsub = await subscribeSession(store.sessionId!, (f) =>
        useActiveWorkout.getState().applySessionFeed(f.members, f.sets, f.me)
      );
    })();
    return () => {
      dead = true;
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sessionId, store.routineId]);

  // Lazily resolve exercise names for whichever tab I'm peeking at.
  useEffect(() => {
    if (!viewTab || tabExercises[viewTab]) return;
    void (async () => {
      const res = await getRoutineExercises(viewTab);
      const named = await Promise.all(
        res.map(async (re) => ({
          id: re.exercise_id,
          name: (await getExercise(re.exercise_id))?.name ?? 'Exercise',
        }))
      );
      setTabExercises((m) => ({ ...m, [viewTab]: named }));
    })();
  }, [viewTab, tabExercises]);

  // Leave the modal when there is no live workout - but not while a finish
  // summary is pending or shown, and not while a discard path navigates
  // itself (its confirm dialog is still dismissing - a back() fired then is
  // swallowed by the modal race and never retried).
  useEffect(() => {
    if (
      store.hydrated &&
      !store.workoutId &&
      !summary &&
      !summaryPending.current &&
      !leaving.current
    )
      router.back();
  }, [store.hydrated, store.workoutId, summary, router]);

  // Auto-advance the pointer when the current block is finished.
  useEffect(() => {
    if (!current || nextIncomplete(current)) return;
    const next = blocks.findIndex((b, i) => i > currentIdx && nextIncomplete(b));
    if (next >= 0) setCurrentIdx(next);
  }, [blocks, current, currentIdx]);

  const scrollTo = useCallback((idx: number) => {
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.08, animated: true });
  }, []);

  const onNextExercise = useCallback(() => {
    if (blocks.length === 0) return;
    const next = Math.min(currentIdx + 1, blocks.length - 1);
    setCurrentIdx(next);
    scrollTo(next);
  }, [blocks.length, currentIdx, scrollTo]);

  const focusCell = useCallback((blockKey: string, setId: string, field: SetField, metaKey?: string) => {
    const block = useActiveWorkout.getState().blocks.find((b) => b.key === blockKey);
    const s = block?.sets.find((x) => x.id === setId);
    if (!s) return;
    setFocused({ blockKey, setId, field, metaKey });
    const unit = useSettings.getState().weight_unit;
    if (field === 'weight') {
      const kg = effectiveWeight(s);
      draftRef.current = kg == null ? '' : unit === 'lbs' ? String(Math.round(kg * 2.2046226 * 100) / 100) : String(Math.round(kg * 100) / 100);
    } else if (field === 'reps') {
      draftRef.current = s.reps != null ? String(s.reps) : s.ghostReps != null ? String(s.ghostReps) : '';
    } else if (field === 'duration') {
      // Draft is clock digits ("215" = 2:15), not raw seconds.
      draftRef.current = s.durationSeconds != null ? secondsToClockDigits(s.durationSeconds) : '';
    } else if (field === 'distance') {
      draftRef.current = s.distanceM != null ? String(Math.round(s.distanceM)) : '';
    } else if (field === 'hr') {
      draftRef.current = s.avgHr != null ? String(s.avgHr) : '';
    } else if (field === 'rpe') {
      draftRef.current = s.rpe != null ? String(s.rpe) : '';
    } else {
      const v = metaKey ? s.meta?.[metaKey] : undefined;
      draftRef.current = v != null ? String(v) : '';
    }
    freshDraft.current = true;
    bumpDraft((n) => n + 1);
  }, []);

  const commitDraft = useCallback(
    (value: string) => {
      if (!focused) return;
      if (focused.field === 'weight') {
        store.updateSet(focused.blockKey, focused.setId, { weightKg: parseWeight(value, weight_unit) });
      } else if (focused.field === 'reps') {
        const n = parseInt(value, 10);
        store.updateSet(focused.blockKey, focused.setId, {
          reps: Number.isFinite(n) && n >= 0 ? n : null,
        });
      } else if (focused.field === 'duration') {
        store.updateSet(focused.blockKey, focused.setId, {
          durationSeconds: clockDigitsToSeconds(value),
        });
      } else if (focused.field === 'distance') {
        const n = parseFloat(value);
        store.updateSet(focused.blockKey, focused.setId, {
          distanceM: Number.isFinite(n) && n >= 0 ? n : null,
        });
      } else if (focused.field === 'hr') {
        const n = parseInt(value, 10);
        store.updateSet(focused.blockKey, focused.setId, {
          avgHr: Number.isFinite(n) && n >= 0 ? n : null,
        });
      } else if (focused.field === 'rpe') {
        const n = parseFloat(value);
        store.updateSet(focused.blockKey, focused.setId, {
          rpe: Number.isFinite(n) && n >= 0 ? n : null,
        });
      } else if (focused.field === 'meta' && focused.metaKey) {
        const n = parseFloat(value);
        const s = useActiveWorkout
          .getState()
          .blocks.find((b) => b.key === focused.blockKey)
          ?.sets.find((x) => x.id === focused.setId);
        const meta = { ...(s?.meta ?? {}) };
        const key = focused.metaKey;
        if (Number.isFinite(n) && n >= 0) meta[key] = n;
        else delete meta[key];
        store.updateSet(focused.blockKey, focused.setId, {
          meta: Object.keys(meta).length ? meta : undefined,
        });
      }
    },
    [focused, store, weight_unit]
  );

  /** First field worth typing on a set: kg when empty, else reps (duration
   *  for timed tracking; carry's second zone is distance-or-duration). */
  const firstField = (block: ExerciseBlock, s: { weightKg: number | null; distanceM: number | null }): SetField => {
    if (block.trackingType === 'strength') return s.weightKg == null ? 'weight' : 'reps';
    if (block.trackingType === 'carry')
      return s.weightKg == null ? 'weight' : s.distanceM != null ? 'distance' : 'duration';
    return 'duration';
  };

  /** After a tick, move the numpad target to the next set's relevant field
   *  so typing never lands back on the completed row. Falls through to the
   *  next exercise's first incomplete set; closes the pad when done. */
  const advanceFocus = useCallback(
    (blockKey: string) => {
      const st = useActiveWorkout.getState();
      const idx = st.blocks.findIndex((b) => b.key === blockKey);
      if (idx < 0) {
        setFocused(null);
        return;
      }
      const here = st.blocks[idx].sets.find((s) => !s.isCompleted);
      if (here) {
        focusCell(blockKey, here.id, firstField(st.blocks[idx], here));
        return;
      }
      const nb = st.blocks.slice(idx + 1).find((b) => b.sets.some((s) => !s.isCompleted));
      const ns = nb?.sets.find((s) => !s.isCompleted);
      if (nb && ns) {
        focusCell(nb.key, ns.id, firstField(nb, ns));
        return;
      }
      setFocused(null);
    },
    [focusCell]
  );

  /** Primary action: while working it says REST (complete + rest); while
   *  resting it says NEXT SET (skip the timer and go). */
  const onPrimary = useCallback(() => {
    if (store.rest) {
      store.skipRest();
      return;
    }
    if (!current) return;
    const s = nextIncomplete(current);
    if (s) {
      store.completeSet(current.key, s.id); // commits ghost values, starts rest
      advanceFocus(current.key);
      return;
    }
    // Current block done - jump to next incomplete block.
    const next = blocks.findIndex((b, i) => i > currentIdx && nextIncomplete(b));
    if (next >= 0) {
      setCurrentIdx(next);
      scrollTo(next);
    }
  }, [current, blocks, currentIdx, store, scrollTo, advanceFocus]);

  const onPadKey = useCallback(
    (key: string) => {
      if (!focused) return;
      if (key === 'done') {
        setFocused(null);
        return;
      }
      const fresh = freshDraft.current;
      freshDraft.current = false;
      let next = draftRef.current;
      if (key === 'back' || key === 'clear') {
        // Select-all + delete clears; mid-edit backspace trims one char.
        next = fresh || key === 'clear' ? '' : next.slice(0, -1);
      } else if (key === '.' && (fresh ? false : next.includes('.'))) {
        return;
      } else {
        // First keypress replaces the selected draft like typing over a
        // highlighted value - "10" + tap "1" = 1, not 101.
        next = fresh ? (key === '.' ? '0.' : key) : next + key;
      }
      draftRef.current = next;
      commitDraft(next);
    },
    [focused, commitDraft]
  );

  const onFinish = useCallback(() => {
    summaryPending.current = true;
    store
      .finalize()
      .then(async (s) => {
        if (s) {
          setSummary(s);
        } else {
          // Nothing logged - confirm before binning the session.
          const ok = await confirm({
            title: 'Finish workout?',
            body: 'No sets were logged. Discard this session?',
            confirmText: 'DISCARD',
            cancelText: 'KEEP TRAINING',
            destructive: true,
          });
          if (ok) {
            leaving.current = true;
            await store.discard();
            // The confirm Sheet is an RN Modal still mid-dismiss - back()
            // fired now would be swallowed. Wait out the fade.
            await new Promise((r) => setTimeout(r, 350));
            leaving.current = false;
            router.back();
          }
        }
      })
      .catch((e) => {
        notify('Could not save workout', { body: e instanceof Error ? e.message : String(e), tone: 'error' });
      })
      .finally(() => {
        summaryPending.current = false;
      });
  }, [store, router]);

  const onDiscard = useCallback(() => {
    void (async () => {
      const ok = await confirm({
        title: 'Discard workout?',
        body: 'All sets logged this session will be deleted.',
        confirmText: 'DISCARD',
        destructive: true,
      });
      if (ok) {
        leaving.current = true;
        await store.discard();
        // Same modal-dismiss race as the finish path - wait before backing out.
        await new Promise((r) => setTimeout(r, 350));
        leaving.current = false;
        router.back();
      }
    })();
  }, [store, router]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const labels = supersetLabels(blocks);
  const focusedBlock = focused ? blocks.find((b) => b.key === focused.blockKey) : null;
  const focusedSet = focusedBlock?.sets.find((s) => s.id === focused?.setId);

  // Collab: strip shows MAIN + tabs; my workout tab is store.routineId.
  const inSession = store.sessionId != null;
  const myTab = store.routineId;
  const tabChoices: { id: string; title: string; mine: boolean }[] = inSession && parentId
    ? [
        { id: parentId, title: 'MAIN', mine: myTab === parentId },
        ...tabs.map((t) => ({ id: t.id, title: t.title, mine: myTab === t.id })),
      ]
    : [];
  const viewingMine = !inSession || viewTab === myTab;

  /** Partner progress on one exercise: name + done-count + last set. */
  const partnerSummary = (exerciseId: string) => {
    const sets = store.partnerSets[exerciseId] ?? [];
    const byUser = new Map<string, SessionSet[]>();
    for (const s of sets) {
      const arr = byUser.get(s.user_id) ?? [];
      arr.push(s);
      byUser.set(s.user_id, arr);
    }
    return [...byUser.entries()].map(([uid, arr]) => {
      const doneSets = arr.filter((s) => s.done).sort((a, b) => a.set_order - b.set_order);
      const last = doneSets[doneSets.length - 1];
      return {
        uid,
        name: (store.partnerNames[uid] ?? 'Partner').toUpperCase(),
        done: doneSets.length,
        total: arr.length,
        last: last
          ? last.weight_kg != null
            ? `${displayWeight(last.weight_kg, weight_unit)}${weight_unit}×${last.reps ?? '-'}`
            : `${last.reps ?? '-'} reps`
          : null,
      };
    });
  };

  /** Who's working on a given tab (member.tab_routine_id null = MAIN). */
  const whoOnTab = (tabId: string) =>
    Object.entries(store.partnerTabs)
      .filter(([, t]) => (t ?? parentId) === tabId)
      .map(([uid]) => (store.partnerNames[uid] ?? 'Partner').toUpperCase());

  const renderBlock = ({ item: block, index }: { item: ExerciseBlock; index: number }) => {
    const isCurrent = index === currentIdx;
    const isOpen = isCurrent || expanded.has(block.key);
    const letter = block.supersetId ? labels.get(block.supersetId) : null;
    const compound = block.equipment === 'barbell' || block.equipment === 'dumbbell';
    // Flame only shows when a working weight is known - otherwise the ramp
    // has nothing to ramp toward and the button would be a dead control.
    const working = block.sets.find((s) => s.setType === 'normal' && !s.isCompleted)
      ?? block.sets.find((s) => s.setType === 'normal');
    const canWarmup = compound && working != null && effectiveWeight(working) != null;
    const done = completedCount(block);
    const lastDone = [...block.sets].reverse().find((s) => s.isCompleted);
    const summaryLine = lastDone
      ? lastDone.weightKg != null
        ? `last ${displayWeight(lastDone.weightKg, weight_unit)}${weight_unit} × ${lastDone.reps ?? '-'}`
        : `last set × ${lastDone.reps ?? '-'}`
      : 'up next';

    return (
      <Pressable
        onPress={() => !isOpen && toggleExpand(block.key)}
        style={[
          styles.card,
          isCurrent && styles.cardCurrent,
          block.supersetId != null && styles.cardSuperset,
        ]}>
        <CardSheen radius={16} />
        {/* Card header - always visible, notification-style */}
        <View style={styles.cardHeader}>
          {letter && (
            <View style={styles.supersetChip}>
              <Text style={styles.supersetLetter}>{letter}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.cardName}>{block.name}</Text>
              {isCurrent && <Text style={styles.nowTag}>NOW</Text>}
            </View>
            <Text style={styles.cardMeta}>
              {done}/{block.sets.length} sets · {summaryLine}
            </Text>
          </View>
          {isOpen ? (
            <View style={styles.cardActions}>
              {canWarmup && (
                <Pressable
                  style={[styles.iconBtn, styles.warmupBtn]}
                  onPress={() => store.insertWarmups(block.key)}
                  hitSlop={6}>
                  <Flame size={13} color={Void.warmup} />
                </Pressable>
              )}
              <Pressable
                style={[styles.iconBtn, block.supersetId != null && styles.iconBtnActive]}
                onPress={() => store.toggleSuperset(block.key)}
                hitSlop={6}>
                <Link2 size={13} color={block.supersetId ? Void.accent : Void.textSecondary} />
              </Pressable>
              <Pressable
                style={styles.iconBtn}
                onPress={() =>
                  void (async () => {
                    const ok = await confirm({
                      title: 'Remove exercise?',
                      body: block.name,
                      confirmText: 'REMOVE',
                      destructive: true,
                    });
                    if (ok) store.removeBlock(block.key);
                  })()
                }
                hitSlop={6}>
                <Trash2 size={13} color={Void.textSecondary} />
              </Pressable>
              <Pressable onPress={() => isCurrent ? null : toggleExpand(block.key)} hitSlop={6}>
                <ChevronRight size={16} color={Void.textTertiary} style={{ transform: [{ rotate: '90deg' }] }} />
              </Pressable>
            </View>
          ) : (
            <ChevronRight size={16} color={Void.textTertiary} />
          )}
        </View>

        {/* Expanded: remaining set queue */}
        {isOpen && (
          <View>
            {block.sets.map((s, i) => (
              <View key={s.id}>
                <SetRow
                  set={s}
                  index={i}
                  unit={weight_unit}
                  trackingType={block.trackingType}
                  addedWeight={block.equipment === 'bodyweight'}
                  extras={extrasFor(block)}
                  active={isCurrent && nextIncomplete(block)?.id === s.id}
                  focusedField={focused?.setId === s.id ? focused.field : null}
                  focusedMetaKey={focused?.setId === s.id ? focused.metaKey : undefined}
                  onFocusField={(f, mk) => focusCell(block.key, s.id, f, mk)}
                  onComplete={() => {
                    store.completeSet(block.key, s.id);
                    advanceFocus(block.key);
                  }}
                  onUncomplete={() => store.uncompleteSet(block.key, s.id)}
                  onDelete={() => store.deleteSet(block.key, s.id)}
                  canDelete={block.sets.length > 1}
                  onCycleType={(t) => store.updateSet(block.key, s.id, { setType: t })}
                />
                {focused?.setId === s.id && focused.field === 'weight' && block.equipment === 'barbell' && (
                  <PlateVisualizer
                    weightKg={s.weightKg ?? s.ghostWeightKg}
                    barWeight={default_bar_weight}
                    unit={weight_unit}
                  />
                )}
              </View>
            ))}
            <Pressable style={styles.addSet} onPress={() => store.addSet(block.key)}>
              <Plus size={13} color={Void.textSecondary} />
              <Text style={styles.addSetText}>ADD SET</Text>
            </Pressable>
          </View>
        )}

        {/* Partners sharing this exercise (same tab or any) - live rows. */}
        {partnerSummary(block.exerciseId).map((p) => (
          <View key={p.uid} style={styles.partnerRow}>
            <Text style={styles.partnerName}>{p.name}</Text>
            <Text style={styles.partnerMeta}>
              {p.done}/{p.total} sets{p.last ? ` · last ${p.last}` : ''}
            </Text>
          </View>
        ))}
      </Pressable>
    );
  };

  /** Read-only view of another tab: its exercises + everyone's live sets. */
  const renderPartnerTab = () => {
    const exs = viewTab ? (tabExercises[viewTab] ?? []) : [];
    return (
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {exs.length === 0 && <Text style={styles.partnerEmpty}>No exercises on this tab</Text>}
        {exs.map((ex) => {
          const partners = partnerSummary(ex.id);
          return (
            <View key={ex.id} style={styles.card}>
              <CardSheen radius={16} />
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{ex.name}</Text>
              </View>
              {partners.length === 0 ? (
                <Text style={styles.partnerEmpty}>Nobody has logged this yet</Text>
              ) : (
                partners.map((p) => (
                  <View key={p.uid} style={styles.partnerRow}>
                    <Text style={styles.partnerName}>{p.name}</Text>
                    <Text style={styles.partnerMeta}>
                      {p.done}/{p.total} sets{p.last ? ` · last ${p.last}` : ''}
                    </Text>
                  </View>
                ))
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  if (!store.workoutId && !summary) return <View style={styles.container} />;

  // Finish summary renders inline, NOT as an RN <Modal>: dismissing a modal
  // VC in the same frame as router.back() gets the navigation swallowed and
  // leaves a black screen. Inline unmount has no such race.
  if (summary) {
    return (
      <View style={styles.container}>
        <WorkoutSummary
          summary={summary}
          onClose={() => {
            setSummary(null);
            router.back();
          }}
          onRate={(n) => void setWorkoutFeel(summary.workoutId, n)}
        />
        <NotifyHost />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header - chevron minimizes (workout keeps running, resume from the
          Train tab); trash discards with a confirm; heart logs cardio into
          the workout (lands on the Cardio tab at finish). */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ChevronDown color={Void.textSecondary} size={24} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {store.title}
        </Text>
        <Pressable onPress={onDiscard} hitSlop={8} style={styles.discardBtn}>
          <Trash2 color={Void.textSecondary} size={17} />
        </Pressable>
        <Pressable style={styles.finishBtn} onPress={onFinish}>
          <Text style={styles.finishText}>FINISH</Text>
        </Pressable>
      </View>

      {/* Big timer + queue controls */}
      <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
      <View style={styles.controls}>
        <Pressable
          style={[styles.primaryBtn, store.rest && styles.primaryBtnResting]}
          onPress={onPrimary}>
          <Text style={[styles.primaryText, store.rest && { color: Void.accent }]}>
            {store.rest
              ? `NEXT SET · ${formatDuration(Math.max(0, Math.ceil((store.rest.endsAt - nowMs) / 1000)))}`
              : 'REST'}
          </Text>
        </Pressable>
        <Pressable style={styles.nextExBtn} onPress={onNextExercise}>
          <SkipForward size={15} color={Void.text} />
          <Text style={styles.nextExText}>NEXT EXERCISE</Text>
        </Pressable>
      </View>

      {/* Collab tab strip: view any tab; only mine is editable. Chips show
          who's on each tab. */}
      {tabChoices.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sessionTabRow}>
          {tabChoices.map((t) => {
            const sel = viewTab === t.id;
            const who = whoOnTab(t.id).join(' · ');
            return (
              <Pressable
                key={t.id}
                style={[styles.sessionTab, sel && styles.sessionTabSel]}
                onPress={() => setViewTab(t.id)}>
                <Text style={[styles.sessionTabText, sel && styles.sessionTabTextSel]}>
                  {t.title.toUpperCase()}
                  {t.mine ? ' · YOU' : ''}
                </Text>
                {who ? <Text style={styles.sessionTabWho}>{who}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {!viewingMine ? (
        renderPartnerTab()
      ) : (
      <FlatList
        ref={listRef}
        data={blocks}
        keyExtractor={(b) => b.key}
        renderItem={renderBlock}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={({ index }) =>
          setTimeout(() => scrollTo(index), 200)
        }
        ListFooterComponent={
          <View>
            <View style={styles.addRow}>
              <Pressable style={styles.addExercise} onPress={() => setPickerOpen(true)}>
                <Plus size={16} color={Void.accent} />
                <Text style={styles.addExerciseText}>ADD EXERCISE</Text>
              </Pressable>
              <Pressable
                style={styles.addExercise}
                onPress={() => setCardioAsk((v) => !v)}>
                <HeartPulse size={16} color={Void.accent} />
                <Text style={styles.addExerciseText}>ADD CARDIO</Text>
              </Pressable>
            </View>
            {cardioAsk && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.cardioChips}>
                {ACTIVITIES.map((a) => (
                  <Pressable
                    key={a}
                    style={styles.cardioChip}
                    onPress={() => {
                      setCardioAsk(false);
                      void store.addCardioExercise(a).then(() =>
                        listRef.current?.scrollToEnd({ animated: true })
                      );
                    }}>
                    <Text style={styles.cardioChipText}>{ACTIVITY_META[a].label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        }
      />
      )}

      {store.rest && (
        <RestPill
          rest={store.rest}
          numpadOpen={focused != null}
          onAdjust={store.adjustRest}
          onSkip={store.skipRest}
        />
      )}

      <NumPad
        visible={focused != null}
        fieldLabel={
          focusedSet && focusedBlock && focused
            ? `${focusedBlock.name.toUpperCase()} · ${
                focused.field === 'meta'
                  ? extrasFor(focusedBlock).find((e) => e.metaKey === focused.metaKey)?.label ?? 'VALUE'
                  : FIELD_LABEL[focused.field](weight_unit, focusedBlock.equipment === 'bodyweight')
              }`
            : undefined
        }
        onKey={onPadKey}
      />

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(ex: Exercise) => void store.addExercise(ex.id)}
      />

      {/* Banners + confirms must render inside this fullScreenModal screen -
          the root NotifyHost sits beneath the presented view controller. */}
      <NotifyHost />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Void.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 12,
  },
  title: { color: Void.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.5, flex: 1, textAlign: 'center' },
  discardBtn: { padding: 6 },
  finishBtn: {
    backgroundColor: Void.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  finishText: { color: Void.accentText, fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },

  timer: {
    color: Void.accent,
    fontSize: 56,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
    ...tabular,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 14,
  },
  primaryBtn: {
    flex: 1.4,
    backgroundColor: Void.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnResting: { backgroundColor: Void.surfacePressed, borderWidth: 1, borderColor: Void.accent },
  primaryText: { color: Void.accentText, fontWeight: '900', fontSize: 15, letterSpacing: 1, ...tabular },
  nextExBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextExText: { color: Void.text, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },

  list: { padding: 12, paddingBottom: 240, gap: 10 },

  // iOS-notification-style exercise cards
  card: {
    ...cardChrome,
    borderRadius: 16,
    padding: 12,
  },
  cardCurrent: { borderColor: Void.borderStrong, backgroundColor: Void.surfaceRaised },
  cardSuperset: { borderColor: Void.accent },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { color: Void.text, fontSize: 16, fontWeight: '700' },
  nowTag: {
    color: Void.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    borderWidth: 1,
    borderColor: Void.accent,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  cardMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 3, ...tabular },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  supersetChip: {
    borderWidth: 1,
    borderColor: Void.accent,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  supersetLetter: { color: Void.accent, fontSize: 10, fontWeight: '800' },
  iconBtn: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { borderColor: Void.accent },
  warmupBtn: { borderColor: Void.warmup },
  colHeader: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, marginTop: 10, marginBottom: 4 },
  colLabel: { color: Void.textTertiary, fontSize: 10, letterSpacing: 1, textAlign: 'center' },
  addSet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Void.border,
  },
  addSetText: { color: Void.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  addRow: { flexDirection: 'row', gap: 10 },
  addExercise: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Void.border,
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  addExerciseText: { color: Void.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  cardioChips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  cardioChip: {
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  cardioChipText: { color: Void.text, fontSize: 13, fontWeight: '700' },

  // Collab session UI
  sessionTabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  sessionTab: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: Void.surface,
    alignItems: 'center',
  },
  sessionTabSel: { borderColor: Void.accent, backgroundColor: Void.accent + '1A' },
  sessionTabText: { color: Void.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sessionTabTextSel: { color: Void.accent },
  sessionTabWho: { color: Void.textTertiary, fontSize: 8, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Void.border,
  },
  partnerName: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  partnerMeta: { color: Void.textSecondary, fontSize: 11, ...tabular },
  partnerEmpty: { color: Void.textTertiary, fontSize: 12, paddingVertical: 10 },
});
