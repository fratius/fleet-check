import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { FramesPanel } from '@/components/frames';
import { Button, Card, Chip, Field, Notice, Photo, Pill, Row, Screen, Segmented, T, secs, useColors } from '@/components/ui';
import { CLASSES, CLS, attrPills, defaultAttrs, makeSpec, type VehicleAttrs } from '@/lib/frames';
import { t } from '@/lib/i18n';
import { newId, prepare, upload } from '@/lib/images';
import { retrying } from '@/lib/net';
import { useSession } from '@/lib/session';
import { ai, failText } from '@/lib/store';
import { TIERS, TIER_NAME, type IdentifyResult } from '@/lib/types';
import { plateKey, vanName } from '@/lib/vans';

type Shot = { uri: string; w: number; h: number };

export default function AddVehicle() {
  const s = useSession();
  const c = useColors();
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<(IdentifyResult & { uploadMs: number; totalMs: number }) | null>(null);
  const [cls, setCls] = useState<string | null>(null);
  const [attrs, setAttrs] = useState<VehicleAttrs>(defaultAttrs());
  const [picking, setPicking] = useState(false);
  // A van is known by its plate (lib/vans.ts); its own name or fleet number is optional, never the model.
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [plateErr, setPlateErr] = useState<string | null>(null);
  // The plate the scan read from the photos (functions: readPlate). It fills the field; the person checks it.
  const [plateRead, setPlateRead] = useState<{ text: string; sure: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const aiOn = s.mode === 'firebase';
  // Stations this person can add vans to: every station for owners, their own for managers.
  const canAddTo = s.mode === 'local' ? s.stations : s.myStations.filter((st) => s.runs(st.id));
  const [stationPick, setStationPick] = useState<string | null>(null);
  const stationId = stationPick && canAddTo.some((st) => st.id === stationPick) ? stationPick : canAddTo[0]?.id || null;

  const choose = (id: string, a: VehicleAttrs) => { setCls(id); setAttrs(a); };

  const addShots = async (from: 'camera' | 'library') => {
    setErr(null);
    try {
      if (from === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) { setErr(t('Allow camera access in Settings to take photos.')); return; }
      }
      const r = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3 - shots.length, quality: 0.9 });
      if (r.canceled) return;
      setShots((prev) => [...prev, ...r.assets.map((a) => ({ uri: a.uri, w: a.width, h: a.height }))].slice(0, 3));
    } catch { setErr(t('Couldn\'t open the camera or photos.')); }
  };

  const identify = async () => {
    if (!shots.length) { setErr(t('Add at least one photo of the vehicle first.')); return; }
    setErr(null); setRes(null);
    const t0 = Date.now();
    try {
      setBusy(t('Uploading photos'));
      const scanId = newId();
      const paths = await Promise.all(shots.map(async (sh, i) => {
        const p = await prepare(sh.uri, sh.w, sh.h);
        return upload(p.uri, `orgs/${s.store!.orgId}/scans/${scanId}/${i + 1}.jpg`);
      }));
      const uploadMs = Date.now() - t0;
      setBusy(t('Identifying'));
      const r = await retrying(() => ai.identify({ orgId: s.store!.orgId, scanId, paths, tier: s.tier, stationId }));
      setRes({ ...r, uploadMs, totalMs: Date.now() - t0 });
      setPicking(false);
      // The plate from the photos goes into the field, unless the person typed one themselves. Photos without a
      // readable plate leave the field as it was.
      const read = r.plate ?? null;
      if (read) {
        const before = plateRead?.text;
        setPlateRead(read);
        setPlate((cur) => (!cur.trim() || cur === before ? read.text : cur));
        setPlateErr(null);
      }
      if (r.scan.predicted && CLS[r.scan.predicted]) {
        choose(r.scan.predicted, { roof: r.scan.roof, slideL: r.scan.slideL, slideR: r.scan.slideR, rear: r.scan.rear });
      }
    } catch (e) {
      // A photo that can't be opened, a refused upload, the server: each in its own words (lib/store.ts).
      setErr(failText(e, 'Identifying the vehicle type'));
    } finally { setBusy(null); }
  };

  const verdict = async (v: 'correct' | 'wrong' | null, actual: string | null) => {
    if (!res) return;
    const scan = { ...res.scan, verdict: v, actual };
    setRes({ ...res, scan });
    try { await s.store!.scans.update(res.scan.id, { verdict: v, actual }); } catch { setErr(t('Couldn\'t save your answer.')); }
  };

  const pickType = (id: string) => {
    const sameBody = res?.scan.predicted && CLS[res.scan.predicted]?.body === CLS[id].body;
    choose(id, sameBody ? { roof: res!.scan.roof, slideL: res!.scan.slideL, slideR: res!.scan.slideR, rear: res!.scan.rear } : defaultAttrs());
    if (picking && res) { setPicking(false); verdict(id === res.scan.predicted ? 'correct' : 'wrong', id); }
  };

  const save = async () => {
    if (!cls) return;
    const pk = plateKey(plate);
    if (!pk) { setPlateErr(t('Enter the number plate: it\'s how this van is shown everywhere.')); return; }
    const same = s.vehicles.find((v) => plateKey(v.plate) === pk);
    if (same) { setPlateErr(t('{plate} is already in your fleet.', { plate: vanName(same) })); return; }
    if (!stationId) { setErr(t('Add a station under People first.')); return; }
    if (full) { setErr(fullText); return; }
    setSaving(true);
    try {
      const fromScan = res?.scan.predicted ? res.scan : null;
      const id = await s.store!.vehicles.add({
        name: name.trim().slice(0, 60), plate: plate.trim().toUpperCase().slice(0, 14), cls,
        roof: attrs.roof, slideL: attrs.slideL, slideR: attrs.slideR, rear: attrs.rear,
        make: fromScan?.vMake ?? null, model: fromScan?.vModel ?? null, scanId: fromScan?.id ?? null, stationId,
        createdAt: Date.now(), createdBy: s.user?.uid ?? null,
      });
      setShots([]); setRes(null); setCls(null); setName(''); setPlate(''); setPlateRead(null); setAttrs(defaultAttrs());
      // Replace the form, so Back from the new van goes to the fleet, not to the empty form.
      router.replace(`/vehicle/${id}`);
    } catch (e) { setErr(failText(e, 'Saving the vehicle')); }
    finally { setSaving(false); }
  };

  const sp = cls ? makeSpec(cls, attrs) : null;
  const sc = res?.scan;
  // The plan's vans are all in use (firestore.rules refuses another): the add-on of 15, or the next plan.
  const maxVans = s.org?.billing?.vans;
  const full = maxVans != null && (s.org?.fleetSize || 0) >= maxVans && !s.creator;
  const fullText = s.role === 'owner'
    ? t('Your plan is for {n} vans and they are all in use. Add 15 more vans, or choose a bigger plan, under Account, then Plan and billing.', { n: maxVans ?? 0 })
    : t('The company\'s plan is for {n} vans and they are all in use. Ask the owner for more room.', { n: maxVans ?? 0 });
  const conf = sc?.confidence;
  // What the field holds came from the photos (and wasn't changed): say so, and whether it's a van already in the fleet.
  const fromPhoto = !!plateRead && plate === plateRead.text;
  const seen = fromPhoto ? s.vehicles.find((v) => plateKey(v.plate) === plateKey(plate)) : undefined;
  return (
    <Screen edges={[]}>
      <View style={{ gap: 4 }}>
        <T v="h1">{t('Add vehicle')}</T>
        <T v="hint">{t('Scan it and the app picks its type, or pick the type yourself.')}</T>
      </View>
      {full ? (
        <Card>
          <Notice tone="bad" text={fullText} />
          {s.role === 'owner' && Platform.OS === 'web' ? <Button v="primary" title={t('Plan and billing')} onPress={() => router.push('/plan')} /> : null}
        </Card>
      ) : null}

      <Card>
        <T v="h2">{t('Scan it')}</T>
        {aiOn ? (
          <>
            <T v="hint">{t('One photo from a front corner, with the number plate in view, works best. Add the side or the rear to pick up door details.')}</T>
            <Row>
              {shots.map((sh, i) => (
                <Pressable key={sh.uri} accessibilityLabel={t('Remove photo {n}', { n: i + 1 })} onPress={() => setShots(shots.filter((_, k) => k !== i))}>
                  <Photo src={{ uri: sh.uri }} style={{ width: 96, height: 72 }} />
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' }}><T v="medium" color="#000" style={{ lineHeight: 18 }}>×</T></View>
                </Pressable>
              ))}
            </Row>
            <Row>
              <Button title={t('Take photo')} disabled={shots.length >= 3 || !!busy} onPress={() => addShots('camera')} />
              <Button title={t('Choose photos')} disabled={shots.length >= 3 || !!busy} onPress={() => addShots('library')} />
            </Row>
            {s.seesAiStats ? <Row><T v="hint">{t('AI model')}</T><Segmented label={t('AI model')} value={s.tier} onChange={s.setTier} options={TIERS.map(([k, l]) => [k, t(l)] as [typeof k, string])} /></Row> : null}
            <Button v="primary" wide title={busy ? busy + '…' : t('Identify the type')} loading={!!busy} disabled={!!busy} onPress={identify} />
            <T v="small">{t('Photos are stored with the scan in your company\'s storage.')}</T>
          </>
        ) : (
          <T v="hint">{t('Identifying from photos needs the Firebase backend. Until it\'s connected, pick the type below.')}</T>
        )}
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      </Card>

      {sc ? (
        <Card>
          {s.seesAiStats && sc.ms != null ? <T v="hint">{t('Identified in {time} with the {tier} model ({model}). Upload took {upload}.', { time: secs(sc.ms), tier: t(TIER_NAME[sc.tier]), model: sc.model, upload: secs(res!.uploadMs) })}</T> : null}
          {sc.predicted && CLS[sc.predicted] ? <T v="h1">{t(CLS[sc.predicted].name)}</T> : <T v="h1">{t('No vehicle found')}</T>}
          {sc.vMake || sc.vModel ? <T v="medium">{t('Looks like a {model}', { model: [sc.vMake, sc.vModel].filter(Boolean).join(' ') })}</T> : null}
          <Row>
            {conf != null ? <Pill v={conf >= 0.8 ? 'good' : conf >= 0.55 ? 'default' : 'bad'} text={(conf >= 0.8 ? t('High confidence, {pct}%', { pct: Math.round(conf * 100) }) : conf >= 0.55 ? t('Medium confidence, {pct}%', { pct: Math.round(conf * 100) }) : t('Low confidence, {pct}%', { pct: Math.round(conf * 100) }))} /> : null}
            {s.seesAiStats && sc.cost != null ? <Pill v="muted" text={t('Est. cost {cost}', { cost: `$${sc.cost.toFixed(4)}` })} /> : null}
          </Row>
          {res!.reason ? <T v="hint">{res!.reason}</T> : null}
          {res!.alternatives.length ? <T v="hint">{t('Also close: {types}.', { types: res!.alternatives.map((a) => (CLS[a.cls] ? t(CLS[a.cls].name) : '')).filter(Boolean).join(' / ') })}</T> : null}
          {res!.issues.map((i) => <T key={i} v="hint" color={c.alert}>• {i}</T>)}
          <View style={{ borderTopWidth: 2, borderColor: c.ink, paddingTop: 12, gap: 8 }}>
            {picking ? <T v="medium">{t('Tap the type it really is, below.')}</T>
              : sc.verdict ? <Row><Pill v={sc.verdict === 'correct' ? 'good' : 'bad'} text={sc.verdict === 'correct' ? t('Marked right') : t('Marked wrong. Actual type: {type}', { type: CLS[sc.actual || ''] ? t(CLS[sc.actual || ''].name) : '?' })} /><Button v="link" small title={t('Change')} onPress={() => verdict(null, null)} /></Row>
              : <><T v="h3">{sc.predicted ? t('Is {type} the right type?', { type: CLS[sc.predicted] ? t(CLS[sc.predicted].lower) : '' }) : t('Is it right that there\'s no vehicle?')}</T>
                  <Row><Button v="primary" small title={t('Yes, right')} onPress={() => verdict('correct', sc.predicted)} /><Button small title={t('No, wrong')} onPress={() => setPicking(true)} /></Row></>}
          </View>
        </Card>
      ) : null}

      <Card style={picking ? { backgroundColor: '#E2FF1C', borderColor: '#000' } : undefined}>
        <T v="hint" color={picking ? '#000' : undefined}>{picking ? t('Tap the type it really is') : cls ? t('Change the type') : aiOn ? t('Or pick the type yourself') : t('Pick the type')}</T>
        <Row>{CLASSES.map((k) => <Chip key={k.id} text={t(k.name)} on={k.id === cls} onPress={() => pickType(k.id)} />)}</Row>
      </Card>

      {sp && cls ? (
        <>
          <Card>
            <T v="h2">{t('Save to the fleet')}</T>
            <Row>{attrPills(sp, attrs, undefined).map((p) => <Pill key={p} text={t(p)} />)}</Row>
            <Field label={t('Number plate')} value={plate} error={plateErr} onChangeText={(x) => { setPlate(x.toUpperCase()); setPlateErr(null); }} autoCapitalize="characters" autoCorrect={false} maxLength={14} placeholder="B-DX 1234" />
            {plateErr ? null
              : seen ? <T v="hint" color={c.alert}>{t('{plate} is already in your fleet.', { plate: vanName(seen) })}</T>
              : fromPhoto ? <T v="hint" color={plateRead!.sure ? undefined : c.alert}>{plateRead!.sure ? t('Read from the photo. Check it against the van.') : t('Read from the photo, but not clearly. Check each character against the van.')}</T>
              // `plate` is missing (not null) in answers from a server before the plate was read.
              : res && res.plate === null && !plate.trim() ? <T v="hint">{t('The plate couldn\'t be read from the photos. Type it in.')}</T>
              : null}
            <Field label={t('Own name or fleet number')} hint={t('optional')} value={name} onChangeText={setName} maxLength={60} />
            {canAddTo.length > 1 ? (
              <><T v="medium">{t('Station')}</T><Row>{canAddTo.map((st) => <Chip key={st.id} text={st.name} on={st.id === stationId} onPress={() => setStationPick(st.id)} />)}</Row></>
            ) : canAddTo.length === 1 ? <T v="hint">{t('Station: {station}', { station: canAddTo[0].name })}</T> : <T v="hint" color={c.alert}>{t('You aren\'t managing a station yet.')}</T>}
            <Button v="primary" wide title={t('Save to the fleet')} loading={saving} disabled={!stationId} onPress={save} />
          </Card>
          <FramesPanel sp={sp} title={t('Frames for this type')} />
        </>
      ) : null}
      {s.mode === 'local' ? <Notice text={t('Not connected to Firebase yet: vehicles are saved on this phone only.')} /> : null}
    </Screen>
  );
}
