import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { FramesPanel } from '@/components/frames';
import { Button, Card, Chip, Field, Notice, Photo, Pill, Row, Screen, Segmented, T, secs, useColors } from '@/components/ui';
import { CLASSES, CLS, attrPills, defaultAttrs, makeSpec, type VehicleAttrs } from '@/lib/frames';
import { newId, prepare, upload } from '@/lib/images';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { TIERS, TIER_NAME, type IdentifyResult } from '@/lib/types';

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
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [plate, setPlate] = useState('');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const aiOn = s.mode === 'firebase';

  const suggest = (base: string) => {
    let n = base, k = 2;
    while (s.vehicles.some((v) => v.name.toLowerCase() === n.toLowerCase())) n = `${base} ${k++}`;
    return n;
  };
  const choose = (id: string, a: VehicleAttrs, base?: string) => {
    setCls(id); setAttrs(a);
    if (!nameTouched) setName(suggest(base || CLS[id].name));
  };

  const addShots = async (from: 'camera' | 'library') => {
    setErr(null);
    try {
      if (from === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) { setErr('Allow camera access in Settings to take photos.'); return; }
      }
      const r = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3 - shots.length, quality: 0.9 });
      if (r.canceled) return;
      setShots((prev) => [...prev, ...r.assets.map((a) => ({ uri: a.uri, w: a.width, h: a.height }))].slice(0, 3));
    } catch { setErr('Couldn\'t open the camera or photos.'); }
  };

  const identify = async () => {
    if (!shots.length) { setErr('Add at least one photo of the vehicle first.'); return; }
    setErr(null); setRes(null);
    const t0 = Date.now();
    try {
      setBusy('Uploading photos');
      const scanId = newId();
      const paths = await Promise.all(shots.map(async (sh, i) => {
        const p = await prepare(sh.uri, sh.w, sh.h);
        return upload(p.uri, `orgs/${s.store!.orgId}/scans/${scanId}/${i + 1}.jpg`);
      }));
      const uploadMs = Date.now() - t0;
      setBusy('Identifying');
      const r = await ai.identify({ orgId: s.store!.orgId, scanId, paths, tier: s.tier });
      setRes({ ...r, uploadMs, totalMs: Date.now() - t0 });
      setPicking(false);
      if (r.scan.predicted && CLS[r.scan.predicted]) {
        choose(r.scan.predicted, { roof: r.scan.roof, slideL: r.scan.slideL, slideR: r.scan.slideR, rear: r.scan.rear },
          [r.scan.vMake, r.scan.vModel].filter(Boolean).join(' ') || undefined);
      }
    } catch (e) {
      setErr(e instanceof AiError ? e.message : 'Couldn\'t upload the photos. Check the connection and try again.');
    } finally { setBusy(null); }
  };

  const verdict = async (v: 'correct' | 'wrong' | null, actual: string | null) => {
    if (!res) return;
    const scan = { ...res.scan, verdict: v, actual };
    setRes({ ...res, scan });
    try { await s.store!.scans.update(res.scan.id, { verdict: v, actual }); } catch { setErr('Couldn\'t save your answer.'); }
  };

  const pickType = (id: string) => {
    const sameBody = res?.scan.predicted && CLS[res.scan.predicted]?.body === CLS[id].body;
    choose(id, sameBody ? { roof: res!.scan.roof, slideL: res!.scan.slideL, slideR: res!.scan.slideR, rear: res!.scan.rear } : defaultAttrs());
    if (picking && res) { setPicking(false); verdict(id === res.scan.predicted ? 'correct' : 'wrong', id); }
  };

  const save = async () => {
    if (!cls) return;
    if (!name.trim()) { setNameErr('Give the vehicle a name, for example its model or fleet number.'); return; }
    setSaving(true);
    try {
      const fromScan = res?.scan.predicted ? res.scan : null;
      const id = await s.store!.vehicles.add({
        name: name.trim().slice(0, 60), plate: plate.trim().toUpperCase().slice(0, 14), cls,
        roof: attrs.roof, slideL: attrs.slideL, slideR: attrs.slideR, rear: attrs.rear,
        make: fromScan?.vMake ?? null, model: fromScan?.vModel ?? null, scanId: fromScan?.id ?? null,
        createdAt: Date.now(), createdBy: s.user?.uid ?? null,
      });
      setShots([]); setRes(null); setCls(null); setName(''); setPlate(''); setNameTouched(false); setAttrs(defaultAttrs());
      router.push(`/vehicle/${id}`);
    } catch { setErr('Couldn\'t save the vehicle. Try again.'); }
    finally { setSaving(false); }
  };

  const sp = cls ? makeSpec(cls, attrs) : null;
  const sc = res?.scan;
  const conf = sc?.confidence;
  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">Add vehicle</T>
        <T v="hint">Scan it and the app picks its type, or pick the type yourself.</T>
      </View>

      <Card>
        <T v="h2">Scan it</T>
        {aiOn ? (
          <>
            <T v="hint">One photo from a front corner works best. Add the side or the rear to pick up door details.</T>
            <Row>
              {shots.map((sh, i) => (
                <Pressable key={sh.uri} accessibilityLabel={`Remove photo ${i + 1}`} onPress={() => setShots(shots.filter((_, k) => k !== i))}>
                  <Photo src={{ uri: sh.uri }} style={{ width: 96, height: 72 }} />
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' }}><T v="medium" color="#000" style={{ lineHeight: 18 }}>×</T></View>
                </Pressable>
              ))}
            </Row>
            <Row>
              <Button title="Take photo" disabled={shots.length >= 3 || !!busy} onPress={() => addShots('camera')} />
              <Button title="Choose photos" disabled={shots.length >= 3 || !!busy} onPress={() => addShots('library')} />
            </Row>
            <Row><T v="hint">AI model</T><Segmented label="AI model" value={s.tier} onChange={s.setTier} options={TIERS} /></Row>
            <Button v="primary" wide title={busy ? busy + '…' : 'Identify the type'} loading={!!busy} disabled={!!busy} onPress={identify} />
            <T v="small">Photos are stored with the scan in your company&apos;s storage.</T>
          </>
        ) : (
          <T v="hint">Identifying from photos needs the Firebase backend. Until it&apos;s connected, pick the type below.</T>
        )}
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      </Card>

      {sc ? (
        <Card>
          <T v="hint">Identified in {secs(sc.ms)} with the {TIER_NAME[sc.tier]} model ({sc.model}). Upload took {secs(res!.uploadMs)}.</T>
          {sc.predicted && CLS[sc.predicted] ? <T v="h1">{CLS[sc.predicted].name}</T> : <T v="h1">No vehicle found</T>}
          {sc.vMake || sc.vModel ? <T v="medium">Looks like a {[sc.vMake, sc.vModel].filter(Boolean).join(' ')}</T> : null}
          <Row>
            {conf != null ? <Pill v={conf >= 0.8 ? 'good' : conf >= 0.55 ? 'default' : 'bad'} text={`${conf >= 0.8 ? 'High' : conf >= 0.55 ? 'Medium' : 'Low'} confidence, ${Math.round(conf * 100)}%`} /> : null}
            <Pill v="muted" text={`Est. cost $${sc.cost.toFixed(4)}`} />
          </Row>
          {res!.reason ? <T v="hint">{res!.reason}</T> : null}
          {res!.alternatives.length ? <T v="hint">Also close: {res!.alternatives.map((a) => CLS[a.cls]?.name).filter(Boolean).join(' or ')}.</T> : null}
          {res!.issues.map((i) => <T key={i} v="hint" color={c.alert}>• {i}</T>)}
          <View style={{ borderTopWidth: 2, borderColor: c.ink, paddingTop: 12, gap: 8 }}>
            {picking ? <T v="medium">Tap the type it really is, below.</T>
              : sc.verdict ? <Row><Pill v={sc.verdict === 'correct' ? 'good' : 'bad'} text={sc.verdict === 'correct' ? 'Marked right' : `Marked wrong. Actual type: ${CLS[sc.actual || '']?.name || '?'}`} /><Button v="link" small title="Change" onPress={() => verdict(null, null)} /></Row>
              : <><T v="h3">{sc.predicted ? `Is ${CLS[sc.predicted]?.lower} the right type?` : 'Is it right that there\'s no vehicle?'}</T>
                  <Row><Button v="primary" small title="Yes, right" onPress={() => verdict('correct', sc.predicted)} /><Button small title="No, wrong" onPress={() => setPicking(true)} /></Row></>}
          </View>
        </Card>
      ) : null}

      <Card style={picking ? { backgroundColor: '#E2FF1C', borderColor: '#000' } : undefined}>
        <T v="hint" color={picking ? '#000' : undefined}>{picking ? 'Tap the type it really is' : cls ? 'Change the type' : aiOn ? 'Or pick the type yourself' : 'Pick the type'}</T>
        <Row>{CLASSES.map((k) => <Chip key={k.id} text={k.name} on={k.id === cls} onPress={() => pickType(k.id)} />)}</Row>
      </Card>

      {sp && cls ? (
        <>
          <Card>
            <T v="h2">Save to the fleet</T>
            <Row>{attrPills(sp, attrs, undefined).map((p) => <Pill key={p} text={p} />)}</Row>
            <Field label="Name" value={name} error={nameErr} onChangeText={(t) => { setName(t); setNameTouched(true); setNameErr(null); }} maxLength={60} />
            <Field label="Number plate" hint="optional" value={plate} onChangeText={(t) => setPlate(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={14} />
            <Button v="primary" wide title="Save to the fleet" loading={saving} onPress={save} />
          </Card>
          <FramesPanel sp={sp} title="Frames for this type" />
        </>
      ) : null}
      {s.mode === 'local' ? <Notice text="Not connected to Firebase yet: vehicles are saved on this phone only." /> : null}
    </Screen>
  );
}
