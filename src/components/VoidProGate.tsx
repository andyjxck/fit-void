import { useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { useVoidPro } from '@/lib/entitlements';
import { Void } from '@/theme/tokens';

/**
 * Wraps Pro-only content. Renders children for Pro users; otherwise a locked
 * placeholder that routes to the paywall.
 */
export function VoidProGate({ children, label }: { children?: ReactNode; label: string }) {
  const pro = useVoidPro();
  const router = useRouter();
  if (pro) return <>{children}</>;

  return (
    <Pressable style={styles.gate} onPress={() => router.push('/paywall')}>
      <CardSheen />
      <Lock size={16} color={Void.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.sub}>VOID PRO</Text>
      </View>
      <Text style={styles.unlock}>UNLOCK</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...cardChrome,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  label: { color: Void.text, fontSize: 14, fontWeight: '600' },
  sub: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginTop: 2 },
  unlock: { color: Void.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
