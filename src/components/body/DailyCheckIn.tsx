import { Check, Minus, Moon, Plus } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { tabular, Void } from '@/theme/tokens';

interface Props {
  /** Today's logged values - null means "not logged yet, ask for it". */
  sleepToday: number | null;
  restingHrToday: number | null;
  defaultRestingHr: number;
  /** Watch/HealthKit-imported HRV (ms) - shown read-only, never an input. */
  hrvToday?: number | null;
  onSave: (sleepHrs: number | null, restingHr: number | null) => void;
}

const SLEEP_OPTS = [5, 6, 7, 8, 9, 10];
const HR_MIN = 30;
const HR_MAX = 120;

/**
 * Morning check-in: asks for sleep + resting HR once a day. Single-tap inputs -
 * sleep chips and a HR stepper - so the whole card is two taps to log.
 */
export function DailyCheckIn({ sleepToday, restingHrToday, defaultRestingHr, hrvToday, onSave }: Props) {
  const needSleep = sleepToday == null;
  const needHr = restingHrToday == null;
  const [sleep, setSleep] = useState(sleepToday ?? 7.5);
  const [hr, setHr] = useState(restingHrToday ?? defaultRestingHr);
  // Props arrive async - don't clobber a value the user already touched.
  const sleepEdited = useRef(false);
  const hrEdited = useRef(false);

  useEffect(() => {
    if (sleepToday != null && !sleepEdited.current) setSleep(sleepToday);
  }, [sleepToday]);

  useEffect(() => {
    if (!hrEdited.current) setHr(restingHrToday ?? defaultRestingHr);
  }, [restingHrToday, defaultRestingHr]);

  if (!needSleep && !needHr) return null;

  const nudgeHr = (delta: number) => {
    hrEdited.current = true;
    setHr((v) => Math.min(HR_MAX, Math.max(HR_MIN, Math.round(v) + delta)));
  };

  return (
    <View style={styles.card}>
      <CardSheen />
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <Moon color={Void.accent} size={14} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>MORNING CHECK-IN</Text>
          <Text style={styles.sub}>
            Sleep + resting HR - once a day.{hrvToday != null ? ` · HRV ${Math.round(hrvToday)} ms` : ''}
          </Text>
        </View>
      </View>

      {needSleep && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>SLEEP</Text>
          <View style={styles.chips}>
            {SLEEP_OPTS.map((h) => {
              const on = sleep === h;
              return (
                <Pressable
                  key={h}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => { sleepEdited.current = true; setSleep(h); }}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{h}h</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {needHr && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>RESTING HEART RATE</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => nudgeHr(-1)} hitSlop={4}>
              <Minus color={Void.text} size={16} />
            </Pressable>
            <View style={styles.stepReadout}>
              <Text style={styles.stepValue}>{Math.round(hr)}</Text>
              <Text style={styles.stepUnit}>bpm</Text>
            </View>
            <Pressable style={styles.stepBtn} onPress={() => nudgeHr(1)} hitSlop={4}>
              <Plus color={Void.text} size={16} />
            </Pressable>
          </View>
        </View>
      )}

      <Pressable
        style={styles.save}
        onPress={() => onSave(needSleep ? sleep : null, needHr ? hr : null)}>
        <Check color={Void.accentText} size={15} />
        <Text style={styles.saveText}>LOG</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardChrome,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Void.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: Void.accent, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  sub: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  field: { marginTop: 12 },
  fieldLabel: { color: Void.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Void.border,
    backgroundColor: Void.surfaceRaised,
  },
  chipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  chipText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700', ...tabular },
  chipTextOn: { color: Void.accent },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 44,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Void.border,
    backgroundColor: Void.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepReadout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    backgroundColor: Void.canvas,
  },
  stepValue: { color: Void.text, fontSize: 18, fontWeight: '800', ...tabular },
  stepUnit: { color: Void.textTertiary, fontSize: 10, fontWeight: '700' },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Void.accent,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },
  saveText: { color: Void.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});
