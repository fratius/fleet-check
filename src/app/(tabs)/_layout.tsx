import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { F, useColors } from '@/components/ui';

function Icon({ name, color }: { name: 'fleet' | 'add' | 'log' | 'account'; color: ColorValue }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {name === 'fleet' && <><Path {...p} d="M2 17V9.5L5 6h9v11M14 9h5l4 4v4H2" /><Circle {...p} cx="7" cy="18.5" r="2.2" /><Circle {...p} cx="18" cy="18.5" r="2.2" /></>}
      {name === 'add' && <><Rect {...p} x="3" y="3" width="20" height="20" rx="3" /><Path {...p} d="M13 8v10M8 13h10" /></>}
      {name === 'log' && <Path {...p} d="M8 6h14M8 13h14M8 20h14M3.5 6h.5M3.5 13h.5M3.5 20h.5" />}
      {name === 'account' && <><Circle {...p} cx="13" cy="9" r="4.5" /><Path {...p} d="M4 23c1.2-4.6 4.6-7 9-7s7.8 2.4 9 7" /></>}
    </Svg>
  );
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.ink,
      tabBarInactiveTintColor: c.ink2,
      tabBarStyle: { backgroundColor: c.paper, borderTopColor: c.ink, borderTopWidth: 2, minHeight: 60 },
      tabBarLabelStyle: { fontFamily: F.cond, fontSize: 14 },
      sceneStyle: { backgroundColor: c.page },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Fleet', tabBarIcon: ({ color }) => <Icon name="fleet" color={color} /> }} />
      <Tabs.Screen name="add" options={{ title: 'Add vehicle', tabBarIcon: ({ color }) => <Icon name="add" color={color} /> }} />
      <Tabs.Screen name="log" options={{ title: 'Test log', tabBarIcon: ({ color }) => <Icon name="log" color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <Icon name="account" color={color} /> }} />
    </Tabs>
  );
}
