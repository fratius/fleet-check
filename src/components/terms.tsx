import { Linking, Pressable, Text, View } from 'react-native';

import { Button, F, Row, T, useColors } from '@/components/ui';
import { AVV_URL, TERMS_URL } from '@/lib/billing';
import { t } from '@/lib/i18n';

/** The fleet owner accepts the terms (AGB) and the data processing agreement (AVV) for their company. */
export function AcceptTerms({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  const open = (url: string) => { Linking.openURL(url).catch(() => {}); };
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange(!on)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: on ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          {on ? <Text style={{ color: c.paper, fontFamily: F.semi, fontSize: 15, lineHeight: 17 }}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <T>{t('For my company, I accept the terms (AGB) and the data processing agreement (AVV).')}</T>
        </View>
      </Pressable>
      <Row>
        <Button v="link" small title={t('Terms (AGB)')} onPress={() => open(TERMS_URL)} />
        <Button v="link" small title={t('Data processing agreement (AVV)')} onPress={() => open(AVV_URL)} />
      </Row>
    </View>
  );
}
