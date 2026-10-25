import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Button, F, MARKER, Pill, Row, T, fmtWhen, useColors, type PillV } from '@/components/ui';
import { useSession } from '@/lib/session';
import type { BuyKind, Purchase, Vehicle } from '@/lib/types';

/**
 * Refuelling, washing and parts bought for a van. Anyone at the van's station refuels and washes it; owners and the
 * station's fleet managers also buy parts. Each one starts with a photo of the dashboard; refuelling and washing
 * check the van's fuel card from a photo; then the receipt. The station's fleet manager hears about each one.
 */

export const BUY_NAME: Record<BuyKind, string> = { fuel: 'Refuel', wash: 'Wash', parts: 'Parts' };
export const BUY_NOUN: Record<BuyKind, string> = { fuel: 'refuel', wash: 'wash', parts: 'parts purchase' };

/** "€79.10" (or "PLN 120.00"). */
export const money = (n: number | null | undefined, cur?: string | null) =>
  (n == null ? '–' : `${cur && cur !== 'EUR' ? cur + ' ' : '€'}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const litresText = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} l`);

/** Not finished after this long: the driver gave up or forgot. */
export const STALE_BUY = 6 * 3600_000;
export const isOpenBuy = (p: Purchase) => p.status === 'open' || p.status === 'waiting' || p.status === 'refused';

export function buyState(p: Purchase): { text: string; v: PillV } {
  if (p.status === 'done') return p.flags?.length ? { text: `${p.flags.length} to check`, v: 'amber' } : { text: 'Done', v: 'good' };
  if (p.status === 'cancelled') return { text: p.decision && !p.decision.allow ? 'Refused' : 'Cancelled', v: 'muted' };
  if (p.status === 'waiting') return { text: 'Waiting for a manager', v: 'bad' };
  if (p.status === 'refused') return { text: 'Refused', v: 'bad' };
  return Date.now() - p.createdAt > STALE_BUY ? { text: 'Not finished', v: 'muted' } : { text: 'Going on', v: 'amber' };
}

/** What the card check found, in words. */
export function cardLine(p: Purchase): string | null {
  const c = p.card;
  if (!c?.needed) return p.kind === 'parts' ? null : 'No fuel card on the van\'s record, nothing to check.';
  if (!c.result) return 'Card not checked yet.';
  if (c.result === 'match') return `The van's card${c.read?.last4 ? `, ending ${c.read.last4}` : ''}.`;
  if (c.result === 'missing') return 'No fuel card at the pump.';
  if (c.result === 'unclear') return `The card couldn't be read${c.why ? `: ${c.why}` : '.'}`;
  return c.why || 'Not the van\'s card.';
}

/** A line about one, for lists: what, how much, who or which van, when. */
export function BuyRow({ p, show, first }: { p: Purchase; show: 'driver' | 'van'; first?: boolean }) {
  const c = useColors();
  const st = buyState(p);
  const amount = [p.kind === 'fuel' ? litresText(p.litres) : '', p.total != null ? money(p.total, p.currency) : ''].filter(Boolean).join(', ');
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/buy/${p.id}`)}
      style={({ pressed }) => ({ gap: 3, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: c.rule, opacity: pressed ? 0.7 : 1 })}>
      <Row>
        <T v="medium" style={{ flex: 1 }} numberOfLines={1}>{BUY_NAME[p.kind]}: {show === 'driver' ? p.byName : p.vehicleName}</T>
        {amount ? <Text style={{ fontFamily: F.condBold, fontSize: 17, color: c.ink, fontVariant: ['tabular-nums'] }}>{amount}</Text> : null}
      </Row>
      <Row gap={6}>
        <T v="small" style={{ flexShrink: 1 }}>{[fmtWhen(p.createdAt), p.odometerKm != null ? `${p.odometerKm.toLocaleString()} km` : '', p.merchant || ''].filter(Boolean).join(', ')}</T>
        {st.text !== 'Done' ? <Pill v={st.v} text={st.text} /> : null}
      </Row>
      {p.status === 'done' && p.flags?.length ? <T v="small" color={c.amber}>{p.flags.map((f) => f.text).join(' ')}</T> : null}
    </Pressable>
  );
}

/**
 * On a van: the buttons, and what's going on now. The person's own unfinished one comes first (they may have closed
 * the app while filling up); the station's staff see a driver waiting at the pump for their answer.
 */
export function BuyActions({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  if (s.mode !== 'firebase' || v.retired || !s.user) return null;
  const mine = s.purchases.find((p) => p.vehicleId === v.id && p.by === s.user!.uid && isOpenBuy(p) && Date.now() - p.createdAt < STALE_BUY);
  const asking = s.runs(v.stationId) ? s.purchases.filter((p) => p.vehicleId === v.id && p.status === 'waiting' && p.by !== s.user!.uid) : [];
  const start = (kind: BuyKind) => router.push({ pathname: '/buy/[id]', params: { id: 'new', van: v.id, kind } });
  return (
    <View style={{ gap: 10 }}>
      {asking.map((p) => <WaitingCard key={p.id} p={p} />)}
      {mine ? <MineCard p={mine} /> : null}
      <View style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 8, backgroundColor: c.paper }}>
        <Row>
          {v.fuel !== 'electric' ? <Button title="Refuel" onPress={() => start('fuel')} /> : null}
          <Button title="Wash" onPress={() => start('wash')} />
          {s.runs(v.stationId) ? <Button title="Buy parts" onPress={() => start('parts')} /> : null}
        </Row>
        <T v="small">{v.fuel === 'electric' ? 'Starts with a photo of the dashboard; then the fuel card and the receipt.' : 'Before you start the pump: a photo of the dashboard. Then the fuel card and the receipt.'}</T>
      </View>
    </View>
  );
}

/** The person's own one that isn't finished: where they left off. */
export function MineCard({ p, withVan }: { p: Purchase; withVan?: boolean }) {
  const c = useColors();
  const waiting = p.status === 'waiting', refused = p.status === 'refused';
  const line = waiting ? 'Waiting for your fleet manager to allow or refuse it. Don\'t start yet.'
    : refused ? `${p.decision?.byName || 'Your fleet manager'} refused it. Cancel it.`
      : !p.receipt ? (p.card.needed && !p.card.result ? 'The fuel card is next.' : 'Take the photo of the receipt when you\'re done.') : 'Check the numbers and save.';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/buy/${p.id}`)}
      style={{ backgroundColor: waiting || refused ? c.paper : MARKER, borderWidth: 2, borderColor: waiting || refused ? c.alert : '#000', borderRadius: 4, padding: 14, gap: 4 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 22, lineHeight: 25, color: waiting || refused ? c.alert : '#000' }}>
        Your {BUY_NOUN[p.kind]}{withVan ? ` of ${p.vehicleName}` : ''} isn&apos;t finished ›
      </Text>
      <T v="body" color={waiting || refused ? undefined : '#000'}>{line}</T>
      <T v="small" color={waiting || refused ? undefined : '#000'}>Started {dur(Date.now() - p.createdAt)} ago.</T>
    </Pressable>
  );
}

/** For the station's staff: a driver stopped at the pump, waiting for an answer. */
export function WaitingCard({ p, where }: { p: Purchase; where?: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/buy/${p.id}`)}
      style={{ backgroundColor: c.paper, borderWidth: 3, borderColor: c.alert, borderRadius: 4, padding: 14, gap: 4 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 22, lineHeight: 25, color: c.alert }}>
        {p.byName} is waiting at the {p.kind === 'wash' ? 'car wash' : 'pump'} ›
      </Text>
      <T v="medium">{BUY_NAME[p.kind]}: {p.vehicleName}{p.plate ? ` (${p.plate})` : ''}</T>
      <T v="small">{cardLine(p)} {dur(Date.now() - (p.card.at || p.createdAt))} ago{where ? `, ${where}` : ''}. Allow or refuse it.</T>
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
export function BuyButtons({ v, onMarker }: { v: Vehicle; onMarker?: boolean }) {
  const s = useSession();
  if (s.mode !== 'firebase' || v.retired) return null;
  const start = (kind: BuyKind) => router.push({ pathname: '/buy/[id]', params: { id: 'new', van: v.id, kind } });
  return (
    <>
      {v.fuel !== 'electric' ? <Button small title="Refuel" onPress={() => start('fuel')} style={onMarker ? { borderColor: '#000' } : undefined} /> : null}
      <Button small title="Wash" onPress={() => start('wash')} />
    </>
  );
}
