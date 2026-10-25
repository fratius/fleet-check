import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, type ScrollViewInstance } from 'react-native';

import { DamageBubble, DamageList, useVanRecords } from '@/components/damage';
import { DriverPicker, HistoryList, sinceText, useHistory } from '@/components/history';
import { Button, Card, Chip, Field, Notice, Pill, Plate, Row, Screen, T, Tabs, fmtWhen, mmss, secs, usd, useColors } from '@/components/ui';
import { Deadlines, VanRecord } from '@/components/vanfacts';
import { Van3D } from '@/components/van3d';
import { PickupRequest, usePickupRequest } from '@/components/pickup';
import { TourCard, TourLine } from '@/components/dash';
import { BuyActions, BuyNow, BuyRow } from '@/components/buy';
import { isOpen } from '@/lib/stats';
import { useWhoDid } from '@/lib/names';
import { VIDEO_HOW, VideoHandover, VideoRow } from '@/components/video';
import { ScanChoice } from '@/components/scanchoice';
import { buildDamages } from '@/lib/damage';
import { CLASSES, CLS, REAR_PILL, SLIDE_BODIES, attrPills, buildFrames, makeSpec, type RearKind } from '@/lib/frames';
import { watchDamageNotes } from '@/lib/people';
import { useFlash } from '@/lib/flash';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { approvedDamage, newDamage, type DamageNote, type Vehicle } from '@/lib/types';
import { saveWalk } from '@/lib/walks';
import { loc, t, tp } from '@/lib/i18n';

export default function VehicleScreen() {
  const { id, tab: openTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const s = useSession();
  const c = useColors();
  const v = s.vehicles.find((x) => x.id === id);
  const history = useHistory({ vehicleId: id });
  // "You picked up …" after the camera closes.
  const done = useFlash(`van:${id}`);
  const pickup = usePickupRequest(v);
  const whoDid = useWhoDid();
  // The damage record: every damage on the van with where it is, when it happened and who had the van.
  const recs = useVanRecords(id);
  const damages = useMemo(() => (v ? buildDamages(v, recs.checks, recs.walks) : []), [v, recs.checks, recs.walks]);
  const [notes, setNotes] = useState<DamageNote[]>([]);
  const orgId = s.org?.id;
  const scope = s.role === 'owner' ? '*' : s.myStations.map((st) => st.id).join(',');
  useEffect(() => {
    if (!orgId || !id || !s.staff || s.mode !== 'firebase') return;
    return watchDamageNotes(orgId, id, scope === '*' ? null : scope ? scope.split(',') : [], setNotes);
  }, [orgId, id, s.staff, s.mode, scope]);
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  // Where the model, the damage section, the list inside it and each damage are, to scroll between them.
  const spots = useRef({ model: 0, list: 0, inner: 0, items: new Map<string, number>() });
  const [editing, setEditing] = useState(false);
  // The page in three parts below the van's status and actions: its damage, its record, its drivers.
  const [tab, setTab] = useState<'damage' | 'details' | 'history'>(openTab === 'details' || openTab === 'history' ? openTab : 'damage');
  const tabTop = useRef(0);
  const [picking, setPicking] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const arm = (k: string) => { setArmed(k); setTimeout(() => setArmed((a) => (a === k ? null : a)), 3000); };
  const act = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k); setErr(null); setArmed(null);
    try { await fn(); } catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that. Check the connection.')); } finally { setBusy(null); }
  };

  if (!v || !CLS[v.cls]) {
    return <Screen edges={[]}><Card dashed><T v="hint">{s.loaded.vehicles ? t('This vehicle isn\'t in the fleet any more.') : t('Loading…')}</T></Card></Screen>;
  }
  const sp = makeSpec(v.cls, v);
  const frames = buildFrames(sp);
  // Drivers pick up and drop off vans themselves where the station allows it.
  const selfOn = !!s.stations.find((st) => st.id === v.stationId)?.selfAssign;
  const canSelf = selfOn && !s.runs(v.stationId) && s.myStations.some((st) => st.id === v.stationId);
  const mine = v.assignedTo?.driverId === s.user?.uid;
  const walks = s.walks.filter((w) => w.vehicleId === v.id);
  const vids = s.videos.filter((x) => x.vehicleId === v.id);
  const checks = s.checks.filter((k) => k.vehicleId === v.id);
  const vanTours = s.tours.filter((t) => t.vehicleId === v.id);
  const vanBuys = s.purchases.filter((p) => p.vehicleId === v.id);
  // A warning light on the latest dashboard photo in the last three days (the station's staff).
  const latest = vanTours[0];
  const warned = s.runs(v.stationId) && latest?.warnings?.length && Date.now() - (latest.end?.at || latest.startAt) < 3 * 86_400_000 ? latest : null;
  const perPhoto = (() => { const xs = s.walks.filter((w) => w.cls === v.cls && w.taken && w.totalMs).map((w) => w.totalMs! / w.taken).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : 12000; })();
  const est = Math.max(1, Math.round((frames.length * perPhoto) / 60000));
  const makeModel = [v.make, v.model].filter(Boolean).join(' ');
  const selD = sel ? damages.find((d) => d.key === sel) || null : null;
  const showOnVan = (key: string) => {
    setSel(key); setFocus({ key, n: Date.now() });
    scroller.current?.scrollTo({ y: Math.max(0, spots.current.model - 8), animated: true });
  };
  const showInList = (key: string) => {
    const go = () => {
      const at = spots.current;
      scroller.current?.scrollTo({ y: Math.max(0, at.list + at.inner + (at.items.get(key) ?? 0) - 8), animated: true });
    };
    if (tab !== 'damage') { setTab('damage'); setTimeout(go, 120); } else go();
  };
  const openDetails = () => { setTab('details'); setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, tabTop.current - 8), animated: true }), 80); };

  const checkLibrary = async () => {
    setErr(null);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 12, quality: 1, orderedSelection: true });
      if (r.canceled || !r.assets.length) return;
      const assets = r.assets.slice(0, 12).sort((a, b) => (a.fileName || '').localeCompare(b.fileName || '', undefined, { numeric: true }));
      const shots = assets.map((a, i) => ({ n: i + 1, label: `Photo ${i + 1}${a.fileName ? ' (' + a.fileName + ')' : ''}`, uri: a.uri, w: a.width, h: a.height, takenAt: Date.now() }));
      setUpload(t('Uploading {done} of {total}', { done: 0, total: shots.length }));
      const walkId = await saveWalk(s.store!, v, s.user?.uid ?? null, shots, { source: 'library', frames: shots.length, skipped: 0, retakes: 0, totalMs: null },
        (d, total) => setUpload(t('Uploading {done} of {total}', { done: d, total })));
      setUpload(null);
      router.push({ pathname: '/check/[id]', params: { id: 'new', walk: walkId } });
    } catch { setUpload(null); setErr(t('Couldn\'t upload the photos. Check the connection and try again.')); }
  };

  return (
    <Screen scrollRef={scroller} edges={[]}>
      <Stack.Screen options={{ title: v.name }} />
      {/* A van a manager just gave this driver: the pick-up video or photos come first (the notification opens here). */}
      {pickup && !v.retired ? <PickupRequest v={v} a={pickup} /> : <TourCard v={v} />}
      {/* A refuel left half done, or (staff) a driver waiting at the pump for an answer. */}
      <BuyNow v={v} />
      <View style={{ zIndex: 5 }} onLayout={(e) => { spots.current.model = e.nativeEvent.layout.y; }}>
        <Van3D sp={sp} dots={damages.map((d) => ({ key: d.key, label: String(d.no), pos: d.pos }))} selected={sel} onSelect={setSel} focus={focus}
          bubble={selD ? <DamageBubble d={selD} history={history.rows} notes={notes} vehicleId={v.id} onClose={() => setSel(null)} onMore={() => showInList(selD.key)} /> : null} />
      </View>
      <View style={{ gap: 6 }}>
        <T v="h1">{v.name}</T>
        <Row><Plate text={v.plate} /><T v="hint">{t(CLS[v.cls].name)}{makeModel && makeModel.toLowerCase() !== v.name.toLowerCase() ? ', ' + makeModel : ''}{s.stations.length > 1 ? ', ' + s.stationName(v.stationId) : ''}</T></Row>
        <Row>{attrPills(sp, v, undefined).map((p) => <Pill key={p} text={t(p)} />)}</Row>
        {v.heightM || v.fuel ? <T v="small">{[v.fuel ? { diesel: t('Diesel'), electric: t('Electric'), petrol: t('Petrol'), hybrid: t('Hybrid'), cng: t('Gas') }[v.fuel] : '',
          v.heightM ? t('{m} m high', { m: v.heightM.toLocaleString(loc(), { maximumFractionDigits: 2 }) }) : ''].filter(Boolean).join(', ')}</T> : null}
      </View>

      {done ? <Notice text={done} /> : null}
      {warned ? (
        <View style={{ borderWidth: 2, borderColor: c.alert, borderRadius: 4, padding: 12, gap: 2, backgroundColor: c.paper }}>
          <T v="medium" color={c.alert}>{t('Warning light on the dashboard: {lights}', { lights: warned.warnings.join(', ') })}</T>
          <T v="small">{warned.end && !isOpen(warned)
            ? t('On the end photo of {name}\'s tour, {when}. Check it before the van goes out again.', { name: warned.driverName, when: fmtWhen(warned.end?.at || warned.startAt) })
            : t('On the start photo of {name}\'s tour, {when}. Check it before the van goes out again.', { name: warned.driverName, when: fmtWhen(warned.end?.at || warned.startAt) })}</T>
        </View>
      ) : null}
      {s.runs(v.stationId) && !v.retired ? <Deadlines v={v} d={s.details.find((x) => x.id === v.id)} compact onOpen={openDetails} /> : null}
      {v.retired ? (
        <Card dashed>
          <T v="h3">{t('Retired')}</T>
          <T v="hint">{v.retiredBy
            ? t('Taken out of the fleet {when} by {name}. Its walk-arounds, damage checks and driver history stay.', { when: fmtWhen(v.retiredAt), name: v.retiredBy })
            : t('Taken out of the fleet {when}. Its walk-arounds, damage checks and driver history stay.', { when: fmtWhen(v.retiredAt) })}</T>
        </Card>
      ) : (
        <View style={{ backgroundColor: '#E2FF1C', borderRadius: 4, padding: 14, gap: 8 }}>
          {/* One button; it asks whether to scan with the photos or a video. */}
          <ScanChoice v={v} minutes={est} caption={s.mode === 'firebase'
            ? tp(frames.length, 'A walk-around with {n} photo (about {min} min) or one video.', 'A walk-around with {n} photos (about {min} min) or one video.', { min: est })
            : tp(frames.length, '{n} photo for this {cls}, about {min} min. The camera shows the outline to fit for each one.', '{n} photos for this {cls}, about {min} min. The camera shows the outline to fit for each one.', { cls: t(CLS[v.cls].lower), min: est })} />
        </View>
      )}
      {/* Refuel, wash and (owners and the station's managers) parts. */}
      <BuyActions v={v} />

      {s.mode === 'firebase' && !v.retired ? (
        <Card>
          <T v="hint">{t('Driver')}</T>
          {v.assignedTo ? (
            <Pressable disabled={!s.staff && v.assignedTo.driverId !== s.user?.uid} onPress={() => router.push(`/person/${v.assignedTo!.driverId}`)}>
              <T v="h2">{v.assignedTo.driverId === s.user?.uid ? t('You') : v.assignedTo.driverName}{s.staff ? ' ›' : ''}</T>
              <T v="hint">{sinceText(v.assignedTo.since)}</T>
            </Pressable>
          ) : <><T v="h2">{t('Free')}</T><T v="hint">{t('Nobody has this van.')}</T></>}
          {canSelf ? (
            mine ? (
              <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <T v="medium">{t('Drop off')}</T>
                <VideoHandover v={v} kind="dropoff" title={t('Drop off with a video')} primary />
                <Button title={tp(frames.length, 'Drop off with {n} photo', 'Drop off with {n} photos')} onPress={() => router.push({ pathname: '/scan/[id]', params: { id: v.id, handover: 'dropoff' } })} />
                <T v="small">{t('A video or the photos are needed to drop it off.')} {t(VIDEO_HOW)}</T>
              </View>
            ) : s.myVan ? (
              <T v="small">{t('You have {van}. Drop it off first, with a video or its photos, then you can pick up this one.', { van: s.myVan.name })}</T>
            ) : v.assignedTo && !takeover ? (
              <>
                <Button title={t('Take over from {name}', { name: v.assignedTo.driverName })} onPress={() => setTakeover(true)} />
                <T v="small">{t('Only if you were told to take this van: {name} didn\'t drop it off.', { name: v.assignedTo.driverName })}</T>
              </>
            ) : (
              <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <T v="medium">{v.assignedTo ? t('Take over from {name}', { name: v.assignedTo.driverName }) : t('Pick up')}</T>
                <VideoHandover v={v} kind="pickup" title={t('Pick up with a video')} primary />
                <Button title={tp(frames.length, 'Pick up with {n} photo', 'Pick up with {n} photos')} onPress={() => router.push({ pathname: '/scan/[id]', params: { id: v.id, handover: 'pickup' } })} />
                <T v="small">{t('First a video or the photos, so damage that was already there isn\'t put on you. The pick-up goes on the van\'s history under your name.')} {t(VIDEO_HOW)}</T>
                {v.assignedTo ? <Button small v="link" title={t('Cancel')} onPress={() => setTakeover(false)} /> : null}
              </View>
            )
          ) : s.role === 'driver' && !mine ? <T v="small">{t('Your fleet manager gives out the vans at this station.')}</T> : null}
          {s.runs(v.stationId) ? (picking ? <DriverPicker v={v} onDone={() => setPicking(false)} /> : (
            <Row>
              <Button small v={v.assignedTo ? 'secondary' : 'primary'} title={v.assignedTo ? t('Give to someone else') : t('Give to a driver')} onPress={() => setPicking(true)} />
              {v.assignedTo ? (
                <Button small v="link" title={armed === 'end' ? t('Tap again: the van becomes free') : t('Make the van free')} loading={busy === 'end'} onPress={() => {
                  if (armed !== 'end') { arm('end'); return; }
                  act('end', () => ai.assignVan({ orgId: s.org!.id, vehicleId: v.id, driverId: null }));
                }} />
              ) : null}
            </Row>
          )) : null}
        </Card>
      ) : null}

      <View onLayout={(e) => { tabTop.current = e.nativeEvent.layout.y; }}>
        <Tabs value={tab} onChange={setTab} items={[['damage', t('Damage'), damages.length], ['details', t('Details'), null], ['history', t('Drivers'), null]]} />
      </View>

      {tab === 'damage' ? (<>
      <View style={{ gap: 8 }} onLayout={(e) => { spots.current.list = e.nativeEvent.layout.y; }}>
        <T v="h2">{damages.length ? t('Damage ({n})', { n: damages.length }) : t('Damage')}</T>
        {damages.length ? <T v="hint">{t('Newest first. The numbers match the dots on the van.')}</T> : null}
        {recs.error ? <T v="hint" color={c.alert}>{recs.error}</T> : null}
        <View onLayout={(e) => { spots.current.inner = e.nativeEvent.layout.y; }}>
          <DamageList damages={damages} history={history.rows} notes={notes} vehicleId={v.id} stationId={v.stationId || null} selected={sel}
            onShow={showOnVan} onLayoutItem={(key, y) => { spots.current.items.set(key, y); }} />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T v="h2">{t('Damage checks')}</T>
        {s.mode === 'firebase' ? (
          <>
            <T v="hint">{t('Run one from a walk-around below, or check photos you already have.')}</T>
            {!v.retired ? <Button title={upload || t('Check photos from your library')} loading={!!upload} disabled={!!upload} onPress={checkLibrary} /> : null}
          </>
        ) : <T v="hint">{t('Damage checks need the Firebase backend.')}</T>}
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        {checks.slice(0, 6).map((k) => {
          const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
          const approved = approvedDamage(k).length, fresh = newDamage(k).length;
          return (
            <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 4 }}>
              <Row>
                <T v="h3" style={{ flex: 1 }}>{k.status === 'reviewed'
                  ? (approved ? [tp(fresh, '{n} new damage', '{n} new damages'), approved > fresh ? tp(approved - fresh, '{n} already on the van', '{n} already on the van') : ''].filter(Boolean).join(', ') : t('No damage'))
                  : tp(k.spots.length, '{n} spot, {dmg} damage by the AI', '{n} spots, {dmg} damage by the AI', { dmg })}</T>
                <Pill v={k.status === 'reviewed' ? 'solid' : k.status === 'submitted' ? 'amber' : 'muted'} text={k.status === 'reviewed' ? t('Reviewed') : k.status === 'submitted' ? t('Waiting for review') : t('Close-ups pending')} />
              </Row>
              <T v="hint">{[k.createdByName || '', tp(k.photos, '{n} photo', '{n} photos'), s.seesAiStats && k.pass1 ? t('found in {time}', { time: secs(k.pass1.ms) }) : '', s.seesAiStats && k.pass1 ? usd((k.pass1?.cost || 0) + (k.pass2?.cost || 0)) : '', fmtWhen(k.createdAt)].filter(Boolean).join(', ')}</T>
            </Pressable>
          );
        })}
      </View>

      {vids.length ? (
        <View style={{ gap: 8 }}>
          <T v="h2">{t('Videos')}</T>
          {vids.slice(0, 6).map((x) => <VideoRow key={x.id} v={x} />)}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <T v="h2">{t('Walk-arounds')}</T>
        {!walks.length ? <T v="hint">{t('No walk-around yet. Start one above.')}</T> : null}
        {walks.slice(0, 8).map((w) => (
          <Pressable key={w.id} onPress={() => router.push(`/walk/${w.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="h3">{[whoDid(w.createdBy), fmtWhen(w.createdAt)].filter(Boolean).join(' – ')}</T>
            <T v="hint">{[tp(w.frames, '{taken} of {n} photo', '{taken} of {n} photos', { taken: w.taken }), w.totalMs ? mmss(w.totalMs) : '',
              w.source === 'library' ? t('from library') : tp(w.retakes, '{n} retake', '{n} retakes')].filter(Boolean).join(', ')}</T>
          </Pressable>
        ))}
      </View>
      </>) : null}

      {tab === 'history' && vanTours.length ? (
        <View style={{ gap: 8 }}>
          <T v="h2">{t('Tours')}</T>
          <T v="hint">{s.role === 'driver' ? t('Your tours with this van, from the dashboard photos.') : t('From the dashboard photos at the start and end of each tour, newest first.')}</T>
          <Card>
            {vanTours.slice(0, 10).map((tour, i) => (
              <View key={tour.id} style={{ borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 8 : 0 }}><TourLine t={tour} show="driver" /></View>
            ))}
          </Card>
        </View>
      ) : null}
      {tab === 'history' && vanBuys.length ? (
        <View style={{ gap: 8 }}>
          <T v="h2">{t('Fuel, wash and parts')}</T>
          <T v="hint">{s.role === 'driver' ? t('Yours for this van.') : t('Every refuel, wash and parts purchase, with the ones refused or given up. Kept for good.')}</T>
          <Card style={{ paddingVertical: 6 }}>{vanBuys.slice(0, 15).map((p, i) => <BuyRow key={p.id} p={p} show="driver" first={i === 0} />)}</Card>
        </View>
      ) : null}
      {tab === 'history' ? (s.mode === 'firebase' ? (
        <View style={{ gap: 8 }}>
          <T v="h2">{t('Drivers of this van')}</T>
          <T v="hint">{s.role === 'driver' ? t('The times you had this van.') : t('Everyone who had this van, newest first. This history is kept for good.')}</T>
          <Card><HistoryList rows={history.rows} error={history.error} show="driver" empty={s.role === 'driver' ? t('You haven\'t had this van yet.') : t('Nobody has had this van yet.')} /></Card>
        </View>
      ) : <Card dashed><T v="hint">{t('The drivers of each van need the Firebase backend.')}</T></Card>) : null}

      {tab === 'details' ? <VanRecord v={v} /> : null}

      {tab !== 'details' || !s.runs(v.stationId) ? null : editing ? <EditVehicle v={v} onDone={() => setEditing(false)} /> : (
        <Row>
          {!v.retired ? <Button title={t('Name, plate and type')} onPress={() => setEditing(true)} /> : null}
          {s.mode === 'local' ? (
            <Button v="danger" title={armed === 'remove' ? t('Tap again to remove') : t('Remove from fleet')} onPress={async () => {
              if (armed !== 'remove') { arm('remove'); return; }
              try { await s.store!.vehicles.remove(v.id); router.back(); } catch { setErr(t('Couldn\'t remove the vehicle.')); }
            }} />
          ) : v.retired ? (
            <Button title={t('Bring back into the fleet')} loading={busy === 'retire'} onPress={() => act('retire', () => ai.retireVan({ orgId: s.org!.id, vehicleId: v.id, restore: true }))} />
          ) : (
            <Button v="danger" title={armed === 'retire' ? t('Tap again to retire') : t('Retire van')} loading={busy === 'retire'} onPress={() => {
              if (armed !== 'retire') { arm('retire'); return; }
              act('retire', () => ai.retireVan({ orgId: s.org!.id, vehicleId: v.id }));
            }} />
          )}
        </Row>
      )}
      {tab === 'details' && s.runs(v.stationId) && s.mode === 'firebase' && !v.retired && !editing ? (
        <T v="small">{t('Retiring takes a van out of the fleet (sold, returned, written off). Vans are never deleted: their checks and driver history stay.')}</T>
      ) : null}
      {s.mode === 'local' ? <Notice text={t('Saved on this phone only until Firebase is connected.')} /> : null}
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
    if (!name.trim()) { setErr(t('Give the vehicle a name.')); return; }
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
    } catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save the changes.')); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h2">{t('Edit vehicle')}</T>
      <Field label={t('Name')} value={name} onChangeText={setName} maxLength={60} />
      <Field label={t('Number plate')} hint={t('optional')} value={plate} onChangeText={(x) => setPlate(x.toUpperCase())} autoCapitalize="characters" maxLength={14} />
      <T v="medium">{t('Type')}</T>
      <Row>{CLASSES.map((k) => <Chip key={k.id} text={t(k.name)} on={k.id === cls} onPress={() => { setCls(k.id); if (CLS[k.id].body !== CLS[cls].body) { setRear(k.rear); setSlide('unknown'); } }} />)}</Row>
      <T v="hint">{t('Changing the type changes the photo frames.')}</T>
      {SLIDE_BODIES[CLS[cls].body] ? (
        <><T v="medium">{t('Sliding doors')}</T>
          <Row>{([['right', t('Right side')], ['left', t('Left side')], ['both', t('Both sides')], ['none', t('None')], ['unknown', t('Not sure')]] as const).map(([k, label]) => <Chip key={k} text={label} on={slide === k} onPress={() => setSlide(k)} />)}</Row></>
      ) : null}
      {s.role === 'owner' && s.stations.length > 1 ? (
        <><T v="medium">{t('Station')}</T><Row>{s.stations.map((st) => <Chip key={st.id} text={st.name} on={st.id === station} onPress={() => setStation(st.id)} />)}</Row>
          {station !== v.stationId && v.assignedTo ? <T v="hint" color={c.alert}>{t('{name} stays at {station}, so the van becomes free.', { name: v.assignedTo.driverName, station: s.stationName(v.stationId) })}</T> : null}</>
      ) : null}
      <T v="medium">{t('Rear')}</T>
      <Row>{(Object.keys(REAR_PILL) as RearKind[]).map((k) => <Chip key={k} text={t(REAR_PILL[k])} on={rear === k} onPress={() => setRear(k)} />)}</Row>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row><Button v="primary" title={t('Save changes')} loading={busy} onPress={save} /><Button v="link" title={t('Cancel')} onPress={onDone} /></Row>
    </Card>
  );
}
