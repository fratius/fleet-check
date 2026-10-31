import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { KnownChooser, useVanRecords } from '@/components/damage';
import { useMediaGone } from '@/components/keep';
import { BackBar } from '@/components/nav';
import { Button, Card, Chip, F, Field, MARKER, Notice, Pill, Row, Screen, T, ZoomPhoto, cap, fmtWhen, secs, usd, useColors, type PillV } from '@/components/ui';
import { buildDamages, likelySame, manualPos, spotPos } from '@/lib/damage';
import { N_, loc, t, tp } from '@/lib/i18n';
import { newId, prepare, upload } from '@/lib/images';
import { retrying } from '@/lib/net';
import { day, deleteFrom } from '@/lib/media';
import { watchCheck } from '@/lib/people';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { sendCall } from '@/lib/outbox';
import { TIER_NAME, type Check, type Review, type Usage, type VerdictKind } from '@/lib/types';

/** What the AI said about a spot: its name, its colour, and the name inside a sentence ("AI: dirt or residue"). */
const VERDICT: Record<VerdictKind, [string, PillV, string]> = {
  damage: [N_('Damage'), 'bad', N_('damage')], dirt: [N_('Dirt or residue'), 'good', N_('dirt or residue')], reflection: [N_('Reflection'), 'good', N_('reflection')],
  no_damage: [N_('No damage'), 'good', N_('no damage')], unclear: [N_('Unclear'), 'muted', N_('unclear')], skipped: [N_('Not checked'), 'muted', N_('not checked')],
};

function useTicker(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const h = setInterval(() => set((n) => n + 1), 200); return () => clearInterval(h); }, [on]);
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
      .catch((e) => setErr(e instanceof AiError ? e.message : t('The check didn\'t finish. Try again.')));
  }, [s.store, s.tier, walkId, attempt]);
  return (
    <Screen edges={[]}>
      <View style={{ gap: 4 }}>
        <T v="hint">{w ? t('Damage check, {van}', { van: w.vehicleName }) : t('Damage check')}</T>
        <T v="h1">{err ? t('The check didn\'t finish') : w ? tp(w.photos.length, 'Looking for damage in {n} photo', 'Looking for damage in {n} photos') : t('Looking for damage')}</T>
      </View>
      {err ? (
        <Card><T color={c.alert}>{err}</T><Row><Button v="primary" title={t('Try again')} onPress={() => { setErr(null); setAttempt((a) => a + 1); }} /></Row></Card>
      ) : (
        <Card>
          <T v="big">{((Date.now() - t0.current) / 1000).toFixed(1)} s</T>
          <ActivityIndicator color={c.ink} style={{ alignSelf: 'flex-start' }} />
          <T v="hint">{t('The {model} model looks at every photo at full resolution. This usually takes under a minute.', { model: t(TIER_NAME[s.tier]) })}</T>
        </Card>
      )}
    </Screen>
  );
}

type Local = Record<number, (string | null)[]>;

function CheckView({ id }: { id: string }) {
  const s = useSession();
  const c = useColors();
  const gone = useMediaGone();
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

  if (!k) return <Screen edges={[]}><Card dashed><T v="hint">{s.loaded.checks && older === null ? t('This check isn\'t available.') : t('Loading…')}</T></Card></Screen>;
  const walkOfK = recs.walks.find((w) => w.id === k.walkId) || s.walks.find((w) => w.id === k.walkId) || null;
  const n = k.spots.length;
  const checked = k.spots.some((p) => p.verdict);

  const shot = async (spot: number, slot: number) => {
    setErr(null);
    try {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) { setErr(t('Allow camera access in Settings to take close-ups.')); return; }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (r.canceled) return;
      const a = r.assets[0];
      const prep = await prepare(a.uri, a.width, a.height);
      setLocal((L) => { const cur = (L[spot] || [null, null]).slice(); cur[slot] = prep.uri; return { ...L, [spot]: cur }; });
    } catch { setErr(t('Couldn\'t open the camera.')); }
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
          await retrying(() => ai.checkSpot({ orgId: s.store!.orgId, checkId: k.id, spot: j, closeups: paths, tier: s.tier }));
        } catch (e) { failed++; setErr(e instanceof AiError ? e.message : t('Some close-ups couldn\'t be checked. Try again.')); }
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
        <View style={{ gap: 4 }}><T v="hint">{t('Damage check, {van}', { van: k.vehicleName })}</T><T v="h1">{t('Checking the close-ups, spot {i} of {n}', { i: Math.min(run.done + 1, run.total), n: run.total })}</T></View>
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
        <Stack.Screen options={{ title: t('Close-ups') }} />
        <BackBar title={t('All spots')} onPress={() => setPhase('list')} />
        <View style={{ gap: 4 }}><T v="hint">{t('Close-up {i} of {n}', { i: i + 1, n })}</T><T v="h1">{cap(p.panel)}</T></View>
        <ZoomPhoto src={p.refPath} caption={`${cap(p.panel)}, ${t(p.photoLabel)}`} style={{ width: '100%', aspectRatio: 4 / 3, borderWidth: 2, borderColor: c.ink }} contentFit="contain" />
        <View style={{ gap: 6 }}>
          <T>{t('1. Find the spot in the yellow box.')}{p.closeup ? ' ' + p.closeup : ''}</T>
          <T>{t('2. Wipe it with your hand or a cloth.')}</T>
          <T>{t('3. Take one photo straight on, about 30 to 50 cm away.')}</T>
          <T>{t('4. Take a second from a low angle along the panel. It shows whether a mark is a scratch or a reflection.')}</T>
        </View>
        <Row gap={10}>
          {[t('Straight on'), t('Low angle, optional')].map((label, m) => (
            <View key={label} style={{ flex: 1, minWidth: 140, gap: 6 }}>
              <View style={{ aspectRatio: 3 / 4, borderWidth: 2, borderStyle: mine[m] ? 'solid' : 'dashed', borderColor: mine[m] ? c.ink : c.ink2, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {mine[m] ? <Image source={{ uri: mine[m]! }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <T v="hint">{label}</T>}
              </View>
              <Button small v={mine[m] ? 'secondary' : m === 0 ? 'primary' : 'secondary'} title={mine[m] ? t('Retake') : t('Take photo')} onPress={() => shot(i, m)} />
            </View>
          ))}
        </Row>
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        <Row>
          <Button v="primary" title={last ? t('Check the close-ups') : t('Next spot')} disabled={!mine.some(Boolean)} onPress={() => (last ? runPass2() : setI(i + 1))} />
          <Button v="link" title={last ? t('Skip and check') : t('Skip this spot')} onPress={() => { const L = { ...local, [i]: [null, null] }; setLocal(L); if (last) runPass2(L); else setI(i + 1); }} />
          {i > 0 ? <Button v="link" title={t('Back')} onPress={() => setI(i - 1)} /> : null}
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
    try { await s.store!.checks.update(k.id, fields as Partial<Check>); } catch { setErr(t('Couldn\'t save the review. Check the connection and try again.')); return; }
    // The damage log (new damage and who had the van) follows the review, for the drivers' numbers.
    if (s.mode === 'firebase' && (finish || k.status === 'reviewed')) {
      sendCall('logReview', { orgId: s.org!.id, checkId: k.id }, { title: t('The damage log for {van}', { van: k.vehicleName }), vehicleId: k.vehicleId, vehicleName: k.vehicleName }).catch(() => {});
    }
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
    try {
      await sendCall('submitCheck', { orgId: s.store!.orgId, checkId: k.id, missedNote: (note ?? k.missedNote ?? '').trim() },
        { title: t('Send the damage check of {van} to the fleet manager', { van: k.vehicleName }), vehicleId: k.vehicleId, vehicleName: k.vehicleName });
      setNote(null);
    }
    catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t send it. Check the connection and try again.')); }
    finally { setSending(false); }
  };

  const title = status === 'reviewed' ? (approved ? tp(approved, '{n} damage approved', '{n} damages approved') : t('No damage approved'))
    : !n ? t('No damage found')
      : status === 'submitted' ? (reviewer ? tp(n, 'Review {n} spot', 'Review {n} spots') : t('Sent to the fleet manager'))
        : checked ? (dmg ? tp(dmg, '{n} possible damage', '{n} possible damages') : t('No damage in the close-ups')) : tp(n, '{n} spot to check', '{n} spots to check');
  const reviewerName = k.review?.byName || t('the fleet manager');
  const sub = status === 'reviewed' ? (k.review?.at
    ? t('Reviewed by {name}, {when}. This is the final word on this van\'s damage.', { name: reviewerName, when: fmtWhen(k.review.at) })
    : t('Reviewed by {name}. This is the final word on this van\'s damage.', { name: reviewerName }))
    : status === 'submitted' ? (reviewer ? t('Look at each spot and decide: damage or not. Your decision is final and goes on the van\'s record.')
      : k.submittedAt ? t('Sent {when}. The fleet manager approves or rejects each spot.', { when: fmtWhen(k.submittedAt) }) : t('Sent. The fleet manager approves or rejects each spot.'))
      : !n ? t('Nothing in these photos looked like damage. Small chips and dents can still be there.')
        : checked ? [tp(cleared, '{n} cleared as dirt, reflection or no damage.', '{n} cleared as dirt, reflection or no damage.'),
          open ? tp(open, '{n} still open.', '{n} still open.') : '', t('Send it to the fleet manager when you\'re done.')].filter(Boolean).join(' ')
          : t('These might be damage, dirt or reflections. Take close-ups of each spot, then send it to the fleet manager.');

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('Check, {van}', { van: k.vehicleName }) }} />
      <View style={{ gap: 6 }}>
        <T v="hint">{k.createdByName ? t('Damage check, {van}, by {name}, {when}', { van: k.vehicleName, name: k.createdByName, when: fmtWhen(k.createdAt) })
          : t('Damage check, {van}, {when}', { van: k.vehicleName, when: fmtWhen(k.createdAt) })}</T>
        <T v="h1">{title}</T>
        <T>{sub}</T>
        <Row>
          <Pill v={status === 'reviewed' ? 'solid' : status === 'submitted' ? 'amber' : 'muted'} text={status === 'reviewed' ? t('Reviewed') : status === 'submitted' ? t('Waiting for review') : t('Close-ups pending')} />
          {s.stations.length > 1 ? <Pill text={s.stationName(k.stationId)} /> : null}
        </Row>
      </View>
      {s.mode === 'firebase' && !s.org?.demo ? (gone(k.mediaDeletedAt)
        ? <Notice text={t('The photos of this check were deleted on {date}. The decisions and the van\'s damage record stay.', { date: day(k.mediaDeletedAt!) })} />
        : <T v="small">{k.keepUntil ? t('Damage was approved: the photos are kept until {date}.', { date: day(deleteFrom(k.createdAt, k.keepUntil)) })
          : t('Photos and videos of a month are deleted on the 15th of the month after, never while the van is still with the driver who had it: these on {date} at the earliest.', { date: day(deleteFrom(k.createdAt, k.keepUntil)) })}</T>) : null}
      {s.seesAiStats ? <CostPanel k={k} /> : null}
      {status === 'checking' && n > 0 && !checked ? <Button v="primary" wide title={tp(n, 'Take close-ups of {n} spot', 'Take close-ups of {n} spots')} onPress={() => { setI(0); setPhase('capture'); }} /> : null}
      {status === 'checking' && n > 0 && checked && open > 0 ? <Button title={t('Take more close-ups')} onPress={() => { setI(Math.max(0, k.spots.findIndex((p) => !p.verdict || p.verdict.verdict === 'unclear' || p.verdict.verdict === 'skipped'))); setPhase('capture'); }} /> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      {k.missedNote && status !== 'checking' ? <Notice text={t('Note from {name}: {note}', { name: k.createdByName || t('the driver'), note: k.missedNote })} /> : null}
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
              {v ? <Pill v={VERDICT[v.verdict][1]} text={t('AI: {verdict}', { verdict: t(VERDICT[v.verdict][2]) })} />
                : <Pill v={p.conf >= 0.6 ? 'bad' : 'amber'} text={p.conf >= 0.6 ? t('Likely, {pct}%', { pct: Math.round(p.conf * 100) }) : t('Possible, {pct}%', { pct: Math.round(p.conf * 100) })} />}
              {(() => {
                const type = cap(t(v?.verdict === 'damage' ? v.type || p.type : p.type));
                const cm = v?.sizeCm || p.sizeCm;
                return <Pill text={cm ? t('{type}, about {cm} cm', { type, cm }) : type} />;
              })()}
              {v?.severity ? <Pill text={v.severity === 'repair' ? t('Bodyshop repair') : t('Cosmetic')} /> : null}
              {v?.ms && s.seesAiStats ? <Pill v="muted" text={secs(v.ms)} /> : null}
            </Row>
            {v?.reason ? <T>{v.reason}</T> : !v && p.mightBe ? <T v="hint">{t('Could also be {what}.', { what: p.mightBe })}</T> : null}
            {/* Flex 16 : 9 makes the 4:3 crop and the 3:4 close-ups the same height. Tap any photo to see it full screen. */}
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <View style={{ flex: 16, minWidth: 0, gap: 3 }}>
                <ZoomPhoto src={p.refPath} caption={`${cap(p.panel)}, ${t(p.photoLabel)}`} style={{ width: '100%', aspectRatio: 4 / 3 }} />
                <T v="small" numberOfLines={2}>{t(p.photoLabel)}</T>
              </View>
              {p.closeups.map((cp, m) => {
                const label = m === 0 ? (p.markPath ? t('Straight on, damage boxed') : t('Straight on')) : t('Low angle');
                return (
                  <View key={cp} style={{ flex: 9, minWidth: 0, gap: 3 }}>
                    <ZoomPhoto src={m === 0 && p.markPath ? p.markPath : cp} caption={`${cap(p.panel)}, ${label.toLocaleLowerCase(loc())}`} style={{ width: '100%', aspectRatio: 3 / 4 }} />
                    <T v="small" numberOfLines={2}>{label}</T>
                  </View>
                );
              })}
            </View>
            {reviewer && status !== 'checking' ? (
              <View style={{ gap: 8, borderTopWidth: 2, borderColor: c.ink, paddingTop: 10 }}>
                <T v="medium">{t('Your decision')}</T>
                <Row>
                  <Button small v={d?.damage === true ? 'primary' : 'secondary'} title={t('Damage')} onPress={() => decide(j, d?.damage === true ? null : true)} />
                  <Button small v={d?.damage === false ? 'primary' : 'secondary'} title={t('Not damage')} onPress={() => decide(j, d?.damage === false ? null : false)} />
                  {d ? <T v="small">{d.byName}, {fmtWhen(d.at)}</T> : null}
                </Row>
                {d?.damage && van ? <KnownChooser pos={spotPos(van, k, j, walkOfK)} value={d.known} damages={onRecord} excludeCheck={k.id} onPick={(key) => setKnown(j, key)} /> : null}
              </View>
            ) : d ? (
              <View style={{ gap: 6, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
                <Row>
                  <Pill v={d.damage ? 'bad' : 'good'} text={d.damage ? t('Approved damage') : t('Not damage')} />
                  <T v="small">{t('Decided by {name}', { name: d.byName })}</T>
                </Row>
                {d.damage && van && s.staff ? <KnownChooser pos={spotPos(van, k, j, walkOfK)} value={d.known} damages={onRecord} excludeCheck={k.id} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {k.notVisible?.length ? <T v="hint">{t('Not visible in these photos: {list}.', { list: k.notVisible.join('; ') })}</T> : null}

      {manual.length || (reviewer && status !== 'checking') ? (
        <Card>
          <T v="h3">{manual.length ? t('Damage the AI missed ({n})', { n: manual.length }) : t('Damage the AI missed')}</T>
          {manual.map((m, x) => (
            <Row key={x} style={{ borderTopWidth: x ? 1 : 0, borderColor: c.rule, paddingTop: x ? 8 : 0 }}>
              <View style={{ flex: 1, minWidth: 160, gap: 4 }}>
                <T v="medium">{cap(m.panel)}, {t(m.type)}</T>
                {m.note ? <T v="small">{m.note}</T> : null}
                <T v="small">{t('Added by {name}', { name: m.byName })}</T>
                {van && s.staff ? <KnownChooser pos={manualPos(van, m.panel)} value={m.known} damages={onRecord} excludeCheck={k.id}
                  onPick={reviewer && status !== 'checking' ? (key) => setKnownManual(x, key) : undefined} /> : null}
              </View>
              {reviewer ? <Button small v="link" title={t('Remove')} onPress={() => saveReview({ manual: manual.filter((_, y) => y !== x) })} /> : null}
            </Row>
          ))}
          {reviewer && status !== 'checking' ? <AddManual onAdd={(m) => saveReview({ manual: [...manual, { ...m, by: s.user?.uid || '', byName: s.user?.name || '', at: Date.now(),
            known: van ? likelySame(manualPos(van, m.panel), onRecord, k.id)[0]?.key ?? null : null }] })} /> : null}
          <T v="small">{t('Missed damage is also how we measure what the AI misses.')}</T>
        </Card>
      ) : null}

      {status === 'checking' ? (
        <Card>
          <T v="h3">{t('Send to the fleet manager')}</T>
          <T v="hint">{t('Anything the AI missed? Where it is and what it is.')}</T>
          <TextInput multiline value={note ?? k.missedNote ?? ''} onChangeText={setNote} placeholder={t('For example: dent in the right rear door, 3 cm, below the handle')} placeholderTextColor={c.ink2}
            style={{ minHeight: 70, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 10, fontFamily: F.body, fontSize: 16, color: c.ink, textAlignVertical: 'top' }} />
          {n > 0 && open > 0 ? <T v="small">{tp(open, '{n} spot has no close-up yet. You can still send it; the manager decides from the photos.', '{n} spots have no close-up yet. You can still send it; the manager decides from the photos.')}</T> : null}
          <Button v="primary" wide title={reviewer ? t('Done with close-ups') : t('Send to the fleet manager')} loading={sending} onPress={submit} />
        </Card>
      ) : null}

      {reviewer && status === 'submitted' ? (
        <Card>
          <T v="h3">{t('Finish the review')}</T>
          <T v="hint">{decidedAll ? tp(approved, '{n} damage will go on the van\'s record.', '{n} damages will go on the van\'s record.')
            : tp(k.spots.filter((_, j) => !decisions[String(j)]).length, 'Decide every spot first: {n} left.', 'Decide every spot first: {n} left.')}</T>
          <Button v="primary" wide title={t('Finish review')} disabled={!decidedAll} onPress={() => saveReview({}, 'reviewed')} />
        </Card>
      ) : null}
      {reviewer && status === 'reviewed' ? <Button title={t('Change the review')} onPress={() => saveReview({}, 'submitted')} /> : null}
    </Screen>
  );
}

const DAMAGE_TYPES = [N_('scratch'), N_('scuff'), N_('dent'), N_('chip'), N_('crack'), N_('broken part'), N_('kerbed rim'), N_('other')];
function AddManual({ onAdd }: { onAdd: (m: { panel: string; type: string; note: string }) => Promise<void> }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState('');
  const [type, setType] = useState('dent');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button small title={t('Add damage the AI missed')} onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
      <Field label={t('Where')} value={panel} onChangeText={setPanel} placeholder={t('For example: right rear door, below the handle')} />
      <Row>{DAMAGE_TYPES.map((x) => <Chip key={x} text={cap(t(x))} on={type === x} onPress={() => setType(x)} />)}</Row>
      <Field label={t('Note')} hint={t('optional')} value={note} onChangeText={setNote} placeholder={t('Size, how it looks')} />
      <Row>
        <Button small v="primary" title={t('Add')} loading={busy} disabled={!panel.trim()} onPress={async () => {
          setBusy(true);
          await onAdd({ panel: panel.trim().slice(0, 80), type, note: note.trim().slice(0, 300) });
          setBusy(false); setOpen(false); setPanel(''); setNote('');
        }} />
        <Button small v="link" title={t('Cancel')} onPress={() => setOpen(false)} />
      </Row>
    </View>
  );
}

function CostPanel({ k }: { k: Check }) {
  const c = useColors();
  const rows: [string, string, Usage][] = [];
  if (k.pass1) rows.push([t('Find spots'), tp(k.pass1.images, '{n} photo', '{n} photos'), k.pass1]);
  if (k.pass2) rows.push([t('Check close-ups'), tp(k.pass2.calls, '{n} spot, {images} images', '{n} spots, {images} images', { images: k.pass2.images }), k.pass2]);
  if (!rows.length) return null;
  if (rows.length > 1) {
    const a = k.pass1!, b = k.pass2!;
    rows.push([t('Total'), '', { ms: a.ms + b.ms, calls: a.calls + b.calls, images: a.images + b.images, inTok: a.inTok + b.inTok, outTok: a.outTok + b.outTok, cost: a.cost + b.cost }]);
  }
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4 }}>
      <T v="h3" style={{ padding: 12, paddingBottom: 4 }}>{t('Speed and cost')}</T>
      {rows.map(([name, sub, u], m) => (
        <View key={name} style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: m === rows.length - 1 && rows.length > 2 ? 2 : 1, borderColor: m === rows.length - 1 && rows.length > 2 ? c.ink : c.rule }}>
          <View style={{ flex: 1.3 }}><T v="medium">{name}</T>{sub ? <T v="small">{sub}</T> : null}</View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}><T v="h3">{secs(u.ms)}</T><T v="small">{t('{value} per image', { value: secs(u.ms / Math.max(1, u.images)) })}</T></View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}><T v="h3">{usd(u.cost)}</T><T v="small">{t('{value} per image', { value: usd(u.cost / Math.max(1, u.images)) })}</T></View>
        </View>
      ))}
      <T v="small" style={{ padding: 12, paddingTop: 6 }}>{t('Time is measured on the server, per AI call. Cost is from the tokens the API reported for {model} at list prices.', { model: k.model })}</T>
    </View>
  );
}
