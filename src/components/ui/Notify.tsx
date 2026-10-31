import * as Clipboard from 'expo-clipboard';
import { AlertTriangle, CheckCircle2, Copy, Info } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardChrome, CardSheen } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import {
    _resolvePendingConfirm,
    useNotify,
    type NotifyItem,
} from '@/store/notify';
import { Void } from '@/theme/tokens';

const AUTO_DISMISS_MS = 3200;

function toneIcon(item: NotifyItem) {
  switch (item.tone) {
    case 'success':
      return <CheckCircle2 color={Void.accent} size={20} />;
    case 'error':
      return <AlertTriangle color={Void.danger} size={20} />;
    default:
      return <Info color={Void.textSecondary} size={20} />;
  }
}

function Banner({ item }: { item: NotifyItem }) {
  const dismissTop = useNotify((s) => s.dismissTop);
  const translateY = useSharedValue(-120);

  useEffect(() => {
    translateY.value = withTiming(0, {
      duration: 250,
      easing: Easing.out(Easing.back(1.4)),
    });
    const timer = setTimeout(() => {
      translateY.value = withTiming(-120, { duration: 220, easing: Easing.in(Easing.ease) });
      // Give the exit animation a beat before removing from the queue.
      setTimeout(dismissTop, 220);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, dismissTop, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable style={styles.banner} onPress={dismissTop}>
        <CardSheen />
        {toneIcon(item)}
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle}>{item.title}</Text>
          {item.body ? <Text style={styles.bannerBody}>{item.body}</Text> : null}
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => {
            void Clipboard.setStringAsync(
              item.body ? `${item.title}\n${item.body}` : item.title
            );
          }}>
          <Copy color={Void.textTertiary} size={16} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function ConfirmDialog() {
  const pending = useNotify((s) => s.pendingConfirm);
  if (!pending) return null;

  const resolve = (v: boolean) => _resolvePendingConfirm(v);

  return (
    <Sheet visible title={pending.title} onClose={() => resolve(false)}>
      {pending.body ? <Text style={styles.confirmBody}>{pending.body}</Text> : null}
      <View style={styles.confirmRow}>
        <Pressable style={styles.cancelBtn} onPress={() => resolve(false)}>
          <Text style={styles.cancelText}>{pending.cancelText}</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmBtn, pending.destructive && styles.confirmBtnDestructive]}
          onPress={() => resolve(true)}>
          <Text
            style={[styles.confirmText, pending.destructive && styles.confirmTextDestructive]}>
            {pending.confirmText}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * Renders dropdown banners + confirm dialogs. Mount once at the app root AND
 * once inside every modally-presented screen (fullScreenModal/modal routes like
 * workout/active, paywall, auth/link) - a host mounted under the root Stack
 * renders beneath the presented view controller and is untappable. The store
 * is shared, so multiple hosts are safe: resolving a confirm nulls
 * `pendingConfirm`, which unmounts the dialog in every host.
 */
export function NotifyHost() {
  const insets = useSafeAreaInsets();
  const top = useNotify((s) => s.queue[0]);
  const hasConfirm = useNotify((s) => s.pendingConfirm != null);

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[styles.bannerWrap, { top: insets.top + 8 }]}
        collapsable={false}>
        {top ? <Banner key={top.id} item={top} /> : null}
      </View>
      {hasConfirm ? <ConfirmDialog /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  bannerWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 999,
    elevation: 999,
  },
  banner: {
    ...cardChrome,
    backgroundColor: Void.surfaceRaised,
    borderColor: Void.borderStrong,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerText: { flex: 1 },
  bannerTitle: { color: Void.text, fontSize: 14, fontWeight: '700' },
  bannerBody: { color: Void.textSecondary, fontSize: 12, marginTop: 2 },
  confirmBody: {
    color: Void.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  confirmRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    color: Void.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: Void.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmBtnDestructive: { backgroundColor: Void.danger },
  confirmText: {
    color: Void.accentText,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  confirmTextDestructive: { color: '#fff' },
});
