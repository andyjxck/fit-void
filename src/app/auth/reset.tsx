import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PasswordInput } from '@/components/ui/PasswordInput';
import { getSupabase } from '@/supabase/client';
import { Void } from '@/theme/tokens';

type Phase = 'loading' | 'invalid' | 'ready' | 'success';

/** Pull key=value params out of both the query string and the #fragment. */
function parseLinkParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const collect = (raw: string) => {
    for (const pair of raw.split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = pair.slice(0, eq);
      try {
        params[key] = decodeURIComponent(pair.slice(eq + 1));
      } catch {
        params[key] = pair.slice(eq + 1);
      }
    }
  };
  const hashIdx = url.indexOf('#');
  const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = beforeHash.indexOf('?');
  if (qIdx >= 0) collect(beforeHash.slice(qIdx + 1));
  if (hashIdx >= 0) {
    let fragment = url.slice(hashIdx + 1);
    // Some flows nest a second query inside the fragment.
    const fQ = fragment.indexOf('?');
    if (fQ >= 0) fragment = fragment.slice(fQ + 1);
    collect(fragment);
  }
  return params;
}

/**
 * Deep-link target for password reset (gymvoid://auth/reset). Supabase lands
 * here with either ?code=... (PKCE) or #access_token=...&refresh_token=...&type=recovery.
 * Once the session is established the user picks a new password.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);
  const sb = getSupabase();

  useEffect(() => {
    let cancelled = false;

    const handleUrl = async (url: string | null) => {
      if (handled.current || cancelled) return;
      if (!url) {
        // Show the invalid state, but leave handled=false so a 'url' event
        // (app already running) can still complete the exchange.
        if (!cancelled) setPhase('invalid');
        return;
      }
      if (!sb) {
        handled.current = true;
        if (!cancelled) setPhase('invalid');
        return;
      }
      const params = parseLinkParams(url);
      const hasCode = !!params.code;
      const hasRecoveryTokens =
        !!params.access_token && !!params.refresh_token && params.type === 'recovery';
      if (!hasCode && !hasRecoveryTokens) {
        // Not a reset link - leave handled=false so a later 'url' event with
        // real params can still complete the exchange.
        if (!cancelled) setPhase('invalid');
        return;
      }
      handled.current = true;
      setPhase('loading');
      try {
        if (hasCode) {
          const { error: exchErr } = await sb.auth.exchangeCodeForSession(params.code);
          if (exchErr) throw exchErr;
        } else {
          const { error: sessErr } = await sb.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (sessErr) throw sessErr;
        }
        if (!cancelled) setPhase('ready');
      } catch (e) {
        console.warn('Reset link exchange failed', e);
        if (!cancelled) {
          setError('The link may have expired - request a new one.');
          setPhase('invalid');
        }
      }
    };

    void Linking.getInitialURL().then(handleUrl);
    // If the app was already running, the link arrives as an event instead.
    const sub = Linking.addEventListener('url', (ev) => void handleUrl(ev.url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [sb]);

  const submit = async () => {
    if (!sb || busy) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: updErr } = await sb.auth.updateUser({ password });
      if (updErr) throw updErr;
      setPhase('success');
      setTimeout(() => router.replace('/'), 1200);
    } catch (e) {
      console.warn('Password update failed', e);
      setError('Could not update password. The link may have expired - request a new one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.replace('/')} hitSlop={8}>
          <X color={Void.textSecondary} size={22} />
        </Pressable>
      </View>

      <Text style={styles.title}>
        {phase === 'success' ? 'PASSWORD UPDATED' : 'SET NEW PASSWORD'}
      </Text>

      {phase === 'loading' ? (
        <Text style={styles.sub}>Verifying your reset link…</Text>
      ) : phase === 'invalid' ? (
        <>
          <Text style={styles.sub}>
            This reset link is invalid or expired. Request a new one from the sign-in screen.
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable style={styles.primaryBtn} onPress={() => router.replace('/')}>
            <Text style={styles.primaryText}>BACK TO SIGN IN</Text>
          </Pressable>
        </>
      ) : phase === 'success' ? (
        <Text style={styles.sub}>PASSWORD UPDATED - you&apos;re signed in.</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            placeholder="New password"
            autoFocus
          />
          <PasswordInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Confirm new password"
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy || !password || !confirm}
            onPress={() => void submit()}>
            <Text style={styles.primaryText}>{busy ? 'UPDATING…' : 'SET PASSWORD'}</Text>
          </Pressable>
          <Text style={styles.hint}>At least 8 characters.</Text>
        </View>
      )}
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
    marginTop: 12,
    marginBottom: 32,
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: Void.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryText: { color: Void.accentText, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  errorText: { color: Void.danger, fontSize: 13, textAlign: 'center', marginTop: -20, marginBottom: 24 },
  hint: { color: Void.textTertiary, fontSize: 11, textAlign: 'center' },
});
