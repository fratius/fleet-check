import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Card, Pill, Row, Screen, T, fmtWhen, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';
import { approvedDamage, type Check } from '@/lib/types';

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
