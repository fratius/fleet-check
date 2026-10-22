import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Card, F, MARKER, Pill, Plate, Row, Screen, T, fmtWhen, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';
import { approvedDamage, type Check } from '@/lib/types';
import { missingHandovers, type Missing } from '@/lib/videos';

type Cat = 'all' | 'review' | 'missing' | 'van' | 'done';

/**
 * The fleet manager's queue, by category: checks to decide, handovers missing their video or photos, checks the
 * driver is still taking close-ups for, and the ones decided lately. Each category has its own colour and weight,
 * so what needs action stands out from what is only information.
 */
export default function ReviewQueue() {
  const s = useSession();
  const c = useColors();
  const [cat, setCat] = useState<Cat>('all');
  const [allDone, setAllDone] = useState(false);
  if (!s.staff) return <Screen><T v="h1">Review</T><Card dashed><T v="hint">Fleet managers and owners review damage checks.</T></Card></Screen>;
  const mine = s.checks.filter((k) => s.runs(k.stationId));
  const waiting = mine.filter((k) => k.status === 'submitted').sort((a, b) => (a.submittedAt || a.createdAt) - (b.submittedAt || b.createdAt));
  const atVan = mine.filter((k) => k.status === 'checking');
  const done = mine.filter((k) => k.status === 'reviewed');
  // Handovers in the last 7 days without the driver's pick-up or drop-off video or photos, and vans still out after a shift.
  const missing = missingHandovers(s.assignments.filter((a) => s.runs(a.stationId)), s.videos, s.walks, s.stations, Date.now() - 7 * 86400_000);
  const showStation = s.stations.length > 1;
  const plate = (vehicleId: string) => s.vehicles.find((v) => v.id === vehicleId)?.plate || '';
  const where = (stationId: string | null | undefined) => (showStation ? s.stationName(stationId) : '');

  const color = { review: MARKER, missing: c.alert, van: c.ink2, done: c.ok };
  const cats: [Exclude<Cat, 'all'>, string, number][] = [
    ['review', 'To review', waiting.length], ['missing', 'Missing videos', missing.length], ['van', 'At the van', atVan.length], ['done', 'Reviewed', done.length],
  ];
  const show = (k: Exclude<Cat, 'all'>) => cat === 'all' || cat === k;
  const shownDone = allDone ? done : done.slice(0, 8);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">Review</T>
        <T v="hint">You decide each spot the AI found. Your decision is final and goes on the van&apos;s record.</T>
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

      {show('review') ? (
        <Section color={MARKER} title="To review" count={waiting.length} note="Checks drivers sent. Oldest first.">
          {!waiting.length ? <Empty text="Nothing to decide right now. Checks appear here when a driver sends one." /> : null}
          {waiting.map((k) => <ToReview key={k.id} k={k} plate={plate(k.vehicleId)} where={where(k.stationId)} />)}
        </Section>
      ) : null}

      {show('missing') && (missing.length || cat === 'missing') ? (
        <Section color={c.alert} title="Missing videos" count={missing.length} note="Handovers without their video or photos. Open the van to add them or see its history.">
          {!missing.length ? <Empty text="Every handover has its video or photos." /> : null}
          {missing.map((m) => <MissingCard key={`${m.a.id}-${m.what}`} m={m} plate={plate(m.a.vehicleId)} where={where(m.a.stationId)} />)}
        </Section>
      ) : null}

      {show('van') && (atVan.length || cat === 'van') ? (
        <Section color={c.ink2} title="At the van" count={atVan.length} note="The driver is still taking close-ups.">
          <List>
            {!atVan.length ? <T v="hint">No driver is at a van right now.</T> : null}
            {atVan.map((k, i) => (
              <ListRow key={k.id} first={i === 0} onPress={() => router.push(`/check/${k.id}`)}
                title={k.vehicleName} line={[k.createdByName, `started ${dur(Date.now() - k.createdAt)} ago`, where(k.stationId)].filter(Boolean).join(', ')}
                right={<Pill v="muted" text={`${k.spots.filter((p) => p.verdict).length} of ${k.spots.length} spots`} />} />
            ))}
          </List>
        </Section>
      ) : null}

      {show('done') && (done.length || cat === 'done') ? (
        <Section color={c.ok} title="Reviewed" count={done.length} note="Decided lately, newest first.">
          <List>
            {!done.length ? <T v="hint">Nothing reviewed yet.</T> : null}
            {shownDone.map((k, i) => {
              const n = approvedDamage(k).length;
              return (
                <ListRow key={k.id} first={i === 0} onPress={() => router.push(`/check/${k.id}`)}
                  title={k.vehicleName} line={[k.review?.byName, k.review?.at ? fmtWhen(k.review.at) : '', where(k.stationId)].filter(Boolean).join(', ')}
                  right={<Pill v={n ? 'bad' : 'good'} text={n ? `${n} damage${n === 1 ? '' : 's'}` : 'No damage'} />} />
              );
            })}
            {done.length > shownDone.length ? (
              <Pressable accessibilityRole="button" onPress={() => setAllDone(true)} style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <T v="medium" style={{ textDecorationLine: 'underline' }}>Show all {done.length}</T>
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
    <ActionCard band={MARKER} onPress={() => router.push(`/check/${k.id}`)} label={`Review ${k.vehicleName}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="h2" style={{ flexShrink: 1 }} numberOfLines={1}>{k.vehicleName}</T>
        <View style={{ flex: 1 }} />
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: long ? c.amber : c.ink }}>Waiting {dur(Date.now() - sent)}</Text>
      </View>
      <Row>
        {plate ? <Plate text={plate} /> : null}
        <T v="hint">{['from ' + (k.createdByName || 'a driver'), where].filter(Boolean).join(', ')}</T>
      </Row>
      <Row gap={6}>
        <Pill text={`${k.spots.length} spot${k.spots.length === 1 ? '' : 's'}`} />
        <Pill v={aiDamage ? 'bad' : 'good'} text={aiDamage ? `AI found ${aiDamage} damage${aiDamage === 1 ? '' : 's'}` : 'AI found no damage'} />
        {k.missedNote ? <Pill v="amber" text="Note from the driver" /> : null}
      </Row>
    </ActionCard>
  );
}

function MissingCard({ m, plate, where }: { m: Missing; plate: string; where: string }) {
  const c = useColors();
  const { a, what } = m;
  const problem = what === 'no-pickup' ? 'No pick-up video' : what === 'still-out' ? 'Not dropped off' : 'No drop-off video';
  const since = what === 'no-pickup' ? `${dur(Date.now() - a.start)} since it was given` : what === 'still-out' ? `out for ${dur(Date.now() - a.start)}` : '';
  const detail = what === 'no-pickup' ? `${a.startedByName} gave it to ${a.driverName}, ${fmtWhen(a.start)}`
    : what === 'still-out' ? `${a.driverName} has had it since ${fmtWhen(a.start)}`
      : [`${a.driverName} had it until ${fmtWhen(a.end)}`, a.endReason === 'taken over' ? `then ${a.endedByName || 'another driver'} took it over` : a.endedByName ? `ended by ${a.endedByName}` : ''].filter(Boolean).join(', ');
  return (
    <ActionCard band={c.alert} alert onPress={() => router.push(`/vehicle/${a.vehicleId}`)} label={`${problem}: ${a.vehicleName}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Text style={{ fontFamily: F.condBold, fontSize: 21, color: c.alert }}>{problem}</Text>
        {since ? <Text style={{ fontFamily: F.semi, fontSize: 14, color: c.alert }}>{since}</Text> : null}
      </View>
      <Row>
        <T v="h3">{a.vehicleName}</T>
        {plate ? <Plate text={plate} /> : null}
      </Row>
      <T v="hint">{[detail, where].filter(Boolean).join(', ')}</T>
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
        <T v="medium" numberOfLines={1}>{title}</T>
        <T v="small" numberOfLines={1}>{line}</T>
      </View>
      {right}
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  return <Card dashed><T v="hint">{text}</T></Card>;
}
