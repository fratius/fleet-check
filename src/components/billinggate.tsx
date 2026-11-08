import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { MyCompanies } from '@/components/companies';
import { DeleteAccount } from '@/components/deleteaccount';
import { LegalLinks } from '@/components/legal';
import { PlanSetup } from '@/components/plansetup';
import { Button, F, MARKER, Notice, Screen, T, useColors } from '@/components/ui';
import { blocked, payMode, standing, type PayMode } from '@/lib/billing';
import { loc, t } from '@/lib/i18n';
import { authMessage, useSession } from '@/lib/session';
import { ai } from '@/lib/store';
import type { Org } from '@/lib/types';

/** After a plan ends (cancelled, or not paid) the company can still look at and export its data for 30 days (AGB). */
export const GRACE_DAYS = 30;
export function endedAt(o: Org | null | undefined): number | null {
  const b = o?.billing;
  if (!b || !['canceled', 'unpaid', 'paused'].includes(b.status)) return null;
  return b.cancelAt || b.periodEnd || b.trialEnd || null;
}
const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });

let known: PayMode['mode'] | undefined;
/** How payments are set up (config/payments), read once. */
export function usePayMode(): PayMode['mode'] | undefined {
  const [m, setM] = useState(known);
  useEffect(() => { if (known === undefined) payMode().then((x) => { known = x.mode; setM(x.mode); }); }, []);
  return m;
}

/**
 * Whether the company waits for its owner's card or plan, so the app shows BillingGate instead of the tabs. The server
 * refuses its calls anyway (paymentsBlock). A plan that ended leaves 30 days to look at and export the data first.
 */
export function useGate(): boolean {
  const s = useSession();
  const mode = usePayMode();
  if (s.mode !== 'firebase' || !mode || !blocked(s.org, mode, s.creator)) return false;
  const end = endedAt(s.org);
  return !end || Date.now() > end + GRACE_DAYS * 86400_000;
}

/** Instead of the tabs: the owner adds the card or a plan (web); everyone else hears who does it. */
export function BillingGate() {
  const s = useSession();
  const org = s.org!;
  const st = standing(org).standing;
  const owner = s.role === 'owner';
  const title = st === 'incomplete' ? t('Add a card to start') : st === 'trial_over' ? t('The free trial has ended') : t('The plan has ended');
  const card = st === 'unpaid' || st === 'paused';
  return (
    <Screen>
      <View style={{ gap: 6, paddingTop: 12 }}>
        <T v="hint">{org.name}</T>
        <T v="h1">{title}</T>
        {st !== 'incomplete' ? <T>{t('Your vans, drivers and history are kept. Choose a plan to go on working with them.')}</T> : null}
      </View>
      {!owner ? <Notice text={t('The company\'s owner adds the plan and the card. Ask them, then open Fratius again.')} />
        : Platform.OS !== 'web' ? <Notice text={t('Plans and the card are set up in the web app, in a browser on a computer or phone.')} />
          : card ? <PortalButton orgId={org.id} title={t('Pay or change the card')} primary />
            : <PlanSetup org={org} plan={org.billing?.plan} interval={org.billing?.interval} onDone={(id) => s.switchOrg(id)} />}
      <MyCompanies />
      <Button v="link" title={t('Sign out')} onPress={() => s.signOut()} />
      <DeleteAccount />
      <LegalLinks />
    </Screen>
  );
}

/** Above the tab bar: a payment that didn't go through (owners), or a plan that ended and the days left to export. */
export function BillingStrip() {
  const s = useSession();
  const mode = usePayMode();
  if (s.mode !== 'firebase' || !mode || !s.org?.billing || s.viewAs) return null;
  const b = s.org.billing;
  const end = endedAt(s.org);
  const owner = s.role === 'owner';
  let text: string | null = null;
  if (b.status === 'past_due' && owner) text = t('The last payment didn\'t go through. Check the card.');
  else if (end && blocked(s.org, mode, s.creator)) text = t('The plan has ended. You can look at and export the data until {date}.', { date: day(end + GRACE_DAYS * 86400_000) });
  if (!text) return null;
  return (
    <Pressable accessibilityRole="link" disabled={!owner || Platform.OS !== 'web'} onPress={() => router.navigate('/plan')}
      style={{ backgroundColor: MARKER, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 2, borderColor: '#000' }}>
      <Text style={{ fontFamily: F.medium, fontSize: 14, color: '#000' }}>{text}{owner && Platform.OS === 'web' ? ` ${t('Plan and billing')} →` : ''}</Text>
    </Pressable>
  );
}

/** Stripe's page for the card, billing address, VAT ID, invoices and cancelling (it comes back to /plan). */
export function PortalButton({ orgId, title, primary }: { orgId: string; title: string; primary?: boolean }) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 4 }}>
      <Button v={primary ? 'primary' : 'secondary'} wide={primary} title={title} loading={busy} onPress={async () => {
        setBusy(true); setErr(null);
        try { const r = await ai.billingPortal({ orgId }); window.location.assign(r.url); } catch (e) { setErr(authMessage(e)); setBusy(false); }
      }} />
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}
