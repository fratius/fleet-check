import { Linking } from 'react-native';

import { Button, Row } from '@/components/ui';
import { t } from '@/lib/i18n';

/** The app's privacy policy and imprint on fratius.com (the stores require the policy to be reachable in the app). */
export const PRIVACY_URL = 'https://fratius.com/app-privacy';
export const IMPRINT_URL = 'https://fratius.com/impressum';

export function LegalLinks() {
  return (
    <Row>
      <Button v="link" small title={t('Privacy policy')} onPress={() => { Linking.openURL(PRIVACY_URL).catch(() => {}); }} />
      <Button v="link" small title={t('Imprint')} onPress={() => { Linking.openURL(IMPRINT_URL).catch(() => {}); }} />
    </Row>
  );
}
