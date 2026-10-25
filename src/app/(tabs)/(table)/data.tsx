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

/**
 * The fleet in numbers, like a spreadsheet: drivers, tours and vans for a period, sortable by any column, with a
 * download for Excel. Owners see every station, fleet managers their own. Costs only for owners.
 */

type Period = '7' | '30' | '90' | 'year';
type View3 = 'drivers' | 'tours' | 'vans' | 'buys';
const PERIODS: [Period, string][] = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['year', 'This year']];

const int = (n: number | null | undefined) => (n == null ? '' : Math.round(n).toLocaleString());
const one = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (n: number | null | undefined) => (n == null ? '' : `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`);
const eur2 = (n: number | null | undefined) => (n == null ? '' : `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
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

  if (!s.staff) return <Screen><T v="h1">Data</T><Card dashed><T v="hint">Fleet managers and owners see the fleet in numbers.</T></Card></Screen>;

  const match = (t: string) => !q.trim() || t.toLowerCase().includes(q.trim().toLowerCase());
  const dCols = driverCols(c, multi && !station, s.stationName);
  const tCols = tourCols(c, multi && !station, s.stationName);
  const vCols = vanCols(c, multi && !station, s.stationName, owner);
  const dRows = sortRows(drivers.filter((r) => match(r.name)), dCols, sorts.drivers);
  const tRows = sortRows(tours.filter((t) => match(`${t.driverName} ${t.vehicleName} ${t.plate}`)), tCols, sorts.tours);
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
      const label = PERIODS.find((p) => p[0] === period)![1];
      await saveXlsx(`Fleet Check ${s.org?.name || ''} ${label} to ${new Date().toISOString().slice(0, 10)}`, [
        sheet('Drivers', dCols, sortRows(drivers, dCols, sorts.drivers), {
          vs: (r) => (r.vsModel == null ? null : Math.round(r.vsModel * 1000) / 10),
          licence: (r) => (r.licenceValid ? { date: Date.parse(r.licenceValid + 'T12:00:00') } : null),
          check: (r) => (r.nextCheck ? { date: Date.parse(r.nextCheck + 'T12:00:00') } : r.checkState === 'overdue' ? 'never recorded' : null),
        }),
        sheet('Tours', tCols, sortRows(tours, tCols, sorts.tours), {
          date: (t) => ({ date: t.startAt, time: true }), end: (t) => (t.end ? { date: t.end.at, time: true } : null),
        }),
        sheet('Vans', vCols, sortRows(vans, vCols, sorts.vans), { vs: (r) => (r.vsModel == null ? null : Math.round(r.vsModel * 1000) / 10) }),
        sheet('Fuel, wash, parts', bCols, sortRows(buys, bCols, sorts.buys), { date: (p) => ({ date: p.createdAt, time: true }) }),
      ]);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn\'t make the file.'); } finally { setSaving(false); }
  };

  return (
    <Screen wide>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="h1">Data</T>
          <T v="hint">{owner ? 'Your drivers, tours and vans in numbers.' : `${s.myStations.map((st) => st.name).join(', ')}: drivers, tours and vans in numbers.`}</T>
        </View>
        <Button small title={saving ? 'Making the file…' : 'Download for Excel'} loading={saving} onPress={download} />
      </View>
      {err ? <Notice tone="bad" text={err} /> : null}
      {data.error ? <Notice tone="bad" text={data.error} /> : null}

      <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      {multi ? (
        <Row>
          <Chip text="All stations" on={!station} onPress={() => setStation(null)} />
          {s.myStations.map((st) => <Chip key={st.id} text={st.name} on={station === st.id} onPress={() => setStation(st.id)} />)}
        </Row>
      ) : null}

      {/* The period at a glance. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper }}>
        <Big value={int(sum1.tours) || '0'} label="tours" />
        <Big value={int(sum1.km) || '0'} label="km" />
        <Big value={sum1.diesel != null ? one(sum1.diesel) : '–'} label="l/100 km, diesel" />
        <Big value={sum1.electric != null ? one(sum1.electric) : '–'} label="kWh/100 km, electric" />
        <Big value={String(sum1.damage)} label="new damage" />
        <Big value={String(sum1.incidents)} label="incidents" />
      </View>
      {data.loading ? <T v="hint">Loading the numbers…</T> : null}
      {!s.org?.dashScans && !data.tours.length ? (
        <Notice text={owner ? 'Kilometres and fuel come from dashboard photos at the start and end of each tour. Turn them on in the Account tab.' : 'Kilometres and fuel come from dashboard photos on each tour. The owner turns them on.'} />
      ) : null}

      <Tabs value={view} onChange={setView} items={[['drivers', 'Drivers', drivers.length || null], ['tours', 'Tours', tours.length || null], ['vans', 'Vans', vans.length || null], ['buys', 'Fuel, wash', buys.length || null]]} />
      <Field label={view === 'drivers' ? 'Find a driver' : view === 'vans' ? 'Find a van' : 'Find a driver or van'} value={q} onChangeText={setQ} placeholder="Name or plate" autoCorrect={false} />

      {view === 'drivers' ? (
        <DataTable key="drivers" rows={dRows} cols={dCols} rowKey={(r) => r.id} sort={sorts.drivers} onSort={setSort('drivers')} totalLabel={`All ${dRows.length}`}
          onRow={s.mode === 'firebase' ? (r) => router.push({ pathname: '/person/[uid]', params: { uid: r.id, tab: 'tours' } }) : undefined} empty="No drivers in this period." />
      ) : view === 'tours' ? (
        <DataTable key="tours" rows={tRows} cols={tCols} rowKey={(t) => t.id} sort={sorts.tours} onSort={setSort('tours')} totalLabel={`All ${tRows.length}`}
          onRow={(t) => router.push(`/vehicle/${t.vehicleId}`)} empty={s.org?.dashScans ? 'No tours in this period yet.' : 'No tours: dashboard photos are off.'} />
      ) : view === 'vans' ? (
        <DataTable key="vans" rows={vRows} cols={vCols} rowKey={(v) => v.id} sort={sorts.vans} onSort={setSort('vans')} totalLabel={`All ${vRows.length}`}
          onRow={(v) => router.push(`/vehicle/${v.id}`)} empty="No vans here." />
      ) : (
        <DataTable key="buys" rows={bRows} cols={bCols} rowKey={(p) => p.id} sort={sorts.buys} onSort={setSort('buys')} totalLabel={`All ${bRows.length}`}
          onRow={(p) => router.push(`/buy/${p.id}`)} empty="No refuels, washes or parts in this period." />
      )}
      <T v="small">Tap a column heading to sort, again to reverse. Swipe the table sideways for more columns; tap a row to open it.</T>

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
    { key: 'name', label: 'Driver', width: 156, align: 'left', get: (r) => r.name, text: (r) => `${r.name}${r.role === 'former' ? ' (left)' : ''}` },
    { key: 'tours', label: 'Tours', width: 64, get: (r) => r.tours, total: (rs) => int(sum(rs, (r) => r.tours)) },
    { key: 'days', label: 'Days with a van', width: 78, get: (r) => r.days },
    { key: 'km', label: 'km', width: 84, get: (r) => Math.round(r.km), text: (r) => int(r.km), total: (rs) => int(sum(rs, (r) => r.km)) },
    { key: 'kmPerTour', label: 'km per tour', width: 78, get: (r) => (r.kmPerTour == null ? null : Math.round(r.kmPerTour)), text: (r) => int(r.kmPerTour) },
    { key: 'hours', label: 'Hours per tour', width: 78, get: (r) => (r.hoursPerTour == null ? null : Math.round(r.hoursPerTour * 10) / 10), text: (r) => one(r.hoursPerTour) },
    { key: 'diesel', label: 'l/100 km', width: 74, get: (r) => (r.diesel == null ? null : Math.round(r.diesel * 10) / 10), text: (r) => one(r.diesel) },
    { key: 'electric', label: 'kWh/100 km', width: 84, get: (r) => (r.electric == null ? null : Math.round(r.electric * 10) / 10), text: (r) => one(r.electric) },
    { key: 'vs', label: 'vs others, same van', width: 92, get: (r) => r.vsModel, text: (r) => pct(r.vsModel), tone: (r) => vsTone(c, r.vsModel) },
    { key: 'vans', label: 'Vans', width: 56, get: (r) => r.vans },
    // No total here: a damage found while two drivers had the van counts for both.
    { key: 'damage', label: 'New damage', width: 74, get: (r) => r.damage, tone: (r) => (r.damage ? c.alert : undefined) },
    { key: 'sole', label: 'Damage, only them', width: 86, get: (r) => r.damageSole, tone: (r) => (r.damageSole ? c.alert : undefined), total: (rs) => int(sum(rs, (r) => r.damageSole)) },
    { key: 'per10k', label: 'Damage per 10,000 km', width: 96, get: (r) => (r.damagePer10k == null ? null : Math.round(r.damagePer10k * 10) / 10), text: (r) => one(r.damagePer10k) },
    { key: 'noEnd', label: 'Tours without end photo', width: 96, get: (r) => r.noEndPhoto, tone: (r) => (r.noEndPhoto ? c.amber : undefined) },
    { key: 'proof', label: 'Handovers without video', width: 96, get: (r) => r.missingProof, tone: (r) => (r.missingProof ? c.amber : undefined) },
    { key: 'accidents', label: 'Accidents (at fault)', width: 92, get: (r) => r.accidents, text: (r) => (r.accidents ? `${r.accidents} (${r.atFault})` : '0'), tone: (r) => (r.atFault ? c.alert : undefined) },
    { key: 'fines', label: 'Fines', width: 60, get: (r) => r.fines, tone: (r) => (r.fines >= 2 ? c.alert : undefined) },
    { key: 'complaints', label: 'Complaints', width: 84, get: (r) => r.complaints },
    { key: 'licence', label: 'Licence valid until', width: 110, get: (r) => r.licenceValid, text: (r) => (r.licenceValid ? fmtDay(r.licenceValid) : ''),
      tone: (r) => (r.licenceValid && daysTo(r.licenceValid) < 0 ? c.alert : r.licenceValid && daysTo(r.licenceValid) <= 60 ? c.amber : undefined) },
    { key: 'check', label: 'Next licence check', width: 110, get: (r) => r.nextCheck || (r.checkState === 'overdue' ? '0000' : null),
      text: (r) => (r.nextCheck ? fmtDay(r.nextCheck) : r.checkState === 'overdue' ? 'never' : ''), tone: (r) => (r.checkState === 'overdue' ? c.alert : r.checkState === 'soon' ? c.amber : undefined) },
  ];
  // The numbers that matter most first, so they show on a phone without swiping.
  const order = ['name', 'km', 'tours', 'diesel', 'electric', 'vs', 'damage', 'sole', 'accidents', 'fines', 'complaints', 'check', 'licence', 'noEnd', 'proof', 'days', 'kmPerTour', 'hours', 'vans', 'per10k'];
  cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (station) cols.splice(1, 0, { key: 'station', label: 'Station', width: 110, align: 'left', get: (r) => stationName(r.stationId) });
  return cols;
}

function tourCols(c: C, station: boolean, stationName: (id: string | null) => string): Col<Tour>[] {
  const ended = (t: Tour) => (isOpen(t) ? 'On tour' : t.endedHow === 'photo' ? 'Photo' : t.endedHow === 'next' ? 'Estimated' : 'None');
  const cols: Col<Tour>[] = [
    { key: 'driver', label: 'Driver', width: 140, align: 'left', get: (t) => t.driverName },
    { key: 'date', label: 'Start', width: 116, align: 'left', get: (t) => t.startAt, text: (t) => fmtWhen(t.startAt) },
    { key: 'van', label: 'Van', width: 120, align: 'left', get: (t) => t.vehicleName },
    { key: 'end', label: 'End', width: 64, get: (t) => t.end?.at ?? null, text: (t) => time(t.end?.at) },
    { key: 'hours', label: 'Hours', width: 64, get: (t) => t.hours, text: (t) => one(t.hours) },
    { key: 'km', label: 'km', width: 70, get: (t) => t.km, text: (t) => int(t.km), total: (ts) => int(sum(ts, (t) => t.km)) },
    { key: 'startKm', label: 'Odometer at start', width: 96, get: (t) => t.start.km, text: (t) => int(t.start.km) },
    { key: 'used', label: 'Used', width: 74, get: (t) => t.used, text: (t) => (t.used == null ? '' : `${one(t.used)} ${t.unit === 'kwh' ? 'kWh' : 'l'}`) },
    { key: 'per100', label: 'per 100 km', width: 84, get: (t) => t.per100, text: (t) => (t.per100 == null ? '' : `${one(t.per100)} ${t.unit === 'kwh' ? 'kWh' : 'l'}`) },
    { key: 'refuel', label: 'Refuelled', width: 84, get: (t) => (t.refuel?.litres ?? (t.refuel?.unknown ? 'yes' : t.refuel ? 'no' : null)),
      text: (t) => (t.refuel?.litres ? `${one(t.refuel.litres)} l` : t.refuel?.unknown ? 'yes, ?' : t.refuel ? 'no' : '') },
    { key: 'endPhoto', label: 'End photo', width: 86, align: 'left', get: ended, tone: (t) => (t.endedHow === 'next' || t.endedHow === 'none' ? c.amber : undefined) },
    { key: 'warnings', label: 'Warning lights', width: 150, align: 'left', get: (t) => (t.warnings || []).join(', '), tone: (t) => (t.warnings?.length ? c.warn : undefined) },
  ];
  const order = ['driver', 'date', 'van', 'km', 'per100', 'used', 'refuel', 'endPhoto', 'warnings', 'hours', 'end', 'startKm'];
  cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (station) cols.push({ key: 'station', label: 'Station', width: 110, align: 'left', get: (t) => stationName(t.stationId) });
  return cols;
}

function vanCols(c: C, station: boolean, stationName: (id: string | null) => string, owner: boolean): Col<VanRow>[] {
  const cols: Col<VanRow>[] = [
    { key: 'name', label: 'Van', width: 140, align: 'left', get: (v) => v.name, text: (v) => `${v.name}${v.retired ? ' (retired)' : ''}` },
    { key: 'plate', label: 'Plate', width: 92, align: 'left', get: (v) => v.plate },
    { key: 'model', label: 'Model', width: 140, align: 'left', get: (v) => v.model },
    { key: 'fuel', label: 'Fuel', width: 72, align: 'left', get: (v) => (v.fuel ? FUEL[v.fuel] : '') },
    { key: 'odo', label: 'Odometer', width: 90, get: (v) => v.odometer, text: (v) => int(v.odometer) },
    { key: 'km', label: 'km in period', width: 84, get: (v) => v.km, text: (v) => int(v.km), total: (vs) => int(sum(vs, (v) => v.km)) },
    { key: 'tours', label: 'Tours', width: 60, get: (v) => v.tours, total: (vs) => int(sum(vs, (v) => v.tours)) },
    { key: 'drivers', label: 'Drivers', width: 64, get: (v) => v.drivers },
    { key: 'per100', label: 'per 100 km', width: 84, get: (v) => (v.per100 == null ? null : Math.round(v.per100 * 10) / 10), text: (v) => (v.per100 == null ? '' : `${one(v.per100)} ${v.unit === 'kwh' ? 'kWh' : 'l'}`) },
    { key: 'vs', label: 'vs same model', width: 84, get: (v) => v.vsModel, text: (v) => pct(v.vsModel), tone: (v) => vsTone(c, v.vsModel) },
    { key: 'damage', label: 'New damage', width: 74, get: (v) => v.damage, tone: (v) => (v.damage ? c.alert : undefined), total: (vs) => int(sum(vs, (v) => v.damage)) },
    { key: 'warnings', label: 'Warning lights', width: 140, align: 'left', get: (v) => v.warnings.join(', '), tone: (v) => (v.warnings.length ? c.warn : undefined) },
    { key: 'noEnd', label: 'Tours without end photo', width: 96, get: (v) => v.noEndPhoto },
    { key: 'due', label: 'Next deadline', width: 190, align: 'left', get: (v) => v.nextDue?.days ?? null, text: (v) => (v.nextDue ? `${v.nextDue.label}, ${v.nextDue.note}` : ''),
      tone: (v) => (v.nextDue?.state === 'overdue' ? c.alert : v.nextDue?.state === 'soon' ? c.amber : undefined) },
  ];
  const order = ['name', 'km', 'per100', 'vs', 'damage', 'warnings', 'due', 'tours', 'drivers', 'noEnd', 'odo', 'plate', 'model', 'fuel'];
  cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (station) cols.splice(1, 0, { key: 'station', label: 'Station', width: 110, align: 'left', get: (v) => stationName(v.stationId) });
  if (owner) {
    cols.push({ key: 'monthly', label: '€ a month', width: 84, get: (v) => v.monthly, text: (v) => (v.monthly == null ? '' : `€${int(v.monthly)}`), total: (vs) => `€${int(sum(vs, (v) => v.monthly))}` });
    cols.push({ key: 'perKm', label: '€ per km (monthly rate)', width: 104, get: (v) => (v.costPerKm == null ? null : Math.round(v.costPerKm * 100) / 100), text: (v) => eur2(v.costPerKm) });
  }
  return cols;
}

/** Every refuel, wash and parts purchase, with the refused and unfinished ones (totals count only finished ones). */
function buyCols(c: C, station: boolean, stationName: (id: string | null) => string): Col<Purchase>[] {
  const done = (ps: Purchase[]) => ps.filter((p) => p.status === 'done');
  const card = (p: Purchase) => (p.kind === 'parts' ? '' : !p.card?.needed ? 'none on record' : p.card.result === 'match' ? 'the van\'s'
    : p.card.result ? `${p.card.result === 'missing' ? 'no card' : p.card.result === 'unclear' ? 'not read' : 'wrong card'}${p.decision ? (p.decision.allow ? ', allowed' : ', refused') : ''}` : '');
  const cols: Col<Purchase>[] = [
    { key: 'date', label: 'When', width: 116, align: 'left', get: (p) => p.createdAt, text: (p) => fmtWhen(p.createdAt) },
    { key: 'kind', label: 'What', width: 70, align: 'left', get: (p) => BUY_NAME[p.kind] },
    { key: 'van', label: 'Van', width: 120, align: 'left', get: (p) => p.vehicleName },
    { key: 'by', label: 'By', width: 130, align: 'left', get: (p) => p.byName },
    { key: 'status', label: 'Status', width: 120, align: 'left', get: (p) => buyState(p).text, tone: (p) => (p.status === 'done' && !p.flags?.length ? undefined : p.status === 'done' ? c.amber : p.status === 'cancelled' ? c.ink2 : c.alert) },
    { key: 'litres', label: 'Litres', width: 70, get: (p) => p.litres, text: (p) => one(p.litres), total: (ps) => one(sum(done(ps), (p) => p.litres)) },
    { key: 'total', label: 'Total', width: 84, get: (p) => p.total, text: (p) => eur2(p.total), total: (ps) => eur2(sum(done(ps), (p) => p.total)) },
    { key: 'perL', label: '€ per litre', width: 76, get: (p) => (p.litres && p.total != null ? Math.round((p.total / p.litres) * 1000) / 1000 : null), text: (p) => (p.litres && p.total != null ? `€${(p.total / p.litres).toFixed(3)}` : '') },
    { key: 'odo', label: 'Odometer', width: 90, get: (p) => p.odometerKm, text: (p) => int(p.odometerKm) },
    { key: 'card', label: 'Fuel card', width: 130, align: 'left', get: card, tone: (p) => (p.card?.result && p.card.result !== 'match' ? c.alert : undefined) },
    { key: 'flags', label: 'To check', width: 260, align: 'left', get: (p) => (p.flags || []).map((f) => f.text).join(' '), tone: (p) => (p.flags?.length ? c.amber : undefined) },
    { key: 'where', label: 'Where', width: 150, align: 'left', get: (p) => p.merchant || '' },
    { key: 'why', label: 'Why (parts)', width: 200, align: 'left', get: (p) => p.note || '' },
  ];
  if (station) cols.splice(3, 0, { key: 'station', label: 'Station', width: 110, align: 'left', get: (p) => stationName(p.stationId) });
  return cols;
}

/** What the numbers mean and how far to trust them. */
function HowToRead() {
  const [open, setOpen] = useState(false);
  const c = useColors();
  return (
    <Card dashed>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}><T v="h3">How far to trust these numbers {open ? '▲' : '▼'}</T></Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          <T v="small">Kilometres come from the odometer on the dashboard photos at the start and end of each tour, so they are exact. A tour without the end photo is ended by the van&apos;s next start photo: its kilometres are an estimate and it has no fuel figure.</T>
          <T v="small">Fuel comes from the fuel gauge, which shows about a sixteenth of a tank (5 litres on an 80-litre tank). On one tour that is a rough figure; over many tours it evens out. Electric vans show the battery in whole percent and are much more exact. Tours under 20 km get no fuel figure.</T>
          <T v="small">&quot;vs others, same van&quot; compares a driver&apos;s fuel with the other drivers on the same van model, over the same kilometres, from 4 tours on. Route, load and weather matter as much as driving style: it shows who to talk to, it doesn&apos;t prove anything.</T>
          <T v="small">New damage counts for every driver who had the van between the walk-around before and the one it was found in. &quot;Only them&quot; is damage while nobody else had the van. That is who had it, not proof of who caused it: the photos are the proof.</T>
          <T v="small" color={c.amber}>This is information about how employees work. Drivers see their own numbers on their page. Tell them what is recorded and why; with a works council, agree it with them.</T>
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
  const t = d && /^\d{1,2}:\d{2}$/.test(at.trim()) ? new Date(`${d}T${at.trim().padStart(5, '0')}`).getTime() : null;
  const r = van && t ? whoHad(s.assignments, van, t) : null;
  const v = vans.find((x) => x.id === van);
  return (
    <Card>
      <T v="h3">Who was driving?</T>
      <T v="small">For a traffic fine or a complaint that arrives days later: pick the van and the moment. The answer comes from the van&apos;s history, which nobody can change.</T>
      <Field label="Van" value={q} onChangeText={setQ} placeholder="Name or plate" autoCorrect={false} />
      <Row gap={6}>{list.slice(0, 12).map((x) => <Chip key={x.id} text={x.plate || x.name} on={van === x.id} onPress={() => setVan(x.id)} />)}</Row>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 140 }}><Field label="Day" value={day} onChangeText={setDay} placeholder="DD.MM.YYYY" /></View>
        <View style={{ width: 110 }}><Field label="Time" value={at} onChangeText={setAt} placeholder="14:30" /></View>
      </Row>
      {r && v ? (
        r.at ? (
          <Pressable onPress={() => router.push(`/person/${r.at!.driverId}`)} style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <Text style={{ fontFamily: F.condBold, fontSize: 24, color: c.ink }}>{r.at.driverName} ›</Text>
            <T v="small">Had {v.name} from {fmtWhen(r.at.start)} to {r.at.end ? fmtWhen(r.at.end) : 'now'}. {r.at.startedBy === r.at.driverId ? 'Picked it up themselves.' : `Given by ${r.at.startedByName}.`}</T>
          </Pressable>
        ) : (
          <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.ink2, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="medium">Nobody had {v.name} then.</T>
            <T v="small">{[r.before ? `Before: ${r.before.driverName}, until ${fmtWhen(r.before.end)}.` : '', r.after ? `After: ${r.after.driverName}, from ${fmtWhen(r.after.start)}.` : ''].filter(Boolean).join(' ') || 'No history for this van around then.'}</T>
            <T v="small">The app keeps the latest 500 handovers here; older ones are on the van&apos;s Drivers tab.</T>
          </View>
        )
      ) : <T v="small">{!van ? 'Pick a van.' : 'Enter the day like 22.10.2026 and the time like 14:30.'}</T>}
    </Card>
  );
}
