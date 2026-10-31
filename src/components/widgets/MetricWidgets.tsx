/**
 * Self-contained metric widgets for the customizable Train tab.
 * Each widget is a fixed-size card that fetches its own data on screen focus
 * and navigates to a detail screen on tap.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import {
    Activity,
    Beef,
    Droplets,
    Dumbbell,
    Flame,
    HeartPulse,
    Moon,
    Scale,
    TrendingDown,
    TrendingUp,
    Trophy,
    Utensils,
    Zap
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { listCardio } from '@/db/repo/cardio';
import { liquidTargetMl, liquidTotalsForDay, logLiquid } from '@/db/repo/liquids';
import { listMeasurements } from '@/db/repo/measurements';
import { dayTotals, type DayTotals } from '@/db/repo/nutrition';
import { getProfile } from '@/db/repo/settings';
import { updateWidgetConfig } from '@/db/repo/widgets';
import { weekVolumeKg } from '@/db/repo/workouts';
import { ageFromBirthYear, bmr, calorieTarget, proteinTarget, tdee } from '@/lib/body';
import { distancePBs, distanceUnitFor, formatDistance } from '@/lib/cardio';
import { displayWeight, formatDate, formatRecord, formatVolume } from '@/lib/format';
import {
    liftProgress,
    recentPRs,
    recoveryStatus,
    setsByMuscle,
    strengthScore,
    weekHits,
    weekStreak,
    workoutDates,
    type LiftProgress,
    type MuscleSets,
    type RecentPR,
    type RecoveryResult,
} from '@/lib/insights';
import type { BodyMeasurement, CardioSession } from '@/lib/types';
import { useSettings } from '@/store/settings';
import { useWidgetStore } from '@/store/widgets';
import { tabular, Void } from '@/theme/tokens';

// ---------------------------------------------------------------------------
// Shared constants & helpers
// ---------------------------------------------------------------------------

const AMBER = '#FFB020';
const RED = '#FF4D4D';

const PR_LABEL: Record<string, string> = {
  '1rm': 'Est. 1RM',
  max_weight: 'Heaviest',
  max_volume: 'Most volume',
  max_reps: 'Most reps',
};

function pctChange(now: number, prior: number): number {
  return prior > 0 ? Math.round(((now - prior) / prior) * 100) : 0;
}

const styles = StyleSheet.create({
  card: {
    ...cardChrome,
    borderRadius: 12,
    padding: 14,
    flex: 1,
  },
  pressable: {
    flex: 1,
  },
  // Headers / labels
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: Void.textSecondary,
    textTransform: 'uppercase',
  },
  caption: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: Void.textTertiary,
    textTransform: 'uppercase',
  },
  quickAdd: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: Void.accent,
  },
  holdHint: { marginTop: 8, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: Void.textTertiary },
  cfgChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  cfgChip: { borderWidth: 1, borderColor: Void.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  cfgChipOn: { backgroundColor: Void.accent, borderColor: Void.accent },
  cfgChipText: { color: Void.textSecondary, fontSize: 12, fontWeight: '700' },
  cfgRow: { flexDirection: 'row', gap: 8 },
  cfgInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Void.text,
    fontSize: 14,
    backgroundColor: Void.canvas,
  },
  cfgSave: { backgroundColor: Void.accent, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  cfgSaveText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  // Big numbers
  bigNum: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: Void.text,
  },
  medNum: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: Void.text,
  },
  unit: {
    fontSize: 13,
    fontWeight: '500',
    color: Void.textSecondary,
  },
  bodyText: {
    fontSize: 13,
    fontWeight: '400',
    color: Void.textSecondary,
  },
  // Icon tile
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Void.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pill
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // Progress bar
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Void.border,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Void.accent,
  },
  // Dot grid
  dotRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // List rows
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  // Muscle bar
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  muscleName: {
    fontSize: 13,
    fontWeight: '500',
    color: Void.text,
    width: 72,
  },
  muscleTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Void.border,
    overflow: 'hidden',
  },
  muscleFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Void.accent,
  },
  muscleSets: {
    fontSize: 13,
    fontWeight: '600',
    color: Void.text,
  },
});

// ---------------------------------------------------------------------------
// 1. ReadinessWidget (2x1)
// ---------------------------------------------------------------------------

export function ReadinessWidget() {
  const router = useRouter();
  const [rec, setRec] = useState<RecoveryResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      void recoveryStatus().then(setRec);
    }, [])
  );

  const score = rec?.score ?? null;
  const color = score == null ? Void.textTertiary : score >= 55 ? Void.accent : score >= 35 ? AMBER : RED;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Zap color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Readiness</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, flex: 1 }}>
          <View>
            <Text style={[styles.bigNum, { color }]} {...tabular}>
              {score ?? '-'}
            </Text>
            <Text style={[styles.caption, { color, marginTop: 2 }]}>
              {(rec?.label ?? '-').toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            {(rec?.factors ?? []).slice(0, 2).map((f) => (
              <View key={f.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.bodyText}>{f.label}</Text>
                <Text style={[styles.bodyText, { color: Void.text }]}>{f.detail}</Text>
              </View>
            ))}
            {!rec && <Text style={styles.bodyText}>No data yet</Text>}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 2. StreakWidget (2x1)
// ---------------------------------------------------------------------------

export function StreakWidget() {
  const router = useRouter();
  const [streak, setStreak] = useState(0);
  const [hits, setHits] = useState<boolean[]>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const dates = await workoutDates(84);
        setStreak(weekStreak(dates));
        setHits(weekHits(dates, 12));
      })();
    }, [])
  );

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Flame color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Streak</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
          <View>
            <Text style={styles.bigNum} {...tabular}>
              {streak}
            </Text>
            <Text style={styles.caption}>WEEK STREAK</Text>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.dotRow}>
              {hits.map((hit, i) => (
                <View
                  key={i}
                  style={[styles.dot, { backgroundColor: hit ? Void.accent : Void.border }]}
                />
              ))}
            </View>
            <Text style={styles.bodyText}>12-week consistency</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 3. StrengthScoreWidget (2x1)
// ---------------------------------------------------------------------------

export function StrengthScoreWidget() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const [score, setScore] = useState<{ now: number; prior: number; relative: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void strengthScore().then(setScore);
    }, [])
  );

  const delta = score ? pctChange(score.now, score.prior) : 0;
  const hasData = score != null && score.now > 0;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Dumbbell color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Strength Score</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, flex: 1 }}>
          <Text style={styles.bigNum} {...tabular}>
            {hasData ? (score!.relative ? score!.now : formatVolume(score!.now, unit)) : '-'}
          </Text>
          <Text style={[styles.unit, { marginBottom: 4 }]}>{score?.relative ? 'pts' : unit}</Text>
          {hasData && score!.prior > 0 && (
            <View
              style={[
                styles.pill,
                { backgroundColor: delta >= 0 ? `${Void.accent}22` : `${RED}22`, marginLeft: 6, marginBottom: 4 },
              ]}>
              {delta >= 0 ? (
                <TrendingUp color={delta >= 0 ? Void.accent : RED} size={11} />
              ) : (
                <TrendingDown color={RED} size={11} />
              )}
              <Text style={[styles.pillText, { color: delta >= 0 ? Void.accent : RED }]}>
                {delta >= 0 ? '+' : ''}
                {delta}%
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.bodyText}>
          {score?.relative ? 'Top-5 lifts vs bodyweight' : 'Top-5 combined est. 1RM'} · 30d delta
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 4. TodayCaloriesWidget (1x1)
// ---------------------------------------------------------------------------

export function TodayCaloriesWidget() {
  const router = useRouter();
  const settings = useSettings();
  const [totals, setTotals] = useState<DayTotals | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [t, w] = await Promise.all([dayTotals(), listMeasurements('weight')]);
        setTotals(t);
        setWeightKg(w[0]?.value ?? null);
      })();
    }, [])
  );

  const age = ageFromBirthYear(settings.birth_year);
  const bmrV =
    weightKg != null && settings.height_cm != null && age != null && settings.sex != null
      ? bmr(weightKg, settings.height_cm, age, settings.sex)
      : null;
  const tdeeV = bmrV != null ? tdee(bmrV, settings.activity_level) : null;
  const target = settings.calorie_override ?? (tdeeV != null ? calorieTarget(tdeeV, settings.goal) : null);

  const eaten = totals?.calories ?? 0;
  const pct = target != null && target > 0 ? Math.min(100, (eaten / target) * 100) : 0;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/meals')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Utensils color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Calories</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {Math.round(eaten)}
        </Text>
        <Text style={styles.bodyText}>
          {target != null ? `/ ${target} kcal` : 'kcal today'}
        </Text>
        {target != null && <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 5. TodayProteinWidget (1x1)
// ---------------------------------------------------------------------------

export function TodayProteinWidget() {
  const router = useRouter();
  const settings = useSettings();
  const [totals, setTotals] = useState<DayTotals | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [t, w] = await Promise.all([dayTotals(), listMeasurements('weight')]);
        setTotals(t);
        setWeightKg(w[0]?.value ?? null);
      })();
    }, [])
  );

  const target = weightKg != null ? proteinTarget(weightKg, settings.goal) : null;
  const eaten = Math.round(totals?.protein_g ?? 0);
  const pct = target != null && target > 0 ? Math.min(100, (eaten / target) * 100) : 0;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/meals')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Beef color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Protein</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {eaten}
        </Text>
        <Text style={styles.bodyText}>
          {target != null ? `/ ${target}g` : 'g today'}
        </Text>
        {target != null && <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 6. BodyWeightWidget (1x1)
// ---------------------------------------------------------------------------

export function BodyWeightWidget() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const [weights, setWeights] = useState<BodyMeasurement[]>([]);

  useFocusEffect(
    useCallback(() => {
      void listMeasurements('weight').then(setWeights);
    }, [])
  );

  const latest = weights[0]?.value ?? null;
  const monthAgo = weights.find((w) => Date.now() - new Date(w.logged_at).getTime() >= 28 * 86400000);
  const delta = latest != null && monthAgo ? latest - monthAgo.value : null;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/body')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Scale color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Weight</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {latest != null ? displayWeight(latest, unit) : '-'}
        </Text>
        <Text style={styles.bodyText}>
          {unit}
          {delta != null
            ? `  ·  ${delta >= 0 ? '+' : ''}${displayWeight(delta, unit)} 4w`
            : ''}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 7. RestingHrWidget (1x1)
// ---------------------------------------------------------------------------

export function RestingHrWidget() {
  const router = useRouter();
  const [rows, setRows] = useState<BodyMeasurement[]>([]);

  useFocusEffect(
    useCallback(() => {
      void listMeasurements('resting_hr').then(setRows);
    }, [])
  );

  const latest = rows[0]?.value ?? null;
  const prior = rows[1]?.value ?? null;
  const delta = latest != null && prior != null ? latest - prior : null;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/cardio')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <HeartPulse color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Resting HR</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {latest != null ? Math.round(latest) : '-'}
        </Text>
        <Text style={styles.bodyText}>
          bpm
          {delta != null ? `  ·  ${delta >= 0 ? '+' : ''}${Math.round(delta)}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 8. SleepWidget (1x1)
// ---------------------------------------------------------------------------

export function SleepWidget() {
  const router = useRouter();
  const [rows, setRows] = useState<BodyMeasurement[]>([]);

  useFocusEffect(
    useCallback(() => {
      void listMeasurements('sleep_hours').then(setRows);
    }, [])
  );

  const latest = rows[0]?.value ?? null;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/cardio')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Moon color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Sleep</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {latest != null ? trimSleep(latest) : '-'}
        </Text>
        <Text style={styles.bodyText}>hours last night</Text>
      </View>
    </Pressable>
  );
}

function trimSleep(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

// ---------------------------------------------------------------------------
// 8b. HydrationWidget (1x1) - tap = +250ml quick log
// ---------------------------------------------------------------------------

export function HydrationWidget({ id, config }: { id?: string; config?: Record<string, unknown> }) {
  const [ml, setMl] = useState<number>(0);
  const [target, setTarget] = useState<number>(2000);
  const [justLogged, setJustLogged] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftMl, setDraftMl] = useState('');
  const stepMl = Number(config?.stepMl) > 0 ? Number(config?.stepMl) : 250;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
    const [t, w, p] = await Promise.all([liquidTotalsForDay(), listMeasurements('weight'), getProfile()]);
    setMl(t.amount_ml);
    setTarget(liquidTargetMl(w[0]?.value ?? null, p.water_target_ml));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const pct = target > 0 ? Math.min(100, (ml / target) * 100) : 0;
  const litres = ml >= 1000 ? `${(ml / 1000).toFixed(1)}` : `${Math.round(ml)}`;
  const fmtMl = (v: number) => (v >= 1000 && v % 1000 === 0 ? `${v / 1000}L` : `${v}`);

  const saveStep = async (v: number) => {
    if (!id || !Number.isFinite(v) || v <= 0) return;
    const newConfig = { ...(config ?? {}), stepMl: v };
    await updateWidgetConfig(id, newConfig);
    useWidgetStore.setState({
      widgets: useWidgetStore.getState().widgets.map((w) => (w.id === id ? { ...w, config: newConfig } : w)),
    });
    setConfigOpen(false);
  };

  return (
    <Pressable
      style={styles.pressable}
      delayLongPress={400}
      onLongPress={() => { setDraftMl(String(stepMl)); setConfigOpen(true); }}
      onPress={() => {
        void logLiquid({ amount_ml: stepMl }).then(() => {
          setMl((v) => v + stepMl);
          setJustLogged(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setJustLogged(false), 900);
        });
      }}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Droplets color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Water</Text>
          <Text style={styles.quickAdd}>{justLogged ? '✓' : `+${fmtMl(stepMl)}`}</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {litres}
        </Text>
        <Text style={styles.bodyText}>
          {ml >= 1000 ? `L / ${(target / 1000).toFixed(1)}L` : `ml / ${target}ml`}
        </Text>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
        <Text style={styles.holdHint}>hold to set amount</Text>
      </View>

      <Sheet visible={configOpen} onClose={() => setConfigOpen(false)} title="QUICK-ADD AMOUNT">
            <View style={styles.cfgChips}>
              {[150, 250, 330, 500, 750, 1000].map((v) => (
                <Pressable key={v} style={[styles.cfgChip, v === stepMl && styles.cfgChipOn]} onPress={() => void saveStep(v)}>
                  <Text style={[styles.cfgChipText, v === stepMl && { color: Void.accentText }]}>{fmtMl(v)}{v < 1000 ? 'ml' : ''}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.cfgRow}>
              <TextInput
                style={styles.cfgInput}
                value={draftMl}
                onChangeText={setDraftMl}
                keyboardType="number-pad"
                placeholder="Custom ml"
                placeholderTextColor={Void.textTertiary}
              />
              <Pressable style={styles.cfgSave} onPress={() => void saveStep(parseInt(draftMl, 10))}>
                <Text style={styles.cfgSaveText}>SET</Text>
              </Pressable>
            </View>
      </Sheet>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 9. WeekVolumeWidget (1x1)
// ---------------------------------------------------------------------------

export function WeekVolumeWidget() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const [vol, setVol] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void weekVolumeKg().then((v) => setVol(v));
    }, [])
  );

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Dumbbell color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Volume</Text>
        </View>
        <Text style={styles.bigNum} {...tabular}>
          {vol != null && vol > 0 ? formatVolume(vol, unit) : '-'}
        </Text>
        <Text style={styles.bodyText}>{unit} this week</Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 10. LastPrWidget (1x1)
// ---------------------------------------------------------------------------

export function LastPrWidget() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const [prs, setPrs] = useState<RecentPR[]>([]);

  useFocusEffect(
    useCallback(() => {
      void recentPRs(30, 8).then(setPrs);
    }, [])
  );

  const pr = prs[0];

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Trophy color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Last PR</Text>
        </View>
        {pr ? (
          <>
            <Text style={[styles.medNum, { fontSize: 16 }]} numberOfLines={1}>
              {pr.name}
            </Text>
            <Text style={[styles.bodyText, { color: Void.text }]} {...tabular}>
              {formatRecord(pr.recordType, pr.value, unit)}
            </Text>
            <Text style={styles.bodyText}>
              {PR_LABEL[pr.recordType] ?? pr.recordType} · {formatDate(pr.achievedAt)}
            </Text>
          </>
        ) : (
          <Text style={styles.bodyText}>No PRs yet</Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 11. RecentPrsWidget (1x2)
// ---------------------------------------------------------------------------

export function RecentPrsWidget() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const [prs, setPrs] = useState<RecentPR[]>([]);

  useFocusEffect(
    useCallback(() => {
      void recentPRs(30, 8).then(setPrs);
    }, [])
  );

  const list = prs.slice(0, 5);

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Trophy color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Recent PRs</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {list.length > 0 ? (
            list.map((pr) => (
              <Pressable
                key={pr.id}
                style={styles.listRow}
                onPress={() => router.push(`/exercise/${pr.exercise_id}`)}>
                <Trophy color={Void.accent} size={14} />
                <Text style={{ flex: 1, fontSize: 13, fontWeight: '500', color: Void.text }} numberOfLines={1}>
                  {pr.name}
                </Text>
                <Text style={[styles.bodyText, { color: Void.text }]} {...tabular}>
                  {formatRecord(pr.recordType, pr.value, unit)}
                </Text>
                <Text style={[styles.caption, { width: 44, textAlign: 'right' }]}>
                  {formatDate(pr.achievedAt)}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.bodyText}>No PRs yet</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 12. HardSetsWidget (2x1)
// ---------------------------------------------------------------------------

export function HardSetsWidget() {
  const router = useRouter();
  const [muscles, setMuscles] = useState<MuscleSets[]>([]);

  useFocusEffect(
    useCallback(() => {
      void setsByMuscle(7).then(setMuscles);
    }, [])
  );

  const top = muscles.slice(0, 4);
  const maxSets = top[0]?.sets ?? 1;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Dumbbell color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Hard Sets · This Week</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {top.length > 0 ? (
            top.map((m) => (
              <View key={m.muscle} style={styles.muscleRow}>
                <Text style={styles.muscleName} numberOfLines={1}>{m.muscle}</Text>
                <View style={styles.muscleTrack}>
                  <View
                    style={[
                      styles.muscleFill,
                      { width: `${Math.min(100, (m.sets / maxSets) * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.muscleSets} {...tabular}>{m.sets}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.bodyText}>No sets this week</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 13. TopLiftsWidget (2x1)
// ---------------------------------------------------------------------------

export function TopLiftsWidget() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const [lifts, setLifts] = useState<LiftProgress[]>([]);

  useFocusEffect(
    useCallback(() => {
      void liftProgress(6).then(setLifts);
    }, [])
  );

  const top = lifts.slice(0, 2);

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/(tabs)/analytics')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Dumbbell color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Top Lifts</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 8 }}>
          {top.length > 0 ? (
            top.map((l) => {
              const delta = l.prior > 0 ? pctChange(l.recent, l.prior) : 0;
              const showDelta = l.recent > 0 && l.prior > 0;
              return (
                <View key={l.exerciseId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: Void.text }} numberOfLines={1}>
                    {l.name}
                  </Text>
                  <Text style={[styles.bodyText, { color: Void.text }]} {...tabular}>
                    {formatVolume(l.recent || l.best, unit)}
                  </Text>
                  {showDelta && (
                    <View
                      style={[
                        styles.pill,
                        { backgroundColor: delta >= 0 ? `${Void.accent}22` : `${RED}22` },
                      ]}>
                      <Text style={[styles.pillText, { color: delta >= 0 ? Void.accent : RED }]}>
                        {delta >= 0 ? '+' : ''}
                        {delta}%
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          ) : (
            <Text style={styles.bodyText}>No lifts yet</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 14. CardioWeeklyWidget (2x1)
// ---------------------------------------------------------------------------

export function CardioWeeklyWidget() {
  const router = useRouter();
  const dist = distanceUnitFor(useSettings((s) => s.weight_unit));
  const [sessions, setSessions] = useState<CardioSession[]>([]);

  useFocusEffect(
    useCallback(() => {
      void listCardio(50).then(setSessions);
    }, [])
  );

  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = monday.getTime();

  const weekSessions = sessions.filter((s) => new Date(s.started_at).getTime() >= weekStart);
  const weekDistance = weekSessions.reduce((a, s) => a + (s.distance_m ?? 0), 0);
  const pbCount = distancePBs(sessions).length;

  return (
    <Pressable style={styles.pressable} onPress={() => router.push('/cardio')}>
      <View style={styles.card}>
        <CardSheen />
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Activity color={Void.accent} size={15} />
          </View>
          <Text style={styles.headerLabel}>Cardio · This Week</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 20, flex: 1, alignItems: 'center' }}>
          <View>
            <Text style={styles.medNum} {...tabular}>
              {weekDistance > 0 ? formatDistance(weekDistance, dist) : '-'}
            </Text>
            <Text style={styles.caption}>DISTANCE</Text>
          </View>
          <View>
            <Text style={styles.medNum} {...tabular}>
              {weekSessions.length}
            </Text>
            <Text style={styles.caption}>SESSIONS</Text>
          </View>
          <View>
            <Text style={styles.medNum} {...tabular}>
              {pbCount}
            </Text>
            <Text style={styles.caption}>ALL-TIME PBs</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
