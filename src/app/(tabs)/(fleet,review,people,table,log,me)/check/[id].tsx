import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { KnownChooser, useVanRecords } from '@/components/damage';
import { BackBar } from '@/components/nav';
import { Button, Card, Chip, F, Field, MARKER, Notice, Pill, Row, Screen, T, ZoomPhoto, cap, fmtWhen, secs, usd, useColors, type PillV } from '@/components/ui';
import { buildDamages, likelySame, manualPos, spotPos } from '@/lib/damage';
import { newId, prepare, upload } from '@/lib/images';
import { watchCheck } from '@/lib/people';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { TIER_NAME, type Check, type Review, type Usage, type VerdictKind } from '@/lib/types';

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
    <Screen edges={[]}>
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
  // Older checks (opened from a van's damage record) aren't among the ones the app keeps loaded: watch them.
  const loadedK = s.checks.find((x) => x.id === id);
  const [older, setOlder] = useState<Check | null | undefined>(undefined);
  const orgId = s.org?.id;
  useEffect(() => {
    if (loadedK || !s.loaded.checks || !orgId || s.mode !== 'firebase') return;
    return watchCheck(orgId, id, setOlder);
  }, [loadedK, s.loaded.checks, orgId, id, s.mode]);
  const k = loadedK || older || undefined;
  // The van's damage record, to tell new damage from damage it already has.
  const van = k ? s.vehicles.find((x) => x.id === k.vehicleId) : undefined;
  const recs = useVanRecords(s.staff && k ? k.vehicleId : undefined);
  const onRecord = useMemo(() => (van ? buildDamages(van, recs.checks.filter((x) => x.id !== id), recs.walks) : []), [van, recs.checks, recs.walks, id]);
  const [phase, setPhase] = useState<'list' | 'capture' | 'running'>('list');
  const [i, setI] = useState(0);
  const [local, setLocal] = useState<Local>({});
  const [run, setRun] = useState<{ done: number; total: number; t0: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useTicker(phase === 'running');

  if (!k) return <Screen edges={[]}><Card dashed><T v="hint">{s.loaded.checks && older === null ? 'This check isn\'t available.' : 'Loading…'}</T></Card></Screen>;
  const walkOfK = recs.walks.find((w) => w.id === k.walkId) || s.walks.find((w) => w.id === k.walkId) || null;
  const n = k.spots.length;
  const checked = k.spots.some((p) => p.verdict);

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
    if (!todo.length) { setPhase('list'); return; }
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

  if (phase === 'running' && run) {
    return (
      <Screen edges={[]}>
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
      <Screen edges={[]}>
        <Stack.Screen options={{ title: 'Close-ups' }} />
        <BackBar title="All spots" onPress={() => setPhase('list')} />
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

  const status = k.status || (checked ? 'submitted' : 'checking');
  const reviewer = s.runs(k.stationId);
  const decisions = k.review?.decisions || {};
  const manual = k.review?.manual || [];
  const decidedAll = k.spots.every((_, j) => decisions[String(j)]);
  const approved = k.spots.filter((_, j) => decisions[String(j)]?.damage).length + manual.length;
  const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
  const cleared = k.spots.filter((p) => ['dirt', 'reflection', 'no_damage'].includes(p.verdict?.verdict || '')).length;
  const open = n - dmg - cleared;

  const saveReview = async (patch: Partial<Review>, finish?: 'reviewed' | 'submitted') => {
    setErr(null);
    const base: Review = k.review || { decisions: {}, manual: [], by: null, byName: null, at: null };
    const next: Review = { ...base, ...patch };
    const fields: Partial<Check> & { reviewedAt?: number | null } = { review: next };
    if (finish === 'reviewed') { next.by = s.user?.uid || null; next.byName = s.user?.name || null; next.at = Date.now(); fields.status = 'reviewed'; fields.reviewedAt = Date.now(); }
    if (finish === 'submitted') fields.status = 'submitted';
    try { await s.store!.checks.update(k.id, fields as Partial<Check>); } catch { setErr('Couldn\'t save the review. Check the connection and try again.'); return; }
    // The damage log (new damage and who had the van) follows the review, for the drivers' numbers.
    if (s.mode === 'firebase' && (finish || k.status === 'reviewed')) ai.logReview({ orgId: s.org!.id, checkId: k.id }).catch(() => {});
  };
  const decide = (j: number, damage: boolean | null) => {
    const d = { ...decisions };
    // Approving damage the van already has (seen in an earlier check) links to it, so it stays one damage.
    const known = damage && van ? likelySame(spotPos(van, k, j, walkOfK), onRecord, k.id)[0]?.key ?? null : null;
    if (damage == null) delete d[String(j)];
    else d[String(j)] = { damage, note: '', by: s.user?.uid || '', byName: s.user?.name || '', at: Date.now(), known };
    return saveReview({ decisions: d });
  };
  const setKnown = (j: number, key: string | null) => saveReview({ decisions: { ...decisions, [String(j)]: { ...decisions[String(j)], known: key } } });
  const setKnownManual = (x: number, key: string | null) => saveReview({ manual: manual.map((m, y) => (y === x ? { ...m, known: key } : m)) });
  const submit = async () => {
    setErr(null); setSending(true);
    try { await ai.submitCheck({ orgId: s.store!.orgId, checkId: k.id, missedNote: (note ?? k.missedNote ?? '').trim() }); setNote(null); }
    catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t send it. Check the connection and try again.'); }
    finally { setSending(false); }
  };

  const title = status === 'reviewed' ? (approved ? `${approved} damage${approved === 1 ? '' : 's'} approved` : 'No damage approved')
    : !n ? 'No damage found'
      : status === 'submitted' ? (reviewer ? `Review ${n} spot${n === 1 ? '' : 's'}` : 'Sent to the fleet manager')
        : checked ? (dmg ? `${dmg} possible damage${dmg === 1 ? '' : 's'}` : 'No damage in the close-ups') : `${n} spot${n === 1 ? '' : 's'} to check`;
  const sub = status === 'reviewed' ? `Reviewed by ${k.review?.byName || 'the fleet manager'}${k.review?.at ? ', ' + fmtWhen(k.review.at) : ''}. This is the final word on this van's damage.`
    : status === 'submitted' ? (reviewer ? 'Look at each spot and decide: damage or not. Your decision is final and goes on the van\'s record.' : `Sent ${k.submittedAt ? fmtWhen(k.submittedAt) : ''}. The fleet manager approves or rejects each spot.`)
      : !n ? 'Nothing in these photos looked like damage. Small chips and dents can still be there.'
        : checked ? `${cleared} cleared as dirt, reflection or no damage.${open ? ` ${open} still open.` : ''} Send it to the fleet manager when you're done.`
          : 'These might be damage, dirt or reflections. Take close-ups of each spot, then send it to the fleet manager.';

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: `Check, ${k.vehicleName}` }} />
      <View style={{ gap: 6 }}>
        <T v="hint">Damage check, {k.vehicleName}{k.createdByName ? `, by ${k.createdByName}` : ''}, {fmtWhen(k.createdAt)}</T>
        <T v="h1">{title}</T>
        <T>{sub}</T>
        <Row>
          <Pill v={status === 'reviewed' ? 'solid' : status === 'submitted' ? 'amber' : 'muted'} text={status === 'reviewed' ? 'Reviewed' : status === 'submitted' ? 'Waiting for review' : 'Close-ups pending'} />
          {s.stations.length > 1 ? <Pill text={s.stationName(k.stationId)} /> : null}
        </Row>
      </View>
      {s.seesAiStats ? <CostPanel k={k} /> : null}
      {status === 'checking' && n > 0 && !checked ? <Button v="primary" wide title={`Take close-ups of ${n} spot${n === 1 ? '' : 's'}`} onPress={() => { setI(0); setPhase('capture'); }} /> : null}
      {status === 'checking' && n > 0 && checked && open > 0 ? <Button title="Take more close-ups" onPress={() => { setI(Math.max(0, k.spots.findIndex((p) => !p.verdict || p.verdict.verdict === 'unclear' || p.verdict.verdict === 'skipped'))); setPhase('capture'); }} /> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      {k.missedNote && status !== 'checking' ? <Notice text={`Note from ${k.createdByName || 'the driver'}: ${k.missedNote}`} /> : null}
      {k.spots.map((p, j) => {
        const v = p.verdict;
        const d = decisions[String(j)];
        return (
          <Card key={j}>
            <Row>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: MARKER, borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                <T v="h3" color="#000" style={{ fontFamily: F.condBold, fontSize: 17, lineHeight: 20 }}>{j + 1}</T>
              </View>
              <T v="h3" style={{ flex: 1 }}>{cap(p.panel)}</T>
            </Row>
            <Row>
              {v ? <Pill v={VERDICT[v.verdict][1]} text={`AI: ${VERDICT[v.verdict][0].toLowerCase()}`} /> : <Pill v={p.conf >= 0.6 ? 'bad' : 'amber'} text={`${p.conf >= 0.6 ? 'Likely' : 'Possible'}, ${Math.round(p.conf * 100)}%`} />}
              <Pill text={`${cap(v?.verdict === 'damage' ? v.type || p.type : p.type)}${(v?.sizeCm || p.sizeCm) ? `, about ${v?.sizeCm || p.sizeCm} cm` : ''}`} />
              {v?.severity ? <Pill text={v.severity === 'repair' ? 'Bodyshop repair' : 'Cosmetic'} /> : null}
              {v?.ms && s.seesAiStats ? <Pill v="muted" text={secs(v.ms)} /> : null}
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
            {reviewer && status !== 'checking' ? (
              <View style={{ gap: 8, borderTopWidth: 2, borderColor: c.ink, paddingTop: 10 }}>
                <T v="medium">Your decision</T>
                <Row>
                  <Button small v={d?.damage === true ? 'primary' : 'secondary'} title="Damage" onPress={() => decide(j, d?.damage === true ? null : true)} />
                  <Button small v={d?.damage === false ? 'primary' : 'secondary'} title="Not damage" onPress={() => decide(j, d?.damage === false ? null : false)} />
                  {d ? <T v="small">{d.byName}, {fmtWhen(d.at)}</T> : null}
                </Row>
                {d?.damage && van ? <KnownChooser pos={spotPos(van, k, j, walkOfK)} value={d.known} damages={onRecord} excludeCheck={k.id} onPick={(key) => setKnown(j, key)} /> : null}
              </View>
            ) : d ? (
              <View style={{ gap: 6, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <Row>
                  <Pill v={d.damage ? 'bad' : 'good'} text={d.damage ? 'Approved damage' : 'Not damage'} />
                  <T v="small">Decided by {d.byName}</T>
                </Row>
                {d.damage && van && s.staff ? <KnownChooser pos={spotPos(van, k, j, walkOfK)} value={d.known} damages={onRecord} excludeCheck={k.id} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {k.notVisible?.length ? <T v="hint">Not visible in these photos: {k.notVisible.join('; ')}.</T> : null}

      {manual.length || (reviewer && status !== 'checking') ? (
        <Card>
          <T v="h3">Damage the AI missed{manual.length ? ` (${manual.length})` : ''}</T>
          {manual.map((m, x) => (
            <Row key={x} style={{ borderTopWidth: x ? 1 : 0, borderColor: c.rule, paddingTop: x ? 8 : 0 }}>
              <View style={{ flex: 1, minWidth: 160, gap: 4 }}>
                <T v="medium">{cap(m.panel)}, {m.type}</T>
                {m.note ? <T v="small">{m.note}</T> : null}
                <T v="small">Added by {m.byName}</T>
                {van && s.staff ? <KnownChooser pos={manualPos(van, m.panel)} value={m.known} damages={onRecord} excludeCheck={k.id}
                  onPick={reviewer && status !== 'checking' ? (key) => setKnownManual(x, key) : undefined} /> : null}
              </View>
              {reviewer ? <Button small v="link" title="Remove" onPress={() => saveReview({ manual: manual.filter((_, y) => y !== x) })} /> : null}
            </Row>
          ))}
          {reviewer && status !== 'checking' ? <AddManual onAdd={(m) => saveReview({ manual: [...manual, { ...m, by: s.user?.uid || '', byName: s.user?.name || '', at: Date.now(),
            known: van ? likelySame(manualPos(van, m.panel), onRecord, k.id)[0]?.key ?? null : null }] })} /> : null}
          <T v="small">Missed damage is also how we measure what the AI misses.</T>
        </Card>
      ) : null}

      {status === 'checking' ? (
        <Card>
          <T v="h3">Send to the fleet manager</T>
          <T v="hint">Anything the AI missed? Where it is and what it is.</T>
          <TextInput multiline value={note ?? k.missedNote ?? ''} onChangeText={setNote} placeholder="For example: dent in the right rear door, 3 cm, below the handle" placeholderTextColor={c.ink2}
            style={{ minHeight: 70, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 10, fontFamily: F.body, fontSize: 16, color: c.ink, textAlignVertical: 'top' }} />
          {n > 0 && open > 0 ? <T v="small">{open} spot{open === 1 ? ' has' : 's have'} no close-up yet. You can still send it; the manager decides from the photos.</T> : null}
          <Button v="primary" wide title={reviewer ? 'Done with close-ups' : 'Send to the fleet manager'} loading={sending} onPress={submit} />
        </Card>
      ) : null}

      {reviewer && status === 'submitted' ? (
        <Card>
          <T v="h3">Finish the review</T>
          <T v="hint">{decidedAll ? `${approved} damage${approved === 1 ? '' : 's'} will go on the van's record.` : `Decide every spot first: ${k.spots.filter((_, j) => !decisions[String(j)]).length} left.`}</T>
          <Button v="primary" wide title="Finish review" disabled={!decidedAll} onPress={() => saveReview({}, 'reviewed')} />
        </Card>
      ) : null}
      {reviewer && status === 'reviewed' ? <Button title="Change the review" onPress={() => saveReview({}, 'submitted')} /> : null}
    </Screen>
  );
}

const DAMAGE_TYPES = ['scratch', 'scuff', 'dent', 'chip', 'crack', 'broken part', 'kerbed rim', 'other'];
function AddManual({ onAdd }: { onAdd: (m: { panel: string; type: string; note: string }) => Promise<void> }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState('');
  const [type, setType] = useState('dent');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button small title="Add damage the AI missed" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
      <Field label="Where" value={panel} onChangeText={setPanel} placeholder="For example: right rear door, below the handle" />
      <Row>{DAMAGE_TYPES.map((t) => <Chip key={t} text={cap(t)} on={type === t} onPress={() => setType(t)} />)}</Row>
      <Field label="Note" hint="optional" value={note} onChangeText={setNote} placeholder="Size, how it looks" />
      <Row>
        <Button small v="primary" title="Add" loading={busy} disabled={!panel.trim()} onPress={async () => {
          setBusy(true);
          await onAdd({ panel: panel.trim().slice(0, 80), type, note: note.trim().slice(0, 300) });
          setBusy(false); setOpen(false); setPanel(''); setNote('');
        }} />
        <Button small v="link" title="Cancel" onPress={() => setOpen(false)} />
      </Row>
    </View>
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
