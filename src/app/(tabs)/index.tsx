import { router } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Card, Notice, Plate, Screen, Svg, T, fmtWhen, useColors } from '@/components/ui';
import { CLS, makeSpec, silhouetteSVG } from '@/lib/frames';
import { useSession } from '@/lib/session';

export default function Fleet() {
  const s = useSession();
  const c = useColors();
  const count = s.vehicles.length;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="h1">Fleet</T>
          <T v="hint">{s.mode === 'local' ? 'Test mode' : s.org?.name}{s.loaded.vehicles ? `, ${count === 1 ? '1 vehicle' : count + ' vehicles'}` : ''}{s.mode === 'local' ? ', saved on this phone' : ''}</T>
        </View>
        <Button small title="Add vehicle" onPress={() => router.push('/add')} />
      </View>
      {s.dataError ? <Notice tone="bad" text={s.dataError} /> : null}
      {!s.loaded.vehicles ? <ActivityIndicator color={c.ink} style={{ marginTop: 24 }} /> : null}
      {s.loaded.vehicles && !count ? (
        <Card dashed>
          <T v="hint">No vehicles yet. Add one by scanning it or picking its type. Each vehicle keeps its own photo frames, walk-arounds and damage checks.</T>
          <Button v="primary" title="Add vehicle" onPress={() => router.push('/add')} />
        </Card>
      ) : null}
      {s.vehicles.map((v) => {
        if (!CLS[v.cls]) return null;
        const sp = makeSpec(v.cls, v);
        const last = s.walks.find((w) => w.vehicleId === v.id);
        return (
          <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.name}, ${CLS[v.cls].name}`} onPress={() => router.push(`/vehicle/${v.id}`)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, opacity: pressed ? 0.8 : 1 })}>
            <Svg xml={silhouetteSVG(sp, 104, false, c.ink2)} width={104} height={49} />
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <T v="h3" numberOfLines={2}>{v.name}</T>
              {v.plate ? <Plate text={v.plate} /> : null}
              <T v="hint">{CLS[v.cls].name}</T>
              <T v="hint">{last ? 'Last walk-around ' + fmtWhen(last.createdAt) : 'No walk-around yet'}</T>
            </View>
            <T v="h2" color={c.ink2}>›</T>
          </Pressable>
        );
      })}
    </Screen>
  );
}
