import { StyleSheet, Text } from 'react-native';

import { Void } from '@/theme/tokens';

/** Tiny "MAX" pill shown next to a Pro Max member's name. Pro gets nothing -
 * the exclusivity is the point. */
export function TierBadge({ tier }: { tier?: string | null }) {
  if (tier !== 'promax') return null;
  return <Text style={s.badge}>MAX</Text>;
}

const s = StyleSheet.create({
  badge: {
    color: Void.accentText,
    backgroundColor: Void.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    marginLeft: 4,
  },
});
