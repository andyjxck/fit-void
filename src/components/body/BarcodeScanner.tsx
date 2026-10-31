import { CameraView, useCameraPermissions } from 'expo-camera';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lookupBarcode, type FoodProduct } from '@/lib/foodLookup';
import { Void } from '@/theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fired once per scan. `product` is null when the barcode isn't in Open Food Facts. */
  onResult: (barcode: string, product: FoodProduct | null) => void;
}

export function BarcodeScanner({ visible, onClose, onResult }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  // Mirrors `visible` - an in-flight lookup must not fire onResult after close.
  const active = useRef(false);

  useEffect(() => {
    active.current = visible;
    if (visible) {
      locked.current = false;
      setBusy(false);
      if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const close = () => {
    active.current = false;
    onClose();
  };

  const handle = async (data: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const product = await lookupBarcode(data);
    if (!active.current) return;
    setBusy(false);
    onResult(data, product);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            active={visible && !busy}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
            onBarcodeScanned={(r) => void handle(r.data)}
          />
        ) : (
          <View style={styles.denied}>
            <Text style={styles.deniedTitle}>Camera access needed</Text>
            <Text style={styles.deniedBody}>
              Fit Void only uses the camera to read food barcodes. Nothing is recorded.
            </Text>
            {permission?.canAskAgain && (
              <Pressable style={styles.grant} onPress={() => void requestPermission()}>
                <Text style={styles.grantText}>ALLOW CAMERA</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Reticle */}
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.reticle} />
          <Text style={styles.hint}>{busy ? 'Looking it up…' : 'Line up the barcode'}</Text>
          {busy && <ActivityIndicator color={Void.accent} style={{ marginTop: 12 }} />}
        </View>

        <Pressable style={[styles.close, { top: insets.top + 8 }]} onPress={close} hitSlop={10}>
          <X color={Void.text} size={22} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Void.canvas },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 260,
    height: 160,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: Void.accent,
    backgroundColor: 'transparent',
  },
  hint: { color: Void.text, fontSize: 14, fontWeight: '600', marginTop: 18, textShadowColor: '#000', textShadowRadius: 6 },
  close: {
    position: 'absolute',
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  deniedTitle: { color: Void.text, fontSize: 18, fontWeight: '800' },
  deniedBody: { color: Void.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  grant: { marginTop: 20, backgroundColor: Void.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  grantText: { color: Void.accentText, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
});
