import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';

import { BUY_NAME, BUY_NOUN, buyState, cardLine, isOpenBuy, litresText, money, STALE_BUY } from '@/components/buy';
import { kmText, takePhoto } from '@/components/dash';
import { dur } from '@/components/history';
import { Button, Card, Chip, F, Field, MARKER, Pill, Plate, Row, Screen, T, ZoomPhoto, fmtWhen, useColors } from '@/components/ui';
import { newId, prepare, upload } from '@/lib/images';
import { useSession } from '@/lib/session';
import { AiError, ai, type Contact } from '@/lib/store';
import type { BuyKind, Purchase, ReceiptRead, Vehicle } from '@/lib/types';

/**
 * Refuel, wash or buy parts for a van, step by step, and afterwards the record of it. At the pump only the card check
 * is waited for: the dashboard photo is read while the driver photographs the card, and the numbers are checked at
 * the end, together with the receipt. A card that isn't the van's stops the driver until a fleet manager allows or
 * refuses it here (the driver's screen follows by itself).
 */

const KINDS: BuyKind[] = ['fuel', 'wash', 'parts'];
const EIGHTHS: [number, string][] = [[0, 'Empty'], [12.5, '1/8'], [25, '1/4'], [37.5, '3/8'], [50, '1/2'], [62.5, '5/8'], [75, '3/4'], [87.5, '7/8'], [100, 'Full']];
const num = (t: string) => { const x = t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return x ? Number(x) : null; };
const show = (n: number | null | undefined, dp?: number) => (n == null ? '' : (dp != null ? n.toFixed(dp) : String(n)).replace('.', ','));
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message === 'camera' ? 'Allow camera access in Settings to take the photo.' : e instanceof AiError ? e.message : fallback);

/** The van's fuel on the receipt, in litres (the server works it out the same way). */
function fuelLitres(r: ReceiptRead, vanFuel: Vehicle['fuel']): number | null {
  const want = vanFuel === 'diesel' ? ['diesel'] : vanFuel === 'petrol' ? ['petrol'] : vanFuel === 'cng' ? ['cng'] : ['diesel', 'petrol'];
  const xs = r.items.filter((i) => want.includes(i.product) && i.quantity != null && (i.unit === 'l' || i.unit == null || i.product === 'cng'));
  return xs.length ? Math.round(xs.reduce((n, i) => n + (i.quantity || 0), 0) * 100) / 100 : null;
}

export default function BuyPage() {
  const s = useSession();
  const c = useColors();
  const q = useLocalSearchParams<{ id: string; van?: string; kind?: string }>();
  const [pid, setPid] = useState<string | null>(q.id && q.id !== 'new' ? q.id : null);
  const p = pid ? s.purchases.find((x) => x.id === pid) || null : null;
  const kind: BuyKind = p?.kind || (KINDS.includes(q.kind as BuyKind) ? (q.kind as BuyKind) : 'fuel');
  const van = s.vehicles.find((v) => v.id === (p?.vehicleId || q.van)) || null;
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 6000); return () => clearTimeout(t); }, []);
  const title = <Stack.Screen options={{ title: BUY_NAME[kind] }} />;

  if (s.mode !== 'firebase') return <Screen edges={[]}>{title}<Card dashed><T v="hint">Refuelling, washing and parts need the Firebase backend.</T></Card></Screen>;
  if (pid && !p) {
    return (
      <Screen edges={[]}>{title}
        {waited ? <Card dashed><T v="hint">Not found. It may belong to another station.</T></Card> : <ActivityIndicator color={c.ink} style={{ marginTop: 24 }} />}
      </Screen>
    );
  }
  const mine = !p || p.by === s.user?.uid;
  if (p && (!mine || !isOpenBuy(p))) return <Screen edges={[]}>{title}<Summary p={p} /></Screen>;
  if (!van) return <Screen edges={[]}>{title}<Card dashed><T v="hint">{s.loaded.vehicles ? 'This van isn\'t in the fleet any more.' : 'Loading…'}</T></Card></Screen>;
  if (kind === 'parts' && !s.runs(van.stationId)) return <Screen edges={[]}>{title}<Card dashed><T v="hint">Owners and the station&apos;s fleet managers buy parts.</T></Card></Screen>;
  if (kind === 'fuel' && van.fuel === 'electric') return <Screen edges={[]}>{title}<Card dashed><T v="hint">Electric vans are charged, not refuelled.</T></Card></Screen>;
  return <Screen edges={[]}>{title}<Flow van={van} kind={kind} p={p} onStarted={setPid} /></Screen>;
}

/** Photo with the camera, made smaller, uploaded to this person's folder. */
async function shoot(orgId: string, uid: string, edge = 2000) {
  const ph = await takePhoto();
  if (!ph) return null;
  const small = await prepare(ph.uri, ph.w, ph.h, edge, 0.85);
  const path = await upload(small.uri, `orgs/${orgId}/buys/${uid}/${newId()}.jpg`);
  return { path, uri: ph.uri };
}

type StepKey = 'dash' | 'card' | 'go' | 'parts' | 'check';
function Steps({ kind, at, card }: { kind: BuyKind; at: StepKey; card: boolean | null }) {
  const c = useColors();
  const list: [StepKey, string][] = kind === 'parts'
    ? [['dash', 'Dashboard'], ['parts', 'Parts, why, receipt'], ['check', 'Check and save']]
    : [['dash', 'Dashboard'], ...(card === false ? [] : [['card', card ? 'Fuel card' : 'Fuel card, if any'] as [StepKey, string]]), ['go', kind === 'wash' ? 'Wash, then the receipt' : 'Fill up, then the receipt'], ['check', 'Check and save']];
  const i = list.findIndex(([k]) => k === at);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={`Step ${i + 1} of ${list.length}: ${list[i]?.[1]}`}>
      {list.map(([k, label], j) => (
        <View key={k} style={{ flex: 1, gap: 4 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: j < i ? c.ink : j === i ? MARKER : c.rule, borderWidth: j === i ? 1.5 : 0, borderColor: '#000' }} />
          <Text style={{ fontFamily: j === i ? F.semi : F.body, fontSize: 12, lineHeight: 15, color: j <= i ? c.ink : c.ink2 }} numberOfLines={2}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** The yellow "do this now" block, with one big action. */
function Now({ title, line, children }: { title: string; line?: string; children?: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: MARKER, borderRadius: 4, padding: 14, gap: 8, borderWidth: 2, borderColor: '#000' }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 26, lineHeight: 29, color: '#000' }}>{title}</Text>
      {line ? <T v="body" color="#000">{line}</T> : null}
      {children}
    </View>
  );
}

function Flow({ van, kind, p, onStarted }: { van: Vehicle; kind: BuyKind; p: Purchase | null; onStarted: (id: string) => void }) {
  const s = useSession();
  const c = useColors();
  const orgId = s.org!.id, uid = s.user!.uid;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsCard, setNeedsCard] = useState<boolean | null>(null);
  const [cardMsg, setCardMsg] = useState<string | null>(null);
  const [people, setPeople] = useState<Contact[] | null>(null);
  const [parts, setParts] = useState<{ path: string; uri: string }[]>([]);
  const [note, setNote] = useState('');
  const [thumbs, setThumbs] = useState<{ dash?: string; receipt?: string }>({});
  const dashAsked = useRef(false);

  // The dashboard is read in the background; ask again if that never happened (the app was closed, no signal).
  useEffect(() => {
    if (!p || p.dash.done || dashAsked.current) return;
    dashAsked.current = true;
    ai.buy.dash({ orgId, action: 'dash', id: p.id }).catch(() => { dashAsked.current = false; });
  }, [p, orgId]);
  // Whom to call while waiting (also after the app was reopened).
  useEffect(() => {
    if (!p || (p.status !== 'waiting' && p.status !== 'refused') || people) return;
    ai.buy.contacts({ orgId, action: 'contacts', id: p.id }).then((r) => setPeople(r.people)).catch(() => {});
  }, [p, people, orgId]);

  const run = async (label: string, fn: () => Promise<void>, fallback: string) => {
    setErr(null); setBusy(label);
    try { await fn(); } catch (e) { setErr(errText(e, fallback)); } finally { setBusy(null); }
  };
  const cancel = () => run('Cancelling…', async () => { await ai.buy.cancel({ orgId, action: 'cancel', id: p!.id }); }, 'Couldn\'t cancel. Check the connection.');

  const head = (
    <View style={{ gap: 6 }}>
      <T v="h1">{BUY_NAME[kind]}: {van.name}</T>
      <Row><Plate text={van.plate} /><T v="hint">{s.stations.length > 1 ? s.stationName(van.stationId) : ''}</T></Row>
    </View>
  );
  const errLine = err ? <T v="small" color={c.alert}>{err}</T> : null;

  /* 1. The dashboard */
  if (!p) {
    const takeDash = () => run('Uploading the photo…', async () => {
      const ph = await shoot(orgId, uid);
      if (!ph) return;
      setThumbs((t) => ({ ...t, dash: ph.uri }));
      setBusy('Starting…');
      const r = await ai.buy.start({ orgId, action: 'start', kind, vehicleId: van.id, path: ph.path });
      setNeedsCard(r.needsCard);
      dashAsked.current = true;
      // Read while the driver carries on.
      ai.buy.dash({ orgId, action: 'dash', id: r.id }).catch(() => { dashAsked.current = false; });
      onStarted(r.id);
    }, 'The photo didn\'t upload. Check the connection and try again.');
    return (
      <>
        {head}
        <Steps kind={kind} at="dash" card={null} />
        <Now title={kind === 'parts' ? 'First, the dashboard' : `Before you start the ${kind === 'wash' ? 'wash' : 'pump'}`}
          line="A photo of the dashboard with the ignition on: the odometer and the fuel gauge readable.">
          <Button v="primary" wide title={busy || 'Photo of the dashboard'} loading={!!busy} disabled={!!busy} onPress={takeDash} />
        </Now>
        {errLine}
        {!busy ? <Button small v="link" title="Cancel" onPress={() => router.back()} /> : null}
      </>
    );
  }

  /* Stopped: waiting for the fleet manager, or refused. */
  if (p.status === 'waiting' || p.status === 'refused') {
    const refused = p.status === 'refused';
    return (
      <>
        {head}
        <View style={{ borderWidth: 3, borderColor: c.alert, borderRadius: 4, padding: 14, gap: 8, backgroundColor: c.paper }}>
          <Text style={{ fontFamily: F.condBold, fontSize: 30, lineHeight: 32, color: c.alert }}>
            {refused ? `${p.decision?.byName || 'Your fleet manager'} refused it` : `Stop. Don't start the ${kind === 'wash' ? 'wash' : 'pump'}.`}
          </Text>
          <T v="medium">{cardLine(p)}</T>
          {refused ? (
            <>
              {p.decision?.note ? <T v="body">&quot;{p.decision.note}&quot;</T> : null}
              <T v="body">Don&apos;t {kind === 'wash' ? 'wash the van' : 'fill up'}. Cancel the {BUY_NOUN[kind]}; it stays on record as refused.</T>
              <Button v="primary" wide title={busy || `Cancel the ${BUY_NOUN[kind]}`} loading={!!busy} disabled={!!busy} onPress={cancel} />
            </>
          ) : (
            <>
              <T v="body">Call your fleet manager. They allow or refuse it in the app, and this screen changes by itself.</T>
              {(people || []).map((x) => (
                x.phone ? <Button key={x.name + x.phone} v="primary" wide title={`Call ${x.name}`} onPress={() => Linking.openURL(`tel:${x.phone!.replace(/[^+0-9]/g, '')}`)} />
                  : <T key={x.name} v="small">{x.name}: no phone number on record.</T>
              ))}
              {people && !people.length ? <T v="small">Nobody to call is on record for this station. Call the office.</T> : null}
              <Row><ActivityIndicator color={c.ink} /><T v="small">Waiting for an answer, {dur(Date.now() - (p.card.at || p.updatedAt))}.</T></Row>
            </>
          )}
        </View>
        {errLine}
        {!refused ? <Button small v="link" title={busy || `Cancel the ${BUY_NOUN[kind]}`} onPress={cancel} /> : null}
      </>
    );
  }

  /* 2. The fuel card */
  const cardNeeded = p.card.needed;
  if (kind !== 'parts' && cardNeeded && !p.card.result && !p.decision) {
    const takeCard = () => run('Uploading…', async () => {
      setCardMsg(null);
      const ph = await shoot(orgId, uid, 1600);
      if (!ph) return;
      setBusy('Checking the card…');
      const r = await ai.buy.card({ orgId, action: 'card', id: p.id, path: ph.path });
      if (r.result === 'retake') setCardMsg(r.why);
      if ('people' in r) setPeople(r.people);
    }, 'Couldn\'t check the card. Check the connection and try again.');
    const noCard = () => run('Telling your fleet manager…', async () => {
      const r = await ai.buy.card({ orgId, action: 'card', id: p.id, missing: true });
      if ('people' in r) setPeople(r.people);
    }, 'Couldn\'t reach the server. Check the connection and try again.');
    return (
      <>
        {head}
        <Steps kind={kind} at="card" card />
        <Now title="The fuel card" line="A photo of the front of the van's fuel card, close enough to read the number. Only its last 4 digits are kept; the photo is deleted.">
          {cardMsg ? <T v="medium" color="#000">Take it again: {cardMsg}</T> : null}
          <Button v="primary" wide title={busy || (cardMsg ? 'Take it again' : 'Photo of the fuel card')} loading={!!busy} disabled={!!busy} onPress={takeCard} />
        </Now>
        {errLine}
        {!busy ? <Button small v="link" title="I don't have the van's card" onPress={noCard} /> : null}
        {!busy ? <Button small v="link" title={`Cancel the ${BUY_NOUN[kind]}`} onPress={cancel} /> : null}
      </>
    );
  }

  /* 3. Parts: photos of the parts, why, the receipt */
  if (kind === 'parts' && !p.receipt) {
    const addPart = () => run('Uploading…', async () => {
      const ph = await shoot(orgId, uid);
      if (ph) setParts((x) => [...x, ph].slice(0, 6));
    }, 'The photo didn\'t upload. Check the connection and try again.');
    const takeReceipt = () => {
      if (!parts.length) { setErr('Take a photo of the parts first.'); return; }
      if (note.trim().length < 5) { setErr('Say why the parts were needed.'); return; }
      run('Uploading the receipt…', async () => {
        const ph = await shoot(orgId, uid);
        if (!ph) return;
        setThumbs((t) => ({ ...t, receipt: ph.uri }));
        setBusy('Reading the receipt…');
        await ai.buy.receipt({ orgId, action: 'receipt', id: p.id, path: ph.path, parts: parts.map((x) => x.path), note: note.trim() });
      }, 'Couldn\'t read the receipt. Check the connection and try again.');
    };
    return (
      <>
        {head}
        <Steps kind={kind} at="parts" card={false} />
        <Card>
          <T v="h3">The parts</T>
          {parts.length ? <Row>{parts.map((x) => <ZoomPhoto key={x.path} src={x.uri} style={{ width: 88, height: 66 }} caption="Parts" />)}</Row> : null}
          <Button title={parts.length ? 'Add another photo' : 'Photo of the parts'} disabled={!!busy || parts.length >= 6} onPress={addPart} />
          <Field label="Why were they needed?" value={note} onChangeText={setNote} multiline placeholder="For example: left mirror glass broke on the tour" style={{ minHeight: 88, textAlignVertical: 'top' }} />
        </Card>
        <Now title="The receipt" line="A photo of the whole receipt or invoice.">
          <Button v="primary" wide title={busy || 'Photo of the receipt'} loading={!!busy} disabled={!!busy} onPress={takeReceipt} />
        </Now>
        {errLine}
        {!busy ? <Button small v="link" title="Cancel the parts purchase" onPress={cancel} /> : null}
      </>
    );
  }

  /* 3. Fill up (or wash), then the receipt */
  if (!p.receipt) {
    const takeReceipt = () => run('Uploading the receipt…', async () => {
      const ph = await shoot(orgId, uid);
      if (!ph) return;
      setThumbs((t) => ({ ...t, receipt: ph.uri }));
      setBusy('Reading the receipt…');
      await ai.buy.receipt({ orgId, action: 'receipt', id: p.id, path: ph.path });
    }, 'Couldn\'t read the receipt. Check the connection and try again.');
    const ok = p.card.result === 'match';
    return (
      <>
        {head}
        <Steps kind={kind} at="go" card={needsCard ?? cardNeeded} />
        {ok ? <Banner tone="ok" text={`It's the van's card${p.card.read?.last4 ? ` (ending ${p.card.read.last4})` : ''}.`} /> : null}
        {p.decision?.allow ? <Banner tone="ok" text={`${p.decision.byName} allowed it${p.decision.note ? `: "${p.decision.note}"` : '.'}`} /> : null}
        <Now title={kind === 'wash' ? 'Wash the van now' : 'Fill up now'} line="Then take a photo of the whole receipt: the litres, the total and the card number on it.">
          <Button v="primary" wide title={busy || 'Photo of the receipt'} loading={!!busy} disabled={!!busy} onPress={takeReceipt} />
        </Now>
        {errLine}
        {!busy ? <Button small v="link" title={`Cancel the ${BUY_NOUN[kind]}`} onPress={cancel} /> : null}
      </>
    );
  }

  /* 4. Check the numbers and save */
  return <Confirm van={van} p={p} thumbs={thumbs} needsCard={needsCard ?? cardNeeded} onCancel={cancel} cancelBusy={busy} />;
}

function Banner({ text, tone }: { text: string; tone: 'ok' | 'bad' }) {
  const c = useColors();
  const col = tone === 'ok' ? c.ok : c.alert;
  return <View style={{ borderLeftWidth: 5, borderColor: col, paddingLeft: 10, paddingVertical: 4 }}><T v="medium" color={col}>{text}</T></View>;
}

function Confirm({ van, p, thumbs, needsCard, onCancel, cancelBusy }: { van: Vehicle; p: Purchase; thumbs: { dash?: string; receipt?: string }; needsCard: boolean; onCancel: () => void; cancelBusy: string | null }) {
  const s = useSession();
  const c = useColors();
  const r = p.receipt!.ai;
  const fuel = p.kind === 'fuel';
  const [form, setForm] = useState(() => ({
    odo: show(p.dash.ai?.odometerKm), fuel: show(p.dash.ai?.fuelPct),
    litres: show(fuel ? fuelLitres(r, p.vanFuel) : null), total: show(r.total, 2),
  }));
  // The dashboard may still be being read when the receipt is done: fill in what arrives, unless typed over.
  const filled = useRef(p.dash.done);
  useEffect(() => {
    if (filled.current || !p.dash.done) return;
    filled.current = true;
    setForm((f) => ({ ...f, odo: f.odo || show(p.dash.ai?.odometerKm), fuel: f.fuel || show(p.dash.ai?.fuelPct) }));
  }, [p.dash.done, p.dash.ai]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const odometerKm = num(form.odo), total = num(form.total), litres = fuel ? num(form.litres) : null, fuelPct = fuel ? num(form.fuel) : null;
    if (odometerKm == null || !Number.isFinite(odometerKm)) { setErr('Enter the odometer reading in km.'); return; }
    if (fuel && (litres == null || !(litres > 0))) { setErr('Enter the litres from the receipt.'); return; }
    if (total == null || !Number.isFinite(total)) { setErr('Enter the total from the receipt.'); return; }
    setBusy('Saving…');
    try {
      await ai.buy.finish({ orgId: s.org!.id, action: 'finish', id: p.id, values: { odometerKm, fuelPct, litres, total } });
    } catch (e) { setErr(errText(e, 'Couldn\'t save. Check the connection and try again.')); } finally { setBusy(null); }
  };
  return (
    <>
      <View style={{ gap: 6 }}>
        <T v="h1">{BUY_NAME[p.kind]}: {van.name}</T>
        <Row><Plate text={van.plate} /></Row>
      </View>
      <Steps kind={p.kind} at="check" card={p.kind === 'parts' ? false : needsCard} />
      <Card>
        <T v="h3">Check the numbers</T>
        <Row style={{ alignItems: 'flex-start' }}>
          <ZoomPhoto src={thumbs.dash || p.dash.path} style={{ width: 120, height: 90 }} caption="Dashboard" />
          <ZoomPhoto src={thumbs.receipt || p.receipt!.path} style={{ width: 90, height: 120 }} caption="Receipt" contentFit="cover" />
        </Row>
        <T v="small">{!r.readable ? `The receipt couldn't be read${r.issue ? `: ${r.issue}` : ''}. Type the numbers from it.`
          : [r.merchant, [r.date, r.time].filter(Boolean).join(' '), r.cardLast4 ? `card ending ${r.cardLast4}` : r.payment === 'cash' ? 'paid in cash' : ''].filter(Boolean).join(', ')}</T>
        <Field label="Odometer (km)" value={form.odo} onChangeText={(t) => setForm((f) => ({ ...f, odo: t }))} keyboardType="number-pad"
          placeholder={p.dash.done ? 'From the dashboard photo' : 'Reading the dashboard…'} />
        {p.lastKm != null ? <T v="small">Last known: {kmText(p.lastKm)}.</T> : null}
        {fuel ? (
          <View style={{ gap: 6 }}>
            <T v="medium">Fuel gauge before filling up</T>
            <Row gap={6}>{EIGHTHS.map(([v, label]) => <Chip key={label} text={label} on={num(form.fuel) === v} onPress={() => setForm((f) => ({ ...f, fuel: show(v) }))} />)}</Row>
            <Field label="or in percent" value={form.fuel} onChangeText={(t) => setForm((f) => ({ ...f, fuel: t }))} keyboardType="decimal-pad" />
          </View>
        ) : null}
        {fuel ? <Field label={`Litres of ${p.vanFuel === 'petrol' ? 'petrol' : p.vanFuel === 'diesel' ? 'diesel' : 'fuel'}`} value={form.litres} onChangeText={(t) => setForm((f) => ({ ...f, litres: t }))} keyboardType="decimal-pad" /> : null}
        <Field label={`Total (${r.currency && r.currency !== 'EUR' ? r.currency : '€'})`} value={form.total} onChangeText={(t) => setForm((f) => ({ ...f, total: t }))} keyboardType="decimal-pad" />
        {err ? <T v="small" color={c.alert}>{err}</T> : null}
        <Button v="primary" wide title={busy || 'Save'} loading={!!busy} disabled={!!busy} onPress={save} />
        <T v="small">{p.kind === 'parts' ? 'The owners get the details.' : 'Your fleet manager gets the details.'}</T>
      </Card>
      {!busy ? <Button small v="link" title={cancelBusy || `Cancel the ${BUY_NOUN[p.kind]}`} onPress={onCancel} /> : null}
    </>
  );
}

/** The record: what happened, the photos, what to check; and for the station's staff, the answer to a stopped driver. */
function Summary({ p }: { p: Purchase }) {
  const s = useSession();
  const c = useColors();
  const st = buyState(p);
  const staffHere = s.runs(p.stationId);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setErr(null); setBusy(label);
    try { await fn(); } catch (e) { setErr(errText(e, 'Couldn\'t save. Check the connection.')); } finally { setBusy(null); }
  };
  const decide = (allow: boolean) => act(allow ? 'Allowing…' : 'Refusing…', () => ai.buy.decide({ orgId: s.org!.id, action: 'decide', id: p.id, allow, note: note.trim() }));
  const ownAsk = p.by === s.user?.uid && s.role !== 'owner';
  const facts: [string, string][] = [
    ['Odometer', p.odometerKm != null ? kmText(p.odometerKm) : p.dash.ai?.odometerKm != null ? `${kmText(p.dash.ai.odometerKm)} (read, not confirmed)` : '–'],
    ...(p.kind === 'fuel' ? [['Litres', litresText(p.litres) || '–'] as [string, string], ['Gauge before', p.fuelPct != null ? `${Math.round(p.fuelPct)}%` : '–'] as [string, string]] : []),
    ['Total', money(p.total, p.currency)],
    ['Where', p.merchant || p.receipt?.ai.merchant || '–'],
    ['Receipt', [p.receipt?.ai.date, p.receipt?.ai.time].filter(Boolean).join(' ') || '–'],
  ];
  return (
    <>
      <View style={{ gap: 6 }}>
        <T v="h1">{BUY_NAME[p.kind]}: {p.vehicleName}</T>
        <Row><Plate text={p.plate || ''} /><Pill v={st.v} text={st.text} /></Row>
        <T v="hint">{p.byName}, {fmtWhen(p.createdAt)}{p.notTheirVan && p.vanDriverName ? `. ${p.vanDriverName} had the van.` : ''}</T>
      </View>

      {p.status === 'waiting' && staffHere ? (
        <View style={{ borderWidth: 3, borderColor: c.alert, borderRadius: 4, padding: 14, gap: 8, backgroundColor: c.paper }}>
          <Text style={{ fontFamily: F.condBold, fontSize: 26, lineHeight: 29, color: c.alert }}>{p.byName} is waiting at the {p.kind === 'wash' ? 'car wash' : 'pump'}</Text>
          <T v="medium">{cardLine(p)}</T>
          <T v="small">Stopped {dur(Date.now() - (p.card.at || p.createdAt))} ago. Allow it if you know why (another van&apos;s card, a replacement card); refuse it if not. The driver&apos;s screen changes at once.</T>
          {ownAsk ? <T v="body">It&apos;s your own: someone else has to allow it.</T> : (
            <>
              <Field label="Note to the driver" hint="optional" value={note} onChangeText={setNote} placeholder="For example: use the card in the glovebox" />
              <Row>
                <Button v="primary" title={busy === 'Allowing…' ? busy : 'Allow it'} loading={busy === 'Allowing…'} disabled={!!busy} onPress={() => decide(true)} />
                <Button v="danger" title={busy === 'Refusing…' ? busy : 'Refuse'} loading={busy === 'Refusing…'} disabled={!!busy} onPress={() => decide(false)} />
              </Row>
            </>
          )}
          {err ? <T v="small" color={c.alert}>{err}</T> : null}
        </View>
      ) : null}

      {p.flags?.length ? (
        <View style={{ borderWidth: 2, borderColor: c.amber, borderRadius: 4, padding: 12, gap: 6, backgroundColor: c.paper }}>
          <T v="h3" color={c.amber}>To check</T>
          {p.flags.map((f) => <T key={f.key} v="body">{f.text}</T>)}
        </View>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 }}>
          {facts.map(([k, v]) => (
            <View key={k} style={{ width: '50%', paddingRight: 8, gap: 1 }}>
              <T v="small">{k}</T>
              <T v="medium">{v}</T>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <T v="h3">What happened</T>
        <Line when={p.createdAt} text={`${p.byName} took the dashboard photo${p.dash.done && !p.dash.readable ? ' (the AI couldn\'t read it)' : ''}.`} />
        {p.kind !== 'parts' ? <Line when={p.card.at} text={`Fuel card: ${cardLine(p)}`} /> : null}
        {p.decision ? <Line when={p.decision.at} text={`${p.decision.byName} ${p.decision.allow ? 'allowed' : 'refused'} it${p.decision.note ? `: "${p.decision.note}"` : '.'}`} /> : null}
        {p.note ? <Line when={p.receipt?.at || null} text={`Why: ${p.note}`} /> : null}
        {p.receipt ? <Line when={p.receipt.at} text="Receipt photographed." /> : null}
        {p.status === 'done' ? <Line when={p.doneAt} text={`Saved${p.corrected?.length ? `; typed in by hand: ${p.corrected.map((k) => ({ odometerKm: 'odometer', fuelPct: 'fuel gauge', litres: 'litres', total: 'total' } as Record<string, string>)[k] || k).join(', ')}` : ''}.`} /> : null}
        {p.cancel ? <Line when={p.cancel.at} text={`Cancelled by ${p.cancel.byName}${p.cancel.reason ? `: ${p.cancel.reason}` : '.'}`} /> : null}
        {isOpenBuy(p) && p.status !== 'waiting' ? <Line when={null} text={Date.now() - p.createdAt > STALE_BUY ? 'Never finished.' : 'Still going on.'} /> : null}
      </Card>

      <Card>
        <T v="h3">Photos</T>
        <Row style={{ alignItems: 'flex-start' }}>
          <ZoomPhoto src={p.dash.path} style={{ width: 120, height: 90 }} caption={`Dashboard, ${fmtWhen(p.dash.at)}`} />
          {p.receipt ? <ZoomPhoto src={p.receipt.path} style={{ width: 90, height: 120 }} caption={`Receipt, ${fmtWhen(p.receipt.at)}`} /> : null}
          {(p.parts || []).map((x, i) => <ZoomPhoto key={x} src={x} style={{ width: 120, height: 90 }} caption={`Parts, photo ${i + 1}`} />)}
        </Row>
        {p.kind !== 'parts' && p.card.needed ? <T v="small">The card photo isn&apos;t kept, only its last 4 digits.</T> : null}
      </Card>

      {p.receipt?.ai.items?.length ? (
        <Card>
          <T v="h3">On the receipt</T>
          {p.receipt.ai.items.map((i, k) => (
            <Row key={k} style={{ flexWrap: 'nowrap' }}>
              <T v="body" style={{ flex: 1 }}>{i.description}{i.quantity != null && i.unit ? `, ${i.quantity.toLocaleString()} ${i.unit}` : ''}</T>
              <T v="medium">{i.total != null ? money(i.total, p.receipt!.ai.currency) : ''}</T>
            </Row>
          ))}
        </Card>
      ) : null}

      {staffHere && isOpenBuy(p) && p.status !== 'waiting' && p.by !== s.user?.uid ? (
        <Button small v="link" title={busy || 'Close it (not finished)'} onPress={() => act('Closing…', () => ai.buy.cancel({ orgId: s.org!.id, action: 'cancel', id: p.id, reason: 'Not finished' }))} />
      ) : null}
      <Button small v="link" title={`Open ${p.vehicleName}`} onPress={() => router.push(`/vehicle/${p.vehicleId}`)} />
    </>
  );
}

function Line({ when, text }: { when: number | null | undefined; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Text style={{ width: 92, fontFamily: F.medium, fontSize: 13, lineHeight: 20, color: c.ink2 }}>{when ? fmtWhen(when) : ''}</Text>
      <T v="body" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}
