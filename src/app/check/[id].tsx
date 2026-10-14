import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BackBar } from '@/components/nav';
import { Button, Card, F, MARKER, Photo, Pill, Row, Screen, T, ZoomPhoto, cap, secs, usd, useColors, type PillV } from '@/components/ui';
import { newId, prepare, upload } from '@/lib/images';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { TIER_NAME, type Check, type Usage, type VerdictKind } from '@/lib/types';

const VERDICT: Record<VerdictKind, [string, PillV]> = {
  damage: ['Damage', 'bad'], dirt: ['Dirt or residue', 'good'], reflection: ['Reflection', 'good'], no_damage: ['No damage', 'good'],
  unclear: ['Unclear', 'muted'], skipped: ['Not checked', 'muted'],
};

function useTicker(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), 200); return () => clearInterval(t); }, [on]);
}

export default function CheckScreen() {
  const { id, walk } = useLocalSearchParams<{ id: string; walk?: string }>();
  return id === 'new' ? <NewCheck walkId={walk || ''} /> : <CheckView id={id} />;
}

function NewCheck({ walkId }: { walkId: string }) {
  const s = useSession();
  const c = useColors();
  const w = s.walks.find((x) => x.id === walkId);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const t0 = useRef(Date.now());
  const started = useRef(-1);
  useTicker(!err);
  useEffect(() => {
    if (started.current === attempt || !s.store) return;
    started.current = attempt;
    t0.current = Date.now();
    ai.findDamage({ orgId: s.store.orgId, walkId, tier: s.tier })
      .then((r) => router.replace(`/check/${r.checkId}`))
      .catch((e) => setErr(e instanceof AiError ? e.message : 'The check didn\'t finish. Try again.'));
  }, [s.store, s.tier, walkId, attempt]);
  return (
    <Screen>
      <BackBar title="Back" />
      <View style={{ gap: 4 }}>
        <T v="hint">Damage check{w ? ', ' + w.vehicleName : ''}</T>
        <T v="h1">{err ? 'The check didn\'t finish' : `Looking for damage in ${w ? w.photos.length : ''} photos`}</T>
      </View>
      {err ? (
        <Card><T color={c.alert}>{err}</T><Row><Button v="primary" title="Try again" onPress={() => { setErr(null); setAttempt((a) => a + 1); }} /></Row></Card>
      ) : (
        <Card>
          <T v="big">{((Date.now() - t0.current) / 1000).toFixed(1)} s</T>
          <ActivityIndicator color={c.ink} style={{ alignSelf: 'flex-start' }} />
          <T v="hint">The {TIER_NAME[s.tier]} model looks at every photo at full resolution. This usually takes under a minute.</T>
        </Card>
      )}
    </Screen>
  );
}

type Local = Record<number, (string | null)[]>;

function CheckView({ id }: { id: string }) {
  const s = useSession();
  const c = useColors();
  const k = s.checks.find((x) => x.id === id);
  const [phase, setPhase] = useState<'list' | 'capture' | 'running'>('list');
  const [i, setI] = useState(0);
  const [local, setLocal] = useState<Local>({});
  const [run, setRun] = useState<{ done: number; total: number; t0: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useTicker(phase === 'running');

  if (!k) return <Screen><BackBar title="Back" /><Card dashed><T v="hint">{s.loaded.checks ? 'This check was deleted.' : 'Loading…'}</T></Card></Screen>;
  const n = k.spots.length;
  const checked = k.spots.some((p) => p.verdict);
  const noteVal = note ?? k.missedNote ?? '';

  const shot = async (spot: number, slot: number) => {
    setErr(null);
    try {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) { setErr('Allow camera access in Settings to take close-ups.'); return; }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (r.canceled) return;
      const a = r.assets[0];
      const prep = await prepare(a.uri, a.width, a.height);
      setLocal((L) => { const cur = (L[spot] || [null, null]).slice(); cur[slot] = prep.uri; return { ...L, [spot]: cur }; });
    } catch { setErr('Couldn\'t open the camera.'); }
  };

  const runPass2 = async (L: Local = local) => {
    const todo = k.spots.map((_, j) => j).filter((j) => (L[j] || []).some(Boolean));
    if (!todo.length) { await s.store!.checks.update(k.id, { spots: k.spots.map((p) => p.verdict ? p : { ...p, verdict: { verdict: 'skipped', type: null, sizeCm: null, severity: null, confidence: null, reason: '', ms: null, closeupBox: null } }) }); setPhase('list'); return; }
    setPhase('running'); setErr(null);
    setRun({ done: 0, total: todo.length, t0: Date.now() });
    const queue = todo.slice();
    let failed = 0;
    const worker = async () => {
      while (queue.length) {
        const j = queue.shift()!;
        try {
          const uris = (L[j] || []).filter(Boolean) as string[];
          const paths = await Promise.all(uris.map((u, m) => upload(u, `orgs/${s.store!.orgId}/checks/${k.id}/spot${j + 1}_${m + 1}_${newId()}.jpg`)));
          await ai.checkSpot({ orgId: s.store!.orgId, checkId: k.id, spot: j, closeups: paths, tier: s.tier });
        } catch (e) { failed++; setErr(e instanceof AiError ? e.message : 'Some close-ups couldn\'t be checked. Try again.'); }
        setRun((r) => (r ? { ...r, done: r.done + 1 } : r));
      }
    };
    await Promise.all([worker(), worker()]);
    setPhase('list');
    if (!failed) setLocal({});
  };

  const feedback = async (j: number, v: 'right' | 'wrong' | null) => {
    try { await s.store!.checks.update(k.id, { spots: k.spots.map((p, m) => (m === j ? { ...p, feedback: v } : p)) }); } catch { setErr('Couldn\'t save your answer.'); }
  };

  if (phase === 'running' && run) {
    return (
      <Screen>
        <View style={{ gap: 4 }}><T v="hint">Damage check, {k.vehicleName}</T><T v="h1">Checking the close-ups, spot {Math.min(run.done + 1, run.total)} of {run.total}</T></View>
        <Card><T v="big">{((Date.now() - run.t0) / 1000).toFixed(1)} s</T><ActivityIndicator color={c.ink} style={{ alignSelf: 'flex-start' }} /></Card>
      </Screen>
    );
  }

  if (phase === 'capture') {
    const p = k.spots[i];
    const mine = local[i] || [null, null];
    const last = i === n - 1;
    return (
      <Screen>
        <BackBar title="Spots" onPress={() => setPhase('list')} />
        <View style={{ gap: 4 }}><T v="hint">Close-up {i + 1} of {n}</T><T v="h1">{cap(p.panel)}</T></View>
        <ZoomPhoto src={p.refPath} caption={`${cap(p.panel)}, ${p.photoLabel}`} style={{ width: '100%', aspectRatio: 4 / 3, borderWidth: 2, borderColor: c.ink }} contentFit="contain" />
        <View style={{ gap: 6 }}>
          <T>1. Find the spot in the yellow box.{p.closeup ? ' ' + p.closeup : ''}</T>
          <T>2. Wipe it with your hand or a cloth.</T>
          <T>3. Take one photo straight on, about 30 to 50 cm away.</T>
          <T>4. Take a second from a low angle along the panel. It shows whether a mark is a scratch or a reflection.</T>
        </View>
        <Row gap={10}>
          {['Straight on', 'Low angle, optional'].map((label, m) => (
            <View key={label} style={{ flex: 1, minWidth: 140, gap: 6 }}>
              <View style={{ aspectRatio: 3 / 4, borderWidth: 2, borderStyle: mine[m] ? 'solid' : 'dashed', borderColor: mine[m] ? c.ink : c.ink2, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {mine[m] ? <Image source={{ uri: mine[m]! }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <T v="hint">{label}</T>}
              </View>
              <Button small v={mine[m] ? 'secondary' : m === 0 ? 'primary' : 'secondary'} title={mine[m] ? 'Retake' : 'Take photo'} onPress={() => shot(i, m)} />
            </View>
          ))}
        </Row>
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        <Row>
          <Button v="primary" title={last ? 'Check the close-ups' : 'Next spot'} disabled={!mine.some(Boolean)} onPress={() => (last ? runPass2() : setI(i + 1))} />
          <Button v="link" title={last ? 'Skip and check' : 'Skip this spot'} onPress={() => { const L = { ...local, [i]: [null, null] }; setLocal(L); if (last) runPass2(L); else setI(i + 1); }} />
          {i > 0 ? <Button v="link" title="Back" onPress={() => setI(i - 1)} /> : null}
        </Row>
      </Screen>
    );
  }

  const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
  const cleared = k.spots.filter((p) => ['dirt', 'reflection', 'no_damage'].includes(p.verdict?.verdict || '')).length;
  const open = n - dmg - cleared;
  return (
    <Screen>
      <BackBar title={k.vehicleName} onPress={() => router.replace(`/vehicle/${k.vehicleId}`)} />
      <View style={{ gap: 6 }}>
        <T v="hint">Damage check, {k.vehicleName}</T>
        <T v="h1">{!n ? 'No damage found' : checked ? (dmg ? `${dmg} damage${dmg === 1 ? '' : 's'} confirmed` : 'No damage confirmed') : `${n} spot${n === 1 ? '' : 's'} to check`}</T>
        <T>{!n ? 'Nothing in these photos looked like damage. Small chips and dents can still be there.'
          : checked ? `${cleared} cleared as dirt, reflection or no damage.${open ? ` ${open} still open.` : ''}`
            : 'These might be damage, dirt or reflections. Close-ups of each spot will tell.'}</T>
      </View>
      <CostPanel k={k} />
      {n > 0 && !checked ? <Button v="primary" wide title={`Take close-ups of ${n} spot${n === 1 ? '' : 's'}`} onPress={() => { setI(0); setPhase('capture'); }} /> : null}
      {n > 0 && checked && open > 0 ? <Button title="Take more close-ups" onPress={() => { setI(k.spots.findIndex((p) => !p.verdict || p.verdict.verdict === 'unclear' || p.verdict.verdict === 'skipped')); setPhase('capture'); }} /> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      {k.spots.map((p, j) => {
        const v = p.verdict;
        return (
          <Card key={j}>
            <Row>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: MARKER, borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                <T v="h3" color="#000" style={{ fontFamily: F.condBold, fontSize: 17, lineHeight: 20 }}>{j + 1}</T>
              </View>
              <T v="h3" style={{ flex: 1 }}>{cap(p.panel)}</T>
            </Row>
            <Row>
              {v ? <Pill v={VERDICT[v.verdict][1]} text={VERDICT[v.verdict][0]} /> : <Pill v={p.conf >= 0.6 ? 'bad' : 'amber'} text={`${p.conf >= 0.6 ? 'Likely' : 'Possible'}, ${Math.round(p.conf * 100)}%`} />}
              <Pill text={`${cap(v?.verdict === 'damage' ? v.type || p.type : p.type)}${(v?.sizeCm || p.sizeCm) ? `, about ${v?.sizeCm || p.sizeCm} cm` : ''}`} />
              {v?.severity ? <Pill text={v.severity === 'repair' ? 'Bodyshop repair' : 'Cosmetic'} /> : null}
              {v?.ms ? <Pill v="muted" text={secs(v.ms)} /> : null}
            </Row>
            {v?.reason ? <T>{v.reason}</T> : !v && p.mightBe ? <T v="hint">Could also be {p.mightBe}.</T> : null}
            {/* Flex 16 : 9 makes the 4:3 crop and the 3:4 close-ups the same height. Tap any photo to see it full screen. */}
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <View style={{ flex: 16, minWidth: 0, gap: 3 }}>
                <ZoomPhoto src={p.refPath} caption={`${cap(p.panel)}, ${p.photoLabel}`} style={{ width: '100%', aspectRatio: 4 / 3 }} />
                <T v="small" numberOfLines={2}>{p.photoLabel}</T>
              </View>
              {p.closeups.map((cp, m) => {
                const label = m === 0 ? (p.markPath ? 'Straight on, damage boxed' : 'Straight on') : 'Low angle';
                return (
                  <View key={cp} style={{ flex: 9, minWidth: 0, gap: 3 }}>
                    <ZoomPhoto src={m === 0 && p.markPath ? p.markPath : cp} caption={`${cap(p.panel)}, ${label.toLowerCase()}`} style={{ width: '100%', aspectRatio: 3 / 4 }} />
                    <T v="small" numberOfLines={2}>{label}</T>
                  </View>
                );
              })}
            </View>
            {v && v.verdict !== 'skipped' ? (
              <Row style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <T v="hint">Is this right?</T>
                {p.feedback ? <><Pill v={p.feedback === 'right' ? 'good' : 'bad'} text={`Marked ${p.feedback}`} /><Button v="link" small title="Change" onPress={() => feedback(j, null)} /></>
                  : <><Button small title="Right" onPress={() => feedback(j, 'right')} /><Button small title="Wrong" onPress={() => feedback(j, 'wrong')} /></>}
              </Row>
            ) : null}
          </Card>
        );
      })}
      {k.notVisible?.length ? <T v="hint">Not visible in these photos: {k.notVisible.join('; ')}.</T> : null}
      <Card>
        <T v="h3">Damage it missed</T>
        <T v="hint">Where it is and what it is. This is how we measure what the AI misses.</T>
        <TextInput multiline value={noteVal} onChangeText={setNote} placeholder="For example: dent in the right rear door, 3 cm, below the handle" placeholderTextColor={c.ink2}
          style={{ minHeight: 80, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 10, fontFamily: F.body, fontSize: 16, color: c.ink, textAlignVertical: 'top' }} />
        <Row><Button small title={note == null || note === k.missedNote ? 'Saved' : 'Save note'} disabled={note == null || note === k.missedNote}
          onPress={async () => { try { await s.store!.checks.update(k.id, { missedNote: (note || '').trim().slice(0, 500) }); setNote(null); } catch { setErr('Couldn\'t save the note.'); } }} /></Row>
      </Card>
    </Screen>
  );
}

function CostPanel({ k }: { k: Check }) {
  const c = useColors();
  const rows: [string, string, Usage][] = [];
  if (k.pass1) rows.push(['Find spots', `${k.pass1.images} photos`, k.pass1]);
  if (k.pass2) rows.push(['Check close-ups', `${k.pass2.calls} spot${k.pass2.calls === 1 ? '' : 's'}, ${k.pass2.images} images`, k.pass2]);
  if (!rows.length) return null;
  if (rows.length > 1) {
    const a = k.pass1!, b = k.pass2!;
    rows.push(['Total', '', { ms: a.ms + b.ms, calls: a.calls + b.calls, images: a.images + b.images, inTok: a.inTok + b.inTok, outTok: a.outTok + b.outTok, cost: a.cost + b.cost }]);
  }
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4 }}>
      <T v="h3" style={{ padding: 12, paddingBottom: 4 }}>Speed and cost</T>
      {rows.map(([name, sub, u], m) => (
        <View key={name} style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: m === rows.length - 1 && rows.length > 2 ? 2 : 1, borderColor: m === rows.length - 1 && rows.length > 2 ? c.ink : c.rule }}>
          <View style={{ flex: 1.3 }}><T v="medium">{name}</T>{sub ? <T v="small">{sub}</T> : null}</View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}><T v="h3">{secs(u.ms)}</T><T v="small">{secs(u.ms / Math.max(1, u.images))} per image</T></View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}><T v="h3">{usd(u.cost)}</T><T v="small">{usd(u.cost / Math.max(1, u.images))} per image</T></View>
        </View>
      ))}
      <T v="small" style={{ padding: 12, paddingTop: 6 }}>Time is measured on the server, per AI call. Cost is from the tokens the API reported for {k.model} at list prices.</T>
    </View>
  );
}
