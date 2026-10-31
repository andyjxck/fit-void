import {
    Apple,
    ChartLine,
    ChevronDown,
    Droplet,
    Dumbbell,
    Flame,
    Footprints,
    Lock,
    Moon,
    Ruler,
    Sparkles,
    Users,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { ensureFocusWidgets } from '@/db/repo/widgets';
import { ALL_INTENTS, INTENT_LABELS, parseIntents, UNLOCK_RULES, type Intent } from '@/lib/intents';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { useWidgetStore } from '@/store/widgets';
import { Void } from '@/theme/tokens';

const INTENT_ICONS: Record<Intent, typeof Dumbbell> = {
  lift: Dumbbell,
  cardio: Footprints,
  nutrition: Apple,
  hydration: Droplet,
  body_comp: Ruler,
  recovery: Moon,
  progress: ChartLine,
  social: Users,
  habits: Flame,
};

/**
 * Focus selector for the Train tab - one pill showing the current
 * selection, opening an anchored dropdown checklist below it (not a modal
 * sheet). Multi-select, changeable anytime. Empty selection = ALL (no
 * filter, your normal grid).
 */
export function IntentSwitcher() {
  const pillRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const activeRaw = useSettings((s) => s.active_intents);
  const unlockedRaw = useSettings((s) => s.unlocked_modules);
  const seededRaw = useSettings((s) => s.seeded_intents);
  const unlockSpeed = useSettings((s) => s.unlock_speed);
  const set = useSettings((s) => s.set);
  const load = useWidgetStore((s) => s.load);

  const active = parseIntents(activeRaw);
  const unlocked = parseIntents(unlockedRaw);
  const seeded = parseIntents(seededRaw);
  const everything = active.length === 0;
  const gradual = unlockSpeed === 'gradual';

  const write = (next: Intent[]) => set({ active_intents: JSON.stringify(next) });

  const seedIfNeeded = async (intent: Intent) => {
    if (seeded.includes(intent)) return;
    await ensureFocusWidgets(intent);
    set({ seeded_intents: JSON.stringify([...seeded, intent]) });
    await load();
  };

  const toggle = (intent: Intent) => {
    if (gradual && !unlocked.includes(intent)) {
      const rule = UNLOCK_RULES.find((r) => r.intent === intent);
      notify('Locked', { body: rule?.hint ?? 'Keep using Void to unlock this focus' });
      return;
    }
    const next = active.includes(intent) ? active.filter((i) => i !== intent) : [...active, intent];
    write(next);
    if (!active.includes(intent)) void seedIfNeeded(intent);
  };

  const openMenu = () => {
    pillRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + 6, left: x, width });
      setOpen(true);
    });
  };

  const label = everything
    ? 'ALL'
    : active.length === 1
      ? INTENT_LABELS[active[0]]
      : `${INTENT_LABELS[active[0]]} +${active.length - 1}`;

  return (
    <>
      <View ref={pillRef} collapsable={false} style={styles.pillWrap}>
        <Pressable style={styles.pill} onPress={openMenu} hitSlop={6}>
          {everything ? (
            <Sparkles color={Void.accent} size={13} />
          ) : (
            (() => {
              const Icon = INTENT_ICONS[active[0]];
              return <Icon color={Void.accent} size={13} />;
            })()
          )}
          <Text style={styles.pillText}>{label}</Text>
          <ChevronDown color={Void.textTertiary} size={14} />
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {anchor && (
            <Pressable
              style={[styles.dropdown, { top: anchor.top, left: anchor.left, minWidth: Math.max(anchor.width, 190) }]}
              onPress={(e) => e.stopPropagation()}>
              <CardSheen radius={12} />
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                <Pressable
                  style={[styles.row, everything && styles.rowOn]}
                  onPress={() => write([])}
                  hitSlop={4}>
                  <Sparkles color={everything ? Void.accent : Void.textSecondary} size={15} />
                  <Text style={[styles.rowText, everything && styles.rowTextOn]}>ALL</Text>
                </Pressable>
                {ALL_INTENTS.map((intent) => {
                  const locked = gradual && !unlocked.includes(intent);
                  const on = !everything && active.includes(intent);
                  const Icon = INTENT_ICONS[intent];
                  return (
                    <Pressable
                      key={intent}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => toggle(intent)}
                      hitSlop={4}>
                      {locked ? (
                        <Lock color={Void.textTertiary} size={15} />
                      ) : (
                        <Icon color={on ? Void.accent : Void.textSecondary} size={15} />
                      )}
                      <Text style={[styles.rowText, on && styles.rowTextOn, locked && styles.rowTextLocked]}>
                        {INTENT_LABELS[intent]}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pillWrap: { alignSelf: 'center', marginBottom: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
  },
  pillText: { color: Void.text, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  dropdown: {
    ...cardChrome,
    position: 'absolute',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  rowOn: { backgroundColor: Void.accentDim },
  rowText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700' },
  rowTextOn: { color: Void.accent },
  rowTextLocked: { color: Void.textTertiary },
});
