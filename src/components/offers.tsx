import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Button, Card, F, Field, Pill, Row, Segmented, T, useColors } from '@/components/ui';
import { PLAN_NAME, euro } from '@/lib/billing';
import { fb } from '@/lib/firebase';
import { loc, t, tp } from '@/lib/i18n';
import { authMessage, useSession } from '@/lib/session';
import { ai } from '@/lib/store';
import type { Offer } from '@/lib/types';

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

/**
 * The app creator's sign-up links (product owner, 2026-11-05: "links that DSPs register with, where I set up their
 * free trial, prices and other details"), and the yearly launch offer. Each link is <web app>/start?offer=CODE; the
 * DSP still adds a card. Web only, like everything about prices.
 */
export function OffersCard() {
  const s = useSession();
  const c = useColors();
  const [list, setList] = useState<Offer[] | null>(null);
  const [launch, setLaunch] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const f = fb();
    if (!f) return;
    try {
      const [q, pb] = await Promise.all([getDocs(query(collection(f.db, 'offers'), orderBy('createdAt', 'desc'), limit(50))), getDoc(doc(f.db, 'platform', 'billing'))]);
      setList(q.docs.map((d) => d.data() as Offer));
      setLaunch(pb.data()?.launchOffer !== false);
    } catch (e) { setErr(authMessage(e)); }
  }, []);
  useEffect(() => { if (s.creator && Platform.OS === 'web') reload(); }, [s.creator, reload]);
  if (!s.creator || Platform.OS !== 'web' || s.mode !== 'firebase') return null;
  return (
    <Card>
      <T v="h3">{t('Sign-up links and offers')}</T>
      <T v="hint">{t('Only you see this. A link sets the free days, a discount and the plan for one DSP; they still add a card.')}</T>
      {launch != null ? (
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: launch }} onPress={async () => {
          try { const r = await ai.setLaunchOffer({ on: !launch }); setLaunch(r.launchOffer); } catch (e) { setErr(authMessage(e)); }
        }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: launch ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {launch ? <Text style={{ color: c.paper, fontFamily: F.semi, fontSize: 15, lineHeight: 17 }}>✓</Text> : null}
          </View>
          <T>{t('Launch offer: 30 % off the first year on yearly plans')}</T>
        </Pressable>
      ) : null}
      {open ? <NewOffer onDone={() => { setOpen(false); reload(); }} onCancel={() => setOpen(false)} /> : <Button title={t('New sign-up link')} onPress={() => setOpen(true)} />}
      {(list || []).map((o) => <OfferRow key={o.code} o={o} onChange={reload} />)}
      {list && !list.length ? <T v="hint">{t('No sign-up links yet.')}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}

function linkOf(code: string) {
  return `${typeof window !== 'undefined' ? window.location.origin : 'https://app.fratius.com'}/start?offer=${code}`;
}
function terms(o: Pick<Offer, 'plan' | 'interval' | 'trialDays' | 'percentOff' | 'amountOff' | 'months'>) {
  const L = loc();
  const bits = [
    o.plan ? PLAN_NAME[o.plan] : t('any plan'),
    o.interval === 'year' ? t('yearly') : o.interval === 'month' ? t('monthly') : t('monthly or yearly'),
    o.trialDays ? tp(o.trialDays, '{n} day free', '{n} days free') : t('no free days'),
  ];
  if (o.percentOff) bits.push(o.months ? t('{n} % off for {m} months', { n: o.percentOff, m: o.months }) : t('{n} % off', { n: o.percentOff }));
  if (o.amountOff) bits.push(o.months ? t('{price} off each invoice for {m} months', { price: euro(o.amountOff, L), m: o.months }) : t('{price} off each invoice', { price: euro(o.amountOff, L) }));
  return bits.join(' · ');
}

function OfferRow({ o, onChange }: { o: Offer; onChange(): void }) {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const over = o.ended || o.uses >= o.maxUses || (!!o.validUntil && Date.now() > o.validUntil);
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 10, gap: 4 }}>
      <Row>
        <T v="medium" selectable>{o.code}</T>
        <Pill v={over ? 'muted' : 'good'} text={o.ended ? t('Ended') : t('{n} of {max} used', { n: o.uses, max: o.maxUses })} />
      </Row>
      {o.note ? <T>{o.note}</T> : null}
      <T v="hint">{terms(o)}{o.validUntil ? ` · ${t('until {date}', { date: new Date(o.validUntil).toLocaleDateString(loc()) })}` : ''}</T>
      <T v="small" selectable>{linkOf(o.code)}</T>
      {!over ? (
        <Row>
          <Button small title={copied ? t('Copied') : t('Copy link')} onPress={() => { navigator.clipboard?.writeText(linkOf(o.code)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {}); }} />
          <Button small v="link" title={t('End')} loading={busy} onPress={async () => { setBusy(true); try { await ai.saveOffer({ code: o.code, ended: true }); onChange(); } finally { setBusy(false); } }} />
        </Row>
      ) : null}
    </View>
  );
}

function NewOffer({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const c = useColors();
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState<'any' | 'basic' | 'pro' | 'premium'>('any');
  const [interval, setInterval] = useState<'any' | 'month' | 'year'>('month');
  const [trial, setTrial] = useState('30');
  const [kind, setKind] = useState<'none' | 'percent' | 'euro'>('none');
  const [off, setOff] = useState('');
  const [months, setMonths] = useState('');
  const [uses, setUses] = useState('1');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    if (kind === 'euro' && plan === 'any') return setErr(t('A discount in euros needs a fixed plan.'));
    setBusy(true);
    try {
      const valid = num(days);
      const r = await ai.saveOffer({
        note: note.trim(), plan: plan === 'any' ? null : plan, interval: interval === 'any' ? null : interval,
        trialDays: Math.max(0, Math.round(num(trial) ?? 0)),
        percentOff: kind === 'percent' ? num(off) : null, amountOff: kind === 'euro' && num(off) != null ? Math.round(num(off)! * 100) : null,
        months: kind === 'none' ? null : num(months), maxUses: Math.max(1, Math.round(num(uses) ?? 1)),
        validUntil: valid ? Date.now() + valid * 86400_000 : null,
      });
      setMade(r.url);
    } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };
  if (made) {
    return (
      <View style={{ gap: 6 }}>
        <T v="medium">{t('The link is ready:')}</T>
        <T selectable>{made}</T>
        <Row>
          <Button small title={t('Copy link')} onPress={() => { navigator.clipboard?.writeText(made).catch(() => {}); }} />
          <Button small v="link" title={t('Done')} onPress={onDone} />
        </Row>
      </View>
    );
  }
  return (
    <View style={{ gap: 10, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12 }}>
      <Field label={t('For whom')} hint={t('only you see it')} value={note} onChangeText={setNote} placeholder={t('For example: Hart Logistics, 80 vans')} />
      <Segmented label={t('Plan')} value={plan} onChange={setPlan} options={[['any', t('They choose')], ['basic', 'Basic'], ['pro', 'Pro'], ['premium', 'Premium']]} />
      <Segmented label={t('Billed')} value={interval} onChange={setInterval} options={[['month', t('Monthly')], ['year', t('Yearly')], ['any', t('They choose')]]} />
      <Field label={t('Free days')} hint={t('0: they pay at sign-up')} value={trial} onChangeText={setTrial} keyboardType="number-pad" />
      <Segmented label={t('Discount')} value={kind} onChange={setKind} options={[['none', t('None')], ['percent', '%'], ['euro', '€']]} />
      {kind !== 'none' ? (
        <>
          <Field label={kind === 'percent' ? t('Percent off') : t('Euros off each invoice')} value={off} onChangeText={setOff} keyboardType="decimal-pad" />
          <Field label={t('For how many months')} hint={t('empty: for as long as they stay')} value={months} onChangeText={setMonths} keyboardType="number-pad" />
        </>
      ) : null}
      <Field label={t('How many sign-ups')} value={uses} onChangeText={setUses} keyboardType="number-pad" />
      <Field label={t('Valid for days')} hint={t('empty: no end date')} value={days} onChangeText={setDays} keyboardType="number-pad" />
      <Row>
        <Button v="primary" small title={t('Make the link')} loading={busy} onPress={save} />
        <Button v="link" small title={t('Cancel')} onPress={onCancel} />
      </Row>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}
