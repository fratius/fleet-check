import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TourLine, kmText, per100Text } from '@/components/dash';
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

  if (!allowed) return <Screen edges={[]}><Card dashed><T v="hint">Only fleet managers and owners see other people.</T></Card></Screen>;
  if (s.mode !== 'firebase') return <Screen edges={[]}><Card dashed><T v="hint">People and van history need the Firebase backend.</T></Card></Screen>;

  const rows = history.rows || [];
  const name = member?.name || rows[0]?.driverName || (me ? s.user?.name : '') || 'Unknown person';
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
      <Stack.Screen options={{ title: me ? 'You' : name }} />
      <View style={{ gap: 6 }}>
        <T v="h1">{name}{me ? ' (you)' : ''}</T>
        <Row>
          {r ? <Pill v={r === 'owner' ? 'solid' : 'default'} text={ROLE_NAME[r]} /> : null}
          {member === null ? <Pill v="muted" text="Left the company" /> : null}
          {due.length ? <Pill v={due.some((x) => x.state === 'overdue') ? 'bad' : 'amber'} text={due.length === 1 ? `${due[0].label}: ${due[0].note}` : `${due.length} things due`} /> : null}
          {stationNames ? <T v="hint">{stationNames}</T> : null}
        </Row>
        {member ? <T v="hint" selectable>{[member.phone, member.transporterId ? `Transporter ID ${member.transporterId}` : '', member.email].filter(Boolean).join(', ')}</T> : null}
        {member === undefined ? <T v="hint">Loading…</T> : null}
        {member === null ? <T v="hint">{name} is no longer in {s.org?.name}. Their van history, tours and record stay.</T> : null}
      </View>

      {done ? <Notice text={done} /> : null}
      {r !== 'owner' && member !== null ? (
        <Card>
          <T v="hint">Van now</T>
          {van ? (
            <Pressable onPress={() => router.push(`/vehicle/${van.id}`)} style={{ gap: 4 }}>
              <T v="h2">{van.name} ›</T>
              {van.plate ? <Plate text={van.plate} /> : null}
              <T v="hint">{sinceText(van.assignedTo!.since)}</T>
            </Pressable>
          ) : openRow ? (
            <><T v="h2">{openRow.vehicleName}</T><T v="hint">{sinceText(openRow.start)}</T></>
          ) : <><T v="h2">No van</T><T v="hint">{me ? 'Your fleet manager gives you a van.' : 'Give them one below or from a van\'s page.'}</T></>}
          {canGive ? (picking ? <VanPicker m={member!} onDone={() => setPicking(false)} />
            : <Button small v={van ? 'secondary' : 'primary'} title={van ? 'Give a different van' : 'Give a van'} onPress={() => setPicking(true)} />) : null}
        </Card>
      ) : null}

      {r !== 'owner' ? (
        <Tabs value={tab} onChange={setTab} items={[['record', 'Record', null], ['tours', 'Tours', null], ['vans', 'Vans', rows.length || null]]} />
      ) : null}

      {tab === 'record' && r !== 'owner' && shown ? (
        <>
          {me && !s.staff ? <T v="hint">What your company keeps about you as a driver. Ask your fleet manager to correct anything that&apos;s wrong.</T> : null}
          <DriverRecordView m={shown} incidents={data.incidents} />
        </>
      ) : null}

      {tab === 'tours' && r !== 'owner' ? <Numbers uid={uid!} member={shown} data={data} history={rows} /> : null}

      {tab === 'vans' || r === 'owner' ? (
        <>
          <View style={{ gap: 8 }}>
            <T v="h2">Vans {me ? 'you' : 'they'} had</T>
            <T v="hint">{s.role === 'manager' && !me ? 'At your station, newest first. Kept for good.' : 'Newest first. Kept for good.'}</T>
            <Card><HistoryList rows={history.rows} error={history.error} show="van" empty={me ? 'You haven\'t had a van yet.' : 'No van yet.'} /></Card>
          </View>
          <Checks uid={uid!} me={me} />
        </>
      ) : null}

      {member && (rights.canEdit || rights.canRemove) ? (
        manage ? <Card><T v="h3">Manage {member.name}</T><ManagePerson m={member} onDone={() => router.back()} /><Button v="link" small title="Close" onPress={() => setManage(false)} /></Card>
          : <Button title={`Manage ${member.name}`} onPress={() => setManage(true)} />
      ) : null}
    </Screen>
  );
}

/** The last 30 days in numbers, then every tour. */
function Numbers({ uid, member, data, history }: { uid: string; member: Member | null; data: ReturnType<typeof useDriverData>; history: Assignment[] }) {
  const s = useSession();
  const c = useColors();
  const [all, setAll] = useState(false);
  const to = Date.now(), from = to - 30 * 86_400_000;
  const row = useMemo(() => driverRows({
    from, to, tours: data.tours || [], assignments: history, logs: data.logs || [], incidents: data.incidents || [], records: s.records,
    members: member ? [member] : null, vehicles: s.vehicles, details: s.details, costs: s.costs, videos: s.videos, walks: s.walks, stations: s.stations,
  }).find((x) => x.id === uid), [data.tours, data.logs, data.incidents, history, member, uid, s.records, s.vehicles, s.details, s.costs, s.videos, s.walks, s.stations, from, to]);
  const tours = data.tours || [];
  const shown = all ? tours : tours.slice(0, 12);
  const pct = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
  return (
    <View style={{ gap: 10 }}>
      <T v="h2">Last 30 days</T>
      {!s.org?.dashScans && !tours.length ? <Notice text="Tours come from dashboard photos at the start and end of each tour. The owner turns them on in the Account tab." /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper }}>
        <Num value={String(row?.tours ?? 0)} label="tours" />
        <Num value={row ? Math.round(row.km).toLocaleString() : '0'} label="km" />
        <Num value={row?.diesel != null ? per100Text(row.diesel, 'l').replace('/100 km', '') : row?.electric != null ? per100Text(row.electric, 'kwh').replace('/100 km', '') : '–'} label="per 100 km" />
        <Num value={pct(row?.vsModel ?? null)} label="vs others, same van" tone={row?.vsModel != null && row.vsModel > 0.08 ? c.alert : undefined} />
        <Num value={String(row?.damage ?? 0)} label="new damage while they had the van" />
        <Num value={String((row?.accidents ?? 0) + (row?.fines ?? 0) + (row?.complaints ?? 0))} label="incidents" />
      </View>
      <T v="small">
        Fuel from gauge photos is a rough figure per tour; the average over many tours is what counts. &quot;vs others&quot; compares with the other
        drivers of the same van model over the same kilometres{row && row.vsTours ? ` (${row.vsTours} tours)` : ''}. Damage counts every driver who had the van
        between the walk-around before and the one it was found in: who had it, not proof of who caused it.
      </T>
      <T v="h2">Tours</T>
      <Card>
        {data.tours == null ? <T v="hint">Loading…</T> : !tours.length ? <T v="hint">No tours yet.</T> : null}
        {shown.map((t, i) => (
          <Pressable key={t.id} onPress={() => router.push(`/vehicle/${t.vehicleId}`)} style={{ borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 8 : 0 }}>
            <TourLine t={t} show="van" />
          </Pressable>
        ))}
        {tours.length > shown.length ? <Button small v="link" title={`Show all ${tours.length}`} onPress={() => setAll(true)} /> : null}
      </Card>
      {tours.length ? <T v="small">{kmText(tours.reduce((n, t) => n + (t.km || 0), 0))} in all {tours.length} tours shown here.</T> : null}
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
      <T v="h2">Walk-arounds and checks</T>
      <T v="hint">The latest ones in the app{s.role === 'manager' && !me ? ' for your station' : ''}.</T>
      {checks.slice(0, 8).map((k) => {
        const dmg = approvedDamage(k).length;
        return (
          <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <Row>
              <T v="h3" style={{ flex: 1 }}>Check, {k.vehicleName}</T>
              <Pill v={k.status === 'reviewed' ? 'solid' : k.status === 'submitted' ? 'amber' : 'muted'} text={k.status === 'reviewed' ? `${dmg} approved damage${dmg === 1 ? '' : 's'}` : k.status === 'submitted' ? 'Waiting for review' : 'Close-ups pending'} />
            </Row>
            <T v="hint">{fmtWhen(k.createdAt)}</T>
          </Pressable>
        );
      })}
      {walks.slice(0, 8).map((w) => (
        <Pressable key={w.id} onPress={() => router.push(`/walk/${w.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
          <T v="h3">Walk-around, {w.vehicleName}</T>
          <T v="hint">{fmtWhen(w.createdAt)}, {w.taken} of {w.frames} photos</T>
        </Pressable>
      ))}
    </View>
  );
}
