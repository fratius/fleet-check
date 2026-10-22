import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Chip, F, Field, Row, T, useColors } from '@/components/ui';
import { DueLine, FactSection, type FieldSpec, type Vals } from '@/components/vanfacts';
import { CHECK_MONTHS, EMPLOYMENT, LICENCE_CLASSES, addMonths, driverDeadlines, fmtDay, lastCheck, parseDay, today } from '@/lib/fleet';
import { DocScan } from '@/components/docscan';
import { useSession } from '@/lib/session';
import { whoHad } from '@/lib/stats';
import { AiError, ai } from '@/lib/store';
import type { DriverRecord, Incident, IncidentKind, Member } from '@/lib/types';

/**
 * A driver's record: licence and licence checks, employment, briefings, emergency contact, notes and incidents.
 * Owners and the driver's station managers keep it; the driver sees their own. What's deliberately not kept is in
 * FLEET_DATA.md (no licence numbers or copies, no date of birth, no home address, no health data).
 */

export const LICENCE: FieldSpec[] = [
  { key: 'licenceClasses', label: 'Classes', kind: 'multi', options: Object.fromEntries(LICENCE_CLASSES.map((k) => [k, k])) },
  { key: 'licenceValid', label: 'Valid until', kind: 'day', hint: 'The date on the card, or the class that runs out first' },
];
export const WORK: FieldSpec[] = [
  { key: 'employment', label: 'Contract', kind: 'choice', options: EMPLOYMENT },
  { key: 'employedFrom', label: 'Started', kind: 'day' },
  { key: 'employedTo', label: 'Last working day', kind: 'day', hint: 'When they leave' },
];
export const TRAINING: FieldSpec[] = [
  { key: 'vanBriefing', label: 'Briefed on the vans', kind: 'day', hint: 'Driving, loading, what to do after an accident' },
  { key: 'safetyBriefing', label: 'Last safety briefing', kind: 'day', hint: 'Yearly: the next is due a year later' },
];
export const EMERGENCY: FieldSpec[] = [
  { key: 'emergencyName', label: 'Who to call', kind: 'text' },
  { key: 'emergencyPhone', label: 'Phone', kind: 'phone' },
];
const NOTES: FieldSpec[] = [{ key: 'notes', label: 'Notes', kind: 'long' }];

export const INCIDENT: Record<IncidentKind, string> = { accident: 'Accident', fine: 'Traffic fine', complaint: 'Customer complaint', other: 'Other' };
const FINE: Record<string, string> = { speeding: 'Speeding', parking: 'Parking', 'red light': 'Red light', phone: 'Phone at the wheel', other: 'Other' };
const FAULT: Record<string, string> = { yes: 'Driver at fault', no: 'Not at fault', unclear: 'Not clear yet' };

/** Saves part of the record (creates it the first time, at the driver's station). */
export async function saveRecord(s: ReturnType<typeof useSession>, m: Member, prev: DriverRecord | undefined, patch: Vals) {
  const { id: _id, checks: _c, ...rest } = (prev || {}) as DriverRecord;
  const next = { ...rest, ...patch, stationId: prev?.stationId ?? m.stationIds?.[0] ?? null, createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now(), updatedByName: s.user?.name || null };
  if (prev) await s.store!.records.update(m.uid, next);
  else await s.store!.records.add(next as Omit<DriverRecord, 'id'>, m.uid);
}

export function DriverRecordView({ m, incidents }: { m: Member; incidents: Incident[] | null }) {
  const s = useSession();
  const c = useColors();
  const me = m.uid === s.user?.uid;
  const rec = me && !s.staff ? s.myRecord || undefined : s.records.find((r) => r.id === m.uid);
  const canEdit = !me && (m.stationIds || []).some((id) => s.runs(id));
  const months = s.org?.licenceCheckMonths || CHECK_MONTHS;
  const due = driverDeadlines(rec || (canEdit ? ({ id: m.uid, stationId: null, createdAt: 0 } as DriverRecord) : null), months);
  const save = (patch: Vals) => saveRecord(s, m, rec, patch);
  const values = (rec || {}) as unknown as Vals;
  return (
    <View style={{ gap: 12 }}>
      {canEdit ? <DocScan target="driver" m={m} /> : null}
      {due.length ? (
        <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: due.some((x) => x.state === 'overdue') ? c.alert : c.ink, borderRadius: 4, padding: 12, gap: 8 }}>
          <T v="h3">Coming up</T>
          {due.map((x) => <DueLine key={x.key} x={x} />)}
        </View>
      ) : null}
      <LicenceChecks m={m} rec={rec} canCheck={canEdit} months={months} />
      <FactSection title="Driving licence" fields={LICENCE} values={values} canEdit={canEdit} onSave={save} empty="Licence classes and the date the licence runs out. No licence number or copy: that isn't needed." />
      <FactSection title="Employment" fields={WORK} values={values} canEdit={canEdit} onSave={save} empty="Contract, start date and, when they leave, the last working day." />
      <FactSection title="Briefings" note="The yearly safety briefing shows as a deadline." fields={TRAINING} values={values} canEdit={canEdit} onSave={save} empty="When they were briefed on the vans, and the last yearly safety briefing." />
      <FactSection title="Emergency contact" fields={EMERGENCY} values={values} canEdit={canEdit} onSave={save} empty="Who to call after an accident." />
      {!me ? <FactSection title="Notes" fields={NOTES} values={values} canEdit={canEdit} onSave={save} empty="Anything else to remember about working with them." /> : null}
      <Incidents m={m} incidents={incidents} canAdd={canEdit} />
      {rec?.updatedAt && !me ? <T v="small">Last changed {new Date(rec.updatedAt).toLocaleDateString()}{rec.updatedByName ? ` by ${rec.updatedByName}` : ''}.</T> : null}
    </View>
  );
}

/** The licence checks: who looked at the licence and when (kept for good), and the next one due. */
function LicenceChecks({ m, rec, canCheck, months }: { m: Member; rec: DriverRecord | undefined; canCheck: boolean; months: number }) {
  const s = useSession();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today().split('-').reverse().join('.'));
  const [ok, setOk] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checks = (rec?.checks || []).slice().sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at);
  const last = lastCheck(rec);
  const save = async () => {
    const d = parseDay(day);
    if (!d) { setErr('Enter the day like 22.10.2026.'); return; }
    if (!ok && !note.trim()) { setErr('Say what the problem is.'); return; }
    setBusy(true); setErr(null);
    try { await ai.recordLicenceCheck({ orgId: s.org!.id, uid: m.uid, ok, note: note.trim(), day: d }); setOpen(false); setNote(''); setOk(true); }
    catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t save the check. Check the connection.'); } finally { setBusy(false); }
  };
  if (!canCheck && !checks.length) return null;
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderColor: c.rule }}>
        <View style={{ flex: 1 }}>
          <T v="h3">Licence checks</T>
          <T v="small">Every {months} months someone looks at the original licence. The dates are the company&apos;s proof.</T>
        </View>
      </View>
      <View style={{ padding: 12, gap: 8 }}>
        {last ? <T v="medium">Next check {fmtDay(addMonths(last.day, months))}</T> : <T v="medium" color={c.alert}>No check recorded yet</T>}
        {checks.slice(0, 6).map((k, i) => (
          <View key={`${k.day}-${k.at}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 8 : 0 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: k.ok ? c.ok : c.alert }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.medium, fontSize: 16, color: c.ink }}>{fmtDay(k.day)}, {k.ok ? 'fine' : 'problem'}</Text>
              <T v="small">Checked by {k.byName}{k.note ? `: ${k.note}` : ''}</T>
            </View>
          </View>
        ))}
        {checks.length > 6 ? <T v="small">and {checks.length - 6} earlier</T> : null}
        {canCheck ? (open ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
            <Field label="Day of the check" value={day} onChangeText={setDay} placeholder="DD.MM.YYYY" />
            <Row><Chip text="Licence is fine" on={ok} onPress={() => setOk(true)} /><Chip text="Problem" on={!ok} onPress={() => setOk(false)} /></Row>
            <Field label={ok ? 'Note' : 'What is the problem?'} hint={ok ? 'optional' : undefined} value={note} onChangeText={setNote} maxLength={300} />
            <T v="small">Only the result is kept, not the licence number or a copy.</T>
            {err ? <T v="small" color={c.alert}>{err}</T> : null}
            <Row><Button small v="primary" title="Save the check" loading={busy} onPress={save} /><Button small v="link" title="Cancel" onPress={() => setOpen(false)} /></Row>
          </View>
        ) : <Button small v={last ? 'secondary' : 'primary'} title="Record a licence check" onPress={() => setOpen(true)} />) : null}
      </View>
    </View>
  );
}

/** Accidents, traffic fines and customer complaints, newest first. Owners and managers add and correct them. */
function Incidents({ m, incidents, canAdd }: { m: Member; incidents: Incident[] | null; canAdd: boolean }) {
  const c = useColors();
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const list = (incidents || []).slice().sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt);
  if (!canAdd && !list.length) return null;
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4 }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderColor: c.rule }}>
        <T v="h3">Incidents</T>
        <T v="small">Accidents, traffic fines and customer complaints. Kept, not deleted; corrections show who made them.</T>
      </View>
      <View style={{ padding: 12, gap: 10 }}>
        {incidents == null ? <T v="hint">Loading…</T> : !list.length ? <T v="hint">Nothing recorded.</T> : null}
        {list.map((i, n) => (edit === i.id ? <IncidentForm key={i.id} m={m} prev={i} onDone={() => setEdit(null)} /> : (
          <Pressable key={i.id} disabled={!canAdd} onPress={() => setEdit(i.id)} accessibilityRole={canAdd ? 'button' : undefined}
            style={{ gap: 2, borderTopWidth: n ? 1 : 0, borderColor: c.rule, paddingTop: n ? 10 : 0 }}>
            <Row>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: i.kind === 'accident' ? c.alert : i.kind === 'fine' ? c.amber : c.ink2 }} />
              <T v="medium" style={{ flex: 1 }}>{INCIDENT[i.kind]}{i.kind === 'fine' && i.fineType ? `: ${FINE[i.fineType] || i.fineType}` : ''}{i.kind === 'accident' && i.atFault ? `, ${FAULT[i.atFault].toLowerCase()}` : ''}</T>
              {canAdd ? <T v="small" style={{ textDecorationLine: 'underline' }}>Edit</T> : null}
            </Row>
            <T v="small">{[fmtDay(i.day), i.time, i.vehicleName].filter(Boolean).join(', ')}</T>
            {i.note ? <T v="body">{i.note}</T> : null}
            <T v="small">Added by {i.byName}{i.updatedByName ? `, changed by ${i.updatedByName}` : ''}</T>
          </Pressable>
        )))}
        {canAdd ? (adding ? <IncidentForm m={m} onDone={() => setAdding(false)} /> : <Button small title="Add an incident" onPress={() => setAdding(true)} />) : null}
      </View>
    </View>
  );
}

function IncidentForm({ m, prev, onDone }: { m: Member; prev?: Incident; onDone: () => void }) {
  const s = useSession();
  const c = useColors();
  const [kind, setKind] = useState<IncidentKind>(prev?.kind || 'fine');
  const [day, setDay] = useState(prev?.day ? prev.day.split('-').reverse().join('.') : today().split('-').reverse().join('.'));
  const [time, setTime] = useState(prev?.time || '');
  const [vehicleId, setVehicleId] = useState<string | null>(prev?.vehicleId ?? null);
  const [fineType, setFineType] = useState<string | null>(prev?.fineType ?? null);
  const [atFault, setAtFault] = useState<string | null>(prev?.atFault ?? null);
  const [note, setNote] = useState(prev?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stationId = prev?.stationId || m.stationIds?.[0] || '';
  const vans = s.vehicles.filter((v) => v.stationId === stationId).sort((a, b) => a.name.localeCompare(b.name));
  // Who had which van at that moment, from the history: suggests the van for a fine sent days later.
  const d = parseDay(day);
  const at = d ? new Date(`${d}T${/^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : '12:00'}`).getTime() : null;
  const hadThen = at ? s.assignments.filter((a) => a.driverId === m.uid && a.start <= at && (a.end ?? Infinity) >= at)[0] : null;
  const otherDriver = at && vehicleId ? whoHad(s.assignments, vehicleId, at).at : null;
  const save = async () => {
    if (!d) { setErr('Enter the day like 22.10.2026.'); return; }
    if (time && !/^\d{1,2}:\d{2}$/.test(time.trim())) { setErr('Enter the time like 14:30, or leave it empty.'); return; }
    setBusy(true); setErr(null);
    const van = vans.find((v) => v.id === vehicleId) || s.vehicles.find((v) => v.id === vehicleId);
    const fields = {
      day: d, time: time.trim() ? time.trim().padStart(5, '0') : null, kind, fineType: kind === 'fine' ? (fineType as Incident['fineType']) : null,
      atFault: kind === 'accident' ? (atFault as Incident['atFault']) : null, note: note.trim().slice(0, 2000),
      vehicleId: van?.id || null, vehicleName: van?.name || null,
    };
    try {
      if (prev) await s.store!.incidents.update(prev.id, { ...fields, updatedAt: Date.now(), updatedByName: s.user?.name || null });
      else await s.store!.incidents.add({ ...fields, driverId: m.uid, driverName: m.name, stationId, by: s.user!.uid, byName: s.user?.name || '', createdAt: Date.now() });
      onDone();
    } catch { setErr('Couldn\'t save. Check the connection.'); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
      <T v="medium">{prev ? 'Correct the incident' : 'New incident'}</T>
      <Row gap={6}>{(Object.keys(INCIDENT) as IncidentKind[]).map((k) => <Chip key={k} text={INCIDENT[k]} on={kind === k} onPress={() => setKind(k)} />)}</Row>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 140 }}><Field label="Day" value={day} onChangeText={setDay} placeholder="DD.MM.YYYY" /></View>
        <View style={{ width: 110 }}><Field label="Time" hint="optional" value={time} onChangeText={setTime} placeholder="14:30" /></View>
      </Row>
      {kind === 'fine' ? <><T v="medium">For</T><Row gap={6}>{Object.entries(FINE).map(([k, t]) => <Chip key={k} text={t} on={fineType === k} onPress={() => setFineType(k)} />)}</Row></> : null}
      {kind === 'accident' ? <><T v="medium">Fault</T><Row gap={6}>{Object.entries(FAULT).map(([k, t]) => <Chip key={k} text={t} on={atFault === k} onPress={() => setAtFault(k)} />)}</Row></> : null}
      <T v="medium">Van</T>
      <Row gap={6}>
        <Chip text="None" on={!vehicleId} onPress={() => setVehicleId(null)} />
        {vans.map((v) => <Chip key={v.id} text={v.name} on={vehicleId === v.id} onPress={() => setVehicleId(v.id)} />)}
      </Row>
      {hadThen && hadThen.vehicleId !== vehicleId ? (
        <Pressable onPress={() => setVehicleId(hadThen.vehicleId)}><T v="small" style={{ textDecorationLine: 'underline' }}>{m.name} had {hadThen.vehicleName} then. Use that van</T></Pressable>
      ) : null}
      {otherDriver && otherDriver.driverId !== m.uid ? <T v="small" color={c.alert}>The history says {otherDriver.driverName} had this van then, not {m.name}.</T> : null}
      <Field label="What happened" value={note} onChangeText={setNote} multiline maxLength={2000} />
      {err ? <T v="small" color={c.alert}>{err}</T> : null}
      <Row><Button small v="primary" title={prev ? 'Save the correction' : 'Add the incident'} loading={busy} onPress={save} /><Button small v="link" title="Cancel" onPress={onDone} /></Row>
    </View>
  );
}
