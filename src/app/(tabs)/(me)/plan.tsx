import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { PortalButton, usePayMode } from '@/components/billinggate';
import { confirmAction } from '@/components/cardform';
import { PlanSetup } from '@/components/plansetup';
import { Button, Card, F, Notice, Pill, Row, Screen, T, hs, useColors } from '@/components/ui';
import { ADDON_VANS, PLAN_IDS, PLAN_NAME, PLAN_VANS, PRICE_CENTS, allowedVans, euro, netCents, payMode, type Interval, type PlanId } from '@/lib/billing';
import { loc, t } from '@/lib/i18n';
import { authMessage, useSession } from '@/lib/session';
import { ai } from '@/lib/store';

const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Plan and billing, for the fleet owner in the web app: the plan and what it costs, the vans it allows, another plan
 * or the add-on, and Stripe's page for the card, billing address, invoices and cancelling (billingPortal).
 */
export default function PlanScreen() {
  const s = useSession();
  const c = useColors();
  const mode = usePayMode();
  const org = s.org;
  const b = org?.billing;
  const L = loc();

  const head = (
    <View style={{ gap: 4 }}>
      <Button v="link" small title={`← ${t('Account')}`} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/account'))} />
      <T v="h1">{t('Plan and billing')}</T>
      <T v="hint">{org?.name}</T>
    </View>
  );
  if (Platform.OS !== 'web') return <Screen>{head}<Notice text={t('Plans and the card are set up in the web app, in a browser on a computer or phone.')} /></Screen>;
  if (s.role !== 'owner') return <Screen>{head}<Notice text={t('Only the fleet owner can change the plan and the card.')} /></Screen>;
  if (mode === undefined) return <Screen>{head}<T v="hint">{t('Loading…')}</T></Screen>;
  if (!mode) return <Screen>{head}<Notice text={t('Payments aren\'t set up yet. Write to info@fratius.com.')} /></Screen>;
  const paying = !!b && b.via === 'stripe' && !!b.card && ['trialing', 'active', 'past_due', 'unpaid', 'paused'].includes(b.status);
  if (!org || !paying) {
    return (
      <Screen>
        {head}
        <T>{t('Choose the plan and add the card to start.')}</T>
        {org ? <PlanSetup org={org} plan={b?.plan} interval={b?.interval} onDone={(id) => s.switchOrg(id)} /> : null}
      </Screen>
    );
  }

  const plan = (PLAN_IDS.find((x) => x === b!.plan) || 'basic') as PlanId;
  const interval: Interval = b!.interval === 'year' ? 'year' : 'month';
  const addon = !!b!.addon;
  const price = netCents(plan, interval, addon);
  const used = org.fleetSize || 0;
  const per = interval === 'year' ? t('a year') : t('a month');
  let status = '';
  if (b!.status === 'trialing') status = t('Free until {date}. Then {price} plus VAT {per}.', { date: day(b!.trialEnd || Date.now()), price: euro(price, L), per });
  else if (b!.cancelAt) status = t('Cancelled: the plan ends on {date}. Nothing more is charged.', { date: day(b!.cancelAt) });
  else if (b!.status === 'active') status = b!.periodEnd ? t('Renews on {date}: {price} plus VAT.', { date: day(b!.periodEnd), price: euro(price, L) }) : t('Active.');
  else if (b!.status === 'past_due') status = t('The last payment didn\'t go through. Stripe tries the card again; check it below.');
  else status = t('The plan isn\'t paid. Pay the open invoice or change the card below.');

  return (
    <Screen>
      {head}
      <Card>
        <Row>
          <Text style={{ fontFamily: F.cond, fontSize: hs(26), color: c.ink }}>{PLAN_NAME[plan]}</Text>
          <Pill text={interval === 'year' ? t('Yearly') : t('Monthly')} />
          {b!.testMode ? <Pill v="amber" text={t('Test mode')} /> : null}
          {b!.status === 'trialing' ? <Pill v="good" text={t('Free trial')} /> : null}
        </Row>
        <T>{b!.vans == null ? t('{used} vans in use, unlimited on this plan.', { used }) : t('{used} of {max} vans in use.', { used, max: b!.vans })}{addon ? ' ' + t('With the add-on of {n} more vans.', { n: ADDON_VANS }) : ''}</T>
        <T>{status}</T>
        <T v="small">{t('Unlimited drivers and stations. Prices plus VAT.')}</T>
      </Card>
      <ChangePlan orgId={org.id} plan={plan} interval={interval} addon={addon} used={used} trial={b!.status === 'trialing'} />
      <Card>
        <T v="h3">{t('Card, billing address and invoices')}</T>
        <T v="hint">{t('On Stripe\'s page: change the card, the billing address or the VAT ID, download invoices, or cancel to the end of the period paid for.')}</T>
        <PortalButton orgId={org.id} title={t('Open payment details')} />
      </Card>
    </Screen>
  );
}

/** Another plan, the add-on, or monthly to yearly (changePlan). Not below the vans in use. */
function ChangePlan({ orgId, plan, interval, addon, used, trial }: { orgId: string; plan: PlanId; interval: Interval; addon: boolean; used: number; trial: boolean }) {
  const c = useColors();
  const L = loc();
  const [p, setP] = useState<PlanId>(plan);
  const [iv, setIv] = useState<Interval>(interval);
  const [a, setA] = useState(addon);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const withAddon = a && p !== 'premium';
  const same = p === plan && iv === interval && withAddon === addon;
  const room = allowedVans(p, withAddon);
  const fits = room == null || used <= room;
  const per = iv === 'year' ? t('a year') : t('a month');
  const save = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const r = await ai.changePlan({ orgId, plan: p, interval: iv, addon: withAddon });
      if (r.next) {
        const key = (await payMode()).publishableKey;
        const x = key ? await confirmAction(key, r.next.clientSecret) : { error: t('Couldn\'t load the payment form. Check the connection and try again.') };
        if (x.error) throw new Error(x.error);
      }
      setDone(t('The plan is changed.'));
    } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h3">{t('Change the plan')}</T>
      {PLAN_IDS.map((id) => {
        const on = p === id;
        const max = allowedVans(id, a && id !== 'premium');
        const tooSmall = max != null && used > max;
        return (
          <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: tooSmall }} disabled={tooSmall} onPress={() => setP(id)}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 2, borderColor: on ? c.ink : c.rule, borderRadius: 4, padding: 12, opacity: tooSmall ? 0.5 : 1 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
              {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.cond, fontSize: hs(20), color: c.ink }}>{PLAN_NAME[id]}</Text>
              <T v="hint">{PLAN_VANS[id] == null ? t('Unlimited vans') : t('Up to {n} vans', { n: PLAN_VANS[id] })}{tooSmall ? ` · ${t('fewer than the vans in use')}` : ''}</T>
            </View>
            <T v="medium">{iv === 'year' ? t('{price} a year', { price: euro(PRICE_CENTS[id].year, L) }) : t('{price} a month', { price: euro(PRICE_CENTS[id].month, L) })}</T>
          </Pressable>
        );
      })}
      {p !== 'premium' ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: withAddon }} onPress={() => setA(!a)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: withAddon ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {withAddon ? <Text style={{ color: c.paper, fontFamily: F.semi, fontSize: 15, lineHeight: 17 }}>✓</Text> : null}
          </View>
          <T>{t('{n} more vans for {price} {per}', { n: ADDON_VANS, price: euro(PRICE_CENTS.addon[iv], L), per })}</T>
        </Pressable>
      ) : null}
      {interval === 'month' ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: iv === 'year' }} onPress={() => setIv(iv === 'year' ? 'month' : 'year')} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: iv === 'year' ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {iv === 'year' ? <Text style={{ color: c.paper, fontFamily: F.semi, fontSize: 15, lineHeight: 17 }}>✓</Text> : null}
          </View>
          <T>{t('Pay yearly')}</T>
        </Pressable>
      ) : null}
      {!same ? <T>{t('New price: {price} plus VAT {per}.', { price: euro(netCents(p, iv, withAddon), L), per })}</T> : null}
      <T v="hint">{trial ? t('Nothing is charged during the free trial.') : t('A bigger plan is charged now for the rest of the period; a smaller one is credited on the next invoice.')}</T>
      <Button v="primary" title={t('Change plan')} disabled={same || !fits} loading={busy} onPress={save} />
      {done ? <T v="hint" color={c.ok}>{done}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}
