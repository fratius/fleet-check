import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { F, MARKER, useColors } from '@/components/ui';
import { ViewingStrip } from '@/components/viewas';
import { useSession } from '@/lib/session';
import { missingHandovers, needsPickup } from '@/lib/videos';
import { CHECK_MONTHS, fleetDue, peopleDue, pressing } from '@/lib/fleet';
import { tourGaps, vanWarnings } from '@/lib/stats';

type IconName = 'fleet' | 'review' | 'people' | 'data' | 'log' | 'account';
function Icon({ name, color }: { name: IconName; color: ColorValue }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {name === 'fleet' && <><Path {...p} d="M2 17V9.5L5 6h9v11M14 9h5l4 4v4H2" /><Circle {...p} cx="7" cy="18.5" r="2.2" /><Circle {...p} cx="18" cy="18.5" r="2.2" /></>}
      {name === 'review' && <><Rect {...p} x="4" y="3" width="18" height="21" rx="2.5" /><Path {...p} d="M9 13l3 3 5-6" /></>}
      {name === 'people' && <><Circle {...p} cx="9" cy="9" r="3.5" /><Path {...p} d="M2.5 21c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><Circle {...p} cx="18" cy="8" r="3" /><Path {...p} d="M17 13.6c3.1-.3 5.6 1.4 6.5 4.9" /></>}
      {name === 'data' && <><Rect {...p} x="3" y="4" width="20" height="18" rx="2" /><Path {...p} d="M3 10h20M3 16h20M10 4v18" /></>}
      {name === 'log' && <Path {...p} d="M8 6h14M8 13h14M8 20h14M3.5 6h.5M3.5 13h.5M3.5 20h.5" />}
      {name === 'account' && <><Circle {...p} cx="13" cy="9" r="4.5" /><Path {...p} d="M4 23c1.2-4.6 4.6-7 9-7s7.8 2.4 9 7" /></>}
    </Svg>
  );
}

/**
 * Drivers see their station's vans and their account. Fleet managers and owners also get the review
 * queue, people and the test log. Every tab is a stack (see (fleet,review,people,table,log,me)/_layout.tsx),
 * so this bar stays on every page.
 */
export default function TabsLayout() {
  const c = useColors();
  const s = useSession();
  const insets = useSafeAreaInsets();
  const staff = s.staff;
  // The badge: checks to review plus handovers missing their drop-off video (see the Review tab).
  const toReview = s.checks.filter((k) => k.status === 'submitted' && s.runs(k.stationId)).length
    + (staff ? missingHandovers(s.assignments.filter((a) => s.runs(a.stationId)), s.videos, s.walks, s.stations, Date.now() - 7 * 86400_000).length : 0)
    // Deadlines that are overdue or due within a week (inspections, service, tax, insurance, contract end).
    + (staff ? fleetDue(s.vehicles.filter((v) => s.runs(v.stationId)), s.details).filter((d) => pressing(d.x)).length : 0)
    // Drivers' licence checks, licences and briefings that are overdue or due within a week.
    + (staff ? peopleDue(s.records.filter((r) => s.runs(r.stationId)), null, s.org?.licenceCheckMonths || CHECK_MONTHS).filter((d) => pressing(d.x)).length : 0)
    // Warning lights on the dashboard, and tours missing their photos (where dashboard photos are on).
    + (staff ? vanWarnings(s.tours.filter((t) => s.runs(t.stationId))).length : 0)
    + (staff && s.org?.dashScans ? tourGaps(s.tours.filter((t) => s.runs(t.stationId)), s.assignments.filter((a) => s.runs(a.stationId)), Date.now() - 7 * 86400_000, s.org.dashScansAt || 0).length : 0);
  // The driver's badge: a van they were given that still needs its pick-up video or photos.
  const toFilm = s.assignments.filter((a) => a.end == null && a.driverId === s.user?.uid && needsPickup(a, s.videos, s.walks)).length;
  return (
    // While the app creator views the app as someone else, a strip above the tab bar says so, with the way back.
    <Tabs tabBar={(props) => <><ViewingStrip /><BottomTabBar {...props} /></>} screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.ink,
      tabBarInactiveTintColor: c.ink2,
      // Room for the icon and the label above the iPhone home bar (the default 49 points cuts the labels off).
      tabBarStyle: { backgroundColor: c.paper, borderTopColor: c.ink, borderTopWidth: 2, height: 62 + insets.bottom },
      tabBarLabelStyle: { fontFamily: F.cond, fontSize: 14 },
      tabBarBadgeStyle: { backgroundColor: MARKER, color: '#000', fontFamily: F.cond, fontSize: 13 },
      sceneStyle: { backgroundColor: c.page },
    }}>
      <Tabs.Screen name="(fleet)" options={{ title: staff ? 'Fleet' : 'Vans', tabBarBadge: toFilm || undefined, tabBarIcon: ({ color }) => <Icon name="fleet" color={color} /> }} />
      <Tabs.Screen name="(review)" options={{ title: 'Review', href: staff ? undefined : null, tabBarBadge: staff && toReview ? toReview : undefined, tabBarIcon: ({ color }) => <Icon name="review" color={color} /> }} />
      <Tabs.Screen name="(people)" options={{ title: 'People', href: staff && s.mode === 'firebase' ? undefined : null, tabBarIcon: ({ color }) => <Icon name="people" color={color} /> }} />
      <Tabs.Screen name="(table)" options={{ title: 'Data', href: staff ? undefined : null, tabBarIcon: ({ color }) => <Icon name="data" color={color} /> }} />
      <Tabs.Screen name="(log)" options={{ title: 'Test log', href: s.seesAiStats ? undefined : null, tabBarIcon: ({ color }) => <Icon name="log" color={color} /> }} />
      <Tabs.Screen name="(me)" options={{ title: 'Account', tabBarIcon: ({ color }) => <Icon name="account" color={color} /> }} />
    </Tabs>
  );
}
