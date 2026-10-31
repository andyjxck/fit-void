import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardChrome, CardSheen, Screen, ScreenHeader } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { Void } from '@/theme/tokens';

// -- Content ---------------------------------------------------------------

interface Section { heading: string; body: string[] }

const PRIVACY: Section[] = [
  {
    heading: 'Who we are',
    body: [
      'Fit Void is operated by Andrew Blewett ("we", "us"). This policy explains what personal data we collect, why, and your rights under the UK GDPR and the Data Protection Act 2018.',
      'Contact: andy@andysocialapps.website',
    ],
  },
  {
    heading: 'What we collect',
    body: [
      'Stored on your device (local SQLite, never uploaded unless you link an account): workouts, sets, reps, weights, routines, personal records, body measurements, cardio sessions, meals, meal plans, food logs, drink logs, scanned foods, widget layout, app settings, and profile fields imported from connected health platforms (height, date of birth, sex, activity level).',
      'If you link an account (any tier): your sign-in details, friend code, username, display name, bio, profile photo, favourite PBs, posts, comments, trophies, friendships, blocked-user list, liked posts, photos shared with tagged friends, gym check-ins (gym name and, when available, its coordinates), and weekly comparison stats (training volume, workouts, calories, steps) are stored in Supabase (hosted in the EU).',
      'If you have Void Pro: your logged data - workouts, routines, cardio, meals, meal plans, food logs, drink logs, measurements and scanned foods, including logs imported from your health platforms - syncs to Supabase for backup and cross-device access. On the free tier these logs stay on your device only.',
      'If you collaborate on a routine: your membership of that routine, your edits to it (exercises, tabs, targets), and - during a shared workout - your live sets, reps and weights are stored in Supabase and shown to the routine\'s collaborators. Heart rate is never shared.',
      'Gym search sends your approximate location or search text to OpenStreetMap services (Nominatim and Overpass) to find nearby gyms. Nothing else is sent with those requests.',
      'Health data (weight, nutrition, hydration, cardio, sleep, resting heart rate, HRV, body fat) is read from Apple Health, Health Connect, or Google Health (Fitbit) only if you tap Connect. Height, date of birth, sex, and activity level may be read to pre-fill your local profile - these profile fields are stored on your device only and are never synced. Health-imported logs stay on your device on the free tier and sync with Void Pro; deleting your account removes the cloud copy.',
      'We do not collect analytics, advertising IDs, or crash telemetry.',
    ],
  },
  {
    heading: 'Why we use it',
    body: [
      'To run the app (contract): logging, analytics, meal plans, hydration, body tracking.',
      'To provide social features (contract): feed, friends, posts, comments, shared photos, gym check-ins, and collaborative routines with shared live workouts.',
      'To sync your data across devices (consent): only if you link an account and have Void Pro.',
      'To unlock purchased features: we store your Void Pro tier status on your profile. Payments, receipts and tax records are handled by Apple.',
    ],
  },
  {
    heading: 'Who sees it',
    body: [
      'Your posts, profile (name, username, bio, avatar, PBs), comments, and weekly comparison stats are visible to your friends. Your friend code is private - only people you share it with can add you.',
      'Gym check-ins appear on your friends\' map - but never sooner than 2 hours after you check in, and only for the following 24 hours. Your own check-ins are always visible to you.',
      'Collaborators on a shared routine can see the routine, everyone\'s edits, and each other\'s live sets, reps and weights during a shared workout - never heart rate. Leaving a routine or being removed ends that access and deletes your live-session data.',
      'Supabase (cloud host, EU region) stores linked-account data. Your health profile characteristics (date of birth, sex, height) never leave your device - they are stored locally only.',
      'We do not sell your data. Ever.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Access: export your workout history any time from Logbook > Export.',
      'Erasure: delete the app to wipe local data; delete your account in-app (Social > your profile > Delete account) to remove cloud data.',
      'Rectification: edit your profile, workouts, and logs in-app.',
      'Portability: CSV export of your full workout history.',
      'Object: stop social features by unlinking or deleting your account.',
      'Complain to the ICO: ico.org.uk',
    ],
  },
  {
    heading: 'Retention',
    body: [
      'Local data stays on your device until you delete the app. Cloud data is kept while your account exists and deleted within 30 days of account removal.',
    ],
  },
  {
    heading: 'Children',
    body: [
      'Fit Void is not intended for children under 16. If you believe a child has an account, contact andy@andysocialapps.website.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      'We will update this policy when the app changes. The "last updated" date is at the top; material changes will be announced in-app.',
      'Last updated: 4 October 2026.',
    ],
  },
];

const TERMS: Section[] = [
  {
    heading: 'The deal',
    body: [
      'Fit Void is a workout, meal, and body tracker. These terms govern your use of the app. By using it you agree to them. If you do not agree, do not use the app.',
      'You must be 16 or older to use social features.',
    ],
  },
  {
    heading: 'What you get',
    body: [
      'Free: the full app with usage limits - up to 8 routines, 3 folders, 2 sub-routine tabs per routine, 9 custom exercises, 1 meal plan, 2 health imports per week, and one insight per analytics section. Your logs stay on your device.',
      'Void Pro (monthly or yearly subscription): raises every limit and adds cloud backup and sync across devices, collaborative routines with live shared workouts, unlimited health imports, widget rearranging, and the full insights set.',
      'Void Pro Max (one-time purchase): everything in Pro with no limits at all, plus a MAX badge and early access to new features.',
      'A collaborative routine unlocks when at least one member has Void Pro; once unlocked every member can use all shared features.',
      'If a subscription lapses, everything you made stays usable - you just cannot create new items over the free limits until you resubscribe or delete some.',
    ],
  },
  {
    heading: 'Subscriptions',
    body: [
      'Void Pro is billed through the App Store as a monthly or yearly auto-renewing subscription with a 3 day free trial for new subscribers. Void Pro Max is a one-time lifetime purchase.',
      'Subscriptions renew automatically unless cancelled at least 24 hours before the period ends. Manage or cancel in iOS Settings > Apple ID > Subscriptions.',
      'You can restore past purchases from the paywall screen.',
      'Refunds are handled by Apple under their refund policy. We cannot issue refunds directly.',
      'If we change pricing we will give you 30 days notice before it applies to you.',
    ],
  },
  {
    heading: 'Your content',
    body: [
      'You own your posts, photos, and profile. You grant us a licence to store and display them to your friends.',
      'Do not post content that is illegal, harassing, hateful, or infringes others\' rights. We can remove content and suspend accounts that break this.',
      'You can delete posts and your profile at any time.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'Do not use the app to harass, stalk, or harm others. Do not scrape or reverse-engineer the service. Do not use it if you are under 16.',
      'We may suspend or terminate accounts that break these terms.',
    ],
  },
  {
    heading: 'Medical & fitness disclaimer',
    body: [
      'Fit Void is a tracking tool, not medical advice. Calorie estimates, 1RM predictions, and health metrics are approximations. Consult a doctor before starting any exercise or diet programme.',
      'We are not responsible for injuries sustained while following data or recommendations in the app.',
    ],
  },
  {
    heading: 'Liability',
    body: [
      'The app is provided "as is". We are liable only for direct losses caused by our breach of these terms, up to the amount you paid us in the last 12 months (or £50 if you paid nothing).',
      'Nothing in these terms excludes liability for death or personal injury caused by negligence, or for fraud.',
    ],
  },
  {
    heading: 'Governing law',
    body: [
      'These terms are governed by the laws of England and Wales. UK courts have exclusive jurisdiction.',
      'Last updated: 4 October 2026.',
    ],
  },
];

const TRANSPARENCY: Section[] = [
  {
    heading: 'How your data works',
    body: [
      'Fit Void is local-first. Everything you log - workouts, meals, body metrics - lives in a SQLite database on your device. It works fully offline.',
      'If you link an account, your social data - profile, posts, friends, check-ins - is stored in Supabase (our cloud host). Your logged data only syncs to the cloud with Void Pro; on the free tier it stays on your device. Signing out wipes the local copy on that device; deleting your account removes the cloud copy.',
    ],
  },
  {
    heading: 'What leaves your device',
    body: [
      'If you link an account: your profile (name, username, bio, avatar, PBs), posts, comments, friendships, photos shared with tagged friends, gym check-ins (gym name and coordinates), and weekly comparison stats. Only with Void Pro do your logs also leave the device - workouts, cardio, meals, hydration, food library and measurements, including anything imported from a connected health platform.',
      'If you join a shared routine: your membership, edits, and - during a shared workout - your live sets, reps and weights go to Supabase so collaborators can see them in real time. Heart rate is never shared.',
      'Check-ins only appear on your friends\' map after a 2-hour cooldown and disappear after 24 hours.',
      'Importing a recipe fetches the web page you paste directly from your device - the site sees your request like any browser visit. Nothing else is sent.',
      'Gym search sends your approximate location or search text to OpenStreetMap services to find gyms near you. No account details go with it.',
      'Health data is read from Apple Health, Health Connect, or Google Health (Fitbit) only if you tap Connect. Height, date of birth, sex, and activity level are read to pre-fill your profile and stay on your device - they are never synced.',
      'Barcode scans go to Open Food Facts, USDA, Nutritionix, and FatSecret (the last two via our edge function so API keys never touch your device) - no personal data is sent with them.',
    ],
  },
  {
    heading: 'What we never do',
    body: [
      'Sell your data. Show ads. Track you across other apps. Use analytics SDKs. Read your health data without you tapping Connect. Sync your date of birth, sex, or height. Keep deleted account data longer than 30 days.',
    ],
  },
  {
    heading: 'Third parties',
    body: [
      'Supabase - cloud database, storage and auth (EU region).',
      'Apple - Sign in with Apple, App Store billing, Apple Health (read-only health data, stays on your device).',
      'Health Connect - read-only health data on Android, stays on your device.',
      'Google - sign-in, plus Google Health (Fitbit) if you connect it: read-only activity, sleep, heart-rate, nutrition and hydration data; also your Fitbit profile height/age and Google birthday/gender (People API) to pre-fill your local profile. Profile fields are never synced.',
      'Open Food Facts - barcode nutrition lookup (open database, ODbL licence). No personal data is sent with scans.',
      'USDA FoodData Central - nutrition lookup for generic foods.',
      'Nutritionix - nutrition lookup for branded foods and natural-language queries (via our edge function - your device never sees the API key).',
      'FatSecret Platform API - nutrition lookup and food search (via our edge function).',
      'OpenStreetMap (Nominatim & Overpass) - gym name search and nearby-gym lookup for check-ins.',
      'free-exercise-db - exercise library data and images (open source).',
      'Resend - transactional email (sign-in, password reset, reports).',
    ],
  },
  {
    heading: 'Open data',
    body: [
      'The exercise library uses free-exercise-db (open source, GitHub). Barcode nutrition uses Open Food Facts (ODbL licence). Generic-food nutrition uses USDA FoodData Central (public domain). We credit all sources here and welcome corrections.',
    ],
  },
  {
    heading: 'Delete everything',
    body: [
      'Delete the app to wipe local data. Delete your account in-app (Social > your profile > Delete account) to remove cloud data. Full deletion completes within 30 days.',
      'Questions: andy@andysocialapps.website',
    ],
  },
  {
    heading: 'Credits',
    body: [
      'Fit Void exists because these people tested early builds, pushed back on bad ideas, and believed in the project before it deserved it:',
      'Adaa Ahmed',
      'Liam Redman',
      'Kai Barnett',
      'Jayden Collins',
      'Alexander Ross-Lines',
      'Thank you.',
    ],
  },
  {
    heading: 'Last updated',
    body: [
      'This page reflects the app as it is today. Last updated: 4 October 2026.',
    ],
  },
];

const DOCS = [
  { key: 'privacy', label: 'PRIVACY', sections: PRIVACY },
  { key: 'terms', label: 'TERMS', sections: TERMS },
  { key: 'transparency', label: 'TRANSPARENCY', sections: TRANSPARENCY },
] as const;

type DocKey = (typeof DOCS)[number]['key'];

// -- Screen ------------------------------------------------------------------

export default function PoliciesScreen() {
  const router = useRouter();
  const [doc, setDoc] = useState<DocKey>('privacy');
  const active = DOCS.find((d) => d.key === doc)!;

  return (
    <Screen>
      <ScreenHeader title="Policies" onBack={() => goBack()} />

      <View style={s.wrap}>
        {/* Tab pill - sits on top of the card edge */}
        <View style={s.tabBox}>
          {DOCS.map((d) => (
            <Pressable
              key={d.key}
              style={[s.tab, doc === d.key && s.tabActive]}
              onPress={() => setDoc(d.key)}>
              <Text style={[s.tabText, doc === d.key && s.tabTextActive]}>{d.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Policy card - the tab pill overlaps its top edge */}
        <View style={s.card}>
          <CardSheen radius={16} />
          <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
            {active.sections.map((sec, i) => (
              <View key={i} style={s.section}>
                <Text style={s.heading}>{sec.heading}</Text>
                {sec.body.map((p, j) => (
                  <Text key={j} style={s.para}>{p}</Text>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 20 },
  tabBox: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: Void.canvas,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    padding: 3,
    zIndex: 2,
    marginBottom: -18, // overlap the card below
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 9 },
  tabActive: { backgroundColor: Void.accent },
  tabText: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  tabTextActive: { color: Void.accentText },
  card: {
    flex: 1,
    ...cardChrome,
    borderRadius: 16,
    paddingTop: 18, // room for the overlapping tab pill
    marginBottom: 16,
  },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48 },
  section: { marginTop: 20 },
  heading: { color: Void.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 },
  para: { color: Void.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 8 },
});
