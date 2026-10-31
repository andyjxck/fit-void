import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Slider } from '@/components/ui/Slider';
import { Void } from '@/theme/tokens';

interface Props {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

/** Slider + value pill; tapping the value switches to free-text entry. */
export function MetricSliderRow({ label, unit, value, min, max, step = 1, onChange }: Props) {
  const [textMode, setTextMode] = useState(false);

  return (
    <View style={styles.metric}>
      <View style={styles.metricHead}>
        <Text style={styles.metricLabel}>{label}</Text>
        {textMode ? (
          <TextInput
            style={styles.valueInput}
            keyboardType="decimal-pad"
            autoFocus
            value={String(value)}
            selectTextOnFocus
            onChangeText={(t) => {
              const v = parseFloat(t.replace(',', '.'));
              if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            onBlur={() => setTextMode(false)}
            onSubmitEditing={() => setTextMode(false)}
          />
        ) : (
          <Pressable onPress={() => setTextMode(true)} style={styles.valuePill} hitSlop={6}>
            <Text style={styles.valueText}>
              {step < 1 ? Number(value.toFixed(2)).toString() : String(Math.round(value))}
            </Text>
            <Text style={styles.valueUnit}>{unit}</Text>
          </Pressable>
        )}
      </View>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
      <View style={styles.bounds}>
        <Text style={styles.boundText}>{min}</Text>
        <Text style={styles.boundText}>{max}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metric: { marginTop: 10 },
  metricHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricLabel: { color: Void.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  valuePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  valueText: { color: Void.text, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  valueUnit: { color: Void.textTertiary, fontSize: 10, fontWeight: '700' },
  valueInput: {
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    color: Void.text,
    fontSize: 16,
    fontWeight: '800',
    minWidth: 70,
    textAlign: 'right',
  },
  bounds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  boundText: { color: Void.textTertiary, fontSize: 9, fontWeight: '600' },
});
