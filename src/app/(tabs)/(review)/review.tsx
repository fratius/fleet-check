import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Card, F, MARKER, Pill, Row, Screen, T, fmtWhen, useColors, hs } from '@/components/ui';
import { useNameOf, useWhoDid } from '@/lib/names';
import { useSession } from '@/lib/session';
import { approvedDamage, type Check, type Member, type Tour, type Vehicle } from '@/lib/types';
import { missingHandovers, type Missing } from '@/lib/videos';
import { CHECK_MONTHS, fleetDue, fmtDay, peopleDue } from '@/lib/fleet';
import { apptState, apptWhen, openAppointments, serviceName } from '@/lib/service';
import { watchMembers, peopleScope } from '@/lib/people';
import { tourGaps, vanWarnings, type TourGap } from '@/lib/stats';
import { BuyRow, WaitingCard } from '@/components/buy';
import { comma, fmtTime, fwd, loc, t, tp } from '@/lib/i18n';
import { dueOn, routineName } from '@/components/routines';
import { vanAlias, vanName } from '@/lib/vans';

type Cat = 'all' | 'pump' | 'review' | 'missing' | 'warn' | 'chk' | 'due' | 'buys' | 'van' | 'done';

/**
 * The fleet manager's queue, by category: checks to decide, handovers and tours missing their video or photos,
 * warning lights on the dashboard, what falls due (vans and drivers), checks the driver is still taking close-ups
 * for, and the ones decided lately. Each category has its own colour and weight, so what needs action stands out
 * from what is only information.
 */
export default function ReviewQueue() {
  const s = useSession();
  const scopeKey = (peopleScope(s) || ['*']).join(',');
  const c = useColors();
  const [cat, setCat] = useState<Cat>('all');
  const [allDone, setAllDone] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const orgId = s.org?.id;
  // Names by account id: vans and checks keep only who, since drivers read them (lib/names.ts).
  const nameOf = useNameOf();
  // The automatic comparison: whose photos they were (nobody ran it); at a pick-up or drop-off they take the close-ups.
  const byOf = (k: Check) => (k.auto === 'compare' ? nameOf(k.walkBy) || null : nameOf(k.createdBy) || k.createdByName || null);
  useEffect(() => {
    if (!orgId || s.mode !== 'firebase' || !s.staff) return;
    return watchMembers(orgId, peopleScope(s), setMembers);
  }, [orgId, s.mode, s.staff, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Km typed lower than the van's in the last 7 days: the van kept its km (blind test, cause 2b).
  const lowKm = s.vehicles.filter((v) => v.kmLower && !v.retired && s.runs(v.stationId) && Date.now() - v.kmLower.at < 7 * 86400_000);
  // Inspections, service, tax, insurance and contract ends that are overdue or due soon, and the drivers' licence
  // checks, licences and safety briefings.
  const due = fleetDue(s.vehicles.filter((v) => s.runs(v.stationId)), s.details);
  // Service appointments in the next week, and the ones whose time has come and the service isn't filled in yet.
  const appts = openAppointments(s.appointments).filter((a) => s.runs(a.stationId) && apptState(a).days <= 7);
  const known = new Map([...s.assignments.map((a) => [a.driverId, a.driverName] as const), ...s.tours.map((t) => [t.driverId, t.driverName] as const)]);
  const pdue = peopleDue(s.records.filter((r) => s.runs(r.stationId)), members, s.org?.licenceCheckMonths || CHECK_MONTHS, Date.now(), known);
  // Drivers stopped at the pump (not the van's fuel card, or none), oldest first; and the last week's refuels,
  // washes and parts, the ones to check first.
  const pump = s.purchases.filter((p) => p.status === 'waiting' && s.runs(p.stationId) && (p.by !== s.user?.uid || s.tryOut)).sort((a, b) => (a.card.at || a.createdAt) - (b.card.at || b.createdAt));
  const weekAgo = Date.now() - 7 * 86400_000;
  const buys = s.purchases.filter((p) => p.status !== 'waiting' && s.runs(p.stationId) && p.createdAt > weekAgo && (p.status !== 'open' || Date.now() - p.createdAt > 6 * 3600_000))
    .sort((a, b) => (b.flags?.length ? 1 : 0) - (a.flags?.length ? 1 : 0) || b.createdAt - a.createdAt);
  // Checks for drivers due now (oldest first), and the problems drivers found in the last week.
  const todo = s.vehicles.filter((v) => s.runs(v.stationId)).flatMap((v) => dueOn(v).map((x) => ({ v, x }))).sort((a, b) => a.x.since - b.x.since);
  const problems = s.routineDone.filter((d) => !d.ok && s.runs(d.stationId) && d.at > Date.now() - 7 * 86400_000).sort((a, b) => b.at - a.at);
  const showStation = s.stations.length > 1;
  const alias = (vehicleId: string) => vanAlias(s.vehicles.find((v) => v.id === vehicleId));
  const where = (stationId: string | null | undefined) => (showStation ? s.stationName(stationId) : '');

  const color = { pump: c.alert, review: MARKER, missing: c.alert, warn: c.warn, chk: c.amber, due: c.amber, buys: c.ink, van: c.ink2, done: c.ok };
  const cats: [Exclude<Cat, 'all'>, string, number][] = [
    ...(pump.length ? [['pump', t('At the pump'), pump.length] as [Exclude<Cat, 'all'>, string, number]] : []),
    ['review', t('To review'), waiting.length], ['missing', t('Missing proof'), missing.length + gaps.length], ['warn', t('Warning lights'), warn.length + lowKm.length],
    ['chk', t('Checks for drivers'), todo.length + problems.length], ['due', t('Due soon'), appts.length + due.length + pdue.length], ['buys', t('Fuel, wash, parts'), buys.length], ['van', t('At the van'), atVan.length], ['done', t('Reviewed'), done.length],
  ];
  const show = (k: Exclude<Cat, 'all'>) => cat === 'all' || cat === k;
  const shownDone = allDone ? done : done.slice(0, 8);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">{t('Review')}</T>
        <T v="hint">{t('What needs your attention, most urgent first.')}</T>
      </View>

      {/* Every category at a glance; tap one to see only it. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {cats.map(([k, label, n]) => {
          const on = cat === k;
          return (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${label}${comma()}${n}`} onPress={() => setCat(on ? 'all' : k)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 10, paddingRight: 12, borderRadius: 4, borderWidth: 2,
                borderColor: c.ink, backgroundColor: on ? c.ink : c.paper, opacity: n || on ? 1 : 0.55 }}>
              <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: color[k], borderWidth: k === 'review' ? 1.5 : 0, borderColor: '#000' }} />
              <Text style={{ fontFamily: F.cond, fontSize: hs(18), color: on ? c.paper : c.ink }}>{label}</Text>
              <Text style={{ fontFamily: F.condBold, fontSize: hs(18), color: on ? c.paper : c.ink, fontVariant: ['tabular-nums'] }}>{n}</Text>
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
        <Section color={MARKER} title={t('To review')} count={waiting.length} note={t('Checks drivers sent, and new damage the AI found by comparing walk-arounds. Oldest first.')}>
          {!waiting.length ? <Empty text={t('Nothing to decide right now. Checks appear here when a driver sends one or the AI finds new damage.')} /> : null}
          {waiting.map((k) => <ToReview key={k.id} k={k} van={s.vanName(k)} alias={alias(k.vehicleId)} where={where(k.stationId)} />)}
        </Section>
      ) : null}

      {show('missing') && (missing.length || gaps.length || cat === 'missing') ? (
        <Section color={c.alert} title={t('Missing proof')} count={missing.length + gaps.length} note={s.org?.dashScans
          ? t('Handovers without their video or photos, and tours without the dashboard photo. Open the van to add them or see its history.')
          : t('Handovers without their video or photos. Open the van to add them or see its history.')}>
          {!missing.length && !gaps.length ? <Empty text={t('Every handover has its video or photos.')} /> : null}
          {missing.map((m) => <MissingCard key={`${m.a.id}-${m.what}`} m={m} van={s.vanName(m.a)} alias={alias(m.a.vehicleId)} where={where(m.a.stationId)} />)}
          {gaps.map((g) => <GapCard key={`${g.vehicleId}-${g.driverId}-${g.at}-${g.kind}`} g={g} van={s.vanName(g)} alias={alias(g.vehicleId)} where={where(g.stationId)} />)}
        </Section>
      ) : null}

      {show('warn') && (warn.length || cat === 'warn') ? (
        <Section color={c.warn} title={t('Warning lights')} count={warn.length} note={t('Lit on a van\'s latest dashboard photo, in the last 3 days. Check the van before it goes out again.')}>
          {!warn.length ? <Empty text={t('No warning lights on the latest dashboard photos.')} /> : null}
          {warn.map((tour) => <WarnCard key={tour.id} tour={tour} van={s.vanName(tour)} alias={alias(tour.vehicleId)} where={where(tour.stationId)} />)}
        </Section>
      ) : null}

      {show('warn') && lowKm.length ? (
        <Section color={c.warn} title={t('Odometer lower than the van\'s')} count={lowKm.length} note={t('Typed lower than the van\'s km in the last 7 days. The van kept its km: check the odometer, or correct the km on the van\'s page.')}>
          {lowKm.map((v) => <LowKmCard key={v.id} v={v} />)}
        </Section>
      ) : null}

      {show('chk') && (todo.length || problems.length || cat === 'chk') ? (
        <Section color={c.amber} title={t('Checks for drivers')} count={todo.length + problems.length} note={t('Checks drivers haven\'t done yet (red after 3 hours), and problems they found in the last 7 days.')}>
          <List>
            {!todo.length && !problems.length ? <T v="hint">{t('Every check is done.')}</T> : null}
            {problems.map((d, i) => (
              <ListRow key={d.id} first={i === 0} onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: d.vehicleId, tab: 'details' } })}
                title={`${s.vanName(d)} – ${routineName(d)}`} line={[`${d.byName}: ${d.note || ''}`, fmtWhen(d.at), where(d.stationId)].filter(Boolean).join(comma())}
                right={<Pill v="bad" text={t('Problem')} />} />
            ))}
            {todo.map(({ v, x }, i) => (
              <ListRow key={`${v.id}-${x.id}`} first={i === 0 && !problems.length} onPress={() => router.push(`/vehicle/${v.id}`)}
                title={`${vanName(v)} – ${routineName(x)}`} line={[v.assignedTo ? nameOf(v.assignedTo.driverId) || v.assignedTo.driverName || '' : '', t('due since {when}', { when: fmtWhen(x.since) }), where(v.stationId)].filter(Boolean).join(comma())}
                right={<Pill v={Date.now() - x.since > 3 * 3600_000 ? 'bad' : 'amber'} text={dur(Date.now() - x.since)} />} />
            ))}
          </List>
          <Pressable accessibilityRole="button" onPress={() => router.push('/checks')}><T v="small" style={{ textDecorationLine: 'underline' }}>{t('See and change checks')}</T></Pressable>
        </Section>
      ) : null}

      {show('due') && (appts.length || due.length || pdue.length || cat === 'due') ? (
        <Section color={c.amber} title={t('Due soon')} count={appts.length + due.length + pdue.length} note={t('Inspections, service, tax, insurance and contract ends; drivers\' licence checks, licences and safety briefings. In the next weeks, or overdue.')}>
          <List>
            {!appts.length && !due.length && !pdue.length ? <T v="hint">{t('Nothing due in the next weeks.')}</T> : null}
            {appts.map((a, i) => {
              const st = apptState(a);
              return (
                <ListRow key={`appt-${a.id}`} first={i === 0} onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: a.vehicleId, tab: 'service' } })}
                  title={`${s.vanName(a)} – ${t('Appointment: {what}', { what: serviceName(a) })}`} line={[apptWhen(a), a.garage || '', where(a.stationId)].filter(Boolean).join(comma())}
                  right={<Pill v={st.v === 'default' ? 'amber' : st.v} text={st.text} />} />
              );
            })}
            {pdue.map(({ uid, name, stationId, x }, i) => (
              <ListRow key={`${uid}-${x.key}`} first={i === 0 && !appts.length} onPress={() => router.push({ pathname: '/person/[uid]', params: { uid, tab: 'record' } })}
                title={`${name} – ${x.label}`} line={[x.day ? fmtDay(x.day) : '', where(stationId)].filter(Boolean).join(comma())}
                right={<Pill v={x.state === 'overdue' ? 'bad' : 'amber'} text={x.note} />} />
            ))}
            {due.map(({ v, x }, i) => (
              <ListRow key={`${v.id}-${x.key}`} first={i === 0 && !pdue.length && !appts.length} onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: v.id, tab: ['hu', 'service', 'serviceKm', 'tyres'].includes(x.key) ? 'service' : 'details' } })}
                title={`${vanName(v)} – ${x.label}`} line={[x.day ? fmtDay(x.day, x.key === 'hu') : '', where(v.stationId)].filter(Boolean).join(comma())}
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
                title={byOf(k) ? `${byOf(k)} – ${s.vanName(k)}` : s.vanName(k)} line={[t('started {time} ago', { time: dur(Date.now() - k.createdAt) }),
                  k.closeupBy ? t('to the review by {time} at the latest', { time: fmtTime(k.closeupBy) }) : '', where(k.stationId)].filter(Boolean).join(comma())}
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
                  title={byOf(k) ? `${byOf(k)} – ${s.vanName(k)}` : s.vanName(k)}
                  line={[k.review?.byName ? t('reviewed by {name}', { name: k.review.byName }) : '', k.review?.at ? fmtWhen(k.review.at) : '', where(k.stationId)].filter(Boolean).join(comma())}
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
            <Text style={{ fontFamily: F.condBold, fontSize: hs(16), color: count ? c.paper : c.ink, fontVariant: ['tabular-nums'] }}>{count}</Text>
          </View>
        </View>
        <T v="small" style={{ paddingLeft: 16 }}>{note}</T>
      </View>
      {children}
    </View>
  );
}

/** An item that needs action: a card with the category's colour down its left edge. */
/** Km typed lower than the van's: who typed what, and the km the van kept. */
function LowKmCard({ v }: { v: Vehicle }) {
  const s = useSession();
  const whoDid = useWhoDid();
  const c = useColors();
  const k = v.kmLower!;
  const text = t('{name} typed {km} km; the van had {kept} km and keeps them.', { name: whoDid(k.by) || t('A driver'), km: k.typed.toLocaleString(loc()), kept: k.kept.toLocaleString(loc()) });
  return (
    <ActionCard band={c.warn} onPress={() => router.push(`/vehicle/${v.id}`)} label={`${s.vanName(v)}: ${text}`}>
      <T v="medium">{s.vanName(v)}</T>
      <T v="small">{text}</T>
      <T v="small">{fmtWhen(k.at)}</T>
    </ActionCard>
  );
}

function ActionCard({ band, alert, onPress, label, children }: { band: string; alert?: boolean; onPress: () => void; label: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', backgroundColor: c.paper, borderWidth: 2, borderColor: alert ? c.alert : c.ink, borderRadius: 4, overflow: 'hidden', opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 10, backgroundColor: band, borderRightWidth: band === MARKER ? 2 : 0, borderColor: '#000' }} />
      <View style={{ flex: 1, padding: 12, gap: 6 }}>{children}</View>
      <View style={{ justifyContent: 'center', paddingRight: 12 }}><T v="h2" color={c.ink2}>{fwd()}</T></View>
    </Pressable>
  );
}

function ToReview({ k, van, alias, where }: { k: Check; van: string; alias: string; where: string }) {
  const c = useColors();
  const sent = k.submittedAt || k.createdAt;
  const aiDamage = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
  const long = Date.now() - sent > 2 * 3600_000;
  const nameOf = useNameOf();
  // The automatic comparison: whose photos they were (nobody ran it).
  const auto = k.auto === 'compare';
  const by = auto ? nameOf(k.walkBy) || null : nameOf(k.createdBy) || k.createdByName || null;
  // The comparison's own answer, and (at a pick-up or drop-off) what the driver's close-ups showed.
  const cmpN = auto ? k.spots.filter((p) => (p.cmp?.verdict || p.verdict?.verdict) === 'damage').length : 0;
  const shot = auto ? k.spots.filter((p) => p.closeups?.length) : [];
  const shotN = shot.filter((p) => p.verdict?.verdict === 'damage').length;
  return (
    <ActionCard band={MARKER} onPress={() => router.push(`/check/${k.id}`)} label={by ? t('Review {name}, {van}', { name: by, van: van }) : t('Review {van}', { van: van })}>
      <Text style={{ fontFamily: F.condBold, fontSize: hs(21), lineHeight: hs(25), color: c.ink }}>{by ? `${by} – ${van}` : van}</Text>
      <Row>
        {alias ? <T v="hint">{alias}</T> : null}
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: long ? c.amber : c.ink }}>{t('Waiting {time}', { time: dur(Date.now() - sent) })}</Text>
        {where ? <T v="hint">{where}</T> : null}
      </Row>
      <Row gap={6}>
        {auto ? <Pill v="solid" text={k.walkKind === 'pickup' ? t('Pick-up photos') : k.walkKind === 'dropoff' ? t('Drop-off photos') : t('Walk-around')} /> : null}
        <Pill text={tp(k.spots.length, '{n} spot', '{n} spots')} />
        {auto ? <Pill v={cmpN ? 'bad' : 'amber'} text={cmpN ? tp(cmpN, 'AI comparison: {n} new damage', 'AI comparison: {n} new damages') : t('AI comparison: not sure')} />
          : <Pill v={aiDamage ? 'bad' : 'good'} text={aiDamage ? tp(aiDamage, 'AI found {n} damage', 'AI found {n} damages') : t('AI found no damage')} />}
        {auto && shot.length ? <Pill v={shotN ? 'bad' : 'good'} text={shotN ? tp(shotN, 'Close-ups: {n} damage', 'Close-ups: {n} damages') : t('Close-ups: no damage')} />
          : auto && k.closeupBy ? <Pill v="amber" text={t('No close-ups')} /> : null}
        {k.missedNote ? <Pill v="amber" text={t('Note from the driver')} /> : null}
      </Row>
    </ActionCard>
  );
}

function MissingCard({ m, van, alias, where }: { m: Missing; van: string; alias: string; where: string }) {
  const c = useColors();
  const { a, what } = m;
  // A takeover keeps no name of who took it over (the driver who had it reads it): from the company's names.
  const nameOf = useNameOf();
  const ended = a.endedByName || nameOf(a.endedBy);
  const problem = what === 'no-pickup' ? t('No pick-up video') : what === 'still-out' ? t('Not dropped off') : t('No drop-off video');
  const since = what === 'no-pickup' ? t('{time} since it was given', { time: dur(Date.now() - a.start) }) : what === 'still-out' ? t('out for {time}', { time: dur(Date.now() - a.start) }) : '';
  // The driver it's about comes first; the line below says what happened.
  const detail = what === 'no-pickup' ? t('Given by {name}, {when}', { name: a.startedByName, when: fmtWhen(a.start) })
    : what === 'still-out' ? t('Has had it since {when}', { when: fmtWhen(a.start) })
      : a.endReason === 'taken over' ? (ended ? t('Had it until {when}, then {name} took it over', { when: fmtWhen(a.end), name: ended }) : t('Had it until {when}, then another driver took it over', { when: fmtWhen(a.end) }))
        : ended ? t('Had it until {when}, ended by {name}', { when: fmtWhen(a.end), name: ended }) : t('Had it until {when}', { when: fmtWhen(a.end) });
  return (
    <ActionCard band={c.alert} alert onPress={() => router.push(`/vehicle/${a.vehicleId}`)} label={`${a.driverName}${comma()}${problem}: ${van}`}>
      <Text style={{ fontFamily: F.condBold, fontSize: hs(21), lineHeight: hs(25), color: c.ink }}>
        {a.driverName}<Text style={{ color: c.alert }}>{` – ${problem}`}</Text>
      </Text>
      {since ? <Text style={{ fontFamily: F.semi, fontSize: 14, color: c.alert, marginTop: -4 }}>{since}</Text> : null}
      <Row>
        <T v="h3">{van}</T>
        {alias ? <T v="hint">{alias}</T> : null}
      </Row>
      <T v="hint">{[detail, where].filter(Boolean).join(comma())}</T>
    </ActionCard>
  );
}

/** A tour missing its dashboard photo: the driver first, then the van. */
function GapCard({ g, van, alias, where }: { g: TourGap; van: string; alias: string; where: string }) {
  const c = useColors();
  const problem = g.kind === 'no-end' ? t('No end-of-tour photo') : g.kind === 'no-start' ? t('No start-of-tour photo') : t('On tour for {time}', { time: dur(Date.now() - g.at) });
  const detail = g.kind === 'no-end' ? t('Tour started {when}; the kilometres are an estimate, no fuel figure', { when: fmtWhen(g.at) })
    : g.kind === 'no-start' ? t('Had the van since {when}', { when: fmtWhen(g.at) }) : t('Started {when}, no end photo yet', { when: fmtWhen(g.at) });
  return (
    <ActionCard band={c.alert} alert onPress={() => router.push(`/vehicle/${g.vehicleId}`)} label={`${g.driverName}${comma()}${problem}: ${van}`}>
      <Text style={{ fontFamily: F.condBold, fontSize: hs(21), lineHeight: hs(25), color: c.ink }}>
        {g.driverName}<Text style={{ color: c.alert }}>{` – ${problem}`}</Text>
      </Text>
      <Row>
        <T v="h3">{van}</T>
        {alias ? <T v="hint">{alias}</T> : null}
      </Row>
      <T v="hint">{[detail, where].filter(Boolean).join(comma())}</T>
    </ActionCard>
  );
}

/** A warning light on a van's dashboard: the van first, then who saw it and when. */
function WarnCard({ tour, van, alias, where }: { tour: Tour; van: string; alias: string; where: string }) {
  const c = useColors();
  const at = tour.end?.at || tour.startAt;
  return (
    <ActionCard band={c.warn} onPress={() => router.push(`/vehicle/${tour.vehicleId}`)} label={t('{van}, warning light: {lights}', { van: van, lights: tour.warnings.map((w) => t(w)).join(comma()) })}>
      <Text style={{ fontFamily: F.condBold, fontSize: hs(21), lineHeight: hs(25), color: c.ink }}>
        {van}<Text style={{ color: c.warn }}>{` – ${tour.warnings.map((w) => t(w)).join(comma())}`}</Text>
      </Text>
      <Row>
        {alias ? <T v="hint">{alias}</T> : null}
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: c.warn }}>{t('{time} ago', { time: dur(Date.now() - at) })}</Text>
      </Row>
      <T v="hint">{[tour.end ? t('On {name}\'s end photo, {when}', { name: tour.driverName, when: fmtWhen(at) }) : t('On {name}\'s start photo, {when}', { name: tour.driverName, when: fmtWhen(at) }), where].filter(Boolean).join(comma())}</T>
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
        <T v="medium" numberOfLines={3}>{title}</T>
        <T v="small" numberOfLines={2}>{line}</T>
      </View>
      {right}
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  return <Card dashed><T v="hint">{text}</T></Card>;
}
