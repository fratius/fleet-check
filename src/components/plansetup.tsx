import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CardForm, cardFormSupported, type CardApi } from '@/components/cardform';
import { AcceptTerms } from '@/components/terms';
import { Button, Card, F, Field, Notice, Segmented, T, hs, useColors } from '@/components/ui';
import {
  ADDON_VANS, PLAN_IDS, PLAN_NAME, PLAN_VANS, PRICE_CENTS, TERMS_VERSION, TRIAL_DAYS, euro, netCents, signupDone, type Interval, type PlanId,
} from '@/lib/billing';
import { fb } from '@/lib/firebase';
import { loc, t, tp } from '@/lib/i18n';
import { authMessage, useSession } from '@/lib/session';
import { ai } from '@/lib/store';
import type { BillingConfig, Org } from '@/lib/types';

const DAY = 86400_000;
const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * One step from the website to a working company: the plan, the company's billing address and the card, the terms,
 * and one button (product owner, 2026-11-05: "in one step, nice and easy, no friction"). Everyone adds a card, also
 * with a free trial or a custom sign-up link; nothing is charged before the trial ends.
 *
 * Signed out it also makes the account, and without `org` the company (createCompany, payments: true), then the
 * subscription (billingStart), then Stripe confirms the card or the payment in the browser, then billingConfirm.
 * A company that already exists (made before, or its card didn't go through) gets only the plan and the card.
 * The AGB (§ 2) want the price, the date of the first charge and what the button does said before the button.
 */
export function PlanSetup({ org, plan: wantPlan, interval: wantInterval, offer: offerCode, onDone }: {
  org?: Org | null;
  plan?: string | null;
  interval?: Interval;
  offer?: string | null;
  onDone(orgId: string): void;
}) {
  const s = useSession();
  const c = useColors();
  const [cfg, setCfg] = useState<BillingConfig | null>(null);
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [station, setStation] = useState('');
  const [plan, setPlan] = useState<PlanId>(PLAN_IDS.find((p) => p === wantPlan) || 'basic');
  const [interval, setInterval] = useState<Interval>(wantInterval === 'year' ? 'year' : 'month');
  const [addon, setAddon] = useState(false);
  const [vatId, setVatId] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The company made in this step, so trying another card doesn't make a second one.
  const [orgId, setOrgId] = useState<string | null>(org?.id || null);
  const card = useRef<CardApi | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const signedOut = s.status === 'signedOut';

  // Back from a bank's page (3-D Secure by redirect, rare): Stripe adds the result to the address.
  useEffect(() => {
    if (typeof window === 'undefined' || !org?.id) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('redirect_status') !== 'succeeded') return;
    const si = q.get('setup_intent');
    setBusy(true); setStep(t('Almost done…'));
    ai.billingConfirm({ orgId: org.id, setupIntent: si }).then((r) => {
      if (r.billing && (r.billing.status === 'trialing' || r.billing.status === 'active')) { signupDone(); onDone(org.id); }
    }, (e) => setErr(authMessage(e))).finally(() => { setBusy(false); setStep(null); });
  }, [org?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    ai.billingConfig({ offer: offerCode || null }).then((x) => { if (live) setCfg(x); }, (e) => { if (live) setCfgErr(authMessage(e)); });
    return () => { live = false; };
  }, [offerCode]);

  const offer = cfg?.offer || null;
  const p: PlanId = offer?.plan || plan;
  const iv: Interval = offer?.interval || interval;
  const withAddon = addon && p !== 'premium';
  const now = Date.now();
  // The free days, as the server decides them (billingStart): a sign-up link's, 30 for a new monthly plan, what is
  // left of a trial from before payments, else none (yearly is paid now).
  const prev = org?.billing;
  let trialEnd: number | null = null;
  if (offer) trialEnd = offer.trialDays > 0 ? now + offer.trialDays * DAY : null;
  else if (iv === 'month') {
    if (!prev || prev.status === 'incomplete') trialEnd = now + (cfg?.trialDays || TRIAL_DAYS) * DAY;
    else if (prev.status === 'trialing' && prev.via !== 'stripe' && (prev.trialEnd || 0) > now + 3600_000) trialEnd = prev.trialEnd!;
  }
  const net = netCents(p, iv, withAddon);
  const launch = !offer && iv === 'year' && !!cfg?.launchOffer;
  const discount = offer?.percentOff ? Math.round((net * offer.percentOff) / 100) : offer?.amountOff ? Math.min(net, offer.amountOff) : launch ? Math.round((PRICE_CENTS[p].year * (cfg?.yearlyOff || 30)) / 100) : 0;
  const first = Math.max(0, net - discount);
  const kind: 'setup' | 'payment' = trialEnd || first === 0 ? 'setup' : 'payment';
  const L = loc();
  const per = iv === 'year' ? t('a year') : t('a month');

  const go = async () => {
    setErr(null);
    if (signedOut) {
      if (!name.trim()) return setErr(t('Enter your name.'));
      if (!email.trim()) return setErr(t('Enter your email address.'));
      if (password.length < 6) return setErr(t('Use at least 6 characters for the password.'));
    }
    if (TERMS_VERSION && !accepted) return setErr(t('Accept the terms and the data processing agreement to create the company.'));
    const api = card.current;
    if (!api) return setErr(t('The payment form is still loading. Try again in a moment.'));
    setBusy(true);
    try {
      setStep(t('Checking the card…'));
      const sub = await api.submit();
      if ('error' in sub) throw new Error(sub.error);
      let id = orgId;
      if (!id) {
        if (!fb()?.auth.currentUser) { setStep(t('Creating your account…')); await s.signUp(email, password, name); }
        setStep(t('Creating your company…'));
        id = await s.createOrg(sub.address.name, station, TERMS_VERSION, { payments: true, plan: p, interval: iv, name: name.trim() || undefined, open: false });
        setOrgId(id);
      }
      setStep(trialEnd ? t('Adding the card…') : t('Paying…'));
      const st = await ai.billingStart({ orgId: id, plan: p, interval: iv, addon: withAddon, offer: offer?.code || null, address: sub.address, vatId: vatId.trim() });
      let setupIntent: string | null = null;
      if (st.kind !== 'none' && st.clientSecret) {
        const r = await api.confirm(st.kind, st.clientSecret, st.amount);
        if ('error' in r) throw new Error(r.error);
        setupIntent = r.setupIntent;
      }
      setStep(t('Almost done…'));
      // A payment can take a few seconds at Stripe; the webhook writes it too.
      for (let i = 0; ; i++) {
        const r = await ai.billingConfirm({ orgId: id, setupIntent });
        if (r.billing && (r.billing.status === 'trialing' || r.billing.status === 'active')) break;
        if (i >= 6) throw new Error(t('The payment is still on its way. Your company opens as soon as Stripe confirms it.'));
        await new Promise((ok) => setTimeout(ok, 2500));
      }
      signupDone();
      onDone(id);
    } catch (e) {
      setErr(authMessage(e));
    } finally {
      setBusy(false); setStep(null);
    }
  };

  if (!cardFormSupported) {
    return <Notice text={t('Plans and the card are set up in the web app, in a browser on a computer or phone.')} />;
  }
  if (cfgErr) return <Notice tone="bad" text={cfgErr} />;
  if (!cfg) return <T v="hint">{t('Loading…')}</T>;
  if (!cfg.mode || !cfg.publishableKey && cfg.mode !== 'fake') return <Notice text={t('Payments aren\'t set up yet. Write to info@fratius.com.')} />;

  const priceLine = (id: PlanId) => {
    const full = PRICE_CENTS[id][iv];
    if (iv === 'year' && launch) return t('{price} the first year, then {full} a year', { price: euro(Math.round(full * (1 - (cfg.yearlyOff || 30) / 100)), L), full: euro(full, L) });
    return iv === 'year' ? t('{price} a year', { price: euro(full, L) }) : t('{price} a month', { price: euro(full, L) });
  };
  const vansLine = (id: PlanId) => (PLAN_VANS[id] == null ? t('Unlimited vans') : t('Up to {n} vans', { n: PLAN_VANS[id] }));

  return (
    <View style={{ gap: 14 }}>
      {cfg.mode !== 'live' ? <Notice text={t('Test mode: no real money is charged. Use the card 4242 4242 4242 4242, any future date and any CVC.')} /> : null}
      {cfg.offerError ? <Notice tone="bad" text={t(cfg.offerError.t)} /> : null}
      {offer ? (
        <Card>
          <T v="h3">{t('Your offer')}</T>
          {offer.trialDays > 0 ? <T>{tp(offer.trialDays, '{n} day free', '{n} days free')}</T> : null}
          {offer.percentOff ? <T>{offer.months ? t('{n} % off for {m} months', { n: offer.percentOff, m: offer.months }) : t('{n} % off', { n: offer.percentOff })}</T> : null}
          {offer.amountOff ? <T>{offer.months ? t('{price} off each invoice for {m} months', { price: euro(offer.amountOff, L), m: offer.months }) : t('{price} off each invoice', { price: euro(offer.amountOff, L) })}</T> : null}
        </Card>
      ) : null}

      {signedOut ? (
        <Card>
          <T v="h3">{t('Your account')}</T>
          <Field label={t('Your name')} value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />
          <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
          <Field label={t('Password')} hint={t('at least 6 characters')} value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" />
        </Card>
      ) : null}

      <Card>
        <T v="h3">{t('Plan')}</T>
        {!offer?.interval ? (
          <Segmented label={t('Billed')} value={interval} onChange={setInterval}
            options={[['month', t('Monthly')], ['year', cfg.launchOffer ? t('Yearly, {n} % off the first year', { n: cfg.yearlyOff }) : t('Yearly')]]} />
        ) : null}
        {(offer?.plan ? [offer.plan] : PLAN_IDS).map((id) => {
          const on = p === id;
          return (
            <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setPlan(id)}
              style={{ flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 2, borderColor: on ? c.ink : c.rule, borderRadius: 4, padding: 12, backgroundColor: on ? c.page : 'transparent' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: F.cond, fontSize: hs(22), color: c.ink }}>{PLAN_NAME[id]}</Text>
                <T v="hint">{vansLine(id)} · {t('unlimited drivers and stations')}</T>
              </View>
              <T v="medium">{priceLine(id)}</T>
            </Pressable>
          );
        })}
        {p !== 'premium' ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: withAddon }} onPress={() => setAddon(!addon)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: withAddon ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
              {withAddon ? <Text style={{ color: c.paper, fontFamily: F.semi, fontSize: 15, lineHeight: 17 }}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <T>{t('{n} more vans for {price} {per}', { n: ADDON_VANS, price: euro(PRICE_CENTS.addon[iv], L), per })}</T>
            </View>
          </Pressable>
        ) : null}
        <T v="small">{t('Prices plus VAT.')}</T>
      </Card>

      <Card>
        <T v="h3">{t('Company and card')}</T>
        {!orgId ? <Field label={t('First station')} hint={t('you can add more later')} value={station} onChangeText={setStation} autoCapitalize="characters" placeholder={t('For example: DXX1 Berlin')} /> : null}
        <T v="hint">{t('The company\'s name and billing address go on your invoices.')}</T>
        <CardForm publishableKey={cfg.publishableKey || 'pk_test_fake'} kind={kind} amount={Math.round(first * 1.19)} company={org?.name || ''}
          onApi={(a) => { card.current = a; setCardReady(!!a); }} />
        <Field label={t('VAT ID')} hint={t('optional, for example DE123456789')} value={vatId} onChangeText={setVatId} autoCapitalize="characters" autoCorrect={false} />
        {trialEnd ? <T v="hint">{t('We ask for a card to verify your company and keep out fake accounts. Nothing is charged before {date}; cancel any time before then.', { date: day(trialEnd) })}</T> : null}
      </Card>

      <Card style={{ borderColor: c.ink }}>
        <T v="h3">{t('What you pay')}</T>
        {trialEnd ? (
          <>
            <T>{t('Today: {price}.', { price: euro(0, L) })}</T>
            <T>{iv === 'year'
              ? t('On {date} we charge {price} plus VAT, then every year, until you cancel.', { date: day(trialEnd), price: euro(first, L) })
              : t('On {date} we charge {price} plus VAT, then every month, until you cancel.', { date: day(trialEnd), price: euro(first, L) })}</T>
            <T>{t('Cancel before {date} and you pay nothing. Stripe reminds you by email 7 days before.', { date: day(trialEnd) })}</T>
          </>
        ) : (
          <>
            <T>{iv === 'year' ? t('Today: {price} plus VAT for the first year.', { price: euro(first, L) }) : t('Today: {price} plus VAT for the first month.', { price: euro(first, L) })}</T>
            <T>{iv === 'year' ? t('Then {price} plus VAT every year, until you cancel.', { price: euro(net, L) }) : t('Then {price} plus VAT every month, until you cancel.', { price: euro(net, L) })}</T>
          </>
        )}
        {offer?.months && discount ? <T v="hint">{t('The offer\'s discount is for {m} months; then the plan costs {price} plus VAT {per}.', { m: offer.months, price: euro(net, L), per })}</T> : null}
        {launch ? <T v="hint">{t('Launch offer: {n} % off the plan in the first year.', { n: cfg.yearlyOff })}</T> : null}
        <T v="hint">{t('You can cancel any time to the end of the period paid for: Account, then Plan and billing.')}</T>
        {TERMS_VERSION ? <AcceptTerms on={accepted} onChange={setAccepted} /> : null}
        <Button v="primary" wide disabled={!cardReady} loading={busy} onPress={go}
          title={trialEnd ? t('Start free, paid from {date}', { date: day(trialEnd) }) : t('Pay {price} plus VAT and start', { price: euro(first, L) })} />
        {step ? <T v="hint">{step}</T> : null}
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      </Card>
    </View>
  );
}
