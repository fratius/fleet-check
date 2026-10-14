import Constants from 'expo-constants';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';

import { Button, Card, Notice, Pill, Row, Screen, T, usd, useColors } from '@/components/ui';
import { fb } from '@/lib/firebase';
import { useSession } from '@/lib/session';
import { TIER_MODEL, TIER_NAME, perPhotoCost, type Member, type Tier } from '@/lib/types';

export default function Account() {
  const s = useSession();
  const c = useColors();
  const admin = s.member?.role === 'admin';
  const [armed, setArmed] = useState(false);
  const projectId = (Constants.expoConfig?.extra as { firebase?: { projectId?: string } } | undefined)?.firebase?.projectId;

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">Account</T>
        {s.mode === 'firebase' ? <T v="hint">{s.user?.name}, {s.user?.email}</T> : <T v="hint">Test mode on this phone</T>}
      </View>

      <Card>
        <T v="hint">Company</T>
        <T v="h2">{s.org?.name}</T>
        <Row><Pill v={admin ? 'solid' : 'default'} text={admin ? 'Fleet manager' : 'Driver'} /></Row>
        {admin && s.org?.inviteCode ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.rule, paddingTop: 12 }}>
            <T v="medium">Invite code for drivers</T>
            <T v="big" selectable style={{ letterSpacing: 4 }}>{s.org.inviteCode}</T>
            <T v="hint">Drivers create an account in the app, then enter this code. They join as drivers. You can make someone a fleet manager below.</T>
            <Button small title="Share the code" onPress={() => Share.share({ message: `Join ${s.org!.name} in Fleet Check with the invite code ${s.org!.inviteCode}` }).catch(() => {})} />
          </View>
        ) : null}
      </Card>

      {admin && s.mode === 'firebase' && s.org ? <Members orgId={s.org.id} me={s.user?.uid || ''} /> : null}

      <Card>
        <T v="h3">AI model for checks</T>
        <T v="hint">Used for type scans and damage checks from this phone. Which one finds damage best is what the test log is for: each run records its model, time, cost and your right or wrong marks.</T>
        {(Object.keys(TIER_MODEL) as Tier[]).map((t) => (
          <Pressable key={t} accessibilityRole="radio" accessibilityState={{ checked: s.tier === t }} onPress={() => s.setTier(t)}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 2, borderColor: s.tier === t ? c.ink : c.rule, borderRadius: 4, padding: 12, backgroundColor: s.tier === t ? c.page : 'transparent' }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
              {s.tier === t ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row><T v="h3">{TIER_NAME[t]}</T><T v="hint">{TIER_MODEL[t].name}</T></Row>
              <T v="hint">{TIER_MODEL[t].note}</T>
              <T v="small">About {usd(perPhotoCost(t))} per photo, so {usd(perPhotoCost(t) * 14)} for a 14-photo van check before close-ups.</T>
            </View>
          </Pressable>
        ))}
      </Card>

      <Card>
        <T v="h3">Setup</T>
        {s.mode === 'firebase'
          ? <T v="hint">Connected to Firebase project {projectId}. Photos and results sync across phones and the web.</T>
          : <Notice text="Firebase isn't set up yet, so everything stays on this phone and AI checks are off. Fleet, frames and the camera work." />}
        <T v="small">Fleet Check {Constants.expoConfig?.version || ''}</T>
      </Card>

      {s.mode === 'firebase' ? (
        <Button v="danger" title={armed ? 'Tap again to sign out' : 'Sign out'} onPress={() => {
          if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
          s.signOut();
        }} />
      ) : null}
    </Screen>
  );
}

function Members({ orgId, me }: { orgId: string; me: string }) {
  const c = useColors();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const f = fb();
    if (!f) return;
    return onSnapshot(collection(f.db, 'orgs', orgId, 'members'),
      (snap) => setRows(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) })).sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1))),
      () => setErr('Couldn\'t load the people in this company.'));
  }, [orgId]);
  const setRole = async (m: Member, role: Member['role']) => {
    setErr(null);
    try { await updateDoc(doc(fb()!.db, 'orgs', orgId, 'members', m.uid), { role }); } catch { setErr('Couldn\'t change the role.'); }
  };
  return (
    <Card>
      <T v="h3">People{rows ? ` (${rows.length})` : ''}</T>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      {(rows || []).map((m, i) => (
        <View key={m.uid} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 10 : 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="medium" numberOfLines={1}>{m.name}{m.uid === me ? ' (you)' : ''}</T>
            <T v="small" numberOfLines={1}>{m.email}</T>
          </View>
          <Pill v={m.role === 'admin' ? 'solid' : 'default'} text={m.role === 'admin' ? 'Manager' : 'Driver'} />
          {m.uid !== me ? <Button v="link" small title={m.role === 'admin' ? 'Make driver' : 'Make manager'} onPress={() => setRole(m, m.role === 'admin' ? 'driver' : 'admin')} /> : null}
        </View>
      ))}
    </Card>
  );
}
