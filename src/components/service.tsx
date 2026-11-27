import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { UploadRow, useWaitingFor, Waiting } from '@/components/uploads';
import { Button, Card, Chip, F, Field, Notice, Pill, Row, T, useColors } from '@/components/ui';
import { DateField, MonthField, TimeField } from '@/components/pickers';
import { DueLine, HuSticker, fromInput, saveDetails, toInput, type FieldSpec } from '@/components/vanfacts';
import { eur, fmtDay, km, today } from '@/lib/fleet';
import { N_, t, tp } from '@/lib/i18n';
import { newId } from '@/lib/images';
import { QUEUED, sendCall, useOutbox } from '@/lib/outbox';
import { ADD_KINDS, BOOK_KINDS, HU_RESULT, REMIND, REMIND_DEFAULT, SERVICE_HINT, SERVICE_NAME, apptState, apptWhen, huDue, openAppointments, readTime, remindLabel, serviceDue, serviceName, visitOf, watchServices } from '@/lib/service';
import { useSession } from '@/lib/session';
import { failText } from '@/lib/store';
import type { HuResult, ServiceAppointment, ServiceKind, ServiceRecord, Vehicle } from '@/lib/types';
import { vanName } from '@/lib/vans';

/**
 * The van's Service tab (owners and the van's station managers): the TÜV with its date, the next service, an "Add
 * service" button (four common ones and Other) and the whole service history with km and costs, kept for good.
 * Records are written by the server (functions/src/service.ts) through the outbox, so they wait on the phone
 * without a connection. A correction keeps what was there before; nothing is deleted.
 *
 * Appointments at the garage (product owner, 2026-11-23): "Book an appointment" with the day, time, garage and when
 * to be reminded (a day before unless changed). Booked ones show on top, can be moved or cancelled (kept, with what
 * they were before), and "Fill in the service" opens the service form filled in from it, which marks it done.
 */

// The form's fields, read and checked like the van's record (vanfacts.tsx). Labels in English, shown with t().
const F_DAY: FieldSpec = { key: 'day', label: N_('Day it was done'), kind: 'day' };
const F_KM: FieldSpec = { key: 'km', label: N_('Odometer'), kind: 'num', unit: 'km' };
const F_COST: FieldSpec = { key: 'cost', label: N_('Cost without VAT'), kind: 'eur', digits: 2 };
const F_HU: FieldSpec = { key: 'hu', label: N_('Next TÜV'), kind: 'month' };
const F_NEXT: FieldSpec = { key: 'service', label: N_('Next service by date'), kind: 'day' };
const F_NEXT_KM: FieldSpec = { key: 'serviceKm', label: N_('Next service at'), kind: 'num', unit: 'km' };
const F_TYRES: FieldSpec = { key: 'tyres', label: N_('Next tyre change'), kind: 'day' };

const eur2 = (n: number | null | undefined) => (n == null ? '' : eur(n, 2));

export function VanService({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  const d = s.details.find((x) => x.id === v.id);
  const [rows, setRows] = useState<ServiceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ServiceKind | 'pick' | null>(null);
  const [fixing, setFixing] = useState<ServiceRecord | null>(null);
  const [done, setDone] = useState<{ text: string; queued: boolean } | null>(null);
  // Booking a new appointment ('new') or changing one; filling in the service from one.
  const [booking, setBooking] = useState<ServiceAppointment | 'new' | null>(null);
  const [filling, setFilling] = useState<ServiceAppointment | null>(null);
  const [earlier, setEarlier] = useState(false);
  const ob = useOutbox();
  const orgId = s.org?.id;
  const firebase = s.mode === 'firebase';
  const scope = s.role === 'owner' ? '*' : s.myStations.map((st) => st.id).join(',');
  useEffect(() => {
    if (!orgId || !firebase) return;
    setRows(null); setError(null);
    return watchServices(orgId, v.id, scope === '*' ? null : scope ? scope.split(',') : [], setRows,
      () => setError(t('Couldn\'t load the service history. Open the tab again.')));
  }, [orgId, firebase, v.id, scope]);

  const list = rows || [];
  const thisYear = String(new Date().getFullYear());
  const yearCost = list.filter((r) => r.day.startsWith(thisYear)).reduce((a, r) => a + (r.cost || 0), 0);
  const allCost = list.reduce((a, r) => a + (r.cost || 0), 0);
  const next = serviceDue(v, d);
  // Added or corrected on this phone and still on its way (no connection): shown, and not offered again.
  const waiting = ob.jobs.filter((j) => j.uid === s.user?.uid && j.type === 'change' && j.change?.kind === 'call' && j.change.fn === 'service' && j.change.data.vehicleId === v.id);
  const waitingAppts = ob.jobs.filter((j) => j.uid === s.user?.uid && j.type === 'change' && j.change?.kind === 'call' && j.change.fn === 'appointment' && j.change.data.vehicleId === v.id);
  const booked = openAppointments(s.appointments, v.id);
  const past = s.appointments.filter((a) => a.vehicleId === v.id && a.status !== 'booked').sort((a, b) => b.at - a.at);
  const busyForm = !!(adding || fixing || booking || filling);
  const saved = (r: unknown, what: string) => {
    setAdding(null); setFixing(null); setBooking(null); setFilling(null);
    setDone(r === QUEUED ? { text: t('Saved on this phone. It goes through by itself, you don\'t need to do it again.'), queued: true } : { text: what, queued: false });
  };

  return (
    <View style={{ gap: 12 }}>
      <HuCard v={v} onDone={() => { setDone(null); setFixing(null); setAdding('hu'); }} canRecord={firebase && !v.retired && !waiting.length} />
      {adding === 'hu' ? <ServiceForm v={v} kind="hu" onDone={(r, w) => saved(r, w)} onCancel={() => setAdding(null)} /> : null}

      <View style={{ gap: 8 }}>
        <T v="h2">{t('Service')}</T>
        {d?.lastService ? (
          <T v="hint">{t('Last service: {what}, {date}, {km}', { what: serviceName(d.lastService), date: fmtDay(d.lastService.day), km: km(d.lastService.km) })}</T>
        ) : null}
        {next.length ? (
          <View style={{ borderWidth: 2, borderColor: next.some((x) => x.state === 'overdue') ? c.alert : c.ink, borderRadius: 4, backgroundColor: c.paper, padding: 12, gap: 8 }}>
            {next.map((x) => <DueLine key={x.key} x={x} />)}
          </View>
        ) : null}
        {/* "Saved on this phone" only while it still waits (not once it's sent or stopped: cause 3b). */}
        {done && (!done.queued || [...waiting, ...waitingAppts].some((j) => j.status !== 'failed')) ? <Notice text={done.text} /> : null}
        {firebase && (booked.length || waitingAppts.length) ? (
          <View style={{ gap: 8 }}>
            <T v="h3">{t('Appointments')}</T>
            {waitingAppts.map((j) => <Card key={j.id} style={{ paddingVertical: 10 }}><UploadRow j={j} bare /></Card>)}
            {booked.map((a) => (filling?.id === a.id
              ? <ServiceForm key={a.id} v={v} kind={a.kind} appt={a} onDone={(r, w) => saved(r, w)} onCancel={() => setFilling(null)} />
              : booking !== 'new' && booking?.id === a.id
                ? <AppointmentForm key={a.id} v={v} appt={a} onDone={(r, w) => saved(r, w)} onCancel={() => setBooking(null)} />
                : <AppointmentCard key={a.id} a={a} v={v} canAct={!busyForm && !v.retired}
                  onFill={() => { setDone(null); setFilling(a); }} onMove={() => { setDone(null); setBooking(a); }} onCancelled={(r) => saved(r, t('Cancelled. It stays in the van\'s appointments.'))} />))}
          </View>
        ) : null}
        {!firebase ? <Card dashed><T v="hint">{t('The service history needs the Firebase backend.')}</T></Card>
          : v.retired ? null
            : adding === 'pick' ? <KindPicker onPick={(k) => setAdding(k)} onCancel={() => setAdding(null)} />
              : adding && adding !== 'hu' ? <ServiceForm v={v} kind={adding} onDone={(r, w) => saved(r, w)} onCancel={() => setAdding(null)} />
                : booking === 'new' ? <AppointmentForm v={v} onDone={(r, w) => saved(r, w)} onCancel={() => setBooking(null)} />
                  : !busyForm ? (
                    <Row>
                      <Button v="primary" title={t('Add service')} onPress={() => { setDone(null); setAdding('pick'); }} />
                      <Button v="secondary" title={t('Book an appointment')} onPress={() => { setDone(null); setBooking('new'); }} />
                    </Row>
                  ) : null}
      </View>

      {fixing ? <ServiceForm v={v} kind={fixing.kind} rec={fixing} onDone={(r, w) => saved(r, w)} onCancel={() => setFixing(null)} /> : null}

      {firebase ? (
        <View style={{ gap: 8 }}>
          <T v="h3">{t('Service history')}</T>
          <T v="hint">{list.length
            ? tp(list.length, '{n} entry, {total} in total ({year} this year). Kept for good.', '{n} entries, {total} in total ({year} this year). Kept for good.', { total: eur2(allCost), year: eur2(yearCost) })
            : t('Every service, tyre change, repair and TÜV of this van, with km and costs. Kept for good.')}</T>
          {error ? <T v="hint" color={c.alert}>{error}</T> : null}
          {waiting.map((j) => <Card key={j.id} style={{ paddingVertical: 10 }}><UploadRow j={j} bare /></Card>)}
          {rows == null && !error ? <T v="hint">{t('Loading…')}</T> : null}
          {rows && !list.length && !waiting.length ? <Card dashed><T v="hint">{t('Nothing recorded yet. Add the last service from its invoice to start.')}</T></Card> : null}
          {list.length ? (
            <Card style={{ paddingVertical: 4, gap: 0 }}>
              {list.map((r, i) => <ServiceRow key={r.id} r={r} first={i === 0} onFix={!busyForm && !v.retired ? () => { setDone(null); setFixing(r); } : undefined} />)}
            </Card>
          ) : null}
          {past.length ? (
            earlier ? (
              <View style={{ gap: 8 }}>
                <T v="h3">{t('Earlier appointments')}</T>
                <Card style={{ paddingVertical: 4, gap: 0 }}>{past.map((a, i) => <PastAppointment key={a.id} a={a} first={i === 0} />)}</Card>
              </View>
            ) : <Button small v="link" title={tp(past.length, 'Show {n} earlier appointment', 'Show {n} earlier appointments')} onPress={() => setEarlier(true)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The TÜV: the sticker, its date and how far away it is; record a TÜV that was done, or change the date. */
function HuCard({ v, onDone, canRecord }: { v: Vehicle; onDone: () => void; canRecord: boolean }) {
  const s = useSession();
  const c = useColors();
  const d = s.details.find((x) => x.id === v.id);
  const x = huDue(v, d);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const color = x?.state === 'overdue' ? c.alert : x?.state === 'soon' ? c.amber : c.ink;
  const save = async () => {
    const r = fromInput(F_HU, val);
    if ('error' in r) { setErr(r.error); return; }
    setBusy(true); setErr(null);
    try { await saveDetails(s, v, d, { 'due.hu': r.value }); setEditing(false); } catch (e) { setErr(failText(e, 'Saving the TÜV date')); } finally { setBusy(false); }
  };
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: x && x.state !== 'ok' ? color : c.ink, borderRadius: 4, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        {x?.day ? <HuSticker day={x.day} size={72} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3">{t('TÜV (main inspection)')}</T>
          {x?.day ? (
            <>
              <Text style={{ fontFamily: F.semi, fontSize: 17, color }}>{t('Runs out at the end of {month}', { month: fmtDay(x.day, true) })}</Text>
              <T v="small" color={x.state === 'ok' ? undefined : color}>{x.note}</T>
            </>
          ) : <T v="hint">{t('No TÜV date yet. Add the month on the sticker.')}</T>}
        </View>
      </View>
      {editing ? (
        <View style={{ gap: 8 }}>
          <MonthField label={t('Month on the sticker')} hint={t('like 03/2028')} value={val} onChangeText={setVal} autoFocus
            returnKeyType="done" onSubmitEditing={save} />
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
          <Row><Button small v="primary" title={t('Save')} loading={busy} onPress={save} /><Button small v="link" title={t('Cancel')} onPress={() => { setEditing(false); setErr(null); }} /></Row>
        </View>
      ) : (
        <Row>
          {canRecord ? <Button small v={x && x.state !== 'ok' ? 'primary' : 'secondary'} title={t('TÜV done')} onPress={onDone} /> : null}
          {!v.retired ? <Button small v="link" title={x?.day ? t('Change date') : t('Add date')} onPress={() => { setVal(String(toInput(F_HU, d?.due?.hu) || '')); setEditing(true); }} /> : null}
        </Row>
      )}
      <T v="small">{t('A month before it runs out, the station\'s fleet managers get a notification (with notifications turned on in Account) and it shows in Review.')}</T>
    </View>
  );
}

/** The four common services and Other. */
function KindPicker({ onPick, onCancel }: { onPick: (k: ServiceKind) => void; onCancel: () => void }) {
  const c = useColors();
  return (
    <Card>
      <T v="h3">{t('What was done?')}</T>
      {ADD_KINDS.map((k) => (
        <Pressable key={k} accessibilityRole="button" onPress={() => onPick(k)}
          style={({ pressed }) => ({ borderWidth: 2, borderColor: c.ink, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 10, gap: 1, backgroundColor: c.paper, opacity: pressed ? 0.75 : 1 })}>
          <T v="h3">{t(SERVICE_NAME[k])}</T>
          <T v="small">{t(SERVICE_HINT[k] || '')}</T>
        </Pressable>
      ))}
      <Button small v="link" title={t('Cancel')} onPress={onCancel} />
    </Card>
  );
}

/** Records a service (or the TÜV), or corrects one (`rec`): the km are needed, the rest helps. */
function ServiceForm({ v, kind, rec, appt, onDone, onCancel }: { v: Vehicle; kind: ServiceKind; rec?: ServiceRecord; appt?: ServiceAppointment; onDone: (r: unknown, what: string) => void; onCancel: () => void }) {
  const s = useSession();
  const c = useColors();
  const d = s.details.find((x) => x.id === v.id);
  const fix = !!rec;
  const id = useRef(rec?.id || newId());
  // From an appointment: what it was for, the garage and the notes; its day once it has come (today before that).
  const [name, setName] = useState(rec?.name || appt?.name || '');
  const [day, setDay] = useState(String(toInput(F_DAY, rec?.day || (appt && appt.day <= today() ? appt.day : today()))));
  const [kmText, setKm] = useState(rec ? String(toInput(F_KM, rec.km)) : '');
  const [cost, setCost] = useState(rec ? String(toInput(F_COST, rec.cost)) : '');
  const [garage, setGarage] = useState(rec?.garage || appt?.garage || '');
  const [note, setNote] = useState(rec?.note || appt?.note || '');
  const [result, setResult] = useState<HuResult | null>(rec?.result || null);
  const [hu, setHu] = useState('');
  const [nextDay, setNextDay] = useState('');
  const [nextKm, setNextKm] = useState('');
  const [tyres, setTyres] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The odometer the app knows (the record, or the latest dashboard photo), to help with the km.
  const known = Math.max(d?.odometerKm || 0, v.dash?.km || 0) || null;

  const save = async () => {
    setErr(null);
    const read = (f: FieldSpec, raw: string) => fromInput(f, raw);
    const rDay = read(F_DAY, day), rKm = read(F_KM, kmText), rCost = read(F_COST, cost);
    for (const r of [rDay, rKm, rCost]) if ('error' in r) { setErr(r.error); return; }
    const dayV = (rDay as { value: unknown }).value as string | null, kmV = (rKm as { value: unknown }).value as number | null;
    if (kind === 'other' && name.trim().length < 2) { setErr(t('Say what was done.')); return; }
    if (!dayV) { setErr(t('Enter the day it was done, like 31.03.2027.')); return; }
    // Typed as well as picked: no future day (blind QA, PR #47). The server allows a day ahead for time zones.
    if (dayV > today()) { setErr(t('The day can\'t be in the future.')); return; }
    if (kmV == null) { setErr(t('Enter the van\'s km.')); return; }
    if (kind === 'hu' && !result) { setErr(t('Choose how the TÜV went.')); return; }
    // Far fewer km than the van already had on or before that day is a typo (the server refuses it too).
    if (!fix && d?.odometerKm != null && d.odometerAt && dayV >= d.odometerAt && kmV < d.odometerKm - 1000) {
      setErr(t('The van already had {km} km on {date}. Check the km, or correct the odometer under Details.', { km: d.odometerKm, date: d.odometerAt.split('-').reverse().join('.') }));
      return;
    }
    const next: Record<string, unknown> = {};
    if (!fix) {
      const add = (f: FieldSpec, raw: string): boolean => {
        const r = read(f, raw);
        if ('error' in r) { setErr(r.error); return false; }
        if (r.value != null) next[f.key] = r.value;
        return true;
      };
      if (kind === 'hu' && result !== 'failed') {
        if (!add(F_HU, hu)) return;
        if (!next.hu) { setErr(t('Enter the month on the new sticker, like 03/2028.')); return; }
      }
      if (kind === 'service' && (!add(F_NEXT, nextDay) || !add(F_NEXT_KM, nextKm))) return;
      if (kind === 'tyres' && !add(F_TYRES, tyres)) return;
    }
    setBusy(true);
    try {
      const data = {
        orgId: s.org!.id, action: fix ? 'fix' : 'add', id: id.current, vehicleId: v.id, kind, name: kind === 'other' ? name.trim() : null,
        day: dayV, km: kmV, cost: (rCost as { value: unknown }).value ?? null, garage: garage.trim() || null, note: note.trim() || null,
        result: kind === 'hu' ? result : null, next: fix ? null : next, ...(appt ? { appointmentId: appt.id } : {}),
      };
      const what = kind === 'other' ? name.trim() : t(SERVICE_NAME[kind]);
      const r = await sendCall<{ applied?: string[]; unchanged?: boolean; appointmentDone?: boolean }>('service', data, {
        title: fix ? t('Correct {what} on {van}', { what, van: vanName(v) }) : t('{what} on {van}', { what, van: vanName(v) }), vehicleId: v.id, vehicleName: vanName(v),
      });
      const applied = r !== QUEUED ? r?.applied || [] : [];
      onDone(r, fix ? (r !== QUEUED && r?.unchanged ? t('Nothing changed.') : t('Corrected. What it was before is kept with it.'))
        : applied.includes('hu') && next.hu ? t('Saved. The next TÜV is {month}.', { month: fmtDay(String(next.hu), true) })
          : applied.length ? t('Saved, with the next due dates.')
            : r !== QUEUED && r?.appointmentDone ? t('Saved in the service history. The appointment is done.') : t('Saved in the service history.'));
    } catch (e) { setErr(failText(e, 'Saving a service')); } finally { setBusy(false); }
  };

  return (
    <Card>
      <T v="h2">{fix ? t('Correct: {what}', { what: serviceName(rec!) }) : appt ? serviceName(appt) : t(SERVICE_NAME[kind])}</T>
      {fix ? <T v="small">{t('What it was before is kept with the record, with your name.')}</T> : null}
      {appt ? <T v="small">{t('From the appointment on {when}. Saving it marks the appointment done.', { when: apptWhen(appt) })}</T> : null}
      {kind === 'other' ? <Field label={t('What was done')} value={name} onChangeText={setName} maxLength={60} placeholder={t('For example: windscreen, battery, air conditioning')} /> : null}
      <DateField label={t(F_DAY.label)} value={day} onChangeText={setDay} max={today()} />
      <Field label={`${t(F_KM.label)} (km)`} hint={known ? t('last known {km}', { km: km(known) }) : t('needed')} value={kmText} onChangeText={setKm} keyboardType="decimal-pad" />
      {kind === 'hu' ? (
        <View style={{ gap: 6 }}>
          <T v="medium">{t('Result')}</T>
          <Row>{(Object.keys(HU_RESULT) as HuResult[]).map((k) => <Chip key={k} text={t(HU_RESULT[k])} on={result === k} onPress={() => setResult(k)} />)}</Row>
          {!fix && result && result !== 'failed' ? <MonthField label={t('Month on the sticker')} hint={t('like 03/2028')} value={hu} onChangeText={setHu} /> : null}
          {result === 'failed' ? <T v="small" color={c.alert}>{t('The TÜV date stays as it is. Record it again when the van passes.')}</T> : null}
        </View>
      ) : null}
      <Field label={`${t(F_COST.label)} (€)`} hint={t('optional, add it later if the invoice hasn\'t come yet')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
      <Field label={kind === 'hu' ? t('Inspection centre') : t('Garage')} hint={t('optional')} value={garage} onChangeText={setGarage} maxLength={80} />
      <Field label={t('Notes')} hint={t('optional')} value={note} onChangeText={setNote} maxLength={1000} multiline
        placeholder={kind === 'tyres' ? t('For example: winter tyres on, 4 new Michelin') : kind === 'hu' ? t('For example: defects to fix') : t('What was done, parts changed')} />
      {!fix && kind === 'service' ? (
        <>
          <DateField label={t(F_NEXT.label)} hint={t('optional')} value={nextDay} onChangeText={setNextDay} />
          <Field label={`${t(F_NEXT_KM.label)} (km)`} hint={t('optional')} value={nextKm} onChangeText={setNextKm} keyboardType="decimal-pad" />
        </>
      ) : null}
      {!fix && kind === 'tyres' ? <DateField label={t(F_TYRES.label)} hint={t('optional')} value={tyres} onChangeText={setTyres} /> : null}
      {!fix && (kind === 'service' || kind === 'tyres') ? <T v="small">{t('The next dates show on the van, in the fleet list and in Review.')}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row><Button v="primary" title={fix ? t('Save the correction') : t('Save')} loading={busy} onPress={save} /><Button v="link" title={t('Cancel')} onPress={onCancel} /></Row>
    </Card>
  );
}

/** The calendar day of a moment, on this phone ("YYYY-MM-DD"). */
const dayOf = (ms: number) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
/** What an entry said before a correction: each changed field with its old value. */
function wasText(was: NonNullable<ServiceRecord['edits']>[number]['was']) {
  const parts: string[] = [];
  if ('day' in was) parts.push(`${t(F_DAY.label)} ${was.day ? fmtDay(was.day) : '–'}`);
  if ('km' in was) parts.push(was.km != null ? km(was.km) : `km –`);
  if ('cost' in was) parts.push(`${t(F_COST.label)} ${was.cost != null ? eur2(was.cost) : '–'}`);
  if ('name' in was) parts.push(`${t('What was done')} ${was.name || '–'}`);
  if ('result' in was) parts.push(`${t('Result')} ${was.result ? t(HU_RESULT[was.result]) : '–'}`);
  if ('garage' in was) parts.push(`${t('Garage')} ${was.garage || '–'}`);
  if ('note' in was) parts.push(`${t('Notes')} ${was.note || '–'}`);
  return parts.join('; ');
}

/** One entry of the history. */
function ServiceRow({ r, first, onFix }: { r: ServiceRecord; first: boolean; onFix?: () => void }) {
  const c = useColors();
  const last = r.edits?.length ? r.edits[r.edits.length - 1] : null;
  // A correction of it waiting on this phone (listed above): not offered again (cause 3b).
  const fixing = useWaitingFor('service', (d) => d.id === r.id);
  return (
    <View style={{ paddingVertical: 10, gap: 3, borderTopWidth: first ? 0 : 1, borderColor: c.rule }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <T v="h3" style={{ flex: 1 }}>{serviceName(r)}</T>
        {r.cost != null ? <Text style={{ fontFamily: F.condBold, fontSize: 18, color: c.ink, fontVariant: ['tabular-nums'] }}>{eur2(r.cost)}</Text> : <T v="small">{t('no cost yet')}</T>}
      </View>
      <T v="small">{[fmtDay(r.day), km(r.km), r.garage || ''].filter(Boolean).join(', ')}</T>
      {r.kind === 'hu' && r.result ? (
        <Row gap={6}>
          <Pill v={r.result === 'passed' ? 'good' : r.result === 'defects' ? 'amber' : 'bad'} text={t(HU_RESULT[r.result])} />
          {r.next?.hu ? <T v="small">{t('Next TÜV: {month}', { month: fmtDay(r.next.hu, true) })}</T> : null}
        </Row>
      ) : null}
      {r.kind === 'service' && r.next && (r.next.service || r.next.serviceKm) ? (
        <T v="small">{r.next.service && r.next.serviceKm ? t('Next service: {date} or at {km}', { date: fmtDay(r.next.service), km: km(r.next.serviceKm) })
          : r.next.service ? t('Next service: {date}', { date: fmtDay(r.next.service) }) : t('Next service at {km}', { km: km(r.next.serviceKm!) })}</T>
      ) : null}
      {r.kind === 'tyres' && r.next?.tyres ? <T v="small">{t('Next tyre change: {date}', { date: fmtDay(r.next.tyres) })}</T> : null}
      {r.note ? <T v="body">{r.note}</T> : null}
      {last ? <T v="small">{t('Before the correction: {what}', { what: wasText(last.was) })}</T> : null}
      <Row gap={6}>
        <T v="small" style={{ flex: 1 }}>{last
          ? t('{name}. Corrected {date} by {who}.', { name: r.byName, date: fmtDay(dayOf(last.at)), who: last.byName })
          : r.byName}</T>
        {onFix && !fixing ? <Button small v="link" title={t('Make a correction')} onPress={onFix} /> : null}
      </Row>
    </View>
  );
}


/* ---------- Appointments ---------- */

/** Books an appointment, or changes one (`appt`): what for, the day and time (German time), garage, notes, reminder. */
function AppointmentForm({ v, appt, onDone, onCancel }: { v: Vehicle; appt?: ServiceAppointment; onDone: (r: unknown, what: string) => void; onCancel: () => void }) {
  const s = useSession();
  const c = useColors();
  const move = !!appt;
  const id = useRef(appt?.id || newId());
  const [kind, setKind] = useState<ServiceKind | null>(appt?.kind || null);
  const [name, setName] = useState(appt?.name || '');
  const [day, setDay] = useState(appt ? String(toInput(F_DAY, appt.day)) : '');
  const [time, setTime] = useState(appt?.time || '');
  const [garage, setGarage] = useState(appt?.garage || '');
  const [note, setNote] = useState(appt?.note || '');
  const [remind, setRemind] = useState(appt?.remind ?? REMIND_DEFAULT);
  // Drivers see on the van that it's booked (what for, when, the garage; never the notes). On unless switched off.
  const [drivers, setDrivers] = useState(appt?.drivers !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!kind) { setErr(t('Choose what the appointment is for.')); return; }
    if (kind === 'other' && name.trim().length < 2) { setErr(t('Say what the appointment is for.')); return; }
    const rDay = fromInput(F_DAY, day);
    if ('error' in rDay) { setErr(rDay.error); return; }
    const dayV = rDay.value as string | null;
    if (!dayV) { setErr(t('Enter the day of the appointment, like 31.03.2027.')); return; }
    const timeV = readTime(time);
    if (!timeV) { setErr(t('Enter the time of the appointment, like 09:30.')); return; }
    if (dayV < today()) { setErr(t('That time has already passed. Choose a time ahead.')); return; }
    setBusy(true);
    try {
      const data = {
        orgId: s.org!.id, action: move ? 'move' : 'book', id: id.current, vehicleId: v.id, kind, name: kind === 'other' ? name.trim() : null,
        day: dayV, time: timeV, garage: garage.trim() || null, note: note.trim() || null, remind, drivers,
      };
      const what = kind === 'other' ? name.trim() : t(SERVICE_NAME[kind]);
      const r = await sendCall<{ remindAt?: number | null; unchanged?: boolean }>('appointment', data, {
        title: move ? t('Change the appointment: {what} on {van}', { what, van: vanName(v) }) : t('Appointment: {what} on {van}', { what, van: vanName(v) }),
        vehicleId: v.id, vehicleName: vanName(v),
      });
      const when = `${fmtDay(dayV)}, ${timeV}`;
      onDone(r, r !== QUEUED && r?.unchanged ? t('Nothing changed.')
        : r !== QUEUED && remind > 0 && r?.remindAt == null ? t('Booked for {when}. No reminder: that time has already passed.', { when })
          : move ? t('Changed to {when}. What it was before is kept with it.', { when }) : t('Booked for {when}.', { when }));
    } catch (e) { setErr(failText(e, 'Saving an appointment')); } finally { setBusy(false); }
  };

  return (
    <Card>
      <T v="h2">{move ? t('Change the appointment') : t('Book an appointment')}</T>
      {move ? <T v="small">{t('What it was before is kept with it, with your name.')}</T> : null}
      <View style={{ gap: 6 }}>
        <T v="medium">{t('What for')}</T>
        <Row>{BOOK_KINDS.map((k) => <Chip key={k} text={t(SERVICE_NAME[k])} on={kind === k} onPress={() => setKind(k)} />)}</Row>
      </View>
      {kind === 'other' ? <Field label={t('What for')} value={name} onChangeText={setName} maxLength={60} placeholder={t('For example: windscreen, battery, air conditioning')} /> : null}
      <Row>
        <View style={{ flex: 1, minWidth: 150 }}><DateField label={t('Day')} value={day} onChangeText={setDay} min={today()} /></View>
        <View style={{ flex: 1, minWidth: 110 }}><TimeField label={t('Time')} value={time} onChangeText={setTime} /></View>
      </Row>
      <Field label={kind === 'hu' ? t('Inspection centre') : t('Garage')} hint={t('optional')} value={garage} onChangeText={setGarage} maxLength={80} />
      <Field label={t('Notes')} hint={t('optional')} value={note} onChangeText={setNote} maxLength={1000} multiline placeholder={t('For example: booking number, who to ask for, bring the spare key')} />
      <View style={{ gap: 6 }}>
        <T v="medium">{t('Remind me')}</T>
        <Row>{REMIND.map(([m, label]) => <Chip key={m} text={t(label)} on={remind === m} onPress={() => setRemind(m)} />)}</Row>
        <T v="small">{t('The reminder goes to you and the station\'s fleet managers, with notifications turned on in Account.')}</T>
      </View>
      <View style={{ gap: 6 }}>
        <T v="medium">{t('Drivers')}</T>
        <Row>
          <Chip text={t('Drivers see it on the van')} on={drivers} onPress={() => setDrivers(true)} />
          <Chip text={t('Only managers and owners')} on={!drivers} onPress={() => setDrivers(false)} />
        </Row>
        <T v="small">{drivers ? t('The station\'s drivers see on the van and in the fleet list that it\'s booked: what for, when and the garage. Not the notes.') : t('Drivers don\'t see this appointment.')}</T>
      </View>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row><Button v="primary" title={move ? t('Save the change') : t('Book')} loading={busy} onPress={save} /><Button v="link" title={t('Cancel')} onPress={onCancel} /></Row>
    </Card>
  );
}

/** A booked appointment: when, where, the reminder, and what can be done with it. */
function AppointmentCard({ a, v, canAct, onFill, onMove, onCancelled }: {
  a: ServiceAppointment; v: Vehicle; canAct: boolean; onFill: () => void; onMove: () => void; onCancelled: (r: unknown) => void;
}) {
  const s = useSession();
  const c = useColors();
  const st = apptState(a);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = a.changes?.length ? a.changes[a.changes.length - 1] : null;
  // Moved, cancelled or filled in on this phone and still waiting (listed above): not offered again (cause 3b).
  const moving = useWaitingFor('appointment', (d) => d.id === a.id);
  const filled = useWaitingFor('service', (d) => d.appointmentId === a.id);
  const waiting = moving || filled;
  const cancel = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await sendCall('appointment', { orgId: s.org!.id, action: 'cancel', id: a.id, vehicleId: v.id, reason: reason.trim() || null },
        { title: t('Cancel the appointment: {what} on {van}', { what: serviceName(a), van: vanName(v) }), vehicleId: v.id, vehicleName: vanName(v) });
      onCancelled(r);
    } catch (e) { setErr(failText(e, 'Cancelling an appointment')); } finally { setBusy(false); }
  };
  return (
    <View style={{ borderWidth: 2, borderColor: st.v === 'bad' ? c.alert : st.v === 'amber' ? c.amber : c.ink, borderRadius: 4, backgroundColor: c.paper, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <T v="h3" style={{ flex: 1 }}>{serviceName(a)}</T>
        <Pill v={st.v} text={st.text} />
      </View>
      <Text style={{ fontFamily: F.semi, fontSize: 17, color: c.ink }}>{[apptWhen(a), a.garage || ''].filter(Boolean).join(', ')}</Text>
      {a.note ? <T v="body">{a.note}</T> : null}
      <T v="small">{a.drivers === false ? t('Drivers don\'t see this appointment.') : t('Drivers see it on the van.')}</T>
      <T v="small">{a.remind === 0 ? t('No reminder.') : a.remindAt ? t('Reminder {when}.', { when: remindLabel(a.remind) }) : a.remindedAt ? t('Reminder sent.') : t('No reminder: that time had already passed.')}</T>
      <T v="small">{last
        ? last.was.day || last.was.time
          ? t('Booked by {name}. Changed by {who}, was {when}.', { name: a.byName, who: last.byName, when: apptWhen({ day: last.was.day || a.day, time: last.was.time || a.time }) })
          : t('Booked by {name}. Changed by {who}.', { name: a.byName, who: last.byName })
        : t('Booked by {name}.', { name: a.byName })}</T>
      {st.v === 'bad' ? <T v="small" color={c.alert}>{t('Its time has come. Fill in the service once it\'s done, or move it if the garage changed it.')}</T> : null}
      {asking ? (
        <View style={{ gap: 8 }}>
          <Field label={t('Why')} hint={t('optional')} value={reason} onChangeText={setReason} maxLength={300} placeholder={t('For example: the garage cancelled')} />
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
          <Row><Button small v="danger" title={t('Cancel the appointment')} loading={busy} onPress={cancel} /><Button small v="link" title={t('Keep it')} onPress={() => { setAsking(false); setErr(null); }} /></Row>
          <T v="small">{t('It stays in the van\'s appointments as cancelled.')}</T>
        </View>
      ) : waiting ? <Waiting j={waiting} above /> : canAct ? (
        <Row>
          <Button small v={st.soon ? 'primary' : 'secondary'} title={t('Fill in the service')} onPress={onFill} />
          <Button small v="link" title={t('Move or change')} onPress={onMove} />
          <Button small v="link" title={t('Cancel appointment')} onPress={() => setAsking(true)} />
        </Row>
      ) : null}
    </View>
  );
}

/** A done or cancelled appointment, in the van's earlier appointments. */
function PastAppointment({ a, first }: { a: ServiceAppointment; first: boolean }) {
  const c = useColors();
  return (
    <View style={{ paddingVertical: 10, gap: 3, borderTopWidth: first ? 0 : 1, borderColor: c.rule }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <T v="h3" style={{ flex: 1 }}>{serviceName(a)}</T>
        <Pill v={a.status === 'done' ? 'good' : 'muted'} text={a.status === 'done' ? t('Done') : t('Appointment cancelled')} />
      </View>
      <T v="small">{[apptWhen(a), a.garage || ''].filter(Boolean).join(', ')}</T>
      <T v="small">{a.status === 'done'
        ? t('Booked by {name}. Service filled in by {who}.', { name: a.byName, who: a.doneByName || '' })
        : a.reason ? t('Booked by {name}. Cancelled by {who}: {reason}', { name: a.byName, who: a.cancelledByName || '', reason: a.reason })
          : t('Booked by {name}. Cancelled by {who}.', { name: a.byName, who: a.cancelledByName || '' })}</T>
      {a.changes?.length ? <T v="small">{tp(a.changes.length, 'Moved or changed {n} time.', 'Moved or changed {n} times.')}</T> : null}
    </View>
  );
}

/**
 * On the van page, for everyone at the station: the van is booked at the garage (vehicles.garageVisit: what for,
 * when, the garage), so a driver can plan around it. Owners and managers book and change it on the Service tab.
 */
export function GarageVisitCard({ v }: { v: Vehicle }) {
  const c = useColors();
  const g = visitOf(v);
  if (!g) return null;
  const st = apptState(g);
  return (
    <View style={{ borderWidth: 2, borderColor: st.soon ? c.amber : c.ink, borderRadius: 4, backgroundColor: c.paper, padding: 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <T v="h3" style={{ flex: 1 }}>{t('Booked at the garage: {what}', { what: serviceName(g) })}</T>
        <Pill v={st.v === 'bad' ? 'amber' : st.v} text={st.v === 'bad' ? t('Now') : st.text} />
      </View>
      <Text style={{ fontFamily: F.semi, fontSize: 17, color: c.ink }}>{[apptWhen(g), g.garage || ''].filter(Boolean).join(', ')}</Text>
      <T v="small">{t('The van goes to the garage then. Ask your fleet manager if you have it that day.')}</T>
    </View>
  );
}
