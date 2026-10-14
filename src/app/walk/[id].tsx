import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { BackBar } from '@/components/nav';
import { Button, Card, Screen, ZoomPhoto, Stat, Stats, T, fmtWhen, mmss, secs, usd, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function WalkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useSession();
  const c = useColors();
  const { width } = useWindowDimensions();
  const w = s.walks.find((x) => x.id === id);
  if (!w) return <Screen><BackBar title="Back" /><Card dashed><T v="hint">{s.loaded.walks ? 'This walk-around was deleted.' : 'Loading…'}</T></Card></Screen>;
  const checks = s.checks.filter((k) => k.walkId === w.id);
  const tile = (Math.min(width, 760) - 32 - 20) / 3;
  return (
    <Screen>
      <BackBar title={w.vehicleName} onPress={() => router.replace(`/vehicle/${w.vehicleId}`)} />
      <View style={{ gap: 4 }}>
        <T v="hint">{w.source === 'library' ? 'Photos from the library' : 'Walk-around'}, {w.vehicleName}</T>
        <T v="h1">{fmtWhen(w.createdAt)}</T>
      </View>
      <Stats>
        <Stat value={w.totalMs ? mmss(w.totalMs) : '–'} label="total time" />
        <Stat value={`${w.taken}/${w.frames}`} label={`photos${w.skipped ? `, ${w.skipped} skipped` : ''}`} />
        <Stat value={String(w.retakes)} label="retakes" />
      </Stats>
      {s.mode === 'firebase' ? (
        <View style={{ backgroundColor: '#E2FF1C', borderRadius: 4, padding: 14, gap: 8 }}>
          <Button v="primary" wide title={checks.length ? 'Check for damage again' : 'Check for damage'}
            onPress={() => router.push({ pathname: '/check/[id]', params: { id: 'new', walk: w.id } })} />
          <T v="medium" color="#000" style={{ fontSize: 14 }}>The AI marks possible damage, then asks for close-ups of each spot.</T>
        </View>
      ) : <T v="hint">Damage checks need the Firebase backend.</T>}
      {checks.map((k) => {
        const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
        return (
          <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="h3">Check: {k.spots.length} spot{k.spots.length === 1 ? '' : 's'}, {dmg} damage</T>
            <T v="hint">{[k.pass1 ? `found in ${secs(k.pass1.ms)}` : '', usd((k.pass1?.cost || 0) + (k.pass2?.cost || 0)) + ' est.', fmtWhen(k.createdAt)].filter(Boolean).join(', ')}</T>
          </Pressable>
        );
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {w.photos.map((p) => (
          <View key={p.n} style={{ width: tile, gap: 4 }}>
            <ZoomPhoto src={p} caption={`${p.n}. ${p.label}`} style={{ width: tile, height: (tile * 4) / 3 }} />
            <T v="small" numberOfLines={2}>{p.n}. {p.label}</T>
          </View>
        ))}
      </View>
    </Screen>
  );
}
