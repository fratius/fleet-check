import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { FramesPanel } from '@/components/frames';
import { DriverPicker, HistoryList, sinceText, useHistory } from '@/components/history';
import { BackBar } from '@/components/nav';
import { Button, Card, Chip, Field, Notice, Pill, Plate, Row, Screen, Svg, T, fmtWhen, mmss, secs, usd, useColors } from '@/components/ui';
import { CLASSES, CLS, REAR_PILL, SLIDE_BODIES, attrPills, buildFrames, makeSpec, silhouetteSVG, type RearKind } from '@/lib/frames';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { approvedDamage, type Check, type Vehicle } from '@/lib/types';
import { saveWalk } from '@/lib/walks';

export default function VehicleScreen() {
  const { id, done } = useLocalSearchParams<{ id: string; done?: string }>();
  const s = useSession();
  const c = useColors();
  const { width } = useWindowDimensions();
  const v = s.vehicles.find((x) => x.id === id);
  const history = useHistory({ vehicleId: id });
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const arm = (k: string) => { setArmed(k); setTimeout(() => setArmed((a) => (a === k ? null : a)), 3000); };
  const act = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k); setErr(null); setArmed(null);
    try { await fn(); } catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t save that. Check the connection.'); } finally { setBusy(null); }
  };

  if (!v || !CLS[v.cls]) {
    return <Screen><BackBar title="Fleet" /><Card dashed><T v="hint">{s.loaded.vehicles ? 'This vehicle isn\'t in the fleet any more.' : 'Loading…'}</T></Card></Screen>;
  }
  const sp = makeSpec(v.cls, v);
  const frames = buildFrames(sp);
  // Drivers pick up and drop off vans themselves where the station allows it.
  const selfOn = !!s.stations.find((st) => st.id === v.stationId)?.selfAssign;
  const canSelf = selfOn && !s.runs(v.stationId) && s.myStations.some((st) => st.id === v.stationId);
  const mine = v.assignedTo?.driverId === s.user?.uid;
  const walks = s.walks.filter((w) => w.vehicleId === v.id);
  const checks = s.checks.filter((k) => k.vehicleId === v.id);
  const perPhoto = (() => { const xs = s.walks.filter((w) => w.cls === v.cls && w.taken && w.totalMs).map((w) => w.totalMs! / w.taken).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : 12000; })();
  const est = Math.max(1, Math.round((frames.length * perPhoto) / 60000));
  const makeModel = [v.make, v.model].filter(Boolean).join(' ');
  const heroW = Math.min(width - 68, 560);
  const heroH = heroW * ((sp.H * 100 + 26) / (sp.L * 100 + 40));

  const checkLibrary = async () => {
    setErr(null);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 12, quality: 1, orderedSelection: true });
      if (r.canceled || !r.assets.length) return;
      const assets = r.assets.slice(0, 12).sort((a, b) => (a.fileName || '').localeCompare(b.fileName || '', undefined, { numeric: true }));
      const shots = assets.map((a, i) => ({ n: i + 1, label: `Photo ${i + 1}${a.fileName ? ' (' + a.fileName + ')' : ''}`, uri: a.uri, w: a.width, h: a.height, takenAt: Date.now() }));
      setUpload('Uploading 0 of ' + shots.length);
      const walkId = await saveWalk(s.store!, v, s.user?.uid ?? null, shots, { source: 'library', frames: shots.length, skipped: 0, retakes: 0, totalMs: null },
        (d, t) => setUpload(`Uploading ${d} of ${t}`));
      setUpload(null);
      router.push({ pathname: '/check/[id]', params: { id: 'new', walk: walkId } });
    } catch { setUpload(null); setErr('Couldn\'t upload the photos. Check the connection and try again.'); }
  };

  return (
    <Screen>
      <BackBar title="Fleet" />
      <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, paddingTop: 20, paddingBottom: 10, alignItems: 'center' }}>
        <Svg xml={silhouetteSVG(sp, heroW, true, c.ink2)} width={heroW} height={heroH} />
      </View>
      <View style={{ gap: 6 }}>
        <T v="h1">{v.name}</T>
        <Row><Plate text={v.plate} /><T v="hint">{CLS[v.cls].name}{makeModel && makeModel.toLowerCase() !== v.name.toLowerCase() ? ', ' + makeModel : ''}{s.stations.length > 1 ? ', ' + s.stationName(v.stationId) : ''}</T></Row>
        <Row>{attrPills(sp, v, undefined).map((p) => <Pill key={p} text={p} />)}</Row>
      </View>

      {done === 'pickup' && mine ? <Notice text={`You picked up ${v.name}. The photos are kept with its history.`} /> : null}
      {done === 'dropoff' && !mine ? <Notice text={`You dropped off ${v.name}. The photos are kept with its history.`} /> : null}
      {v.retired ? (
        <Card dashed>
          <T v="h3">Retired</T>
          <T v="hint">Taken out of the fleet {fmtWhen(v.retiredAt)}{v.retiredBy ? ' by ' + v.retiredBy : ''}. Its walk-arounds, damage checks and driver history stay.</T>
        </Card>
      ) : (
        <View style={{ backgroundColor: '#E2FF1C', borderRadius: 4, padding: 14, gap: 8 }}>
          <Button v="primary" wide title="Start scanning" onPress={() => router.push(`/scan/${v.id}`)} />
          <T v="medium" color="#000" style={{ fontSize: 14 }}>{frames.length} photos for this {CLS[v.cls].lower}, about {est} min. The camera shows the outline to fit for each one.</T>
        </View>
      )}

      {s.mode === 'firebase' && !v.retired ? (
        <Card>
          <T v="hint">Driver</T>
          {v.assignedTo ? (
            <Pressable disabled={!s.staff && v.assignedTo.driverId !== s.user?.uid} onPress={() => router.push(`/person/${v.assignedTo!.driverId}`)}>
              <T v="h2">{v.assignedTo.driverId === s.user?.uid ? 'You' : v.assignedTo.driverName}{s.staff ? ' ›' : ''}</T>
              <T v="hint">{sinceText(v.assignedTo.since)}</T>
            </Pressable>
          ) : <><T v="h2">Free</T><T v="hint">Nobody has this van.</T></>}
          {canSelf ? (
            mine ? (
              <>
                <Button title="Drop off this van" onPress={() => router.push({ pathname: '/scan/[id]', params: { id: v.id, handover: 'dropoff' } })} />
                <T v="small">You take all {frames.length} photos when you bring it back, then it's dropped off.</T>
              </>
            ) : s.myVan ? (
              <T v="small">You have {s.myVan.name}. Drop it off first, with its photos, then you can pick up this one.</T>
            ) : (
              <>
                {v.assignedTo ? (
                  <Button title={armed === 'pick' ? `Tap again: ${v.assignedTo.driverName} no longer has it` : `Take over from ${v.assignedTo.driverName}`} onPress={() => {
                    if (armed !== 'pick') { arm('pick'); return; }
                    setArmed(null); router.push({ pathname: '/scan/[id]', params: { id: v.id, handover: 'pickup' } });
                  }} />
                ) : (
                  <Button v="primary" title="Pick up this van" onPress={() => router.push({ pathname: '/scan/[id]', params: { id: v.id, handover: 'pickup' } })} />
                )}
                <T v="small">{v.assignedTo ? `Only if you were told to take this van: ${v.assignedTo.driverName} didn't drop it off. ` : ''}You take all {frames.length} photos first, so damage that was already there isn't put on you. The pick-up goes on the van's history under your name.</T>
              </>
            )
          ) : s.role === 'driver' && !mine ? <T v="small">Your fleet manager gives out the vans at this station.</T> : null}
          {s.runs(v.stationId) ? (picking ? <DriverPicker v={v} onDone={() => setPicking(false)} /> : (
            <Row>
              <Button small v={v.assignedTo ? 'secondary' : 'primary'} title={v.assignedTo ? 'Give to someone else' : 'Give to a driver'} onPress={() => setPicking(true)} />
              {v.assignedTo ? (
                <Button small v="link" title={armed === 'end' ? 'Tap again: the van becomes free' : 'Make the van free'} loading={busy === 'end'} onPress={() => {
                  if (armed !== 'end') { arm('end'); return; }
                  act('end', () => ai.assignVan({ orgId: s.org!.id, vehicleId: v.id, driverId: null }));
                }} />
              ) : null}
            </Row>
          )) : null}
        </Card>
      ) : null}

      <DamageRecord checks={checks} />

      <View style={{ gap: 8 }}>
        <T v="h2">Damage checks</T>
        {s.mode === 'firebase' ? (
          <>
            <T v="hint">Run one from a walk-around below, or check photos you already have.</T>
            {!v.retired ? <Button title={upload || 'Check photos from your library'} loading={!!upload} disabled={!!upload} onPress={checkLibrary} /> : null}
          </>
        ) : <T v="hint">Damage checks need the Firebase backend.</T>}
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        {checks.slice(0, 6).map((k) => {
          const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
          const approved = approvedDamage(k).length;
          return (
            <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 4 }}>
              <Row>
                <T v="h3" style={{ flex: 1 }}>{k.status === 'reviewed' ? `${approved} approved damage${approved === 1 ? '' : 's'}` : `${k.spots.length} spot${k.spots.length === 1 ? '' : 's'}, ${dmg} damage by the AI`}</T>
                <Pill v={k.status === 'reviewed' ? 'solid' : k.status === 'submitted' ? 'amber' : 'muted'} text={k.status === 'reviewed' ? 'Reviewed' : k.status === 'submitted' ? 'Waiting for review' : 'Close-ups pending'} />
              </Row>
              <T v="hint">{[k.createdByName || '', `${k.photos} photos`, s.staff && k.pass1 ? `found in ${secs(k.pass1.ms)}` : '', s.staff ? usd((k.pass1?.cost || 0) + (k.pass2?.cost || 0)) : '', fmtWhen(k.createdAt)].filter(Boolean).join(', ')}</T>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 8 }}>
        <T v="h2">Walk-arounds</T>
        {!walks.length ? <T v="hint">No walk-around yet. Start one above.</T> : null}
        {walks.slice(0, 8).map((w) => (
          <Pressable key={w.id} onPress={() => router.push(`/walk/${w.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="h3">{fmtWhen(w.createdAt)}</T>
            <T v="hint">{[`${w.taken} of ${w.frames} photos`, w.totalMs ? mmss(w.totalMs) : '', w.source === 'library' ? 'from library' : `${w.retakes} retake${w.retakes === 1 ? '' : 's'}`].filter(Boolean).join(', ')}</T>
          </Pressable>
        ))}
      </View>

      {s.mode === 'firebase' ? (
        <View style={{ gap: 8 }}>
          <T v="h2">Drivers of this van</T>
          <T v="hint">{s.role === 'driver' ? 'The times you had this van.' : 'Everyone who had this van, newest first. This history is kept for good.'}</T>
          <Card><HistoryList rows={history.rows} error={history.error} show="driver" empty={s.role === 'driver' ? 'You haven\'t had this van yet.' : 'Nobody has had this van yet.'} /></Card>
        </View>
      ) : null}

      <FramesPanel sp={sp} title="Frames for this vehicle" />

      {!s.runs(v.stationId) ? null : editing ? <EditVehicle v={v} onDone={() => setEditing(false)} /> : (
        <Row>
          {!v.retired ? <Button title="Edit details" onPress={() => setEditing(true)} /> : null}
          {s.mode === 'local' ? (
            <Button v="danger" title={armed === 'remove' ? 'Tap again to remove' : 'Remove from fleet'} onPress={async () => {
              if (armed !== 'remove') { arm('remove'); return; }
              try { await s.store!.vehicles.remove(v.id); router.replace('/'); } catch { setErr('Couldn\'t remove the vehicle.'); }
            }} />
          ) : v.retired ? (
            <Button title="Bring back into the fleet" loading={busy === 'retire'} onPress={() => act('retire', () => ai.retireVan({ orgId: s.org!.id, vehicleId: v.id, restore: true }))} />
          ) : (
            <Button v="danger" title={armed === 'retire' ? 'Tap again to retire' : 'Retire van'} loading={busy === 'retire'} onPress={() => {
              if (armed !== 'retire') { arm('retire'); return; }
              act('retire', () => ai.retireVan({ orgId: s.org!.id, vehicleId: v.id }));
            }} />
          )}
        </Row>
      )}
      {s.runs(v.stationId) && s.mode === 'firebase' && !v.retired && !editing ? (
        <T v="small">Retiring takes a van out of the fleet (sold, returned, written off). Vans are never deleted: their checks and driver history stay.</T>
      ) : null}
      {s.mode === 'local' ? <Notice text="Saved on this phone only until Firebase is connected." /> : null}
    </Screen>
  );
}

function EditVehicle({ v, onDone }: { v: Vehicle; onDone: () => void }) {
  const s = useSession();
  const c = useColors();
  const [name, setName] = useState(v.name);
  const [plate, setPlate] = useState(v.plate || '');
  const [cls, setCls] = useState(v.cls);
  const sl = v.slideL === 'yes' && v.slideR === 'yes' ? 'both' : v.slideL === 'yes' ? 'left' : v.slideR === 'yes' ? 'right' : v.slideL === 'no' && v.slideR === 'no' ? 'none' : 'unknown';
  const [slide, setSlide] = useState(sl);
  const [rear, setRear] = useState<RearKind>(v.rear !== 'unknown' ? (v.rear as RearKind) : CLS[v.cls].rear);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [station, setStation] = useState(v.stationId || s.stations[0]?.id || '');
  const save = async () => {
    if (!name.trim()) { setErr('Give the vehicle a name.'); return; }
    const sd = ({ right: ['no', 'yes'], left: ['yes', 'no'], both: ['yes', 'yes'], none: ['no', 'no'], unknown: ['unknown', 'unknown'] } as const)[slide as 'right'];
    const vans = !!SLIDE_BODIES[CLS[cls].body];
    setBusy(true);
    try {
      await s.store!.vehicles.update(v.id, {
        name: name.trim().slice(0, 60), plate: plate.trim().toUpperCase().slice(0, 14), cls, rear,
        slideL: vans ? sd[0] : 'no', slideR: vans ? sd[1] : 'no',
        ...(CLS[cls].body !== CLS[v.cls].body ? { roof: 'unknown' as const } : {}),
      });
      // Moving to another station ends the van's assignment (its driver stays at theirs): done on the server.
      if (station && station !== v.stationId) await ai.moveVan({ orgId: s.org!.id, vehicleId: v.id, stationId: station });
      onDone();
    } catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t save the changes.'); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h2">Edit vehicle</T>
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
      <Field label="Number plate" hint="optional" value={plate} onChangeText={(t) => setPlate(t.toUpperCase())} autoCapitalize="characters" maxLength={14} />
      <T v="medium">Type</T>
      <Row>{CLASSES.map((k) => <Chip key={k.id} text={k.name} on={k.id === cls} onPress={() => { setCls(k.id); if (CLS[k.id].body !== CLS[cls].body) { setRear(k.rear); setSlide('unknown'); } }} />)}</Row>
      <T v="hint">Changing the type changes the photo frames.</T>
      {SLIDE_BODIES[CLS[cls].body] ? (
        <><T v="medium">Sliding doors</T>
          <Row>{([['right', 'Right side'], ['left', 'Left side'], ['both', 'Both sides'], ['none', 'None'], ['unknown', 'Not sure']] as const).map(([k, t]) => <Chip key={k} text={t} on={slide === k} onPress={() => setSlide(k)} />)}</Row></>
      ) : null}
      {s.role === 'owner' && s.stations.length > 1 ? (
        <><T v="medium">Station</T><Row>{s.stations.map((st) => <Chip key={st.id} text={st.name} on={st.id === station} onPress={() => setStation(st.id)} />)}</Row>
          {station !== v.stationId && v.assignedTo ? <T v="hint" color={c.alert}>{v.assignedTo.driverName} stays at {s.stationName(v.stationId)}, so the van becomes free.</T> : null}</>
      ) : null}
      <T v="medium">Rear</T>
      <Row>{(Object.keys(REAR_PILL) as RearKind[]).map((k) => <Chip key={k} text={REAR_PILL[k]} on={rear === k} onPress={() => setRear(k)} />)}</Row>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row><Button v="primary" title="Save changes" loading={busy} onPress={save} /><Button v="link" title="Cancel" onPress={onDone} /></Row>
    </Card>
  );
}

/** The van's damage record: every damage a fleet manager approved, newest first. */
function DamageRecord({ checks }: { checks: Check[] }) {
  const c = useColors();
  const rows = checks.filter((k) => k.status === 'reviewed').flatMap((k) => approvedDamage(k).map((d) => ({ ...d, k })));
  return (
    <View style={{ gap: 8 }}>
      <T v="h2">Damage record</T>
      {!rows.length ? <T v="hint">No approved damage. Damage goes on the record when a fleet manager approves it in a check.</T> : null}
      {rows.map((d, i) => (
        <Pressable key={d.k.id + i} onPress={() => router.push(`/check/${d.k.id}`)}
          style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.paper, borderWidth: 2, borderColor: c.alert, borderRadius: 4, padding: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h3">{d.panel.charAt(0).toUpperCase() + d.panel.slice(1)}</T>
            <T v="hint">{[d.type + (d.sizeCm ? `, about ${d.sizeCm} cm` : ''), d.spot == null ? 'added by the manager' : '', `approved ${fmtWhen(d.k.review?.at || d.k.createdAt)}`].filter(Boolean).join(', ')}</T>
            {d.note ? <T v="small">{d.note}</T> : null}
          </View>
          <T v="h3" color={c.ink2}>›</T>
        </Pressable>
      ))}
    </View>
  );
}
