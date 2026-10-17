import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';

import { Button, Card, Chip, Field, Notice, Pill, Row, Screen, T, fmtWhen, useColors } from '@/components/ui';
import { addStation, deleteInvite, deleteStation, inviteUrl, removeMember, renameStation, setMember, watchInvites, watchMembers } from '@/lib/people';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { ROLE_NAME, roleOf, type Invite, type Member, type Station } from '@/lib/types';

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
    const a = watchMembers(orgId, setMembers, () => setErr('Couldn\'t load the people of this company.'));
    const b = watchInvites(orgId, setInvites, () => setErr('Couldn\'t load the invite links.'));
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
        <T v="hint">{owner ? 'Stations, fleet managers and drivers of ' + s.org?.name + '. People join with an invite link: one link per person, valid for 24 hours.' : 'Drivers of your station. Invite more with the links below: one link per person, valid for 24 hours.'}</T>
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

/** One station: its managers and drivers, and the links to invite more. */
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
          <InviteLinks station={station} role="manager" invites={invites.filter((i) => i.role === 'manager')} />
        </>
      ) : null}
      <T v="h3">Drivers</T>
      {drivers.length ? drivers.map((m, i) => <PersonRow key={m.uid} m={m} first={i === 0} />) : <T v="hint">No drivers yet.</T>}
      <InviteLinks station={station} role="driver" invites={invites.filter((i) => i.role === 'driver')} />
    </Card>
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
  const who = role === 'manager' ? 'fleet manager' : 'driver';
  const make = async () => {
    setBusy(true); setErr(null);
    try { await ai.createInvite({ orgId: s.org!.id, role, stationId: station.id, count }); setCount(1); }
    catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t make the links.'); } finally { setBusy(false); }
  };
  const share = (i: Invite, n: number) => Share.share({
    message: `You're invited to join ${s.org!.name} in Fleet Check as a ${who} at ${station.name}. Open this link on your phone to create your account (it works once, until ${fmtWhen(i.expiresAt)}): ${inviteUrl(i.token)}`,
  }).catch(() => {});
  return (
    <View style={{ gap: 8, backgroundColor: c.page, borderRadius: 4, padding: 10 }}>
      <T v="medium">Invite {role === 'manager' ? 'fleet managers' : 'drivers'}</T>
      <T v="small">One link per person. A link works once and expires after 24 hours.</T>
      {open.map((i, n) => (
        <View key={i.token} style={{ gap: 4, borderTopWidth: n ? 1 : 0, borderColor: c.rule, paddingTop: n ? 8 : 0 }}>
          <T v="small" selectable numberOfLines={1}>{inviteUrl(i.token)}</T>
          <Row>
            <Pill v="muted" text={`Until ${fmtWhen(i.expiresAt)}`} />
            <Button small title="Share" onPress={() => share(i, n)} />
            <Button small v="link" title="Cancel" onPress={() => deleteInvite(i.token).catch(() => setErr('Couldn\'t cancel the link.'))} />
          </Row>
        </View>
      ))}
      <Row>
        <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: c.ink, borderRadius: 4, overflow: 'hidden' }}>
          <Button small v="link" title="–" onPress={() => setCount(Math.max(1, count - 1))} accessibilityLabel="Fewer links" />
          <T v="h3" style={{ minWidth: 34, textAlign: 'center', alignSelf: 'center' }}>{count}</T>
          <Button small v="link" title="+" onPress={() => setCount(Math.min(20, count + 1))} accessibilityLabel="More links" />
        </View>
        <Button small v="primary" title={count === 1 ? `Make a ${who} link` : `Make ${count} ${who} links`} loading={busy} onPress={make} />
      </Row>
      {used.length ? <T v="small">Used: {used.map((i) => `${i.usedByName || 'someone'} (${fmtWhen(i.usedAt)})`).join(', ')}</T> : null}
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
          <T v="small" numberOfLines={1}>{[m.phone, m.transporterId ? `TID ${m.transporterId}` : '', m.email].filter(Boolean).join(', ')}</T>
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
