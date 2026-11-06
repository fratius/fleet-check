import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { DeleteAccount } from '@/components/deleteaccount';
import { LegalLinks } from '@/components/legal';
import { AllCompanies } from '@/components/companies';
import { LanguageLink } from '@/components/language';
import { AcceptTerms } from '@/components/terms';
import { Button, Card, Field, Notice, Row, Screen, Segmented, T, useColors } from '@/components/ui';
import { TERMS_VERSION, TRIAL_DAYS, signupIntent } from '@/lib/billing';
import { tokenFrom, watchMyJoinRequest, watchMyProfile } from '@/lib/people';
import { t } from '@/lib/i18n';
import { authMessage, useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import type { JoinRequest } from '@/lib/types';

export default function SignIn() {
  const s = useSession();
  const c = useColors();
  // From the website's "Sign up" button: straight to a new account, then to a new company.
  const [mode, setMode] = useState<'in' | 'up'>(signupIntent.signup ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [code, setCode] = useState('');
  const [station, setStation] = useState('');
  const [orgMode, setOrgMode] = useState<'create' | 'join'>(signupIntent.signup ? 'create' : 'join');
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setErr(null); setInfo(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };

  if (s.status === 'needsOrg') {
    return (
      <Screen>
        <View style={{ gap: 4, paddingTop: 12 }}>
          <T v="hint">{t('Signed in as {email}', { email: s.user?.email })}</T>
          <T v="h1">{t('Your company')}</T>
          <T>{t('Drivers and fleet managers: open the invite link you got from your manager or the fleet owner, or paste it here. Fleet owners: create your company.')}</T>
        </View>
        <LanguageLink />
        <Waiting />
        <Segmented label={t('Company')} value={orgMode} onChange={(k) => { setOrgMode(k); setErr(null); }} options={[['join', t('I have an invite link')], ['create', t('Create a company')]]} />
        <Card>
          {orgMode === 'create' ? (
            <>
              <Field label={t('Company name')} value={company} onChangeText={setCompany} autoCapitalize="words" placeholder={t('For example: Hart Logistics GmbH')} />
              <Field label={t('First station')} hint={t('you can add more later')} value={station} onChangeText={setStation} autoCapitalize="characters" placeholder={t('For example: DXX1 Berlin')} />
              <T v="hint">{t('You become the fleet owner. You add stations, fleet managers and drivers under People.')}</T>
              {/* Plans and payment live on the web only (the store apps don't sell anything, store/README.md). */}
              {Platform.OS === 'web' ? <T v="hint">{t('Your company starts with {n} days free.', { n: TRIAL_DAYS })}</T> : null}
              {TERMS_VERSION ? <AcceptTerms on={accepted} onChange={setAccepted} /> : null}
              <Button v="primary" wide title={t('Create company')} loading={busy}
                onPress={() => {
                  if (!company.trim()) return setErr(t('Enter your company name.'));
                  if (TERMS_VERSION && !accepted) return setErr(t('Accept the terms and the data processing agreement to create the company.'));
                  run(() => s.createOrg(company, station, accepted ? TERMS_VERSION : null));
                }} />
            </>
          ) : (
            <>
              <Field label={t('Invite link')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/…" />
              <Button v="primary" wide title={t('Continue')} loading={busy}
                onPress={() => { const tk = tokenFrom(code); if (tk) router.push({ pathname: '/join/[token]', params: { token: tk } }); else setErr(t('Paste the whole link you were sent.')); }} />
              <T v="small">{t('Drivers: the driver link of your company. Fleet managers: the invite link from the owner, which works once, for 24 hours.')}</T>
            </>
          )}
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        </Card>
        {s.creator ? <AllCompanies /> : null}
        <Button v="link" title={t('Sign out')} onPress={() => s.signOut()} />
        <DeleteAccount />
        <LegalLinks />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ gap: 6, paddingTop: 24 }}>
          <T v="h1">Fratius</T>
          <T>{t('Walk-around photos, van history and damage checks for your fleet.')}</T>
          {mode === 'up' && signupIntent.signup ? <T v="hint">{t('Create your account, then your company: {n} days free.', { n: TRIAL_DAYS })}</T> : null}
        </View>
        <LanguageLink />
        <Segmented label={t('Account')} value={mode} onChange={(k) => { setMode(k); setErr(null); setInfo(null); }} options={[['in', t('Sign in')], ['up', t('Create account')]]} />
        <Card>
          {mode === 'up' ? <Field label={t('Your name')} value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" /> : null}
          <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
          <Field label={t('Password')} value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'up' ? 'newPassword' : 'password'}
            onSubmitEditing={() => run(() => mode === 'in' ? s.signIn(email, password) : s.signUp(email, password, name))} />
          <Button v="primary" wide title={mode === 'in' ? t('Sign in') : t('Create account')} loading={busy}
            onPress={() => {
              if (!email.trim()) return setErr(t('Enter your email address.'));
              if (!password) return setErr(t('Enter your password.'));
              run(() => mode === 'in' ? s.signIn(email, password) : s.signUp(email, password, name));
            }} />
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
          {info ? <T v="hint">{info}</T> : null}
        </Card>
        {mode === 'in' ? (
          <Row><Button v="link" small title={t('Forgot your password?')} onPress={() => email.trim()
            ? run(async () => { await s.resetPassword(email); setInfo(t('Check your inbox for a link to set a new password.')); })
            : setErr(t('Enter your email address first.'))} /></Row>
        ) : null}
        {s.mode === 'local' ? <Notice text={t('Firebase isn\'t connected yet, so this app keeps everything on this phone.')} /> : null}
        <LegalLinks />
      </Screen>
    </KeyboardAvoidingView>
  );
}


/**
 * A driver who signed up with a company's link and waits for a fleet manager or the owner. Once approved, the company
 * opens by itself; if the request wasn't approved (or expired), they hear so and can ask again.
 */
function Waiting() {
  const s = useSession();
  const c = useColors();
  const uid = s.user?.uid;
  const [wait, setWait] = useState<{ orgId: string; orgName: string; stationName: string; at: number } | null>(null);
  const [orgName, setOrgName] = useState('');
  const [req, setReq] = useState<JoinRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const waitedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || s.mode !== 'firebase') return;
    return watchMyProfile(uid, (p) => {
      if (p.pendingJoin) { setWait(p.pendingJoin); setOrgName(p.pendingJoin.orgName); waitedFor.current = p.pendingJoin.orgId; }
      // Approved while this screen is open: the server swapped the waiting note for the company. Open it.
      const was = waitedFor.current;
      if (was && !p.pendingJoin && p.orgIds.includes(was)) { waitedFor.current = null; s.switchOrg(was); }
    });
  }, [uid, s.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const orgId = wait?.orgId;
  useEffect(() => (orgId && uid ? watchMyJoinRequest(orgId, uid, setReq) : undefined), [orgId, uid]);
  if (!wait && !req) return null;
  if (req && req.status !== 'pending') {
    if (req.status === 'approved' || req.status === 'withdrawn') return null;
    return <Notice tone="bad" text={req.status === 'rejected'
      ? t('Your request to join {company} wasn\'t approved. Talk to your fleet manager.', { company: orgName })
      : t('Nobody approved your request to join {company} in 14 days. Open the link from your fleet manager again.', { company: orgName })} />;
  }
  return (
    <Card>
      <T v="h3">{t('Waiting for approval')}</T>
      <T>{t('You asked to join {company} as a driver at {station}.', { company: wait?.orgName || orgName, station: req?.stationName || wait?.stationName || '' })}</T>
      <T v="hint">{t('A fleet manager of your station or the owner approves you. You get a notification, and Fratius opens your station once you\'re in.')}</T>
      <Row>
        <Button small v="link" title={t('Cancel my request')} loading={busy} onPress={async () => {
          setBusy(true); setErr(null);
          try { await ai.withdrawJoinRequest({ orgId: wait!.orgId }); setWait(null); setReq(null); }
          catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that.')); } finally { setBusy(false); }
        }} />
      </Row>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}
