import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

import { Button, Card, F, Field, MARKER, Notice, Pill, Plate, Row, Screen, Segmented, T, fmtWhen, useColors } from '@/components/ui';
import { addStation, deleteInvite, deleteStation, inviteUrl, renameStation, watchInvites, watchMembers } from '@/lib/people';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { ROLE_NAME, roleOf, type Assignment, type Invite, type Member, type Station } from '@/lib/types';
import { CHECK_MONTHS, driverDeadlines } from '@/lib/fleet';
import { fwd, t, tp } from '@/lib/i18n';

/**
 * Owners: stations, fleet managers and drivers of the whole company, and invite links for both roles.
 * Managers: the drivers of their station and driver invite links.
 */
export default function People() {
  const s = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId || s.mode !== 'firebase' || !s.staff) return;
    const a = watchMembers(orgId, setMembers, () => setErr(t('Couldn\'t load the people of this company.')));
    const b = watchInvites(orgId, setInvites, () => setErr(t('Couldn\'t load the invite links.')));
    return () => { a(); b(); };
  }, [orgId, s.mode, s.staff]);

  if (!s.staff) return <Screen><T v="h1">{t('People')}</T><Card dashed><T v="hint">{t('Only fleet managers and owners manage people.')}</T></Card></Screen>;
  const owner = s.role === 'owner';
  const stations = owner ? s.stations : s.myStations;
  const owners = (members || []).filter((m) => roleOf(m) === 'owner');

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">{t('People')}</T>
        <T v="hint">{owner ? t('Fleet managers and drivers of {company}, by station.', { company: s.org?.name || '' }) : t('The fleet managers and drivers of your station.')}</T>
      </View>
      {err ? <Notice tone="bad" text={err} /> : null}
      {stations.map((st) => (
        <StationPeople key={st.id} station={st} members={(members || []).filter((m) => (m.stationIds || []).includes(st.id) && roleOf(m) !== 'owner')}
          invites={invites.filter((i) => i.stationId === st.id)} />
      ))}
      {owner && owners.length ? (
        <View style={{ gap: 8 }}>
          <T v="h2">{t('Owners')}</T>
          <View style={{ gap: 6 }}>{owners.map((m) => <BossRow key={m.uid} m={m} label={t('Fleet owner')} />)}</View>
        </View>
      ) : null}
      {owner ? <Unassigned members={(members || []).filter((m) => roleOf(m) !== 'owner' && !(m.stationIds || []).some((id) => s.stations.some((st) => st.id === id)))} /> : null}
      {owner ? <Stations members={members || []} /> : null}
      {members ? <Former members={members} /> : null}
      {!members && !err ? <T v="hint">{t('Loading…')}</T> : null}
    </Screen>
  );
}

function Stations({ members }: { members: Member[] }) {
  const s = useSession();
  const c = useColors();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    if (!name.trim()) { setErr(t('Give the station a name.')); return; }
    setBusy(true); setErr(null);
    try { await addStation(s.org!.id, name, code); setAdding(false); setName(''); setCode(''); } catch { setErr(t('Couldn\'t add the station.')); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h3">{t('Manage stations')}</T>
      <T v="small">{t('Managers and drivers only see their own station.')}</T>
      {s.stations.map((st, i) => (
        <StationRow key={st.id} st={st} first={i === 0} vans={s.vehicles.filter((v) => v.stationId === st.id).length}
          people={members.filter((m) => (m.stationIds || []).includes(st.id)).length} />
      ))}
      {adding ? (
        <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
          <Field label={t('Station name')} value={name} onChangeText={setName} placeholder={t('For example: {example}', { example: 'Berlin Spandau' })} />
          <Field label={t('Station code')} hint={t('optional')} value={code} onChangeText={(x) => setCode(x.toUpperCase())} autoCapitalize="characters" placeholder={t('For example: {example}', { example: 'DBE1' })} />
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
          <Row><Button v="primary" small title={t('Add station')} loading={busy} onPress={add} /><Button v="link" small title={t('Cancel')} onPress={() => setAdding(false)} /></Row>
        </View>
      ) : <Button small title={t('Add a station')} onPress={() => setAdding(true)} />}
    </Card>
  );
}

function StationRow({ st, first, vans, people }: { st: Station; first: boolean; vans: number; people: number }) {
  const s = useSession();
  const c = useColors();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(st.name);
  const [code, setCode] = useState(st.code || '');
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const empty = !vans && !people;
  return (
    <View style={{ gap: 6, borderTopWidth: first ? 0 : 1, borderColor: c.rule, paddingTop: first ? 0 : 10 }}>
      {edit ? (
        <>
          <Field label={t('Name')} value={name} onChangeText={setName} />
          <Field label={t('Code')} hint={t('optional')} value={code} onChangeText={(x) => setCode(x.toUpperCase())} autoCapitalize="characters" />
          <Row>
            <Button small v="primary" title={t('Save')} onPress={async () => { try { await renameStation(s.org!.id, st.id, name, code); setEdit(false); } catch { setErr(t('Couldn\'t save.')); } }} />
            <Button small v="link" title={t('Cancel')} onPress={() => setEdit(false)} />
          </Row>
        </>
      ) : (
        <Row>
          <View style={{ flex: 1, minWidth: 140 }}>
            <T v="medium">{st.name}{st.code ? ` (${st.code})` : ''}</T>
            <T v="small">{t('{vans}, {people}', { vans: tp(vans, '{n} van', '{n} vans'), people: tp(people, '{n} person', '{n} people') })}</T>
          </View>
          <Button small v="link" title={t('Rename')} onPress={() => setEdit(true)} />
          {empty && s.stations.length > 1 ? (
            <Button small v="danger" title={armed ? t('Tap again') : t('Remove')} onPress={async () => {
              if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
              try { await deleteStation(s.org!.id, st.id); } catch { setErr(t('Couldn\'t remove the station.')); }
            }} />
          ) : null}
        </Row>
      )}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}

/**
 * One station: a heavy heading, then its fleet managers as dark badges and its drivers as light rows with the van
 * they have, so the two never look alike. Inviting more and who hands out the vans sit behind their own buttons.
 */
function StationPeople({ station, members, invites }: { station: Station; members: Member[]; invites: Invite[] }) {
  const s = useSession();
  const c = useColors();
  const owner = s.role === 'owner';
  const managers = members.filter((m) => roleOf(m) === 'manager');
  const drivers = members.filter((m) => roleOf(m) === 'driver').sort((a, b) => a.name.localeCompare(b.name));
  const vans = s.vehicles.filter((v) => v.stationId === station.id && !v.retired).length;
  return (
    <View style={{ gap: 12, marginTop: 8 }}>
      <View style={{ borderBottomWidth: 4, borderColor: c.ink, paddingBottom: 6, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: F.condBold, fontSize: 30, lineHeight: 33, color: c.ink, flexShrink: 1 }}>{station.name}</Text>
          {station.code ? <View style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 3, paddingHorizontal: 6 }}><Text style={{ fontFamily: F.cond, fontSize: 15, letterSpacing: 1, color: c.ink }}>{station.code}</Text></View> : null}
        </View>
        <T v="small">{[tp(managers.length, '{n} fleet manager', '{n} fleet managers'), tp(drivers.length, '{n} driver', '{n} drivers'), tp(vans, '{n} van', '{n} vans')].join(', ')}</T>
      </View>

      <View style={{ gap: 6 }}>
        <T v="h3">{t('Fleet managers')}</T>
        {managers.length ? managers.map((m) => <BossRow key={m.uid} m={m} label={t('Fleet manager')} />)
          : <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.ink2, borderRadius: 4, padding: 12 }}><T v="hint">{t('No fleet manager at {station} yet.', { station: station.name })}</T></View>}
        {owner ? <InviteToggle station={station} role="manager" invites={invites.filter((i) => i.role === 'manager')} /> : null}
      </View>

      <View style={{ gap: 6 }}>
        <T v="h3">{drivers.length ? t('Drivers ({n})', { n: drivers.length }) : t('Drivers')}</T>
        <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, gap: 10 }}>
          {drivers.length ? drivers.map((m, i) => <DriverRow key={m.uid} m={m} first={i === 0} />) : <T v="hint">{t('No drivers yet. Invite them with a link.')}</T>}
        </View>
        <InviteToggle station={station} role="driver" invites={invites.filter((i) => i.role === 'driver')} />
      </View>

      {s.runs(station.id) ? <SelfAssign station={station} /> : null}
    </View>
  );
}

/** Invite links behind a button: the panel opens when you want to invite someone. */
function InviteToggle({ station, role, invites }: { station: Station; role: 'manager' | 'driver'; invites: Invite[] }) {
  const [open, setOpen] = useState(false);
  const live = invites.filter((i) => !i.usedBy && i.expiresAt > Date.now()).length;
  return (
    <View style={{ gap: 8 }}>
      <Row>
        <Button small v={open ? 'primary' : 'secondary'} title={open ? t('Done inviting') : role === 'manager' ? t('Invite a fleet manager') : t('Invite drivers')} onPress={() => setOpen(!open)} />
        {live && !open ? <T v="small">{tp(live, '{n} open link', '{n} open links')}</T> : null}
      </Row>
      {open ? <InviteLinks station={station} role={role} invites={invites} /> : null}
    </View>
  );
}

/**
 * Whether drivers of this station pick up and drop off vans themselves (for DSPs that assign vans in Amazon's
 * tools and just tell drivers which one to take). Owners and the station's managers switch it; off by default.
 */
function SelfAssign({ station }: { station: Station }) {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = !!station.selfAssign;
  const set = async (next: boolean) => {
    if (next === on) return;
    setBusy(true); setErr(null);
    try { await ai.setSelfAssign({ orgId: s.org!.id, stationId: station.id, on: next }); }
    catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that.')); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 12, opacity: busy ? 0.6 : 1 }}>
      <T v="h3">{t('Who hands out the vans')}</T>
      <Segmented label={t('Who hands out the vans')} value={on ? 'drivers' : 'managers'} onChange={(k) => (busy ? null : set(k === 'drivers'))}
        options={[['managers', t('Fleet managers')], ['drivers', t('Drivers themselves')]]} />
      <T v="small">{on
        ? t('Drivers pick up and drop off the van they were told to take, with a video or photos. You can still give vans out.')
        : t('Only fleet managers give vans to drivers. Switch if you assign vans elsewhere, like Amazon\'s tools.')}
        {station.selfAssignBy ? ' ' + t('Changed by {name}, {when}.', { name: station.selfAssignBy, when: fmtWhen(station.selfAssignAt) }) : ''}</T>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}

/**
 * Invite links for one role at one station. Each link is for one person and works for 24 hours, so make
 * as many as people you're inviting and send each one to a different person.
 */
function InviteLinks({ station, role, invites }: { station: Station; role: 'manager' | 'driver'; invites: Invite[] }) {
  const s = useSession();
  const c = useColors();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const now = Date.now();
  const open = invites.filter((i) => !i.usedBy && i.expiresAt > now);
  const used = invites.filter((i) => i.usedBy).slice(0, 5);
  const make = async () => {
    setBusy(true); setErr(null);
    try { await ai.createInvite({ orgId: s.org!.id, role, stationId: station.id, count }); setCount(1); }
    catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t make the links.')); } finally { setBusy(false); }
  };
  const share = (i: Invite) => Share.share({
    message: role === 'manager'
      ? t('You\'re invited to join {company} in Fratius as a fleet manager at {station}. Open this link on your phone to create your account (it works once, until {until}): {link}', { company: s.org!.name, station: station.name, until: fmtWhen(i.expiresAt), link: inviteUrl(i.token) })
      : t('You\'re invited to join {company} in Fratius as a driver at {station}. Open this link on your phone to create your account (it works once, until {until}): {link}', { company: s.org!.name, station: station.name, until: fmtWhen(i.expiresAt), link: inviteUrl(i.token) }),
  }).catch(() => {});
  return (
    <View style={{ gap: 8, backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderStyle: 'dashed', borderRadius: 4, padding: 12 }}>
      <T v="small">{t('One link per person, sent to them. A link works once and expires after 24 hours.')}</T>
      {open.map((i, n) => (
        <View key={i.token} style={{ gap: 4, borderTopWidth: n ? 1 : 0, borderColor: c.rule, paddingTop: n ? 8 : 0 }}>
          <T v="small" selectable numberOfLines={1}>{inviteUrl(i.token)}</T>
          <Row>
            <Pill v="muted" text={t('Until {when}', { when: fmtWhen(i.expiresAt) })} />
            <Button small title={t('Share')} onPress={() => share(i)} />
            <Button small v="link" title={t('Cancel')} onPress={() => deleteInvite(i.token).catch(() => setErr(t('Couldn\'t cancel the link.')))} />
          </Row>
        </View>
      ))}
      <Row>
        <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: c.ink, borderRadius: 4, overflow: 'hidden' }}>
          <Button small v="link" title="–" onPress={() => setCount(Math.max(1, count - 1))} accessibilityLabel={t('Fewer links')} />
          <T v="h3" style={{ minWidth: 34, textAlign: 'center', alignSelf: 'center' }}>{count}</T>
          <Button small v="link" title="+" onPress={() => setCount(Math.min(20, count + 1))} accessibilityLabel={t('More links')} />
        </View>
        <Button small v="primary" title={role === 'manager' ? tp(count, 'Make a fleet manager link', 'Make {n} fleet manager links') : tp(count, 'Make a driver link', 'Make {n} driver links')} loading={busy} onPress={make} />
      </Row>
      {used.length ? <T v="small">{t('Used: {list}', { list: used.map((i) => `${i.usedByName || t('someone')} (${fmtWhen(i.usedAt)})`).join(', ') })}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/**
 * A fleet manager or owner: a dark badge with a yellow initials square, so the people in charge stand apart from
 * the drivers at a glance. Tap to open their page (Manage is there: role, station, removal).
 */
function BossRow({ m, label }: { m: Member; label: string }) {
  const s = useSession();
  const c = useColors();
  const me = m.uid === s.user?.uid;
  const van = s.vehicles.find((v) => !v.retired && v.assignedTo?.driverId === m.uid);
  const fg = c.paper, sub = c.dark ? '#565C66' : '#B9BEC7';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('{name}, {role}, open', { name: m.name, role: label })} onPress={() => router.push(`/person/${m.uid}`)}
      style={({ pressed }) => ({ backgroundColor: c.ink, borderRadius: 4, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 46, height: 46, borderRadius: 4, backgroundColor: MARKER, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.condBold, fontSize: 21, color: '#000' }}>{initials(m.name)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.cond, fontSize: 22, lineHeight: 25, color: fg }}>{me ? t('{name} (you)', { name: m.name }) : m.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 13, color: sub }}>{m.phone || label}</Text>
          {van ? <Plate small text={van.plate || van.name} /> : null}
        </View>
      </View>
      <Text style={{ fontFamily: F.cond, fontSize: 26, color: fg }}>{fwd()}</Text>
    </Pressable>
  );
}

/** A driver: a light row with a round initials badge and the plate of the van they have now. */
function DriverRow({ m, first }: { m: Member; first: boolean }) {
  const s = useSession();
  const c = useColors();
  const me = m.uid === s.user?.uid;
  const van = s.vehicles.find((v) => !v.retired && v.assignedTo?.driverId === m.uid);
  // The most pressing thing on their record (licence check, licence, safety briefing), if anything is due.
  const due = driverDeadlines(s.records.find((r) => r.id === m.uid), s.org?.licenceCheckMonths || CHECK_MONTHS).find((x) => x.state !== 'ok');
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: c.rule, paddingTop: first ? 0 : 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('{name}, {role}, open', { name: m.name, role: t('Driver') })} onPress={() => router.push(`/person/${m.uid}`)}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: c.ink2, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.cond, fontSize: 15, color: c.ink2 }}>{initials(m.name)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <T v="medium" numberOfLines={1}>{me ? t('{name} (you)', { name: m.name }) : m.name}</T>
            {van ? <Row gap={6}><Plate small text={van.plate || van.name} />{van.plate ? <T v="small" numberOfLines={1}>{van.name}</T> : null}</Row> : <T v="small">{t('No van')}</T>}
            {due ? <T v="small" color={due.state === 'overdue' ? c.alert : c.amber} numberOfLines={1}>{due.label}: {due.note}</T> : null}
          </View>
          <T v="h3" color={c.ink2}>{fwd()}</T>
        </Pressable>
      </View>
    </View>
  );
}

/** People who had vans here but have left the company. Their history stays; open them to see it. */
function Former({ members }: { members: Member[] }) {
  const s = useSession();
  const c = useColors();
  const rows = useMemo(() => {
    const here = new Set(members.map((m) => m.uid));
    const last = new Map<string, Assignment>();
    for (const a of s.assignments) if (!here.has(a.driverId) && (!last.has(a.driverId) || last.get(a.driverId)!.start < a.start)) last.set(a.driverId, a);
    return [...last.values()].sort((a, b) => (b.end || 0) - (a.end || 0));
  }, [members, s.assignments]);
  if (!rows.length) return null;
  return (
    <Card>
      <T v="h3">{t('Former people')}</T>
      <T v="hint">{t('They left the company. Their van history stays.')}</T>
      {rows.map((a, i) => (
        <Pressable key={a.driverId} onPress={() => router.push(`/person/${a.driverId}`)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 8 : 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="medium" numberOfLines={1}>{a.driverName}</T>
            <T v="small" numberOfLines={1}>{t('Last van: {van}, until {when}', { van: a.vehicleName, when: fmtWhen(a.end) })}</T>
          </View>
          <T v="h3" color={c.ink2}>{fwd()}</T>
        </Pressable>
      ))}
    </Card>
  );
}

function Unassigned({ members }: { members: Member[] }) {
  if (!members.length) return null;
  return (
    <Card>
      <T v="h3">{t('Not at a station')}</T>
      <T v="hint">{t('Open a person to put them at a station. Until then they see nothing.')}</T>
      {members.map((m, i) => (roleOf(m) === 'manager' ? <BossRow key={m.uid} m={m} label={t('Fleet manager')} /> : <DriverRow key={m.uid} m={m} first={i === 0} />))}
    </Card>
  );
}
