import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { DataTable, sortRows, type Col, type Sort } from '@/components/table';
import { Button, Card, Chip, F, Field, Notice, Row, Screen, Segmented, T, Tabs, fmtWhen, useColors } from '@/components/ui';
import { usePeriodData } from '@/lib/data';
import { CHECK_MONTHS, FUEL, daysTo, fmtDay, parseDay } from '@/lib/fleet';
import { watchMembers } from '@/lib/people';
import { useSession } from '@/lib/session';
import { driverRows, isOpen, totals, vanRows, whoHad, type DriverRow, type Inputs, type VanRow } from '@/lib/stats';
import type { Member, Purchase, Tour } from '@/lib/types';
import { BUY_NAME, buyState } from '@/components/buy';
import { saveXlsx, type Cell, type Sheet } from '@/lib/xlsx';
import { N_, loc, t } from '@/lib/i18n';

/**
 * The fleet in numbers, like a spreadsheet: drivers, tours and vans for a period, sortable by any column, with a
 * download for Excel. Owners see every station, fleet managers their own. Costs only for owners.
 */

type Period = '7' | '30' | '90' | 'year';
type View3 = 'drivers' | 'tours' | 'vans' | 'buys';
/** Labels shown with t(). */
const PERIODS: [Period, string][] = [['7', N_('7 days')], ['30', N_('30 days')], ['90', N_('90 days')], ['year', N_('This year')]];

const int = (n: number | null | undefined) => (n == null ? '' : Math.round(n).toLocaleString(loc()));
const one = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (n: number | null | undefined) => (n == null ? '' : `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`);
const eur2 = (n: number | null | undefined) => (n == null ? '' : `€${n.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : '');
const sum = <R,>(rows: R[], f: (r: R) => number | null | undefined) => rows.reduce((s, r) => s + (f(r) || 0), 0);

export default function DataScreen() {
  const s = useSession();
  const c = useColors();
  const [period, setPeriod] = useState<Period>('30');
  const [station, setStation] = useState<string | null>(null);
  const [view, setView] = useState<View3>('drivers');
  const [q, setQ] = useState('');
  const [sorts, setSorts] = useState<Record<View3, Sort | null>>({ drivers: { key: 'km', dir: -1 }, tours: { key: 'date', dir: -1 }, vans: { key: 'km', dir: -1 }, buys: { key: 'date', dir: -1 } });
  const [members, setMembers] = useState<Member[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const from = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (period === 'year') return new Date(d.getFullYear(), 0, 1).getTime();
    return d.getTime() - (Number(period) - 1) * 86_400_000;
  }, [period]);
  const data = usePeriodData(from);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId || s.mode !== 'firebase' || !s.staff) return;
    return watchMembers(orgId, setMembers);
  }, [orgId, s.mode, s.staff]);

  const owner = s.role === 'owner';
  const multi = s.myStations.length > 1;
  const inScope = (id: string | null | undefined) => (station ? id === station : s.runs(id) || (s.mode === 'local'));
  const inputs: Inputs = useMemo(() => ({
    from, to: Date.now(),
    tours: data.tours.filter((t) => inScope(t.stationId)), assignments: data.assignments.filter((a) => inScope(a.stationId)),
    logs: data.logs.filter((l) => inScope(l.stationId)), incidents: data.incidents.filter((i) => inScope(i.stationId)),
    records: s.records, members: s.mode === 'firebase' ? (members || []).filter((m) => (m.stationIds || []).some((id) => inScope(id))) : null,
    vehicles: s.vehicles.filter((v) => inScope(v.stationId)), details: s.details, costs: s.costs, videos: s.videos, walks: s.walks, stations: s.stations,
    months: s.org?.licenceCheckMonths || CHECK_MONTHS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [from, data, s.records, members, s.vehicles, s.details, s.costs, s.videos, s.walks, s.stations, station, s.mode, s.org?.licenceCheckMonths]);

  const sum1 = useMemo(() => totals(inputs), [inputs]);
  const drivers = useMemo(() => driverRows(inputs).filter((r) => r.role !== 'manager' || r.tours || r.damage || r.accidents + r.fines + r.complaints), [inputs]);
  const vans = useMemo(() => vanRows(inputs, owner).filter((v) => !v.retired || v.km || v.tours), [inputs, owner]);
  const tours = useMemo(() => inputs.tours.filter((t) => t.startAt >= from), [inputs, from]);
  const buys = useMemo(() => data.purchases.filter((p) => inScope(p.stationId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.purchases, station, s.mode]);

  if (!s.staff) return <Screen><T v="h1">{t('Data')}</T><Card dashed><T v="hint">{t('Fleet managers and owners see the fleet in numbers.')}</T></Card></Screen>;

  const match = (x: string) => !q.trim() || x.toLowerCase().includes(q.trim().toLowerCase());
  const dCols = driverCols(c, multi && !station, s.stationName);
  const tCols = tourCols(c, multi && !station, s.stationName);
  const vCols = vanCols(c, multi && !station, s.stationName, owner);
  const dRows = sortRows(drivers.filter((r) => match(r.name)), dCols, sorts.drivers);
  const tRows = sortRows(tours.filter((x) => match(`${x.driverName} ${x.vehicleName} ${x.plate}`)), tCols, sorts.tours);
  const vRows = sortRows(vans.filter((v) => match(`${v.name} ${v.plate} ${v.model}`)), vCols, sorts.vans);
  const bCols = buyCols(c, multi && !station, s.stationName);
  const bRows = sortRows(buys.filter((p) => match(`${p.byName} ${p.vehicleName} ${p.plate || ''} ${p.merchant || ''}`)), bCols, sorts.buys);
  const setSort = (k: View3) => (x: Sort) => setSorts((p) => ({ ...p, [k]: x }));

  const download = async () => {
    setSaving(true); setErr(null);
    try {
      const sheet = <R,>(name: string, cols: Col<R>[], rows: R[], xl?: Record<string, (r: R) => Cell>): Sheet => ({
        name, columns: cols.map((x) => ({ label: x.label, width: Math.max(10, Math.round(x.width / 7)) })),
        rows: rows.map((r) => cols.map((x) => (xl?.[x.key] ? xl[x.key](r) : x.get(r) as Cell))),
      });
      const label = t(PERIODS.find((p) => p[0] === period)![1]);
      await saveXlsx(t('Fratius {company} {period} to {date}', { company: s.org?.name || '', period: label, date: new Date().toISOString().slice(0, 10) }), [
        sheet(t('Drivers'), dCols, sortRows(drivers, dCols, sorts.drivers), {
          vs: (r) => (r.vsModel == null ? null : Math.round(r.vsModel * 1000) / 10),
          licence: (r) => (r.licenceValid ? { date: Date.parse(r.licenceValid + 'T12:00:00') } : null),
          check: (r) => (r.nextCheck ? { date: Date.parse(r.nextCheck + 'T12:00:00') } : r.checkState === 'overdue' ? t('never recorded') : null),
        }),
        sheet(t('Tours'), tCols, sortRows(tours, tCols, sorts.tours), {
          date: (x) => ({ date: x.startAt, time: true }), end: (x) => (x.end ? { date: x.end.at, time: true } : null),
        }),
        sheet(t('Vans'), vCols, sortRows(vans, vCols, sorts.vans), { vs: (r) => (r.vsModel == null ? null : Math.round(r.vsModel * 1000) / 10) }),
        sheet(t('Fuel, wash, parts'), bCols, sortRows(buys, bCols, sorts.buys), { date: (p) => ({ date: p.createdAt, time: true }) }),
      ]);
    } catch (e) { setErr(e instanceof Error ? e.message : t('Couldn\'t make the file.')); } finally { setSaving(false); }
  };

  return (
    <Screen wide>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="h1">{t('Data')}</T>
          <T v="hint">{owner ? t('Your drivers, tours and vans in numbers.') : t('{stations}: drivers, tours and vans in numbers.', { stations: s.myStations.map((st) => st.name).join(', ') })}</T>
        </View>
        <Button small title={saving ? t('Making the file…') : t('Download for Excel')} loading={saving} onPress={download} />
      </View>
      {err ? <Notice tone="bad" text={err} /> : null}
      {data.error ? <Notice tone="bad" text={data.error} /> : null}

      <Segmented label={t('Period')} value={period} onChange={setPeriod} options={PERIODS.map(([k, l]): [Period, string] => [k, t(l)])} />
      {multi ? (
        <Row>
          <Chip text={t('All stations')} on={!station} onPress={() => setStation(null)} />
          {s.myStations.map((st) => <Chip key={st.id} text={st.name} on={station === st.id} onPress={() => setStation(st.id)} />)}
        </Row>
      ) : null}

      {/* The period at a glance. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper }}>
        <Big value={int(sum1.tours) || '0'} label={t('tours')} />
        <Big value={int(sum1.km) || '0'} label="km" />
        <Big value={sum1.diesel != null ? one(sum1.diesel) : '–'} label={t('l/100 km, diesel')} />
        <Big value={sum1.electric != null ? one(sum1.electric) : '–'} label={t('kWh/100 km, electric')} />
        <Big value={String(sum1.damage)} label={t('new damage')} />
        <Big value={String(sum1.incidents)} label={t('incidents')} />
      </View>
      {data.loading ? <T v="hint">{t('Loading the numbers…')}</T> : null}
      {!s.org?.dashScans && !data.tours.length ? (
        <Notice text={owner ? t('Kilometres and fuel come from dashboard photos at the start and end of each tour. Turn them on in the Account tab.') : t('Kilometres and fuel come from dashboard photos on each tour. The owner turns them on.')} />
      ) : null}

      <Tabs value={view} onChange={setView} items={[['drivers', t('Drivers'), drivers.length || null], ['tours', t('Tours'), tours.length || null], ['vans', t('Vans'), vans.length || null], ['buys', t('Fuel, wash'), buys.length || null]]} />
      <Field label={view === 'drivers' ? t('Find a driver') : view === 'vans' ? t('Find a van') : t('Find a driver or van')} value={q} onChangeText={setQ} placeholder={t('Name or plate')} autoCorrect={false} />

      {view === 'drivers' ? (
        <DataTable key="drivers" rows={dRows} cols={dCols} rowKey={(r) => r.id} sort={sorts.drivers} onSort={setSort('drivers')} totalLabel={t('All {n}', { n: dRows.length })}
          onRow={s.mode === 'firebase' ? (r) => router.push({ pathname: '/person/[uid]', params: { uid: r.id, tab: 'tours' } }) : undefined} empty={t('No drivers in this period.')} />
      ) : view === 'tours' ? (
        <DataTable key="tours" rows={tRows} cols={tCols} rowKey={(t) => t.id} sort={sorts.tours} onSort={setSort('tours')} totalLabel={t('All {n}', { n: tRows.length })}
          onRow={(x) => router.push(`/vehicle/${x.vehicleId}`)} empty={s.org?.dashScans ? t('No tours in this period yet.') : t('No tours: dashboard photos are off.')} />
      ) : view === 'vans' ? (
        <DataTable key="vans" rows={vRows} cols={vCols} rowKey={(v) => v.id} sort={sorts.vans} onSort={setSort('vans')} totalLabel={t('All {n}', { n: vRows.length })}
          onRow={(v) => router.push(`/vehicle/${v.id}`)} empty={t('No vans here.')} />
      ) : (
        <DataTable key="buys" rows={bRows} cols={bCols} rowKey={(p) => p.id} sort={sorts.buys} onSort={setSort('buys')} totalLabel={t('All {n}', { n: bRows.length })}
          onRow={(p) => router.push(`/buy/${p.id}`)} empty={t('No refuels, washes or parts in this period.')} />
      )}
      <T v="small">{t('Tap a column heading to sort, again to reverse. Swipe the table sideways for more columns; tap a row to open it.')}</T>

      <HowToRead />
      <WhoHad />
    </Screen>
  );
}

function Big({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ width: '33.33%', minWidth: 104, paddingHorizontal: 12, paddingVertical: 10, gap: 1 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 28, lineHeight: 31, color: c.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <T v="small">{label}</T>
    </View>
  );
}

type C = ReturnType<typeof useColors>;
/** Red for more fuel than the others on the same van (from +8%), green for less (from -5%). */
const vsTone = (c: C, v: number | null) => (v == null ? undefined : v >= 0.08 ? c.alert : v <= -0.05 ? c.ok : undefined);

function driverCols(c: C, station: boolean, stationName: (id: string | null) => string): Col<DriverRow>[] {
  const cols: Col<DriverRow>[] = [
    { key: 'name', label: t('Driver'), width: 156, align: 'left', get: (r) => r.name, text: (r) => (r.role === 'former' ? t('{name} (left)', { name: r.name }) : r.name) },
    { key: 'tours', label: t('Tours'), width: 64, get: (r) => r.tours, total: (rs) => int(sum(rs, (r) => r.tours)) },
    { key: 'days', label: t('Days with a van'), width: 78, get: (r) => r.days },
    { key: 'km', label: 'km', width: 84, get: (r) => Math.round(r.km), text: (r) => int(r.km), total: (rs) => int(sum(rs, (r) => r.km)) },
    { key: 'kmPerTour', label: t('km per tour'), width: 78, get: (r) => (r.kmPerTour == null ? null : Math.round(r.kmPerTour)), text: (r) => int(r.kmPerTour) },
    { key: 'hours', label: t('Hours per tour'), width: 78, get: (r) => (r.hoursPerTour == null ? null : Math.round(r.hoursPerTour * 10) / 10), text: (r) => one(r.hoursPerTour) },
    { key: 'diesel', label: 'l/100 km', width: 74, get: (r) => (r.diesel == null ? null : Math.round(r.diesel * 10) / 10), text: (r) => one(r.diesel) },
    { key: 'electric', label: 'kWh/100 km', width: 84, get: (r) => (r.electric == null ? null : Math.round(r.electric * 10) / 10), text: (r) => one(r.electric) },
    { key: 'vs', label: t('vs others, same van'), width: 92, get: (r) => r.vsModel, text: (r) => pct(r.vsModel), tone: (r) => vsTone(c, r.vsModel) },
    { key: 'vans', label: t('Vans'), width: 56, get: (r) => r.vans },
    // No total here: a damage found while two drivers had the van counts for both.
    { key: 'damage', label: t('New damage'), width: 74, get: (r) => r.damage, tone: (r) => (r.damage ? c.alert : undefined) },
    { key: 'sole', label: t('Damage, only them'), width: 86, get: (r) => r.damageSole, tone: (r) => (r.damageSole ? c.alert : undefined), total: (rs) => int(sum(rs, (r) => r.damageSole)) },
    { key: 'per10k', label: t('Damage per 10,000 km'), width: 96, get: (r) => (r.damagePer10k == null ? null : Math.round(r.damagePer10k * 10) / 10), text: (r) => one(r.damagePer10k) },
    { key: 'noEnd', label: t('Tours without end photo'), width: 96, get: (r) => r.noEndPhoto, tone: (r) => (r.noEndPhoto ? c.amber : undefined) },
    { key: 'proof', label: t('Handovers without video'), width: 96, get: (r) => r.missingProof, tone: (r) => (r.missingProof ? c.amber : undefined) },
    { key: 'accidents', label: t('Accidents (at fault)'), width: 92, get: (r) => r.accidents, text: (r) => (r.accidents ? `${r.accidents} (${r.atFault})` : '0'), tone: (r) => (r.atFault ? c.alert : undefined) },
    { key: 'fines', label: t('Fines'), width: 60, get: (r) => r.fines, tone: (r) => (r.fines >= 2 ? c.alert : undefined) },
    { key: 'complaints', label: t('Complaints'), width: 84, get: (r) => r.complaints },
    { key: 'licence', label: t('Licence valid until'), width: 110, get: (r) => r.licenceValid, text: (r) => (r.licenceValid ? fmtDay(r.licenceValid) : ''),
      tone: (r) => (r.licenceValid && daysTo(r.licenceValid) < 0 ? c.alert : r.licenceValid && daysTo(r.licenceValid) <= 60 ? c.amber : undefined) },
    { key: 'check', label: t('Next licence check'), width: 110, get: (r) => r.nextCheck || (r.checkState === 'overdue' ? '0000' : null),
      text: (r) => (r.nextCheck ? fmtDay(r.nextCheck) : r.checkState === 'overdue' ? t('never') : ''), tone: (r) => (r.checkState === 'overdue' ? c.alert : r.checkState === 'soon' ? c.amber : undefined) },
  ];
  // The numbers that matter most first, so they show on a phone without swiping.
  const order = ['name', 'km', 'tours', 'diesel', 'electric', 'vs', 'damage', 'sole', 'accidents', 'fines', 'complaints', 'check', 'licence', 'noEnd', 'proof', 'days', 'kmPerTour', 'hours', 'vans', 'per10k'];
  cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (station) cols.splice(1, 0, { key: 'station', label: t('Station'), width: 110, align: 'left', get: (r) => stationName(r.stationId) });
  return cols;
}

function tourCols(c: C, station: boolean, stationName: (id: string | null) => string): Col<Tour>[] {
  const ended = (r: Tour) => (isOpen(r) ? t('On tour') : r.endedHow === 'photo' ? t('Photo') : r.endedHow === 'next' ? t('Estimated') : t('None'));
  const cols: Col<Tour>[] = [
    { key: 'driver', label: t('Driver'), width: 140, align: 'left', get: (r) => r.driverName },
    { key: 'date', label: t('Start'), width: 116, align: 'left', get: (r) => r.startAt, text: (r) => fmtWhen(r.startAt) },
    { key: 'van', label: t('Van'), width: 120, align: 'left', get: (r) => r.vehicleName },
    { key: 'end', label: t('End'), width: 64, get: (r) => r.end?.at ?? null, text: (r) => time(r.end?.at) },
    { key: 'hours', label: t('Hours'), width: 64, get: (r) => r.hours, text: (r) => one(r.hours) },
    { key: 'km', label: 'km', width: 70, get: (r) => r.km, text: (r) => int(r.km), total: (ts) => int(sum(ts, (r) => r.km)) },
    { key: 'startKm', label: t('Odometer at start'), width: 96, get: (r) => r.start.km, text: (r) => int(r.start.km) },
    { key: 'used', label: t('Used'), width: 74, get: (r) => r.used, text: (r) => (r.used == null ? '' : `${one(r.used)} ${r.unit === 'kwh' ? 'kWh' : 'l'}`) },
    { key: 'per100', label: t('per 100 km'), width: 84, get: (r) => r.per100, text: (r) => (r.per100 == null ? '' : `${one(r.per100)} ${r.unit === 'kwh' ? 'kWh' : 'l'}`) },
    { key: 'refuel', label: t('Refuelled'), width: 84, get: (r) => (r.refuel?.litres ?? (r.refuel?.unknown ? t('yes') : r.refuel ? t('no') : null)),
      text: (r) => (r.refuel?.litres ? `${one(r.refuel.litres)} l` : r.refuel?.unknown ? t('yes, amount unknown') : r.refuel ? t('no') : '') },
    { key: 'endPhoto', label: t('End photo'), width: 86, align: 'left', get: ended, tone: (r) => (r.endedHow === 'next' || r.endedHow === 'none' ? c.amber : undefined) },
    // The warning lights are named as the AI read them (not translated).
    { key: 'warnings', label: t('Warning lights'), width: 150, align: 'left', get: (r) => (r.warnings || []).map((w) => t(w)).join(', '), tone: (r) => (r.warnings?.length ? c.warn : undefined) },
  ];
  const order = ['driver', 'date', 'van', 'km', 'per100', 'used', 'refuel', 'endPhoto', 'warnings', 'hours', 'end', 'startKm'];
  cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (station) cols.push({ key: 'station', label: t('Station'), width: 110, align: 'left', get: (r) => stationName(r.stationId) });
  return cols;
}

function vanCols(c: C, station: boolean, stationName: (id: string | null) => string, owner: boolean): Col<VanRow>[] {
  const cols: Col<VanRow>[] = [
    { key: 'name', label: t('Van'), width: 140, align: 'left', get: (v) => v.name, text: (v) => (v.retired ? t('{name} (retired)', { name: v.name }) : v.name) },
    { key: 'plate', label: t('Plate'), width: 92, align: 'left', get: (v) => v.plate },
    { key: 'model', label: t('Model'), width: 140, align: 'left', get: (v) => v.model },
    { key: 'fuel', label: t('Fuel'), width: 72, align: 'left', get: (v) => (v.fuel ? t(FUEL[v.fuel]) : '') },
    { key: 'odo', label: t('Odometer'), width: 90, get: (v) => v.odometer, text: (v) => int(v.odometer) },
    { key: 'km', label: t('km in period'), width: 84, get: (v) => v.km, text: (v) => int(v.km), total: (vs) => int(sum(vs, (v) => v.km)) },
    { key: 'tours', label: t('Tours'), width: 60, get: (v) => v.tours, total: (vs) => int(sum(vs, (v) => v.tours)) },
    { key: 'drivers', label: t('Drivers'), width: 64, get: (v) => v.drivers },
    { key: 'per100', label: t('per 100 km'), width: 84, get: (v) => (v.per100 == null ? null : Math.round(v.per100 * 10) / 10), text: (v) => (v.per100 == null ? '' : `${one(v.per100)} ${v.unit === 'kwh' ? 'kWh' : 'l'}`) },
    { key: 'vs', label: t('vs same model'), width: 84, get: (v) => v.vsModel, text: (v) => pct(v.vsModel), tone: (v) => vsTone(c, v.vsModel) },
    { key: 'damage', label: t('New damage'), width: 74, get: (v) => v.damage, tone: (v) => (v.damage ? c.alert : undefined), total: (vs) => int(sum(vs, (v) => v.damage)) },
    { key: 'warnings', label: t('Warning lights'), width: 140, align: 'left', get: (v) => v.warnings.map((w) => t(w)).join(', '), tone: (v) => (v.warnings.length ? c.warn : undefined) },
    { key: 'noEnd', label: t('Tours without end photo'), width: 96, get: (v) => v.noEndPhoto },
    { key: 'due', label: t('Next deadline'), width: 190, align: 'left', get: (v) => v.nextDue?.days ?? null, text: (v) => (v.nextDue ? `${t(v.nextDue.label)}, ${t(v.nextDue.note)}` : ''),
      tone: (v) => (v.nextDue?.state === 'overdue' ? c.alert : v.nextDue?.state === 'soon' ? c.amber : undefined) },
  ];
  const order = ['name', 'km', 'per100', 'vs', 'damage', 'warnings', 'due', 'tours', 'drivers', 'noEnd', 'odo', 'plate', 'model', 'fuel'];
  cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (station) cols.splice(1, 0, { key: 'station', label: t('Station'), width: 110, align: 'left', get: (v) => stationName(v.stationId) });
  if (owner) {
    cols.push({ key: 'monthly', label: t('€ a month'), width: 84, get: (v) => v.monthly, text: (v) => (v.monthly == null ? '' : `€${int(v.monthly)}`), total: (vs) => `€${int(sum(vs, (v) => v.monthly))}` });
    cols.push({ key: 'perKm', label: t('€ per km (monthly rate)'), width: 104, get: (v) => (v.costPerKm == null ? null : Math.round(v.costPerKm * 100) / 100), text: (v) => eur2(v.costPerKm) });
  }
  return cols;
}

/** Every refuel, wash and parts purchase, with the refused and unfinished ones (totals count only finished ones). */
function buyCols(c: C, station: boolean, stationName: (id: string | null) => string): Col<Purchase>[] {
  const done = (ps: Purchase[]) => ps.filter((p) => p.status === 'done');
  const card = (p: Purchase) => {
    if (p.kind === 'parts') return '';
    if (!p.card?.needed) return t('none on record');
    const r = p.card.result, d = p.decision;
    if (r === 'match') return t('the van\'s');
    if (r === 'missing') return !d ? t('no card') : d.allow ? t('no card, allowed') : t('no card, refused');
    if (r === 'unclear') return !d ? t('not read') : d.allow ? t('not read, allowed') : t('not read, refused');
    if (r === 'mismatch') return !d ? t('wrong card') : d.allow ? t('wrong card, allowed') : t('wrong card, refused');
    return '';
  };
  // Flags carry their template (newer records); older ones only the English text.
  const flagText = (f: Purchase['flags'][number]) => (f.t ? t(f.t, f.v) : t(f.text));
  const cols: Col<Purchase>[] = [
    { key: 'date', label: t('When'), width: 140, align: 'left', get: (p) => p.createdAt, text: (p) => fmtWhen(p.createdAt) },
    { key: 'kind', label: t('What'), width: 70, align: 'left', get: (p) => t(BUY_NAME[p.kind]) },
    { key: 'van', label: t('Van'), width: 120, align: 'left', get: (p) => p.vehicleName },
    { key: 'by', label: t('By'), width: 130, align: 'left', get: (p) => p.byName },
    { key: 'status', label: t('Status'), width: 120, align: 'left', get: (p) => t(buyState(p).text), tone: (p) => (p.status === 'done' && !p.flags?.length ? undefined : p.status === 'done' ? c.amber : p.status === 'cancelled' ? c.ink2 : c.alert) },
    { key: 'litres', label: t('Litres'), width: 70, get: (p) => p.litres, text: (p) => one(p.litres), total: (ps) => one(sum(done(ps), (p) => p.litres)) },
    { key: 'total', label: t('Total'), width: 84, get: (p) => p.total, text: (p) => eur2(p.total), total: (ps) => eur2(sum(done(ps), (p) => p.total)) },
    { key: 'perL', label: t('€ per litre'), width: 76, get: (p) => (p.litres && p.total != null ? Math.round((p.total / p.litres) * 1000) / 1000 : null), text: (p) => (p.litres && p.total != null ? `€${(p.total / p.litres).toFixed(3)}` : '') },
    { key: 'odo', label: t('Odometer'), width: 90, get: (p) => p.odometerKm, text: (p) => int(p.odometerKm) },
    { key: 'card', label: t('Fuel card'), width: 130, align: 'left', get: card, tone: (p) => (p.card?.result && p.card.result !== 'match' ? c.alert : undefined) },
    { key: 'flags', label: t('To check'), width: 260, align: 'left', get: (p) => (p.flags || []).map(flagText).join(' '), tone: (p) => (p.flags?.length ? c.amber : undefined) },
    { key: 'where', label: t('Where'), width: 150, align: 'left', get: (p) => p.merchant || '' },
    { key: 'why', label: t('Why (parts)'), width: 200, align: 'left', get: (p) => p.note || '' },
  ];
  if (station) cols.splice(3, 0, { key: 'station', label: t('Station'), width: 110, align: 'left', get: (p) => stationName(p.stationId) });
  return cols;
}

/** What the numbers mean and how far to trust them. */
function HowToRead() {
  const [open, setOpen] = useState(false);
  const c = useColors();
  return (
    <Card dashed>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}><T v="h3">{t('How far to trust these numbers')} {open ? '▲' : '▼'}</T></Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          <T v="small">{t('Kilometres come from the odometer on the dashboard photos at the start and end of each tour, so they are exact. A tour without the end photo is ended by the van\'s next start photo: its kilometres are an estimate and it has no fuel figure.')}</T>
          <T v="small">{t('Fuel comes from the fuel gauge, which shows about a sixteenth of a tank (5 litres on an 80-litre tank). On one tour that is a rough figure; over many tours it evens out. Electric vans show the battery in whole percent and are much more exact. Tours under 20 km get no fuel figure.')}</T>
          <T v="small">{t('"{column}" compares a driver\'s fuel with the other drivers on the same van model, over the same kilometres, from 4 tours on. Route, load and weather matter as much as driving style: it shows who to talk to, it doesn\'t prove anything.', { column: t('vs others, same van') })}</T>
          <T v="small">{t('New damage counts for every driver who had the van between the walk-around before and the one it was found in. "{column}" is damage while nobody else had the van. That is who had it, not proof of who caused it: the photos are the proof.', { column: t('Damage, only them') })}</T>
          <T v="small" color={c.amber}>{t('This is information about how employees work. Drivers see their own numbers on their page. Tell them what is recorded and why; with a works council, agree it with them.')}</T>
        </View>
      ) : null}
    </Card>
  );
}

/** Who had a van at a given moment: for a traffic fine, a complaint or a damage that turns up later. */
function WhoHad() {
  const s = useSession();
  const c = useColors();
  const [van, setVan] = useState<string | null>(null);
  const [day, setDay] = useState(new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  const [at, setAt] = useState('12:00');
  const [q, setQ] = useState('');
  const vans = s.vehicles.filter((v) => s.runs(v.stationId)).sort((a, b) => a.name.localeCompare(b.name));
  const list = q.trim() ? vans.filter((v) => `${v.name} ${v.plate}`.toLowerCase().includes(q.trim().toLowerCase())) : vans;
  const d = parseDay(day);
  const when = d && /^\d{1,2}:\d{2}$/.test(at.trim()) ? new Date(`${d}T${at.trim().padStart(5, '0')}`).getTime() : null;
  const r = van && when ? whoHad(s.assignments, van, when) : null;
  const v = vans.find((x) => x.id === van);
  return (
    <Card>
      <T v="h3">{t('Who was driving?')}</T>
      <T v="small">{t('For a traffic fine or a complaint that arrives days later: pick the van and the moment. The answer comes from the van\'s history, which nobody can change.')}</T>
      <Field label={t('Van')} value={q} onChangeText={setQ} placeholder={t('Name or plate')} autoCorrect={false} />
      <Row gap={6}>{list.slice(0, 12).map((x) => <Chip key={x.id} text={x.plate || x.name} on={van === x.id} onPress={() => setVan(x.id)} />)}</Row>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 140 }}><Field label={t('Day')} value={day} onChangeText={setDay} placeholder="DD.MM.YYYY" /></View>
        <View style={{ width: 110 }}><Field label={t('Time')} value={at} onChangeText={setAt} placeholder="14:30" /></View>
      </Row>
      {r && v ? (
        r.at ? (
          <Pressable onPress={() => router.push(`/person/${r.at!.driverId}`)} style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <Text style={{ fontFamily: F.condBold, fontSize: 24, color: c.ink }}>{r.at.driverName} ›</Text>
            <T v="small">{r.at.end ? t('Had {van} from {from} to {to}.', { van: v.name, from: fmtWhen(r.at.start), to: fmtWhen(r.at.end) }) : t('Had {van} from {from} until now.', { van: v.name, from: fmtWhen(r.at.start) })} {r.at.startedBy === r.at.driverId ? t('Picked it up themselves.') : t('Given by {name}.', { name: r.at.startedByName })}</T>
          </Pressable>
        ) : (
          <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.ink2, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="medium">{t('Nobody had {van} then.', { van: v.name })}</T>
            <T v="small">{[r.before ? t('Before: {name}, until {when}.', { name: r.before.driverName, when: fmtWhen(r.before.end) }) : '', r.after ? t('After: {name}, from {when}.', { name: r.after.driverName, when: fmtWhen(r.after.start) }) : ''].filter(Boolean).join(' ') || t('No history for this van around then.')}</T>
            <T v="small">{t('The app keeps the latest 500 handovers here; older ones are on the van\'s Drivers tab.')}</T>
          </View>
        )
      ) : <T v="small">{!van ? t('Pick a van.') : t('Enter the day like 22.10.2026 and the time like 14:30.')}</T>}
    </Card>
  );
}
