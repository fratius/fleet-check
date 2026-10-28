import { Stack } from 'expo-router';

import { F, useColors } from '@/components/ui';
import { N_, t } from '@/lib/i18n';

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

export default function TabStack({ segment }: { segment: string }) {
  const c = useColors();
  const root = ROOT[segment] || ROOT['(fleet)'];
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: c.page },
      headerShadowVisible: false,
      headerTintColor: c.ink,
      headerTitleStyle: { fontFamily: F.cond, fontSize: 21, color: c.ink },
      headerBackTitleStyle: { fontFamily: F.medium, fontSize: 16 },
      contentStyle: { backgroundColor: c.page },
    }}>
      {/* The first page of the tab has its own big title. */}
      <Stack.Screen name={root.name} options={{ headerShown: false, title: t(root.title) }} />
      {segment === '(fleet)' ? <Stack.Screen name="add" options={{ title: t('Add vehicle') }} /> : null}
      <Stack.Screen name="vehicle/[id]" options={{ title: t('Van') }} />
      <Stack.Screen name="walk/[id]" options={{ title: t('Walk-around') }} />
      <Stack.Screen name="check/[id]" options={{ title: t('Damage check') }} />
      <Stack.Screen name="person/[uid]" options={{ title: t('Person') }} />
      <Stack.Screen name="video/[id]" options={{ title: t('Video') }} />
      <Stack.Screen name="buy/[id]" options={{ title: t('Refuel') }} />
      <Stack.Screen name="checks" options={{ title: t('Checks for drivers') }} />
      <Stack.Screen name="uploads" options={{ title: t('Uploads') }} />
    </Stack>
  );
}
