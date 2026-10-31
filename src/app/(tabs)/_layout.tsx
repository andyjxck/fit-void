import { Tabs, useRouter } from 'expo-router';
import { Book, ChartLine, Dumbbell, Footprints, Grid, List, MessageSquarePlus, PersonStanding, Shield, Users, Utensils } from 'lucide-react-native';
import { useState } from 'react';
import { ColorValue, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FeedbackModal } from '@/components/FeedbackModal';
import { isTabMuted, parseIntents } from '@/lib/intents';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';

const DOUBLE_TAP_MS = 4000;

export default function TabsLayout() {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pending, setPending] = useState<{ tab: string; at: number } | null>(null);
  const userId = useSettings((s) => s.supabase_user_id);
  const activeIntents = parseIntents(useSettings((s) => s.active_intents));
  const muted = (tab: string) => isTabMuted(tab, activeIntents);
  const mutedIcon = (node: (color: ColorValue, size: number) => React.ReactNode, tab: string) =>
    (color: ColorValue, size: number) => (
      <View style={muted(tab) && { opacity: 0.35 }}>{node(color, size)}</View>
    );

  // Advisory intercept - never a hard block. First tap on a muted tab shows
  // a toast instead of navigating; tapping the same tab again within a few
  // seconds lets the navigation through.
  const intercept = (tab: string) => ({
    tabPress: (e: { preventDefault: () => void }) => {
      if (!muted(tab)) return;
      const now = Date.now();
      if (pending?.tab === tab && now - pending.at < DOUBLE_TAP_MS) {
        setPending(null);
        return;
      }
      e.preventDefault();
      setPending({ tab, at: now });
      notify('Not part of your current focus', { body: 'Click again to open.', tone: 'info' });
    },
  });

  // Same warn-then-allow pattern for More-sheet destinations: muted items
  // stay reachable (dimmed), first tap warns, second tap within the window
  // navigates through.
  const morePress = (key: string, route: string) => {
    if (muted(key)) {
      const now = Date.now();
      if (pending?.tab === `more:${key}` && now - pending.at < DOUBLE_TAP_MS) {
        setPending(null);
      } else {
        setPending({ tab: `more:${key}`, at: now });
        notify('Not part of your current focus', { body: 'Click again to open.', tone: 'info' });
        return;
      }
    }
    setMoreOpen(false);
    router.push(route as never);
  };

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: Void.surface,
            borderTopColor: Void.border,
            borderTopWidth: 1,
            borderRadius: 26,
            marginHorizontal: 28,
            marginBottom: 18,
            height: 54,
            paddingBottom: 2,
            paddingTop: 2,
            paddingHorizontal: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.35,
            shadowRadius: 10,
            elevation: 6,
          },
          tabBarActiveTintColor: Void.accent,
          tabBarInactiveTintColor: Void.textTertiary,
          tabBarLabelStyle: { fontSize: 9, fontWeight: '700', marginTop: 1 },
          tabBarIconStyle: { marginBottom: 0, marginTop: 0 },
          tabBarItemStyle: { paddingVertical: 2, paddingHorizontal: 2 },
          tabBarShowLabel: true,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Train',
            tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="body"
          listeners={intercept('body')}
          options={{
            title: 'Body',
            tabBarIcon: ({ color, size }) => mutedIcon((c, s) => <PersonStanding color={c as string} size={s} />, 'body')(color, size),
          }}
        />
        {/* Center "More" button - rendered as a tab but intercepts press */}
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color, size }) => <Grid color={color} size={size + 4} />,
            tabBarButton: () => (
              <Pressable
                style={moreStyles.centerBtn}
                onPress={() => setMoreOpen(true)}>
                <View style={moreStyles.centerCircle}>
                  <Grid color={Void.accentText} size={22} />
                </View>
                <Text style={moreStyles.centerLabel}>MORE</Text>
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="meals"
          listeners={intercept('meals')}
          options={{
            title: 'Meals',
            tabBarIcon: ({ color, size }) => mutedIcon((c, s) => <Utensils color={c as string} size={s} />, 'meals')(color, size),
          }}
        />
        <Tabs.Screen
          name="analytics"
          listeners={intercept('analytics')}
          options={{
            title: 'Void',
            tabBarIcon: ({ color, size }) => mutedIcon((c, s) => <ChartLine color={c as string} size={s} />, 'analytics')(color, size),
          }}
        />
        {/* Hidden tabs - accessible via More menu */}
        <Tabs.Screen
          name="logbook"
          options={{
            title: 'Logbook',
            tabBarIcon: ({ color, size }) => <Book color={color} size={size} />,
            href: null,
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Library',
            tabBarIcon: ({ color, size }) => <List color={color} size={size} />,
            href: null,
          }}
        />
        <Tabs.Screen
          name="social"
          options={{
            title: 'Feed',
            tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
            href: null,
          }}
        />
      </Tabs>

      {/* More menu modal */}
      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={moreStyles.backdrop} onPress={() => setMoreOpen(false)}>
          <Pressable style={moreStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={moreStyles.sheetTitle}>MORE</Text>
            <MoreItem dimmed={muted('logbook')} icon={<Book color={Void.accent} size={20} />} label="Logbook" onPress={() => morePress('logbook', '/logbook')} />
            <MoreItem dimmed={muted('library')} icon={<List color={Void.accent} size={20} />} label="Library" onPress={() => morePress('library', '/library')} />
            <MoreItem dimmed={muted('cardio')} icon={<Footprints color={Void.accent} size={20} />} label="Cardio" onPress={() => morePress('cardio', '/cardio')} />
            <MoreItem icon={<Users color={Void.accent} size={20} />} label="Feed" onPress={() => morePress('feed', '/social')} />
            <MoreItem icon={<Shield color={Void.accent} size={20} />} label="Policies" onPress={() => morePress('policies', '/policies')} />
            <Pressable
              style={[moreStyles.moreItem, { borderBottomWidth: 0 }]}
              onPress={() => { setMoreOpen(false); setFeedbackOpen(true); }}>
              <MessageSquarePlus color={Void.accent} size={20} />
              <Text style={moreStyles.moreItemText}>Feedback</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <FeedbackModal visible={feedbackOpen} userId={userId} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}

function MoreItem({ icon, label, onPress, dimmed }: { icon: React.ReactNode; label: string; onPress: () => void; dimmed?: boolean }) {
  return (
    <Pressable
      style={[moreStyles.moreItem, dimmed && { opacity: 0.35 }]}
      onPress={onPress}>
      {icon}
      <Text style={moreStyles.moreItemText}>{label}</Text>
    </Pressable>
  );
}

const moreStyles = StyleSheet.create({
  centerBtn: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  centerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
    shadowColor: Void.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  centerLabel: { color: Void.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', paddingBottom: 80 },
  sheet: { backgroundColor: Void.surface, borderRadius: 16, borderWidth: 1, borderColor: Void.border, marginHorizontal: 16, padding: 20 },
  sheetTitle: { color: Void.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 2, textAlign: 'center', marginBottom: 16 },
  moreItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  moreItemText: { color: Void.text, fontSize: 16, fontWeight: '600' },
});
