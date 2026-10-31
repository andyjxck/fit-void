import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
    Apple,
    ChartLine,
    Check,
    Droplet,
    Dumbbell,
    Flame,
    Footprints,
    Moon,
    Ruler,
    Users
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardSheen, cardChrome } from '@/components/ui';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { ensureDefaultWidgets, ensureFocusWidgets, hideWidget, listWidgets } from '@/db/repo/widgets';
import { ALL_INTENTS, INTENT_LABELS, isWidgetVisible, type Intent } from '@/lib/intents';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { getSupabase } from '@/supabase/client';
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

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const set = useSettings((s) => s.set);
  const sb = getSupabase();

  const [step, setStep] = useState(0); // 0 = goal, 1 = transparency, 2 = sign-in
  const [startIntents, setStartIntents] = useState<Intent[]>(['lift']);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const toggleIntent = (i: Intent) =>
    setStartIntents((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );

  /** Persist focus choice + seed a tailored grid, then leave the wizard.
   *  Empty selection = ALL (no filter) - the user's normal, unfiltered layout. */
  const finish = async () => {
    const intents = startIntents;
    set({
      primary_goal: intents.includes('lift') ? 'strength' : 'general',
      unlock_speed: 'all_at_once',
      active_intents: JSON.stringify(intents),
      unlocked_modules: JSON.stringify(ALL_INTENTS),
      seeded_intents: JSON.stringify(intents),
      onboarding_completed: true,
    });
    await ensureDefaultWidgets();
    for (const i of intents) {
      await ensureFocusWidgets(i);
    }
    if (intents.length > 0) {
      const ws = await listWidgets();
      for (const w of ws) {
        if (!isWidgetVisible(w.widget_type, w.config, intents)) {
          await hideWidget(w.id);
        }
      }
    }
    router.replace('/(tabs)');
  };

  const signInApple = async () => {
    if (!sb) return;
    setBusy(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identity token');
      const { error } = await sb.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;
      await finish();
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        notify('Sign-in failed', { body: 'Check your details and try again.', tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const signInGoogle = async () => {
    if (!sb) return;
    setBusy(true);
    const redirectTo = 'gymvoid://auth/callback';
    try {
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Google sign-in is unavailable');
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== 'success' || !res.url) return;
      const code = new URL(res.url).searchParams.get('code');
      if (!code) throw new Error('Google sign-in did not complete');
      const { error: exchErr } = await sb.auth.exchangeCodeForSession(code);
      if (exchErr) throw exchErr;
      await finish();
    } catch (e) {
      notify('Sign-in failed', { body: 'Check your details and try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const signInEmail = async () => {
    if (!sb || !email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const code = (error as { code?: string }).code ?? '';
        const msg = (error.message ?? '').toLowerCase();
        if (code !== 'invalid_credentials' && !msg.includes('invalid login credentials')) throw error;
        const { error: signUpErr } = await sb.auth.signUp({ email: email.trim(), password });
        if (signUpErr) throw signUpErr;
      }
      await finish();
    } catch (e) {
      notify('Sign-in failed', { body: 'Check your details and try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.brand}>VOID</Text>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, i <= step && styles.dotOn]} />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, step === 0 && styles.bodyCentered]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {step === 0 && (
          <>
            <Text style={styles.kicker}>STEP 1</Text>
            <Text style={styles.heroTitle}>
              WHAT'S YOUR{'\n'}<Text style={styles.heroAccent}>GOAL</Text>?
            </Text>
            <Text style={styles.sub}>Pick what you want Void for. Pick as many as you like.</Text>
            <View style={styles.goalGrid}>
              {ALL_INTENTS.map((i) => {
                const Icon = INTENT_ICONS[i];
                const on = startIntents.includes(i);
                return (
                  <Pressable
                    key={i}
                    style={[styles.goalTile, on && styles.goalTileOn]}
                    onPress={() => toggleIntent(i)}>
                    <CardSheen radius={14} />
                    <View style={styles.goalIconWrap}>
                      <Icon color={Void.accent} size={22} />
                    </View>
                    <Text style={styles.goalTileTitle}>{INTENT_LABELS[i]}</Text>
                    {on && (
                      <View style={styles.goalCheck}>
                        <Check color={Void.accentText} size={9} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.kicker}>STEP 2</Text>
            <Text style={styles.heroTitle}>
              WHAT YOU{'\n'}<Text style={styles.heroAccent}>GET</Text>
            </Text>
            <Text style={styles.sub}>Here's what's included, right out of the gate.</Text>

            <View style={{ gap: 8 }}>
              {[
                { icon: Dumbbell, title: 'Full workout logging', desc: 'Sets, reps, RPE, supersets, rest timer, plate calculator' },
                { icon: ChartLine, title: 'PRs & analytics', desc: 'Muscle heatmap, e1RM trends, strength score, insights' },
                { icon: Apple, title: 'Nutrition tracking', desc: 'Barcode scanning, recipe import, calories, macros' },
                { icon: Droplet, title: 'Hydration & body comp', desc: 'Drinks, weight, measurements, check-ins' },
                { icon: Footprints, title: 'Cardio & health sync', desc: 'Cardio logging, HR zones, health app import' },
                { icon: Users, title: 'Social & gym check-ins', desc: 'Feed, friends, gym map' },
                { icon: Moon, title: 'Sync & offline mode', desc: 'Local-first storage, optional cloud backup' },
              ].map((f) => (
                <View key={f.title} style={styles.featureRow}>
                  <CardSheen radius={14} />
                  <View style={styles.featureIcon}>
                    <f.icon color={Void.accent} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                    <Text style={styles.featureDesc}>{f.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.accountTitle}>ACCOUNT</Text>
            <Text style={styles.accountSub}>
              Optional. Sign in to back up and sync across devices, or stay fully offline as a guest.
            </Text>

            <View style={{ gap: 10 }}>
              <Pressable
                style={[styles.appleBtn, busy && { opacity: 0.6 }]}
                disabled={busy}
                onPress={() => void signInApple()}>
                <Text style={styles.appleText}> Continue with Apple</Text>
              </Pressable>
              <Pressable
                style={[styles.googleBtn, busy && { opacity: 0.6 }]}
                disabled={busy}
                onPress={() => void signInGoogle()}>
                <Text style={styles.googleText}>Continue with Google</Text>
              </Pressable>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR WITH EMAIL</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={{ gap: 8 }}>
                <TextInput
                  style={styles.devInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor={Void.textTertiary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                />
                <PasswordInput value={password} onChangeText={setPassword} placeholder="Password" showStrength={false} />
                <Pressable
                  style={[styles.devBtn, (busy || !email.trim() || !password) && { opacity: 0.6 }]}
                  disabled={busy || !email.trim() || !password}
                  onPress={() => void signInEmail()}>
                  <Text style={styles.devBtnText}>{busy ? 'SIGNING IN…' : 'SIGN IN WITH EMAIL'}</Text>
                </Pressable>
                <Text style={styles.devHint}>Signs in to an existing account or creates a new one.</Text>
              </View>
            </View>

            <Pressable style={styles.guestBtn} disabled={busy} onPress={() => void finish()}>
              <Text style={styles.guestText}>Continue as guest for now</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {step < 2 && (
        <View style={styles.footer}>
          {step === 1 && (
            <Pressable style={styles.backBtn} onPress={() => setStep(0)}>
              <Text style={styles.backText}>BACK</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.nextBtn, step === 0 && startIntents.length === 0 && { opacity: 0.4 }]}
            disabled={step === 0 && startIntents.length === 0}
            onPress={() => setStep(step + 1)}>
            <CardSheen radius={14} />
            <Text style={styles.nextText}>NEXT</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Void.canvas },
  brand: {
    color: Void.accent,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Void.border },
  dotOn: { backgroundColor: Void.accent },
  body: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 20 },
  bodyCentered: { flexGrow: 1, justifyContent: 'center' },
  kicker: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  heroTitle: {
    color: Void.text,
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 42,
    marginTop: 10,
    marginBottom: 14,
  },
  heroAccent: { color: Void.accent },
  sub: { color: Void.textSecondary, fontSize: 13, marginBottom: 22 },
  accountTitle: {
    color: Void.text,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 10,
  },
  accountSub: {
    color: Void.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  goalTile: {
    ...cardChrome,
    width: '31.5%',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    overflow: 'hidden',
  },
  goalTileOn: { borderColor: Void.accent },
  goalIconWrap: { alignItems: 'center', justifyContent: 'center' },
  goalTileTitle: { color: Void.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center' },
  goalCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleBtn: {
    backgroundColor: Void.text,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  appleText: { color: '#000', fontWeight: '700', fontSize: 15 },
  googleBtn: {
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  googleText: { color: Void.text, fontWeight: '700', fontSize: 15 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Void.border },
  dividerText: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  devInput: {
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Void.text,
    fontSize: 14,
  },
  devBtn: { backgroundColor: Void.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  devBtnText: { color: Void.accentText, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  devHint: { color: Void.textTertiary, fontSize: 11, textAlign: 'center', lineHeight: 15 },
  guestBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 14 },
  guestText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700' },
  featureRow: {
    ...cardChrome,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
    overflow: 'hidden',
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Void.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: { color: Void.text, fontSize: 13, fontWeight: '800', marginBottom: 2 },
  featureDesc: { color: Void.textSecondary, fontSize: 11, lineHeight: 15 },
  backBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Void.border,
    alignItems: 'center',
  },
  backText: { color: Void.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  nextBtn: {
    ...cardChrome,
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    overflow: 'hidden',
  },
  nextText: { color: Void.accent, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
});
