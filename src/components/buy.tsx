import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Button, F, MARKER, Pill, Row, T, fmtWhen, useColors, type PillV } from '@/components/ui';
import { useSession } from '@/lib/session';
import type { BuyKind, Purchase, Vehicle } from '@/lib/types';
import { N_, loc, t, tp } from '@/lib/i18n';

/**
 * Refuelling, washing and parts bought for a van. Anyone at the van's station refuels and washes it; owners and the
 * station's fleet managers also buy parts. Each one starts with a photo of the dashboard; refuelling and washing
 * check the van's fuel card from a photo; then the receipt. The station's fleet manager hears about each one.
 */

/** English labels (translate where shown: t(BUY_NAME[kind])). */
export const BUY_NAME: Record<BuyKind, string> = { fuel: N_('Refuel'), wash: N_('Wash'), parts: N_('Parts') };
export const BUY_NOUN: Record<BuyKind, string> = { fuel: N_('refuel'), wash: N_('wash'), parts: N_('parts purchase') };

/** "€79.10" (or "PLN 120.00"). */
export const money = (n: number | null | undefined, cur?: string | null) =>
  (n == null ? '–' : `${cur && cur !== 'EUR' ? cur + ' ' : '€'}${n.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const litresText = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString(loc(), { maximumFractionDigits: 2 })} l`);

/** Not finished after this long: the driver gave up or forgot. */
export const STALE_BUY = 6 * 3600_000;
export const isOpenBuy = (p: Purchase) => p.status === 'open' || p.status === 'waiting' || p.status === 'refused';

/** "Cancel the refuel", for each kind (a whole sentence, so each language can say it its own way). */
export function cancelText(kind: BuyKind) {
  return kind === 'fuel' ? t('Cancel the refuel') : kind === 'wash' ? t('Cancel the wash') : t('Cancel the parts purchase');
}

/** A flag the server wrote: in the reader's language when it carries its template. */
type Flag = Purchase['flags'][number] & { t?: string; v?: Record<string, string | number> };
export const flagText = (f: Flag) => (f.t ? t(f.t, f.v) : t(f.text));
/** What the card check said, in the reader's language when the server sent its template. */
export function whyText(p: Purchase): string | null {
  const c = p.card as Purchase['card'] & { whyT?: string; whyV?: Record<string, string | number> };
  return c.whyT ? t(c.whyT, c.whyV) : c.why ? t(c.why) : null;
}

export function buyState(p: Purchase): { key: 'check' | 'done' | 'refused' | 'cancelled' | 'waiting' | 'stale' | 'open'; text: string; v: PillV } {
  if (p.status === 'done') return p.flags?.length ? { key: 'check', text: tp(p.flags.length, '{n} to check', '{n} to check'), v: 'amber' } : { key: 'done', text: t('Done'), v: 'good' };
  if (p.status === 'cancelled') return p.decision && !p.decision.allow ? { key: 'refused', text: t('Refused'), v: 'muted' } : { key: 'cancelled', text: t('Cancelled'), v: 'muted' };
  if (p.status === 'waiting') return { key: 'waiting', text: t('Waiting for a manager'), v: 'bad' };
  if (p.status === 'refused') return { key: 'refused', text: t('Refused'), v: 'bad' };
  return Date.now() - p.createdAt > STALE_BUY ? { key: 'stale', text: t('Not finished'), v: 'muted' } : { key: 'open', text: t('Going on'), v: 'amber' };
}

/** What the card check found, in words. */
export function cardLine(p: Purchase): string | null {
  const c = p.card;
  if (!c?.needed) return p.kind === 'parts' ? null : t('No fuel card on the van\'s record, nothing to check.');
  if (!c.result) return t('Card not checked yet.');
  if (c.result === 'match') return c.read?.last4 ? t('The van\'s card, ending {last4}.', { last4: c.read.last4 }) : t('The van\'s card.');
  if (c.result === 'missing') return t('No fuel card at the pump.');
  const why = whyText(p);
  if (c.result === 'unclear') return why ? t('The card couldn\'t be read: {why}', { why }) : t('The card couldn\'t be read.');
  return why || t('Not the van\'s card.');
}

/** "Refuel: Transit 03". */
export const buyTitle = (kind: BuyKind, name: string) => t('{what}: {name}', { what: t(BUY_NAME[kind]), name });

/** A line about one, for lists: what, how much, who or which van, when. */
export function BuyRow({ p, show, first }: { p: Purchase; show: 'driver' | 'van'; first?: boolean }) {
  const c = useColors();
  const st = buyState(p);
  const amount = [p.kind === 'fuel' ? litresText(p.litres) : '', p.total != null ? money(p.total, p.currency) : ''].filter(Boolean).join(', ');
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/buy/${p.id}`)}
      style={({ pressed }) => ({ gap: 3, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: c.rule, opacity: pressed ? 0.7 : 1 })}>
      <Row>
        <T v="medium" style={{ flex: 1 }} numberOfLines={1}>{buyTitle(p.kind, show === 'driver' ? p.byName : p.vehicleName)}</T>
        {amount ? <Text style={{ fontFamily: F.condBold, fontSize: 17, color: c.ink, fontVariant: ['tabular-nums'] }}>{amount}</Text> : null}
      </Row>
      <Row gap={6}>
        <T v="small" style={{ flexShrink: 1 }}>{[fmtWhen(p.createdAt), p.odometerKm != null ? `${p.odometerKm.toLocaleString(loc())} km` : '', p.merchant || ''].filter(Boolean).join(', ')}</T>
        {st.key !== 'done' ? <Pill v={st.v} text={st.text} /> : null}
      </Row>
      {p.status === 'done' && p.flags?.length ? <T v="small" color={c.amber}>{p.flags.map((f) => flagText(f)).join(' ')}</T> : null}
    </Pressable>
  );
}

/**
 * At the top of a van: the person's own unfinished one (they may have closed the app while filling up), and for the
 * station's staff, drivers stopped at the pump waiting for their answer.
 */
export function BuyNow({ v }: { v: Vehicle }) {
  const s = useSession();
  if (s.mode !== 'firebase' || !s.user) return null;
  const mine = s.purchases.find((p) => p.vehicleId === v.id && p.by === s.user!.uid && isOpenBuy(p) && Date.now() - p.createdAt < STALE_BUY);
  const asking = s.runs(v.stationId) ? s.purchases.filter((p) => p.vehicleId === v.id && p.status === 'waiting' && p.by !== s.user!.uid) : [];
  if (!mine && !asking.length) return null;
  return <View style={{ gap: 10 }}>{asking.map((p) => <WaitingCard key={p.id} p={p} />)}{mine ? <MineCard p={mine} /> : null}</View>;
}

/** On a van: Refuel, Wash and (owners and the station's managers) Buy parts. */
export function BuyActions({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  if (s.mode !== 'firebase' || v.retired || !s.user) return null;
  const start = (kind: BuyKind) => router.push({ pathname: '/buy/[id]', params: { id: 'new', van: v.id, kind } });
  return (
    <View style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 8, backgroundColor: c.paper }}>
      <Row>
        {v.fuel !== 'electric' ? <Button title={t('Refuel')} onPress={() => start('fuel')} /> : null}
        <Button title={t('Wash')} onPress={() => start('wash')} />
        {s.runs(v.stationId) ? <Button title={t('Buy parts')} onPress={() => start('parts')} /> : null}
      </Row>
      <T v="small">{v.fuel === 'electric' ? t('Each starts with a photo of the dashboard; a wash then checks the fuel card and takes the receipt.')
        : t('Before you start the pump: a photo of the dashboard. Then the fuel card and the receipt.')}</T>
    </View>
  );
}

/** "Your refuel of Transit 03 isn't finished", for each kind. */
function unfinished(kind: BuyKind, van?: string) {
  if (van) {
    return kind === 'fuel' ? t('Your refuel of {van} isn\'t finished', { van }) : kind === 'wash' ? t('Your wash of {van} isn\'t finished', { van })
      : t('Your parts purchase of {van} isn\'t finished', { van });
  }
  return kind === 'fuel' ? t('Your refuel isn\'t finished') : kind === 'wash' ? t('Your wash isn\'t finished') : t('Your parts purchase isn\'t finished');
}

/** The person's own one that isn't finished: where they left off. */
export function MineCard({ p, withVan }: { p: Purchase; withVan?: boolean }) {
  const c = useColors();
  const waiting = p.status === 'waiting', refused = p.status === 'refused';
  const line = waiting ? t('Waiting for your fleet manager to allow or refuse it. Don\'t start yet.')
    : refused ? (p.decision?.byName ? t('{name} refused it. Cancel it.', { name: p.decision.byName }) : t('Your fleet manager refused it. Cancel it.'))
      : !p.receipt ? (p.card.needed && !p.card.result ? t('The fuel card is next.') : t('Take the photo of the receipt when you\'re done.')) : t('Check the numbers and save.');
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/buy/${p.id}`)}
      style={{ backgroundColor: waiting || refused ? c.paper : MARKER, borderWidth: waiting || refused ? 3 : 2, borderColor: waiting || refused ? c.alert : '#000', borderRadius: 4, padding: 14, gap: 4 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 22, lineHeight: 25, color: waiting || refused ? c.alert : '#000' }}>
        {unfinished(p.kind, withVan ? p.vehicleName : undefined)} ›
      </Text>
      <T v="body" color={waiting || refused ? undefined : '#000'}>{line}</T>
      <T v="small" color={waiting || refused ? undefined : '#000'}>{t('Started {time} ago.', { time: dur(Date.now() - p.createdAt) })}</T>
    </Pressable>
  );
}

/** "Dana is waiting at the pump" (or the car wash). */
export const waitingTitle = (p: Purchase) => (p.kind === 'wash' ? t('{name} is waiting at the car wash', { name: p.byName }) : t('{name} is waiting at the pump', { name: p.byName }));

/** For the station's staff: a driver stopped at the pump, waiting for an answer. */
export function WaitingCard({ p, where }: { p: Purchase; where?: string }) {
  const c = useColors();
  const time = dur(Date.now() - (p.card.at || p.createdAt));
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/buy/${p.id}`)}
      style={{ backgroundColor: c.paper, borderWidth: 3, borderColor: c.alert, borderRadius: 4, padding: 14, gap: 4 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 22, lineHeight: 25, color: c.alert }}>
        {waitingTitle(p)} ›
      </Text>
      <T v="medium">{buyTitle(p.kind, `${p.vehicleName}${p.plate ? ` (${p.plate})` : ''}`)}</T>
      <T v="small">{[cardLine(p), where ? t('{time} ago, {where}.', { time, where }) : t('{time} ago.', { time }), t('Allow or refuse it.')].filter(Boolean).join(' ')}</T>
    </Pressable>
  );
}

/** The person's own unfinished one on any van (for the Vans tab). */
export function MyOpenBuy() {
  const s = useSession();
  if (s.mode !== 'firebase' || !s.user) return null;
  const mine = s.purchases.find((p) => p.by === s.user!.uid && isOpenBuy(p) && Date.now() - p.createdAt < STALE_BUY);
  return mine ? <MineCard p={mine} withVan /> : null;
}

/** Small buttons for a driver's own van on the Vans tab. */
export function BuyButtons({ v }: { v: Vehicle }) {
  const s = useSession();
  if (s.mode !== 'firebase' || v.retired) return null;
  const start = (kind: BuyKind) => router.push({ pathname: '/buy/[id]', params: { id: 'new', van: v.id, kind } });
  return (
    <>
      {v.fuel !== 'electric' ? <Button small title={t('Refuel')} onPress={() => start('fuel')} /> : null}
      <Button small title={t('Wash')} onPress={() => start('wash')} />
    </>
  );
}
