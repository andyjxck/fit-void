import { useFocusEffect, useRouter } from 'expo-router';
import {
    HeartPulse,
    Minus,
    Pencil,
    Play,
    Plus,
    SkipForward,
    Star,
    Target,
    Timer,
    Trophy,
    Users
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { listExercises } from '@/db/repo/exercises';
import { updateWidgetConfig } from '@/db/repo/widgets';
import { listHistory, type HistoryEntry } from '@/db/repo/workouts';
import { formatDate, formatDuration, formatVolume } from '@/lib/format';
import { plateBreakdown } from '@/lib/plates';
import type { Exercise } from '@/lib/types';
import { sizeDims, type WidgetSize } from '@/lib/widgetTypes';
import { useActiveWorkout } from '@/store/activeWorkout';
import { useSettings } from '@/store/settings';
import { useWidgetStore } from '@/store/widgets';
import { tabular, Void } from '@/theme/tokens';

// ---------------------------------------------------------------------------
// Shared widget surface - NO marginHorizontal; the grid handles spacing.
// ---------------------------------------------------------------------------
const surface = {
  ...cardChrome,
  borderRadius: 12,
  padding: 14,
  flex: 1,
} as const;

const FEELS = ['Flat', 'Tough', 'Solid', 'Strong', 'Beast'] as const;

// ---------------------------------------------------------------------------
// 1. QuickStartWidget (2x1)
// ---------------------------------------------------------------------------
export function QuickStartWidget() {
  const router = useRouter();
  const live = useActiveWorkout((s) => s.workoutId !== null);
  const startWorkout = useActiveWorkout((s) => s.startWorkout);
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    if (live) {
      router.push('/workout/active');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await startWorkout();
      router.push('/workout/active');
    } finally {
      setBusy(false);
    }
  }, [live, busy, startWorkout, router]);

  return (
    <View style={surface}>
      <CardSheen />
      <Pressable
        style={styles.quickStartBtn}
        disabled={busy}
        onPress={() => void onPress()}>
        <Play size={20} color={Void.accentText} fill={Void.accentText} />
        <Text style={styles.quickStartText}>
          {live ? 'RESUME WORKOUT' : 'START EMPTY WORKOUT'}
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 2. RestTimerWidget (1x1)
// ---------------------------------------------------------------------------
export function RestTimerWidget() {
  const rest = useActiveWorkout((s) => s.rest);
  const workoutId = useActiveWorkout((s) => s.workoutId);
  const adjustRest = useActiveWorkout((s) => s.adjustRest);
  const skipRest = useActiveWorkout((s) => s.skipRest);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rest) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [rest]);

  if (!workoutId || !rest) {
    return (
      <View style={[surface, styles.restEmpty]}>
        <CardSheen />
        <Timer size={20} color={Void.textTertiary} />
        <Text style={styles.restEmptyText}>No rest timer</Text>
      </View>
    );
  }

  const remainingMs = Math.max(0, rest.endsAt - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(remainingSec / 60);
  const ss = remainingSec % 60;
  const timeStr = `${mm}:${String(ss).padStart(2, '0')}`;
  const progress = rest.durationSec > 0 ? 1 - remainingMs / (rest.durationSec * 1000) : 0;

  return (
    <View style={surface}>
      <CardSheen />
      <Text style={styles.restLabel} numberOfLines={1}>
        {rest.label}
      </Text>
      <Text style={styles.restTime}>{timeStr}</Text>
      <View style={styles.restBar}>
        <View style={[styles.restBarFill, { width: `${Math.min(100, progress * 100)}%` }]} />
      </View>
      <View style={styles.restControls}>
        <Pressable style={styles.restBtn} onPress={() => adjustRest(-30)}>
          <Minus size={14} color={Void.text} />
          <Text style={styles.restBtnText}>30s</Text>
        </Pressable>
        <Pressable style={styles.restBtn} onPress={() => adjustRest(30)}>
          <Plus size={14} color={Void.text} />
          <Text style={styles.restBtnText}>30s</Text>
        </Pressable>
        <Pressable style={[styles.restBtn, styles.restSkip]} onPress={skipRest}>
          <SkipForward size={14} color={Void.accentText} />
          <Text style={styles.restSkipText}>SKIP</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 3. QuickCardioWidget (1x1)
// ---------------------------------------------------------------------------
export function QuickCardioWidget() {
  const router = useRouter();
  return (
    <View style={surface}>
      <CardSheen />
      <Pressable
        style={styles.cardioBtn}
        onPress={() => router.push('/cardio/new')}>
        <HeartPulse size={24} color={Void.accent} />
        <Text style={styles.cardioText}>LOG CARDIO</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 3b. FriendsSnapshotWidget (1x1) - friend count, tap opens the feed.
// ---------------------------------------------------------------------------
export function FriendsSnapshotWidget() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const [count, setCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setCount(null);
        return;
      }
      let cancelled = false;
      void import('@/lib/social').then(({ listFriends }) =>
        listFriends(userId).then((f) => {
          if (!cancelled) setCount(f.length);
        })
      );
      return () => {
        cancelled = true;
      };
    }, [userId])
  );

  return (
    <Pressable
      style={surface}
      onPress={() => router.push(userId ? '/social' : '/auth/link')}>
      <CardSheen />
      <View style={styles.friendsBtn}>
        <Users size={22} color={Void.accent} />
        {userId ? (
          <>
            <Text style={styles.friendsCount}>{count ?? '-'}</Text>
            <Text style={styles.friendsText}>FRIENDS</Text>
          </>
        ) : (
          <Text style={styles.friendsText}>SIGN IN FOR SOCIAL</Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 4. PlateCalculatorWidget (2x1)
// ---------------------------------------------------------------------------
export function PlateCalculatorWidget() {
  const { weight_unit, default_bar_weight } = useSettings();
  const [target, setTarget] = useState('');
  const [focused, setFocused] = useState(false);

  const num = parseFloat(target);
  const valid = Number.isFinite(num) && num > 0;
  const { plates, approximate } = valid
    ? plateBreakdown(num, default_bar_weight, weight_unit)
    : { plates: [], approximate: false };

  return (
    <View style={surface}>
      <CardSheen />
      <Text style={styles.plateTitle}>PLATE CALC</Text>
      <View style={styles.plateInputRow}>
        <TextInput
          style={styles.plateInput}
          value={target}
          onChangeText={setTarget}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Target"
          placeholderTextColor={Void.textTertiary}
          keyboardType="numeric"
          keyboardAppearance="dark"
        />
        <Text style={styles.plateUnit}>{weight_unit}</Text>
      </View>
      <View style={styles.plateBarRow}>
        <Text style={styles.plateBarLabel}>
          {default_bar_weight} {weight_unit} bar
        </Text>
        <Text style={styles.plateSide}>/ side</Text>
      </View>
      <View style={styles.plateChips}>
        {plates.length === 0 ? (
          <Text style={styles.plateEmpty}>
            {approximate ? 'below bar' : 'bar only'}
          </Text>
        ) : (
          plates.map((p, i) => (
            <View key={i} style={styles.plateChip}>
              <Text style={styles.plateChipText}>{trimPlate(p)}</Text>
            </View>
          ))
        )}
        {approximate && plates.length > 0 && <Text style={styles.plateApprox}>≈</Text>}
      </View>
    </View>
  );
}

const trimPlate = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

// ---------------------------------------------------------------------------
// 5. ExerciseQuickAddWidget (1x2)
// ---------------------------------------------------------------------------
export function ExerciseQuickAddWidget() {
  const addExercise = useActiveWorkout((s) => s.addExercise);
  const workoutId = useActiveWorkout((s) => s.workoutId);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setExercises(await listExercises({ favouritesOnly: true }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const onAdd = useCallback(
    async (id: string) => {
      if (!workoutId) return;
      setAddingId(id);
      try {
        await addExercise(id);
      } finally {
        setAddingId(null);
      }
    },
    [workoutId, addExercise]
  );

  if (exercises.length === 0) {
    return (
      <View style={[surface, styles.favEmpty]}>
        <CardSheen />
        <Star size={20} color={Void.textTertiary} />
        <Text style={styles.favEmptyText}>
          Star exercises in the Library to pin them here
        </Text>
      </View>
    );
  }

  const shown = exercises.slice(0, 6);

  return (
    <View style={surface}>
      <CardSheen />
      <Text style={styles.favTitle}>QUICK ADD</Text>
      <ScrollView style={styles.favScroll} showsVerticalScrollIndicator={false}>
        {shown.map((ex) => (
          <Pressable
            key={ex.id}
            style={styles.favRow}
            onPress={() => void onAdd(ex.id)}
            disabled={!workoutId || addingId === ex.id}>
            <Text style={styles.favName} numberOfLines={1}>
              {ex.name}
            </Text>
            <Plus size={16} color={workoutId ? Void.accent : Void.textTertiary} />
          </Pressable>
        ))}
      </ScrollView>
      {!workoutId && (
        <Text style={styles.favHint}>Start a workout to add sets</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 6. LastWorkoutWidget (2x2)
// ---------------------------------------------------------------------------
export function LastWorkoutWidget() {
  const router = useRouter();
  const { weight_unit } = useSettings();
  const [last, setLast] = useState<HistoryEntry | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listHistory(1);
    setLast(rows[0] ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!last) {
    return (
      <View style={[surface, styles.lastEmpty]}>
        <CardSheen />
        <Trophy size={24} color={Void.textTertiary} />
        <Text style={styles.lastEmptyText}>No workouts yet</Text>
      </View>
    );
  }

  const feelLabel = last.feel != null ? FEELS[last.feel - 1] : null;

  return (
    <Pressable style={surface} onPress={() => router.push(`/workout/${last.id}`)}>
      <CardSheen />
      <Text style={styles.lastTitle} numberOfLines={1}>
        {last.title}
      </Text>
      <Text style={styles.lastDate}>{formatDate(last.started_at)}</Text>

      <View style={styles.lastStatGrid}>
        <LastStat
          label="DURATION"
          value={last.duration_seconds ? formatDuration(last.duration_seconds) : '-'}
        />
        <LastStat
          label="VOLUME"
          value={`${formatVolume(last.total_volume_kg, weight_unit)} ${weight_unit}`}
        />
        <LastStat label="SETS" value={String(last.set_count)} />
        <LastStat label="EXERCISES" value={String(last.exercise_count)} />
      </View>

      <View style={styles.lastFooter}>
        {last.pr_count > 0 && (
          <View style={styles.lastPrPill}>
            <Trophy size={11} color={Void.accent} />
            <Text style={styles.lastPrText}>
              {last.pr_count} PR{last.pr_count > 1 ? 'S' : ''}
            </Text>
          </View>
        )}
        {feelLabel && (
          <View style={styles.lastFeelPill}>
            <Text style={styles.lastFeelText}>{feelLabel.toUpperCase()}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function LastStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.lastStat}>
      <Text style={styles.lastStatValue}>{value}</Text>
      <Text style={styles.lastStatLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 7. TextGoalWidget (any size) - free-text goal, tap to edit
// ---------------------------------------------------------------------------
export function TextGoalWidget({ size, config, id }: { size?: WidgetSize; config: Record<string, unknown>; id?: string }) {
  const text = typeof config.text === 'string' ? config.text : '';
  const title = typeof config.title === 'string' && config.title !== '' ? config.title : 'GOAL';
  // Focal type: the shorter the goal, the bigger it renders. Slightly larger
  // again on wide/tall tiles where there's room for it.
  const dims = size ? sizeDims(size) : { w: 1, h: 1 };
  const area = dims.w * dims.h;
  const base = area >= 4 ? 44 : area >= 2 ? 34 : 26;
  const len = text.length;
  const fontSize =
    len <= 8 ? base : len <= 16 ? base * 0.75 : len <= 32 ? base * 0.55 : len <= 64 ? base * 0.42 : base * 0.34;
  const [editOpen, setEditOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftText, setDraftText] = useState(text);

  const save = useCallback(async () => {
    const cfg = { ...config, title: draftTitle.trim(), text: draftText.trim() };
    if (id) {
      await updateWidgetConfig(id, cfg);
      useWidgetStore.setState({
        widgets: useWidgetStore.getState().widgets.map((w) => (w.id === id ? { ...w, config: cfg } : w)),
      });
    }
    setEditOpen(false);
  }, [id, config, draftTitle, draftText]);

  return (
    <>
      <Pressable
        style={surface}
        onPress={() => {
          setDraftTitle(title === 'GOAL' ? '' : title);
          setDraftText(text);
          setEditOpen(true);
        }}>
        <CardSheen />
        <View style={styles.goalHeader}>
          <Target size={14} color={Void.accent} />
          <Text style={styles.goalLabel} numberOfLines={1}>{title.toUpperCase()}</Text>
          <Pencil size={11} color={Void.textTertiary} />
        </View>
        {text !== '' ? (
          <View style={styles.goalCenter}>
            <Text
              style={[styles.goalText, { fontSize, lineHeight: fontSize * 1.15 }]}
              numberOfLines={8}
              adjustsFontSizeToFit
              minimumFontScale={0.5}>
              {text}
            </Text>
          </View>
        ) : (
          <Text style={styles.goalEmpty}>Tap to set your goal</Text>
        )}
      </Pressable>

      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title="CUSTOM GOAL">
        <View style={styles.goalSheet}>
          <TextInput
            style={styles.goalInput}
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="Label (e.g. 2026 goal)"
            placeholderTextColor={Void.textTertiary}
            keyboardAppearance="dark"
            maxLength={24}
          />
          <TextInput
            style={[styles.goalInput, styles.goalInputMultiline]}
            value={draftText}
            onChangeText={setDraftText}
            placeholder="e.g. Squat 140 kg by June"
            placeholderTextColor={Void.textTertiary}
            keyboardAppearance="dark"
            multiline
            autoFocus
          />
          <View style={styles.goalBtnRow}>
            <Pressable style={styles.goalBtn} onPress={() => setEditOpen(false)}>
              <Text style={styles.goalBtnText}>CANCEL</Text>
            </Pressable>
            <Pressable style={[styles.goalBtn, styles.goalBtnAccent]} onPress={() => void save()}>
              <Text style={[styles.goalBtnText, { color: Void.accentText }]}>SAVE</Text>
            </Pressable>
          </View>
        </View>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // QuickStart
  quickStartBtn: {
    backgroundColor: Void.accent,
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  quickStartText: {
    color: Void.accentText,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1,
  },

  // Rest timer
  restEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  restEmptyText: { color: Void.textTertiary, fontSize: 12 },
  restLabel: {
    color: Void.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  restTime: {
    color: Void.accent,
    fontSize: 32,
    fontWeight: '800',
    ...tabular,
    marginVertical: 2,
  },
  restBar: {
    height: 3,
    backgroundColor: Void.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginVertical: 8,
  },
  restBarFill: {
    height: '100%',
    backgroundColor: Void.accent,
  },
  restControls: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  restBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 8,
    paddingVertical: 7,
  },
  restBtnText: { color: Void.text, fontSize: 11, fontWeight: '600', ...tabular },
  restSkip: { backgroundColor: Void.accent, borderColor: Void.accent },
  restSkipText: {
    color: Void.accentText,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Cardio
  cardioBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cardioText: {
    color: Void.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Friends
  friendsBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  friendsCount: {
    color: Void.text,
    fontSize: 22,
    fontWeight: '900',
  },
  friendsText: {
    color: Void.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // Plate calculator
  plateTitle: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  plateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  plateInput: {
    flex: 1,
    color: Void.text,
    fontSize: 18,
    fontWeight: '700',
    ...tabular,
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  plateUnit: { color: Void.textSecondary, fontSize: 13, fontWeight: '600' },
  plateBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  plateBarLabel: { color: Void.textTertiary, fontSize: 11, ...tabular },
  plateSide: { color: Void.textTertiary, fontSize: 10 },
  plateChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  plateChip: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  plateChipText: { color: Void.accent, fontSize: 12, fontWeight: '600', ...tabular },
  plateEmpty: { color: Void.textTertiary, fontSize: 12 },
  plateApprox: { color: Void.warmup, fontSize: 14 },

  // Exercise quick add
  favEmpty: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  favEmptyText: {
    color: Void.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  favTitle: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  favScroll: { flex: 1 },
  favRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
    gap: 8,
  },
  favName: { color: Void.text, fontSize: 14, fontWeight: '600', flex: 1 },
  favHint: {
    color: Void.textTertiary,
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },

  // Last workout
  lastEmpty: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  lastEmptyText: { color: Void.textTertiary, fontSize: 13 },
  lastTitle: {
    color: Void.text,
    fontSize: 18,
    fontWeight: '700',
  },
  lastDate: {
    color: Void.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  lastStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
    backgroundColor: Void.border,
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 12,
  },
  lastStat: {
    width: '50%',
    backgroundColor: Void.surface,
    paddingVertical: 10,
    alignItems: 'center',
  },
  lastStatValue: { color: Void.text, fontSize: 16, fontWeight: '700', ...tabular },
  lastStatLabel: {
    color: Void.textTertiary,
    fontSize: 9,
    letterSpacing: 1,
    marginTop: 2,
  },
  lastFooter: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  lastPrPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Void.accentDim,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lastPrText: {
    color: Void.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  lastFeelPill: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lastFeelText: {
    color: Void.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Custom goal
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  goalLabel: { flex: 1, color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  goalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  goalText: { color: Void.text, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  goalEmpty: { color: Void.textTertiary, fontSize: 12 },
  goalSheet: { paddingHorizontal: 20, paddingBottom: 34, gap: 10 },
  goalInput: {
    color: Void.text, fontSize: 15, fontWeight: '600',
    backgroundColor: Void.surfaceRaised, borderWidth: 1, borderColor: Void.borderStrong,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
  },
  goalInputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  goalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  goalBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10,
    backgroundColor: Void.surfaceRaised, borderWidth: 1, borderColor: Void.borderStrong,
  },
  goalBtnAccent: { backgroundColor: Void.accent, borderColor: Void.accent },
  goalBtnText: { color: Void.text, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});
