import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen, ScreenHeader } from '@/components/ui';
import { logCardio } from '@/db/repo/cardio';
import { ACTIVITIES, ACTIVITY_EXTRAS, ACTIVITY_META, type CardioActivity } from '@/lib/cardio';
import { useActiveWorkout } from '@/store/activeWorkout';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

/** "5:30" → 330, "1:05:20" → 3920, "25" → 1500 (bare number = minutes). */
function parseDuration(s: string): number | null {
  const parts = s.trim().split(':').map((p) => parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export default function NewCardioScreen() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const unit = useSettings((s) => s.weight_unit);
  const distUnit = unit === 'kg' ? 'km' : 'mi';

  const { activity: preset, inWorkout } = useLocalSearchParams<{ activity?: string; inWorkout?: string }>();
  // Opened from the active-workout screen: the session joins the workout as a
  // cardio block and only reaches cardio_sessions when the workout finishes,
  // so discarding the workout discards it too.
  const deferToWorkout = inWorkout === '1' && useActiveWorkout((s) => s.workoutId != null);
  const [activity, setActivity] = useState<CardioActivity>(
    ACTIVITIES.includes(preset as CardioActivity) ? (preset as CardioActivity) : 'run'
  );
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [avgHr, setAvgHr] = useState('');
  // Optional per-activity extras (incline, resistance...) keyed by field.
  const [extras, setExtras] = useState<Record<string, string>>({});

  const save = async () => {
    const secs = parseDuration(duration);
    if (secs == null || secs <= 0) {
      notify('Duration', { body: 'Enter a duration like 25:30 or 1:05:00.', tone: 'info' });
      return;
    }
    const dist = parseFloat(distance.replace(',', '.'));
    const distanceM =
      Number.isFinite(dist) && dist > 0
        ? distUnit === 'km'
          ? dist * 1000
          : dist * 1609.34
        : null;
    const hr = parseInt(avgHr, 10);
    const avgHrVal = Number.isFinite(hr) && hr > 0 ? hr : null;
    const meta: Record<string, number> = {};
    for (const e of ACTIVITY_EXTRAS[activity]) {
      const n = parseFloat(extras[e.key] ?? '');
      if (Number.isFinite(n) && n > 0) meta[e.key] = n;
    }
    if (deferToWorkout) {
      await useActiveWorkout.getState().addCardioBlock({
        activity,
        distanceM,
        durationSeconds: secs,
        avgHr: avgHrVal,
        meta: Object.keys(meta).length ? meta : undefined,
      });
    } else {
      await logCardio({
        activity,
        distance_m: distanceM,
        duration_seconds: secs,
        avg_hr: avgHrVal,
        meta: Object.keys(meta).length ? meta : null,
        user_id: userId,
      });
    }
    router.back();
  };

  return (
    <Screen>
      <ScreenHeader title="Log Cardio" onBack={() => goBack()} />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={styles.label}>ACTIVITY</Text>
        <View style={styles.chips}>
          {ACTIVITIES.map((a) => (
            <Pressable
              key={a}
              style={[styles.chip, activity === a && styles.chipOn]}
              onPress={() => setActivity(a)}>
              <Text style={[styles.chipText, activity === a && { color: Void.accent }]}>
                {ACTIVITY_META[a].label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>DISTANCE ({distUnit.toUpperCase()})</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder={distUnit === 'km' ? '5.0' : '3.1'}
              placeholderTextColor={Void.textTertiary}
              value={distance}
              onChangeText={setDistance}
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>AVG HR (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              placeholder="152"
              placeholderTextColor={Void.textTertiary}
              value={avgHr}
              onChangeText={setAvgHr}
            />
          </View>
        </View>

        <Text style={styles.label}>DURATION</Text>
        <TextInput
          style={styles.input}
          keyboardType="numbers-and-punctuation"
          placeholder="mm:ss or h:mm:ss"
          placeholderTextColor={Void.textTertiary}
          value={duration}
          onChangeText={setDuration}
          autoFocus={false}
        />

        {ACTIVITY_EXTRAS[activity].length > 0 && (
          <View style={styles.row}>
            {ACTIVITY_EXTRAS[activity].map((e) => (
              <View key={e.key} style={styles.col}>
                <Text style={styles.label}>
                  {e.label}{e.unit ? ` (${e.unit.toUpperCase()})` : ''} (OPTIONAL)
                </Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Void.textTertiary}
                  value={extras[e.key] ?? ''}
                  onChangeText={(v) => setExtras((prev) => ({ ...prev, [e.key]: v }))}
                />
              </View>
            ))}
          </View>
        )}

        <Pressable style={styles.save} onPress={() => void save()}>
          <Check color={Void.accentText} size={16} />
          <Text style={styles.saveText}>{deferToWorkout ? 'ADD TO WORKOUT' : 'SAVE SESSION'}</Text>
        </Pressable>
        {deferToWorkout && (
          <Text style={styles.workoutNote}>Logged with your workout - saved to Cardio when you finish.</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { color: Void.text, fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  label: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  chipText: { color: Void.textSecondary, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  input: {
    marginHorizontal: 16,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Void.text,
    fontSize: 16,
  },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Void.accent,
    borderRadius: 12,
    paddingVertical: 15,
    marginHorizontal: 16,
    marginTop: 32,
  },
  saveText: { color: Void.accentText, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  workoutNote: {
    color: Void.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
    marginHorizontal: 16,
  },
});
