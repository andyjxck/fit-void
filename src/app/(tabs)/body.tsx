import { useFocusEffect } from 'expo-router';
import { Plus, Settings2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { DailyCheckIn } from '@/components/body/DailyCheckIn';
import { applyGoogleProfileFields, applyHealthProfileFields } from '@/components/IntegrationsCard';
import { Card, cardChrome, CardSheen, FocusToggle, Screen, ScreenHeader, SectionLabel } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { listMeasurements, logMeasurement } from '@/db/repo/measurements';
import {
    ACTIVITY,
    ageFromBirthYear,
    bmi,
    bmiCategory,
    bmr,
    calorieTarget,
    cmToFtIn,
    estimateBodyFat,
    GOALS,
    proteinTarget,
    tdee,
    weeklyWeightAverages,
    type ActivityLevel,
    type Goal,
    type Sex,
} from '@/lib/body';
import { displayWeight, parseWeight } from '@/lib/format';
import { importGoogleHealthData } from '@/lib/googleHealthImport';
import { getHealthToday, isHealthAvailable, saveWeightToHealth, type HealthToday } from '@/lib/health';
import { importHealthData } from '@/lib/healthImport';
import { isEverything, isTabMuted, parseIntents, type Intent } from '@/lib/intents';
import type { BodyMeasurement, MetricType } from '@/lib/types';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

const AMBER = '#FFB800';
const CYAN = '#7DD3FC';

const MEASURES: { key: MetricType; label: string; unit: 'cm' | '%' }[] = [
  { key: 'body_fat', label: 'Body fat', unit: '%' },
  { key: 'waist', label: 'Waist', unit: 'cm' },
  { key: 'chest', label: 'Chest', unit: 'cm' },
  { key: 'arm', label: 'Arm', unit: 'cm' },
  { key: 'thigh', label: 'Thigh', unit: 'cm' },
];

export default function BodyScreen() {
  const settings = useSettings();
  const unit = settings.weight_unit;
  const userId = settings.supabase_user_id;
  // Girths/lengths store canonically in cm; lbs users enter+read inches.
  const lenUnit = unit === 'lbs' ? 'in' : 'cm';
  const dispLen = (cm: number) => (unit === 'lbs' ? Math.round((cm / 2.54) * 10) / 10 : cm);

  const [weights, setWeights] = useState<BodyMeasurement[]>([]);
  const [measures, setMeasures] = useState<Record<string, BodyMeasurement | undefined>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [measuresOpen, setMeasuresOpen] = useState(false);
  const [logMetric, setLogMetric] = useState<{ key: MetricType; label: string; unit: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [healthConnected, setHealthConnected] = useState(false);
  const [healthToday, setHealthToday] = useState<HealthToday | null>(null);


  const refresh = useCallback(async () => {
    const [w, all] = await Promise.all([listMeasurements('weight'), listMeasurements()]);
    setWeights(w);
    const latest: Record<string, BodyMeasurement> = {};
    for (const m of all) if (!latest[m.metric_type]) latest[m.metric_type] = m;
    setMeasures(latest);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Only check availability on focus - requestHealthAuth() would pop the
      // HealthKit permission sheet without consent. Auth is requested from the
      // Connect button only.
      void (async () => {
        const available = await isHealthAvailable();
        setHealthConnected(available && useSettings.getState().health_connected);
      })();
      // Silent refresh of vitals/cardio whenever health access was granted before.
      if (settings.health_connected) {
        void importHealthData(userId)
          .then(refresh)
          .catch((e) => console.warn('[health] focus import failed', e));
        void getHealthToday().then(setHealthToday);
        // Fill profile fields Apple Health already knows (DOB, sex, height).
        void applyHealthProfileFields();
      }
      // Same silent re-import for Google Health - external_id/day dedupe is idempotent.
      if (settings.fitbit_connected) {
        void importGoogleHealthData(userId)
          .then(refresh)
          .catch((e) => console.warn('[ghealth] focus import failed', e));
        // Fill any profile fields Google already knows (height, birth year,
        // sex, activity) - only when unset, so manual edits are never clobbered.
        void applyGoogleProfileFields();
      }
    }, [refresh, applyGoogleProfileFields, settings.health_connected, settings.fitbit_connected, userId])
  );

  // -- Derived -------------------------------------------------------------
  const weightKg = weights[0]?.value ?? null;
  const monthAgo = weights.find((w) => Date.now() - new Date(w.logged_at).getTime() >= 28 * 86400000);
  const weightDelta = weightKg != null && monthAgo ? weightKg - monthAgo.value : null;
  const age = ageFromBirthYear(settings.birth_year);
  const profileComplete = settings.height_cm != null && age != null && settings.sex != null;

  const bmiV = weightKg != null && settings.height_cm ? bmi(weightKg, settings.height_cm) : null;
  const bmiCat = bmiV != null ? bmiCategory(bmiV) : null;
  // BMI-based estimate (Deurenberg) - shown only when no manual body-fat
  // measurement exists, and pre-fills the logger so one tap saves it.
  const bodyFatEstimate =
    measures['body_fat'] == null && bmiV != null && age != null && settings.sex != null
      ? estimateBodyFat(bmiV, age, settings.sex)
      : null;
  const bmrV = profileComplete && weightKg != null ? bmr(weightKg, settings.height_cm!, age!, settings.sex!) : null;
  const tdeeV = bmrV != null ? tdee(bmrV, settings.activity_level) : null;
  const target = settings.calorie_override ?? (tdeeV != null ? calorieTarget(tdeeV, settings.goal) : null);
  const proteinT = weightKg != null ? proteinTarget(weightKg, settings.goal) : null;
  const weeklyWeights = weeklyWeightAverages(weights, 12);

  // Focus-adaptive section visibility - ALL (empty selection) shows
  // everything, a muted-but-entered tab shows everything, and the header
  // toggle reveals hidden sections on demand.
  const activeIntents = parseIntents(useSettings((s) => s.active_intents));
  const tabMuted = isTabMuted('body', activeIntents);
  const [showEverything, setShowEverything] = useState(false);
  const showAll = isEverything(activeIntents) || tabMuted || showEverything;
  const showBodyComp = showAll || activeIntents.includes('body_comp');
  const showRecovery = showAll || activeIntents.includes('recovery');
  const showCardioSection = showAll || activeIntents.includes('cardio');
  const partiallyFiltered =
    !isEverything(activeIntents) && !tabMuted &&
    (['body_comp', 'recovery', 'cardio'] as Intent[]).some((f) => !activeIntents.includes(f));

  // Daily check-in: today's sleep / resting HR, null when not yet logged today.
  const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
  const sleepToday = measures['sleep_hours'] && isToday(measures['sleep_hours'].logged_at)
    ? measures['sleep_hours'].value
    : null;
  const hrToday = measures['resting_hr'] && isToday(measures['resting_hr'].logged_at)
    ? measures['resting_hr'].value
    : null;
  const hrvToday = measures['hrv'] && isToday(measures['hrv'].logged_at)
    ? measures['hrv'].value
    : null;

  const saveCheckIn = async (sleepHrs: number | null, restingHr: number | null) => {
    if (sleepHrs != null) {
      await logMeasurement({ metric_type: 'sleep_hours', value: sleepHrs, user_id: userId });
    }
    if (restingHr != null) {
      await logMeasurement({ metric_type: 'resting_hr', value: restingHr, user_id: userId });
    }
    void refresh();
  };

  const saveMetric = async () => {
    if (!logMetric) return;
    const raw = draft.replace(',', '.');
    const value =
      logMetric.key === 'weight'
        ? parseWeight(raw, unit)
        : logMetric.unit === 'in'
          ? parseFloat(raw) * 2.54 // inches in, cm stored
          : parseFloat(raw);
    if (value != null && Number.isFinite(value) && value > 0) {
      await logMeasurement({ metric_type: logMetric.key, value, user_id: userId });
      // Write weight to Apple Health if connected
      if (logMetric.key === 'weight' && healthConnected) {
        void saveWeightToHealth(value);
      }
      void refresh();
    }
    setLogMetric(null);
    setDraft('');
  };

  return (
    <Screen>
      <ScreenHeader
        title="Body"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {partiallyFiltered && <FocusToggle showAll={showEverything} onToggle={() => setShowEverything((v) => !v)} />}
            <Pressable onPress={() => setProfileOpen(true)} hitSlop={8}>
              <Settings2 color={Void.textSecondary} size={22} />
            </Pressable>
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Hero - weight */}
        {showBodyComp && (
        <Pressable style={styles.hero} onPress={() => setLogMetric({ key: 'weight', label: 'Bodyweight', unit })}>
          <Text style={styles.heroLabel}>BODYWEIGHT</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroValue}>{weightKg != null ? displayWeight(weightKg, unit) : '-'}</Text>
            <Text style={styles.heroUnit}>{unit}</Text>
            <View style={styles.heroLog}>
              <Plus color={Void.accentText} size={16} />
            </View>
          </View>
          <View style={styles.pills}>
            {weightDelta != null && Math.abs(weightDelta) >= 0.1 && (
              <View style={[styles.pill, { borderColor: Void.borderStrong }]}>
                <Text style={styles.pillText}>
                  {weightDelta > 0 ? '+' : '−'}
                  {displayWeight(Math.abs(weightDelta), unit)} {unit} · 4 wk
                </Text>
              </View>
            )}
            {bmiV != null && bmiCat && (
              <View style={[styles.pill, { borderColor: bmiCat.tone === 'ok' ? Void.accent : bmiCat.tone === 'low' ? CYAN : AMBER }]}>
                <Text style={[styles.pillText, { color: bmiCat.tone === 'ok' ? Void.accent : bmiCat.tone === 'low' ? CYAN : AMBER }]}>
                  BMI {bmiV} · {bmiCat.label}
                </Text>
              </View>
            )}
            {weightKg == null && <Text style={styles.heroHint}>Tap to log your first weigh-in</Text>}
          </View>
        </Pressable>
        )}

        {/* Daily recovery check-in - shown until today's values are logged */}
        {showRecovery && (
        <DailyCheckIn
          sleepToday={sleepToday}
          restingHrToday={hrToday}
          defaultRestingHr={measures['resting_hr']?.value ?? 60}
          hrvToday={hrvToday}
          onSave={(s, h) => void saveCheckIn(s, h)}
        />
        )}

        {/* Today's activity from the connected health platform */}
        {showCardioSection && healthConnected && healthToday != null && (
          <>
            <SectionLabel>ACTIVITY · TODAY</SectionLabel>
            <Card>
              <View style={styles.actGrid}>
                <View style={styles.actCell}>
                  <Text style={styles.actVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {healthToday.steps.toLocaleString()}
                  </Text>
                  <Text style={styles.actLabel}>STEPS</Text>
                </View>
                <View style={styles.actCell}>
                  <Text style={styles.actVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {healthToday.activeKcal}
                  </Text>
                  <Text style={styles.actLabel}>ACTIVE KCAL</Text>
                </View>
                <View style={styles.actCell}>
                  <Text style={styles.actVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {healthToday.distanceM >= 1000
                      ? `${(healthToday.distanceM / 1000).toFixed(1)} km`
                      : `${Math.round(healthToday.distanceM)} m`}
                  </Text>
                  <Text style={styles.actLabel}>DISTANCE</Text>
                </View>
                <View style={styles.actCell}>
                  <Text style={styles.actVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                    {healthToday.exerciseMin}
                  </Text>
                  <Text style={styles.actLabel}>EXERCISE MIN</Text>
                </View>
              </View>
              {(healthToday.flights > 0 || healthToday.standHours > 0 || healthToday.hrvMs != null) && (
                <View style={styles.actSub}>
                  {healthToday.standHours > 0 && <Text style={styles.actSubText}>{healthToday.standHours}h standing</Text>}
                  {healthToday.flights > 0 && <Text style={styles.actSubText}>{healthToday.flights} flights</Text>}
                  {healthToday.hrvMs != null && <Text style={styles.actSubText}>HRV {healthToday.hrvMs}ms</Text>}
                </View>
              )}
            </Card>
          </>
        )}

        {/* Weekly bodyweight trend */}
        {showBodyComp && weeklyWeights.filter((w) => w != null).length >= 2 && (
          <>
            <SectionLabel>BODYWEIGHT · WEEKLY</SectionLabel>
            <Card>
              <View style={styles.weekChart}>
                {weeklyWeights.map((w, i) => {
                  const vals = weeklyWeights.filter((x): x is number => x != null);
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const span = max - min || 1;
                  const h = w == null ? 0 : 0.15 + ((w - min) / span) * 0.85;
                  const isLast = i === weeklyWeights.length - 1;
                  return (
                    <View key={i} style={styles.weekBarWrap}>
                      <View
                        style={[
                          styles.weekBar,
                          { height: `${Math.round(h * 100)}%` },
                          w == null && styles.weekBarEmpty,
                          isLast && w != null && styles.weekBarNow,
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.weekChartFooter}>
                <Text style={styles.weekChartLabel}>12 WEEKS AGO</Text>
                <Text style={styles.weekChartLabel}>THIS WEEK</Text>
              </View>
            </Card>
          </>
        )}

        {showBodyComp && !profileComplete && (
          <Pressable onPress={() => setProfileOpen(true)} style={styles.setupCard}>
            <CardSheen />
            <View style={styles.setupIcon}>
              <Settings2 color={Void.accent} size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.setupTitle}>Finish your profile</Text>
              <Text style={styles.setupBody}>Height, age & sex unlock BMI and calorie targets.</Text>
            </View>
            <View style={styles.setupCta}>
              <Text style={styles.setupCtaText}>SET UP</Text>
            </View>
          </Pressable>
        )}

        {/* Energy */}
        {showBodyComp && (
        <>
        <SectionLabel>ENERGY</SectionLabel>
        <Card>
          {bmrV != null && tdeeV != null ? (
            <>
              <View style={styles.energyRow}>
                <View style={styles.energyCell}>
                  <Text style={styles.energyVal}>{bmrV}</Text>
                  <Text style={styles.energyLabel}>RESTING</Text>
                </View>
                <View style={styles.energyCell}>
                  <Text style={styles.energyVal}>{tdeeV}</Text>
                  <Text style={styles.energyLabel}>MAINTENANCE</Text>
                </View>
                <View style={styles.energyCell}>
                  <Text style={[styles.energyVal, { color: Void.accent }]}>{target}</Text>
                  <Text style={styles.energyLabel}>TARGET</Text>
                </View>
              </View>
              <View style={styles.goalRow}>
                {(Object.keys(GOALS) as Goal[]).map((g) => (
                  <Pressable key={g} style={[styles.goal, settings.goal === g && styles.goalOn]} onPress={() => settings.set({ goal: g, calorie_override: null })}>
                    <Text style={[styles.goalText, settings.goal === g && { color: Void.accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{GOALS[g].label}</Text>
                    <Text style={styles.goalHint}>{GOALS[g].hint}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.energyNote}>
                Mifflin-St Jeor × {ACTIVITY[settings.activity_level].label.toLowerCase()} activity{settings.calorie_override != null ? ' · manual target' : ''}. Protein {proteinT} g / day.
              </Text>
              {healthToday != null && healthToday.basalKcal + healthToday.activeKcal > 0 && (
                <Text style={styles.energyNote}>
                  Measured today: {healthToday.basalKcal + healthToday.activeKcal} kcal burned so far
                  ({healthToday.basalKcal} resting + {healthToday.activeKcal} active) - vs {tdeeV} estimated maintenance.
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.empty}>Complete your profile to see resting and maintenance calories.</Text>
          )}
        </Card>

        {/* Measurements - compact, opens modal */}
        <SectionLabel>BODY</SectionLabel>
        <Card style={{ paddingVertical: 6 }}>
          <Pressable
            style={styles.measureRow}
            onPress={() => setMeasuresOpen(true)}>
            <Text style={styles.measureLabel}>Measurements</Text>
            <Text style={styles.measureSub}>
              {MEASURES.filter((m) => measures[m.key] != null).length} logged
            </Text>
            <Text style={styles.soon}>VIEW</Text>
          </Pressable>
        </Card>
        </>
        )}

        {/* Recovery vitals live on the Cardio screen now */}

      </ScrollView>

      {/* Single-value logger */}
      <Sheet
        visible={logMetric != null}
        onClose={() => setLogMetric(null)}
        title={logMetric ? `${logMetric.label.toUpperCase()} (${logMetric.unit.toUpperCase()})` : undefined}>
        <TextInput
          style={styles.profInput}
          keyboardType="decimal-pad"
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder={
                logMetric?.key === 'weight'
                  ? unit === 'kg' ? '80.5' : '177.5'
                  : logMetric?.key === 'sleep_hours'
                    ? '7.5'
                    : logMetric?.key === 'resting_hr'
                      ? '55'
                      : logMetric?.unit === 'in'
                        ? '32'
                        : '0'
              }
              placeholderTextColor={Void.textTertiary}
              onSubmitEditing={() => void saveMetric()}
            />
            <View style={styles.profActions}>
              <Pressable onPress={() => setLogMetric(null)} style={styles.profBtn}>
                <Text style={styles.profBtnText}>CANCEL</Text>
              </Pressable>
              <Pressable onPress={() => void saveMetric()} style={[styles.profBtn, styles.profBtnAccent]}>
                <Text style={[styles.profBtnText, { color: Void.accentText }]}>SAVE</Text>
              </Pressable>
            </View>
      </Sheet>

      <ProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />

      {/* Measurements modal */}
      <Sheet visible={measuresOpen} onClose={() => setMeasuresOpen(false)} title="MEASUREMENTS">
            <Text style={styles.profSub}>Track body fat, waist, chest, arm and thigh over time.</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {MEASURES.map((m, i) => {
                const v = measures[m.key];
                const est = m.key === 'body_fat' ? bodyFatEstimate : null;
                return (
                  <Pressable
                    key={m.key}
                    style={[styles.measureRow, i < MEASURES.length - 1 && styles.measureBorder]}
                    onPress={() => {
                      setMeasuresOpen(false);
                      if (est != null) setDraft(String(est));
                      setLogMetric({ key: m.key, label: m.label, unit: m.unit === 'cm' ? lenUnit : m.unit });
                    }}>
                    <Text style={styles.measureLabel}>{m.label}</Text>
                    <Text style={[styles.measureVal, !v && { color: Void.textTertiary }]}>
                      {v
                        ? m.unit === 'cm'
                          ? `${dispLen(v.value)} ${lenUnit}`
                          : `${v.value} ${m.unit}`
                        : est != null
                          ? `~${est} ${m.unit}`
                          : 'Log'}
                    </Text>
                    {v ? (
                      <Text style={styles.measureDate}>{new Date(v.logged_at).toLocaleDateString()}</Text>
                    ) : est != null ? (
                      <Text style={styles.measureDate}>est.</Text>
                    ) : null}
                    <Plus color={Void.textTertiary} size={14} />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.profActions}>
              <Pressable onPress={() => setMeasuresOpen(false)} style={[styles.profBtn, styles.profBtnAccent]}>
                <Text style={[styles.profBtnText, { color: Void.accentText }]}>DONE</Text>
              </Pressable>
            </View>
      </Sheet>
    </Screen>
  );
}

// -- Profile editor --------------------------------------------------------

function ProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useSettings();
  const inInches = s.weight_unit === 'lbs';
  // lbs users enter/read inches; storage stays canonical cm.
  const [height, setHeight] = useState(
    s.height_cm ? String(inInches ? Math.round((s.height_cm / 2.54) * 10) / 10 : s.height_cm) : ''
  );
  const [year, setYear] = useState(s.birth_year ? String(s.birth_year) : '');
  const [override, setOverride] = useState(s.calorie_override ? String(s.calorie_override) : '');
  const [waterMl, setWaterMl] = useState(s.water_target_ml ? String(s.water_target_ml) : '');
  const activityKeys = Object.keys(ACTIVITY) as ActivityLevel[];
  const activityIdx = activityKeys.indexOf(s.activity_level);

  const save = () => {
    const hRaw = parseFloat(height);
    const h = inInches && Number.isFinite(hRaw) ? hRaw * 2.54 : hRaw;
    const y = parseInt(year, 10);
    const o = parseInt(override, 10);
    const w = parseInt(waterMl, 10);
    s.set({
      height_cm: Number.isFinite(h) && h > 50 && h < 260 ? Math.round(h * 10) / 10 : null,
      birth_year: Number.isFinite(y) && y > 1900 && y <= new Date().getFullYear() ? y : null,
      calorie_override: Number.isFinite(o) && o >= 800 ? o : null,
      water_target_ml: Number.isFinite(w) && w >= 250 && w <= 10000 ? w : null,
    });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="YOUR PROFILE">
      <Text style={styles.profSub}>Height, age, sex and activity determine your daily calorie target.</Text>

      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        {/* Height + Birth year side by side */}
        <View style={styles.profRow}>
          <View style={styles.profCol}>
            <Text style={styles.profLabel}>HEIGHT ({inInches ? 'IN' : 'CM'})</Text>
            {height ? <Text style={styles.profHint}>{cmToFtIn((inInches ? parseFloat(height) * 2.54 : parseFloat(height)) || 0)}</Text> : null}
            <TextInput style={styles.profInput} keyboardType="decimal-pad" value={height} onChangeText={setHeight} placeholder={inInches ? '70' : '180'} placeholderTextColor={Void.textTertiary} />
          </View>
          <View style={styles.profCol}>
            <Text style={styles.profLabel}>BIRTH YEAR</Text>
            {year ? <Text style={styles.profHint}>age {ageFromBirthYear(parseInt(year, 10)) ?? '-'}</Text> : null}
            <TextInput style={styles.profInput} keyboardType="number-pad" value={year} onChangeText={setYear} placeholder="1995" placeholderTextColor={Void.textTertiary} maxLength={4} />
          </View>
        </View>

        {/* Sex */}
        <Text style={styles.profLabel}>SEX</Text>
        <View style={styles.profChips}>
          {(['male', 'female'] as Sex[]).map((v) => (
            <Pressable key={v} style={[styles.profChip, s.sex === v && styles.profChipOn]} onPress={() => s.set({ sex: v })}>
              <Text style={[styles.profChipText, s.sex === v && { color: Void.accent }]}>{v[0].toUpperCase() + v.slice(1)}</Text>
            </Pressable>
          ))}
        </View>

        {/* Activity slider */}
        <Text style={styles.profLabel}>ACTIVITY · {ACTIVITY[s.activity_level].label.toUpperCase()}</Text>
        <Text style={styles.profActivityHint}>{ACTIVITY[s.activity_level].hint}</Text>
        <View style={styles.sliderTrack}>
          {activityKeys.map((v, i) => (
            <Pressable key={v} style={styles.sliderSeg} onPress={() => s.set({ activity_level: v })}>
              <View style={[styles.sliderBar, i <= activityIdx && styles.sliderBarOn, i === activityIdx && styles.sliderBarActive]} />
              <View style={[styles.sliderDot, i === activityIdx && styles.sliderDotOn]} />
            </Pressable>
          ))}
        </View>
        <View style={styles.sliderLabels}>
          {activityKeys.map((v) => (
            <Text key={v} style={[styles.sliderLabelText, s.activity_level === v && { color: Void.accent }]}>{ACTIVITY[v].label}</Text>
          ))}
        </View>

        {/* Calorie target */}
        <Text style={styles.profLabel}>CALORIE TARGET (OPTIONAL)</Text>
        <TextInput style={styles.profInput} keyboardType="number-pad" value={override} onChangeText={setOverride} placeholder="Auto - calculated from above" placeholderTextColor={Void.textTertiary} />

        {/* Water target */}
        <Text style={styles.profLabel}>WATER TARGET · ML (OPTIONAL)</Text>
        <TextInput style={styles.profInput} keyboardType="number-pad" value={waterMl} onChangeText={setWaterMl} placeholder="Auto - ~35ml/kg bodyweight" placeholderTextColor={Void.textTertiary} />
      </ScrollView>

      <View style={styles.profActions}>
        <Pressable onPress={onClose} style={styles.profBtn}>
          <Text style={styles.profBtnText}>CANCEL</Text>
        </Pressable>
        <Pressable onPress={save} style={[styles.profBtn, styles.profBtnAccent]}>
          <Text style={[styles.profBtnText, { color: Void.accentText }]}>SAVE</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  weekChart: { flexDirection: 'row', alignItems: 'flex-end', height: 72, gap: 4 },
  weekBarWrap: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  weekBar: { backgroundColor: Void.borderStrong, borderRadius: 3, minHeight: 3 },
  weekBarEmpty: { backgroundColor: Void.border, height: 3 },
  weekBarNow: { backgroundColor: Void.accent },
  weekChartFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  weekChartLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  // Hero
  hero: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  heroLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  heroValue: { color: Void.text, fontSize: 60, fontWeight: '900', letterSpacing: -3, lineHeight: 64, ...tabular },
  heroUnit: { color: Void.textTertiary, fontSize: 18, fontWeight: '700', marginBottom: 12, flex: 1 },
  heroLog: { width: 36, height: 36, borderRadius: 18, backgroundColor: Void.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  heroHint: { color: Void.textTertiary, fontSize: 12 },
  pills: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' },
  pill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { color: Void.textSecondary, fontSize: 12, fontWeight: '800', ...tabular },
  setupCard: { flexDirection: 'row', alignItems: 'center', gap: 12, ...cardChrome, borderRadius: 12, padding: 14, marginHorizontal: 16 },
  setupIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Void.accentDim, alignItems: 'center', justifyContent: 'center' },
  setupTitle: { color: Void.text, fontSize: 14, fontWeight: '700' },
  setupBody: { color: Void.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
  setupCta: { backgroundColor: Void.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  setupCtaText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  empty: { color: Void.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 8, lineHeight: 19 },
  // Energy
  energyRow: { flexDirection: 'row' },
  energyCell: { flex: 1, alignItems: 'center' },
  energyVal: { color: Void.text, fontSize: 22, fontWeight: '900', ...tabular },
  energyLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  goalRow: { flexDirection: 'row', gap: 6, marginTop: 16 },
  goal: { flex: 1, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 2, alignItems: 'center' },
  goalOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  goalText: { color: Void.textSecondary, fontSize: 11, fontWeight: '800' },
  goalHint: { color: Void.textTertiary, fontSize: 9, marginTop: 2, textAlign: 'center' },
  energyNote: { color: Void.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 12 },
  // Activity (health platform)
  actGrid: { flexDirection: 'row' },
  actCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  actVal: { color: Void.text, fontSize: 22, fontWeight: '900', ...tabular },
  actLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 3 },
  actSub: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  actSubText: { color: Void.textSecondary, fontSize: 11, fontWeight: '600' },
  waterCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 },
  waterIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: Void.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  waterVal: { color: Void.text, fontSize: 20, fontWeight: '900' },
  waterTarget: { color: Void.textTertiary, fontSize: 12, fontWeight: '600' },
  waterLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  waterAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Void.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  waterAddText: { color: Void.accentText, fontSize: 11, fontWeight: '800' },
  // Measurements / connect
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  measureBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  measureLabel: { color: Void.text, fontSize: 14, fontWeight: '600', flex: 1 },
  measureSub: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  measureVal: { color: Void.text, fontSize: 14, fontWeight: '800', ...tabular },
  measureDate: { color: Void.textTertiary, fontSize: 11 },
  soon: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  // Profile sheet content
  profSub: { color: Void.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  // Row (height + birth year side by side)
  profRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  profCol: { flex: 1 },
  // Labels & inputs
  profLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 12, marginBottom: 4 },
  profHint: { color: Void.accent, fontSize: 10, fontWeight: '600', marginBottom: 4 },
  profInput: { backgroundColor: Void.surfaceRaised, borderWidth: 1, borderColor: Void.border, borderRadius: 8, color: Void.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '700', ...tabular },
  // Sex chips
  profChips: { flexDirection: 'row', gap: 8 },
  profChip: { flex: 1, borderWidth: 1, borderColor: Void.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  profChipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  profChipText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700' },
  // Activity slider
  profActivityHint: { color: Void.textTertiary, fontSize: 11, marginBottom: 10 },
  sliderTrack: { flexDirection: 'row', height: 28, alignItems: 'center' },
  sliderSeg: { flex: 1, height: 28, justifyContent: 'center', alignItems: 'center' },
  sliderBar: { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: Void.border },
  sliderBarOn: { backgroundColor: Void.accent },
  sliderBarActive: { height: 4, borderRadius: 2 },
  sliderDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Void.border, borderWidth: 2, borderColor: Void.surface },
  sliderDotOn: { backgroundColor: Void.accent, width: 14, height: 14, borderRadius: 7 },
  sliderLabels: { flexDirection: 'row', marginTop: 4 },
  sliderLabelText: { flex: 1, textAlign: 'center', color: Void.textTertiary, fontSize: 8, fontWeight: '600' },
  // Actions
  profActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  profBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  profBtnAccent: { backgroundColor: Void.accent },
  profBtnText: { color: Void.textSecondary, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
