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
import '@/lib/install';
import { LanguageProvider } from '@/lib/lang';
import { NotificationTaps } from '@/lib/nativepush';
import { SessionProvider, useSession } from '@/lib/session';
import { keepAppShell } from '@/lib/appshell';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Routes() {
  const { status } = useSession();
  const c = useColors();
  if (status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: c.page, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.ink} /></View>;
  }
  return (
    <>
      {/* The store app: a tapped notification opens its page once the app is ready. */}
      {status === 'ready' ? <NotificationTaps /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.page } }}>
        <Stack.Protected guard={status === 'ready'}>
          {/* Every page lives in a tab (so the tab bar stays); only the camera opens over everything. */}
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="scan/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut' || status === 'needsOrg'}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        {/* Invite links and sign-up with a card open here whether or not the person is signed in. */}
        <Stack.Screen name="join/[token]" />
        <Stack.Screen name="start" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const c = useColors();
  // Tessera is the app's font (OFL, assets/fonts/tessera); Barlow stays for the languages Tessera can't write
  // (BARLOW_LANGS in components/ui.tsx).
  const [loaded, error] = useFonts({
    Tessera_400Regular: require('../../assets/fonts/tessera/Tessera-Regular.ttf'),
    Tessera_500Medium: require('../../assets/fonts/tessera/Tessera-Medium.ttf'),
    Tessera_600SemiBold: require('../../assets/fonts/tessera/Tessera-SemiBold.ttf'),
    Tessera_700Bold: require('../../assets/fonts/tessera/Tessera-Bold.ttf'),
    Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold,
    BarlowCondensed_500Medium, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
  });
  const ready = loaded || !!error;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  // The web app opens without a connection (public/sw.js keeps its files).
  useEffect(() => { keepAppShell(); }, []);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider value={c.dark ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: c.page } } : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: c.page } }}>
        <StatusBar style={c.dark ? 'light' : 'dark'} />
        <LanguageProvider>
          <SessionProvider>
            <Routes />
          </SessionProvider>
        </LanguageProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
