import { Redirect } from 'expo-router';

/**
 * OAuth deep-link target (gymvoid://auth/callback). The session exchange
 * happens inside the auth session in link.tsx - this route exists only so
 * the returned URL resolves instead of hitting the unmatched-route screen.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
