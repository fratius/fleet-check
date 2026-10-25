import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Card, F, MARKER, Pill, Plate, Row, Screen, T, fmtWhen, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';
import { approvedDamage, type Check, type Member, type Tour } from '@/lib/types';
import { missingHandovers, type Missing } from '@/lib/videos';
import { CHECK_MONTHS, fleetDue, fmtDay, peopleDue } from '@/lib/fleet';
import { watchMembers } from '@/lib/people';
import { tourGaps, vanWarnings, type TourGap } from '@/lib/stats';
import { BuyRow, WaitingCard } from '@/components/buy';
import { t, tp } from '@/lib/i18n';

type Cat = 'all' | 'pump' | 'review' | 'missing' | 'warn' | 'due' | 'buys' | 'van' | 'done';

/**
 * The fleet manager's queue, by category: checks to decide, handovers and tours missing their video or photos,
 * warning lights on the dashboard, what falls due (vans and drivers), checks the driver is still taking close-ups
 * for, and the ones decided lately. Each category has its own colour and weight, so what needs action stands out
 * from what is only information.
 */
export default function ReviewQueue() {
  const s = useSession();
  const c = useColors();
  const [cat, setCat] = useState<Cat>('all');
  const [allDone, setAllDone] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId || s.mode !== 'firebase' || !s.staff) return;
    return watchMembers(orgId, setMembers);
  }, [orgId, s.mode, s.staff]);
  if (!s.staff) return <Screen><T v="h1">{t('Review')}</T><Card dashed><T v="hint">{t('Fleet managers and owners review damage checks.')}</T></Card></Screen>;
  const mine = s.checks.filter((k) => s.runs(k.stationId));
  const waiting = mine.filter((k) => k.status === 'submitted').sort((a, b) => (a.submittedAt || a.createdAt) - (b.submittedAt || b.createdAt));
  const atVan = mine.filter((k) => k.status === 'checking');
  const done = mine.filter((k) => k.status === 'reviewed');
  // Handovers in the last 7 days without the driver's pick-up or drop-off video or photos, and vans still out after a shift.
  const missing = missingHandovers(s.assignments.filter((a) => s.runs(a.stationId)), s.videos, s.walks, s.stations, Date.now() - 7 * 86400_000);
  // Tours without their start or end photo (where dashboard photos are on).
  const gaps = s.org?.dashScans ? tourGaps(s.tours.filter((t) => s.runs(t.stationId)), s.assignments.filter((a) => s.runs(a.stationId)), Date.now() - 7 * 86400_000, s.org.dashScansAt || 0) : [];
  // Warning lights on the latest dashboard photo of a van.
  const warn = vanWarnings(s.tours.filter((t) => s.runs(t.stationId)));
  // Inspections, service, tax, insurance and contract ends that are overdue or due soon, and the drivers' licence
  // checks, licences and safety briefings.
  const due = fleetDue(s.vehicles.filter((v) => s.runs(v.stationId)), s.details);
  const known = new Map([...s.assignments.map((a) => [a.driverId, a.driverName] as const), ...s.tours.map((t) => [t.driverId, t.driverName] as const)]);
  const pdue = peopleDue(s.records.filter((r) => s.runs(r.stationId)), members, s.org?.licenceCheckMonths || CHECK_MONTHS, Date.now(), known);
  // Drivers stopped at the pump (not the van's fuel card, or none), oldest first; and the last week's refuels,
  // washes and parts, the ones to check first.
  const pump = s.purchases.filter((p) => p.status === 'waiting' && s.runs(p.stationId) && p.by !== s.user?.uid).sort((a, b) => (a.card.at || a.createdAt) - (b.card.at || b.createdAt));
  const weekAgo = Date.now() - 7 * 86400_000;
  const buys = s.purchases.filter((p) => p.status !== 'waiting' && s.runs(p.stationId) && p.createdAt > weekAgo && (p.status !== 'open' || Date.now() - p.createdAt > 6 * 3600_000))
    .sort((a, b) => (b.flags?.length ? 1 : 0) - (a.flags?.length ? 1 : 0) || b.createdAt - a.createdAt);
  const showStation = s.stations.length > 1;
  const plate = (vehicleId: string) => s.vehicles.find((v) => v.id === vehicleId)?.plate || '';
  const where = (stationId: string | null | undefined) => (showStation ? s.stationName(stationId) : '');

  const color = { pump: c.alert, review: MARKER, missing: c.alert, warn: c.warn, due: c.amber, buys: c.ink, van: c.ink2, done: c.ok };
  const cats: [Exclude<Cat, 'all'>, string, number][] = [
    ...(pump.length ? [['pump', t('At the pump'), pump.length] as [Exclude<Cat, 'all'>, string, number]] : []),
    ['review', t('To review'), waiting.length], ['missing', t('Missing proof'), missing.length + gaps.length], ['warn', t('Warning lights'), warn.length],
    ['due', t('Due soon'), due.length + pdue.length], ['buys', t('Fuel, wash, parts'), buys.length], ['van', t('At the van'), atVan.length], ['done', t('Reviewed'), done.length],
  ];
  const show = (k: Exclude<Cat, 'all'>) => cat === 'all' || cat === k;
  const shownDone = allDone ? done : done.slice(0, 8);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">{t('Review')}</T>
        <T v="hint">{t('You decide each spot the AI found. Your decision is final and goes on the van\'s record.')}</T>
      </View>

      {/* Every category at a glance; tap one to see only it. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {cats.map(([k, label, n]) => {
          const on = cat === k;
          return (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${label}, ${n}`} onPress={() => setCat(on ? 'all' : k)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 10, paddingRight: 12, borderRadius: 4, borderWidth: 2,
                borderColor: c.ink, backgroundColor: on ? c.ink : c.paper, opacity: n || on ? 1 : 0.55 }}>
              <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: color[k], borderWidth: k === 'review' ? 1.5 : 0, borderColor: '#000' }} />
              <Text style={{ fontFamily: F.cond, fontSize: 18, color: on ? c.paper : c.ink }}>{label}</Text>
              <Text style={{ fontFamily: F.condBold, fontSize: 18, color: on ? c.paper : c.ink, fontVariant: ['tabular-nums'] }}>{n}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {show('pump') && pump.length ? (
        <Section color={c.alert} title={t('At the pump')} count={pump.length} note={t('Drivers stopped because the fuel card isn\'t the van\'s, or they have none. They\'re waiting for you: allow or refuse.')}>
          {pump.map((p) => <WaitingCard key={p.id} p={p} where={where(p.stationId)} />)}
        </Section>
      ) : null}

      {show('review') ? (
        <Section color={MARKER} title={t('To review')} count={waiting.length} note={t('Checks drivers sent. Oldest first.')}>
          {!waiting.length ? <Empty text={t('Nothing to decide right now. Checks appear here when a driver sends one.')} /> : null}
          {waiting.map((k) => <ToReview key={k.id} k={k} plate={plate(k.vehicleId)} where={where(k.stationId)} />)}
        </Section>
      ) : null}

      {show('missing') && (missing.length || gaps.length || cat === 'missing') ? (
        <Section color={c.alert} title={t('Missing proof')} count={missing.length + gaps.length} note={s.org?.dashScans
          ? t('Handovers without their video or photos, and tours without the dashboard photo. Open the van to add them or see its history.')
          : t('Handovers without their video or photos. Open the van to add them or see its history.')}>
          {!missing.length && !gaps.length ? <Empty text={t('Every handover has its video or photos.')} /> : null}
          {missing.map((m) => <MissingCard key={`${m.a.id}-${m.what}`} m={m} plate={plate(m.a.vehicleId)} where={where(m.a.stationId)} />)}
          {gaps.map((g) => <GapCard key={`${g.vehicleId}-${g.driverId}-${g.at}-${g.kind}`} g={g} plate={plate(g.vehicleId)} where={where(g.stationId)} />)}
        </Section>
      ) : null}

      {show('warn') && (warn.length || cat === 'warn') ? (
        <Section color={c.warn} title={t('Warning lights')} count={warn.length} note={t('Lit on a van\'s latest dashboard photo, in the last 3 days. Check the van before it goes out again.')}>
          {!warn.length ? <Empty text={t('No warning lights on the latest dashboard photos.')} /> : null}
          {warn.map((tour) => <WarnCard key={tour.id} tour={tour} plate={plate(tour.vehicleId)} where={where(tour.stationId)} />)}
        </Section>
      ) : null}

      {show('due') && (due.length || pdue.length || cat === 'due') ? (
        <Section color={c.amber} title={t('Due soon')} count={due.length + pdue.length} note={t('Inspections, service, tax, insurance and contract ends; drivers\' licence checks, licences and safety briefings. In the next weeks, or overdue.')}>
          <List>
            {!due.length && !pdue.length ? <T v="hint">{t('Nothing due in the next weeks.')}</T> : null}
            {pdue.map(({ uid, name, stationId, x }, i) => (
              <ListRow key={`${uid}-${x.key}`} first={i === 0} onPress={() => router.push({ pathname: '/person/[uid]', params: { uid, tab: 'record' } })}
                title={`${name} – ${x.label}`} line={[x.day ? fmtDay(x.day) : '', where(stationId)].filter(Boolean).join(', ')}
                right={<Pill v={x.state === 'overdue' ? 'bad' : 'amber'} text={x.note} />} />
            ))}
            {due.map(({ v, x }, i) => (
              <ListRow key={`${v.id}-${x.key}`} first={i === 0 && !pdue.length} onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: v.id, tab: 'details' } })}
                title={`${v.name} – ${x.label}`} line={[x.day ? fmtDay(x.day, x.key === 'hu') : '', where(v.stationId)].filter(Boolean).join(', ')}
                right={<Pill v={x.state === 'overdue' ? 'bad' : 'amber'} text={x.note} />} />
            ))}
          </List>
        </Section>
      ) : null}

      {show('buys') && (buys.length || cat === 'buys') ? (
        <Section color={c.ink} title={t('Fuel, wash, parts')} count={buys.length} note={t('The last 7 days. The ones with something to check come first: the receipt and the dashboard photo don\'t fit together, or a card was allowed.')}>
          <List>
            {!buys.length ? <T v="hint">{t('No refuels, washes or parts in the last 7 days.')}</T> : null}
            {buys.map((p, i) => <BuyRow key={p.id} p={p} show="van" first={i === 0} />)}
          </List>
        </Section>
      ) : null}

      {show('van') && (atVan.length || cat === 'van') ? (
        <Section color={c.ink2} title={t('At the van')} count={atVan.length} note={t('The driver is still taking close-ups.')}>
          <List>
            {!atVan.length ? <T v="hint">{t('No driver is at a van right now.')}</T> : null}
            {atVan.map((k, i) => (
              <ListRow key={k.id} first={i === 0} onPress={() => router.push(`/check/${k.id}`)}
                title={k.createdByName ? `${k.createdByName} – ${k.vehicleName}` : k.vehicleName} line={[t('started {time} ago', { time: dur(Date.now() - k.createdAt) }), where(k.stationId)].filter(Boolean).join(', ')}
                right={<Pill v="muted" text={tp(k.spots.length, '{done} of {n} spot', '{done} of {n} spots', { done: k.spots.filter((p) => p.verdict).length })} />} />
            ))}
          </List>
        </Section>
      ) : null}

      {show('done') && (done.length || cat === 'done') ? (
        <Section color={c.ok} title={t('Reviewed')} count={done.length} note={t('Decided lately, newest first.')}>
          <List>
            {!done.length ? <T v="hint">{t('Nothing reviewed yet.')}</T> : null}
            {shownDone.map((k, i) => {
              const n = approvedDamage(k).length;
              return (
                <ListRow key={k.id} first={i === 0} onPress={() => router.push(`/check/${k.id}`)}
                  title={k.createdByName ? `${k.createdByName} – ${k.vehicleName}` : k.vehicleName}
                  line={[k.review?.byName ? t('reviewed by {name}', { name: k.review.byName }) : '', k.review?.at ? fmtWhen(k.review.at) : '', where(k.stationId)].filter(Boolean).join(', ')}
                  right={<Pill v={n ? 'bad' : 'good'} text={n ? tp(n, '{n} damage', '{n} damages') : t('No damage')} />} />
              );
            })}
            {done.length > shownDone.length ? (
              <Pressable accessibilityRole="button" onPress={() => setAllDone(true)} style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <T v="medium" style={{ textDecorationLine: 'underline' }}>{t('Show all {n}', { n: done.length })}</T>
              </Pressable>
            ) : null}
          </List>
        </Section>
      ) : null}
    </Screen>
  );
}

/** A category: its colour, name and count, one line on what it is, then its items. */
function Section({ color, title, count, note, children }: { color: string; title: string; count: number; note: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: 10, marginTop: 6 }}>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color, borderWidth: color === MARKER ? 1.5 : 0, borderColor: '#000' }} />
          <T v="h2" style={{ flexShrink: 1 }}>{title}</T>
          <View style={{ minWidth: 30, height: 26, paddingHorizontal: 8, borderRadius: 13, backgroundColor: count ? c.ink : 'transparent', borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.condBold, fontSize: 16, color: count ? c.paper : c.ink, fontVariant: ['tabular-nums'] }}>{count}</Text>
          </View>
        </View>
        <T v="small" style={{ paddingLeft: 16 }}>{note}</T>
      </View>
      {children}
    </View>
  );
}

/** An item that needs action: a card with the category's colour down its left edge. */
function ActionCard({ band, alert, onPress, label, children }: { band: string; alert?: boolean; onPress: () => void; label: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', backgroundColor: c.paper, borderWidth: 2, borderColor: alert ? c.alert : c.ink, borderRadius: 4, overflow: 'hidden', opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 10, backgroundColor: band, borderRightWidth: band === MARKER ? 2 : 0, borderColor: '#000' }} />
      <View style={{ flex: 1, padding: 12, gap: 6 }}>{children}</View>
      <View style={{ justifyContent: 'center', paddingRight: 12 }}><T v="h2" color={c.ink2}>›</T></View>
    </Pressable>
  );
}

function ToReview({ k, plate, where }: { k: Check; plate: string; where: string }) {
  const c = useColors();
  const sent = k.submittedAt || k.createdAt;
  const aiDamage = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
  const long = Date.now() - sent > 2 * 3600_000;
  return (
    <ActionCard band={MARKER} onPress={() => router.push(`/check/${k.id}`)} label={k.createdByName ? t('Review {name}, {van}', { name: k.createdByName, van: k.vehicleName }) : t('Review {van}', { van: k.vehicleName })}>
      <Text style={{ fontFamily: F.condBold, fontSize: 21, lineHeight: 25, color: c.ink }}>{k.createdByName ? `${k.createdByName} – ${k.vehicleName}` : k.vehicleName}</Text>
      <Row>
        {plate ? <Plate text={plate} /> : null}
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: long ? c.amber : c.ink }}>{t('Waiting {time}', { time: dur(Date.now() - sent) })}</Text>
        {where ? <T v="hint">{where}</T> : null}
      </Row>
      <Row gap={6}>
        <Pill text={tp(k.spots.length, '{n} spot', '{n} spots')} />
        <Pill v={aiDamage ? 'bad' : 'good'} text={aiDamage ? tp(aiDamage, 'AI found {n} damage', 'AI found {n} damages') : t('AI found no damage')} />
        {k.missedNote ? <Pill v="amber" text={t('Note from the driver')} /> : null}
      </Row>
    </ActionCard>
  );
}

function MissingCard({ m, plate, where }: { m: Missing; plate: string; where: string }) {
  const c = useColors();
  const { a, what } = m;
  const problem = what === 'no-pickup' ? t('No pick-up video') : what === 'still-out' ? t('Not dropped off') : t('No drop-off video');
  const since = what === 'no-pickup' ? t('{time} since it was given', { time: dur(Date.now() - a.start) }) : what === 'still-out' ? t('out for {time}', { time: dur(Date.now() - a.start) }) : '';
  // The driver it's about comes first; the line below says what happened.
  const detail = what === 'no-pickup' ? t('Given by {name}, {when}', { name: a.startedByName, when: fmtWhen(a.start) })
    : what === 'still-out' ? t('Has had it since {when}', { when: fmtWhen(a.start) })
      : a.endReason === 'taken over' ? (a.endedByName ? t('Had it until {when}, then {name} took it over', { when: fmtWhen(a.end), name: a.endedByName }) : t('Had it until {when}, then another driver took it over', { when: fmtWhen(a.end) }))
        : a.endedByName ? t('Had it until {when}, ended by {name}', { when: fmtWhen(a.end), name: a.endedByName }) : t('Had it until {when}', { when: fmtWhen(a.end) });
  return (
    <ActionCard band={c.alert} alert onPress={() => router.push(`/vehicle/${a.vehicleId}`)} label={`${a.driverName}, ${problem}: ${a.vehicleName}`}>
      <Text style={{ fontFamily: F.condBold, fontSize: 21, lineHeight: 25, color: c.ink }}>
        {a.driverName}<Text style={{ color: c.alert }}>{` – ${problem}`}</Text>
      </Text>
      {since ? <Text style={{ fontFamily: F.semi, fontSize: 14, color: c.alert, marginTop: -4 }}>{since}</Text> : null}
      <Row>
        <T v="h3">{a.vehicleName}</T>
        {plate ? <Plate text={plate} /> : null}
      </Row>
      <T v="hint">{[detail, where].filter(Boolean).join(', ')}</T>
    </ActionCard>
  );
}

/** A tour missing its dashboard photo: the driver first, then the van. */
function GapCard({ g, plate, where }: { g: TourGap; plate: string; where: string }) {
  const c = useColors();
  const problem = g.kind === 'no-end' ? t('No end-of-tour photo') : g.kind === 'no-start' ? t('No start-of-tour photo') : t('On tour for {time}', { time: dur(Date.now() - g.at) });
  const detail = g.kind === 'no-end' ? t('Tour started {when}; the kilometres are an estimate, no fuel figure', { when: fmtWhen(g.at) })
    : g.kind === 'no-start' ? t('Had the van since {when}', { when: fmtWhen(g.at) }) : t('Started {when}, no end photo yet', { when: fmtWhen(g.at) });
  return (
    <ActionCard band={c.alert} alert onPress={() => router.push(`/vehicle/${g.vehicleId}`)} label={`${g.driverName}, ${problem}: ${g.vehicleName}`}>
      <Text style={{ fontFamily: F.condBold, fontSize: 21, lineHeight: 25, color: c.ink }}>
        {g.driverName}<Text style={{ color: c.alert }}>{` – ${problem}`}</Text>
      </Text>
      <Row>
        <T v="h3">{g.vehicleName}</T>
        {plate ? <Plate text={plate} /> : null}
      </Row>
      <T v="hint">{[detail, where].filter(Boolean).join(', ')}</T>
    </ActionCard>
  );
}

/** A warning light on a van's dashboard: the van first, then who saw it and when. */
function WarnCard({ tour, plate, where }: { tour: Tour; plate: string; where: string }) {
  const c = useColors();
  const at = tour.end?.at || tour.startAt;
  return (
    <ActionCard band={c.warn} onPress={() => router.push(`/vehicle/${tour.vehicleId}`)} label={t('{van}, warning light: {lights}', { van: tour.vehicleName, lights: tour.warnings.map((w) => t(w)).join(', ') })}>
      <Text style={{ fontFamily: F.condBold, fontSize: 21, lineHeight: 25, color: c.ink }}>
        {tour.vehicleName}<Text style={{ color: c.warn }}>{` – ${tour.warnings.map((w) => t(w)).join(', ')}`}</Text>
      </Text>
      <Row>
        {plate ? <Plate text={plate} /> : null}
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: c.warn }}>{t('{time} ago', { time: dur(Date.now() - at) })}</Text>
      </Row>
      <T v="hint">{[tour.end ? t('On {name}\'s end photo, {when}', { name: tour.driverName, when: fmtWhen(at) }) : t('On {name}\'s start photo, {when}', { name: tour.driverName, when: fmtWhen(at) }), where].filter(Boolean).join(', ')}</T>
    </ActionCard>
  );
}

/** Information only: one card with compact rows. */
function List({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, gap: 10 }}>{children}</View>;
}
function ListRow({ title, line, right, first, onPress }: { title: string; line: string; right: React.ReactNode; first: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: first ? 0 : 1, borderColor: c.rule, paddingTop: first ? 0 : 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="medium" numberOfLines={2}>{title}</T>
        <T v="small" numberOfLines={2}>{line}</T>
      </View>
      {right}
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  return <Card dashed><T v="hint">{text}</T></Card>;
}
