import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { MetricSliderRow } from '@/components/body/MetricSliderRow';
import { Sheet } from '@/components/ui/Sheet';
import { Void } from '@/theme/tokens';

interface Props {
  visible: boolean;
  defaultSleep: number;
  defaultHr: number;
  onClose: () => void;
  onSave: (sleepHrs: number, restingHr: number) => void;
}

/** Vitals logger: sleep + resting HR sliders, tap values for exact entry. */
export function VitalsSheet({ visible, defaultSleep, defaultHr, onClose, onSave }: Props) {
  const [sleep, setSleep] = useState(defaultSleep);
  const [hr, setHr] = useState(defaultHr);

  // Re-seed from the latest vitals each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setSleep(defaultSleep);
      setHr(defaultHr);
    }
  }, [visible, defaultSleep, defaultHr]);

  return (
    <Sheet visible={visible} onClose={onClose} title="LOG VITALS">
          <MetricSliderRow label="SLEEP" unit="hrs" value={sleep} min={0} max={12} step={0.25} onChange={setSleep} />
          <MetricSliderRow label="RESTING HEART RATE" unit="bpm" value={hr} min={30} max={120} onChange={setHr} />
          <Pressable style={styles.save} onPress={() => onSave(sleep, hr)}>
            <Check color={Void.accentText} size={15} />
            <Text style={styles.saveText}>SAVE</Text>
          </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Void.accent,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 18,
  },
  saveText: { color: Void.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});


