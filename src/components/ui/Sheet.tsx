import { X } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { Void } from '@/theme/tokens';

export function Sheet({
  visible,
  onClose,
  title,
  right,
  children,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  right?: ReactNode;
  children?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop is a sibling UNDERLAY, not a wrapper - a Pressable ancestor
          claims the touch responder and strangles ScrollViews inside the card
          (content only scrolled when the drag started on a button). */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, style]}>
          <CardSheen radius={14} />
          {title != null && (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              {right}
              <Pressable onPress={onClose} hitSlop={8}>
                <X color={Void.text} size={20} />
              </Pressable>
            </View>
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    ...cardChrome,
    borderColor: Void.borderStrong,
    borderRadius: 14,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  title: {
    color: Void.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    flex: 1,
  },
});
