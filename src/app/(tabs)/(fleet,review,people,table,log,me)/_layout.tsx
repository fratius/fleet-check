import { Stack } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';
import { Platform, Text, useWindowDimensions } from 'react-native';

import { F, fitSize, hs, textWidth, useColors, useFontsReady } from '@/components/ui';
import { N_, isRtl, t } from '@/lib/i18n';

/**
 * Each tab has its own stack, so the tab bar stays at the bottom on every page and each tab remembers where you
 * were. Vans, walk-arounds, checks and people open inside whichever tab you're in, with a fixed header and a back
 * button. Tapping the tab you're in goes back to its first page.
 */
// The Account tab's group is called (me) so that (fleet) sorts first: a link opened from outside the app
// (or a reloaded web page) lands in the first group, and that should be the Fleet tab.
export const unstable_settings = {
  fleet: { anchor: 'index' },
  review: { anchor: 'review' },
  people: { anchor: 'people' },
  table: { anchor: 'data' },
  log: { anchor: 'log' },
  me: { anchor: 'account' },
};

const ROOT: Record<string, { name: string; title: string }> = {
  '(fleet)': { name: 'index', title: N_('Fleet') },
  '(review)': { name: 'review', title: N_('Review') },
  '(people)': { name: 'people', title: N_('People') },
  '(table)': { name: 'data', title: N_('Data') },
  '(log)': { name: 'log', title: N_('Test log') },
  '(me)': { name: 'account', title: N_('Account') },
};

/**
 * A page's title on the web: whole words on up to two lines at the usual size; a longer one (a person's name without
 * spaces) smaller, on up to three lines, so it is never cut with "…" (blind QA of cause 4, round 1). The room is the
 * header's width less its back button and edges.
 */
function HeaderTitle({ children }: { children: string }) {
  const c = useColors();
  const fonts = useFontsReady();
  const { width: win } = useWindowDimensions();
  const room = Math.min(win, 1400) - 120;
  const big = hs(21);
  const fits = fitSize(children, F.cond, big, room, { words: true, min: 1, fonts }) >= big && textWidth(children, F.cond, big, fonts) <= room * 1.8;
  const size = fits ? big : 16;
  return (
    <Text accessibilityRole="header" numberOfLines={fits ? 2 : 3} style={{ fontFamily: F.cond, fontSize: size, lineHeight: Math.round(size * 1.1), color: c.ink }}>{children}</Text>
  );
}

export default function TabStack({ segment }: { segment: string }) {
  const c = useColors();
  const root = ROOT[segment] || ROOT['(fleet)'];
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: c.page },
      headerShadowVisible: false,
      headerTintColor: c.ink,
      headerTitleStyle: { fontFamily: F.cond, fontSize: hs(21), color: c.ink },
      headerBackTitleStyle: { fontFamily: F.medium, fontSize: 16 },
      contentStyle: { backgroundColor: c.page },
      // The web's back button says "Back" to screen readers in the app's language (it said "Fleet, back" in English in
      // every language: blind test, cause 4.4). The phone apps keep their own, which follow the phone's language.
      ...(Platform.OS === 'web' ? {
        // In Arabic and Persian the arrow is turned round, to point back the way they read (blind QA of cause 4, round 1).
        headerLeft: (p: React.ComponentProps<typeof HeaderBackButton> & { canGoBack?: boolean }) => (p.canGoBack
          ? <HeaderBackButton {...p} testID="header-back" accessibilityLabel={t('Back')} style={[p.style, isRtl() ? { transform: [{ scaleX: -1 }] } : null]} /> : null),
        // A long title (a person's name without spaces) wraps instead of being cut (cause 4.3).
        headerTitle: ({ children }: { children: string }) => <HeaderTitle>{children}</HeaderTitle>,
      } : null),
    }}>
      {/* The first page of the tab has its own big title. */}
      <Stack.Screen name={root.name} options={{ headerShown: false, title: t(root.title) }} />
      {segment === '(fleet)' ? <Stack.Screen name="add" options={{ title: t('Add vehicle') }} /> : null}
      {segment === '(fleet)' ? <Stack.Screen name="bulk" options={{ title: t('Add the whole fleet') }} /> : null}
      <Stack.Screen name="vehicle/[id]" options={{ title: t('Van') }} />
      <Stack.Screen name="walk/[id]" options={{ title: t('Walk-around') }} />
      <Stack.Screen name="check/[id]" options={{ title: t('Damage check') }} />
      <Stack.Screen name="person/[uid]" options={{ title: t('Person') }} />
      <Stack.Screen name="video/[id]" options={{ title: t('Video') }} />
      <Stack.Screen name="buy/[id]" options={{ title: t('Refuel') }} />
      <Stack.Screen name="checks" options={{ title: t('Checks for drivers') }} />
      <Stack.Screen name="uploads" options={{ title: t('Waiting to send') }} />
    </Stack>
  );
}
