import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TourLine, kmText, per100Text } from '@/components/dash';
import { BuyRow } from '@/components/buy';
import { DriverRecordView } from '@/components/driverrec';
import { HistoryList, VanPicker, sinceText, useHistory } from '@/components/history';
import { ManagePerson, manageRights } from '@/components/person';
import { Button, Card, F, Notice, Pill, Plate, Row, Screen, T, Tabs, fmtWhen, useColors } from '@/components/ui';
import { useDriverData } from '@/lib/data';
import { CHECK_MONTHS, driverDeadlines } from '@/lib/fleet';
import { useFlash } from '@/lib/flash';
import { watchMember } from '@/lib/people';
import { useSession } from '@/lib/session';
import { driverRows } from '@/lib/stats';
import { ROLE_NAME, approvedDamage, roleOf, type Assignment, type Member } from '@/lib/types';
import { loc, t, tp } from '@/lib/i18n';

/**
 * One person, in three parts under their details and the van they have now: their record (licence and checks,
 * employment, briefings, emergency contact, incidents), their tours and numbers, and every van they had.
 * Owners see everyone, managers the people of their station, everyone sees their own page.
 */
export default function PersonScreen() {
  const { uid, tab: openTab } = useLocalSearchParams<{ uid: string; tab?: string }>();
  const s = useSession();
  const c = useColors();
  const me = uid === s.user?.uid;
  const allowed = s.staff || me;
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [manage, setManage] = useState(false);
  const [tab, setTab] = useState<'record' | 'tours' | 'vans'>(openTab === 'tours' || openTab === 'vans' ? openTab : 'record');
  const done = useFlash(`person:${uid}`);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId || !uid || !allowed || s.mode !== 'firebase') return;
    if (me && s.member) { setMember(s.member); return; }
    return watchMember(orgId, uid, setMember, () => setMember(null));
  }, [orgId, uid, allowed, me, s.member, s.mode]);
  const history = useHistory({ driverId: uid });
  const data = useDriverData(allowed ? uid : undefined);

  if (!allowed) return <Screen edges={[]}><Card dashed><T v="hint">{t('Only fleet managers and owners see other people.')}</T></Card></Screen>;
  if (s.mode !== 'firebase') return <Screen edges={[]}><Card dashed><T v="hint">{t('People and van history need the Firebase backend.')}</T></Card></Screen>;

  const rows = history.rows || [];
  const name = member?.name || rows[0]?.driverName || (me ? s.user?.name : '') || t('Unknown person');
  const r = member ? roleOf(member) : null;
  const van = s.vehicles.find((v) => !v.retired && v.assignedTo?.driverId === uid);
  const openRow = rows.find((a) => a.end == null);
  const rights = member ? manageRights(s, member) : { canEdit: false, canRemove: false };
  const canGive = !!member && !!r && r !== 'owner' && (member.stationIds || []).some((id) => s.runs(id));
  const stationNames = (member?.stationIds || []).map((id) => s.stationName(id)).join(', ');
  const rec = me && !s.staff ? s.myRecord : s.records.find((x) => x.id === uid);
  const due = driverDeadlines(rec, s.org?.licenceCheckMonths || CHECK_MONTHS).filter((x) => x.state !== 'ok');
  // Someone who left: a placeholder member so the record and incidents still show (read-only).
  const shown: Member | null = member || (member === null ? { uid: uid!, role: 'driver', stationIds: rows[0]?.stationId ? [rows[0].stationId] : [], email: '', name } : null);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: me ? t('You') : name }} />
      <View style={{ gap: 6 }}>
        <T v="h1">{me ? t('{name} (you)', { name }) : name}</T>
        <Row>
          {r ? <Pill v={r === 'owner' ? 'solid' : 'default'} text={t(ROLE_NAME[r])} /> : null}
          {member === null ? <Pill v="muted" text={t('Left the company')} /> : null}
          {due.length ? <Pill v={due.some((x) => x.state === 'overdue') ? 'bad' : 'amber'} text={due.length === 1 ? `${due[0].label}: ${due[0].note}` : tp(due.length, '{n} thing due', '{n} things due')} /> : null}
          {stationNames ? <T v="hint">{stationNames}</T> : null}
        </Row>
        {member ? <T v="hint" selectable>{[member.phone, member.transporterId ? t('Transporter ID {id}', { id: member.transporterId }) : '', member.email].filter(Boolean).join(', ')}</T> : null}
        {member === undefined ? <T v="hint">{t('Loading…')}</T> : null}
        {member === null ? <T v="hint">{t('{name} is no longer in {company}. Their van history, tours and record stay.', { name, company: s.org?.name || '' })}</T> : null}
      </View>

      {done ? <Notice text={done} /> : null}
      {r !== 'owner' && member !== null ? (
        <Card>
          <T v="hint">{t('Van now')}</T>
          {van ? (
            <Pressable onPress={() => router.push(`/vehicle/${van.id}`)} style={{ gap: 4 }}>
              <T v="h2">{van.name} ›</T>
              {van.plate ? <Plate text={van.plate} /> : null}
              <T v="hint">{sinceText(van.assignedTo!.since)}</T>
            </Pressable>
          ) : openRow ? (
            <><T v="h2">{openRow.vehicleName}</T><T v="hint">{sinceText(openRow.start)}</T></>
          ) : <><T v="h2">{t('No van')}</T><T v="hint">{me ? t('Your fleet manager gives you a van.') : t('Give them one below or from a van\'s page.')}</T></>}
          {canGive ? (picking ? <VanPicker m={member!} onDone={() => setPicking(false)} />
            : <Button small v={van ? 'secondary' : 'primary'} title={van ? t('Give a different van') : t('Give a van')} onPress={() => setPicking(true)} />) : null}
        </Card>
      ) : null}

      {r !== 'owner' ? (
        <Tabs value={tab} onChange={setTab} items={[['record', t('Record'), null], ['tours', t('Tours'), null], ['vans', t('Vans'), rows.length || null]]} />
      ) : null}

      {tab === 'record' && r !== 'owner' && shown ? (
        <>
          {me && !s.staff ? <T v="hint">{t('What your company keeps about you as a driver. Ask your fleet manager to correct anything that\'s wrong.')}</T> : null}
          <DriverRecordView m={shown} incidents={data.incidents} />
        </>
      ) : null}

      {tab === 'tours' && r !== 'owner' ? <Numbers uid={uid!} member={shown} data={data} history={rows} /> : null}
      {tab === 'tours' || r === 'owner' ? (() => {
        const buys = s.purchases.filter((p) => p.by === uid);
        return buys.length ? (
          <View style={{ gap: 8 }}>
            <T v="h2">{t('Fuel, wash and parts')}</T>
            <T v="hint">{me ? t('Yours, newest first.') : t('Newest first, with the ones refused or given up.')}</T>
            <Card style={{ paddingVertical: 6 }}>{buys.slice(0, 15).map((p, i) => <BuyRow key={p.id} p={p} show="van" first={i === 0} />)}</Card>
          </View>
        ) : null;
      })() : null}

      {tab === 'vans' || r === 'owner' ? (
        <>
          <View style={{ gap: 8 }}>
            <T v="h2">{me ? t('Vans you had') : t('Vans they had')}</T>
            <T v="hint">{s.role === 'manager' && !me ? t('At your station, newest first. Kept for good.') : t('Newest first. Kept for good.')}</T>
            <Card><HistoryList rows={history.rows} error={history.error} show="van" empty={me ? t('You haven\'t had a van yet.') : t('No van yet.')} /></Card>
          </View>
          <Checks uid={uid!} me={me} />
        </>
      ) : null}

      {member && (rights.canEdit || rights.canRemove) ? (
        manage ? <Card><T v="h3">{t('Manage {name}', { name: member.name })}</T><ManagePerson m={member} onDone={() => router.back()} /><Button v="link" small title={t('Close')} onPress={() => setManage(false)} /></Card>
          : <Button title={t('Manage {name}', { name: member.name })} onPress={() => setManage(true)} />
      ) : null}
    </Screen>
  );
}

/** The last 30 days in numbers, then every tour. */
function Numbers({ uid, member, data, history }: { uid: string; member: Member | null; data: ReturnType<typeof useDriverData>; history: Assignment[] }) {
  const s = useSession();
  const c = useColors();
  const [more, setMore] = useState(false);
  const to = Date.now(), from = to - 30 * 86_400_000;
  // The comparison with the other drivers needs their tours too: the ones the app has loaded for the station.
  const all = useMemo(() => {
    const byId = new Map(s.tours.map((t) => [t.id, t]));
    for (const t of data.tours || []) byId.set(t.id, t);
    return [...byId.values()];
  }, [s.tours, data.tours]);
  const row = useMemo(() => driverRows({
    from, to, tours: all, assignments: history, logs: data.logs || [], incidents: data.incidents || [], records: s.records,
    members: member ? [member] : null, vehicles: s.vehicles, details: s.details, costs: s.costs, videos: s.videos, walks: s.walks, stations: s.stations,
  }).find((x) => x.id === uid), [all, data.logs, data.incidents, history, member, uid, s.records, s.vehicles, s.details, s.costs, s.videos, s.walks, s.stations, from, to]);
  const tours = (data.tours || []).slice().sort((a, b) => b.startAt - a.startAt);
  const shown = more ? tours : tours.slice(0, 12);
  const pct = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
  return (
    <View style={{ gap: 10 }}>
      <T v="h2">{t('Last 30 days')}</T>
      {!s.org?.dashScans && !tours.length ? <Notice text={t('Tours come from dashboard photos at the start and end of each tour. The owner turns them on in the Account tab.')} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper }}>
        <Num value={String(row?.tours ?? 0)} label={t('tours')} />
        <Num value={row ? Math.round(row.km).toLocaleString(loc()) : '0'} label="km" />
        <Num value={row?.diesel != null ? per100Text(row.diesel, 'l').replace('/100 km', '') : row?.electric != null ? per100Text(row.electric, 'kwh').replace('/100 km', '') : '–'} label={t('per 100 km')} />
        <Num value={pct(row?.vsModel ?? null)} label={t('vs others, same van')} tone={row?.vsModel != null && row.vsModel > 0.08 ? c.alert : undefined} />
        <Num value={String(row?.damage ?? 0)} label={t('new damage while they had the van')} />
        <Num value={String((row?.accidents ?? 0) + (row?.fines ?? 0) + (row?.complaints ?? 0))} label={t('incidents')} />
      </View>
      <T v="small">
        {row && row.vsTours
          ? tp(row.vsTours, 'Fuel from gauge photos is a rough figure per tour; the average over many tours is what counts. "vs others" compares with the other drivers of the same van model over the same kilometres ({n} tour). Damage counts every driver who had the van between the walk-around before and the one it was found in: who had it, not proof of who caused it.',
            'Fuel from gauge photos is a rough figure per tour; the average over many tours is what counts. "vs others" compares with the other drivers of the same van model over the same kilometres ({n} tours). Damage counts every driver who had the van between the walk-around before and the one it was found in: who had it, not proof of who caused it.')
          : t('Fuel from gauge photos is a rough figure per tour; the average over many tours is what counts. "vs others" compares with the other drivers of the same van model over the same kilometres. Damage counts every driver who had the van between the walk-around before and the one it was found in: who had it, not proof of who caused it.')}
      </T>
      <T v="h2">{t('Tours')}</T>
      <Card>
        {data.tours == null ? <T v="hint">{t('Loading…')}</T> : !tours.length ? <T v="hint">{t('No tours yet.')}</T> : null}
        {shown.map((t, i) => (
          <Pressable key={t.id} onPress={() => router.push(`/vehicle/${t.vehicleId}`)} style={{ borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 8 : 0 }}>
            <TourLine t={t} show="van" />
          </Pressable>
        ))}
        {tours.length > shown.length ? <Button small v="link" title={t('Show all {n}', { n: tours.length })} onPress={() => setMore(true)} /> : null}
      </Card>
      {tours.length ? <T v="small">{tp(tours.length, '{km} in the {n} tour shown here.', '{km} in all {n} tours shown here.', { km: kmText(tours.reduce((n, x) => n + (x.km || 0), 0)) })}</T> : null}
    </View>
  );
}
function Num({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const c = useColors();
  return (
    <View style={{ width: '33.33%', minWidth: 110, padding: 12, gap: 2, borderColor: c.rule }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 28, lineHeight: 31, color: tone || c.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <T v="small">{label}</T>
    </View>
  );
}

/** The person's latest walk-arounds and checks in the app. */
function Checks({ uid, me }: { uid: string; me: boolean }) {
  const s = useSession();
  const c = useColors();
  const walks = s.walks.filter((w) => w.createdBy === uid);
  const checks = s.checks.filter((k) => k.createdBy === uid);
  if (!walks.length && !checks.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <T v="h2">{t('Walk-arounds and checks')}</T>
      <T v="hint">{s.role === 'manager' && !me ? t('The latest ones in the app for your station.') : t('The latest ones in the app.')}</T>
      {checks.slice(0, 8).map((k) => {
        const dmg = approvedDamage(k).length;
        return (
          <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <Row>
              <T v="h3" style={{ flex: 1 }}>{t('Check, {van}', { van: k.vehicleName })}</T>
              <Pill v={k.status === 'reviewed' ? 'solid' : k.status === 'submitted' ? 'amber' : 'muted'} text={k.status === 'reviewed' ? tp(dmg, '{n} approved damage', '{n} approved damages') : k.status === 'submitted' ? t('Waiting for review') : t('Close-ups pending')} />
            </Row>
            <T v="hint">{fmtWhen(k.createdAt)}</T>
          </Pressable>
        );
      })}
      {walks.slice(0, 8).map((w) => (
        <Pressable key={w.id} onPress={() => router.push(`/walk/${w.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
          <T v="h3">{t('Walk-around, {van}', { van: w.vehicleName })}</T>
          <T v="hint">{tp(w.frames, '{when}, {taken} of {n} photo', '{when}, {taken} of {n} photos', { when: fmtWhen(w.createdAt), taken: w.taken })}</T>
        </Pressable>
      ))}
    </View>
  );
}
