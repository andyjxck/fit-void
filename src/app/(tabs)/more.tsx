// Placeholder - the "More" tab button is intercepted by the tab bar layout
// to open a modal menu instead of navigating here.
import { Redirect } from 'expo-router';

export default function MoreScreen() {
  return <Redirect href="/" />;
}
