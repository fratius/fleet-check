import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Card, Chip, Notice, Pill, Plate, Row, Screen, Svg, T, fmtWhen, useColors } from '@/components/ui';
import { CLS, makeSpec, silhouetteSVG } from '@/lib/frames';
import { useSession } from '@/lib/session';
import { ROLE_NAME, approvedDamage, type Check } from '@/lib/types';

export default function Fleet() {
  const s = useSession();
  const c = useColors();
  const [only, setOnly] = useState<string | null>(null);
  const showStations = s.myStations.length > 1;
  const vans = s.vehicles.filter((v) => !only || v.stationId === only);
  const count = vans.length;
  const canAdd = s.staff && (s.role === 'owner' || s.myStations.some((st) => s.runs(st.id)));
  const where = s.mode === 'local' ? 'Test mode, saved on this phone'
    : [s.org?.name, s.role === 'owner' ? (s.stations.length === 1 ? s.stations[0].name : `${s.stations.length} stations`) : s.myStations.map((st) => st.name).join(', ')].filter(Boolean).join(', ');

  // Latest check per van, for the status line.
  const lastCheck = new Map<string, Check>();
  s.checks.forEach((k) => { if (!lastCheck.has(k.vehicleId)) lastCheck.set(k.vehicleId, k); });

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="h1">{s.staff ? 'Fleet' : 'Vans'}</T>
          <T v="hint">{where}{s.loaded.vehicles ? `, ${count === 1 ? '1 van' : count + ' vans'}` : ''}</T>
        </View>
        {canAdd ? <Button small title="Add vehicle" onPress={() => router.push('/add')} /> : null}
      </View>
      {s.creator && s.role === 'owner' && !s.companies.some((x) => x.id === s.org?.id) ? <Notice text={`You're viewing ${s.org?.name} as the app creator.`} /> : null}
      {s.dataError ? <Notice tone="bad" text={s.dataError} /> : null}
      {showStations ? (
        <Row>
          <Chip text="All stations" on={!only} onPress={() => setOnly(null)} />
          {s.myStations.map((st) => <Chip key={st.id} text={st.name} on={only === st.id} onPress={() => setOnly(st.id)} />)}
        </Row>
      ) : null}
      {!s.loaded.vehicles ? <ActivityIndicator color={c.ink} style={{ marginTop: 24 }} /> : null}
      {s.loaded.vehicles && !count ? (
        <Card dashed>
          {canAdd ? (
            <>
              <T v="hint">No vans here yet. Add one by scanning it or picking its type. Each van keeps its own photo frames, walk-arounds and damage record.</T>
              <Button v="primary" title="Add vehicle" onPress={() => router.push('/add')} />
            </>
          ) : (
            <T v="hint">{s.myStations.length ? `No vans at ${s.myStations.map((st) => st.name).join(', ')} yet. Your fleet manager adds them.` : `You're signed in as a ${ROLE_NAME[s.role || 'driver'].toLowerCase()} but not at a station yet. Ask your fleet manager to add you to one.`}</T>
          )}
        </Card>
      ) : null}
      {vans.map((v) => {
        if (!CLS[v.cls]) return null;
        const sp = makeSpec(v.cls, v);
        const last = s.walks.find((w) => w.vehicleId === v.id);
        const k = lastCheck.get(v.id);
        const damages = s.checks.filter((x) => x.vehicleId === v.id).reduce((n, x) => n + approvedDamage(x).length, 0);
        return (
          <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.name}, ${CLS[v.cls].name}`} onPress={() => router.push(`/vehicle/${v.id}`)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, opacity: pressed ? 0.8 : 1 })}>
            <Svg xml={silhouetteSVG(sp, 104, false, c.ink2)} width={104} height={49} />
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <T v="h3" numberOfLines={2}>{v.name}</T>
              {v.plate ? <Plate text={v.plate} /> : null}
              <T v="hint">{[CLS[v.cls].name, showStations ? s.stationName(v.stationId) : ''].filter(Boolean).join(', ')}</T>
              <T v="hint">{last ? 'Last walk-around ' + fmtWhen(last.createdAt) : 'No walk-around yet'}</T>
              <Row gap={6}>
                {k?.status === 'submitted' ? <Pill v="amber" text="Waiting for review" /> : null}
                {k?.status === 'checking' ? <Pill v="muted" text="Close-ups pending" /> : null}
                {damages ? <Pill v="bad" text={`${damages} approved damage${damages === 1 ? '' : 's'}`} /> : null}
              </Row>
            </View>
            <T v="h2" color={c.ink2}>›</T>
          </Pressable>
        );
      })}
    </Screen>
  );
}
