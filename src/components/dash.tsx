import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image } from 'expo-image';
import { Platform, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Button, Chip, F, Field, MARKER, Row, T, fmtWhen, useColors } from '@/components/ui';
import { flash } from '@/lib/flash';
import { newId, prepare, upload } from '@/lib/images';
import { useSession } from '@/lib/session';
import { STALE_TOUR, isOpen } from '@/lib/stats';
import { AiError, ai, type DashRead } from '@/lib/store';
import type { DashValues, Tour, Vehicle } from '@/lib/types';
import { loc } from '@/lib/i18n';

/**
 * Tours from dashboard photos (where the owner turned them on): the driver photographs the dashboard when the tour
 * starts and when it ends. The AI reads the odometer, the fuel or battery level and any warning lights; the driver
 * checks the numbers, corrects them if needed and saves. The server starts or ends the tour and works out the
 * kilometres and the fuel used.
 */

const EIGHTHS: [number, string][] = [[0, 'Empty'], [12.5, '1/8'], [25, '1/4'], [37.5, '3/8'], [50, '1/2'], [62.5, '5/8'], [75, '3/4'], [87.5, '7/8'], [100, 'Full']];
const num = (t: string) => { const s = t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return s ? Number(s) : null; };
const show = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
export const kmText = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n).toLocaleString(loc())} km`);
/** "10.4 l/100 km" or "29.0 kWh/100 km". */
export const per100Text = (v: number | null | undefined, unit: 'l' | 'kwh' | null | undefined) =>
  (v == null ? '–' : `${v.toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit === 'kwh' ? 'kWh' : 'l'}/100 km`);

/** Takes the dashboard photo with the camera (on the web: the phone's camera through the browser). */
export async function takePhoto(): Promise<{ uri: string; w: number; h: number } | null> {
  if (Platform.OS !== 'web') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('camera');
  }
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return { uri: a.uri, w: a.width, h: a.height };
}

/** What a photo will do, in words for the button and the form. */
function intent(s: ReturnType<typeof useSession>, v: Vehicle) {
  const me = s.user?.uid;
  const hasVan = v.assignedTo?.driverId === me;
  const open = s.tours.filter((t) => t.vehicleId === v.id && isOpen(t));
  const mine = open.find((t) => t.driverId === me) || null;
  const others = open.filter((t) => t.driverId !== me);
  if (mine) {
    const stale = hasVan && Date.now() - mine.startAt > STALE_TOUR;
    return { kind: stale ? 'start' : 'end', mine, others, hasVan, stale } as const;
  }
  if (hasVan) return { kind: 'start', mine: null, others, hasVan, stale: false } as const;
  if (others.length && s.runs(v.stationId)) return { kind: 'end-other', mine: null, others, hasVan, stale: false } as const;
  return null;
}

/**
 * The tour card on a van: start or end the tour with a dashboard photo. Shown to the driver who has the van (or
 * whose tour on it is still open), and to the station's staff when a driver left a tour open.
 */
export function TourCard({ v, compact }: { v: Vehicle; compact?: boolean }) {
  const s = useSession();
  const c = useColors();
  const [open, setOpen] = useState(false);
  if (s.mode !== 'firebase' || !s.org?.dashScans || v.retired && !s.tours.some((t) => t.vehicleId === v.id && isOpen(t))) return null;
  const it = intent(s, v);
  if (!it) return null;
  if (it.kind === 'end-other') {
    const t = it.others[0];
    return (
      <View style={{ borderWidth: 2, borderColor: c.amber, borderRadius: 4, padding: 12, gap: 6, backgroundColor: c.paper }}>
        <T v="medium">{t.driverName}&apos;s tour is still open</T>
        <T v="small">Started {fmtWhen(t.startAt)} ({dur(Date.now() - t.startAt)} ago) at {kmText(t.start.km)}. If the van is back, end it with a photo of the dashboard.</T>
        {open ? <DashReading v={v} onDone={() => setOpen(false)} /> : <Button small title="End the tour with a dashboard photo" onPress={() => setOpen(true)} />}
      </View>
    );
  }
  const starting = it.kind === 'start';
  const title = starting ? 'Start your tour' : 'End your tour';
  const line = starting
    ? it.stale ? `Your last tour on ${v.name} had no end photo. This photo ends it and starts today's.` : 'Before you drive off: a photo of the dashboard with the ignition on, so the kilometres and the fuel are on record.'
    : `Started ${fmtWhen(it.mine!.startAt)} at ${kmText(it.mine!.start.km)}. When you're back: a photo of the dashboard with the ignition on.`;
  return (
    <View style={{ backgroundColor: MARKER, borderRadius: 4, padding: 14, gap: 8, borderWidth: 2, borderColor: '#000' }}>
      <Row>
        <Text style={{ fontFamily: F.condBold, fontSize: compact ? 22 : 26, lineHeight: compact ? 25 : 29, color: '#000', flexShrink: 1 }}>{title}</Text>
        {!starting ? <View style={{ borderWidth: 1.5, borderColor: '#000', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}><Text style={{ fontFamily: F.medium, fontSize: 13, color: '#000' }}>On tour {dur(Date.now() - it.mine!.startAt)}</Text></View> : null}
      </Row>
      {compact ? <T v="medium" color="#000">{v.name}{v.plate ? `, ${v.plate}` : ''}</T> : null}
      <T v="body" color="#000">{line}</T>
      {open ? <DashReading v={v} onDone={() => setOpen(false)} /> : <Button v="primary" wide title={starting ? 'Photo of the dashboard' : 'End-of-tour photo'} onPress={() => setOpen(true)} />}
    </View>
  );
}

/** Photo, the AI's reading, the person's check, save. */
export function DashReading({ v, onDone }: { v: Vehicle; onDone: () => void }) {
  const s = useSession();
  const c = useColors();
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [read, setRead] = useState<DashRead | null>(null);
  const [form, setForm] = useState({ odo: '', fuel: '', battery: '', range: '' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refuel, setRefuel] = useState<'no' | 'litres' | 'unknown' | null>(null);
  const [litres, setLitres] = useState('');
  const [jump, setJump] = useState<string | null>(null);
  const [fromReceipts, setFromReceipts] = useState(0);
  const ev = v.fuel === 'electric';
  const shoot = async () => {
    setErr(null); setJump(null);
    try {
      const p = await takePhoto();
      if (!p) return;
      setPhoto(p.uri);
      setStep('Uploading the photo…');
      const small = await prepare(p.uri, p.w, p.h, 2000, 0.85);
      const path = await upload(small.uri, `orgs/${s.org!.id}/dash/${s.user!.uid}/${newId()}.jpg`);
      setStep('Reading the dashboard…');
      const r = await ai.readDashboard({ orgId: s.org!.id, vehicleId: v.id, path });
      setRead(r);
      setForm({ odo: show(r.values.odometerKm), fuel: show(r.values.fuelPct), battery: show(r.values.batteryPct), range: show(r.values.rangeKm) });
      setWarnings(r.values.warnings);
      // Refuels recorded with their receipt during this tour answer the refuelling question.
      const mine = s.tours.find((t) => t.vehicleId === v.id && isOpen(t) && t.driverId === s.user?.uid);
      const fills = mine && r.endsMine ? s.purchases.filter((x) => x.kind === 'fuel' && x.status === 'done' && x.vehicleId === v.id && x.by === s.user?.uid && x.createdAt >= mine.startAt && x.litres) : [];
      if (fills.length && !ev) {
        setRefuel('litres');
        setLitres(show(Math.round(fills.reduce((n, x) => n + (x.litres || 0), 0) * 100) / 100));
        setFromReceipts(fills.length);
      }
    } catch (e) {
      setErr(e instanceof Error && e.message === 'camera' ? 'Allow camera access in Settings to take the photo.'
        : e instanceof AiError ? e.message : 'The photo didn\'t upload. Check the connection and try again.');
    } finally { setStep(null); }
  };
  // Ending their own tour with this photo: the refuelling question makes the fuel figure possible.
  const ending = !!read && read.endsMine;
  const save = async (sure = false) => {
    if (!read) return;
    setErr(null); setJump(null);
    const odometerKm = num(form.odo);
    if (odometerKm == null || !Number.isFinite(odometerKm)) { setErr('Enter the odometer reading in km.'); return; }
    if (ending && !refuel) { setErr(ev ? 'Say whether you charged during the tour.' : 'Say whether you refuelled during the tour.'); return; }
    const values: DashValues = { odometerKm, fuelPct: ev ? null : num(form.fuel), batteryPct: ev ? num(form.battery) : null, rangeKm: num(form.range), warnings };
    const l = refuel === 'litres' ? num(litres) : null;
    if (refuel === 'litres' && (l == null || !(l > 0))) { setErr('Enter the litres from the receipt.'); return; }
    setStep('Saving…');
    try {
      const r = await ai.saveReading({ orgId: s.org!.id, readId: read.readId, values, sure,
        refuel: ending ? { litres: ev ? null : l, kwh: null, unknown: refuel === 'unknown' || (ev && refuel === 'litres') } : null });
      flash(`van:${v.id}`, savedText(r.role, r.tour, odometerKm));
      onDone();
    } catch (e) {
      if (e instanceof AiError && e.code === 'out-of-range') setJump(e.message);
      else setErr(e instanceof AiError ? e.message : 'Couldn\'t save. Check the connection and try again.');
    } finally { setStep(null); }
  };

  if (!read) {
    return (
      <View style={{ gap: 6 }}>
        <Button v="primary" wide title={step || 'Take the photo'} loading={!!step} disabled={!!step} onPress={shoot} />
        <T v="small" color="#000">Ignition on, the whole display in the picture: odometer, {ev ? 'battery' : 'fuel gauge'} and any warning lights. No flash.</T>
        {err ? <T v="small" color={c.alert}>{err}</T> : null}
        {!step ? <Button small v="link" title="Cancel" onPress={onDone} /> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 10, backgroundColor: c.paper, borderRadius: 4, padding: 12, borderWidth: 2, borderColor: c.ink }}>
      <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        {photo ? <Image source={{ uri: photo }} style={{ width: 96, height: 72, borderRadius: 3, backgroundColor: '#000' }} contentFit="cover" /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <T v="medium">{read.readable ? 'Check what the AI read' : 'Type the numbers from the dashboard'}</T>
          <T v="small">{read.readable ? (read.confidence != null && read.confidence < 0.7 ? 'The AI isn\'t sure about the odometer. Compare it with the dashboard.' : 'Compare with the dashboard and correct anything that\'s wrong.')
            : `The AI couldn't read it${read.issue ? `: ${read.issue}` : ''}.`}</T>
        </View>
      </Row>
      <Field label="Odometer (km)" value={form.odo} onChangeText={(t) => setForm((f) => ({ ...f, odo: t }))} keyboardType="number-pad" placeholder="For example 48213" />
      {read.last ? <T v="small">Last reading: {kmText(read.last.km)}, {fmtWhen(read.last.at)}{read.last.byName ? ` (${read.last.byName})` : ''}.</T> : null}
      {ev ? (
        <Field label="Battery (%)" value={form.battery} onChangeText={(t) => setForm((f) => ({ ...f, battery: t }))} keyboardType="number-pad" />
      ) : (
        <View style={{ gap: 6 }}>
          <T v="medium">Fuel gauge</T>
          <Row gap={6}>{EIGHTHS.map(([p, label]) => <Chip key={label} text={label} on={num(form.fuel) === p} onPress={() => setForm((f) => ({ ...f, fuel: show(p) }))} />)}</Row>
          <Field label="or in percent" value={form.fuel} onChangeText={(t) => setForm((f) => ({ ...f, fuel: t }))} keyboardType="decimal-pad" />
        </View>
      )}
      <Field label="Range shown (km)" hint="optional" value={form.range} onChangeText={(t) => setForm((f) => ({ ...f, range: t }))} keyboardType="number-pad" />
      <View style={{ gap: 6 }}>
        <T v="medium">Warning lights</T>
        {warnings.length ? (
          <>
            <Row gap={6}>{warnings.map((w) => <Chip key={w} text={`${w}  ✕`} on onPress={() => setWarnings((x) => x.filter((y) => y !== w))} />)}</Row>
            <T v="small">Tap one that isn&apos;t lit to remove it. Your fleet manager sees the rest.</T>
          </>
        ) : <T v="small">None found. If one is lit, tell your fleet manager.</T>}
      </View>
      {ending ? (
        <View style={{ gap: 6 }}>
          <T v="medium">{ev ? 'Did you charge the van during the tour?' : 'Did you refuel during the tour?'}</T>
          <Row gap={6}>
            <Chip text="No" on={refuel === 'no'} onPress={() => setRefuel('no')} />
            <Chip text={ev ? 'Yes' : 'Yes, litres from the receipt'} on={refuel === 'litres'} onPress={() => setRefuel('litres')} />
            {!ev ? <Chip text="Yes, don't know how much" on={refuel === 'unknown'} onPress={() => setRefuel('unknown')} /> : null}
          </Row>
          {refuel === 'litres' && !ev ? <Field label="Litres" value={litres} onChangeText={setLitres} keyboardType="decimal-pad" /> : null}
          {refuel === 'litres' && fromReceipts ? <T v="small">From {fromReceipts === 1 ? 'your refuel' : `your ${fromReceipts} refuels`} during this tour (the receipt{fromReceipts === 1 ? '' : 's'}).</T> : null}
        </View>
      ) : null}
      {read.will === 'end' && !read.endsMine && read.tourDriver ? <T v="small">This ends {read.tourDriver}&apos;s tour.</T> : null}
      {read.will === 'end-start' && read.tourDriver ? <T v="small">{read.tourDriver} didn&apos;t take an end photo: this ends their tour and starts yours.</T> : null}
      {jump ? (
        <View style={{ gap: 6 }}>
          <T v="small" color={c.alert}>{jump}</T>
          <Button small title="It's right, save it" loading={!!step} onPress={() => save(true)} />
        </View>
      ) : null}
      {err ? <T v="small" color={c.alert}>{err}</T> : null}
      <Row>
        <Button v="primary" title={step || (read.will === 'none' ? 'Save the reading' : read.will === 'start' || read.will === 'end-start' ? 'Save and start the tour' : 'Save and end the tour')} loading={!!step} disabled={!!step} onPress={() => save()} />
        <Button small v="link" title="Take it again" onPress={() => { setRead(null); setPhoto(null); }} />
      </Row>
    </View>
  );
}

function savedText(role: 'start' | 'end' | 'none', t: Tour | null, km: number) {
  if (role === 'start') return `Tour started at ${kmText(km)}. Take the end photo when you're back.`;
  if (role === 'end' && t) {
    return [`Tour ended: ${kmText(t.km)}`, t.hours != null ? `in ${t.hours.toLocaleString(loc())} h` : '', t.per100 != null ? per100Text(t.per100, t.unit) : ''].filter(Boolean).join(', ') + '.';
  }
  return `Odometer saved: ${kmText(km)}.`;
}

/** A compact line about a tour, for lists. */
export function TourLine({ t, show: who }: { t: Tour; show: 'driver' | 'van' }) {
  const c = useColors();
  const open = isOpen(t);
  return (
    <View style={{ gap: 2 }}>
      <Row>
        <T v="medium" style={{ flex: 1 }} numberOfLines={1}>{who === 'driver' ? t.driverName : t.vehicleName}</T>
        <Text style={{ fontFamily: F.condBold, fontSize: 17, color: c.ink, fontVariant: ['tabular-nums'] }}>{open ? 'On tour' : kmText(t.km)}</Text>
      </Row>
      <T v="small">{[fmtWhen(t.startAt), t.end ? `to ${new Date(t.end.at).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}` : '',
        t.per100 != null ? per100Text(t.per100, t.unit) : '', t.endedHow === 'next' ? 'no end photo (estimated)' : t.endedHow === 'none' ? 'no end photo' : '',
        t.warnings?.length ? `warning: ${t.warnings.join(', ')}` : ''].filter(Boolean).join(', ')}</T>
    </View>
  );
}
