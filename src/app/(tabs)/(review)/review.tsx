import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Card, Pill, Row, Screen, T, fmtWhen, useColors } from '@/components/ui';
import { dur } from '@/components/history';
import { useSession } from '@/lib/session';
import { approvedDamage, type Check } from '@/lib/types';
import { missingHandovers } from '@/lib/videos';

/** Damage checks waiting for a fleet manager's decision, then the ones decided lately. */
export default function ReviewQueue() {
  const s = useSession();
  const c = useColors();
  if (!s.staff) return <Screen><T v="h1">Review</T><Card dashed><T v="hint">Fleet managers and owners review damage checks.</T></Card></Screen>;
  const mine = s.checks.filter((k) => s.runs(k.stationId));
  const waiting = mine.filter((k) => k.status === 'submitted').sort((a, b) => (a.submittedAt || a.createdAt) - (b.submittedAt || b.createdAt));
  const pending = mine.filter((k) => k.status === 'checking');
  const done = mine.filter((k) => k.status === 'reviewed').slice(0, 30);
  const showStation = s.stations.length > 1;
  // Handovers in the last 7 days without the driver's pick-up or drop-off video or photos, and vans still out after a shift.
  const missing = missingHandovers(s.assignments.filter((a) => s.runs(a.stationId)), s.videos, s.walks, s.stations, Date.now() - 7 * 86400_000);

  const row = (k: Check, line: string, pill?: React.ReactNode) => (
    <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)}
      style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 4 }}>
      <Row><T v="h3" style={{ flex: 1 }}>{k.vehicleName}</T>{pill}</Row>
      <T v="hint">{line}</T>
    </Pressable>
  );

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">Review</T>
        <T v="hint">Drivers send damage checks here. You decide each spot: damage or not. Your decision is final and goes on the van&apos;s record.</T>
      </View>
      {missing.length ? (
        <>
          <T v="h2">Missing handover videos ({missing.length})</T>
          <T v="hint">A van you give a driver needs their pick-up video or photos within 2 hours. At stations where drivers pick up vans themselves, every drop-off needs them too. Open the van to see its history or add the video yourself.</T>
          {missing.map(({ a, what }) => (
            <Pressable key={a.id} onPress={() => router.push(`/vehicle/${a.vehicleId}`)}
              style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.alert, borderRadius: 4, padding: 12, gap: 4 }}>
              <Row><T v="h3" style={{ flex: 1 }}>{a.vehicleName}</T><Pill v="bad" text={what === 'still-out' ? 'Not dropped off' : what === 'no-pickup' ? 'No pick-up video' : 'No drop-off video'} /></Row>
              <T v="hint">{what === 'no-pickup'
                ? [`${a.startedByName} gave it to ${a.driverName} ${fmtWhen(a.start)}`, `no pick-up video or photos after ${dur(Date.now() - a.start)}`, showStation ? s.stationName(a.stationId) : ''].filter(Boolean).join(', ')
                : what === 'still-out'
                ? `${a.driverName} has had it for ${dur(Date.now() - a.start)}, since ${fmtWhen(a.start)}`
                : [`${a.driverName} had it until ${fmtWhen(a.end)}`, a.endReason === 'taken over' ? `then ${a.endedByName || 'another driver'} took it over` : a.endedByName ? `ended by ${a.endedByName}` : '',
                  showStation ? s.stationName(a.stationId) : ''].filter(Boolean).join(', ')}</T>
            </Pressable>
          ))}
        </>
      ) : null}
      <T v="h2">Waiting for you ({waiting.length})</T>
      {!waiting.length ? <Card dashed><T v="hint">Nothing to review right now.</T></Card> : null}
      {waiting.map((k) => {
        const aiDamage = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
        return row(k, [
          `${k.spots.length} spot${k.spots.length === 1 ? '' : 's'}, ${aiDamage} damage by the AI`,
          k.createdByName ? `from ${k.createdByName}` : '',
          showStation ? s.stationName(k.stationId) : '',
          `sent ${fmtWhen(k.submittedAt || k.createdAt)}`,
        ].filter(Boolean).join(', '), <Pill v="amber" text="To review" />);
      })}
      {pending.length ? (
        <>
          <T v="h2">Close-ups pending ({pending.length})</T>
          <T v="hint">The driver is still taking close-ups.</T>
          {pending.map((k) => row(k, [k.createdByName ? `${k.createdByName}` : '', showStation ? s.stationName(k.stationId) : '', fmtWhen(k.createdAt)].filter(Boolean).join(', '), <Pill v="muted" text="At the van" />))}
        </>
      ) : null}
      {done.length ? (
        <>
          <T v="h2">Reviewed</T>
          {done.map((k) => {
            const n = approvedDamage(k).length;
            return row(k, [k.review?.byName ? `by ${k.review.byName}` : '', k.review?.at ? fmtWhen(k.review.at) : '', showStation ? s.stationName(k.stationId) : ''].filter(Boolean).join(', '),
              <Pill v={n ? 'bad' : 'good'} text={n ? `${n} damage${n === 1 ? '' : 's'}` : 'No damage'} />);
          })}
        </>
      ) : null}
    </Screen>
  );
}
