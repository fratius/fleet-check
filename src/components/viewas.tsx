import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Card, Chip, F, MARKER, Pill, Row, T, useColors } from '@/components/ui';
import { authMessage, useSession } from '@/lib/session';
import { ROLE_NAME, type Role } from '@/lib/types';

/** What each role sees and can do (the full rules are in ROLES.md). */
const ACCESS: Record<Role | 'creator', string> = {
  creator: 'Every company in the app. Opens and manages any of them.',
  owner: 'Every station of this company. Adds and removes stations, managers, drivers and vans, moves them between stations, picks the AI model, reviews damage anywhere and sees all history.',
  manager: 'One station: its vans and drivers, invite links for drivers, who drives which van and whether drivers pick up vans themselves. Final word on damage. Sees the station\'s history and videos.',
  driver: 'The vans of one station. Walk-arounds with photos or a video, the AI damage check and close-ups, sends checks to the manager. Picks up and drops off vans where the station allows it. Sees only their own history and videos.',
};

/**
 * App creator only (and test mode): view the open company as a fleet owner, fleet manager or driver. The server and
 * the access rules treat you as that role, so you see exactly what they see and can do exactly what they can.
 */
export function ViewAsCard() {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Role | null>(null);
  if (!s.canViewAs) return null;
  const current: Role | 'creator' = s.viewAs ? s.viewAs.role : s.mode === 'local' ? s.role || 'owner' : 'creator';
  const stations = s.stations;
  const go = async (role: Role | null, st?: string) => {
    const key = role ? `${role}:${st || ''}` : 'me';
    setBusy(key); setErr(null);
    try { await s.setViewAs(role, st); setPick(null); } catch (e) { setErr(authMessage(e)); } finally { setBusy(null); }
  };
  const choose = (k: Role | 'creator') => {
    setErr(null);
    if (k === 'creator') { if (s.viewAs) go(null); return; }
    if (k === 'owner') { if (current !== 'owner') go('owner'); return; }
    // Fleet managers and drivers work at one station: with one station there's nothing to choose.
    if (stations.length === 1) { go(k, stations[0].id); return; }
    setPick(pick === k ? null : k);
  };
  const options: (Role | 'creator')[] = s.mode === 'local' ? ['owner', 'manager', 'driver'] : ['creator', 'owner', 'manager', 'driver'];
  return (
    <Card>
      <Row><T v="h3" style={{ flex: 1 }}>View the app as</T><Pill v="solid" text={s.mode === 'local' ? 'Test mode' : 'Only you'} /></Row>
      <T v="hint">
        {s.mode === 'local' ? 'See the app the way each role sees it.'
          : `See ${s.org?.name || 'this company'} exactly as a fleet owner, fleet manager or driver does: the same screens and the same access, checked by the server. Only the app creator has this switch.`}
      </T>
      {options.map((k) => {
        const on = k === current;
        const stationOn = on && s.viewAs?.st ? s.stationName(s.viewAs.st) : null;
        return (
          <View key={k} style={{ gap: 8 }}>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} disabled={!!busy} onPress={() => choose(k)}
              style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 2, borderColor: on ? c.ink : c.rule, borderRadius: 4, padding: 12, backgroundColor: on ? c.page : 'transparent' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row>
                  <T v="h3">{k === 'creator' ? 'Yourself (app creator)' : ROLE_NAME[k]}</T>
                  {stationOn ? <T v="hint">{stationOn}</T> : null}
                  {busy && busy.startsWith(k === 'creator' ? 'me' : k) ? <ActivityIndicator color={c.ink} /> : null}
                </Row>
                <T v="hint">{ACCESS[k]}</T>
              </View>
            </Pressable>
            {pick === k ? (
              <View style={{ gap: 6, paddingLeft: 12 }}>
                <T v="small">Which station?</T>
                <Row>
                  {stations.map((st) => (
                    <Chip key={st.id} text={st.name} on={on && s.viewAs?.st === st.id} onPress={() => go(k, st.id)} />
                  ))}
                </Row>
              </View>
            ) : null}
          </View>
        );
      })}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      {s.mode === 'firebase' ? (
        <T v="small">
          What you do while viewing is real and saved under your name in {s.org?.name}: a walk-around, a video, a pick-up (it goes
          into the van's permanent history), a review, an invite link. To try things out, switch back to yourself, open the demo
          company, then view it as someone. As a driver you aren't on the people list, so nobody can give you a van: pick one up
          yourself where the station allows it.
        </T>
      ) : null}
    </Card>
  );
}

/** A strip above the tab bar while the app creator views the app as someone else, with the way back. */
export function ViewingStrip() {
  const s = useSession();
  const [busy, setBusy] = useState(false);
  if (!s.viewAs) return null;
  const who = `${ROLE_NAME[s.viewAs.role]}${s.viewAs.st ? `, ${s.stationName(s.viewAs.st)}` : ''}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: MARKER, paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 2, borderColor: '#000' }}>
      <Pressable accessibilityRole="link" onPress={() => router.navigate('/account')} style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 14, color: '#000' }}>Viewing as <Text style={{ fontFamily: F.semi }}>{who}</Text></Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={async () => { setBusy(true); try { await s.setViewAs(null); } finally { setBusy(false); } }}
        style={({ pressed }) => ({ borderWidth: 2, borderColor: '#000', borderRadius: 4, paddingHorizontal: 10, minHeight: 34, justifyContent: 'center', opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}>
        <Text style={{ fontFamily: F.cond, fontSize: 16, color: '#000' }}>{busy ? 'Switching…' : s.mode === 'local' ? 'Back' : 'Back to me'}</Text>
      </Pressable>
    </View>
  );
}
