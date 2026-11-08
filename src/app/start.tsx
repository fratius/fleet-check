import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { LanguageLink } from '@/components/language';
import { LegalLinks } from '@/components/legal';
import { PlanSetup } from '@/components/plansetup';
import { Button, Notice, Screen, T } from '@/components/ui';
import { blocked, payMode, signupIntent, type PayMode } from '@/lib/billing';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * Sign-up with a card, in one step (components/plansetup.tsx): the website's "Start" buttons open
 * app.fratius.com/start?plan=pro&interval=year, and the app creator's sign-up links /start?offer=CODE. Open whether or
 * not the person is signed in (_layout.tsx). A company that still needs its card opens here too; one that is ready
 * goes to the app.
 */
export default function Start() {
  const s = useSession();
  // new=1: a signed-in owner adds another company (Account, Join or create another company).
  const q = useLocalSearchParams<{ plan?: string; interval?: string; offer?: string; new?: string }>();
  const another = q.new === '1';
  const [pm, setPm] = useState<PayMode | null>(null);
  useEffect(() => { payMode().then(setPm); }, []);
  const plan = q.plan || signupIntent.plan;
  const interval = q.interval === 'year' || signupIntent.interval === 'year' ? 'year' : 'month';
  const offer = String(q.offer || signupIntent.offer || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  const ready = s.status === 'ready' && s.org && !blocked(s.org, pm?.mode ?? 'test', s.creator);
  useEffect(() => { if (ready && !another) router.replace('/'); }, [ready, another]);

  if (Platform.OS !== 'web') {
    return (
      <Screen>
        <T v="h1">Fratius</T>
        <Notice text={t('Plans and the card are set up in the web app, in a browser on a computer or phone.')} />
        <Button v="link" title={t('Back')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  if (s.status === 'loading') return <Screen><T v="hint">{t('Loading…')}</T></Screen>;
  // Signed in to a company that still waits for its card: only its owner adds it.
  const existing = s.status === 'ready' && s.org && !ready && !another ? s.org : null;
  if (existing && s.role !== 'owner') {
    return (
      <Screen>
        <T v="h1">{existing.name}</T>
        <Notice text={t('The company\'s owner adds the plan and the card. Ask them, then open Fratius again.')} />
        <Button v="link" title={t('Sign out')} onPress={() => s.signOut()} />
      </Screen>
    );
  }
  return (
    <Screen>
      <View style={{ gap: 6, paddingTop: 12 }}>
        <T v="h1">{existing ? existing.name : t('Start with Fratius')}</T>
        <T>{existing ? t('Choose the plan and add the card to start.') : t('Your account, your company and the card, in one step. Drivers and stations are unlimited on every plan.')}</T>
        {s.user ? <T v="hint">{t('Signed in as {email}', { email: s.user.email })}</T> : null}
      </View>
      <LanguageLink />
      <PlanSetup org={existing} plan={plan} interval={interval} offer={offer} onDone={async (orgId) => { await s.switchOrg(orgId); router.replace('/'); }} />
      {s.status === 'signedOut' ? <Button v="link" title={t('Already have an account? Sign in')} onPress={() => router.push('/sign-in')} /> : null}
      {s.user ? <Button v="link" small title={t('Sign out')} onPress={() => s.signOut()} /> : null}
      <LegalLinks />
    </Screen>
  );
}
