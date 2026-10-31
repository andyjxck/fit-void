import * as Sharing from 'expo-sharing';
import { Share2, Trophy } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { cardChrome, CardSheen } from '@/components/ui';
import { displayWeight, formatDuration, formatRecord, formatVolume } from '@/lib/format';
import type { FinalizeSummary } from '@/store/activeWorkout';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

export const FEELS = ['Flat', 'Tough', 'Solid', 'Strong', 'Beast'] as const;

interface Props {
  summary: FinalizeSummary;
  onClose: () => void;
  onRate?: (feel: number) => void;
  initialFeel?: number | null;
}

export function WorkoutSummary({ summary, onClose, onRate, initialFeel }: Props) {
  const insets = useSafeAreaInsets();
  const { weight_unit } = useSettings();
  const shareCardRef = useRef<View>(null);
  const [feel, setFeel] = useState<number | null>(initialFeel ?? null);

  const onShare = async () => {
    if (!shareCardRef.current) return;
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 1 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // share cancelled
    }
  };

  return (
    <View style={[styles.celebration, { paddingTop: insets.top }]}>
      <ConfettiCannon
        count={180}
        origin={{ x: -20, y: 0 }}
        colors={[Void.accent, '#FFFFFF', Void.warmup, Void.drop]}
        fadeOut
        autoStart
        explosionSpeed={400}
        fallSpeed={2500}
      />
      <ConfettiCannon
        count={180}
        origin={{ x: Dimensions.get('window').width + 20, y: 0 }}
        colors={[Void.accent, '#FFFFFF', Void.warmup, Void.drop]}
        fadeOut
        autoStart
        explosionSpeed={400}
        fallSpeed={2500}
      />
      <View style={[styles.celebrationSafe, { paddingBottom: insets.bottom + 16 }]}>
        <ScrollView contentContainerStyle={styles.celebrationScroll} showsVerticalScrollIndicator={false}>
          <View ref={shareCardRef} collapsable={false} style={styles.heroCard}>
            <CardSheen radius={24} />
            <View style={styles.trophyEmblem}>
              <Trophy size={48} color={Void.accent} strokeWidth={1.5} />
            </View>
            <Text style={styles.celebrationKicker}>GREAT JOB</Text>
            <Text style={styles.celebrationTitle}>{summary.title}</Text>
            <Text style={styles.celebrationDate}>
              {new Date(summary.completedAt).toLocaleDateString([], {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}{' '}
              ·{' '}
              {new Date(summary.completedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>

            <View style={styles.heroVolumeWrap}>
              <Text style={styles.heroVolumeValue}>
                {formatDuration(summary.durationSec)}
              </Text>
              <Text style={styles.heroVolumeUnit}>DURATION</Text>
            </View>

            <View style={styles.celebrationStats}>
              <Stat label="VOLUME" value={`${formatVolume(summary.volumeKg, weight_unit)} ${weight_unit}`} />
              <Stat label="SETS" value={String(summary.setCount)} />
              <Stat label="EXERCISES" value={String(summary.exerciseCount)} />
            </View>

            {summary.prs.length > 0 && (
              <View style={styles.prSection}>
                <Text style={styles.prSectionTitle}>
                  {summary.prs.length} RECORD{summary.prs.length > 1 ? 'S' : ''}
                </Text>
                {Object.entries(
                  summary.prs.reduce<Record<string, { recordType: string; value: number }[]>>(
                    (acc, p) => {
                      (acc[p.exerciseName] ??= []).push(p);
                      return acc;
                    },
                    {}
                  )
                ).map(([name, prs]) => (
                  <View key={name} style={styles.prRow}>
                    <Text style={styles.prExName} numberOfLines={1}>
                      {name}
                    </Text>
                    <View style={styles.prTrophies}>
                      {prs.map((_, i) => (
                        <Trophy key={i} size={16} color={Void.accent} strokeWidth={1.5} />
                      ))}
                    </View>
                    <Text style={styles.prValues}>
                      {prs.map((p) => formatRecord(p.recordType, p.value, weight_unit)).join(' · ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.breakdownSection}>
              {summary.exercises.map((ex, i) => (
                <View key={i} style={styles.breakdownRow}>
                  <Text style={styles.breakdownName} numberOfLines={1}>
                    {ex.name}
                  </Text>
                  <Text style={styles.breakdownBest}>
                    {ex.setCount} sets
                    {ex.bestWeightKg != null && ex.bestReps != null
                      ? ` · ${displayWeight(ex.bestWeightKg, weight_unit)}${weight_unit} × ${ex.bestReps}`
                      : ex.bestWeightKg != null
                        ? ` · ${displayWeight(ex.bestWeightKg, weight_unit)}${weight_unit}`
                        : ''}
                    {ex.bestDurationSeconds != null ? ` · ${formatDuration(ex.bestDurationSeconds)}` : ''}
                    {ex.bestDistanceM != null
                      ? ` · ${ex.bestDistanceM >= 1000 ? `${(ex.bestDistanceM / 1000).toFixed(2)}km` : `${Math.round(ex.bestDistanceM)}m`}`
                      : ''}
                    {ex.avgRpe != null ? ` · RPE ${ex.avgRpe}` : ''}
                    {ex.extrasText ? ` · ${ex.extrasText}` : ''}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={styles.heroBrand}>FIT VOID</Text>
          </View>

          {/* Session rating - outside the share card so it doesn't appear in screenshots */}
          <Text style={styles.feelTitle}>HOW DID THAT FEEL?</Text>
          <View style={styles.feelRow}>
            {FEELS.map((label, i) => {
              const n = i + 1;
              const on = feel === n;
              return (
                <Pressable
                  key={label}
                  style={[styles.feelChip, on && styles.feelChipOn]}
                  onPress={() => {
                    setFeel(n);
                    onRate?.(n);
                  }}>
                  <Text style={[styles.feelNum, on && { color: Void.accent }]}>{n}</Text>
                  <Text style={[styles.feelLabel, on && { color: Void.accent }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.celebrationActions}>
          <Pressable style={styles.celebrationShare} onPress={() => void onShare()}>
            <Share2 size={16} color={Void.text} />
            <Text style={styles.celebrationShareText}>SHARE</Text>
          </Pressable>
          <Pressable style={styles.celebrationDone} onPress={onClose}>
            <Text style={styles.celebrationDoneText}>DONE</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1, backgroundColor: Void.surface, paddingVertical: 14 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  celebration: { flex: 1, backgroundColor: Void.canvas },
  celebrationSafe: { flex: 1, paddingHorizontal: 20 },
  celebrationScroll: { paddingTop: 24, paddingBottom: 16 },
  heroCard: {
    ...cardChrome,
    borderColor: Void.borderStrong,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
  },
  trophyEmblem: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Void.accentDim,
    borderWidth: 1.5,
    borderColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  celebrationKicker: {
    color: Void.accent,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 6,
    textAlign: 'center',
  },
  celebrationTitle: {
    color: Void.text,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 8,
  },
  celebrationDate: {
    color: Void.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  heroVolumeWrap: { alignItems: 'center', marginTop: 28, marginBottom: 24 },
  heroVolumeValue: { color: Void.accent, fontSize: 56, fontWeight: '800', ...tabular },
  heroVolumeUnit: {
    color: Void.textTertiary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 3,
    marginTop: 4,
  },
  celebrationStats: {
    flexDirection: 'row',
    gap: 1,
    backgroundColor: Void.border,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  statValue: { color: Void.text, fontSize: 18, fontWeight: '700', ...tabular },
  statLabel: { color: Void.textTertiary, fontSize: 9, letterSpacing: 1, marginTop: 3 },
  prSection: { width: '100%', marginBottom: 20 },
  prSectionTitle: {
    color: Void.accent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 10,
    textAlign: 'center',
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  prExName: { color: Void.text, fontSize: 14, fontWeight: '600', flex: 1 },
  prTrophies: { flexDirection: 'row', gap: 2 },
  prValues: { color: Void.textSecondary, fontSize: 12, ...tabular },
  breakdownSection: {
    width: '100%',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Void.border,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  breakdownName: { color: Void.text, fontSize: 14, fontWeight: '600', flex: 1 },
  breakdownBest: { color: Void.textSecondary, fontSize: 12, ...tabular },
  heroBrand: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 6,
    textAlign: 'center',
    marginTop: 24,
  },
  feelTitle: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  feelRow: { flexDirection: 'row', gap: 6 },
  feelChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 12,
    paddingVertical: 10,
  },
  feelChipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  feelNum: { color: Void.text, fontSize: 16, fontWeight: '800', ...tabular },
  feelLabel: { color: Void.textTertiary, fontSize: 8, fontWeight: '700', letterSpacing: 0.5, marginTop: 3 },
  celebrationActions: { flexDirection: 'row', gap: 10, paddingTop: 16 },
  celebrationShare: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 12,
    paddingVertical: 16,
  },
  celebrationShareText: { color: Void.text, fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  celebrationDone: {
    flex: 1.5,
    backgroundColor: Void.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  celebrationDoneText: { color: Void.accentText, fontWeight: '900', fontSize: 15, letterSpacing: 1 },
});
