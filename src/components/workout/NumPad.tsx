import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Void } from '@/theme/tokens';

interface Props {
  visible: boolean;
  onKey: (key: string) => void; // '0'-'9', '.', 'back', 'done', 'clear'
  fieldLabel?: string;
}

const KEYS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

/**
 * Custom numeric pad - slides in above the safe area, replaces the system
 * keyboard for set logging so a tap-check flow never stalls.
 */
export function NumPad({ visible, onKey, fieldLabel }: Props) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={[styles.pad, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.field}>{fieldLabel ?? ''}</Text>
        <Pressable onPress={() => onKey('clear')} hitSlop={8}>
          <Text style={styles.clear}>CLR</Text>
        </Pressable>
        <Pressable style={styles.doneBtn} onPress={() => onKey('done')} hitSlop={8}>
          <Text style={styles.doneText}>DONE</Text>
        </Pressable>
      </View>
      {KEYS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => (
            <Pressable
              key={k}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
              onPress={() => onKey(k)}>
              {k === 'back' ? (
                <Text style={styles.keyText}>⌫</Text>
              ) : (
                <Text style={styles.keyText}>{k}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Void.surface,
    borderTopWidth: 1,
    borderTopColor: Void.border,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  field: { color: Void.textSecondary, fontSize: 12, letterSpacing: 1, flex: 1 },
  clear: { color: Void.textSecondary, fontSize: 12, fontWeight: '700', marginRight: 16 },
  doneBtn: {
    backgroundColor: Void.accent,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  doneText: { color: Void.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, marginBottom: 6 },
  key: {
    flex: 1,
    backgroundColor: Void.surfaceRaised,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 14,
  },
  keyPressed: { backgroundColor: Void.surfacePressed },
  keyText: { color: Void.text, fontSize: 20, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
