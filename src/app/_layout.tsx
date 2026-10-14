import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_500Medium, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColors } from '@/components/ui';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Routes() {
  const { status } = useSession();
  const c = useColors();
  if (status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: c.page, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.ink} /></View>;
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.page } }}>
      <Stack.Protected guard={status === 'ready'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vehicle/[id]" />
        <Stack.Screen name="walk/[id]" />
        <Stack.Screen name="check/[id]" />
        <Stack.Screen name="scan/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut' || status === 'needsOrg'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const c = useColors();
  const [loaded, error] = useFonts({
    Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold,
    BarlowCondensed_500Medium, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
  });
  const ready = loaded || !!error;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider value={c.dark ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: c.page } } : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: c.page } }}>
        <StatusBar style={c.dark ? 'light' : 'dark'} />
        <SessionProvider>
          <Routes />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
