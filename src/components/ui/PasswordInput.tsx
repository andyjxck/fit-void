import type { JSX } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Void } from '@/theme/tokens';

const LEVELS = [
  { label: 'WEAK', color: '#FF6B6B' },
  { label: 'FAIR', color: '#FFB340' },
  { label: 'STRONG', color: Void.accent },
] as const;

function passwordScore(value: string): number {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^a-zA-Z0-9]/.test(value)) score += 1;
  return score;
}

export function PasswordInput(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  showStrength?: boolean;
}): JSX.Element {
  const score = passwordScore(props.value);
  const level = LEVELS[score <= 1 ? 0 : score <= 3 ? 1 : 2];
  const showMeter = props.showStrength !== false && props.value.length > 0;

  return (
    <View>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={Void.textTertiary}
        style={styles.input}
      />
      {showMeter && (
        <View style={styles.meter}>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${(score / 5) * 100}%`, backgroundColor: level.color },
              ]}
            />
          </View>
          <Text style={[styles.meterLabel, { color: level.color }]}>
            {level.label}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    width: '100%',
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Void.text,
    fontSize: 14,
  },
  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Void.border,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  meterLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
