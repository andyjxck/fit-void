import { useFocusEffect, useRouter } from 'expo-router';
import {
    AlertTriangle,
    CircleUser,
    Droplet,
    Dumbbell,
    Flame,
    HeartPulse,
    Info,
    Lock,
    Scale,
    TrendingDown,
    TrendingUp,
    Trophy,
    Utensils
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BodyHeatmap } from '@/components/BodyHeatmap';
import { HydrationCard } from '@/components/meals/HydrationCard';
import { Card, cardChrome, CardSheen, FocusToggle, Screen, ScreenHeader, SectionLabel } from '@/components/ui';
import { listCardio } from '@/db/repo/cardio';
import { liquidHistory, liquidTargetMl } from '@/db/repo/liquids';
import { listMeals, listPlans } from '@/db/repo/meals';
import { listMeasurements } from '@/db/repo/measurements';
import { calorieHistory, dayTotals, weekCalories, type DayTotals } from '@/db/repo/nutrition';
import { weekVolumeKg, workoutsThisWeek } from '@/db/repo/workouts';
import {
    ACTIVITY,
    ageFromBirthYear,
    bmi,
    bmiCategory,
    bmr,
    calorieTarget,
    proteinTarget,
    tdee
} from '@/lib/body';
import { ACTIVITY_META, distancePBs, distanceUnitFor, formatCardioDuration, formatDistance, formatPace, paceMinPerKm } from '@/lib/cardio';
import { useVoidPro } from '@/lib/entitlements';
import { displayWeight, formatDate, formatRecord, formatVolume } from '@/lib/format';
import { getDailyActivity, getHealthToday, type HealthDay, type HealthToday } from '@/lib/health';
import {
    buildInsights,
    categorySplit,
    lifetime,
    liftProgress,
    neglectedMuscles,
    recentPRs,
    recoveryStatus,
    setsByMuscle,
    strengthScore,
    tonnageComparison,
    weekHits,
    weekStreak,
    workoutDates,
    type Insight,
    type Lifetime,
    type LiftProgress,
    type MuscleCategory,
    type MuscleSets,
    type RecentPR,
    type RecoveryResult,
} from '@/lib/insights';
import { isEverything, isTabMuted, parseIntents, type Intent } from '@/lib/intents';
import { subscribeToFriendStats, upsertPublicStats, type FriendStats } from '@/lib/social';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

const AMBER = '#FFB800';
const RED = '#FF5C5C';
const CYAN = '#7DD3FC';
const FAT_C = '#FFB800';
const CARB_C = '#7DD3FC';

const PR_LABEL: Record<string, string> = {
  '1rm': 'Est. 1RM',
  max_weight: 'Heaviest',
  max_volume: 'Most volume',
  max_hold_seconds: 'Longest hold',
  max_distance: 'Farthest',
};

function pctChange(now: number, prior: number) {
  return prior > 0 ? Math.round(((now - prior) / prior) * 100) : 0;
}

// -- Sub-components --------------------------------------------------------

/** Value+label cell for stat grids - value never wraps, shrinks to fit. */
function StatCell({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.todayCell}>
      <Text style={styles.todayVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {value}
      </Text>
      <Text style={styles.todayLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const color = insight.tone === 'win' ? Void.accent : insight.tone === 'warn' ? AMBER : Void.textSecondary;
  const Icon = insight.tone === 'win' ? TrendingUp : insight.tone === 'warn' ? AlertTriangle : Info;
  return (
    <View style={styles.insight}>
      <CardSheen />
      <View style={[styles.insightIcon, { backgroundColor: `${color}22` }]}>
        <Icon color={color} size={16} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.insightTitle}>{insight.title}</Text>
        <Text style={styles.insightBody}>{insight.body}</Text>
      </View>
    </View>
  );
}

/**
 * Free tier sees the top insight in each section; the rest sit ghosted under
 * a dark scrim (unreadable but visibly "there") behind a Pro lock. Everything
 * else on the tab is ungated.
 */
function GatedInsights({ insights }: { insights: Insight[] }) {
  const pro = useVoidPro();
  const router = useRouter();
  if (pro || insights.length <= 1) {
    return <>{insights.map((i) => <InsightCard key={i.id} insight={i} />)}</>;
  }
  const [first, ...rest] = insights;
  return (
    <>
      <InsightCard insight={first} />
      <Pressable onPress={() => router.push('/paywall')}>
        <View style={{ opacity: 0.12, gap: 8 }} pointerEvents="none">
          {rest.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </View>
        <View style={styles.insightLock}>
          <View style={styles.insightLockPill}>
            <Lock color={Void.accent} size={13} />
            <Text style={styles.insightLockText}>
              +{rest.length} INSIGHT{rest.length === 1 ? '' : 'S'} - VOID PRO
            </Text>
          </View>
        </View>
      </Pressable>
    </>
  );
}

function SplitBar({ split }: { split: Record<MuscleCategory, number> }) {
  const total = Object.values(split).reduce((a, b) => a + b, 0) || 1;
  const segs: { key: MuscleCategory; color: string }[] = [
    { key: 'Push', color: Void.accent },
    { key: 'Pull', color: CYAN },
    { key: 'Legs', color: AMBER },
    { key: 'Core', color: Void.textTertiary },
  ];
  return (
    <View>
      <View style={styles.splitBar}>
        {segs.map((s) =>
          split[s.key] > 0 ? (
            <View key={s.key} style={{ flex: split[s.key], backgroundColor: s.color }} />
          ) : null
        )}
      </View>
      <View style={styles.splitLegend}>
        {segs.map((s) => (
          <View key={s.key} style={styles.splitItem}>
            <View style={[styles.splitDot, { backgroundColor: s.color }]} />
            <Text style={styles.splitLabel}>{s.key}</Text>
            <Text style={styles.splitPct}>{Math.round((split[s.key] / total) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MuscleVolumeRow({ m }: { m: MuscleSets }) {
  const zone = m.sets < 10 ? 'low' : m.sets <= 20 ? 'good' : 'high';
  const color = zone === 'good' ? Void.accent : zone === 'high' ? AMBER : Void.textTertiary;
  const width = Math.min(100, (m.sets / 24) * 100);
  return (
    <View style={styles.volRow}>
      <Text style={styles.volMuscle}>{m.muscle}</Text>
      <View style={styles.volTrack}>
        <View style={[styles.volZone, { left: `${(10 / 24) * 100}%`, width: `${(10 / 24) * 100}%` }]} />
        <View style={[styles.volFill, { width: `${width}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.volSets, { color }]}>{m.sets}</Text>
    </View>
  );
}

function MacroBar({ p, c, f }: { p: number; c: number; f: number }) {
  const total = p * 4 + c * 4 + f * 9;
  if (total === 0) return null;
  const pp = (p * 4) / total;
  const cp = (c * 4) / total;
  const fp = (f * 9) / total;
  return (
    <View style={styles.macroBar}>
      <View style={[styles.macroSeg, { flex: pp, backgroundColor: Void.accent }]} />
      <View style={[styles.macroSeg, { flex: cp, backgroundColor: CARB_C }]} />
      <View style={[styles.macroSeg, { flex: fp, backgroundColor: FAT_C }]} />
    </View>
  );
}

/** Readiness/recovery score card - shown on both the Today and Recovery tabs. */
function RecoveryCard({ recovery }: { recovery: RecoveryResult }) {
  return (
    <Card>
      <View style={styles.recoveryTop}>
        <View>
          <Text
            style={[
              styles.recoveryScore,
              { color: recovery.score >= 55 ? Void.accent : recovery.score >= 35 ? AMBER : RED },
            ]}>
            {recovery.score}
          </Text>
          <Text style={styles.recoveryLabel}>{recovery.label.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 16 }}>
          {recovery.factors.map((f) => (
            <View key={f.label} style={styles.recoveryRow}>
              <Text style={styles.recoveryFactor}>{f.label}</Text>
              <Text
                style={[
                  styles.recoveryDetail,
                  { color: f.tone === 'win' ? Void.text : f.tone === 'warn' ? AMBER : Void.textTertiary },
                ]}
                numberOfLines={1}>
                {f.detail}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={styles.recoveryHint}>
        Sleep, resting HR and cardio on the Cardio screen sharpen this score.
      </Text>
    </Card>
  );
}

function HydrationChart({ history, target }: { history: { day: string; amount_ml: number }[]; target: number }) {
  const max = Math.max(target, ...history.map((h) => h.amount_ml), 1);
  const fmt = (ml: number) => ml >= 1000 ? `${(ml / 1000).toFixed(1)}L` : `${ml}ml`;
  return (
    <View>
      <View style={[styles.calTargetLine, { bottom: `${(target / max) * 100}%` }]}>
        <Text style={styles.calTargetLabel}>{fmt(target)}</Text>
      </View>
      <View style={styles.calBars}>
        {history.map((h, i) => {
          const hgt = Math.max(2, (h.amount_ml / max) * 100);
          return (
            <View key={i} style={styles.calBarWrap}>
              <View style={[styles.calBar, { height: `${hgt}%`, backgroundColor: h.amount_ml >= target ? Void.accent : Void.borderStrong }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.calLabels}>
        {history.map((h, i) => {
          const isLast = i === history.length - 1;
          const isFirst = i === 0;
          return (
            <Text key={i} style={styles.calLabel}>
              {isFirst || isLast ? new Date(`${h.day}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : ''}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function CalorieChart({ history, target, burned }: { history: { day: string; calories: number }[]; target: number | null; burned?: (number | null)[] }) {
  const max = Math.max(target ?? 2000, ...history.map((h) => h.calories), ...(burned ?? []).map((b) => b ?? 0), 1);
  return (
    <View>
      {target != null && (
        <View style={[styles.calTargetLine, { bottom: `${(target / max) * 100}%` }]}>
          <Text style={styles.calTargetLabel}>{target}</Text>
        </View>
      )}
      <View style={styles.calBars}>
        {history.map((h, i) => {
          const inH = Math.max(2, (h.calories / max) * 100);
          const over = target != null && h.calories > target;
          const inBar = { key: 'in', h: inH, c: over ? AMBER : Void.accent };
          const burn = burned?.[i];
          const outBar = burn != null && burn > 0 ? { key: 'out', h: Math.max(2, (burn / max) * 100), c: RED } : null;
          // Taller bar behind, shorter on top - the overlap shows eaten vs used.
          const bars = outBar == null ? [inBar] : [inBar, outBar].sort((a, b) => b.h - a.h);
          return (
            <View key={i} style={styles.calBarWrap}>
              {bars.map((b) => (
                <View key={b.key} style={[styles.calBar, styles.calBarOverlay, { height: `${b.h}%`, backgroundColor: b.c }]} />
              ))}
            </View>
          );
        })}
      </View>
      <View style={styles.calLabels}>
        {history.map((h, i) => {
          const isLast = i === history.length - 1;
          const isFirst = i === 0;
          return (
            <Text key={i} style={styles.calLabel}>
              {isFirst || isLast ? new Date(`${h.day}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' }) : ''}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

/** Generic 7-day bar chart for daily health metrics (steps, kcal, distance). */
function WeekBars({ days, get, fmt }: { days: HealthDay[]; get: (d: HealthDay) => number; fmt: (v: number) => string }) {
  const max = Math.max(...days.map(get), 1);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return (
    <View>
      <View style={styles.weekBars}>
        {days.map((d) => {
          const v = get(d);
          const isToday = d.date === todayKey;
          return (
            <View key={d.date} style={styles.weekBarCol}>
              <Text style={styles.weekBarVal} numberOfLines={1}>
                {v > 0 ? fmt(v) : ''}
              </Text>
              <View style={[styles.weekBarFill, { height: `${Math.max(3, (v / max) * 100)}%`, backgroundColor: isToday ? Void.accent : Void.borderStrong }]} />
              <Text style={[styles.weekBarDay, isToday && { color: Void.accent }]}>
                {new Date(`${d.date}T12:00:00`).toLocaleDateString('en', { weekday: 'narrow' })}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// -- Screen ----------------------------------------------------------------

export default function AnalyticsScreen() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const distUnit = distanceUnitFor(unit);
  const userId = useSettings((s) => s.supabase_user_id);
  const settings = useSettings();

  const [score, setScore] = useState({ now: 0, prior: 0, relative: false });
  const [streak, setStreak] = useState(0);
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [insights, setInsights] = useState<Insight[]>([]);
  const [lifts, setLifts] = useState<LiftProgress[]>([]);
  const [prs, setPrs] = useState<RecentPR[]>([]);
  const [weekSets, setWeekSets] = useState<MuscleSets[]>([]);
  const [split, setSplit] = useState<Record<MuscleCategory, number>>({ Push: 0, Pull: 0, Legs: 0, Core: 0 });
  const [life, setLife] = useState<Lifetime>({ workouts: 0, sets: 0, volumeKg: 0, seconds: 0 });
  const [workoutsWeek, setWorkoutsWeek] = useState(0);

  // Body + nutrition state
  const [weights, setWeights] = useState<{ value: number; logged_at: string }[]>([]);
  const [todayNutrition, setTodayNutrition] = useState<DayTotals>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0, drink_sugar_g: 0, drink_calories: 0 });
  const [calHistory, setCalHistory] = useState<{ day: string; calories: number }[]>([]);
  const [waterHistory, setWaterHistory] = useState<{ day: string; amount_ml: number }[]>([]);
  const [waterTarget, setWaterTarget] = useState(2000);
  const [mealCount, setMealCount] = useState(0);
  const [planCount, setPlanCount] = useState(0);
  const [friendStats, setFriendStats] = useState<FriendStats[]>([]);
  const [myWeekVolume, setMyWeekVolume] = useState(0);
  const [myWeekCalories, setMyWeekCalories] = useState(0);
  const [myWeekSteps, setMyWeekSteps] = useState(0);
  const [myBench, setMyBench] = useState<number | null>(null);
  const [mySquat, setMySquat] = useState<number | null>(null);
  const [myDeadlift, setMyDeadlift] = useState<number | null>(null);
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null);
  const [cardio, setCardio] = useState<Awaited<ReturnType<typeof listCardio>>>([]);
  const [restingHrs, setRestingHrs] = useState<{ value: number; logged_at: string }[]>([]);
  const [sleeps, setSleeps] = useState<{ value: number; logged_at: string }[]>([]);
  const [activity, setActivity] = useState<HealthDay[]>([]);
  const [todayHealth, setTodayHealth] = useState<HealthToday | null>(null);
  const [tab, setTab] = useState<'today' | 'training' | 'nutrition' | 'activity' | 'body'>('today');

  // Focus-adaptive: each segment maps to owning focuses - hide segments the
  // user's current selection doesn't need. TODAY (overview) always stays.
  // A muted-but-entered tab or the header SHOW ALL toggle reveals everything.
  const activeIntents = parseIntents(useSettings((s) => s.active_intents));
  const tabMuted = isTabMuted('analytics', activeIntents);
  const [showEverything, setShowEverything] = useState(false);
  const has = (...f: Intent[]) =>
    showEverything || tabMuted || isEverything(activeIntents) || f.some((x) => activeIntents.includes(x));
  const partiallyFiltered =
    !isEverything(activeIntents) && !tabMuted &&
    (['nutrition', 'hydration', 'body_comp', 'cardio', 'recovery', 'lift', 'progress'] as Intent[]).some(
      (f) => !activeIntents.includes(f)
    );
  const TAB_FOCUS: Record<'training' | 'nutrition' | 'activity' | 'body', Intent[]> = {
    training: ['lift', 'progress'],
    nutrition: ['nutrition', 'hydration'],
    activity: ['cardio', 'recovery'],
    body: ['body_comp', 'recovery'],
  };
  const showTab = (t: 'training' | 'nutrition' | 'activity' | 'body') => has(...TAB_FOCUS[t]);
  useEffect(() => {
    if (tab !== 'today' && !showTab(tab)) setTab('today');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIntents.join()]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        // Kick off the health fetch in parallel with the DB reads.
        const healthPromise = settings.health_connected
          ? Promise.all([getDailyActivity(7), getHealthToday()])
          : Promise.resolve<[HealthDay[], HealthToday | null]>([[], null]);
        const [sc, ds, lf, ws, ng, sp, pr, lt, wk, w, today, calHist, waterHist, meals, plans, rec, car, rhr, slp] = await Promise.all([
          strengthScore(),
          workoutDates(84),
          liftProgress(6),
          setsByMuscle(7),
          neglectedMuscles(7),
          categorySplit(28),
          recentPRs(30, 8),
          lifetime(),
          workoutsThisWeek(),
          listMeasurements('weight'),
          dayTotals(),
          calorieHistory(7),
          liquidHistory(7),
          listMeals(),
          listPlans(),
          recoveryStatus(),
          listCardio(50),
          listMeasurements('resting_hr'),
          listMeasurements('sleep_hours'),
        ]);
        const st = weekStreak(ds);
        setScore(sc);
        setDates(ds);
        setStreak(st);
        setLifts(lf);
        setWeekSets(ws);
        setSplit(sp);
        setPrs(pr);
        setLife(lt);
        setWorkoutsWeek(wk);
        setWeights(w);
        setTodayNutrition(today);
        setCalHistory(calHist);
        setWaterHistory(waterHist);
        setWaterTarget(liquidTargetMl(w[0]?.value ?? null, useSettings.getState().water_target_ml));
        setMealCount(meals.length);
        setPlanCount(plans.length);
        setRecovery(rec);
        setCardio(car);
        setRestingHrs(rhr);
        setSleeps(slp);
        // Live health-platform data (steps, energy, distance) - device-local, no sync.
        const [healthDays, healthNow] = await healthPromise;
        setActivity(healthDays);
        setTodayHealth(healthNow);
        const weekSteps = healthDays.reduce((a, d) => a + d.steps, 0);
        setInsights(
          buildInsights({
            lifts: lf,
            weekSets: ws,
            neglected: ng,
            split: sp,
            streak: st,
            prs: pr,
            score: sc,
            workoutsThisWeek: wk,
            waterAvgMl: waterHist.reduce((a, h) => a + h.amount_ml, 0) / Math.max(1, waterHist.length),
            waterDaysOnTarget: waterHist.filter((h) => h.amount_ml >= liquidTargetMl(w[0]?.value ?? null, useSettings.getState().water_target_ml)).length,
            waterTargetMl: liquidTargetMl(w[0]?.value ?? null, useSettings.getState().water_target_ml),
            sugarToday: today.sugar_g,
            drinkSugarToday: today.drink_sugar_g,
            drinkKcalToday: today.drink_calories,
          })
        );
        // Sync public stats to Supabase for friend comparison (signed-in only).
        if (userId) {
          const [wv, wc] = await Promise.all([weekVolumeKg(), weekCalories()]);
          const find1rm = (names: RegExp) => lf.find((l) => names.test(l.name.toLowerCase()));
          const bench = find1rm(/bench/);
          const squat = find1rm(/squat/);
          const dead = find1rm(/deadlift|dead/);
          setMyWeekVolume(wv);
          setMyWeekCalories(wc);
          setMyWeekSteps(weekSteps);
          setMyBench(bench ? bench.best : null);
          setMySquat(squat ? squat.best : null);
          setMyDeadlift(dead ? dead.best : null);
          void upsertPublicStats(userId, {
            week_volume_kg: wv,
            week_workouts: wk,
            week_calories: wc,
            week_steps: weekSteps,
            bench_1rm: bench ? bench.best : null,
            squat_1rm: squat ? squat.best : null,
            deadlift_1rm: dead ? dead.best : null,
          });
        }
      })();
    }, [userId, settings.health_connected])
  );

  // Realtime friend stats subscription (signed-in only).
  useEffect(() => {
    if (!userId) return;
    return subscribeToFriendStats(userId, setFriendStats);
  }, [userId]);

  const delta = pctChange(score.now, score.prior);
  const hasData = life.workouts > 0;
  const lastWeeks = weekHits(dates, 12);
  const tonnage = tonnageComparison(life.volumeKg);
  const hours = Math.round(life.seconds / 3600);

  // Body derived
  const weightKg = weights[0]?.value ?? null;
  const monthAgo = weights.find((w) => Date.now() - new Date(w.logged_at).getTime() >= 28 * 86400000);
  const weightDelta = weightKg != null && monthAgo ? weightKg - monthAgo.value : null;
  const age = ageFromBirthYear(settings.birth_year);
  const profileComplete = weightKg != null && settings.height_cm != null && age != null && settings.sex != null;
  const bmiV = weightKg != null && settings.height_cm ? bmi(weightKg, settings.height_cm) : null;
  const bmiCat = bmiV != null ? bmiCategory(bmiV) : null;
  const bmrV = profileComplete ? bmr(weightKg!, settings.height_cm!, age!, settings.sex!) : null;
  const tdeeV = bmrV != null ? tdee(bmrV, settings.activity_level) : null;
  const target = settings.calorie_override ?? (tdeeV != null ? calorieTarget(tdeeV, settings.goal) : null);
  const proteinT = profileComplete ? proteinTarget(weightKg!, settings.goal) : null;

  // Nutrition derived
  const calPct = target != null && todayNutrition.calories > 0 ? Math.round((todayNutrition.calories / target) * 100) : 0;
  const calRemaining = target != null ? target - todayNutrition.calories : null;
  const todayCardioKcal = cardio
    .filter((s) => new Date(s.started_at).toDateString() === new Date().toDateString())
    .reduce((a, s) => a + (s.calories ?? 0), 0);
  // Prefer measured active energy from the health platform; fall back to imported cardio calories.
  const todayBurned = todayHealth != null && todayHealth.activeKcal > 0 ? todayHealth.activeKcal : todayCardioKcal;
  // Total calories used per day (active + basal) for the intake-vs-burn overlay.
  const burnedByDay = new Map(activity.map((d) => [d.date, Math.round(d.activeKcal + d.basalKcal)]));

  // -- Today vs yesterday ---------------------------------------------------
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = yesterday.toDateString();
  const yesterdayKcal = calHistory.length >= 2 ? calHistory[calHistory.length - 2].calories : 0;
  const yesterdayCardioKcal = cardio
    .filter((s) => new Date(s.started_at).toDateString() === yesterdayStr)
    .reduce((a, s) => a + (s.calories ?? 0), 0);
  const yesterdayActive = activity.length >= 2 ? activity[activity.length - 2].activeKcal : 0;
  const yesterdayBurned = todayHealth != null && yesterdayActive > 0 ? yesterdayActive : yesterdayCardioKcal;
  const trainedToday = dates.has(new Date().toISOString().slice(0, 10));
  const trainedYesterday = dates.has(yesterday.toISOString().slice(0, 10));
  const todayStr = new Date().toDateString();
  const sleepToday = sleeps.find((s) => new Date(s.logged_at).toDateString() === todayStr)?.value ?? null;
  const sleepPrev = sleeps.find((s) => new Date(s.logged_at).toDateString() === yesterdayStr)?.value ?? null;
  const restingHr = restingHrs.find((r) => new Date(r.logged_at).toDateString() === todayStr)?.value ?? null;
  const restingHrPrev = restingHrs.find(
    (r) => new Date(r.logged_at).toDateString() === yesterdayStr
  )?.value ?? null;

  // -- Personalized tips ------------------------------------------------------
  const todayTips: Insight[] = [];
  if (recovery != null) {
    if (recovery.score >= 55) {
      todayTips.push({ id: 'tip-ready', tone: 'win', title: 'Green light', body: 'Recovery looks strong - a good day to chase a PR or push volume.' });
    } else if (recovery.score >= 35) {
      todayTips.push({ id: 'tip-caution', tone: 'info', title: 'Partially recovered', body: 'Keep RPE around 7-8 and prioritise the lifts that matter.' });
    } else {
      todayTips.push({ id: 'tip-recover', tone: 'warn', title: 'Running on fumes', body: 'Consider an easy session or rest day - sleep and food first.' });
    }
  }
  if (sleepToday != null && sleepToday < 6.5) {
    todayTips.push({ id: 'tip-sleep', tone: 'warn', title: `${sleepToday}h sleep`, body: 'Short sleep blunts strength - cap heavy attempts today.' });
  }
  if (proteinT != null && todayNutrition.protein_g < proteinT * 0.5) {
    todayTips.push({ id: 'tip-protein', tone: 'info', title: 'Protein behind', body: `You're ${Math.round(proteinT - todayNutrition.protein_g)}g short of target - front-load a shake or high-protein meal.` });
  }
  if (todayCardioKcal === 0 && !trainedToday) {
    todayTips.push({ id: 'tip-move', tone: 'info', title: 'Nothing logged yet', body: 'Even a 20-minute walk counts - small sessions keep the streak alive.' });
  }
  if (todayHealth != null) {
    const weekSteps = activity.filter((d) => d.steps > 0);
    const avgSteps = weekSteps.length > 1
      ? weekSteps.slice(0, -1).reduce((a, d) => a + d.steps, 0) / Math.max(1, weekSteps.length - 1)
      : 0;
    if (todayHealth.steps > 0 && avgSteps > 0 && todayHealth.steps < avgSteps * 0.4) {
      todayTips.push({ id: 'tip-steps', tone: 'info', title: `${todayHealth.steps.toLocaleString()} steps so far`, body: `Well under your ${Math.round(avgSteps).toLocaleString()}-step average - a walk would help.` });
    }
    const weekKcal = activity.filter((d) => d.activeKcal > 0);
    const avgActive = weekKcal.length > 1
      ? weekKcal.slice(0, -1).reduce((a, d) => a + d.activeKcal, 0) / Math.max(1, weekKcal.length - 1)
      : 0;
    if (avgActive > 0 && todayHealth.activeKcal > avgActive * 1.5 && todayHealth.activeKcal > 200) {
      todayTips.push({ id: 'tip-burn', tone: 'win', title: `${todayHealth.activeKcal} kcal active burn`, body: 'Above your usual pace - make sure protein keeps up.' });
    }
  }
  if (todayTips.length === 0) {
    todayTips.push({ id: 'tip-ok', tone: 'win', title: 'On track', body: 'Sleep, food and training all look solid today.' });
  }

  const recoveryTips: Insight[] = [];
  if (restingHr != null && restingHrPrev != null && restingHr > restingHrPrev + 5) {
    recoveryTips.push({ id: 'r-hr', tone: 'warn', title: 'Resting HR elevated', body: `${restingHr} bpm vs your usual ~${restingHrPrev} - a sign of fatigue or stress.` });
  }
  if (todayHealth?.hrvMs != null && todayHealth.hrvMs < 30) {
    recoveryTips.push({ id: 'r-hrv', tone: 'warn', title: `HRV ${todayHealth.hrvMs}ms`, body: 'Low heart-rate variability often means incomplete recovery - keep intensity moderate today.' });
  }
  if (sleeps.length > 0) {
    const avg = sleeps.slice(0, 7).reduce((a, s) => a + s.value, 0) / Math.min(7, sleeps.length);
    if (avg < 7) {
      recoveryTips.push({ id: 'r-sleep', tone: 'warn', title: 'Sleep debt', body: `${avg.toFixed(1)}h average this week - aim for 7.5h+ for better recovery.` });
    }
  }
  if (mealCount > 0 && planCount === 0) {
    recoveryTips.push({ id: 'r-meals', tone: 'info', title: 'Build a meal plan', body: `You have ${mealCount} meal${mealCount === 1 ? '' : 's'} saved - group them into a plan so recovery eating is automatic.` });
  }
  if (split.Legs > 0 && split.Push + split.Pull > 0 && split.Legs / (split.Push + split.Pull + split.Legs + split.Core) < 0.2) {
    recoveryTips.push({ id: 'r-legs', tone: 'info', title: 'Legs undertrained', body: 'Lower-body volume is light this month - recovery cost is low, growth ceiling is high.' });
  }
  if (recoveryTips.length === 0) {
    recoveryTips.push({ id: 'r-ok', tone: 'win', title: 'Recovering well', body: 'Sleep, heart rate and training load are all in a good range.' });
  }

  return (
    <Screen>
      <ScreenHeader
        title="Void"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {partiallyFiltered && <FocusToggle showAll={showEverything} onToggle={() => setShowEverything((v) => !v)} />}
            <Pressable onPress={() => router.push('/auth/link')} hitSlop={8}>
              <CircleUser color={Void.textSecondary} size={22} />
            </Pressable>
          </View>
        }
      />
      {/* Tab switcher */}
      <View style={styles.segRow}>
        {(
          [
            ['today', 'TODAY'],
            ['training', 'TRAINING'],
            ['nutrition', 'NUTRITION'],
            ['activity', 'ACTIVITY'],
            ['body', 'RECOVERY'],
          ] as const
        )
          .filter(([k]) => k === 'today' || showTab(k))
          .map(([k, label]) => (
          <Pressable key={k} style={[styles.seg, tab === k && styles.segOn]} onPress={() => setTab(k)}>
            <Text
              style={[styles.segText, tab === k && { color: Void.accentText }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* ======================= TODAY ======================= */}
        {tab === 'today' && (
          <>
            {/* Readiness hero */}
            {recovery != null && has('recovery', 'progress', 'lift') ? (
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>READINESS</Text>
                <View style={styles.heroRow}>
                  <Text
                    style={[
                      styles.heroValue,
                      { color: recovery.score >= 55 ? Void.accent : recovery.score >= 35 ? AMBER : RED },
                    ]}>
                    {recovery.score}
                  </Text>
                  <Text style={styles.heroUnit}>/ 100</Text>
                </View>
                <Text style={styles.heroSub}>{recovery.label} - based on sleep, resting HR, load & feel</Text>
              </View>
            ) : (
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>TODAY</Text>
                <Text style={styles.heroSub}>Finish a workout and log vitals - this page starts thinking for you.</Text>
              </View>
            )}

            {/* Today snapshot - cells filter by focus */}
            {has('nutrition', 'hydration', 'body_comp', 'cardio', 'recovery', 'lift', 'progress') && (
            <>
            <SectionLabel>TODAY</SectionLabel>
            <Card>
              <View style={styles.todayGrid}>
                {has('nutrition') && (
                <View style={styles.todayCell}>
                  <View style={styles.todayIcon}>
                    <Flame color={Void.accent} size={16} />
                  </View>
                  <Text style={styles.todayVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {todayNutrition.calories}
                  </Text>
                  <Text style={styles.todayLabel} numberOfLines={1}>
                    {target != null ? `/ ${target}` : 'KCAL'}
                  </Text>
                </View>
                )}
                {has('nutrition') && (
                <View style={styles.todayCell}>
                  <View style={styles.todayIcon}>
                    <Dumbbell color={Void.accent} size={16} />
                  </View>
                  <Text style={styles.todayVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {Math.round(todayNutrition.protein_g)}
                  </Text>
                  <Text style={styles.todayLabel} numberOfLines={1}>
                    {proteinT != null ? `/ ${proteinT}G` : 'PROTEIN G'}
                  </Text>
                </View>
                )}
                {has('hydration') && (
                <View style={styles.todayCell}>
                  <View style={styles.todayIcon}>
                    <Droplet color={Void.accent} size={16} />
                  </View>
                  <Text style={styles.todayVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {waterHistory.at(-1)?.amount_ml ?? 0}
                  </Text>
                  <Text style={styles.todayLabel} numberOfLines={1}>
                    {waterTarget != null ? `/ ${waterTarget}ML` : 'ML WATER'}
                  </Text>
                </View>
                )}
                {has('body_comp') && (
                <View style={styles.todayCell}>
                  <View style={styles.todayIcon}>
                    <Scale color={Void.accent} size={16} />
                  </View>
                  <Text style={styles.todayVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {weightKg != null ? displayWeight(weightKg, unit) : '-'}
                  </Text>
                  <Text style={styles.todayLabel} numberOfLines={1}>
                    {unit.toUpperCase()}
                  </Text>
                </View>
                )}
                {has('cardio', 'recovery') && (
                <View style={styles.todayCell}>
                  <View style={styles.todayIcon}>
                    <HeartPulse color={Void.accent} size={16} />
                  </View>
                  <Text style={styles.todayVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {todayBurned > 0 ? todayBurned : '-'}
                  </Text>
                  <Text style={styles.todayLabel} numberOfLines={1}>
                    KCAL BURNED
                  </Text>
                </View>
                )}
              </View>
              {target != null && has('nutrition') && (
                <>
                  <View style={styles.calProgressTrack}>
                    <View style={[styles.calProgressFill, { width: `${Math.min(100, calPct)}%`, backgroundColor: calPct > 100 ? AMBER : Void.accent }]} />
                  </View>
                  <View style={styles.calProgressFooter}>
                    <Text style={styles.calProgressText}>{calPct}% of target</Text>
                    <Text style={[styles.calProgressText, { color: calRemaining != null && calRemaining < 0 ? RED : Void.textTertiary }]}>
                      {calRemaining != null ? `${calRemaining > 0 ? '' : '+'}${Math.abs(calRemaining)} kcal ${calRemaining > 0 ? 'left' : 'over'}` : ''}
                    </Text>
                  </View>
                </>
              )}
              {/* vs yesterday */}
              {has('nutrition', 'cardio', 'recovery', 'lift', 'progress') && (
              <View style={styles.vsRow}>
                <Text style={styles.vsTitle}>VS YESTERDAY</Text>
                <View style={styles.vsChips}>
                  {has('nutrition') && (
                  <View style={styles.vsChip}>
                    <Text style={styles.vsChipLabel}>FOOD</Text>
                    <Text
                      style={[styles.vsChipVal, { color: todayNutrition.calories - yesterdayKcal <= 0 ? Void.accent : AMBER }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}>
                      {yesterdayKcal > 0 || todayNutrition.calories > 0
                        ? `${todayNutrition.calories - yesterdayKcal >= 0 ? '+' : ''}${todayNutrition.calories - yesterdayKcal}`
                        : '-'}
                    </Text>
                  </View>
                  )}
                  {has('cardio', 'recovery') && (
                  <View style={styles.vsChip}>
                    <Text style={styles.vsChipLabel}>BURNED</Text>
                    <Text
                      style={[styles.vsChipVal, { color: todayBurned - yesterdayBurned >= 0 ? Void.accent : AMBER }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}>
                      {todayBurned - yesterdayBurned >= 0 ? '+' : ''}
                      {todayBurned - yesterdayBurned}
                    </Text>
                  </View>
                  )}
                  {has('recovery') && (
                  <View style={styles.vsChip}>
                    <Text style={styles.vsChipLabel}>SLEEP</Text>
                    <Text
                      style={[styles.vsChipVal, { color: sleepToday != null && sleepToday >= (sleepPrev ?? 0) ? Void.accent : AMBER }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}>
                      {sleepToday != null
                        ? `${sleepToday - (sleepPrev ?? 0) >= 0 ? '+' : ''}${(sleepToday - (sleepPrev ?? 0)).toFixed(1)}h`
                        : '-'}
                    </Text>
                  </View>
                  )}
                  {has('lift', 'progress') && (
                  <View style={styles.vsChip}>
                    <Text style={styles.vsChipLabel}>TRAINING</Text>
                    <Text style={styles.vsChipVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                      {trainedToday ? 'done' : trainedYesterday ? 'rest day' : 'none yet'}
                    </Text>
                  </View>
                  )}
                </View>
              </View>
              )}
            </Card>
            </>
            )}

            {/* Vitals */}
            {has('recovery', 'cardio') && (restingHr != null || sleepToday != null || todayHealth?.hrvMs != null) && (
              <>
                <SectionLabel>VITALS</SectionLabel>
                <Card>
                  <View style={styles.todayGrid}>
                    <StatCell
                      value={restingHr ?? '-'}
                      label={
                        restingHrPrev != null && restingHr != null
                          ? `RESTING BPM · ${restingHr - restingHrPrev >= 0 ? '+' : ''}${restingHr - restingHrPrev}`
                          : 'RESTING BPM'
                      }
                    />
                    <StatCell value={sleepToday != null ? `${sleepToday}h` : '-'} label="LAST NIGHT" />
                    {todayHealth?.hrvMs != null && <StatCell value={todayHealth.hrvMs} label="HRV MS" />}
                    {cardio.some((s) => s.avg_hr != null) && (
                      <StatCell
                        value={Math.round(
                          cardio.filter((s) => s.avg_hr != null).reduce((a, s) => a + s.avg_hr!, 0) /
                            cardio.filter((s) => s.avg_hr != null).length
                        )}
                        label="AVG SESSION BPM"
                      />
                    )}
                  </View>
                </Card>
              </>
            )}

            {/* Cardio */}
            {has('cardio') && (
            <>
            <View style={styles.cardioHead}>
              <SectionLabel>CARDIO</SectionLabel>
              <Pressable onPress={() => router.push('/cardio')} hitSlop={8}>
                <Text style={styles.cardioAll}>{cardio.length > 0 ? 'VIEW ALL' : 'LOG / IMPORT'}</Text>
              </Pressable>
            </View>
            {cardio.length === 0 ? (
              <Pressable onPress={() => router.push('/cardio')}>
                <Card>
                  <Text style={styles.empty}>
                    Runs, rides and swims - logged manually or imported from{' '}
                    {Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'}.
                  </Text>
                </Card>
              </Pressable>
            ) : (
              <Card style={{ paddingVertical: 4 }}>
                {cardio.slice(0, 3).map((s, idx) => {
                  const pace = paceMinPerKm(s.distance_m, s.duration_seconds);
                  return (
                    <View key={s.id} style={[styles.cardioRow, idx < Math.min(3, cardio.length) - 1 && styles.liftRowBorder]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.liftName}>{ACTIVITY_META[s.activity].label}</Text>
                        <Text style={styles.liftMeta}>
                          {formatDate(s.started_at)}
                          {s.avg_hr != null ? ` · ${s.avg_hr} bpm` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.liftValue}>
                          {s.distance_m != null ? formatDistance(s.distance_m, distUnit) : formatCardioDuration(s.duration_seconds)}
                        </Text>
                        <Text style={[styles.liftDelta, { color: Void.textTertiary }]}>
                          {formatCardioDuration(s.duration_seconds)}
                          {pace != null ? ` · ${formatPace(pace, distUnit)}/${distUnit}` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })}
                {(() => {
                  const weekM = cardio
                    .filter((s) => Date.now() - new Date(s.started_at).getTime() < 7 * 86400000)
                    .reduce((a, s) => a + (s.distance_m ?? 0), 0);
                  const pbCount = distancePBs(cardio).length;
                  return (
                    <Text style={styles.cardioFoot}>
                      {weekM > 0 ? `${formatDistance(weekM, distUnit)} this week` : 'No distance this week'}
                      {pbCount > 0 ? ` · ${pbCount} distance PB${pbCount === 1 ? '' : 's'}` : ''}
                    </Text>
                  );
                })()}
              </Card>
            )}
            </>
            )}

            {/* Personalized tips */}
            <SectionLabel>FOR YOU TODAY</SectionLabel>
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <GatedInsights insights={todayTips} />
            </View>
          </>
        )}

        {/* ======================= ACTIVITY ======================= */}
        {tab === 'activity' && (
          <>
            {!settings.health_connected ? (
              <Pressable onPress={() => router.push('/(tabs)/body')}>
                <Card>
                  <Text style={styles.empty}>
                    Connect {Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'} on the Body tab
                    to see steps, active energy, distance and exercise minutes here.
                  </Text>
                </Card>
              </Pressable>
            ) : (
              <>
                {/* Today hero - steps */}
                <View style={styles.hero}>
                  <Text style={styles.heroLabel}>STEPS · TODAY</Text>
                  <View style={styles.heroRow}>
                    <Text style={styles.heroValue}>{todayHealth != null ? todayHealth.steps.toLocaleString() : '-'}</Text>
                  </View>
                  <Text style={styles.heroSub}>
                    {todayHealth != null && todayHealth.activeKcal > 0
                      ? `${todayHealth.activeKcal} active kcal · ${formatDistance(todayHealth.distanceM, distUnit)} · ${todayHealth.exerciseMin} min exercise`
                      : 'Waiting for health data…'}
                  </Text>
                </View>

                {/* Today tiles */}
                {todayHealth != null && (
                  <Card>
                    <View style={styles.todayGrid}>
                      <StatCell value={todayHealth.activeKcal > 0 ? todayHealth.activeKcal : '-'} label="ACTIVE KCAL" />
                      <StatCell value={todayHealth.distanceM > 0 ? formatDistance(todayHealth.distanceM, distUnit) : '-'} label="DISTANCE" />
                      <StatCell value={todayHealth.exerciseMin > 0 ? todayHealth.exerciseMin : '-'} label="EXERCISE MIN" />
                      <StatCell value={todayHealth.standHours > 0 ? todayHealth.standHours : '-'} label="STAND HRS" />
                    </View>
                  </Card>
                )}

                {/* 7-day charts */}
                {activity.some((d) => d.steps > 0) && (
                  <>
                    <SectionLabel>STEPS · 7 DAYS</SectionLabel>
                    <Card>
                      <WeekBars days={activity} get={(d) => d.steps} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />
                    </Card>
                  </>
                )}

                {activity.some((d) => d.activeKcal > 0) && (
                  <>
                    <SectionLabel>ACTIVE ENERGY · 7 DAYS</SectionLabel>
                    <Card>
                      <WeekBars days={activity} get={(d) => d.activeKcal} fmt={(v) => String(v)} />
                    </Card>
                  </>
                )}

                {activity.some((d) => d.distanceM > 0) && (
                  <>
                    <SectionLabel>DISTANCE · 7 DAYS</SectionLabel>
                    <Card>
                      <WeekBars days={activity} get={(d) => d.distanceM} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}km` : `${Math.round(v)}m`)} />
                    </Card>
                  </>
                )}

                {activity.some((d) => d.exerciseMin > 0) && (
                  <>
                    <SectionLabel>EXERCISE MINUTES · 7 DAYS</SectionLabel>
                    <Card>
                      <WeekBars days={activity} get={(d) => d.exerciseMin} fmt={(v) => String(v)} />
                    </Card>
                  </>
                )}

                {/* Extra vitals */}
                {todayHealth != null && (todayHealth.vo2max != null || todayHealth.hrvMs != null || todayHealth.flights > 0 || todayHealth.basalKcal > 0) && (
                  <>
                    <SectionLabel>MORE FROM HEALTH</SectionLabel>
                    <Card>
                      <View style={styles.todayGrid}>
                        {todayHealth.vo2max != null && <StatCell value={todayHealth.vo2max} label="VO2 MAX" />}
                        {todayHealth.hrvMs != null && <StatCell value={todayHealth.hrvMs} label="HRV MS" />}
                        {todayHealth.basalKcal > 0 && <StatCell value={todayHealth.basalKcal} label="RESTING KCAL" />}
                        {todayHealth.flights > 0 && <StatCell value={todayHealth.flights} label="FLIGHTS" />}
                      </View>
                    </Card>
                  </>
                )}

                {activity.every((d) => d.steps === 0 && d.activeKcal === 0 && d.distanceM === 0) && todayHealth == null && (
                  <Card>
                    <Text style={styles.empty}>Connected, but no activity data found in the last 7 days.</Text>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* ======================= NUTRITION ======================= */}
        {tab === 'nutrition' && (
          <>
            {/* Calories */}
            {has('nutrition') && calHistory.length > 0 && (
              <>
                <SectionLabel>CALORIES · 7 DAYS</SectionLabel>
                <Card>
                  <CalorieChart history={calHistory} target={target} burned={calHistory.map((h) => burnedByDay.get(h.day) ?? null)} />
                  <View style={styles.macroLegend}>
                    <View style={styles.macroLegItem}>
                      <View style={[styles.macroDot, { backgroundColor: RED }]} />
                      <Text style={styles.macroLegText}>Burned</Text>
                    </View>
                    <View style={styles.macroLegItem}>
                      <View style={[styles.macroDot, { backgroundColor: Void.accent }]} />
                      <Text style={styles.macroLegText}>Protein</Text>
                    </View>
                    <View style={styles.macroLegItem}>
                      <View style={[styles.macroDot, { backgroundColor: CARB_C }]} />
                      <Text style={styles.macroLegText}>Carbs</Text>
                    </View>
                    <View style={styles.macroLegItem}>
                      <View style={[styles.macroDot, { backgroundColor: FAT_C }]} />
                      <Text style={styles.macroLegText}>Fat</Text>
                    </View>
                  </View>
                  <MacroBar p={todayNutrition.protein_g} c={todayNutrition.carbs_g} f={todayNutrition.fat_g} />
                </Card>
              </>
            )}

            {/* Hydration - the card always renders so there's somewhere to
                log drinks; the chart only appears once data exists. */}
            <SectionLabel>HYDRATION · 7 DAYS</SectionLabel>
            <HydrationCard />
            <Card>
              <HydrationChart history={waterHistory} target={waterTarget} />
            </Card>

            {/* Meal library */}
            {has('nutrition') && (
            <>
            <SectionLabel>MEAL LIBRARY</SectionLabel>
            <Card>
              <View style={styles.mealGrid}>
                <Pressable style={styles.mealCell} onPress={() => router.push('/(tabs)/meals')}>
                  <Utensils color={Void.accent} size={20} />
                  <Text style={styles.mealVal}>{mealCount}</Text>
                  <Text style={styles.mealLabel}>MEALS</Text>
                </Pressable>
                <Pressable style={styles.mealCell} onPress={() => router.push('/(tabs)/meals')}>
                  <Utensils color={Void.accent} size={20} />
                  <Text style={styles.mealVal}>{planCount}</Text>
                  <Text style={styles.mealLabel}>PLANS</Text>
                </Pressable>
              </View>
            </Card>
            </>
            )}
          </>
        )}

        {/* ======================= BODY ======================= */}
        {tab === 'body' && (
          <>
            {recovery != null && has('recovery') && (
              <>
                <SectionLabel>RECOVERY</SectionLabel>
                <RecoveryCard recovery={recovery} />
              </>
            )}

            {/* Body */}
            {weightKg != null && has('body_comp') && (
              <>
                <SectionLabel>BODY</SectionLabel>
                <Card>
                  <View style={styles.bodyGrid}>
                    <View style={styles.bodyCell}>
                      <Text style={styles.bodyVal}>{displayWeight(weightKg, unit)}</Text>
                      <Text style={styles.bodyLabel}>WEIGHT ({unit.toUpperCase()})</Text>
                    </View>
                    {bmiV != null && (
                      <View style={styles.bodyCell}>
                        <Text style={styles.bodyVal}>{bmiV.toFixed(1)}</Text>
                        <Text style={styles.bodyLabel}>BMI · {bmiCat?.label.toUpperCase()}</Text>
                      </View>
                    )}
                    {weightDelta != null && (
                      <View style={styles.bodyCell}>
                        <Text style={[styles.bodyVal, { color: weightDelta < 0 ? Void.accent : AMBER }]}>
                          {weightDelta < 0 ? '' : '+'}
                          {displayWeight(Math.abs(weightDelta), unit)}
                        </Text>
                        <Text style={styles.bodyLabel}>4 WEEKS</Text>
                      </View>
                    )}
                    {tdeeV != null && (
                      <View style={styles.bodyCell}>
                        <Text style={styles.bodyVal}>{tdeeV}</Text>
                        <Text style={styles.bodyLabel}>MAINTENANCE</Text>
                      </View>
                    )}
                  </View>
                  {profileComplete && (
                    <Text style={styles.bodyNote}>
                      {ACTIVITY[settings.activity_level].label} · {settings.goal} goal · {proteinT}g protein target
                    </Text>
                  )}
                </Card>
              </>
            )}

            {/* Recovery tips */}
            <SectionLabel>RECOVERY TIPS</SectionLabel>
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <GatedInsights insights={recoveryTips} />
            </View>
          </>
        )}

        {/* ======================= TRAINING ======================= */}
        {tab === 'training' && (
          <>
            {/* Hero - strength score */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>STRENGTH SCORE</Text>
              <View style={styles.heroRow}>
                <Text style={styles.heroValue}>{hasData ? (score.relative ? score.now : formatVolume(score.now, unit)) : '-'}</Text>
                <Text style={styles.heroUnit}>{score.relative ? 'pts' : unit}</Text>
              </View>
              <Text style={styles.heroSub}>
                {score.relative
                  ? 'Your top 5 lifts vs bodyweight - higher means stronger for your size'
                  : 'Combined est. 1RM across your top 5 lifts'}
              </Text>
              <View style={styles.heroPills}>
                {score.prior > 0 && delta !== 0 && (
                  <View style={[styles.pill, { borderColor: delta > 0 ? Void.accent : RED }]}>
                    {delta > 0 ? <TrendingUp color={Void.accent} size={13} /> : <TrendingDown color={RED} size={13} />}
                    <Text style={[styles.pillText, { color: delta > 0 ? Void.accent : RED }]}>
                      {delta > 0 ? '+' : ''}
                      {delta}% · 30d
                    </Text>
                  </View>
                )}
                {streak > 0 && (
                  <View style={[styles.pill, { borderColor: AMBER }]}>
                    <Flame color={AMBER} size={13} fill={AMBER} />
                    <Text style={[styles.pillText, { color: AMBER }]}>
                      {streak} week{streak === 1 ? '' : 's'}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {!hasData && (
              <Card>
                <Text style={styles.empty}>
                  Finish a workout and this page starts thinking for you - trends, stalls, imbalances, PRs.
                </Text>
              </Card>
            )}

            {/* Streak */}
            {hasData && (
              <>
                <SectionLabel>STREAK</SectionLabel>
                <Card>
                  <View style={styles.streakRow}>
                    <View style={styles.streakFlame}>
                      <Flame color={streak > 0 ? AMBER : Void.textTertiary} size={28} fill={streak > 0 ? AMBER : 'transparent'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.streakValue}>
                        {streak}
                        <Text style={styles.streakUnit}> week{streak === 1 ? '' : 's'}</Text>
                      </Text>
                      <Text style={styles.streakSub}>
                        {streak === 0
                          ? 'Train once this week to start a streak.'
                          : workoutsWeek > 0
                            ? 'This week is banked. Keep it rolling.'
                            : 'Train this week to keep it alive.'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.streakWeeks}>
                    {lastWeeks.map((hit, i) => (
                      <View key={i} style={[styles.streakDot, hit && styles.streakDotHit, i === lastWeeks.length - 1 && !hit && styles.streakDotNow]} />
                    ))}
                  </View>
                  <View style={styles.heatFooter}>
                    <Text style={styles.heatFootText}>Last 12 weeks</Text>
                    <Text style={styles.heatFootText}>
                      {dates.size} session{dates.size === 1 ? '' : 's'} · {(dates.size / 12).toFixed(1)} / wk
                    </Text>
                  </View>
                </Card>
              </>
            )}

            {/* Top lifts */}
            {lifts.length > 0 && (
              <>
                <SectionLabel>YOUR BIG LIFTS</SectionLabel>
                <Card style={{ paddingVertical: 4 }}>
                  {lifts.map((l, idx) => {
                    const cur = l.recent || l.best;
                    const d = l.prior > 0 && l.recent > 0 ? pctChange(l.recent, l.prior) : null;
                    return (
                      <Pressable
                        key={l.exerciseId}
                        style={[styles.liftRow, idx < lifts.length - 1 && styles.liftRowBorder]}
                        onPress={() => router.push(`/exercise/${l.exerciseId}`)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.liftName}>{l.name}</Text>
                          <Text style={styles.liftMeta}>
                            all-time {formatVolume(l.best, unit)} {unit}
                            {l.sessions > 0 ? ` · ${l.sessions} sessions / 6w` : ''}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.liftValue}>
                            {formatVolume(cur, unit)}
                            <Text style={styles.liftUnit}> {unit}</Text>
                          </Text>
                          {d !== null && (
                            <Text
                              style={[
                                styles.liftDelta,
                                { color: d > 0 ? Void.accent : d < 0 ? RED : Void.textTertiary },
                              ]}>
                              {d > 0 ? '▲' : d < 0 ? '▼' : '■'} {Math.abs(d)}%
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </Card>
              </>
            )}

            {/* PRs */}
            {prs.length > 0 && (
              <>
                <SectionLabel>RECORDS · 30 DAYS</SectionLabel>
                <Card style={{ paddingVertical: 4 }}>
                  {prs.map((p, idx) => (
                    <View key={p.id} style={[styles.prRow, idx < prs.length - 1 && styles.liftRowBorder]}>
                      <Trophy color={Void.accent} size={14} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.prName}>{p.name}</Text>
                        <Text style={styles.prMeta}>{PR_LABEL[p.recordType] ?? p.recordType}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.prValue}>{formatRecord(p.recordType, p.value, unit)}</Text>
                        <Text style={styles.prDate}>{formatDate(p.achievedAt)}</Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {/* Body heat map */}
            <SectionLabel>BODY HEAT MAP</SectionLabel>
            <BodyHeatmap />

            {/* Hard sets */}
            {weekSets.length > 0 && (
              <>
                <SectionLabel>HARD SETS THIS WEEK</SectionLabel>
                <Card>
                  {weekSets.map((m) => (
                    <MuscleVolumeRow key={m.muscle} m={m} />
                  ))}
                  <Text style={styles.volHint}>Shaded band = 10-20 sets, the range most people grow in.</Text>
                </Card>
              </>
            )}

            {/* Balance */}
            {Object.values(split).some((v) => v > 0) && (
              <>
                <SectionLabel>BALANCE · 4 WEEKS</SectionLabel>
                <Card>
                  <SplitBar split={split} />
                </Card>
              </>
            )}

            {/* Lifetime */}
            {hasData && (
              <>
                <SectionLabel>ALL TIME</SectionLabel>
                <Card>
                  <View style={styles.lifeGrid}>
                    <View style={styles.lifeCell}>
                      <Text style={styles.lifeValue}>{formatVolume(life.volumeKg, unit)}</Text>
                      <Text style={styles.lifeLabel}>{unit.toUpperCase()} LIFTED</Text>
                    </View>
                    <View style={styles.lifeCell}>
                      <Text style={styles.lifeValue}>{life.workouts}</Text>
                      <Text style={styles.lifeLabel}>WORKOUTS</Text>
                    </View>
                    <View style={styles.lifeCell}>
                      <Text style={styles.lifeValue}>{life.sets}</Text>
                      <Text style={styles.lifeLabel}>HARD SETS</Text>
                    </View>
                    <View style={styles.lifeCell}>
                      <Text style={styles.lifeValue}>{hours}</Text>
                      <Text style={styles.lifeLabel}>HOURS</Text>
                    </View>
                  </View>
                  {tonnage && <Text style={styles.lifeFun}>{tonnage} of total weight moved.</Text>}
                </Card>
              </>
            )}

            {/* Insights */}
            {insights.length > 0 && (
              <>
                <SectionLabel>WHAT THE DATA SAYS</SectionLabel>
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  <GatedInsights insights={insights} />
                </View>
              </>
            )}

            {/* Friends comparison */}
            {userId && friendStats.length > 0 && (
              <>
                <SectionLabel>FRIENDS</SectionLabel>
                <Card style={{ paddingVertical: 4 }}>
                  {(() => {
                    const myStats: FriendStats = {
                      user_id: 'me',
                      display_name: 'You',
                      week_volume_kg: myWeekVolume,
                      week_workouts: workoutsWeek,
                      week_calories: myWeekCalories,
                      week_steps: myWeekSteps,
                      bench_1rm: myBench,
                      squat_1rm: mySquat,
                      deadlift_1rm: myDeadlift,
                    };
                    const all = [myStats, ...friendStats];
                    const leadVol = Math.max(...all.map((s) => s.week_volume_kg));
                    const leadWk = Math.max(...all.map((s) => s.week_workouts));
                    const leadCal = Math.max(...all.map((s) => s.week_calories));
                    const leadSteps = Math.max(...all.map((s) => s.week_steps));
                    const leadBench = Math.max(...all.map((s) => s.bench_1rm ?? 0));
                    const leadSquat = Math.max(...all.map((s) => s.squat_1rm ?? 0));
                    const leadDead = Math.max(...all.map((s) => s.deadlift_1rm ?? 0));
                    const rows: { label: string; get: (s: FriendStats) => number; lead: number; fmt: (v: number) => string }[] = [
                      { label: 'WEEK VOL', get: (s) => s.week_volume_kg, lead: leadVol, fmt: (v) => formatVolume(v, unit) },
                      { label: 'WORKOUTS', get: (s) => s.week_workouts, lead: leadWk, fmt: (v) => String(v) },
                      { label: 'WEEK KCAL', get: (s) => s.week_calories, lead: leadCal, fmt: (v) => String(v) },
                      { label: 'STEPS', get: (s) => s.week_steps, lead: leadSteps, fmt: (v) => (v > 0 ? v.toLocaleString() : '-') },
                      { label: 'BENCH 1RM', get: (s) => s.bench_1rm ?? 0, lead: leadBench, fmt: (v) => v > 0 ? displayWeight(v, unit) : '-' },
                      { label: 'SQUAT 1RM', get: (s) => s.squat_1rm ?? 0, lead: leadSquat, fmt: (v) => v > 0 ? displayWeight(v, unit) : '-' },
                      { label: 'DEAD 1RM', get: (s) => s.deadlift_1rm ?? 0, lead: leadDead, fmt: (v) => v > 0 ? displayWeight(v, unit) : '-' },
                    ];
                    return rows.map((row, ri) => (
                      <View key={row.label} style={[styles.cmpRow, ri < rows.length - 1 && styles.liftRowBorder]}>
                        <Text style={styles.cmpLabel}>{row.label}</Text>
                        <View style={styles.cmpVals}>
                          {all.map((s) => {
                            const v = row.get(s);
                            const isLead = v > 0 && v === row.lead;
                            return (
                              <View key={s.user_id} style={styles.cmpCell}>
                                <Text style={[styles.cmpName, isLead && { color: Void.accent }]} numberOfLines={1}>
                                  {s.display_name ?? '???'}
                                </Text>
                                <Text style={[styles.cmpVal, isLead && { color: Void.accent }]} numberOfLines={1}>
                                  {row.fmt(v)}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ));
                  })()}
                </Card>
              </>
            )}
          </>
        )}

      </ScrollView>

    </Screen>
  );
}

const styles = StyleSheet.create({
  segRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  seg: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
  },
  segOn: { backgroundColor: Void.accent, borderColor: Void.accent },
  segText: { color: Void.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  vsRow: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border, paddingTop: 10 },
  vsTitle: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  vsChips: { flexDirection: 'row', gap: 8 },
  vsChip: {
    flex: 1,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  vsChipLabel: { color: Void.textTertiary, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  vsChipVal: { color: Void.text, fontSize: 13, fontWeight: '800', marginTop: 2, ...tabular },
  cardioHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  cardioAll: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  cardioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  cardioFoot: { color: Void.textTertiary, fontSize: 11, paddingTop: 10, ...tabular },
  recoveryTop: { flexDirection: 'row', alignItems: 'center' },
  recoveryScore: { fontSize: 40, fontWeight: '800', ...tabular },
  recoveryLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 2, marginTop: 2 },
  recoveryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 10 },
  recoveryFactor: { color: Void.textSecondary, fontSize: 12, fontWeight: '600' },
  recoveryDetail: { fontSize: 12, ...tabular, flexShrink: 1 },
  recoveryHint: { color: Void.textTertiary, fontSize: 10, marginTop: 12, lineHeight: 14 },
  // Hero
  hero: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  heroLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  heroValue: { color: Void.text, fontSize: 64, fontWeight: '900', letterSpacing: -3, lineHeight: 68, ...tabular },
  heroUnit: { color: Void.textTertiary, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  heroSub: { color: Void.textSecondary, fontSize: 13, marginTop: 2 },
  heroPills: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: '800', ...tabular },
  empty: { color: Void.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', paddingVertical: 8 },
  // Today snapshot
  todayGrid: { flexDirection: 'row', gap: 0 },
  todayCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  todayIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: Void.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  todayVal: { color: Void.text, fontSize: 22, fontWeight: '900', ...tabular },
  todayLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },
  calProgressTrack: { height: 6, borderRadius: 3, backgroundColor: Void.surfaceRaised, marginTop: 14, overflow: 'hidden' },
  calProgressFill: { height: 6, borderRadius: 3 },
  calProgressFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  calProgressText: { color: Void.textTertiary, fontSize: 11, fontWeight: '600', ...tabular },
  // Calorie chart
  calBars: { flexDirection: 'row', height: 100, alignItems: 'flex-end', gap: 3, paddingTop: 16 },
  calBarWrap: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  calBar: { borderRadius: 3 },
  calBarOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  calTargetLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: AMBER, flexDirection: 'row', justifyContent: 'flex-end' },
  calTargetLabel: { color: AMBER, fontSize: 9, fontWeight: '700', position: 'absolute', right: 0, top: -12, ...tabular },
  calLabels: { flexDirection: 'row', gap: 3, marginTop: 4 },
  calLabel: { flex: 1, textAlign: 'center', color: Void.textTertiary, fontSize: 8, fontWeight: '600' },
  // WeekBars (activity charts)
  weekBars: { flexDirection: 'row', height: 110, gap: 6, paddingTop: 16 },
  weekBarCol: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  weekBarVal: { color: Void.textSecondary, fontSize: 8, fontWeight: '700', marginBottom: 4, ...tabular },
  weekBarFill: { width: '100%', borderRadius: 4 },
  weekBarDay: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', marginTop: 6 },
  // Macro bar
  macroBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 10 },
  macroSeg: { height: 6 },
  macroLegend: { flexDirection: 'row', gap: 16, marginTop: 12, justifyContent: 'center' },
  macroLegItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroDot: { width: 8, height: 8, borderRadius: 4 },
  macroLegText: { color: Void.textSecondary, fontSize: 11, fontWeight: '600' },
  // Body
  bodyGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  bodyCell: { width: '50%', paddingVertical: 8 },
  bodyVal: { color: Void.text, fontSize: 22, fontWeight: '900', ...tabular },
  bodyLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  bodyNote: { color: Void.textSecondary, fontSize: 12, marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  // Insights
  insight: { flexDirection: 'row', gap: 12, ...cardChrome, borderRadius: 12, padding: 14 },
  insightLock: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,6,6,0.72)',
    borderRadius: 12,
  },
  insightLockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  insightLockText: { color: Void.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  insightIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  insightTitle: { color: Void.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  insightBody: { color: Void.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  // Lifts
  liftRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  liftRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  liftName: { color: Void.text, fontSize: 15, fontWeight: '600' },
  liftMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  liftValue: { color: Void.text, fontSize: 18, fontWeight: '800', ...tabular },
  liftUnit: { color: Void.textTertiary, fontSize: 12, fontWeight: '600' },
  liftDelta: { fontSize: 11, fontWeight: '700', marginTop: 2, ...tabular },
  // PRs
  prRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  prName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  prMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  prValue: { color: Void.accent, fontSize: 15, fontWeight: '800', ...tabular },
  prDate: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  // Streak
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  streakFlame: { width: 56, height: 56, borderRadius: 16, backgroundColor: Void.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  streakValue: { color: Void.text, fontSize: 32, fontWeight: '900', letterSpacing: -1, ...tabular },
  streakUnit: { color: Void.textTertiary, fontSize: 14, fontWeight: '700', letterSpacing: 0 },
  streakSub: { color: Void.textSecondary, fontSize: 13, marginTop: 2 },
  streakWeeks: { flexDirection: 'row', gap: 6, marginTop: 16 },
  streakDot: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Void.surfaceRaised },
  streakDotHit: { backgroundColor: AMBER },
  streakDotNow: { borderWidth: 1, borderColor: AMBER },
  heatFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  heatFootText: { color: Void.textTertiary, fontSize: 11, ...tabular },
  // Volume rows
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  volMuscle: { color: Void.textSecondary, fontSize: 12, width: 80 },
  volTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: Void.surfaceRaised, overflow: 'hidden' },
  volZone: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(204,255,0,0.10)' },
  volFill: { height: 10, borderRadius: 5 },
  volSets: { fontSize: 12, fontWeight: '800', width: 24, textAlign: 'right', ...tabular },
  volHint: { color: Void.textTertiary, fontSize: 11, marginTop: 10, lineHeight: 16 },
  // Split
  splitBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: Void.surfaceRaised },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  splitItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitDot: { width: 8, height: 8, borderRadius: 4 },
  splitLabel: { color: Void.textSecondary, fontSize: 12 },
  splitPct: { color: Void.text, fontSize: 12, fontWeight: '700', ...tabular },
  // Meals
  mealGrid: { flexDirection: 'row', gap: 0 },
  mealCell: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  mealVal: { color: Void.text, fontSize: 24, fontWeight: '900', marginTop: 6, ...tabular },
  mealLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  // Lifetime
  lifeGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  lifeCell: { width: '50%', paddingVertical: 10 },
  lifeValue: { color: Void.text, fontSize: 24, fontWeight: '900', ...tabular },
  lifeLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  lifeFun: { color: Void.accent, fontSize: 13, fontWeight: '600', marginTop: 6 },
  // Friends comparison
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  cmpLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, width: 72 },
  cmpVals: { flex: 1, flexDirection: 'row', gap: 12 },
  cmpCell: { flex: 1, alignItems: 'center' },
  cmpName: { color: Void.textSecondary, fontSize: 10, fontWeight: '600', marginBottom: 2 },
  cmpVal: { color: Void.text, fontSize: 14, fontWeight: '800', ...tabular },
});
