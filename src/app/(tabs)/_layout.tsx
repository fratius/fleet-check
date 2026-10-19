import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { F, MARKER, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';

type IconName = 'fleet' | 'review' | 'people' | 'log' | 'account';
function Icon({ name, color }: { name: IconName; color: ColorValue }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {name === 'fleet' && <><Path {...p} d="M2 17V9.5L5 6h9v11M14 9h5l4 4v4H2" /><Circle {...p} cx="7" cy="18.5" r="2.2" /><Circle {...p} cx="18" cy="18.5" r="2.2" /></>}
      {name === 'review' && <><Rect {...p} x="4" y="3" width="18" height="21" rx="2.5" /><Path {...p} d="M9 13l3 3 5-6" /></>}
      {name === 'people' && <><Circle {...p} cx="9" cy="9" r="3.5" /><Path {...p} d="M2.5 21c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><Circle {...p} cx="18" cy="8" r="3" /><Path {...p} d="M17 13.6c3.1-.3 5.6 1.4 6.5 4.9" /></>}
      {name === 'log' && <Path {...p} d="M8 6h14M8 13h14M8 20h14M3.5 6h.5M3.5 13h.5M3.5 20h.5" />}
      {name === 'account' && <><Circle {...p} cx="13" cy="9" r="4.5" /><Path {...p} d="M4 23c1.2-4.6 4.6-7 9-7s7.8 2.4 9 7" /></>}
    </Svg>
  );
}

/**
 * Drivers see their station's vans and their account. Fleet managers and owners also get the review
 * queue, people and the test log. Every tab is a stack (see (fleet,review,people,log,me)/_layout.tsx),
 * so this bar stays on every page.
 */
export default function TabsLayout() {
  const c = useColors();
  const s = useSession();
  const staff = s.staff;
  const toReview = s.checks.filter((k) => k.status === 'submitted' && s.runs(k.stationId)).length;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.ink,
      tabBarInactiveTintColor: c.ink2,
      tabBarStyle: { backgroundColor: c.paper, borderTopColor: c.ink, borderTopWidth: 2, minHeight: 60 },
      tabBarLabelStyle: { fontFamily: F.cond, fontSize: 14 },
      tabBarBadgeStyle: { backgroundColor: MARKER, color: '#000', fontFamily: F.cond, fontSize: 13 },
      sceneStyle: { backgroundColor: c.page },
    }}>
      <Tabs.Screen name="(fleet)" options={{ title: staff ? 'Fleet' : 'Vans', tabBarIcon: ({ color }) => <Icon name="fleet" color={color} /> }} />
      <Tabs.Screen name="(review)" options={{ title: 'Review', href: staff ? undefined : null, tabBarBadge: staff && toReview ? toReview : undefined, tabBarIcon: ({ color }) => <Icon name="review" color={color} /> }} />
      <Tabs.Screen name="(people)" options={{ title: 'People', href: staff && s.mode === 'firebase' ? undefined : null, tabBarIcon: ({ color }) => <Icon name="people" color={color} /> }} />
      <Tabs.Screen name="(log)" options={{ title: 'Test log', href: staff ? undefined : null, tabBarIcon: ({ color }) => <Icon name="log" color={color} /> }} />
      <Tabs.Screen name="(me)" options={{ title: 'Account', tabBarIcon: ({ color }) => <Icon name="account" color={color} /> }} />
    </Tabs>
  );
}
