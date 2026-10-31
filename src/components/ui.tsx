import { tabular, Void } from '@/theme/tokens';
import { ChevronLeft } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * Shared "glass card" chrome: dark surface, hairline border with a brighter
 * top edge, and a deep drop shadow for 3D lift. Used by Card, Sheet and the
 * notify banner so every raised surface reads the same.
 */
export const cardChrome = {
  backgroundColor: Void.surface,
  borderWidth: 1,
  borderColor: Void.border,
  borderTopColor: 'rgba(255,255,255,0.10)',
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
} satisfies ViewStyle;

/**
 * Glossy top-light sheen for card surfaces. Renders an absolutely-positioned
 * white→transparent gradient over the top ~40% of the card, clipped to the
 * corner radius, behind the card's children. Lives in its own clipped view so
 * the outer card can keep `overflow: visible` for the drop shadow.
 */
export function CardSheen({ radius = 12 }: { radius?: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '40%',
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        overflow: 'hidden',
      }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="cardSheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.05" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cardSheen)" />
      </Svg>
    </View>
  );
}

export function Screen({ children, style }: { children?: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}

export function ScreenHeader({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={8} style={styles.headerBack}>
            <ChevronLeft color={Void.text} size={24} />
          </Pressable>
        )}
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

/** Header pill that temporarily lifts a tab's focus filter - shows every
 *  hidden section until toggled back. Label reads as the tap's action. */
export function FocusToggle({ showAll, onToggle }: { showAll: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} hitSlop={8} style={[styles.focusToggle, showAll && styles.focusToggleOn]}>
      <Text style={[styles.focusToggleText, showAll && { color: Void.accent }]}>
        {showAll ? 'FOCUS' : 'SHOW ALL'}
      </Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children?: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      <CardSheen />
      {children}
    </View>
  );
}


export function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={[styles.statValue, accent && { color: Void.accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Void.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerBack: { marginLeft: -8, marginRight: 2 },
  headerTitle: { color: Void.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  section: {
    color: Void.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    ...cardChrome,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
  },
  statValue: { color: Void.text, fontSize: 18, fontWeight: '700', ...tabular },
  statLabel: { color: Void.textTertiary, fontSize: 10, letterSpacing: 1, marginTop: 3 },
  focusToggle: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Void.surfaceRaised,
  },
  focusToggleOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  focusToggleText: { color: Void.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});
