import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IntegrationsCard } from '@/components/IntegrationsCard';
import { cardChrome, CardSheen } from '@/components/ui';
import { NotifyHost } from '@/components/ui/Notify';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { signOutWipe, wipeLocalUserData } from '@/db/sync';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { getSupabase } from '@/supabase/client';
import { Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

/**
 * Optional account link - exists solely for multi-device sync and cloud
 * backup. Guests keep 100% of gym functionality without it.
 */
export default function LinkAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const linked = useSettings((s) => s.supabase_user_id);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const sb = getSupabase();

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
      // claimGuestData + profile sync fire via the auth listener in _layout.
      router.back();
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        console.warn('Apple sign-in failed', e);
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
      router.back();
    } catch (e) {
      console.warn('Google sign-in failed', e);
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
        // Only "wrong credentials" means "maybe the account doesn't exist yet" -
        // network/server errors must not trigger a bogus signUp attempt.
        const code = (error as { code?: string }).code ?? '';
        const msg = (error.message ?? '').toLowerCase();
        const invalidCreds = code === 'invalid_credentials' || msg.includes('invalid login credentials');
        if (!invalidCreds) throw error;
        const { error: signUpErr } = await sb.auth.signUp({ email: email.trim(), password });
        if (signUpErr) throw signUpErr;
      }
      router.back();
    } catch (e) {
      console.warn('Email sign-in failed', e);
      notify('Sign-in failed', { body: 'Check your details and try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    const res = await signOutWipe();
    if (res === 'sync-failed') {
      const proceed = await confirm({
        title: 'Sync incomplete',
        body: 'Some changes have not been backed up. Sign out anyway? Unsynced data will be lost.',
        confirmText: 'SIGN OUT',
        destructive: true,
      });
      if (!proceed) return;
      await wipeLocalUserData();
      useSettings.getState().set({ supabase_user_id: null });
      await sb?.auth.signOut();
    }
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack()} hitSlop={8}>
          <X color={Void.textSecondary} size={22} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>ACCOUNT</Text>
      <Text style={styles.sub}>
        {linked
          ? 'Linked. Sessions sync across devices and back up to the void.'
          : 'Optional. Link an account only for multi-device sync and automated cloud backups.'}
      </Text>

      {!sb ? (
        <View style={styles.box}>
          <CardSheen />
          <Text style={styles.boxText}>
            Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and
            EXPO_PUBLIC_SUPABASE_ANON_KEY - until then the app runs fully offline as a guest.
          </Text>
        </View>
      ) : linked ? (
        <Pressable style={styles.dangerBtn} onPress={() => void signOut()}>
          <Text style={styles.dangerText}>UNLINK / SIGN OUT</Text>
        </Pressable>
      ) : (
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
              style={[styles.devBtn, busy && { opacity: 0.6 }]}
              disabled={busy || !email.trim() || !password}
              onPress={() => void signInEmail()}>
              <Text style={styles.devBtnText}>{busy ? 'SIGNING IN…' : 'SIGN IN WITH EMAIL'}</Text>
            </Pressable>
            <Pressable
              style={styles.forgotBtn}
              onPress={() => {
                if (!email.trim()) { notify('Enter your email', { body: 'Type your email above first so we know where to send the reset link.', tone: 'info' }); return; }
                if (!sb) return;
                void sb.functions.invoke('password-reset', { body: { email: email.trim() } })
                  .then(() => notify('If that email has an account, a reset link is on its way.', { tone: 'success' }))
                  .catch((e) => {
                    console.warn('password-reset invoke failed', e);
                    notify('Could not send reset', { body: 'Check your connection and try again.', tone: 'error' });
                  });
              }}>
              <Text style={styles.forgotBtnText}>FORGOT PASSWORD</Text>
            </Pressable>
            <Text style={styles.devHint}>Signs in existing accounts or creates a new one.</Text>
          </View>
        </View>
      )}

      <Text style={styles.legal}>
        Guest data is claimed into your account on first link - nothing is lost.
      </Text>

      <View style={{ marginTop: 28, paddingBottom: 40 }}>
        <IntegrationsCard />
      </View>
      </ScrollView>
      </KeyboardAvoidingView>
      {/* Modal-presented screen: needs its own host (root host renders beneath). */}
      <NotifyHost />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Void.canvas, paddingHorizontal: 20 },
  topBar: { alignItems: 'flex-end' },
  title: {
    color: Void.text,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 24,
  },
  sub: {
    color: Void.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 32,
    lineHeight: 20,
  },
  box: {
    ...cardChrome,
    borderRadius: 12,
    padding: 16,
  },
  boxText: { color: Void.textSecondary, fontSize: 13, lineHeight: 19 },
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
  devInput: { backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: Void.text, fontSize: 14 },
  devBtn: { backgroundColor: Void.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  devBtnText: { color: Void.accentText, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  devHint: { color: Void.textTertiary, fontSize: 11, textAlign: 'center', lineHeight: 15 },
  forgotLink: { alignSelf: 'center', marginTop: 10 },
  forgotText: { color: Void.textTertiary, fontSize: 11 },
  forgotBtn: { borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  forgotBtnText: { color: Void.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: Void.danger,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  dangerText: { color: Void.danger, fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  legal: { color: Void.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 20, lineHeight: 16 },
});
