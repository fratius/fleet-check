import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { UploadRow } from '@/components/uploads';
import { Button, Card, Chip, F, Field, Notice, Pill, Row, T, useColors } from '@/components/ui';
import { DueLine, HuSticker, fromInput, saveDetails, toInput, type FieldSpec } from '@/components/vanfacts';
import { eur, fmtDay, km, today } from '@/lib/fleet';
import { N_, loc, t, tp } from '@/lib/i18n';
import { newId } from '@/lib/images';
import { QUEUED, sendCall, useOutbox } from '@/lib/outbox';
import { ADD_KINDS, HU_RESULT, SERVICE_HINT, SERVICE_NAME, huDue, serviceDue, serviceName, watchServices } from '@/lib/service';
import { useSession } from '@/lib/session';
import { failText } from '@/lib/store';
import type { HuResult, ServiceKind, ServiceRecord, Vehicle } from '@/lib/types';
import { vanName } from '@/lib/vans';

/**
 * The van's Service tab (owners and the van's station managers): the TÜV with its date, the next service, an "Add
 * service" button (four common ones and Other) and the whole service history with km and costs, kept for good.
 * Records are written by the server (functions/src/service.ts) through the outbox, so they wait on the phone
 * without a connection. A correction keeps what was there before; nothing is deleted.
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
  const [done, setDone] = useState<string | null>(null);
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
  const saved = (r: unknown, what: string) => {
    setAdding(null); setFixing(null);
    setDone(r === QUEUED ? t('Saved on this phone. It goes through by itself, you don\'t need to do it again.') : what);
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
        {done ? <Notice text={done} /> : null}
        {!firebase ? <Card dashed><T v="hint">{t('The service history needs the Firebase backend.')}</T></Card>
          : v.retired ? null
            : adding === 'pick' ? <KindPicker onPick={(k) => setAdding(k)} onCancel={() => setAdding(null)} />
              : adding && adding !== 'hu' ? <ServiceForm v={v} kind={adding} onDone={(r, w) => saved(r, w)} onCancel={() => setAdding(null)} />
                : !fixing ? <Button v="primary" title={t('Add service')} onPress={() => { setDone(null); setAdding('pick'); }} /> : null}
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
              {list.map((r, i) => <ServiceRow key={r.id} r={r} first={i === 0} onFix={!fixing && !adding && !v.retired ? () => { setDone(null); setFixing(r); } : undefined} />)}
            </Card>
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
          <Field label={t('Month on the sticker')} hint={t('like 03/2028')} value={val} onChangeText={setVal} placeholder={t('MM/YYYY')} keyboardType="numbers-and-punctuation" autoFocus />
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
          <T v="small">{t(SERVICE_HINT[k])}</T>
        </Pressable>
      ))}
      <Button small v="link" title={t('Cancel')} onPress={onCancel} />
    </Card>
  );
}

/** Records a service (or the TÜV), or corrects one (`rec`): the km are needed, the rest helps. */
function ServiceForm({ v, kind, rec, onDone, onCancel }: { v: Vehicle; kind: ServiceKind; rec?: ServiceRecord; onDone: (r: unknown, what: string) => void; onCancel: () => void }) {
  const s = useSession();
  const c = useColors();
  const d = s.details.find((x) => x.id === v.id);
  const fix = !!rec;
  const id = useRef(rec?.id || newId());
  const [name, setName] = useState(rec?.name || '');
  const [day, setDay] = useState(String(toInput(F_DAY, rec?.day || today())));
  const [kmText, setKm] = useState(rec ? String(toInput(F_KM, rec.km)) : '');
  const [cost, setCost] = useState(rec ? String(toInput(F_COST, rec.cost)) : '');
  const [garage, setGarage] = useState(rec?.garage || '');
  const [note, setNote] = useState(rec?.note || '');
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
    if (kmV == null) { setErr(t('Enter the van\'s km.')); return; }
    if (kind === 'hu' && !result) { setErr(t('Choose how the TÜV went.')); return; }
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
        result: kind === 'hu' ? result : null, next: fix ? null : next,
      };
      const what = kind === 'other' ? name.trim() : t(SERVICE_NAME[kind]);
      const r = await sendCall<{ applied?: string[]; unchanged?: boolean }>('service', data, {
        title: fix ? t('Correct {what} on {van}', { what, van: vanName(v) }) : t('{what} on {van}', { what, van: vanName(v) }), vehicleId: v.id, vehicleName: vanName(v),
      });
      const applied = r !== QUEUED ? r?.applied || [] : [];
      onDone(r, fix ? (r !== QUEUED && r?.unchanged ? t('Nothing changed.') : t('Corrected. What it was before is kept with it.'))
        : applied.includes('hu') && next.hu ? t('Saved. The next TÜV is {month}.', { month: fmtDay(String(next.hu), true) })
          : applied.length ? t('Saved, with the next due dates.') : t('Saved in the service history.'));
    } catch (e) { setErr(failText(e, 'Saving a service')); } finally { setBusy(false); }
  };

  return (
    <Card>
      <T v="h2">{fix ? t('Correct: {what}', { what: serviceName(rec!) }) : t(SERVICE_NAME[kind])}</T>
      {fix ? <T v="small">{t('What it was before is kept with the record, with your name.')}</T> : null}
      {kind === 'other' ? <Field label={t('What was done')} value={name} onChangeText={setName} maxLength={60} placeholder={t('For example: windscreen, battery, air conditioning')} /> : null}
      <Field label={t(F_DAY.label)} value={day} onChangeText={setDay} placeholder={t('DD.MM.YYYY')} keyboardType="numbers-and-punctuation" />
      <Field label={`${t(F_KM.label)} (km)`} hint={known ? t('last known {km}', { km: km(known) }) : t('needed')} value={kmText} onChangeText={setKm} keyboardType="decimal-pad" placeholder={known ? String(known) : undefined} />
      {kind === 'hu' ? (
        <View style={{ gap: 6 }}>
          <T v="medium">{t('Result')}</T>
          <Row>{(Object.keys(HU_RESULT) as HuResult[]).map((k) => <Chip key={k} text={t(HU_RESULT[k])} on={result === k} onPress={() => setResult(k)} />)}</Row>
          {!fix && result && result !== 'failed' ? <Field label={t('Month on the sticker')} hint={t('like 03/2028')} value={hu} onChangeText={setHu} placeholder={t('MM/YYYY')} keyboardType="numbers-and-punctuation" /> : null}
          {result === 'failed' ? <T v="small" color={c.alert}>{t('The TÜV date stays as it is. Record it again when the van passes.')}</T> : null}
        </View>
      ) : null}
      <Field label={`${t(F_COST.label)} (€)`} hint={t('optional, add it later if the invoice hasn\'t come yet')} value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
      <Field label={kind === 'hu' ? t('Inspection centre') : t('Garage')} hint={t('optional')} value={garage} onChangeText={setGarage} maxLength={80} />
      <Field label={t('Notes')} hint={t('optional')} value={note} onChangeText={setNote} maxLength={1000} multiline
        placeholder={kind === 'tyres' ? t('For example: winter tyres on, 4 new Michelin') : kind === 'hu' ? t('For example: defects to fix') : t('What was done, parts changed')} />
      {!fix && kind === 'service' ? (
        <>
          <Field label={t(F_NEXT.label)} hint={t('optional')} value={nextDay} onChangeText={setNextDay} placeholder={t('DD.MM.YYYY')} keyboardType="numbers-and-punctuation" />
          <Field label={`${t(F_NEXT_KM.label)} (km)`} hint={t('optional')} value={nextKm} onChangeText={setNextKm} keyboardType="decimal-pad" />
        </>
      ) : null}
      {!fix && kind === 'tyres' ? <Field label={t(F_TYRES.label)} hint={t('optional')} value={tyres} onChangeText={setTyres} placeholder={t('DD.MM.YYYY')} keyboardType="numbers-and-punctuation" /> : null}
      {!fix && (kind === 'service' || kind === 'tyres') ? <T v="small">{t('The next dates show on the van, in the fleet list and in Review.')}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row><Button v="primary" title={fix ? t('Save the correction') : t('Save')} loading={busy} onPress={save} /><Button v="link" title={t('Cancel')} onPress={onCancel} /></Row>
    </Card>
  );
}

/** One entry of the history. */
function ServiceRow({ r, first, onFix }: { r: ServiceRecord; first: boolean; onFix?: () => void }) {
  const c = useColors();
  const last = r.edits?.length ? r.edits[r.edits.length - 1] : null;
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
      <Row gap={6}>
        <T v="small" style={{ flex: 1 }}>{last
          ? t('{name}. Corrected {date} by {who}.', { name: r.byName, date: new Date(last.at).toLocaleDateString(loc()), who: last.byName })
          : r.byName}</T>
        {onFix ? <Button small v="link" title={t('Make a correction')} onPress={onFix} /> : null}
      </Row>
    </View>
  );
}

