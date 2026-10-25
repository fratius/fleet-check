import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Card, Chip, Notice, Pill, Plate, Row, Screen, Svg, T, fmtWhen, useColors } from '@/components/ui';
import { sinceText } from '@/components/history';
import { Notifications, PickupRequest, usePickupRequest } from '@/components/pickup';
import { TourCard } from '@/components/dash';
import { BuyButtons, MyOpenBuy } from '@/components/buy';
import { ScanChoice } from '@/components/scanchoice';
import { isOpen } from '@/lib/stats';
import { CLS, makeSpec, silhouetteSVG } from '@/lib/frames';
import { useWhoDid } from '@/lib/names';
import { deadlines } from '@/lib/fleet';
import { useSession } from '@/lib/session';
import { ROLE_NAME, newDamage, type Check } from '@/lib/types';

export default function Fleet() {
  const s = useSession();
  const c = useColors();
  const [only, setOnly] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'free' | 'taken' | 'retired'>('all');
  // A van a manager gave this driver that still needs its pick-up video or photos.
  const pickup = usePickupRequest(s.myVan);
  const whoDid = useWhoDid();
  const selfOn = (stationId: string | null | undefined) => !!s.stations.find((st) => st.id === stationId)?.selfAssign;
  const canDrop = !!s.myVan && selfOn(s.myVan.stationId) && !s.runs(s.myVan.stationId);
  const showStations = s.myStations.length > 1;
  const here = s.vehicles.filter((v) => !only || v.stationId === only);
  const active = here.filter((v) => !v.retired);
  const free = active.filter((v) => !v.assignedTo);
  const taken = active.filter((v) => v.assignedTo);
  const retired = here.filter((v) => v.retired);
  const tracking = s.mode === 'firebase' && s.staff;
  const vans = !tracking ? active : show === 'free' ? free : show === 'taken' ? taken : show === 'retired' ? retired : active;
  const count = active.length;
  const canAdd = s.staff && (s.role === 'owner' || s.myStations.some((st) => s.runs(st.id)));
  const where = s.mode === 'local' ? 'Test mode, saved on this phone'
    : [s.org?.name, s.role === 'owner' ? (s.stations.length === 1 ? s.stations[0].name : `${s.stations.length} stations`) : s.myStations.map((st) => st.name).join(', ')].filter(Boolean).join(', ');

  // A tour of mine still open on a van I no longer have (dropped off before the end photo).
  const myOpen = s.tours.find((t) => isOpen(t) && t.driverId === s.user?.uid && t.vehicleId !== s.myVan?.id);
  const tourElsewhere = myOpen ? s.vehicles.find((v) => v.id === myOpen.vehicleId) || null : null;
  // With the tour card on top, the "Your van" card steps back to plain paper.
  const touring = s.mode === 'firebase' && !!s.org?.dashScans && !!s.myVan && !pickup;
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
      {/* The tour comes first when there is one to start or end (a dashboard photo, where the owner turned it on). */}
      {s.myVan && !pickup ? <TourCard v={s.myVan} compact /> : null}
      {tourElsewhere ? <TourCard v={tourElsewhere} compact /> : null}
      {/* A refuel, wash or parts purchase left half done (the app was closed at the pump). */}
      <MyOpenBuy />
      {s.myVan && pickup ? <PickupRequest v={s.myVan} a={pickup} compact /> : s.myVan ? (
        <Pressable onPress={() => router.push(`/vehicle/${s.myVan!.id}`)}
          style={touring ? { backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 14, gap: 4 } : { backgroundColor: '#E2FF1C', borderRadius: 4, padding: 14, gap: 4 }}>
          <T v="medium" color={touring ? undefined : '#000'}>Your van</T>
          <T v="h2" color={touring ? undefined : '#000'}>{s.myVan.name}{s.myVan.plate ? `, ${s.myVan.plate}` : ''} ›</T>
          <T v="small" color={touring ? undefined : '#000'}>{sinceText(s.myVan.assignedTo!.since)}</T>
          <Row>
            <ScanChoice v={s.myVan} small onMarker={!touring} />
            <BuyButtons v={s.myVan} />
            {canDrop ? <Button small title="Drop off" onPress={() => router.push(`/vehicle/${s.myVan!.id}`)} /> : null}
          </Row>
        </Pressable>
      ) : null}
      {!s.staff ? <Notifications prompt /> : null}
      {!s.staff && !s.myVan && s.mode === 'firebase' && s.myStations.some((st) => st.selfAssign) ? (
        <Notice text="Pick up the van you were told to take: open it below and record a video walking around it (or take its photos). When you bring it back, drop it off the same way." />
      ) : null}
      {s.mode === 'firebase' && s.user ? (
        <Button small v="link" title={s.staff ? 'Your own van history' : 'Your record, tours and vans'} onPress={() => router.push(`/person/${s.user!.uid}`)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {tracking && s.loaded.vehicles && count + retired.length ? (
        <Row>
          <Chip text={`All (${active.length})`} on={show === 'all'} onPress={() => setShow('all')} />
          <Chip text={`Free (${free.length})`} on={show === 'free'} onPress={() => setShow('free')} />
          <Chip text={`With a driver (${taken.length})`} on={show === 'taken'} onPress={() => setShow('taken')} />
          {retired.length ? <Chip text={`Retired (${retired.length})`} on={show === 'retired'} onPress={() => setShow('retired')} /> : null}
        </Row>
      ) : null}
      {tracking && s.loaded.vehicles && count && !vans.length ? (
        <T v="hint">{show === 'free' ? 'Every van has a driver.' : show === 'taken' ? 'No van has a driver yet. Open a van to give it to one.' : 'Nothing here.'}</T>
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
        const damages = s.checks.filter((x) => x.vehicleId === v.id).reduce((n, x) => n + newDamage(x).length, 0);
        // Inspections, service, tax, insurance and contract end: owners and managers only.
        const due = s.runs(v.stationId) && !v.retired ? deadlines(v, s.details.find((d) => d.id === v.id)).filter((x) => x.state !== 'ok') : [];
        return (
          <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.name}, ${CLS[v.cls].name}`} onPress={() => router.push(`/vehicle/${v.id}`)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, opacity: pressed ? 0.8 : 1 })}>
            <Svg xml={silhouetteSVG(sp, 104, false, c.ink2)} width={104} height={49} />
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <T v="h3" numberOfLines={2}>{v.name}</T>
              {v.plate ? <Plate text={v.plate} /> : null}
              <T v="hint">{[CLS[v.cls].name, showStations ? s.stationName(v.stationId) : ''].filter(Boolean).join(', ')}</T>
              {tracking && !v.retired ? (
                <T v="medium" style={{ fontSize: 14 }} numberOfLines={1}>{v.assignedTo ? `${v.assignedTo.driverName}, ${sinceText(v.assignedTo.since)}` : 'Free'}</T>
              ) : null}
              <T v="hint">{last ? ['Last walk-around ' + fmtWhen(last.createdAt), whoDid(last.createdBy) ? 'by ' + whoDid(last.createdBy) : ''].filter(Boolean).join(', ') : 'No walk-around yet'}</T>
              <Row gap={6}>
                {tracking && !v.retired && !v.assignedTo ? <Pill v="good" text="Free" /> : null}
                {v.retired ? <Pill v="muted" text="Retired" /> : null}
                {!tracking && v.assignedTo?.driverId === s.user?.uid ? <Pill v="solid" text="Your van" /> : null}
                {!tracking && s.mode === 'firebase' && selfOn(v.stationId) && v.assignedTo?.driverId !== s.user?.uid ? <Pill v={v.assignedTo ? 'muted' : 'good'} text={v.assignedTo ? 'In use' : 'Free'} /> : null}
                {k?.status === 'submitted' ? <Pill v="amber" text="Waiting for review" /> : null}
                {k?.status === 'checking' ? <Pill v="muted" text="Close-ups pending" /> : null}
                {damages ? <Pill v="bad" text={`${damages} approved damage${damages === 1 ? '' : 's'}`} /> : null}
                {due[0] ? <Pill v={due[0].state === 'overdue' ? 'bad' : 'amber'} text={`${due[0].label} ${due[0].state === 'overdue' ? 'overdue' : due[0].note}`} /> : null}
                {due.length > 1 ? <Pill v="muted" text={`${due.length - 1} more due`} /> : null}
              </Row>
            </View>
            <T v="h2" color={c.ink2}>›</T>
          </Pressable>
        );
      })}
    </Screen>
  );
}
