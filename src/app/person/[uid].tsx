import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { HistoryList, VanPicker, sinceText, useHistory } from '@/components/history';
import { BackBar } from '@/components/nav';
import { ManagePerson, manageRights } from '@/components/person';
import { Button, Card, Pill, Plate, Row, Screen, T, fmtWhen, useColors } from '@/components/ui';
import { watchMember } from '@/lib/people';
import { useSession } from '@/lib/session';
import { ROLE_NAME, approvedDamage, roleOf, type Member } from '@/lib/types';

/**
 * One person: their details, the van they have now, every van they had, and their walk-arounds and checks.
 * Owners see everyone, managers the people of their station, everyone sees their own page.
 */
export default function PersonScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const s = useSession();
  const c = useColors();
  const me = uid === s.user?.uid;
  const allowed = s.staff || me;
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [manage, setManage] = useState(false);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId || !uid || !allowed || s.mode !== 'firebase') return;
    if (me && s.member) { setMember(s.member); return; }
    return watchMember(orgId, uid, setMember, () => setMember(null));
  }, [orgId, uid, allowed, me, s.member, s.mode]);
  const history = useHistory({ driverId: uid });

  if (!allowed) return <Screen><BackBar title="Back" /><Card dashed><T v="hint">Only fleet managers and owners see other people.</T></Card></Screen>;
  if (s.mode !== 'firebase') return <Screen><BackBar title="Back" /><Card dashed><T v="hint">People and van history need the Firebase backend.</T></Card></Screen>;

  const rows = history.rows || [];
  const name = member?.name || rows[0]?.driverName || (me ? s.user?.name : '') || 'Unknown person';
  const r = member ? roleOf(member) : null;
  const van = s.vehicles.find((v) => !v.retired && v.assignedTo?.driverId === uid);
  const openRow = rows.find((a) => a.end == null);
  const walks = s.walks.filter((w) => w.createdBy === uid);
  const checks = s.checks.filter((k) => k.createdBy === uid);
  const rights = member ? manageRights(s, member) : { canEdit: false, canRemove: false };
  const canGive = !!member && !!r && r !== 'owner' && (member.stationIds || []).some((id) => s.runs(id));
  const stationNames = (member?.stationIds || []).map((id) => s.stationName(id)).join(', ');

  return (
    <Screen>
      <BackBar title="Back" />
      <View style={{ gap: 6 }}>
        <T v="h1">{name}{me ? ' (you)' : ''}</T>
        <Row>
          {r ? <Pill v={r === 'owner' ? 'solid' : 'default'} text={ROLE_NAME[r]} /> : null}
          {member === null ? <Pill v="muted" text="Left the company" /> : null}
          {stationNames ? <T v="hint">{stationNames}</T> : null}
        </Row>
        {member ? <T v="hint" selectable>{[member.phone, member.transporterId ? `Transporter ID ${member.transporterId}` : '', member.email].filter(Boolean).join(', ')}</T> : null}
        {member === undefined ? <T v="hint">Loading…</T> : null}
        {member === null ? <T v="hint">{name} is no longer in {s.org?.name}. Their van history, walk-arounds and checks stay.</T> : null}
      </View>

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

      <View style={{ gap: 8 }}>
        <T v="h2">Vans {me ? 'you' : 'they'} had</T>
        <T v="hint">{s.role === 'manager' && !me ? 'At your station, newest first. Kept for good.' : 'Newest first. Kept for good.'}</T>
        <Card><HistoryList rows={history.rows} error={history.error} show="van" empty={me ? 'You haven\'t had a van yet.' : 'No van yet.'} /></Card>
      </View>

      {walks.length || checks.length ? (
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
      ) : null}

      {member && (rights.canEdit || rights.canRemove) ? (
        manage ? <Card><T v="h3">Manage {member.name}</T><ManagePerson m={member} onDone={() => router.back()} /><Button v="link" small title="Close" onPress={() => setManage(false)} /></Card>
          : <Button title={`Manage ${member.name}`} onPress={() => setManage(true)} />
      ) : null}
    </Screen>
  );
}
