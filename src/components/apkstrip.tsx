import { Pressable, Text, View } from 'react-native';

import { F, MARKER, hs } from '@/components/ui';
import { apkLater, openApkPage, useNewerApk } from '@/lib/apk';
import { t } from '@/lib/i18n';

/**
 * Above the tab bar in the Android test version (lib/apk.ts): a newer version needs a new download from
 * fratius.com/android. Updates without a new native part arrive by themselves and never show this.
 */
export function ApkStrip() {
  const v = useNewerApk();
  if (!v) return null;
  const btn = { borderWidth: 2, borderColor: '#000', borderRadius: 4, paddingHorizontal: 10, minHeight: 34, justifyContent: 'center' as const };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: MARKER, paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 2, borderColor: '#000' }}>
      <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 14, color: '#000' }}>{t('A new version of the app is ready ({version}).', { version: v })}</Text>
      <Pressable accessibilityRole="button" onPress={apkLater} style={({ pressed }) => ({ ...btn, borderColor: 'transparent', opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ fontFamily: F.cond, fontSize: hs(16), color: '#000' }}>{t('Later')}</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={openApkPage} style={({ pressed }) => ({ ...btn, backgroundColor: '#000', opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ fontFamily: F.cond, fontSize: hs(16), color: MARKER }}>{t('Download')}</Text>
      </Pressable>
    </View>
  );
}
