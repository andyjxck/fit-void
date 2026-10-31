import { StyleSheet, Text, View } from 'react-native';

import { kgToLbs, plateBreakdown } from '@/lib/plates';
import type { WeightUnit } from '@/lib/types';
import { tabular, Void } from '@/theme/tokens';

interface Props {
  /** Total bar load in canonical kg. */
  weightKg: number | null;
  /** Bar weight in the display unit (20 kg / 45 lb etc.). */
  barWeight: number;
  unit: WeightUnit;
}

/**
 * Inline barbell plate breakdown - chips like [20][10][2.5] showing the
 * per-side load. Rendered directly under the focused weight input.
 */
export function PlateVisualizer({ weightKg, barWeight, unit }: Props) {
  if (weightKg == null || weightKg <= 0) return null;

  const display = unit === 'lbs' ? kgToLbs(weightKg) : weightKg;
  const { plates, approximate } = plateBreakdown(display, barWeight, unit);

  return (
    <View style={styles.row}>
      <Text style={styles.barLabel}>{trim(barWeight)} bar</Text>
      <View style={styles.plates}>
        {plates.length === 0 ? (
          <Text style={styles.empty}>{approximate ? 'below bar' : 'bar only'}</Text>
        ) : (
          plates.map((p, i) => (
            <View key={i} style={styles.plate}>
              <Text style={styles.plateText}>{trim(p)}</Text>
            </View>
          ))
        )}
        {approximate && plates.length > 0 && <Text style={styles.approx}>≈</Text>}
      </View>
      <Text style={styles.side}>/ side</Text>
    </View>
  );
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  barLabel: { color: Void.textTertiary, fontSize: 11, ...tabular },
  plates: { flexDirection: 'row', gap: 3, flex: 1 },
  plate: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  plateText: { color: Void.accent, fontSize: 11, fontWeight: '600', ...tabular },
  empty: { color: Void.textTertiary, fontSize: 11 },
  approx: { color: Void.warmup, fontSize: 12, alignSelf: 'center' },
  side: { color: Void.textTertiary, fontSize: 10 },
});
