import { useFocusEffect, useRouter } from 'expo-router';
import {
    Activity,
    Bike,
    ChevronRight,
    Download,
    Flame,
    Footprints,
    HeartPulse,
    Mountain,
    PersonStanding,
    Plus,
    Timer,
    Waves
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { VitalsSheet } from '@/components/body/VitalsSheet';
import { Card, Screen, ScreenHeader, SectionLabel, Stat } from '@/components/ui';
import { deleteCardio, listCardio } from '@/db/repo/cardio';
import { listMeasurements, logMeasurement } from '@/db/repo/measurements';
import {
    ACTIVITY_META,
    distancePBs,
    distanceUnitFor,
    formatCardioDuration,
    formatDistance,
    formatExtras,
    formatPace,
    paceMinPerKm,
    ZONE_LABELS,
    type CardioActivity,
    type DistancePB,
} from '@/lib/cardio';
import { formatDate } from '@/lib/format';
import { importGoogleHealthData } from '@/lib/googleHealthImport';
import { getTodayHeartRate, requestHealthAuth } from '@/lib/health';
import { importHealthData } from '@/lib/healthImport';
import { goBack } from '@/lib/nav';
import { HEALTH_QUOTA_MESSAGE, HealthQuotaError, showUpgradePrompt } from '@/lib/tiers';
import type { CardioSession } from '@/lib/types';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

const AMBER = '#FFB800';
const ZONE_COLORS = [Void.borderStrong, '#7DD3FC', Void.accent, AMBER, '#FF5C5C'];

const ACTIVITY_ICON: Record<CardioActivity, typeof Footprints> = {
  run: Footprints,
  cycle: Bike,
  swim: Waves,
  row: PersonStanding,
  walk: Footprints,
  hike: Mountain,
  elliptical: Timer,
  stairs: Mountain,
  other: Timer,
};

/** Activities surfaced as one-tap quick-log tiles. */
const QUICK_LOG: CardioActivity[] = ['run', 'cycle', 'walk', 'swim'];

interface Vitals {
  sleep: number | null;
  restingHr: number | null;
  hrMin: number | null;
  hrMax: number | null;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CardioScreen() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const weightUnit = useSettings((s) => s.weight_unit);
  const dist = distanceUnitFor(weightUnit);
  const birthYear = useSettings((s) => s.birth_year);
  const healthConnected = useSettings((s) => s.health_connected);
  const fitbitConnected = useSettings((s) => s.fitbit_connected);
  const setSettings = useSettings((s) => s.set);
  const [sessions, setSessions] = useState<CardioSession[]>([]);
  const [pbs, setPbs] = useState<DistancePB[]>([]);
  const [importing, setImporting] = useState(false);
  const [vitals, setVitals] = useState<Vitals>({ sleep: null, restingHr: null, hrMin: null, hrMax: null });
  const [hourlyHr, setHourlyHr] = useState<{ hour: number; bpm: number }[]>([]);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [chartMode, setChartMode] = useState<'distance' | 'time'>('distance');

  const refresh = useCallback(async () => {
    const [s, hrs, sleeps] = await Promise.all([
      listCardio(),
      listMeasurements('resting_hr'),
      listMeasurements('sleep_hours'),
    ]);
    setSessions(s);
    setPbs(distancePBs(s));
    const hrVals = hrs.map((h) => h.value);
    setVitals({
      sleep: sleeps[0]?.value ?? null,
      restingHr: hrs[0]?.value ?? null,
      hrMin: hrVals.length ? Math.min(...hrVals) : null,
      hrMax: hrVals.length ? Math.max(...hrVals) : null,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Silent re-import on every visit once health access was granted - reads
      // fail soft without it, and external_id/day dedupe makes it idempotent.
      if (healthConnected) {
        void importHealthData(userId)
          .then(refresh)
          .catch((e) => console.warn('[health] focus import failed', e));
        void getTodayHeartRate().then(setHourlyHr);
      }
      if (fitbitConnected) {
        void importGoogleHealthData(userId)
          .then(refresh)
          .catch((e) => console.warn('[ghealth] focus import failed', e));
      }
    }, [refresh, healthConnected, fitbitConnected, userId])
  );

  const onImport = async () => {
    if (importing) return;
    console.log('[dbg-cardio] onImport pressed');
    setImporting(true);
    try {
      const { status, error } = await requestHealthAuth();
      console.log('[dbg-cardio] requestHealthAuth:', status, error ?? '');
      if (status !== 'authorized') {
        notify(
          'Health unavailable',
          { body: error ?? (status === 'unavailable'
            ? 'Apple Health / Health Connect is not available on this device.'
            : 'Permission denied - check Health permissions in Settings > Privacy & Security > Health.'), tone: 'error' }
        );
        return;
      }
      const age = birthYear ? new Date().getFullYear() - birthYear : null;
      const res = await importHealthData(userId, { maxHr: age ? 220 - age : 190 });
      setSettings({ health_connected: true });
      await refresh();
      setHourlyHr(await getTodayHeartRate());
      notify(
        'Import complete',
        { body:
          `${res.cardio} cardio session${res.cardio === 1 ? '' : 's'}, ` +
          `${res.sleep} sleep night${res.sleep === 1 ? '' : 's'}, ` +
          `${res.restingHr} resting HR reading${res.restingHr === 1 ? '' : 's'} imported.`, tone: 'success' }
      );
    } catch (e) {
      if (e instanceof HealthQuotaError) {
        showUpgradePrompt('Weekly import limit', HEALTH_QUOTA_MESSAGE);
      } else {
        notify('Import failed', {
          body: e instanceof Error ? e.message : 'Health import failed - try again.',
          tone: 'error',
        });
      }
    } finally {
      setImporting(false);
    }
  };

  // -- Derived stats ----------------------------------------------------------
  const derived = useMemo(() => {
    const now = Date.now();
    const week = sessions.filter((s) => now - new Date(s.started_at).getTime() < 7 * 86400000);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const month = sessions.filter((s) => new Date(s.started_at).getTime() >= monthStart.getTime());

    const sum = (list: CardioSession[]) => ({
      n: list.length,
      m: list.reduce((a, s) => a + (s.distance_m ?? 0), 0),
      sec: list.reduce((a, s) => a + s.duration_seconds, 0),
      kcal: list.reduce((a, s) => a + (s.calories ?? 0), 0),
    });
    const w = sum(week);
    const mo = sum(month);
    const avgPace = paceMinPerKm(w.m, w.sec);

    // Last 7 calendar days, oldest → newest.
    const days: { key: string; m: number; sec: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      days.push({ key: dayKey(d.toISOString()), m: 0, sec: 0 });
    }
    const byDay = new Map(days.map((d) => [d.key, d]));
    for (const s of sessions) {
      const bucket = byDay.get(dayKey(s.started_at));
      if (bucket) {
        bucket.m += s.distance_m ?? 0;
        bucket.sec += s.duration_seconds;
      }
    }
    return { week: w, month: mo, avgPace, days };
  }, [sessions]);

  const chartHasDistance = derived.days.some((d) => d.m > 0);
  const mode = chartMode === 'distance' && !chartHasDistance ? 'time' : chartMode;

  return (
    <Screen>
      <ScreenHeader
        title="Cardio"
        onBack={() => goBack()}
        right={
          <Pressable
            onPress={() => router.push('/cardio/new')}
            hitSlop={8}
            style={styles.headerBtn}>
            <Plus color={Void.accentText} size={16} strokeWidth={3} />
            <Text style={styles.headerBtnText}>LOG</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Hero - this week + this month */}
        <Card style={styles.heroCard}>
          <Text style={styles.heroLabel}>THIS WEEK</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroValue}>
              {derived.week.m > 0 ? formatDistance(derived.week.m, dist) : formatCardioDuration(derived.week.sec)}
            </Text>
            {derived.week.m > 0 && (
              <Text style={styles.heroSub}>{formatCardioDuration(derived.week.sec)} moving</Text>
            )}
          </View>
          <View style={styles.statRow}>
            <Stat label="SESSIONS" value={String(derived.week.n)} />
            <Stat
              label="DISTANCE"
              value={derived.week.m > 0 ? formatDistance(derived.week.m, dist) : '-'}
            />
            <Stat
              label="AVG PACE"
              value={derived.avgPace != null ? `${formatPace(derived.avgPace, dist)}/${dist}` : '-'}
              accent
            />
            <Stat
              label="KCAL"
              value={derived.week.kcal > 0 ? String(Math.round(derived.week.kcal)) : '-'}
            />
          </View>
          <View style={styles.monthRow}>
            <Text style={styles.monthLabel}>THIS MONTH</Text>
            <Text style={styles.monthVals}>
              {derived.month.n} session{derived.month.n === 1 ? '' : 's'}
              {derived.month.m > 0 ? ` · ${formatDistance(derived.month.m, dist)}` : ''}
              {` · ${formatCardioDuration(derived.month.sec)}`}
              {derived.month.kcal > 0 ? ` · ${Math.round(derived.month.kcal)} kcal` : ''}
            </Text>
          </View>
        </Card>

        {/* Last 7 days bar chart */}
        {derived.days.some((d) => d.m > 0 || d.sec > 0) && (
          <Card style={styles.chartCard}>
            <View style={styles.chartHead}>
              <Text style={styles.chartTitle}>LAST 7 DAYS</Text>
              {chartHasDistance && (
                <View style={styles.chartToggle}>
                  {(['distance', 'time'] as const).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.togglePill, mode === m && styles.togglePillOn]}
                      onPress={() => setChartMode(m)}>
                      <Text style={[styles.toggleText, mode === m && { color: Void.accentText }]}>
                        {m === 'distance' ? 'DIST' : 'TIME'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <WeekChart days={derived.days} mode={mode} />
          </Card>
        )}

        {/* Quick-log tiles */}
        <SectionLabel>QUICK LOG</SectionLabel>
        <View style={styles.quickRow}>
          {QUICK_LOG.map((a) => {
            const Icon = ACTIVITY_ICON[a];
            return (
              <Pressable
                key={a}
                style={({ pressed }) => [styles.quickTile, pressed && { backgroundColor: Void.surfacePressed }]}
                onPress={() => router.push({ pathname: '/cardio/new', params: { activity: a } })}>
                <View style={styles.quickIcon}>
                  <Icon color={Void.accent} size={18} />
                </View>
                <Text style={styles.quickLabel}>{ACTIVITY_META[a].label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            style={({ pressed }) => [styles.quickTile, pressed && { backgroundColor: Void.surfacePressed }]}
            onPress={() => router.push('/cardio/new')}>
            <View style={styles.quickIcon}>
              <Plus color={Void.accent} size={18} />
            </View>
            <Text style={styles.quickLabel}>Other</Text>
          </Pressable>
        </View>

        {/* Vitals - resting HR, sleep, today's heart rate */}
        <SectionLabel>VITALS</SectionLabel>
        <Card>
          <View style={styles.vitalsGrid}>
            <View style={styles.vitalsCell}>
              <Text style={styles.vitalsVal}>{vitals.restingHr ?? '-'}</Text>
              <Text style={styles.vitalsLabel}>RESTING BPM</Text>
            </View>
            <View style={styles.vitalsCell}>
              <Text style={styles.vitalsVal}>{vitals.hrMin ?? '-'}</Text>
              <Text style={styles.vitalsLabel}>MIN · 30D</Text>
            </View>
            <View style={styles.vitalsCell}>
              <Text style={styles.vitalsVal}>{vitals.hrMax ?? '-'}</Text>
              <Text style={styles.vitalsLabel}>MAX · 30D</Text>
            </View>
            <View style={styles.vitalsCell}>
              <Text style={styles.vitalsVal}>{vitals.sleep != null ? `${vitals.sleep}h` : '-'}</Text>
              <Text style={styles.vitalsLabel}>LAST NIGHT</Text>
            </View>
          </View>
          {hourlyHr.length > 0 && (
            <>
              <View style={styles.hrChart}>
                {Array.from({ length: 24 }, (_, h) => {
                  const hit = hourlyHr.find((x) => x.hour === h);
                  const vals = hourlyHr.map((x) => x.bpm);
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const span = max - min || 1;
                  const heightPct = hit ? 0.2 + ((hit.bpm - min) / span) * 0.8 : 0;
                  return (
                    <View key={h} style={styles.hrBarWrap}>
                      <View
                        style={[
                          styles.hrBar,
                          { height: `${Math.round(heightPct * 100)}%` },
                          !hit && styles.hrBarEmpty,
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.hrChartFooter}>
                <Text style={styles.hrChartLabel}>12AM</Text>
                <Text style={styles.hrChartLabel}>6AM</Text>
                <Text style={styles.hrChartLabel}>12PM</Text>
                <Text style={styles.hrChartLabel}>6PM</Text>
                <Text style={styles.hrChartLabel}>11PM</Text>
              </View>
            </>
          )}
          <Pressable style={styles.vitalsLog} onPress={() => setVitalsOpen(true)} hitSlop={6}>
            <HeartPulse color={Void.accent} size={12} />
            <Text style={styles.vitalsLogText}>LOG VITALS</Text>
          </Pressable>
        </Card>

        {/* Health import */}
        <Card style={{ paddingVertical: 6, marginTop: 8 }}>
          <Pressable style={styles.importRow} onPress={() => void onImport()} disabled={importing}>
            <Activity color={importing ? Void.textTertiary : Void.accent} size={18} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.importLabel}>
                {Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'}
              </Text>
              <Text style={styles.importSub}>
                {importing
                  ? 'Importing…'
                  : 'Import workouts, HR zones, sleep & resting HR'}
              </Text>
            </View>
            <Download color={importing ? Void.textTertiary : Void.accent} size={18} />
          </Pressable>
        </Card>

        {pbs.length > 0 && (
          <>
            <SectionLabel>PERSONAL BESTS</SectionLabel>
            <Card style={{ paddingVertical: 4 }}>
              {pbs.map((p, i) => (
                <View key={`${p.activity}-${p.distanceM}`} style={[styles.pbRow, i < pbs.length - 1 && styles.border]}>
                  <Text style={styles.pbDist}>{p.label}</Text>
                  <Text style={styles.pbAct}>{ACTIVITY_META[p.activity].label}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.pbTime}>{formatCardioDuration(p.seconds)}</Text>
                  {p.pace != null && <Text style={styles.pbPace}>{formatPace(p.pace, dist)}/{dist}</Text>}
                </View>
              ))}
            </Card>
          </>
        )}

        {sessions.length > 0 && <SectionLabel>SESSIONS</SectionLabel>}
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} onDelete={async () => {
            const ok = await confirm({
              title: 'Delete session?',
              body: `${ACTIVITY_META[s.activity].label} · ${formatDate(s.started_at)}`,
              confirmText: 'DELETE',
              destructive: true,
            });
            if (!ok) return;
            await deleteCardio(s.id);
            await refresh();
          }} />
        ))}

        {sessions.length === 0 && (
          <Card style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Footprints color={Void.accent} size={22} />
            </View>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.empty}>
              Log a run, ride or swim in seconds - or pull in everything your
              watch already tracked with{' '}
              {Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'}.
            </Text>
            <View style={styles.emptyActions}>
              <Pressable style={styles.emptyPrimary} onPress={() => router.push('/cardio/new')}>
                <Text style={styles.emptyPrimaryText}>LOG CARDIO</Text>
              </Pressable>
              <Pressable style={styles.emptyGhost} onPress={() => void onImport()}>
                <Text style={styles.emptyGhostText}>IMPORT</Text>
                <ChevronRight color={Void.accent} size={14} />
              </Pressable>
            </View>
          </Card>
        )}
      </ScrollView>

      <VitalsSheet
        visible={vitalsOpen}
        defaultSleep={vitals.sleep ?? 7.5}
        defaultHr={vitals.restingHr ?? 60}
        onClose={() => setVitalsOpen(false)}
        onSave={(sleepHrs, restingHr) => {
          void logMeasurement({ metric_type: 'sleep_hours', value: sleepHrs, user_id: userId });
          void logMeasurement({ metric_type: 'resting_hr', value: restingHr, user_id: userId });
          setVitalsOpen(false);
          void refresh();
        }}
      />
    </Screen>
  );
}

/** 7-day mini bar chart: distance (km) or minutes per day. */
function WeekChart({
  days,
  mode,
}: {
  days: { key: string; m: number; sec: number }[];
  mode: 'distance' | 'time';
}) {
  const val = (d: { m: number; sec: number }) => (mode === 'distance' ? d.m / 1000 : d.sec / 60);
  const max = Math.max(...days.map(val), 1);
  const today = dayKey(new Date().toISOString());
  return (
    <View style={styles.weekBars}>
      {days.map((d) => {
        const v = val(d);
        const isToday = d.key === today;
        return (
          <View key={d.key} style={styles.weekBarCol}>
            <Text style={styles.weekBarVal} numberOfLines={1}>
              {v > 0 ? (mode === 'distance' ? v.toFixed(1) : `${Math.round(v)}m`) : ''}
            </Text>
            <View
              style={[
                styles.weekBarFill,
                {
                  height: `${Math.max(3, (v / max) * 100)}%`,
                  backgroundColor: v > 0 ? (isToday ? Void.accent : Void.borderStrong) : Void.border,
                },
              ]}
            />
            <Text style={[styles.weekBarDay, isToday && { color: Void.accent }]}>
              {new Date(`${d.key}T12:00:00`).toLocaleDateString('en', { weekday: 'narrow' })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SessionRow({ s, onDelete }: { s: CardioSession; onDelete: () => void }) {
  const dist = distanceUnitFor(useSettings((st) => st.weight_unit));
  const Icon = ACTIVITY_ICON[s.activity] ?? Timer;
  const pace = paceMinPerKm(s.distance_m, s.duration_seconds);
  const extrasText = formatExtras(
    s.meta ? (JSON.parse(s.meta) as Record<string, number>) : null,
    s.activity
  );
  return (
    <Pressable onLongPress={() => void onDelete()} delayLongPress={400}>
      <Card style={styles.sessionCard}>
        <View style={styles.sessionRow}>
          <View style={styles.sessionIcon}>
            <Icon color={Void.accent} size={18} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.sessionTitleRow}>
              <Text style={styles.sessionName}>{ACTIVITY_META[s.activity].label}</Text>
              {s.source !== 'manual' && (
                <View style={styles.importedPill}>
                  <Text style={styles.importedText}>IMPORTED</Text>
                </View>
              )}
            </View>
            <Text style={styles.sessionMeta}>
              {s.distance_m != null ? `${formatDistance(s.distance_m, dist)} · ` : ''}
              {formatCardioDuration(s.duration_seconds)}
              {pace != null ? ` · ${formatPace(pace, dist)}/${dist}` : ''}
              {s.avg_hr != null ? ` · ${s.avg_hr} bpm` : ''}
              {extrasText ? ` · ${extrasText}` : ''}
            </Text>
          </View>
          <View style={styles.sessionRight}>
            <Text style={styles.sessionDate}>{formatDate(s.started_at)}</Text>
            {s.calories != null && s.calories > 0 && (
              <View style={styles.kcalRow}>
                <Flame color={AMBER} size={10} />
                <Text style={styles.kcalText}>{Math.round(s.calories)}</Text>
              </View>
            )}
          </View>
        </View>
        {s.zone_minutes && <ZoneBar zones={s.zone_minutes} />}
      </Card>
    </Pressable>
  );
}

/** 5-segment bar showing minutes in each HR zone. */
function ZoneBar({ zones }: { zones: [number, number, number, number, number] }) {
  const total = zones.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return (
    <View style={styles.zoneWrap}>
      <View style={styles.zoneBar}>
        {zones.map((z, i) =>
          z > 0 ? (
            <View
              key={ZONE_LABELS[i]}
              style={{ flex: z, backgroundColor: ZONE_COLORS[i], borderRadius: 2 }}
            />
          ) : null
        )}
      </View>
      <View style={styles.zoneLabels}>
        {zones.map((z, i) => (
          <Text key={ZONE_LABELS[i]} style={styles.zoneText}>
            {ZONE_LABELS[i]} {Math.round(z)}m
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Void.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerBtnText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  heroCard: { marginTop: 4, paddingVertical: 18 },
  heroLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2.5 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6 },
  heroValue: { color: Void.accent, fontSize: 40, fontWeight: '800', letterSpacing: -1, ...tabular },
  heroSub: { color: Void.textTertiary, fontSize: 12, fontWeight: '600', ...tabular },
  statRow: { flexDirection: 'row', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  monthLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  monthVals: { color: Void.textSecondary, fontSize: 12, fontWeight: '600', ...tabular },

  chartCard: { marginTop: 8 },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartTitle: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  chartToggle: { flexDirection: 'row', gap: 4, backgroundColor: Void.surfaceRaised, borderRadius: 999, padding: 2 },
  togglePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  togglePillOn: { backgroundColor: Void.accent },
  toggleText: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  weekBars: { flexDirection: 'row', height: 84, marginTop: 14, gap: 6 },
  weekBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  weekBarVal: { color: Void.textTertiary, fontSize: 8, fontWeight: '700', marginBottom: 3, ...tabular },
  weekBarFill: { width: '100%', borderRadius: 3 },
  weekBarDay: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', marginTop: 5 },

  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  quickTile: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 12,
    paddingVertical: 13,
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Void.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { color: Void.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

  importRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  importLabel: { color: Void.text, fontSize: 14, fontWeight: '600' },
  importSub: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  vitalsGrid: { flexDirection: 'row', paddingVertical: 4 },
  vitalsCell: { flex: 1, alignItems: 'center' },
  vitalsVal: { color: Void.accent, fontSize: 20, fontWeight: '800', ...tabular },
  vitalsLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 3 },
  hrChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 56,
    gap: 2,
    marginTop: 14,
  },
  hrBarWrap: { flex: 1, justifyContent: 'flex-end', height: '100%' },
  hrBar: { backgroundColor: Void.accent, borderRadius: 1.5, minHeight: 2 },
  hrBarEmpty: { backgroundColor: Void.border, height: 2 },
  hrChartFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  hrChartLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700' },
  vitalsLog: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 12,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  vitalsLogText: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  pbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  pbDist: { color: Void.accent, fontSize: 13, fontWeight: '800', width: 70, letterSpacing: 1 },
  pbAct: { color: Void.textSecondary, fontSize: 12 },
  pbTime: { color: Void.text, fontSize: 15, fontWeight: '700', ...tabular },
  pbPace: { color: Void.textTertiary, fontSize: 11, ...tabular },
  sessionCard: { marginBottom: 8 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Void.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sessionName: { color: Void.text, fontSize: 15, fontWeight: '700' },
  importedPill: {
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  importedText: { color: Void.textTertiary, fontSize: 7, fontWeight: '800', letterSpacing: 1 },
  sessionMeta: { color: Void.textTertiary, fontSize: 12, marginTop: 2, ...tabular },
  sessionRight: { alignItems: 'flex-end', gap: 4 },
  sessionDate: { color: Void.textTertiary, fontSize: 11 },
  kcalRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  kcalText: { color: AMBER, fontSize: 11, fontWeight: '700', ...tabular },
  zoneWrap: { marginTop: 10 },
  zoneBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 },
  zoneLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  zoneText: { color: Void.textTertiary, fontSize: 9, ...tabular },
  emptyCard: { alignItems: 'center', paddingVertical: 26 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Void.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: Void.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  empty: { color: Void.textTertiary, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 10 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  emptyPrimary: { backgroundColor: Void.accent, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  emptyPrimaryText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  emptyGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  emptyGhostText: { color: Void.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
