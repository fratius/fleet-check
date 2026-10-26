import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image } from 'expo-image';
import { Platform, Text, View } from 'react-native';

import { dur } from '@/components/history';
import { Button, Chip, F, Field, MARKER, Row, T, fmtWhen, useColors } from '@/components/ui';
import { fmtDay } from '@/lib/fleet';
import { flash } from '@/lib/flash';
import { newId, prepare, upload } from '@/lib/images';
import { useSession } from '@/lib/session';
import { STALE_TOUR, isOpen } from '@/lib/stats';
import { AiError, ai, type DashRead } from '@/lib/store';
import type { DashValues, Tour, Vehicle } from '@/lib/types';
import { N_, loc, t, tp } from '@/lib/i18n';

/**
 * Tours from dashboard photos (where the owner turned them on): the driver photographs the dashboard when the tour
 * starts and when it ends. The AI reads the odometer, the fuel or battery level and any warning lights; the driver
 * checks the numbers, corrects them if needed and saves. The server starts or ends the tour and works out the
 * kilometres and the fuel used.
 */

const EIGHTHS: [number, string][] = [[0, N_('Empty')], [12.5, '1/8'], [25, '1/4'], [37.5, '3/8'], [50, '1/2'], [62.5, '5/8'], [75, '3/4'], [87.5, '7/8'], [100, N_('Full')]];
const num = (txt: string) => { const s = txt.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return s ? Number(s) : null; };
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
  const open = s.tours.filter((x) => x.vehicleId === v.id && isOpen(x));
  const mine = open.find((x) => x.driverId === me) || null;
  const others = open.filter((x) => x.driverId !== me);
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
  if (s.mode !== 'firebase' || !s.org?.dashScans || v.retired && !s.tours.some((x) => x.vehicleId === v.id && isOpen(x))) return null;
  const it = intent(s, v);
  if (!it) return null;
  if (it.kind === 'end-other') {
    const other = it.others[0];
    return (
      <View style={{ borderWidth: 2, borderColor: c.amber, borderRadius: 4, padding: 12, gap: 6, backgroundColor: c.paper }}>
        <T v="medium">{t('{name}\'s tour is still open', { name: other.driverName })}</T>
        <T v="small">{t('Started {when} ({time} ago) at {km}. If the van is back, end it with a photo of the dashboard.', { when: fmtWhen(other.startAt), time: dur(Date.now() - other.startAt), km: kmText(other.start.km) })}</T>
        {open ? <DashReading v={v} onDone={() => setOpen(false)} /> : <Button small title={t('End the tour with a dashboard photo')} onPress={() => setOpen(true)} />}
      </View>
    );
  }
  const starting = it.kind === 'start';
  const title = starting ? t('Start your tour') : t('End your tour');
  const line = starting
    ? it.stale ? t('Your last tour on {van} had no end photo. This photo ends it and starts today\'s.', { van: v.name }) : t('Before you drive off: a photo of the dashboard with the ignition on, so the kilometres and the fuel are on record.')
    : t('Started {when} at {km}. When you\'re back: a photo of the dashboard with the ignition on.', { when: fmtWhen(it.mine!.startAt), km: kmText(it.mine!.start.km) });
  return (
    <View style={{ backgroundColor: MARKER, borderRadius: 4, padding: 14, gap: 8, borderWidth: 2, borderColor: '#000' }}>
      <Row>
        <Text style={{ fontFamily: F.condBold, fontSize: compact ? 22 : 26, lineHeight: compact ? 25 : 29, color: '#000', flexShrink: 1 }}>{title}</Text>
        {!starting ? <View style={{ borderWidth: 1.5, borderColor: '#000', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}><Text style={{ fontFamily: F.medium, fontSize: 13, color: '#000' }}>{t('On tour {time}', { time: dur(Date.now() - it.mine!.startAt) })}</Text></View> : null}
      </Row>
      {compact ? <T v="medium" color="#000">{v.name}{v.plate ? `, ${v.plate}` : ''}</T> : null}
      <T v="body" color="#000">{line}</T>
      {open ? <DashReading v={v} onDone={() => setOpen(false)} /> : <Button v="primary" wide title={starting ? t('Photo of the dashboard') : t('End-of-tour photo')} onPress={() => setOpen(true)} />}
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
      setStep(t('Uploading the photo…'));
      const small = await prepare(p.uri, p.w, p.h, 2000, 0.85);
      const path = await upload(small.uri, `orgs/${s.org!.id}/dash/${s.user!.uid}/${newId()}.jpg`);
      setStep(t('Reading the dashboard…'));
      const r = await ai.readDashboard({ orgId: s.org!.id, vehicleId: v.id, path });
      setRead(r);
      setForm({ odo: show(r.values.odometerKm), fuel: show(r.values.fuelPct), battery: show(r.values.batteryPct), range: show(r.values.rangeKm) });
      setWarnings(r.values.warnings);
      // Refuels recorded with their receipt during this tour answer the refuelling question.
      const mine = s.tours.find((x) => x.vehicleId === v.id && isOpen(x) && x.driverId === s.user?.uid);
      const fills = mine && r.endsMine ? s.purchases.filter((x) => x.kind === 'fuel' && x.status === 'done' && x.vehicleId === v.id && x.by === s.user?.uid && x.createdAt >= mine.startAt && x.litres) : [];
      if (fills.length && !ev) {
        setRefuel('litres');
        setLitres(show(Math.round(fills.reduce((n, x) => n + (x.litres || 0), 0) * 100) / 100));
        setFromReceipts(fills.length);
      }
    } catch (e) {
      setErr(e instanceof Error && e.message === 'camera' ? t('Allow camera access in Settings to take the photo.')
        : e instanceof AiError ? e.message : t('The photo didn\'t upload. Check the connection and try again.'));
    } finally { setStep(null); }
  };
  // Ending their own tour with this photo: the refuelling question makes the fuel figure possible.
  const ending = !!read && read.endsMine;
  const save = async (sure = false) => {
    if (!read) return;
    setErr(null); setJump(null);
    const odometerKm = num(form.odo);
    if (odometerKm == null || !Number.isFinite(odometerKm)) { setErr(t('Enter the odometer reading in km.')); return; }
    if (ending && !refuel) { setErr(ev ? t('Say whether you charged during the tour.') : t('Say whether you refuelled during the tour.')); return; }
    const values: DashValues = { odometerKm, fuelPct: ev ? null : num(form.fuel), batteryPct: ev ? num(form.battery) : null, rangeKm: num(form.range), warnings };
    const l = refuel === 'litres' ? num(litres) : null;
    if (refuel === 'litres' && (l == null || !(l > 0))) { setErr(t('Enter the litres from the receipt.')); return; }
    setStep(t('Saving…'));
    try {
      const r = await ai.saveReading({ orgId: s.org!.id, readId: read.readId, values, sure,
        refuel: ending ? { litres: ev ? null : l, kwh: null, unknown: refuel === 'unknown' || (ev && refuel === 'litres') } : null });
      flash(`van:${v.id}`, savedText(r.role, r.tour, odometerKm));
      onDone();
    } catch (e) {
      if (e instanceof AiError && e.code === 'out-of-range') setJump(e.message);
      else setErr(e instanceof AiError ? e.message : t('Couldn\'t save. Check the connection and try again.'));
    } finally { setStep(null); }
  };

  if (!read) {
    return (
      <View style={{ gap: 6 }}>
        <Button v="primary" wide title={step || t('Take the photo')} loading={!!step} disabled={!!step} onPress={shoot} />
        <T v="small" color="#000">{ev ? t('Ignition on, the whole display in the picture: odometer, battery and any warning lights. No flash.')
          : t('Ignition on, the whole display in the picture: odometer, fuel gauge and any warning lights. No flash.')}</T>
        {err ? <T v="small" color={c.alert}>{err}</T> : null}
        {!step ? <Button small v="link" title={t('Cancel')} onPress={onDone} /> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 10, backgroundColor: c.paper, borderRadius: 4, padding: 12, borderWidth: 2, borderColor: c.ink }}>
      <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        {photo ? <Image source={{ uri: photo }} style={{ width: 96, height: 72, borderRadius: 3, backgroundColor: '#000' }} contentFit="cover" /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <T v="medium">{read.readable ? t('Check what the AI read') : t('Type the numbers from the dashboard')}</T>
          <T v="small">{read.readable ? (read.confidence != null && read.confidence < 0.7 ? t('The AI isn\'t sure about the odometer. Compare it with the dashboard.') : t('Compare with the dashboard and correct anything that\'s wrong.'))
            : read.issue ? t('The AI couldn\'t read it: {issue}.', { issue: read.issue }) : t('The AI couldn\'t read it.')}</T>
        </View>
      </Row>
      <Field label={t('Odometer (km)')} value={form.odo} onChangeText={(x) => setForm((f) => ({ ...f, odo: x }))} keyboardType="number-pad" placeholder={t('For example 48213')} />
      {read.last ? <T v="small">{read.last.byName ? t('Last reading: {km}, {when} ({name}).', { km: kmText(read.last.km), when: fmtWhen(read.last.at), name: read.last.byName })
        : t('Last reading: {km}, {when}.', { km: kmText(read.last.km), when: fmtWhen(read.last.at) })}</T> : null}
      {ev ? (
        <Field label={t('Battery (%)')} value={form.battery} onChangeText={(x) => setForm((f) => ({ ...f, battery: x }))} keyboardType="number-pad" />
      ) : (
        <View style={{ gap: 6 }}>
          <T v="medium">{t('Fuel gauge')}</T>
          <Row gap={6}>{EIGHTHS.map(([p, label]) => <Chip key={label} text={t(label)} on={num(form.fuel) === p} onPress={() => setForm((f) => ({ ...f, fuel: show(p) }))} />)}</Row>
          <Field label={t('or in percent')} value={form.fuel} onChangeText={(x) => setForm((f) => ({ ...f, fuel: x }))} keyboardType="decimal-pad" />
        </View>
      )}
      <Field label={t('Range shown (km)')} hint={t('optional')} value={form.range} onChangeText={(x) => setForm((f) => ({ ...f, range: x }))} keyboardType="number-pad" />
      <View style={{ gap: 6 }}>
        <T v="medium">{t('Warning lights')}</T>
        {warnings.length ? (
          <>
            <Row gap={6}>{warnings.map((w) => <Chip key={w} text={`${t(w)}  ✕`} on onPress={() => setWarnings((x) => x.filter((y) => y !== w))} />)}</Row>
            <T v="small">{t('Tap one that isn\'t lit to remove it. Your fleet manager sees the rest.')}</T>
          </>
        ) : <T v="small">{t('None found. If one is lit, tell your fleet manager.')}</T>}
      </View>
      {ending ? (
        <View style={{ gap: 6 }}>
          <T v="medium">{ev ? t('Did you charge the van during the tour?') : t('Did you refuel during the tour?')}</T>
          <Row gap={6}>
            <Chip text={t('No')} on={refuel === 'no'} onPress={() => setRefuel('no')} />
            <Chip text={ev ? t('Yes') : t('Yes, litres from the receipt')} on={refuel === 'litres'} onPress={() => setRefuel('litres')} />
            {!ev ? <Chip text={t('Yes, don\'t know how much')} on={refuel === 'unknown'} onPress={() => setRefuel('unknown')} /> : null}
          </Row>
          {refuel === 'litres' && !ev ? <Field label={t('Litres')} value={litres} onChangeText={setLitres} keyboardType="decimal-pad" /> : null}
          {refuel === 'litres' && fromReceipts ? <T v="small">{tp(fromReceipts, 'From your refuel during this tour (the receipt).', 'From your {n} refuels during this tour (the receipts).')}</T> : null}
        </View>
      ) : null}
      {read.will === 'end' && !read.endsMine && read.tourDriver ? <T v="small">{t('This ends {name}\'s tour.', { name: read.tourDriver })}</T> : null}
      {read.will === 'end-start' && read.tourDriver ? <T v="small">{t('{name} didn\'t take an end photo: this ends their tour and starts yours.', { name: read.tourDriver })}</T> : null}
      {jump ? (
        <View style={{ gap: 6 }}>
          <T v="small" color={c.alert}>{jump}</T>
          <Button small title={t('It\'s right, save it')} loading={!!step} onPress={() => save(true)} />
        </View>
      ) : null}
      {err ? <T v="small" color={c.alert}>{err}</T> : null}
      <Row>
        <Button v="primary" title={step || (read.will === 'none' ? t('Save the reading') : read.will === 'start' || read.will === 'end-start' ? t('Save and start the tour') : t('Save and end the tour'))} loading={!!step} disabled={!!step} onPress={() => save()} />
        <Button small v="link" title={t('Take it again')} onPress={() => { setRead(null); setPhoto(null); }} />
      </Row>
    </View>
  );
}

function savedText(role: 'start' | 'end' | 'none', tour: Tour | null, km: number) {
  if (role === 'start') return t('Tour started at {km}. Take the end photo when you\'re back.', { km: kmText(km) });
  if (role === 'end' && tour) {
    const hours = tour.hours != null ? `${tour.hours.toLocaleString(loc())} h` : null;
    const per100 = tour.per100 != null ? per100Text(tour.per100, tour.unit) : null;
    if (hours && per100) return t('Tour ended: {km} in {hours}, {per100}.', { km: kmText(tour.km), hours, per100 });
    if (hours) return t('Tour ended: {km} in {hours}.', { km: kmText(tour.km), hours });
    if (per100) return t('Tour ended: {km}, {per100}.', { km: kmText(tour.km), per100 });
    return t('Tour ended: {km}.', { km: kmText(tour.km) });
  }
  return t('Odometer saved: {km}.', { km: kmText(km) });
}

/** A compact line about a tour, for lists. */
/** A needle gauge in eighths ("3/4"), as it's read off the dashboard. */
export function gaugeText(pct: number) {
  const e = EIGHTHS.reduce((a, b) => (Math.abs(b[0] - pct) < Math.abs(a[0] - pct) ? b : a));
  return e[0] === 0 || e[0] === 100 ? t(e[1]) : e[1];
}

/**
 * What the van's dashboard showed last: its latest photo at the start or end of a tour, or at a refuel, wash or
 * parts purchase. The km, the fuel or battery, the range and the warning lights, for everyone at the station.
 * Without a photo yet, the owner and the station's managers see the km from the van's record, if there is one.
 */
export function VanNow({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  const d = v.dash;
  const det = s.runs(v.stationId) ? s.details.find((x) => x.id === v.id) : undefined;
  const stat = (value: string, label: string) => (
    <View key={label} style={{ minWidth: 76 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 30, lineHeight: 33, color: c.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <T v="small">{label}</T>
    </View>
  );
  if (!d) {
    return (
      <View style={{ gap: 4 }}>
        {det?.odometerKm != null ? stat(kmText(det.odometerKm), det.odometerAt ? t('Odometer on {day}, from the van\'s record', { day: fmtDay(det.odometerAt) }) : t('Odometer, from the van\'s record')) : null}
        <T v="small">{t('No dashboard photo yet. The km, the fuel level and any warning lights show here after the first one: at the start or end of a tour, or at a refuel.')}</T>
      </View>
    );
  }
  const ev = v.fuel === 'electric';
  const level = ev ? d.batteryPct : d.fuelPct;
  const where = { tour: N_('From the dashboard photo {when}, {name}.'), fuel: N_('From the dashboard photo at a refuel {when}, {name}.'),
    wash: N_('From the dashboard photo at a wash {when}, {name}.'), parts: N_('From the dashboard photo for parts {when}, {name}.') }[d.from] || N_('From the dashboard photo {when}, {name}.');
  return (
    <View style={{ gap: 8 }}>
      <Row gap={20} style={{ alignItems: 'flex-start' }}>
        {stat(kmText(d.km), t('Odometer'))}
        {level != null ? stat(ev || d.batteryPct != null ? `${Math.round(level)} %` : gaugeText(level), d.from === 'fuel' ? t('Fuel after the refuel') : ev ? t('Battery') : t('Fuel')) : null}
        {d.rangeKm != null ? stat(kmText(d.rangeKm), t('Range')) : null}
      </Row>
      {d.warnings.length ? (
        <View style={{ borderWidth: 2, borderColor: c.alert, borderRadius: 4, padding: 10, gap: 2, backgroundColor: c.paper }}>
          <T v="medium" color={c.alert}>{tp(d.warnings.length, 'Warning light: {lights}', 'Warning lights: {lights}', { lights: d.warnings.map((w) => t(w)).join(', ') })}</T>
          <T v="small">{t('Check the van before it goes out again.')}</T>
        </View>
      ) : <T v="small">{t('No warning lights.')}</T>}
      <T v="small">{t(where, { when: fmtWhen(d.at), name: d.byName })}</T>
    </View>
  );
}

export function TourLine({ t: tour, show: who }: { t: Tour; show: 'driver' | 'van' }) {
  const c = useColors();
  const open = isOpen(tour);
  const when = tour.end ? t('{start} to {end}', { start: fmtWhen(tour.startAt), end: new Date(tour.end.at).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) }) : fmtWhen(tour.startAt);
  return (
    <View style={{ gap: 2 }}>
      <Row>
        <T v="medium" style={{ flex: 1 }} numberOfLines={1}>{who === 'driver' ? tour.driverName : tour.vehicleName}</T>
        <Text style={{ fontFamily: F.condBold, fontSize: 17, color: c.ink, fontVariant: ['tabular-nums'] }}>{open ? t('On tour') : kmText(tour.km)}</Text>
      </Row>
      <T v="small">{[when,
        tour.per100 != null ? per100Text(tour.per100, tour.unit) : '', tour.endedHow === 'next' ? t('no end photo (estimated)') : tour.endedHow === 'none' ? t('no end photo') : '',
        tour.warnings?.length ? t('warning: {lights}', { lights: tour.warnings.map((w) => t(w)).join(', ') }) : ''].filter(Boolean).join(', ')}</T>
    </View>
  );
}
