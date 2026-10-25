import Constants from 'expo-constants';
import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, View } from 'react-native';

import { AllCompanies, MyCompanies } from '@/components/companies';
import { ViewAsCard } from '@/components/viewas';
import { Notifications } from '@/components/pickup';
import { Button, Card, Field, Notice, Pill, Row, Screen, Segmented, T, usd, useColors } from '@/components/ui';
import { tokenFrom } from '@/lib/people';
import { authMessage, useSession } from '@/lib/session';
import { ROLE_NAME, TIER_MODEL, TIER_NAME, perPhotoCost, type Tier } from '@/lib/types';

export default function Account() {
  const s = useSession();
  const c = useColors();
  const [armed, setArmed] = useState(false);
  const projectId = (Constants.expoConfig?.extra as { firebase?: { projectId?: string } } | undefined)?.firebase?.projectId;
  // The app creator in a company they aren't a member of.
  const outside = s.creator && s.org && !s.companies.some((x) => x.id === s.org!.id);
  const roleName = outside ? 'App creator' : ROLE_NAME[s.role || 'driver'];

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">Account</T>
        {s.mode === 'firebase' ? <T v="hint">{s.user?.name}, {s.user?.email}</T> : <T v="hint">Test mode on this phone</T>}
      </View>

      <Card>
        <T v="hint">Company</T>
        <T v="h2">{s.org?.name}</T>
        <Row>
          <Pill v="solid" text={roleName} />
          {s.creator && !outside ? <Pill text="App creator" /> : null}
          {s.viewAs && s.mode === 'firebase' ? <Pill v="amber" text="You, viewing as this role" /> : null}
        </Row>
        <T v="hint">
          {s.role === 'owner' ? `You see and manage all ${s.stations.length === 1 ? 'of ' + s.stations[0].name : s.stations.length + ' stations'}.`
            : s.myStations.length ? `Station: ${s.myStations.map((st) => st.name).join(', ')}.` : 'Not at a station yet. Ask your fleet manager.'}
          {s.role === 'manager' ? ' You approve or reject damage found at your station.' : ''}
          {s.role === 'driver' ? ' You scan the vans of your station; your fleet manager reviews the damage checks.' : ''}
        </T>
      </Card>

      <Notifications />
      <ViewAsCard />
      {/* While viewing as someone, the company stays put: switch back to change it. */}
      {s.viewAs && s.mode === 'firebase' ? null : (
        <>
          <MyCompanies />
          {s.mode === 'firebase' ? <AddCompany /> : null}
          {s.mode === 'firebase' && (s.staff || s.creator) ? <Demo /> : null}
          {s.creator ? <AllCompanies /> : null}
        </>
      )}

      {s.staff ? <FleetSettings /> : null}

      {s.staff ? (
        <Card>
          <T v="h3">AI model for checks</T>
          <T v="hint">{s.role === 'owner' ? 'Used for every type scan and damage check in this company. ' : 'Set by the fleet owner for the whole company. '}{s.seesAiStats ? 'Each run records its model, time and cost, so the test log can compare them.' : ''}</T>
          {(Object.keys(TIER_MODEL) as Tier[]).map((t) => (
            <Pressable key={t} accessibilityRole="radio" accessibilityState={{ checked: s.tier === t }} disabled={s.role !== 'owner'} onPress={() => s.setTier(t)}
              style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 2, borderColor: s.tier === t ? c.ink : c.rule, borderRadius: 4, padding: 12, backgroundColor: s.tier === t ? c.page : 'transparent', opacity: s.role !== 'owner' && s.tier !== t ? 0.6 : 1 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                {s.tier === t ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row><T v="h3">{TIER_NAME[t]}</T><T v="hint">{TIER_MODEL[t].name}</T></Row>
                <T v="hint">{s.seesAiStats ? TIER_MODEL[t].note : TIER_MODEL[t].plain}</T>
                {s.seesAiStats ? <T v="small">About {usd(perPhotoCost(t))} per photo, so {usd(perPhotoCost(t) * 14)} for a 14-photo van check before close-ups.</T> : null}
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card>
        <T v="h3">Setup</T>
        {s.mode === 'firebase'
          ? <T v="hint">Connected to Firebase project {projectId}. Photos and results sync across phones and the web.</T>
          : <Notice text="Test mode: everything stays on this phone and AI checks are off. Fleet, frames and the camera work." />}
        <T v="small">{versionLine()}</T>
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

/** Join another company with a code, or start another one (fleet owners with several companies). */
function AddCompany() {
  const s = useSession();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [company, setCompany] = useState('');
  const [station, setStation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); setOpen(false); setCode(''); setCompany(''); setStation(''); } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };
  if (!open) return <Button title="Join or create another company" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <T v="h3">Another company</T>
      <Segmented label="Another company" value={mode} onChange={(k) => { setMode(k); setErr(null); }} options={[['join', 'Invite link'], ['create', 'Create a company']]} />
      {mode === 'join' ? (
        <>
          <Field label="Invite link" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/…" />
          <Button v="primary" title="Continue" onPress={() => { const t = tokenFrom(code); if (t) router.push({ pathname: '/join/[token]', params: { token: t } }); else setErr('Paste the whole link you were sent.'); }} />
        </>
      ) : (
        <>
          <Field label="Company name" value={company} onChangeText={setCompany} autoCapitalize="words" />
          <Field label="First station" hint="you can add more later" value={station} onChangeText={setStation} autoCapitalize="characters" placeholder="For example: DXX1 Berlin" />
          <Button v="primary" title="Create company" loading={busy} onPress={() => (company.trim() ? run(() => s.createOrg(company, station)) : setErr('Enter the company name.'))} />
        </>
      )}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title="Cancel" onPress={() => setOpen(false)} />
    </Card>
  );
}

/** A demo company with made-up data to try the app with. */
function Demo() {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const inDemo = !!s.org?.demo;
  const mine = inDemo && s.org?.createdBy === s.user?.uid;
  const logins = s.org?.demoLogins || [];
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); } };
  if (inDemo && !mine) {
    return (
      <Card dashed>
        <T v="h3">Demo account</T>
        <T v="hint">This is a demo login in a company with made-up data. Whoever made the demo can start it over or remove it.</T>
      </Card>
    );
  }
  return (
    <Card dashed>
      <T v="h3">Demo company</T>
      {inDemo ? (
        <>
          <T v="hint">You're in the demo company. The photos are drawings and no AI was used. Removing it deletes everything in it, including the demo logins.</T>
          {logins.length ? (
            <View style={{ gap: 8, backgroundColor: c.page, borderRadius: 4, padding: 10 }}>
              <T v="medium">Try it as someone else</T>
              <T v="small">Two of the made-up people have real logins. Sign out and sign in with one, or use a private browser window so you stay signed in here.</T>
              {logins.map((l) => (
                <View key={l.uid} style={{ gap: 2 }}>
                  <T v="small">{l.role === 'driver' ? 'Driver' : 'Fleet manager'}: {l.name}</T>
                  <T v="body" selectable>{l.email}</T>
                  <T v="body" selectable>Password: {l.password}</T>
                </View>
              ))}
            </View>
          ) : <T v="hint">This demo was made before demo logins existed. Start it over to get a driver and a fleet manager you can sign in as.</T>}
          <Button title={again ? 'Tap again: everything in the demo is made new' : 'Start the demo over'} loading={busy} onPress={() => {
            if (!again) { setAgain(true); setTimeout(() => setAgain(false), 3000); return; }
            setAgain(false); go(() => s.openDemo(true));
          }} />
          <Button v="danger" title={armed ? 'Tap again to remove the demo company' : 'Remove the demo company'} loading={busy} onPress={() => {
            if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
            go(() => s.removeDemo());
          }} />
        </>
      ) : (
        <>
          <T v="hint">Two stations, two fleet managers, eight drivers, twelve vans with drivers and history, damage checks in every state, a month of tours with fuel figures, driver records and incidents, to try things without touching your real fleet. Comes with a driver and a fleet manager login.</T>
          <Button title="Open the demo company" loading={busy} onPress={() => go(() => s.openDemo())} />
        </>
      )}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}

/**
 * Company settings for the fleet records (the owner changes them, managers see them): dashboard photos at the start
 * and end of each tour, and how often drivers' licences are checked.
 */
function FleetSettings() {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const owner = s.role === 'owner';
  const on = !!s.org?.dashScans;
  const months = s.org?.licenceCheckMonths || 6;
  const set = async (patch: Parameters<typeof s.setOrgSettings>[0]) => {
    setBusy(true); setErr(null);
    try { await s.setOrgSettings(patch); } catch { setErr('Couldn\'t save that. Check the connection.'); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h3">Tours and driver records</T>
      <View style={{ gap: 6, opacity: busy ? 0.6 : 1 }}>
        <T v="medium">Dashboard photos on every tour</T>
        <Segmented label="Dashboard photos" value={on ? 'on' : 'off'} onChange={(k) => (owner && !busy ? set({ dashScans: k === 'on' }) : null)} options={[['off', 'Off'], ['on', 'On']]} />
        <T v="small">
          {on ? 'Drivers photograph the dashboard when a tour starts and when it ends. The AI reads the odometer, fuel or battery and warning lights; the driver checks the numbers. You get kilometres and fuel per tour and per driver in the Data tab.'
            : 'When on, drivers photograph the dashboard at the start and end of each tour, for kilometres, fuel and warning lights per tour and per driver.'}
          {s.org?.dashScansBy ? ` Changed by ${s.org.dashScansBy}${s.org.dashScansAt ? `, ${new Date(s.org.dashScansAt).toLocaleDateString()}` : ''}.` : ''}
        </T>
        {owner && !on ? <T v="small" color={c.amber}>Before you turn it on: this records how employees work. Tell your drivers what is recorded and why, and if the company has a works council (Betriebsrat), agree it with them first.</T> : null}
      </View>
      <View style={{ gap: 6, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10, opacity: busy ? 0.6 : 1 }}>
        <T v="medium">Check drivers&apos; licences every</T>
        <Segmented label="Licence check interval" value={String(months)} onChange={(k) => (owner && !busy ? set({ licenceCheckMonths: Number(k) }) : null)} options={[['3', '3 months'], ['6', '6 months'], ['12', '12 months']]} />
        <T v="small">The next check shows on each driver&apos;s record and in Review. Every 6 months is common practice.</T>
      </View>
      {!owner ? <T v="small">The fleet owner changes these.</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}

/** "Version d81ff4b of Oct 25, 13:27, web app": the same on the phone and the web once both run the latest. */
function versionLine() {
  const b = (Constants.expoConfig?.extra as { build?: { sha?: string; at?: string } } | undefined)?.build;
  const at = b?.at ? new Date(b.at) : null;
  const when = at && !Number.isNaN(at.getTime())
    ? `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '';
  const where = Platform.OS === 'web' ? 'web app' : Constants.appOwnership === 'expo' ? 'Expo Go' : 'phone app';
  return `Fleet Check ${Constants.expoConfig?.version || ''}, version ${b?.sha || 'unknown'}${when ? ` of ${when}` : ''}, ${where}`;
}
