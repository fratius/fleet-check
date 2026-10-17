import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';

import { Button, Card, Chip, Field, Notice, Pill, Row, Screen, T, useColors } from '@/components/ui';
import { addStation, createInvite, deleteInvite, deleteStation, removeMember, renameStation, setMember, watchInvites, watchMembers } from '@/lib/people';
import { useSession } from '@/lib/session';
import { ROLE_NAME, roleOf, type Invite, type Member, type Station } from '@/lib/types';

/**
 * Owners: stations, fleet managers and drivers of the whole company, and invite codes for both roles.
 * Managers: the drivers of their station and the driver invite code.
 */
export default function People() {
  const s = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId || s.mode !== 'firebase' || !s.staff) return;
    const a = watchMembers(orgId, setMembers, () => setErr('Couldn\'t load the people of this company.'));
    const b = watchInvites(orgId, setInvites, () => setErr('Couldn\'t load the invite codes.'));
    return () => { a(); b(); };
  }, [orgId, s.mode, s.staff]);

  if (!s.staff) return <Screen><T v="h1">People</T><Card dashed><T v="hint">Only fleet managers and owners manage people.</T></Card></Screen>;
  const owner = s.role === 'owner';
  const stations = owner ? s.stations : s.myStations;
  const owners = (members || []).filter((m) => roleOf(m) === 'owner');

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">People</T>
        <T v="hint">{owner ? 'Stations, fleet managers and drivers of ' + s.org?.name + '. People join with an invite code.' : 'Drivers of your station. They join with the invite code below.'}</T>
      </View>
      {err ? <Notice tone="bad" text={err} /> : null}
      {owner ? <Stations members={members || []} /> : null}
      {stations.map((st) => (
        <StationPeople key={st.id} station={st} members={(members || []).filter((m) => (m.stationIds || []).includes(st.id) && roleOf(m) !== 'owner')}
          invites={invites.filter((i) => i.stationId === st.id)} />
      ))}
      {owner && owners.length ? (
        <Card>
          <T v="h3">Owners</T>
          {owners.map((m, i) => <PersonRow key={m.uid} m={m} first={i === 0} />)}
        </Card>
      ) : null}
      {owner ? <Unassigned members={(members || []).filter((m) => roleOf(m) !== 'owner' && !(m.stationIds || []).some((id) => s.stations.some((st) => st.id === id)))} /> : null}
      {!members && !err ? <T v="hint">Loading…</T> : null}
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
    if (!name.trim()) { setErr('Give the station a name.'); return; }
    setBusy(true); setErr(null);
    try { await addStation(s.org!.id, name, code); setAdding(false); setName(''); setCode(''); } catch { setErr('Couldn\'t add the station.'); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h3">Stations ({s.stations.length})</T>
      <T v="hint">Each station has its own vans, fleet managers and drivers. Managers and drivers only see their station.</T>
      {s.stations.map((st, i) => (
        <StationRow key={st.id} st={st} first={i === 0} vans={s.vehicles.filter((v) => v.stationId === st.id).length}
          people={members.filter((m) => (m.stationIds || []).includes(st.id)).length} />
      ))}
      {adding ? (
        <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
          <Field label="Station name" value={name} onChangeText={setName} placeholder="For example: Berlin Spandau" />
          <Field label="Station code" hint="optional" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" placeholder="For example: DBE1" />
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
          <Row><Button v="primary" small title="Add station" loading={busy} onPress={add} /><Button v="link" small title="Cancel" onPress={() => setAdding(false)} /></Row>
        </View>
      ) : <Button small title="Add a station" onPress={() => setAdding(true)} />}
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
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Code" hint="optional" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
          <Row>
            <Button small v="primary" title="Save" onPress={async () => { try { await renameStation(s.org!.id, st.id, name, code); setEdit(false); } catch { setErr('Couldn\'t save.'); } }} />
            <Button small v="link" title="Cancel" onPress={() => setEdit(false)} />
          </Row>
        </>
      ) : (
        <Row>
          <View style={{ flex: 1, minWidth: 140 }}>
            <T v="medium">{st.name}{st.code ? ` (${st.code})` : ''}</T>
            <T v="small">{vans} van{vans === 1 ? '' : 's'}, {people} {people === 1 ? 'person' : 'people'}</T>
          </View>
          <Button small v="link" title="Rename" onPress={() => setEdit(true)} />
          {empty && s.stations.length > 1 ? (
            <Button small v="danger" title={armed ? 'Tap again' : 'Remove'} onPress={async () => {
              if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
              try { await deleteStation(s.org!.id, st.id); } catch { setErr('Couldn\'t remove the station.'); }
            }} />
          ) : null}
        </Row>
      )}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}

/** One station: its managers and drivers, and the codes to invite more. */
function StationPeople({ station, members, invites }: { station: Station; members: Member[]; invites: Invite[] }) {
  const s = useSession();
  const owner = s.role === 'owner';
  const managers = members.filter((m) => roleOf(m) === 'manager');
  const drivers = members.filter((m) => roleOf(m) === 'driver');
  return (
    <Card>
      <T v="h2">{station.name}</T>
      {owner ? (
        <>
          <T v="h3">Fleet managers</T>
          {managers.length ? managers.map((m, i) => <PersonRow key={m.uid} m={m} first={i === 0} />) : <T v="hint">No fleet manager yet.</T>}
          <CodeRow station={station} role="manager" invite={invites.find((i) => i.role === 'manager')} />
        </>
      ) : null}
      <T v="h3">Drivers</T>
      {drivers.length ? drivers.map((m, i) => <PersonRow key={m.uid} m={m} first={i === 0} />) : <T v="hint">No drivers yet.</T>}
      <CodeRow station={station} role="driver" invite={invites.find((i) => i.role === 'driver')} />
    </Card>
  );
}

function CodeRow({ station, role, invite }: { station: Station; role: 'manager' | 'driver'; invite?: Invite }) {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = role === 'manager' ? 'fleet managers' : 'drivers';
  const make = async () => {
    setBusy(true); setErr(null);
    try {
      if (invite) await deleteInvite(invite.code);
      await createInvite(s.org!, station, role, s.user!.uid);
    } catch { setErr('Couldn\'t make a code.'); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 6, backgroundColor: c.page, borderRadius: 4, padding: 10 }}>
      <T v="small">Invite code for {who} at {station.name}</T>
      {invite ? (
        <Row>
          <T v="big" selectable style={{ letterSpacing: 4, flex: 1 }}>{invite.code}</T>
          <Button small title="Share" onPress={() => Share.share({ message: `Join ${s.org!.name} in Fleet Check as a ${role === 'manager' ? 'fleet manager' : 'driver'} at ${station.name}. Sign up in the app and enter the code ${invite.code}.` }).catch(() => {})} />
          <Button small v="link" title="New code" loading={busy} onPress={make} />
        </Row>
      ) : <Button small v="primary" title={`Make a code for ${who}`} loading={busy} onPress={make} />}
      {invite ? <T v="small">Anyone with this code can join as a {role === 'manager' ? 'fleet manager' : 'driver'} here. A new code stops the old one.</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}

function PersonRow({ m, first }: { m: Member; first: boolean }) {
  const s = useSession();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = roleOf(m)!;
  const me = m.uid === s.user?.uid;
  const owner = s.role === 'owner';
  // Owners remove anyone but themselves; managers remove drivers of their station.
  const canRemove = !me && (owner || (r === 'driver' && (m.stationIds || []).some((id) => s.runs(id))));
  const canEdit = owner && !me;
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch { setErr('Couldn\'t save that change.'); } };
  return (
    <View style={{ gap: 6, borderTopWidth: first ? 0 : 1, borderColor: c.rule, paddingTop: first ? 0 : 8 }}>
      <Pressable disabled={!canEdit && !canRemove} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="medium" numberOfLines={1}>{m.name}{me ? ' (you)' : ''}</T>
          <T v="small" numberOfLines={1}>{m.email}</T>
        </View>
        <Pill v={r === 'owner' ? 'solid' : 'default'} text={ROLE_NAME[r]} />
        {canEdit || canRemove ? <T v="h3" color={c.ink2}>{open ? '–' : '+'}</T> : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 8, paddingBottom: 4 }}>
          {canEdit ? (
            <>
              <T v="small">Role</T>
              <Row>{(['owner', 'manager', 'driver'] as const).map((k) => <Chip key={k} text={ROLE_NAME[k]} on={r === k} onPress={() => act(() => setMember(s.org!.id, m.uid, { role: k }))} />)}</Row>
              {r !== 'owner' ? (
                <>
                  <T v="small">Station</T>
                  <Row>{s.stations.map((st) => <Chip key={st.id} text={st.name} on={(m.stationIds || []).includes(st.id)} onPress={() => act(() => setMember(s.org!.id, m.uid, { stationIds: [st.id] }))} />)}</Row>
                </>
              ) : null}
            </>
          ) : null}
          {canRemove ? (
            <Button small v="danger" title={armed ? 'Tap again to remove' : `Remove from ${s.org?.name}`} onPress={() => {
              if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
              act(() => removeMember(s.org!.id, m.uid));
            }} />
          ) : null}
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        </View>
      ) : null}
    </View>
  );
}

function Unassigned({ members }: { members: Member[] }) {
  if (!members.length) return null;
  return (
    <Card>
      <T v="h3">Not at a station</T>
      <T v="hint">Open a person to put them at a station. Until then they see nothing.</T>
      {members.map((m, i) => <PersonRow key={m.uid} m={m} first={i === 0} />)}
    </Card>
  );
}
