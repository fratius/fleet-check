import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';

import { Button, Chip, F, Field, Row, T, useColors } from '@/components/ui';
import { COVERAGE, FUEL, GEARBOX, INCLUDED, OWNERSHIP, deadlines, eur, fmtDay, huColor, km, mileage, parseDay, today, type Deadline } from '@/lib/fleet';
import { DocScan } from '@/components/docscan';
import { useSession } from '@/lib/session';
import type { Vehicle, VehicleCosts, VehicleDetails } from '@/lib/types';
import { N_, loc, t, tp } from '@/lib/i18n';

/**
 * The van's record, organised like the papers that come with a van: what it is, its size, what to do when
 * something happens (everyone at the station), then its contract, insurance, mileage and deadlines (owners and
 * the station's managers). Each section is edited on its own.
 * Field labels, hints and option labels are kept in English (N_) and shown with t(); FactSection's title, note and
 * empty text come in already translated from the caller.
 */

export type Kind = 'text' | 'upper' | 'num' | 'eur' | 'day' | 'month' | 'choice' | 'multi' | 'bool' | 'phone' | 'long';
export type Vals = Record<string, unknown>;
export interface FieldSpec { key: string; label: string; kind: Kind; unit?: string; options?: Record<string, string>; hint?: string; show?: (v: Vals) => boolean; digits?: number; plain?: boolean }

const ev = (v: Vals) => v.fuel === 'electric' || v.fuel === 'hybrid';
const notOwned = (v: Vals) => !!v.ownership && v.ownership !== 'owned';
export const VEHICLE: FieldSpec[] = [
  { key: 'vin', label: N_('VIN'), kind: 'upper', hint: N_('17 characters, on the registration document') },
  { key: 'firstReg', label: N_('First registration'), kind: 'day' },
  { key: 'modelYear', label: N_('Model year'), kind: 'num', plain: true },
  { key: 'fuel', label: N_('Fuel'), kind: 'choice', options: FUEL },
  { key: 'tankL', label: N_('Fuel tank'), kind: 'num', unit: 'l', show: (v) => v.fuel === 'diesel' || v.fuel === 'petrol' || v.fuel === 'hybrid', hint: N_('For the fuel used on each tour') },
  { key: 'batteryKwh', label: N_('Battery'), kind: 'num', unit: 'kWh', show: ev, hint: N_('Usable capacity, for the energy used on each tour') },
  { key: 'rangeKm', label: N_('Range'), kind: 'num', unit: 'km', show: ev },
  { key: 'powerKw', label: N_('Power'), kind: 'num', unit: 'kW' },
  { key: 'gearbox', label: N_('Gearbox'), kind: 'choice', options: GEARBOX },
  { key: 'color', label: N_('Colour'), kind: 'text' },
  { key: 'branded', label: N_('Livery'), kind: 'bool', options: { yes: N_('Amazon livery'), no: N_('Plain') } },
  { key: 'keys', label: N_('Keys'), kind: 'num' },
];
export const SIZE: FieldSpec[] = [
  { key: 'heightM', label: N_('Height'), kind: 'num', unit: 'm', digits: 2, hint: N_('Check it before car parks and garages') },
  { key: 'lengthM', label: N_('Length'), kind: 'num', unit: 'm', digits: 2 },
  { key: 'grossKg', label: N_('Gross weight'), kind: 'num', unit: 'kg' },
  { key: 'payloadKg', label: N_('Payload'), kind: 'num', unit: 'kg' },
  { key: 'cargoM3', label: N_('Cargo space'), kind: 'num', unit: 'm³', digits: 1 },
  { key: 'tyreSize', label: N_('Tyre size'), kind: 'upper' },
];
export const HELP: FieldSpec[] = [
  { key: 'breakdownPhone', label: N_('Breakdown help'), kind: 'phone' },
  { key: 'claimsPhone', label: N_('Accident claims'), kind: 'phone' },
  { key: 'insurer', label: N_('Insurer'), kind: 'text' },
  { key: 'policyNo', label: N_('Policy number'), kind: 'upper' },
];
export const DUE: FieldSpec[] = [
  { key: 'due.hu', label: N_('Main inspection (HU)'), kind: 'month', hint: N_('The month on the sticker, like 03/2027') },
  { key: 'due.uvv', label: N_('Safety check (UVV)'), kind: 'day', hint: N_('Yearly check for company vehicles') },
  { key: 'due.service', label: N_('Service by date'), kind: 'day' },
  { key: 'due.serviceKm', label: N_('Service at'), kind: 'num', unit: 'km' },
  { key: 'due.tyres', label: N_('Tyre change'), kind: 'day' },
  { key: 'due.tax', label: N_('Vehicle tax'), kind: 'day' },
];
export const MILEAGE: FieldSpec[] = [
  { key: 'odometerKm', label: N_('Odometer'), kind: 'num', unit: 'km' },
  { key: 'odometerAt', label: N_('Read on'), kind: 'day', hint: N_('Today when you change the odometer') },
];
export const CONTRACT: FieldSpec[] = [
  { key: 'ownership', label: N_('The van is'), kind: 'choice', options: OWNERSHIP },
  { key: 'provider', label: N_('Leasing company, landlord or seller'), kind: 'text' },
  { key: 'contractNo', label: N_('Contract number'), kind: 'upper' },
  { key: 'start', label: N_('Start'), kind: 'day' },
  { key: 'end', label: N_('End'), kind: 'day', show: notOwned },
  { key: 'kmPerYear', label: N_('Kilometres allowed a year'), kind: 'num', unit: 'km', show: notOwned },
  { key: 'kmAtStart', label: N_('Odometer at the start'), kind: 'num', unit: 'km' },
  { key: 'included', label: N_('Included'), kind: 'multi', options: INCLUDED, show: notOwned },
  { key: 'contact', label: N_('Contact'), kind: 'text', hint: N_('Name, phone or email') },
  { key: 'returnNotes', label: N_('When it goes back'), kind: 'long', show: notOwned },
];
export const INSURANCE: FieldSpec[] = [
  { key: 'coverage', label: N_('Cover'), kind: 'choice', options: COVERAGE },
  { key: 'insuranceRenewal', label: N_('Renewal'), kind: 'day' },
];
/** Money: owners only (kept apart from the record managers read). `ownership` comes from the contract. */
export const COSTS: FieldSpec[] = [
  { key: 'monthly', label: N_('Per month, without VAT'), kind: 'eur', show: notOwned },
  { key: 'purchasePrice', label: N_('Purchase price'), kind: 'eur', show: (v) => !v.ownership || v.ownership === 'owned' || v.ownership === 'financed' },
  { key: 'excessPerKm', label: N_('Each kilometre over the allowance'), kind: 'eur', digits: 2, show: notOwned },
  { key: 'premium', label: N_('Insurance premium a year'), kind: 'eur' },
  { key: 'deductible', label: N_('Insurance deductible'), kind: 'eur' },
];
export const OTHER: FieldSpec[] = [
  { key: 'fuelCard', label: N_('Fuel or charging card'), kind: 'text', hint: N_('Provider and the last digits, never the full number or PIN') },
  { key: 'notes', label: N_('Notes'), kind: 'long' },
];

export const get = (o: Vals | null | undefined, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Vals)[k] : undefined), o || undefined);
export const filled = (x: unknown) => x != null && x !== '' && !(Array.isArray(x) && !x.length);

export function show(f: FieldSpec, x: unknown): string {
  if (!filled(x)) return '';
  const n = typeof x === 'number' ? x : null;
  switch (f.kind) {
    case 'num': return `${f.plain ? String(n) : n!.toLocaleString(loc(), { maximumFractionDigits: f.digits ?? 0 })}${f.unit ? ' ' + f.unit : ''}`;
    case 'eur': return eur(n, f.digits ?? 0);
    case 'day': return fmtDay(String(x));
    case 'month': return fmtDay(String(x), true);
    case 'choice': return f.options?.[String(x)] ? t(f.options[String(x)]) : String(x);
    case 'multi': return (x as string[]).map((k) => (f.options?.[k] ? t(f.options[k]) : k)).join(', ');
    case 'bool': return x ? t(f.options?.yes || 'Yes') : t(f.options?.no || 'No');
    default: return String(x);
  }
}

/** One section: its facts as a label-and-value grid, and an Edit button for those who may change it. */
export function FactSection({ title, note, fields, values, canEdit, onSave, empty }: {
  title: string; note?: string; fields: FieldSpec[]; values: Vals | null | undefined; canEdit: boolean;
  onSave: (patch: Vals) => Promise<void>; empty: string;
}) {
  const c = useColors();
  const [editing, setEditing] = useState(false);
  const shown = fields.filter((f) => (!f.show || f.show(values || {})) && filled(get(values, f.key)));
  if (!shown.length && !canEdit) return null;
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderColor: c.rule }}>
        <View style={{ flex: 1 }}>
          <T v="h3">{title}</T>
          {note ? <T v="small">{note}</T> : null}
        </View>
        {canEdit && !editing ? <Button small v="link" title={shown.length ? t('Edit') : t('Add')} onPress={() => setEditing(true)} /> : null}
      </View>
      <View style={{ padding: 12 }}>
        {editing ? <Editor fields={fields} values={values} onCancel={() => setEditing(false)} onSave={async (p) => { await onSave(p); setEditing(false); }} />
          : shown.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 16 }}>
              {shown.map((f) => {
                const val = show(f, get(values, f.key));
                const wide = f.kind === 'long' || f.kind === 'multi' || val.length > 22;
                return (
                  <View key={f.key} style={{ width: wide ? '100%' : '46%', minWidth: 130, flexGrow: 1, gap: 1 }}>
                    <T v="small">{t(f.label)}</T>
                    {f.kind === 'phone' ? (
                      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${val.replace(/[^\d+]/g, '')}`).catch(() => {})}>
                        <Text style={{ fontFamily: F.semi, fontSize: 17, color: c.ink, textDecorationLine: 'underline' }}>{val}</Text>
                      </Pressable>
                    ) : <Text selectable style={{ fontFamily: f.key === 'vin' ? F.cond : F.medium, fontSize: f.key === 'vin' ? 19 : 16, letterSpacing: f.key === 'vin' ? 1 : 0, color: c.ink }}>{val}</Text>}
                  </View>
                );
              })}
            </View>
          ) : <T v="hint">{empty}</T>}
      </View>
    </View>
  );
}

/** A stored value as it's typed in a form: 31.03.2027, 03/2027, 2,72. */
export function toInput(f: FieldSpec, x: unknown): unknown {
  return f.kind === 'day' || f.kind === 'month' ? (x ? (f.kind === 'month' ? String(x).slice(5, 7) + '/' + String(x).slice(0, 4) : String(x).split('-').reverse().join('.')) : '')
    : f.kind === 'num' || f.kind === 'eur' ? (x == null ? '' : String(x).replace('.', ','))
      : f.kind === 'multi' ? (x as string[] | undefined) || [] : x ?? (f.kind === 'choice' || f.kind === 'bool' ? null : '');
}
/** What was typed, as it's stored; or what's wrong with it. Numbers accept commas; dates 31.03.2027 or 2027-03-31, months 03/2027. */
export function fromInput(f: FieldSpec, raw: unknown): { value: unknown } | { error: string } {
  let val: unknown = raw;
  if (f.kind === 'num' || f.kind === 'eur') {
    const txt = String(raw ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    val = txt ? Number(txt) : null;
    if (val != null && !Number.isFinite(val as number)) return { error: t('{field}: enter a number.', { field: t(f.label) }) };
  } else if (f.kind === 'day' || f.kind === 'month') {
    val = String(raw ?? '').trim() ? parseDay(String(raw)) : null;
    if (String(raw ?? '').trim() && !val) return { error: t('{field}: enter a date like {example}.', { field: t(f.label), example: f.kind === 'month' ? '03/2027' : '31.03.2027' }) };
  } else if (typeof raw === 'string') {
    val = raw.trim() ? (f.kind === 'upper' ? raw.trim().toUpperCase() : raw.trim()).slice(0, f.kind === 'long' ? 1000 : 120) : null;
  }
  if (f.key === 'vin' && val && String(val).length !== 17) return { error: t('The VIN has 17 characters.') };
  return { value: val };
}

/** Edits one section. */
function Editor({ fields, values, onSave, onCancel }: { fields: FieldSpec[]; values: Vals | null | undefined; onSave: (patch: Vals) => Promise<void>; onCancel: () => void }) {
  const c = useColors();
  const init: Record<string, unknown> = {};
  for (const f of fields) init[f.key] = toInput(f, get(values, f.key));
  const [form, setForm] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: unknown) => setForm((p) => ({ ...p, [k]: x }));
  const cur: Vals = {};
  for (const f of fields) cur[f.key.split('.').pop()!] = form[f.key];
  const save = async () => {
    setErr(null);
    const out: Vals = {};
    for (const f of fields) {
      const r = fromInput(f, form[f.key]);
      if ('error' in r) { setErr(r.error); return; }
      out[f.key] = r.value;
    }
    // A new odometer reading is from today unless another day is given.
    if ('odometerKm' in out && out.odometerKm !== get(values, 'odometerKm') && form.odometerAt === init.odometerAt) out.odometerAt = today();
    setBusy(true);
    try { await onSave(out); } catch { setErr(t('Couldn\'t save. Check the connection.')); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 12 }}>
      {fields.filter((f) => !f.show || f.show(cur)).map((f) => {
        if (f.kind === 'choice' || f.kind === 'bool') {
          const opts = f.kind === 'bool' ? [['yes', f.options?.yes || N_('Yes')], ['no', f.options?.no || N_('No')]] : Object.entries(f.options || {});
          const on = (k: string) => (f.kind === 'bool' ? form[f.key] === (k === 'yes') : form[f.key] === k);
          return (
            <View key={f.key} style={{ gap: 6 }}>
              <T v="medium">{t(f.label)}</T>
              <Row>{opts.map(([k, label]) => <Chip key={k} text={t(label)} on={on(k)} onPress={() => set(f.key, on(k) ? null : f.kind === 'bool' ? k === 'yes' : k)} />)}</Row>
            </View>
          );
        }
        if (f.kind === 'multi') {
          const list = (form[f.key] as string[]) || [];
          return (
            <View key={f.key} style={{ gap: 6 }}>
              <T v="medium">{t(f.label)}</T>
              <Row>{Object.entries(f.options || {}).map(([k, label]) => <Chip key={k} text={t(label)} on={list.includes(k)} onPress={() => set(f.key, list.includes(k) ? list.filter((x) => x !== k) : [...list, k])} />)}</Row>
            </View>
          );
        }
        const numeric = f.kind === 'num' || f.kind === 'eur';
        return (
          <Field key={f.key} label={t(f.label) + (f.unit ? ` (${f.unit})` : f.kind === 'eur' ? ' (€)' : '')} hint={f.hint ? t(f.hint) : undefined} value={String(form[f.key] ?? '')}
            onChangeText={(text) => set(f.key, f.kind === 'upper' ? text.toUpperCase() : text)}
            keyboardType={numeric ? 'decimal-pad' : f.kind === 'phone' ? 'phone-pad' : 'default'}
            autoCapitalize={f.kind === 'upper' ? 'characters' : 'sentences'} multiline={f.kind === 'long'}
            placeholder={f.kind === 'day' ? t('DD.MM.YYYY') : f.kind === 'month' ? t('MM/YYYY') : undefined} maxLength={f.key === 'vin' ? 17 : f.kind === 'long' ? 1000 : 120} />
        );
      })}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row><Button small v="primary" title={t('Save')} loading={busy} onPress={save} /><Button small v="link" title={t('Cancel')} onPress={onCancel} /></Row>
    </View>
  );
}

/** Saves part of a van's business record (creates it the first time), with its station and who changed it. */
export async function saveDetails(s: ReturnType<typeof useSession>, v: Vehicle, prev: VehicleDetails | undefined, patch: Vals) {
  const due: Vals = { ...(prev?.due || {}) };
  const top: Vals = {};
  for (const [k, x] of Object.entries(patch)) { if (k.startsWith('due.')) due[k.slice(4)] = x; else top[k] = x; }
  const { id: _id, ...rest } = (prev || {}) as VehicleDetails;
  const next = { ...rest, ...top, due, stationId: v.stationId ?? null, createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now(), updatedByName: s.user?.name || null };
  if (prev) await s.store!.details.update(v.id, next);
  else await s.store!.details.add(next as Omit<VehicleDetails, 'id'>, v.id);
}

/** Saves the costs of a van (owners only; creates the record the first time). */
export async function saveCosts(s: ReturnType<typeof useSession>, v: Vehicle, prev: VehicleCosts | undefined, patch: Vals) {
  const { id: _id, ...rest } = (prev || {}) as VehicleCosts;
  const next = { ...rest, ...patch, createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now(), updatedByName: s.user?.name || null };
  if (prev) await s.store!.costs.update(v.id, next);
  else await s.store!.costs.add(next as Omit<VehicleCosts, 'id'>, v.id);
}

/** The van's record: facts for everyone at the station; contract and deadlines for owners and managers; costs for owners. */
export function VanRecord({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  const staff = s.runs(v.stationId);
  const d = s.details.find((x) => x.id === v.id);
  const facts = v as unknown as Vals;
  const saveFacts = async (patch: Vals) => { await s.store!.vehicles.update(v.id, patch as Partial<Vehicle>); };
  const saveBiz = (patch: Vals) => saveDetails(s, v, d, patch);
  const owner = s.role === 'owner';
  const cost = s.costs.find((x) => x.id === v.id);
  const m = mileage(d, owner ? cost?.excessPerKm : null);
  // What the van costs per kilometre at this pace (the monthly rate only, without fuel and repairs).
  const perKm = owner && m && cost?.monthly && m.perYear > 0 ? (cost.monthly * 12) / m.perYear : null;
  return (
    <View style={{ gap: 12 }}>
      {/* Most of this is on paper: a photo of the document fills in the right sections. */}
      {staff && !v.retired ? <DocScan target="van" v={v} /> : null}
      {staff ? <Deadlines v={v} d={d} /> : null}
      <FactSection title={t('Vehicle')} fields={VEHICLE} values={facts} canEdit={staff} onSave={saveFacts}
        empty={t('VIN, first registration, fuel and gearbox. Add them from the registration document.')} />
      <FactSection title={t('Size and load')} fields={SIZE} values={facts} canEdit={staff} onSave={saveFacts} empty={t('Height, weight, payload and cargo space.')} />
      <FactSection title={t('If something happens')} note={t('Who drivers call after a breakdown or an accident.')} fields={HELP} values={facts} canEdit={staff} onSave={saveFacts}
        empty={t('Add the breakdown number and the insurer, so drivers have them at the van.')} />
      {staff ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <View style={{ width: 6, alignSelf: 'stretch', backgroundColor: c.ink, borderRadius: 2 }} />
            <View style={{ flex: 1 }}>
              <T v="h2">{t('Business')}</T>
              <T v="small">{owner ? t('Only owners and this station\'s fleet managers see this part; the costs only owners.') : t('Only owners and this station\'s fleet managers see this part.')}</T>
            </View>
          </View>
          <FactSection title={t('Mileage')} note={s.org?.dashScans ? t('Every dashboard photo updates the odometer.') : undefined} fields={MILEAGE} values={d as unknown as Vals | undefined} canEdit onSave={saveBiz} empty={t('Add the odometer reading to follow the mileage.')} />
          {m ? (
            <View style={{ borderWidth: 2, borderColor: m.over != null && m.over > 0 ? c.alert : c.ink, borderRadius: 4, padding: 12, gap: 2, backgroundColor: c.paper }}>
              <T v="medium">{t('At this pace: {km} a year', { km: km(m.perYear) })}</T>
              {m.over != null ? (
                <T v="small" color={m.over > 0 ? c.alert : undefined}>
                  {m.over > 0
                    ? (m.cost ? t('About {km} a year over the allowance, roughly {eur} a year extra.', { km: km(m.over), eur: eur(m.cost) }) : t('About {km} a year over the allowance.', { km: km(m.over) }))
                    : t('{km} a year under the allowance.', { km: km(-m.over) })}
                </T>
              ) : null}
              {perKm ? <T v="small">{t('The monthly rate works out at {eur} per kilometre (without fuel and repairs).', { eur: eur(perKm, 2) })}</T> : null}
            </View>
          ) : null}
          <FactSection title={t('Contract')} fields={CONTRACT} values={d as unknown as Vals | undefined} canEdit onSave={saveBiz} empty={t('Owned, leased, rented or financed: who with, how long, the mileage allowance.')} />
          <FactSection title={t('Insurance')} fields={INSURANCE} values={d as unknown as Vals | undefined} canEdit onSave={saveBiz} empty={t('Cover and renewal date.')} />
          {owner ? (
            <FactSection title={t('Costs')} note={t('Only owners see what the van costs.')} fields={COSTS} values={{ ...(cost || {}), ownership: d?.ownership ?? null } as Vals}
              canEdit onSave={(patch) => saveCosts(s, v, cost, patch)} empty={t('Monthly rate or purchase price, the price per extra kilometre, the insurance premium and deductible.')} />
          ) : null}
          <FactSection title={t('Deadlines')} note={t('Due dates show on the van, in the fleet list and in Review.')} fields={DUE} values={d as unknown as Vals | undefined} canEdit onSave={saveBiz}
            empty={t('Main inspection, safety check, service, tyres and tax.')} />
          <FactSection title={t('Fuel card and notes')} fields={OTHER} values={d as unknown as Vals | undefined} canEdit onSave={saveBiz} empty={t('The van\'s fuel or charging card and anything else to remember.')} />
          {d?.updatedAt ? <T v="small">{d.updatedByName
            ? t('Last changed {date} by {name}.', { date: new Date(d.updatedAt).toLocaleDateString(loc()), name: d.updatedByName })
            : t('Last changed {date}.', { date: new Date(d.updatedAt).toLocaleDateString(loc()) })}</T> : null}
        </>
      ) : null}
    </View>
  );
}

/** What falls due for the van, soonest first, with the inspection sticker as it should be on the plate. */
export function Deadlines({ v, d, compact, onOpen }: { v: Vehicle; d: VehicleDetails | undefined; compact?: boolean; onOpen?: () => void }) {
  const c = useColors();
  const list = deadlines(v, d);
  const urgent = list.filter((x) => x.state !== 'ok');
  if (compact) {
    if (!urgent.length) return null;
    return (
      <Pressable accessibilityRole="button" onPress={onOpen} style={{ borderWidth: 2, borderColor: urgent.some((x) => x.state === 'overdue') ? c.alert : c.ink, borderRadius: 4, backgroundColor: c.paper, padding: 12, gap: 6 }}>
        {urgent.slice(0, 3).map((x) => <DueLine key={x.key} x={x} />)}
        {urgent.length > 3 ? <T v="small">{tp(urgent.length - 3, 'and {n} more', 'and {n} more')}</T> : null}
        <T v="small" style={{ textDecorationLine: 'underline' }}>{t('See all deadlines')}</T>
      </Pressable>
    );
  }
  if (!list.length) return null;
  const hu = d?.due?.hu;
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 12, flexDirection: 'row', alignItems: 'flex-start' }}>
      {hu ? <HuSticker day={hu} /> : null}
      <View style={{ flex: 1, gap: 8 }}>
        <T v="h3">{t('Coming up')}</T>
        {list.map((x) => <DueLine key={x.key} x={x} />)}
      </View>
    </View>
  );
}
export function DueLine({ x }: { x: Deadline }) {
  const c = useColors();
  const color = x.state === 'overdue' ? c.alert : x.state === 'soon' ? c.amber : c.ink2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: x.state === 'ok' ? 'transparent' : color, borderWidth: 2, borderColor: color }} />
      <View style={{ flex: 1 }}>
        <T v="medium">{x.label}</T>
        <Text style={{ fontFamily: x.state === 'ok' ? F.body : F.semi, fontSize: 14, color }}>{x.day ? `${fmtDay(x.day, x.key === 'hu')}, ${x.note}` : x.note}</Text>
      </View>
    </View>
  );
}

/**
 * The round German inspection sticker (HU-Plakette): coloured by year, the due month at the top, the year in the
 * middle, so the date reads the way it does on the van's rear plate.
 */
export function HuSticker({ day, size = 84 }: { day: string; size?: number }) {
  const [y, mo] = day.split('-').map(Number);
  const fill = huColor(y);
  const ink = fill === '#2F6FC6' || fill === '#8A5A33' ? '#FFFFFF' : '#000000';
  const r = size / 2;
  return (
    <View accessibilityLabel={t('Main inspection sticker: {date}', { date: `${mo}/${y}` })}>
      <Svg width={size} height={size}>
        <Circle cx={r} cy={r} r={r - 1} fill={fill} stroke="#000" strokeWidth={2} />
        <Circle cx={r} cy={r} r={r * 0.52} fill="none" stroke={ink} strokeWidth={1} opacity={0.5} />
        <G>
          {Array.from({ length: 12 }, (_, i) => {
            // Month `mo` sits at 12 o'clock; the others follow clockwise.
            const k = ((mo - 1 + i) % 12) + 1;
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            return (
              <SvgText key={k} x={r + Math.cos(a) * r * 0.74} y={r + Math.sin(a) * r * 0.74 + size * 0.045} fontSize={size * (i === 0 ? 0.16 : 0.12)}
                fontWeight={i === 0 ? '700' : '400'} fill={ink} textAnchor="middle">{k}</SvgText>
            );
          })}
        </G>
        <SvgText x={r} y={r + size * 0.11} fontSize={size * 0.3} fontWeight="700" fill={ink} textAnchor="middle">{String(y).slice(2)}</SvgText>
      </Svg>
    </View>
  );
}
