import { useFocusEffect, useRouter } from 'expo-router';
import { AlertTriangle, Archive, Check, CloudOff, HeartPulse, Pencil, Plus } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    type LayoutChangeEvent
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    FadeIn,
    FadeOut,
    LinearTransition,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    type SharedValue
} from 'react-native-reanimated';

import { IntentSwitcher } from '@/components/IntentSwitcher';
import { Screen, ScreenHeader } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import {
    ExerciseQuickAddWidget,
    FriendsSnapshotWidget,
    LastWorkoutWidget,
    PlateCalculatorWidget,
    QuickCardioWidget,
    RestTimerWidget,
    TextGoalWidget
} from '@/components/widgets/ActionWidgets';
import {
    BodyWeightWidget,
    CardioWeeklyWidget,
    HardSetsWidget,
    HydrationWidget,
    LastPrWidget,
    ReadinessWidget,
    RecentPrsWidget,
    RestingHrWidget,
    SleepWidget,
    StreakWidget,
    StrengthScoreWidget,
    TodayCaloriesWidget,
    TodayProteinWidget,
    TopLiftsWidget,
    WeekVolumeWidget
} from '@/components/widgets/MetricWidgets';
import {
    FolderWidget,
    RoutineWidget,
    WeeklyConsistencyWidget,
} from '@/components/widgets/TrainWidgets';
import { WidgetWrapper } from '@/components/widgets/WidgetWrapper';
import {
    createFolder,
    createRoutine,
    getFolderAssignments,
    listFolders,
    listRoutinesWithPreview,
    toggleRoutineFolder,
    type RoutineWithPreview,
} from '@/db/repo/routines';
import { ensureAllFocusDefault, updateWidgetConfig } from '@/db/repo/widgets';
import { useVoidPro } from '@/lib/entitlements';
import { ALL_HIDE_KEY, checkUnlocks, isFocusHidden, isWidgetVisible, parseIntents, UNLOCK_RULES, type Intent } from '@/lib/intents';
import { openRoutineWorkout } from '@/lib/startRoutine';
import {
    allowedOrPrompt,
    countMyFolders,
    countMyRoutines,
    showUpgradePrompt
} from '@/lib/tiers';
import { WIDGET_LABELS, WIDGET_SIZES, type WidgetSize, type WidgetType } from '@/lib/widgetTypes';
import { useActiveWorkout } from '@/store/activeWorkout';
import { useFolderStore } from '@/store/folders';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { useWidgetStore } from '@/store/widgets';
import { Void } from '@/theme/tokens';

const WIDGET_COMPONENTS: Record<WidgetType, React.ComponentType<{ size: WidgetSize; config: Record<string, unknown>; id?: string; activeIntents?: Intent[]; onLongPress?: (routineId: string) => void }>> = {
  weekly_consistency: WeeklyConsistencyWidget as any,
  routine: RoutineWidget,
  example_routine: RoutineWidget,
  folder: FolderWidget,
  readiness: ReadinessWidget as any,
  streak: StreakWidget as any,
  strength_score: StrengthScoreWidget as any,
  today_calories: TodayCaloriesWidget as any,
  today_protein: TodayProteinWidget as any,
  hydration: HydrationWidget as any,
  body_weight: BodyWeightWidget as any,
  resting_hr: RestingHrWidget as any,
  sleep: SleepWidget as any,
  week_volume: WeekVolumeWidget as any,
  last_pr: LastPrWidget as any,
  recent_prs: RecentPrsWidget as any,
  hard_sets: HardSetsWidget as any,
  top_lifts: TopLiftsWidget as any,
  cardio_weekly: CardioWeeklyWidget as any,
  last_workout: LastWorkoutWidget as any,
  plate_calculator: PlateCalculatorWidget as any,
  rest_timer: RestTimerWidget as any,
  quick_cardio: QuickCardioWidget as any,
  exercise_quick_add: ExerciseQuickAddWidget as any,
  text_goal: TextGoalWidget as any,
  friends_snapshot: FriendsSnapshotWidget as any,
};

interface WidgetFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Long-press drag wrapper for edit mode. The grid is a mixed-width wrap
 * layout, so drag is a plain Pan + measured frames rather than a FlatList:
 * the dragged widget translates under the finger, the parent computes the
 * insertion slot from the other widgets' frames, and non-dragged widgets
 * reflow via LinearTransition.
 */
function DraggableWidget({
  id,
  enabled,
  locked,
  isDragging,
  activeId,
  tx,
  ty,
  onStart,
  onMove,
  onEnd,
  onLocked,
  onFrame,
  style,
  children,
}: {
  id: string;
  /** Edit mode + this widget type allows moves. */
  enabled: boolean;
  /** Free tier - long-press surfaces the upsell instead of dragging. */
  locked: boolean;
  /** True while THIS widget is the one being dragged (kills layout anim). */
  isDragging: boolean;
  activeId: SharedValue<string>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  onStart: (id: string) => void;
  onMove: (id: string, absX: number, absY: number) => void;
  onEnd: () => void;
  onLocked: () => void;
  onFrame: (id: string, frame: WidgetFrame) => void;
  style: object[];
  children: React.ReactNode;
}) {
  const dragStyle = useAnimatedStyle(() => {
    const on = activeId.value === id;
    return {
      zIndex: on ? 60 : 0,
      opacity: on ? 0.96 : 1,
      transform: [
        { translateX: on ? tx.value : 0 },
        { translateY: on ? ty.value : 0 },
        { scale: on ? 1.03 : 1 },
      ],
    };
  });

  // Pan translation counts from touch-down, but the translate only applies
  // once the long-press activates - so any finger drift during the hold
  // becomes an instant jump. Rebase at the first post-activation update.
  const baseX = useSharedValue<number | null>(null);
  const baseY = useSharedValue<number | null>(null);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activateAfterLongPress(250)
        .onStart(() => {
          'worklet';
          if (locked) {
            runOnJS(onLocked)();
            return;
          }
          activeId.value = id;
          runOnJS(onStart)(id);
        })
        .onUpdate((e) => {
          'worklet';
          if (activeId.value !== id) return; // locked drags never activated
          if (baseX.value == null) {
            baseX.value = e.translationX;
            baseY.value = e.translationY;
          }
          tx.value = e.translationX - (baseX.value ?? 0);
          ty.value = e.translationY - (baseY.value ?? 0);
          runOnJS(onMove)(id, e.absoluteX, e.absoluteY);
        })
        .onEnd(() => {
          'worklet';
          runOnJS(onEnd)();
        })
        .onFinalize(() => {
          'worklet';
          activeId.value = '';
          tx.value = 0;
          ty.value = 0;
          baseX.value = null;
          baseY.value = null;
        }),
    [id, enabled, locked, activeId, tx, ty, baseX, baseY, onStart, onMove, onEnd, onLocked]
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        layout={isDragging ? undefined : LinearTransition.duration(200)}
        style={[...style, dragStyle]}
        onLayout={(e: LayoutChangeEvent) => onFrame(id, e.nativeEvent.layout)}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

export default function TrainScreen() {
  const router = useRouter();
  const live = useActiveWorkout((s) => s.workoutId !== null);
  const startWorkout = useActiveWorkout((s) => s.startWorkout);
  const userId = useSettings((s) => s.supabase_user_id);
  const syncError = useSettings((s) => s.last_sync_error);
  const lastSyncAt = useSettings((s) => s.last_sync_at);
  const activeIntents = parseIntents(useSettings((s) => s.active_intents));
  const unlockSpeed = useSettings((s) => s.unlock_speed);
  const unlockedModules = parseIntents(useSettings((s) => s.unlocked_modules));
  const setSettings = useSettings((s) => s.set);
  const everything = activeIntents.length === 0;

  const { widgets, hiddenWidgets, editMode, load, setEditMode, resize, reorder, addType } = useWidgetStore();
  const hasPro = useVoidPro();

  // Widgets matching the current focus selection (hidden per-focus via config).
  const visibleWidgets = widgets.filter((w) =>
    isWidgetVisible(w.widget_type, w.config, activeIntents)
  );
  const visibleIds = new Set(visibleWidgets.map((w) => w.id));

  // Existing routine/folder creation state (kept from original)
  const [routines, setRoutines] = useState<RoutineWithPreview[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [creating, setCreating] = useState<'routine' | 'folder' | null>(null);
  const [chooser, setChooser] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [moving, setMoving] = useState<RoutineWithPreview | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState<string | null>(null);
  const namedFolders = folders.filter((f) => f !== 'My Routines');
  const userRoutines = routines.filter((r) => !r.folder_name.startsWith('Examples ·'));

  const refresh = useCallback(async () => {
    // One-shot ALL-focus default (1 stat widget per category); no-op after.
    await ensureAllFocusDefault();
    await load();
    setRoutines(await listRoutinesWithPreview());
    setFolders(await listFolders());
    setAssignments(await getFolderAssignments());
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Gradual mode: earn focuses through usage.
      if (unlockSpeed === 'gradual') {
        void checkUnlocks(unlockedModules, userId).then((earned) => {
          if (earned.length === 0) return;
          setSettings({
            unlocked_modules: JSON.stringify([...unlockedModules, ...earned]),
          });
          for (const i of earned) {
            const rule = UNLOCK_RULES.find((r) => r.intent === i);
            notify('Focus unlocked', { body: `${i.toUpperCase()} - ${rule?.hint ?? ''}`, tone: 'success' });
          }
        });
      }
    }, [refresh, unlockSpeed, unlockedModules.join(), userId])
  );

  const starting = useRef(false);
  const start = useCallback(
    async (routine?: RoutineWithPreview) => {
      if (starting.current) return;
      starting.current = true;
      try {
        if (routine) {
          await openRoutineWorkout(router, routine);
        } else {
          await startWorkout({});
          router.push('/workout/active');
        }
      } finally {
        starting.current = false;
      }
    },
    [startWorkout, router]
  );

  const onPlus = useCallback(() => {
    setChooser(true);
  }, []);

  const saveRoutine = useCallback(async () => {
    if (!newTitle.trim()) return;
    if (creating === 'folder') {
      if (!(await allowedOrPrompt('folders', await countMyFolders(userId)))) return;
      await createFolder(newTitle, userId);
      setCreating(null);
      setNewTitle('');
      await refresh();
      return;
    }
    if (!(await allowedOrPrompt('routines', await countMyRoutines(userId)))) return;
    const r = await createRoutine({ title: newTitle, user_id: userId });
    setCreating(null);
    setNewTitle('');
    await refresh();
    // The create Sheet is an RN Modal - pushing while its dismiss animation
    // runs leaves the pushed screen attached to a dying VC (black screen
    // later). Wait out the fade before navigating.
    await new Promise((res) => setTimeout(res, 350));
    router.push(`/routine/${r.id}`);
  }, [newTitle, creating, userId, refresh, router]);

  const cycleSize = useCallback(
    (id: string, type: WidgetType, currentSize: WidgetSize) => {
      const sizes = WIDGET_SIZES[type] ?? ['2x1'];
      const idx = sizes.indexOf(currentSize);
      const next = sizes[(idx + 1) % sizes.length];
      void resize(id, next);
    },
    [resize]
  );

  const scrollRef = useRef<ScrollView>(null);

  // -- Drag-to-reorder ------------------------------------------------------
  // Displayed order (adaptive widget pinned first). Order/visibility live in
  // refs because the drag callbacks are worklets → JS bridge calls that read
  // them after the latest render.
  const orderedWidgets = [...visibleWidgets].sort((a, b) => {
    const ap = a.widget_type === 'weekly_consistency' ? 0 : 1;
    const bp = b.widget_type === 'weekly_consistency' ? 0 : 1;
    return ap - bp;
  });
  const framesRef = useRef(new Map<string, WidgetFrame>());
  const gridWidthRef = useRef(0);
  // ScrollView + grid positions captured synchronously via onLayout (in
  // screen coords for the ScrollView, scroll-content coords for the grid).
  // measureInWindow is async and produced a stale origin for the first drag
  // frames - the slot math overshot by the header height and flickered.
  const svLayout = useRef({ x: 0, y: 0, h: 0 });
  const gridLayout = useRef({ x: 0, y: 0 });
  const scrollYRef = useRef(0);
  const orderRef = useRef<string[]>([]);
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const pinIdRef = useRef<string | null>(null);
  const lastTarget = useRef(-1);
  const dragIdRef = useRef<string | null>(null);
  // Slot candidates frozen at pickup - the array doesn't reorder mid-drag,
  // so positions stay stable and only a preview gap reflows.
  const dropSlots = useRef<{ x: number; y: number }[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropMarker, setDropMarker] = useState<{ x: number; y: number; h: number } | null>(null);
  const dragIdSV = useSharedValue('');
  const dragTx = useSharedValue(0);
  const dragTy = useSharedValue(0);

  orderRef.current = orderedWidgets.map((w) => w.id);
  visibleIdsRef.current = visibleIds;
  pinIdRef.current =
    orderedWidgets[0]?.widget_type === 'weekly_consistency' ? orderedWidgets[0].id : null;

  const onFrame = useCallback((id: string, frame: WidgetFrame) => {
    framesRef.current.set(id, frame);
  }, []);

  const onDragStart = useCallback((id: string) => {
    lastTarget.current = -1;
    dragIdRef.current = id;
    setDraggingId(id);
    setDropMarker(null);
    // Freeze the slot map at pickup: every other widget's centre, plus a
    // virtual end slot that sits right of the last item only when a widget of
    // the dragged width can actually fit there - otherwise it's the start of
    // the next row. Frozen because live reflow mid-drag made targets move.
    const others = orderRef.current.filter((i) => i !== id && i !== pinIdRef.current);
    const slots = others.map((oid) => {
      const f = framesRef.current.get(oid);
      return f ? { x: f.x + f.width / 2, y: f.y + f.height / 2 } : { x: 1e9, y: 1e9 };
    });
    const last = others.length ? framesRef.current.get(others[others.length - 1]) : undefined;
    const dragF = framesRef.current.get(id);
    const gridW = gridWidthRef.current;
    if (last && dragF && gridW > 0) {
      const gap = 12;
      const fitsRight = last.x + last.width + gap + dragF.width <= gridW + 1;
      slots.push(
        fitsRight
          ? { x: last.x + last.width + gap + dragF.width / 2, y: last.y + last.height / 2 }
          : { x: gridW / 4, y: last.y + last.height + 10 + dragF.height / 2 }
      );
    } else {
      slots.push({ x: gridW > 0 ? gridW / 2 : 0, y: 0 });
    }
    dropSlots.current = slots;
  }, []);

  const onDragMove = useCallback((_id: string, absX: number, absY: number) => {
    // Auto-scroll while dragging near the viewport edges.
    const relY = absY - svLayout.current.y;
    if (svLayout.current.h > 0) {
      if (relY > svLayout.current.h - 60) {
        scrollRef.current?.scrollTo({ y: scrollYRef.current + 14, animated: false });
      } else if (relY < 60) {
        scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current - 14), animated: false });
      }
    }

    // Finger position in grid-content coords, then nearest frozen slot. A
    // 14px hysteresis stops the target flapping between adjacent slots.
    const cx = absX - svLayout.current.x - gridLayout.current.x;
    const cy = absY - svLayout.current.y + scrollYRef.current - gridLayout.current.y;
    const slots = dropSlots.current;
    if (slots.length === 0) return; // locked drag - pickup never committed
    let target = 0;
    let best = Infinity;
    for (let k = 0; k < slots.length; k++) {
      const d = (slots[k].x - cx) ** 2 + (slots[k].y - cy) ** 2;
      if (d < best) {
        best = d;
        target = k;
      }
    }
    if (target === lastTarget.current) return;
    const cur = lastTarget.current >= 0 && lastTarget.current < slots.length
      ? slots[lastTarget.current]
      : null;
    const curD = cur ? (cur.x - cx) ** 2 + (cur.y - cy) ** 2 : Infinity;
    if (best > curD - 14 * 14) return;
    lastTarget.current = target;
    // Marker sits at the left edge of the target slot.
    const dragF = framesRef.current.get(_id);
    if (dragF) {
      setDropMarker({
        x: slots[target].x - dragF.width / 2 - 6,
        y: slots[target].y - dragF.height / 2,
        h: dragF.height,
      });
    }
  }, []);

  const onDragEnd = useCallback(() => {
    const did = dragIdRef.current;
    const target = lastTarget.current;
    setDraggingId(null);
    setDropMarker(null);
    lastTarget.current = -1;
    dragIdRef.current = null;
    if (did == null || target < 0) return;
    // Commit once: hidden widgets keep their array slots; the visible ones
    // are re-dealt in the new displayed order (pin stays first).
    const cur = useWidgetStore.getState().widgets;
    const others = orderRef.current.filter((i) => i !== did && i !== pinIdRef.current);
    const newVisIds = [...others.slice(0, target), did, ...others.slice(target)];
    if (pinIdRef.current) newVisIds.unshift(pinIdRef.current);
    if (newVisIds.join() === orderRef.current.join()) return;
    const byId = new Map(cur.map((w) => [w.id, w]));
    const it = newVisIds[Symbol.iterator]();
    const next = cur.map((w) =>
      visibleIdsRef.current.has(w.id) ? (byId.get(it.next().value!) ?? w) : w
    );
    useWidgetStore.setState({ widgets: next });
    void reorder(next.map((w) => w.id));
  }, [reorder]);

  const onDragLocked = useCallback(() => {
    showUpgradePrompt(
      'Moving widgets is a Pro feature',
      'Reorder and resize your home board with Void Pro.'
    );
  }, []);

  // X hides the widget under the current selection only - 'all' marker under
  // EVERYTHING, the active intents under a narrowed focus. Restorable from
  // the picker's HIDDEN IN THIS FOCUS section.
  const removeForFocus = useCallback(
    (w: (typeof widgets)[0]) => {
      const keys: string[] = everything ? [ALL_HIDE_KEY] : activeIntents;
      const prev = Array.isArray(w.config.hidden_intents) ? (w.config.hidden_intents as string[]) : [];
      const newConfig = { ...w.config, hidden_intents: [...new Set([...prev, ...keys])] };
      useWidgetStore.setState({
        widgets: useWidgetStore.getState().widgets.map((x) =>
          x.id === w.id ? { ...x, config: newConfig } : x
        ),
      });
      void updateWidgetConfig(w.id, newConfig);
    },
    [everything, activeIntents]
  );

  // Restore a widget hidden under the current focus selection.
  const restoreForFocus = useCallback(
    (w: (typeof widgets)[0]) => {
      const keys: string[] = everything ? [ALL_HIDE_KEY] : activeIntents;
      const prev = Array.isArray(w.config.hidden_intents) ? (w.config.hidden_intents as string[]) : [];
      const newConfig = {
        ...w.config,
        hidden_intents: prev.filter((i) => !keys.includes(i)),
      };
      useWidgetStore.setState({
        widgets: useWidgetStore.getState().widgets.map((x) =>
          x.id === w.id ? { ...x, config: newConfig } : x
        ),
      });
      void updateWidgetConfig(w.id, newConfig);
    },
    [everything, activeIntents]
  );

  // Set widget horizontal alignment (for 1-wide widgets in a 2-column grid)
  const setWidgetAlign = useCallback(
    (id: string, align: 'left' | 'right') => {
      const currentWidgets = useWidgetStore.getState().widgets;
      const widget = currentWidgets.find((w) => w.id === id);
      if (!widget) return;
      const newConfig = { ...widget.config, align };
      useWidgetStore.setState({
        widgets: currentWidgets.map((w) =>
          w.id === id ? { ...w, config: newConfig } : w
        ),
      });
      // Persist config to DB
      void updateWidgetConfig(id, newConfig);
    },
    []
  );

  return (
    <Screen>
      <ScreenHeader
        title="Train"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable onPress={() => router.push('/archive')} hitSlop={8}>
              <Archive color={Void.textSecondary} size={20} />
            </Pressable>
            <Pressable onPress={() => router.push('/cardio')} hitSlop={8}>
              <HeartPulse color={Void.textSecondary} size={20} />
            </Pressable>
            <Pressable
              onPress={() => setEditMode(!editMode)}
              hitSlop={8}>
              {editMode ? <Check color={Void.accent} size={20} /> : <Pencil color={Void.textSecondary} size={18} />}
            </Pressable>
            <Pressable onPress={editMode ? () => setPickerOpen(true) : onPlus} hitSlop={8}>
              <Plus color={Void.accent} size={22} />
            </Pressable>
          </View>
        }
      />

      <IntentSwitcher />

      {editMode && (
        <Pressable style={styles.editBanner} onPress={() => setPickerOpen(true)}>
          <Text style={styles.editBannerText}>
            {hasPro
              ? 'EDIT MODE - Hold & drag to reorder, size icon to resize, X to remove, + to add'
              : 'EDIT MODE - X to remove, + to add, tap to open. Moving and resizing widgets is a Pro feature.'}
          </Text>
        </Pressable>
      )}

      {userId != null && syncError != null && (
        <Pressable
          style={styles.syncWarn}
          onPress={() =>
            notify('Sync issue', {
              body: `Some data may not be backed up to your account.\n\n${syncError}${
                lastSyncAt ? `\n\nLast attempt: ${new Date(lastSyncAt).toLocaleString()}` : ''
              }`,
              tone: 'error',
            })
          }>
          <AlertTriangle color="#FFB800" size={14} />
          <Text style={styles.syncWarnText}>SYNC ISSUE - tap for details</Text>
        </Pressable>
      )}

      {/* Free users keep social sync but their own logs never leave the
          device — surface that as an upsell instead of staying silent. */}
      {userId != null && !hasPro && (
        <Pressable
          style={styles.localOnly}
          onPress={() =>
            showUpgradePrompt(
              'No cloud backup',
              'Your logs live on this device only. Void Pro adds cloud sync, cross-device backup, and collab routines.'
            )
          }>
          <CloudOff color={Void.textTertiary} size={13} />
          <Text style={styles.localOnlyText}>LOCAL ONLY - backup is a Pro feature</Text>
        </Pressable>
      )}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        onLayout={(e) => {
          const l = e.nativeEvent.layout;
          svLayout.current = { x: l.x, y: l.y, h: l.height };
        }}>
        {(() => {
          const SECTION_MAP: Record<WidgetType, string> = {
            weekly_consistency: '',
            routine: 'MY ROUTINES',
            example_routine: 'EXAMPLES',
            folder: 'FOLDERS',
            readiness: 'METRICS',
            streak: 'METRICS',
            strength_score: 'METRICS',
            today_calories: 'METRICS',
            today_protein: 'METRICS',
            hydration: 'METRICS',
            body_weight: 'METRICS',
            resting_hr: 'METRICS',
            sleep: 'METRICS',
            week_volume: 'METRICS',
            last_pr: 'METRICS',
            recent_prs: 'METRICS',
            hard_sets: 'METRICS',
            top_lifts: 'METRICS',
            cardio_weekly: 'METRICS',
            last_workout: 'ACTIONS',
            plate_calculator: 'ACTIONS',
            rest_timer: 'ACTIONS',
            quick_cardio: 'ACTIONS',
            exercise_quick_add: 'ACTIONS',
            text_goal: 'GOALS',
            friends_snapshot: 'METRICS',
          };
          // One flat grid, in sort order - no section headers. The old
          // section name is now a small in-widget tag instead of a divider.
          // The adaptive consistency widget always floats to the top.
          return (
            <View
              style={styles.grid}
              collapsable={false}
              onLayout={(e) => {
                const l = e.nativeEvent.layout;
                gridLayout.current = { x: l.x, y: l.y };
                gridWidthRef.current = l.width;
              }}>
              {orderedWidgets.map((w) => {
                const Comp = WIDGET_COMPONENTS[w.widget_type];
                if (!Comp) return null;
                return (
                  <DraggableWidget
                    key={w.id}
                    id={w.id}
                    enabled={editMode && w.widget_type !== 'weekly_consistency'}
                    locked={!hasPro}
                    isDragging={draggingId === w.id}
                    activeId={dragIdSV}
                    tx={dragTx}
                    ty={dragTy}
                    onStart={onDragStart}
                    onMove={onDragMove}
                    onEnd={onDragEnd}
                    onLocked={onDragLocked}
                    onFrame={onFrame}
                    style={[
                      w.size.startsWith('2') ? { width: '100%' } : { width: '48.5%' },
                      ...(w.config?.align === 'right' ? [{ marginLeft: 'auto' as const }] : []),
                    ]}>
                  <WidgetWrapper
                    id={w.id}
                    size={w.size}
                    editMode={editMode}
                    tag={SECTION_MAP[w.widget_type] || undefined}
                    canMoveLeft={w.config?.align === 'right'}
                    canMoveRight={w.config?.align !== 'right'}
                    alignRight={w.config?.align === 'right'}
                    onMoveLeft={() => setWidgetAlign(w.id, 'left')}
                    onMoveRight={() => setWidgetAlign(w.id, 'right')}
                    onEdit={
                      w.widget_type === 'routine' || w.widget_type === 'example_routine'
                        ? () => router.push(`/routine/${w.config.routineId as string}`)
                        : w.widget_type === 'folder'
                          ? () => setFolderOpen(w.config.folderName as string)
                          : undefined
                    }
                    onRemove={() => removeForFocus(w)}
                    onCycleSize={() => cycleSize(w.id, w.widget_type, w.size)}
                    canRearrange={hasPro}
                    onRearrangeLocked={() =>
                      showUpgradePrompt(
                        'Moving widgets is a Pro feature',
                        'Reorder and resize your home board with Void Pro.'
                      )
                    }>
                    <Comp
                      size={w.size}
                      config={w.config}
                      id={w.id}
                      activeIntents={activeIntents}
                      onLongPress={(rid) => {
                        const r = routines.find((x) => x.id === rid);
                        if (r) setMoving(r);
                      }}
                    />
                  </WidgetWrapper>
                  </DraggableWidget>
                );
              })}
              {/* Landing-slot marker - absolutely positioned so it never
                  reflows the grid (reflow moved the dragged view's translate
                  origin mid-drag = teleporting). */}
              {dropMarker && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.dropMarker,
                    { left: dropMarker.x, top: dropMarker.y, height: dropMarker.h },
                  ]}
                />
              )}
            </View>
          );
        })()}
      </ScrollView>

      {/* Add chooser */}
      <Sheet visible={chooser} onClose={() => setChooser(false)} title="ADD">
        <Pressable
          style={styles.folderOption}
          onPress={() => {
            setChooser(false);
            setCreating('routine');
          }}>
          <Text style={styles.folderOptionText}>ROUTINE</Text>
        </Pressable>
        <Pressable
          style={styles.folderOption}
          onPress={() => {
            setChooser(false);
            setCreating('folder');
          }}>
          <Text style={styles.folderOptionText}>FOLDER</Text>
        </Pressable>
      </Sheet>

      {/* New routine / folder sheet */}
      <Sheet
        visible={creating != null}
        onClose={() => setCreating(null)}
        title={creating === 'folder' ? 'NEW FOLDER' : 'NEW ROUTINE'}>
        <TextInput
          style={styles.input}
          placeholder={creating === 'folder' ? 'e.g. Push / Pull' : 'e.g. Push Day'}
          placeholderTextColor={Void.textTertiary}
          value={newTitle}
          onChangeText={setNewTitle}
          autoFocus
          onSubmitEditing={() => void saveRoutine()}
        />
        <View style={styles.sheetRow}>
          <Pressable onPress={() => setCreating(null)} style={styles.sheetBtn}>
            <Text style={styles.sheetBtnText}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={() => void saveRoutine()}
            style={[styles.sheetBtn, styles.sheetBtnAccent]}>
            <Text style={[styles.sheetBtnText, { color: Void.accentText }]}>CREATE</Text>
          </Pressable>
        </View>
      </Sheet>

      {/* Move-to-folder sheet */}
      <Sheet visible={moving != null} onClose={() => setMoving(null)} title="FOLDERS">
            {namedFolders.map((f) => {
              const isSelected = moving ? (assignments[moving.id] || []).includes(f) : false;
              return (
                <Pressable
                  key={f}
                  style={styles.folderOption}
                  onPress={() => {
                    if (moving)
                      void toggleRoutineFolder(moving.id, f).then(() => {
                        useFolderStore.getState().bump();
                        void refresh();
                      });
                  }}>
                  <Text style={styles.folderOptionText}>{f}</Text>
                  {isSelected && <Text style={styles.folderCheck}>✓</Text>}
                </Pressable>
              );
            })}
            {namedFolders.length === 0 && (
              <Text style={styles.empty}>No folders yet. Tap + NEW FOLDER below.</Text>
            )}
            <Pressable
              style={styles.sheetBtnRow}
              onPress={() => {
                setMoving(null);
                // Modal -> modal swap: wait for the move sheet's dismiss
                // animation or the create sheet can fail to present.
                setTimeout(() => setCreating('folder'), 350);
              }}>
              <Text style={styles.folderNew}>+ NEW FOLDER</Text>
            </Pressable>
            <Pressable onPress={() => setMoving(null)} style={[styles.sheetBtn, { alignSelf: 'flex-end', marginTop: 8 }]}>
              <Text style={styles.sheetBtnText}>DONE</Text>
            </Pressable>
      </Sheet>

      {/* Folder contents (edit-mode pencil on folder widgets lands here) */}
      <Sheet
        visible={folderOpen != null}
        onClose={() => setFolderOpen(null)}
        title={(folderOpen ?? '').toUpperCase()}>
        <ScrollView style={{ maxHeight: 320 }}>
          {routines
            .filter((r) => (assignments[r.id] || []).includes(folderOpen!))
            .map((r) => (
              <View key={r.id} style={styles.pickerRow}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => {
                    setFolderOpen(null);
                    // Sheet is a Modal - wait out its dismiss before pushing.
                    setTimeout(() => router.push(`/routine/${r.id}`), 350);
                  }}>
                  <Text style={styles.pickerLabel}>
                    {r.title}
                    {r.is_shared === 1 ? '  ·SHARED' : ''}
                  </Text>
                  <Text style={styles.pickerSizes} numberOfLines={1}>
                    {r.exercise_names || 'No exercises'}
                  </Text>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    setFolderOpen(null);
                    setTimeout(() => void start(r), 350);
                  }}>
                  <Text style={styles.pickerAdd}>START</Text>
                </Pressable>
              </View>
            ))}
          {routines.filter((r) => (assignments[r.id] || []).includes(folderOpen!)).length === 0 && (
            <Text style={styles.empty}>No routines in this folder</Text>
          )}
        </ScrollView>
      </Sheet>

      {/* Widget picker - add removed/new widgets */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="ADD WIDGET">
            <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
              {/* Widgets hidden only under the current focus */}
              {(() => {
                const focusHidden = widgets.filter((w) =>
                  isFocusHidden(w.widget_type, w.config, activeIntents)
                );
                if (focusHidden.length === 0) return null;
                return (
                  <>
                    <Text style={styles.pickerSection}>HIDDEN IN THIS FOCUS</Text>
                    {focusHidden.map((w) => (
                      <Pressable
                        key={w.id}
                        style={styles.pickerRow}
                        onPress={() => { restoreForFocus(w); setPickerOpen(false); }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickerLabel}>{WIDGET_LABELS[w.widget_type]}</Text>
                          <Text style={styles.pickerSizes}>{w.size}</Text>
                        </View>
                        <Text style={styles.pickerAdd}>RESTORE</Text>
                      </Pressable>
                    ))}
                  </>
                );
              })()}

              {/* Multi-instance: one per routine */}
              {(() => {
                const unwidgeted = userRoutines.filter(
                  (r) => !widgets.some((w) => w.widget_type === 'routine' && w.config.routineId === r.id)
                );
                if (unwidgeted.length === 0) return null;
                return (
                  <>
                    <Text style={styles.pickerSection}>ROUTINES</Text>
                    {unwidgeted.map((r) => {
                      const isHidden = hiddenWidgets.some((w) => w.widget_type === 'routine' && w.config.routineId === r.id);
                      return (
                        <View
                          key={r.id}
                          style={styles.pickerRow}>
                          <Pressable
                            style={{ flex: 1 }}
                            onPress={() => { void addType('routine', { routineId: r.id }).then(() => setPickerOpen(false)); }}>
                            <Text style={styles.pickerLabel}>
                              {r.title}
                              {r.is_shared === 1 ? '  ·SHARED' : ''}
                            </Text>
                            <Text style={styles.pickerSizes}>Routine · 1x1-2x2</Text>
                          </Pressable>
                          <Pressable
                            hitSlop={8}
                            onPress={() => {
                              setPickerOpen(false);
                              setTimeout(() => router.push(`/routine/${r.id}`), 350);
                            }}
                            style={{ marginRight: 14 }}>
                            <Text style={styles.pickerAdd}>EDIT</Text>
                          </Pressable>
                          <Pressable
                            hitSlop={8}
                            onPress={() => { void addType('routine', { routineId: r.id }).then(() => setPickerOpen(false)); }}>
                            <Text style={styles.pickerAdd}>{isHidden ? 'RESTORE' : '+ ADD'}</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </>
                );
              })()}

              {/* Multi-instance: one per example routine */}
              {(() => {
                const examples = routines.filter((r) => r.folder_name.startsWith('Examples ·'));
                const unwidgeted = examples.filter(
                  (r) => !widgets.some((w) => w.widget_type === 'example_routine' && w.config.routineId === r.id)
                );
                if (unwidgeted.length === 0) return null;
                return (
                  <>
                    <Text style={styles.pickerSection}>EXAMPLES</Text>
                    {unwidgeted.map((r) => {
                      const isHidden = hiddenWidgets.some((w) => w.widget_type === 'example_routine' && w.config.routineId === r.id);
                      return (
                        <Pressable
                          key={r.id}
                          style={styles.pickerRow}
                          onPress={() => { void addType('example_routine', { routineId: r.id }).then(() => setPickerOpen(false)); }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pickerLabel}>{r.title}</Text>
                            <Text style={styles.pickerSizes}>Example · 1x1-2x2</Text>
                          </View>
                          <Text style={styles.pickerAdd}>{isHidden ? 'RESTORE' : '+ ADD'}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                );
              })()}

              {/* Multi-instance: one per folder */}
              {(() => {
                const unwidgeted = namedFolders.filter(
                  (f) => !widgets.some((w) => w.widget_type === 'folder' && w.config.folderName === f)
                );
                if (unwidgeted.length === 0) return null;
                return (
                  <>
                    <Text style={styles.pickerSection}>FOLDERS</Text>
                    {unwidgeted.map((f) => {
                      const isHidden = hiddenWidgets.some((w) => w.widget_type === 'folder' && w.config.folderName === f);
                      return (
                        <Pressable
                          key={f}
                          style={styles.pickerRow}
                          onPress={() => { void addType('folder', { folderName: f }).then(() => setPickerOpen(false)); }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pickerLabel}>{f}</Text>
                            <Text style={styles.pickerSizes}>Folder · 1x1-2x2</Text>
                          </View>
                          <Text style={styles.pickerAdd}>{isHidden ? 'RESTORE' : '+ ADD'}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                );
              })()}

              {/* Single-instance widgets */}
              {(() => {
                const types: WidgetType[] = ['readiness', 'streak', 'strength_score', 'today_calories', 'today_protein', 'body_weight', 'resting_hr', 'sleep', 'week_volume', 'last_pr', 'recent_prs', 'hard_sets', 'top_lifts', 'cardio_weekly'];
                const unwidgeted = types.filter((t) => !widgets.some((w) => w.widget_type === t));
                if (unwidgeted.length === 0) return null;
                return (
                  <>
                    <Text style={styles.pickerSection}>METRICS</Text>
                    {unwidgeted.map((type) => {
                      const isHidden = hiddenWidgets.some((w) => w.widget_type === type);
                      return (
                        <Pressable
                          key={type}
                          style={styles.pickerRow}
                          onPress={() => { void addType(type).then(() => setPickerOpen(false)); }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pickerLabel}>{WIDGET_LABELS[type]}</Text>
                            <Text style={styles.pickerSizes}>{WIDGET_SIZES[type].join(' · ')}</Text>
                          </View>
                          <Text style={styles.pickerAdd}>{isHidden ? 'RESTORE' : '+ ADD'}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                );
              })()}

              {/* Custom goal - always available, multi-instance */}
              <Text style={styles.pickerSection}>CUSTOM</Text>
              <Pressable
                style={styles.pickerRow}
                onPress={() => { void addType('text_goal', { title: '', text: '' }).then(() => setPickerOpen(false)); }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerLabel}>{WIDGET_LABELS.text_goal}</Text>
                  <Text style={styles.pickerSizes}>{WIDGET_SIZES.text_goal.join(' · ')}</Text>
                </View>
                <Text style={styles.pickerAdd}>+ ADD</Text>
              </Pressable>

              {(() => {
                const types: WidgetType[] = ['last_workout', 'plate_calculator', 'rest_timer', 'quick_cardio', 'exercise_quick_add'];
                const unwidgeted = types.filter((t) => !widgets.some((w) => w.widget_type === t));
                if (unwidgeted.length === 0) return null;
                return (
                  <>
                    <Text style={styles.pickerSection}>ACTIONS</Text>
                    {unwidgeted.map((type) => {
                      const isHidden = hiddenWidgets.some((w) => w.widget_type === type);
                      return (
                        <Pressable
                          key={type}
                          style={styles.pickerRow}
                          onPress={() => { void addType(type).then(() => setPickerOpen(false)); }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pickerLabel}>{WIDGET_LABELS[type]}</Text>
                            <Text style={styles.pickerSizes}>{WIDGET_SIZES[type].join(' · ')}</Text>
                          </View>
                          <Text style={styles.pickerAdd}>{isHidden ? 'RESTORE' : '+ ADD'}</Text>
                        </Pressable>
                      );
                    })}
                  </>
                );
              })()}
            </ScrollView>
            <Pressable onPress={() => setPickerOpen(false)} style={[styles.sheetBtn, { alignSelf: 'flex-end', marginTop: 12 }]}>
              <Text style={styles.sheetBtnText}>DONE</Text>
            </Pressable>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 8,
  },
  dropMarker: {
    position: 'absolute',
    width: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(204,255,0,0.4)',
  },
  sectionHeader: { color: Void.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginTop: 20, marginBottom: 4 },
  syncWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A2F00',
    backgroundColor: '#1A1500',
  },
  syncWarnText: { color: '#FFB800', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  localOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  localOnlyText: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  editBanner: {
    backgroundColor: Void.accentDim,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  editBannerText: { color: Void.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
  input: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    color: Void.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
  },
  sheetRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  sheetBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  sheetBtnAccent: { backgroundColor: Void.accent },
  sheetBtnText: { color: Void.textSecondary, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  folderOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  folderOptionText: { color: Void.text, fontSize: 15 },
  folderCheck: { color: Void.accent, fontSize: 14, fontWeight: '800' },
  sheetBtnRow: { paddingVertical: 12 },
  folderNew: { color: Void.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  empty: {
    color: Void.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
    gap: 10,
  },
  pickerSection: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginTop: 14, marginBottom: 4 },
  pickerRowActive: { opacity: 0.5 },
  pickerLabel: { color: Void.text, fontSize: 15, fontWeight: '600' },
  pickerSizes: { color: Void.textTertiary, fontSize: 10, marginTop: 2, letterSpacing: 0.5 },
  pickerAdded: { color: Void.textTertiary, fontSize: 11, fontWeight: '700' },
  pickerAdd: { color: Void.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
});


