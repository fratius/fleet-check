import Constants from 'expo-constants';
import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, View } from 'react-native';

import { AllCompanies, MyCompanies } from '@/components/companies';
import { DeleteAccount } from '@/components/deleteaccount';
import { LegalLinks } from '@/components/legal';
import { LanguageCard } from '@/components/language';
import { ViewAsCard } from '@/components/viewas';
import { RoutinesCard } from '@/components/routines';
import { Notifications } from '@/components/pickup';
import { Button, Card, Field, Notice, Pill, Row, Screen, Segmented, T, usd, useColors } from '@/components/ui';
import { tokenFrom } from '@/lib/people';
import { authMessage, useSession } from '@/lib/session';
import { ROLE_NAME, TIER_MODEL, TIER_NAME, perPhotoCost, type Tier } from '@/lib/types';
import { loc, t, tp } from '@/lib/i18n';
import { TERMS_VERSION, standing } from '@/lib/billing';
import { AcceptTerms } from '@/components/terms';
import { useOutbox } from '@/lib/outbox';

export default function Account() {
  const s = useSession();
  const c = useColors();
  const [armed, setArmed] = useState(false);
  // Uploads and changes of this person still waiting on this phone (they stay through a sign-out).
  const box = useOutbox();
  const unsent = box.jobs.filter((j) => j.uid === s.user?.uid && !box.done.has(j.id)).length;
  const projectId = (Constants.expoConfig?.extra as { firebase?: { projectId?: string } } | undefined)?.firebase?.projectId;
  // The app creator in a company they aren't a member of.
  const outside = s.creator && s.org && !s.companies.some((x) => x.id === s.org!.id);
  const roleName = outside ? t('App creator') : t(ROLE_NAME[s.role || 'driver']);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">{t('Account')}</T>
        {s.mode === 'firebase' ? <T v="hint">{s.user?.name}, {s.user?.email}</T> : <T v="hint">{t('Test mode on this phone')}</T>}
      </View>

      <Card>
        <T v="hint">{t('Company')}</T>
        <T v="h2">{s.org?.name}</T>
        <Row>
          <Pill v="solid" text={roleName} />
          {s.creator && !outside ? <Pill text={t('App creator')} /> : null}
          {s.viewAs && s.mode === 'firebase' ? <Pill v="amber" text={t('You, viewing as this role')} /> : null}
        </Row>
        <T v="hint">
          {s.role === 'owner' ? (s.stations.length === 1 ? t('You see and manage all of {station}.', { station: s.stations[0].name }) : tp(s.stations.length, 'You see and manage all {n} station.', 'You see and manage all {n} stations.'))
            : s.myStations.length ? t('Station: {stations}.', { stations: s.myStations.map((st) => st.name).join(', ') }) : t('Not at a station yet. Ask your fleet manager.')}
          {s.role === 'manager' ? ' ' + t('You approve or reject damage found at your station.') : ''}
          {s.role === 'driver' ? ' ' + t('You scan the vans of your station; your fleet manager reviews the damage checks.') : ''}
        </T>
      </Card>

      <TrialCard />
      <LanguageCard />
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
      {s.staff && s.mode === 'firebase' ? <RoutinesCard /> : null}

      {s.staff ? (
        <Card>
          <T v="h3">{t('AI model for checks')}</T>
          <T v="hint">{s.role === 'owner' ? t('Used for every type scan and damage check in this company.') : t('Set by the fleet owner for the whole company.')}{s.seesAiStats ? ' ' + t('Each run records its model, time and cost, so the test log can compare them.') : ''}</T>
          {(Object.keys(TIER_MODEL) as Tier[]).map((tier) => (
            <Pressable key={tier} accessibilityRole="radio" accessibilityState={{ checked: s.tier === tier }} disabled={s.role !== 'owner'} onPress={() => s.setTier(tier)}
              style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 2, borderColor: s.tier === tier ? c.ink : c.rule, borderRadius: 4, padding: 12, backgroundColor: s.tier === tier ? c.page : 'transparent', opacity: s.role !== 'owner' && s.tier !== tier ? 0.6 : 1 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                {s.tier === tier ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row><T v="h3">{t(TIER_NAME[tier])}</T><T v="hint">{TIER_MODEL[tier].name}</T></Row>
                <T v="hint">{t(s.seesAiStats ? TIER_MODEL[tier].note : TIER_MODEL[tier].plain)}</T>
                {s.seesAiStats ? <T v="small">{t('About {photo} per photo, so {check} for a 14-photo van check before close-ups.', { photo: usd(perPhotoCost(tier)), check: usd(perPhotoCost(tier) * 14) })}</T> : null}
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card>
        <T v="h3">{t('Setup')}</T>
        {s.mode === 'firebase'
          ? <T v="hint">{t('Connected to Firebase project {project}. Photos and results sync across phones and the web.', { project: projectId })}</T>
          : <Notice text={t('Test mode: everything stays on this phone and AI checks are off. Fleet, frames and the camera work.')} />}
        <T v="small">{versionLine()}</T>
      </Card>

      {s.mode === 'firebase' && unsent ? (
        <Notice text={tp(unsent, '{n} thing made on this phone isn\'t sent yet. If you sign out, it waits here and goes through when you sign in again on this phone.', '{n} things made on this phone aren\'t sent yet. If you sign out, they wait here and go through when you sign in again on this phone.')} />
      ) : null}
      {s.mode === 'firebase' ? (
        <Button v="danger" title={armed ? t('Tap again to sign out') : t('Sign out')} onPress={() => {
          if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
          s.signOut();
        }} />
      ) : null}
      {s.viewAs ? null : <DeleteAccount />}
      <LegalLinks />
    </Screen>
  );
}

/**
 * The company's free trial, for its owner, in the web app (plans and payment live on the web; the store apps don't
 * sell anything). The AI allowance per day is the server's (functions/src/billing.ts, AI_DAY).
 */
function TrialCard() {
  const s = useSession();
  if (Platform.OS !== 'web' || s.mode !== 'firebase' || s.role !== 'owner' || s.viewAs) return null;
  const st = standing(s.org);
  if ((st.standing !== 'trial' && st.standing !== 'trial_over') || !st.trialEnd) return null;
  const day = new Date(st.trialEnd).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });
  const left = Math.max(1, Math.ceil((st.trialEnd - Date.now()) / 86400_000));
  return (
    <Card>
      <T v="h3">{t('Free trial')}</T>
      <T>{st.standing === 'trial' ? tp(left, '{n} day left, until {day}.', '{n} days left, until {day}.', { day }) : t('The free trial ended on {day}.', { day })}</T>
      <T v="hint">{t('During the trial the AI does up to {checks} damage checks and {reads} other photo readings a day for the company.', { checks: 20, reads: 100 })}</T>
      <T v="hint">{t('Plans and payment are coming soon. Nothing is charged until you choose a plan.')}</T>
    </Card>
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
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); setOpen(false); setCode(''); setCompany(''); setStation(''); setAccepted(false); } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };
  if (!open) return <Button title={t('Join or create another company')} onPress={() => setOpen(true)} />;
  return (
    <Card>
      <T v="h3">{t('Another company')}</T>
      <Segmented label={t('Another company')} value={mode} onChange={(k) => { setMode(k); setErr(null); }} options={[['join', t('Invite link')], ['create', t('Create a company')]]} />
      {mode === 'join' ? (
        <>
          <Field label={t('Invite link')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/…" />
          <Button v="primary" title={t('Continue')} onPress={() => { const tk = tokenFrom(code); if (tk) router.push({ pathname: '/join/[token]', params: { token: tk } }); else setErr(t('Paste the whole link you were sent.')); }} />
        </>
      ) : (
        <>
          <Field label={t('Company name')} value={company} onChangeText={setCompany} autoCapitalize="words" />
          <Field label={t('First station')} hint={t('you can add more later')} value={station} onChangeText={setStation} autoCapitalize="characters" placeholder={t('For example: DXX1 Berlin')} />
          {TERMS_VERSION ? <AcceptTerms on={accepted} onChange={setAccepted} /> : null}
          <Button v="primary" title={t('Create company')} loading={busy} onPress={() => {
            if (!company.trim()) return setErr(t('Enter the company name.'));
            if (TERMS_VERSION && !accepted) return setErr(t('Accept the terms and the data processing agreement to create the company.'));
            run(() => s.createOrg(company, station, accepted ? TERMS_VERSION : null));
          }} />
        </>
      )}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title={t('Cancel')} onPress={() => setOpen(false)} />
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
        <T v="h3">{t('Demo account')}</T>
        <T v="hint">{t('This is a demo login in a company with made-up data. Whoever made the demo can start it over or remove it.')}</T>
      </Card>
    );
  }
  return (
    <Card dashed>
      <T v="h3">{t('Demo company')}</T>
      {inDemo ? (
        <>
          <T v="hint">{t('You\'re in the demo company. The photos are drawings and no AI was used. Removing it deletes everything in it, including the demo logins.')}</T>
          {logins.length ? (
            <View style={{ gap: 8, backgroundColor: c.page, borderRadius: 4, padding: 10 }}>
              <T v="medium">{t('Try it as someone else')}</T>
              <T v="small">{t('Two of the made-up people have real logins. Sign out and sign in with one, or use a private browser window so you stay signed in here.')}</T>
              {logins.map((l) => (
                <View key={l.uid} style={{ gap: 2 }}>
                  <T v="small">{l.role === 'driver' ? t('Driver: {name}', { name: l.name }) : t('Fleet manager: {name}', { name: l.name })}</T>
                  <T v="body" selectable>{l.email}</T>
                  <T v="body" selectable>{t('Password: {password}', { password: l.password })}</T>
                </View>
              ))}
            </View>
          ) : <T v="hint">{t('This demo was made before demo logins existed. Start it over to get a driver and a fleet manager you can sign in as.')}</T>}
          <Button title={again ? t('Tap again: everything in the demo is made new') : t('Start the demo over')} loading={busy} onPress={() => {
            if (!again) { setAgain(true); setTimeout(() => setAgain(false), 3000); return; }
            setAgain(false); go(() => s.openDemo(true));
          }} />
          <Button v="danger" title={armed ? t('Tap again to remove the demo company') : t('Remove the demo company')} loading={busy} onPress={() => {
            if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
            go(() => s.removeDemo());
          }} />
        </>
      ) : (
        <>
          <T v="hint">{t('Two stations, two fleet managers, eight drivers, twelve vans with drivers and history, damage checks in every state, a month of tours with fuel figures, refuels, driver records and incidents, to try things without touching your real fleet. Comes with a driver and a fleet manager login.')}</T>
          <Button title={t('Open the demo company')} loading={busy} onPress={() => go(() => s.openDemo())} />
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
    try { await s.setOrgSettings(patch); } catch { setErr(t('Couldn\'t save that. Check the connection.')); } finally { setBusy(false); }
  };
  return (
    <Card>
      <T v="h3">{t('Tours and driver records')}</T>
      <View style={{ gap: 6, opacity: busy ? 0.6 : 1 }}>
        <T v="medium">{t('Dashboard photos on every tour')}</T>
        <Segmented label={t('Dashboard photos')} value={on ? 'on' : 'off'} onChange={(k) => (owner && !busy ? set({ dashScans: k === 'on' }) : null)} options={[['off', t('Off')], ['on', t('On')]]} />
        <T v="small">
          {on ? t('Drivers photograph the dashboard when a tour starts and when it ends. The AI reads the odometer, fuel or battery and warning lights; the driver checks the numbers. You get kilometres and fuel per tour and per driver in the Data tab.')
            : t('When on, drivers photograph the dashboard at the start and end of each tour, for kilometres, fuel and warning lights per tour and per driver.')}
          {s.org?.dashScansBy ? ' ' + (s.org.dashScansAt ? t('Changed by {name}, {day}.', { name: s.org.dashScansBy, day: new Date(s.org.dashScansAt).toLocaleDateString(loc()) }) : t('Changed by {name}.', { name: s.org.dashScansBy })) : ''}
        </T>
        {owner && !on ? <T v="small" color={c.amber}>{t('Before you turn it on: this records how employees work. Tell your drivers what is recorded and why, and if the company has a works council (Betriebsrat), agree it with them first.')}</T> : null}
      </View>
      <View style={{ gap: 6, borderTopWidth: 1, borderColor: c.rule, paddingTop: 10, opacity: busy ? 0.6 : 1 }}>
        <T v="medium">{t('Check drivers\' licences every')}</T>
        <Segmented label={t('Licence check interval')} value={String(months)} onChange={(k) => (owner && !busy ? set({ licenceCheckMonths: Number(k) }) : null)} options={[['3', tp(3, '{n} month', '{n} months')], ['6', tp(6, '{n} month', '{n} months')], ['12', tp(12, '{n} month', '{n} months')]]} />
        <T v="small">{t('The next check shows on each driver\'s record and in Review. Every 6 months is common practice.')}</T>
      </View>
      {!owner ? <T v="small">{t('The fleet owner changes these.')}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}

/** "Version d81ff4b of Oct 25, 13:27, web app": the same on the phone and the web once both run the latest. */
function versionLine() {
  const b = (Constants.expoConfig?.extra as { build?: { sha?: string; at?: string } } | undefined)?.build;
  const at = b?.at ? new Date(b.at) : null;
  const when = at && !Number.isNaN(at.getTime())
    ? `${at.toLocaleDateString(loc(), { day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}` : '';
  const where = Platform.OS === 'web' ? t('web app') : Constants.appOwnership === 'expo' ? 'Expo Go' : t('phone app');
  const sha = b?.sha || t('unknown');
  const v = when ? t('version {sha} of {when}', { sha, when }) : t('version {sha}', { sha });
  return `Fratius ${Constants.expoConfig?.version || ''}, ${v}, ${where}`;
}
