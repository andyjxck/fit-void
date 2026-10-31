import { useFocusEffect, useRouter } from 'expo-router';
import { Play } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { consistencyDaysThisWeek, primaryConsistencyIntent } from '@/db/repo/consistency';
import { logLiquid } from '@/db/repo/liquids';
import { localDay } from '@/db/repo/nutrition';
import {
    getFolderAssignments,
    listRoutinesWithPreview,
    type RoutineWithPreview
} from '@/db/repo/routines';
import { volumeByDay, workoutsThisWeek } from '@/db/repo/workouts';
import type { Intent } from '@/lib/intents';
import { openRoutineWorkout } from '@/lib/startRoutine';
import type { WidgetSize } from '@/lib/widgetTypes';
import { useActiveWorkout } from '@/store/activeWorkout';
import { useFolderStore } from '@/store/folders';
import { tabular, Void } from '@/theme/tokens';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const surface = {
  ...cardChrome,
  borderRadius: 12,
  padding: 14,
  flex: 1,
};

// ─── Weekly Consistency (includes Quick Start button) ────────────────────────

const FOCUS_ACTION: Partial<Record<Intent, { label: string; href: string }>> = {
  nutrition: { label: 'LOG A MEAL', href: '/meals' },
  cardio: { label: 'LOG CARDIO', href: '/cardio/new' },
  body_comp: { label: 'LOG WEIGHT', href: '/body' },
  recovery: { label: 'OPEN BODY', href: '/body' },
  progress: { label: 'OPEN ANALYTICS', href: '/analytics' },
  social: { label: 'OPEN FEED', href: '/social' },
  // hydration logs in-place (no screen actually owns a standalone "log a
  // drink" flow - the real one lives inside this same tap, like the
  // dedicated Hydration widget does).
};

export function WeeklyConsistencyWidget({ size, activeIntents }: { size: WidgetSize; activeIntents?: Intent[] }) {
  const router = useRouter();
  const live = useActiveWorkout((s) => s.workoutId !== null);
  const startWorkout = useActiveWorkout((s) => s.startWorkout);
  const [weekCount, setWeekCount] = useState(0);
  const [weekDays, setWeekDays] = useState<Set<number>>(new Set());
  const [dayLabel, setDayLabel] = useState('sessions this week');
  const [fourWeek, setFourWeek] = useState<number[][]>([[], [], [], []]);
  const [busy, setBusy] = useState(false);

  const focus = primaryConsistencyIntent(activeIntents ?? []);
  // LIFT always wins the main CTA when active alongside other focuses -
  // whatever else is going on, the button should still start a workout.
  const hasLift = (activeIntents ?? []).includes('lift');
  const action = !hasLift && focus ? FOCUS_ACTION[focus] : null;
  const [justLogged, setJustLogged] = useState(false);

  const load = useCallback(async () => {
    const { days, label } = await consistencyDaysThisWeek(focus);
    setWeekDays(days);
    setDayLabel(label);
    setWeekCount(focus ? days.size : await workoutsThisWeek());
    if (size === '2x2' && !focus) {
      const map = await volumeByDay(28);
      const weeks: number[][] = [[], [], [], []];
      const today = new Date();
      const mondayOffset = (today.getDay() + 6) % 7;
      const startOfThisWeek = new Date(today);
      startOfThisWeek.setDate(today.getDate() - mondayOffset);
      for (let w = 3; w >= 0; w--) {
        for (let d = 0; d < 7; d++) {
          const day = new Date(startOfThisWeek);
          day.setDate(startOfThisWeek.getDate() - w * 7 + d);
          // Local-day key - toISOString() would shift non-UTC users off by one.
          const key = localDay(day);
          weeks[3 - w].push(map[key] ? 1 : 0);
        }
      }
      setFourWeek(weeks);
    }
  }, [size, focus]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const todayIdx = (new Date().getDay() + 6) % 7;

  const startBtn = !hasLift && focus === 'hydration' ? (
    <Pressable
      style={({ pressed }) => [s.quickStart, pressed && { opacity: 0.85 }]}
      onPress={() => {
        void logLiquid({ amount_ml: 250 }).then(() => {
          setJustLogged(true);
          setTimeout(() => setJustLogged(false), 900);
          void load();
        });
      }}>
      <Play color={Void.accentText} size={16} fill={Void.accentText} />
      <Text style={s.quickStartText}>{justLogged ? 'LOGGED +250ML' : 'LOG A DRINK (+250ML)'}</Text>
    </Pressable>
  ) : action ? (
    <Pressable style={({ pressed }) => [s.quickStart, pressed && { opacity: 0.85 }]} onPress={() => router.push(action.href as never)}>
      <Play color={Void.accentText} size={16} fill={Void.accentText} />
      <Text style={s.quickStartText}>{action.label}</Text>
    </Pressable>
  ) : (
    <Pressable
      style={({ pressed }) => [s.quickStart, pressed && { opacity: 0.85 }]}
      disabled={busy}
      onPress={() => {
        if (live) { router.push('/workout/active'); return; }
        if (busy) return;
        setBusy(true);
        void startWorkout({})
          .then(() => router.push('/workout/active'))
          .finally(() => setBusy(false));
      }}>
      <Play color={Void.accentText} size={16} fill={Void.accentText} />
      <Text style={s.quickStartText}>
        {live ? 'RESUME WORKOUT' : 'START EMPTY WORKOUT'}
      </Text>
    </Pressable>
  );

  if (size === '2x2' && !focus) {
    return (
      <View style={surface}>
        <CardSheen />
        <Text style={s.label}>4 WEEKS</Text>
        <View style={{ gap: 6, marginTop: 10 }}>
          {fourWeek.map((week, wi) => (
            <View key={wi} style={s.weekRow}>
              {week.map((hit, di) => {
                const isToday = wi === 3 && di === todayIdx;
                return (
                  <View key={di} style={[s.dayCell, isToday && s.dayCellToday]}>
                    <Text style={[s.dayLetter, isToday && s.dayLetterToday]}>{DAYS[di]}</Text>
                    <View style={[s.dot, hit ? s.dotTrained : null]} />
                  </View>
                );
              })}
              <Text style={s.weekTotal}>{week.reduce((a, b) => a + b, 0)}</Text>
            </View>
          ))}
        </View>
        <Text style={s.weekCount}>
          {weekCount} session{weekCount === 1 ? '' : 's'} this week
        </Text>
        {startBtn}
      </View>
    );
  }

  return (
    <View style={surface}>
      <CardSheen />
      <View style={s.weekRow}>
        {DAYS.map((d, i) => {
          const isToday = i === todayIdx;
          return (
            <View key={i} style={[s.dayCell, isToday && s.dayCellToday]}>
              <Text style={[s.dayLetter, isToday && s.dayLetterToday]}>{d}</Text>
              <View style={[s.dot, weekDays.has(i) ? s.dotTrained : null]} />
            </View>
          );
        })}
      </View>
      <Text style={s.weekCount}>
        {weekCount} {dayLabel}
      </Text>
      {startBtn}
    </View>
  );
}

// ─── Single Routine Widget (one tile per routine) ───────────────────────────

export function RoutineWidget({ size, config, onLongPress }: { size: WidgetSize; config: Record<string, unknown>; onLongPress?: (routineId: string) => void }) {
  const router = useRouter();
  const [routine, setRoutine] = useState<RoutineWithPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const routineId = config.routineId as string;

  useFocusEffect(
    useCallback(() => {
      if (!routineId) return;
      void listRoutinesWithPreview().then((all) =>
        setRoutine(all.find((r) => r.id === routineId) ?? null)
      );
    }, [routineId])
  );

  const start = useCallback(async () => {
    if (!routine || busy) return;
    setBusy(true);
    try {
      await openRoutineWorkout(router, routine);
    } finally {
      setBusy(false);
    }
  }, [routine, busy, router]);

  if (!routine) {
    return <View style={surface}><CardSheen /><Text style={s.empty}>Routine removed</Text></View>;
  }

  const names = (routine.exercise_names || '').split(' · ').filter(Boolean);
  const nameLimit = size === '1x1' ? 3 : size === '2x2' ? 8 : 5;
  const isExample = routine.folder_name.startsWith('Examples ·');
  const category = isExample ? routine.folder_name.replace('Examples · ', '') : 'ROUTINE';

  return (
    <Pressable
      style={({ pressed }) => [surface, pressed && { opacity: 0.9 }]}
      disabled={busy}
      onPress={() => void start()}
      onLongPress={() => routine && onLongPress?.(routine.id)}>
      <CardSheen />
      <Text style={s.cat}>{category.toUpperCase()}</Text>
      <Text style={s.routineName} numberOfLines={size === '1x1' ? 1 : 2}>{routine.title}</Text>
      {names.length > 0 ? (
        <Text style={s.routineEx} numberOfLines={size === '2x2' ? 4 : size === '1x1' ? 2 : 3}>
          {names.slice(0, nameLimit).join(' · ')}
          {names.length > nameLimit ? ` +${names.length - nameLimit}` : ''}
        </Text>
      ) : (
        <Text style={s.routineEx}>No exercises yet</Text>
      )}
      {size !== '1x1' && (
        <Text style={s.exCount}>{routine.exercise_count} exercise{routine.exercise_count === 1 ? '' : 's'}</Text>
      )}
      <View style={s.playRow}>
        <View style={s.playBtn}>
          <Play size={12} color={Void.accent} />
        </View>
        <Text style={s.playLabel}>START</Text>
      </View>
    </Pressable>
  );
}

// ─── Single Folder Widget (one tile per folder) ─────────────────────────────

export function FolderWidget({ size, config }: { size: WidgetSize; config: Record<string, unknown> }) {
  const router = useRouter();
  const folderName = config.folderName as string;
  const [routines, setRoutines] = useState<RoutineWithPreview[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const folderVersion = useFolderStore((s) => s.version);

  const load = useCallback(async () => {
    if (!folderName) return;
    const [all, a] = await Promise.all([listRoutinesWithPreview(), getFolderAssignments()]);
    setRoutines(all.filter((r) => (a[r.id] || []).includes(folderName)));
  }, [folderName]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    void load();
  }, [folderVersion, load]);

  const start = useCallback(async (r: RoutineWithPreview) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    // The Sheet is an RN Modal: let its dismiss animation finish before
    // pushing the workout screen (a fullScreenModal). Pushing mid-dismiss
    // leaves the pushed VC attached to the dying modal - it survives until
    // finish, then router.back() has nothing to dismiss = black screen.
    await new Promise((res) => setTimeout(res, 350));
    try {
      await openRoutineWorkout(router, r);
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  if (!folderName) {
    return <View style={surface}><CardSheen /><Text style={s.empty}>Folder removed</Text></View>;
  }

  const nameLimit = size === '1x1' ? 3 : size === '2x2' ? 8 : 5;

  return (
    <>
      <Pressable
        style={({ pressed }) => [surface, pressed && { opacity: 0.9 }]}
        onPress={() => setOpen(true)}>
        <CardSheen />
        <Text style={s.cat}>FOLDER</Text>
        <Text style={s.routineName} numberOfLines={size === '1x1' ? 1 : 2}>{folderName}</Text>
        {routines.length > 0 ? (
          <Text style={s.routineEx} numberOfLines={size === '2x2' ? 4 : size === '1x1' ? 2 : 3}>
            {routines.slice(0, nameLimit).map((r) => r.title).join(' · ')}
            {routines.length > nameLimit ? ` +${routines.length - nameLimit}` : ''}
          </Text>
        ) : (
          <Text style={s.routineEx}>Empty folder</Text>
        )}
        {size !== '1x1' && (
          <Text style={s.exCount}>{routines.length} routine{routines.length === 1 ? '' : 's'}</Text>
        )}
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={folderName.toUpperCase()}>
            <ScrollView style={{ maxHeight: 300 }}>
              {routines.map((r) => (
                <View key={r.id} style={s.folderRoutineRow}>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => {
                      setOpen(false);
                      // Sheet is a Modal - wait out its dismiss before pushing.
                      setTimeout(() => router.push(`/routine/${r.id}`), 350);
                    }}>
                    <Text style={s.routineName}>
                      {r.title}
                      {r.is_shared === 1 ? '  ·SHARED' : ''}
                    </Text>
                    <Text style={s.routineEx} numberOfLines={1}>{r.exercise_names || 'No exercises'}</Text>
                  </Pressable>
                  <Pressable style={s.playBtn} onPress={() => void start(r)} disabled={busy} hitSlop={6}>
                    <Play size={12} color={Void.accent} />
                  </Pressable>
                </View>
              ))}
              {routines.length === 0 && <Text style={s.empty}>No routines in this folder</Text>}
            </ScrollView>
      </Sheet>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  label: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  cat: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: Void.surfaceRaised,
  },
  dayCellToday: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Void.borderStrong },
  dotTrained: { backgroundColor: Void.accent },
  dayLetter: { color: Void.textTertiary, fontSize: 9, ...tabular },
  dayLetterToday: { color: Void.accent },
  weekTotal: { color: Void.textSecondary, fontSize: 10, fontWeight: '700', marginLeft: 6, ...tabular },
  weekCount: { color: Void.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 8 },
  quickStart: {
    backgroundColor: Void.accent,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  quickStartText: { color: Void.accentText, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  routineName: { color: Void.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
  routineEx: { color: Void.textTertiary, fontSize: 11, marginTop: 4 },
  exCount: { color: Void.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 6, ...tabular },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 8 },
  playBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playLabel: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  empty: { color: Void.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  folderRoutineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
});
