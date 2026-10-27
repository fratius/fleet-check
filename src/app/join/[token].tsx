import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';

import { LanguageLink } from '@/components/language';
import { Button, Card, Field, Notice, Pill, Row, Screen, Segmented, T, fmtWhen, useColors } from '@/components/ui';
import { t, tj } from '@/lib/i18n';
import { canPromptInstall, device, onInstallChange, promptInstall } from '@/lib/install';
import { authMessage, useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { ROLE_NAME, type InvitePeek } from '@/lib/types';

/**
 * Where an invite link lands: who invited you and to what, your details, an account, then how to put the
 * app on your home screen. Each link works for one person within 24 hours.
 */
export default function Join() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const s = useSession();
  const c = useColors();
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [tid, setTid] = useState('');
  const [mode, setMode] = useState<'up' | 'in'>('up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ orgName: string; role: string; stationName: string } | null>(null);

  useEffect(() => {
    let live = true;
    if (s.mode !== 'firebase') { setPeek({ status: 'missing' }); return; }
    ai.peekInvite({ token: String(token || '') }).then((p) => { if (live) setPeek(p); }).catch(() => { if (live) setPeek({ status: 'missing' }); });
    return () => { live = false; };
  }, [token, s.mode]);

  const signedIn = s.status === 'ready' || s.status === 'needsOrg';
  useEffect(() => {
    if (!signedIn || !s.user) return;
    const parts = (s.user.name || '').split(' ');
    if (!first && parts[0] && !s.user.name.includes('@')) setFirst(parts[0]);
    if (!last && parts.length > 1) setLast(parts.slice(1).join(' '));
  }, [signedIn, s.user]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    setErr(null);
    if (!first.trim() || !last.trim()) { setErr(t('Enter your first and last name.')); return; }
    if (!signedIn) {
      if (!email.trim()) { setErr(t('Enter your email address.')); return; }
      if (password.length < 6) { setErr(t('Use at least 6 characters for the password.')); return; }
    }
    setBusy(true);
    try {
      if (!signedIn) {
        if (mode === 'up') await s.signUp(email, password, `${first.trim()} ${last.trim()}`);
        else await s.signIn(email, password);
      }
      const r = await s.joinWithLink(String(token), { firstName: first, lastName: last, phone, transporterId: tid });
      setDone(r);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : authMessage(e));
    } finally { setBusy(false); }
  };

  const role = (peek?.role || 'driver') as 'driver' | 'manager';
  const header = (
    <View style={{ gap: 6, paddingTop: 16 }}>
      <T v="hint">Fratius</T>
      <T v="h1">{done ? t('You\'re in {company}', { company: done.orgName }) : peek?.status === 'ok' || peek?.status === 'mine' ? t('Join {company}', { company: peek.orgName }) : t('Invite link')}</T>
      <LanguageLink />
    </View>
  );

  if (!peek) return <Screen>{header}<ActivityIndicator color={c.ink} style={{ alignSelf: 'flex-start' }} /></Screen>;

  if (done) {
    return (
      <Screen>
        {header}
        <Card>
          <T>{done.role === 'manager' ? t('You joined as a fleet manager at {station}.', { station: done.stationName }) : t('You joined as a driver at {station}.', { station: done.stationName })}</T>
          {done.role === 'driver' ? <T v="hint">{t('You\'ll see the vans of your station. Scan a van before and after your route; your fleet manager reviews any damage.')}</T> : null}
        </Card>
        <Install />
        <Button v="primary" wide title={t('Open Fratius')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (peek.status !== 'ok' && peek.status !== 'mine') {
    const why = peek.status === 'used' ? t('This link was already used. Each link works for one person.')
      : peek.status === 'expired' ? t('This link has expired. Links work for 24 hours.')
        : t('This link doesn\'t exist or was cancelled.');
    const ask = peek.invitedBy ? t('Ask {name} for a new one.', { name: peek.invitedBy }) : t('Ask your fleet manager for a new one.');
    return (
      <Screen>
        {header}
        <Notice tone="bad" text={`${why} ${ask}`} />
        <Button title={signedIn ? t('Open Fratius') : t('Sign in')} onPress={() => router.replace(signedIn ? '/' : '/sign-in')} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        {header}
        <Card>
          <T>{tj(peek.invitedBy
            ? (role === 'manager' ? '{name} invited you to join {company} as a fleet manager at {station}.' : '{name} invited you to join {company} as a driver at {station}.')
            : (role === 'manager' ? 'You\'re invited to join {company} as a fleet manager at {station}.' : 'You\'re invited to join {company} as a driver at {station}.'),
          { name: peek.invitedBy || '', company: <T key="c" v="medium">{peek.orgName}</T>, station: <T key="s" v="medium">{peek.stationName}</T> })}</T>
          <Row><Pill text={t(ROLE_NAME[role])} /><Pill v="muted" text={t('Link works until {when}', { when: fmtWhen(peek.expiresAt) })} /></Row>
        </Card>

        <Card>
          <T v="h3">{t('1. Your details')}</T>
          <Field label={t('First name')} value={first} onChangeText={setFirst} autoCapitalize="words" textContentType="givenName" />
          <Field label={t('Last name')} value={last} onChangeText={setLast} autoCapitalize="words" textContentType="familyName" />
          <Field label={t('Mobile number')} hint={t('so your manager can reach you')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+49 170 1234567" />
          {role === 'driver' ? <Field label="Amazon Transporter ID" hint={t('optional')} value={tid} onChangeText={(x) => setTid(x.toUpperCase())} autoCapitalize="characters" autoCorrect={false} /> : null}
        </Card>

        <Card>
          <T v="h3">{t('2. Your account')}</T>
          {signedIn ? (
            <>
              <T>{t('Signed in as {email}. You\'ll join with this account.', { email: s.user?.email })}</T>
              <Row><Button small v="link" title={t('Use another account')} onPress={() => s.signOut()} /></Row>
            </>
          ) : (
            <>
              <Segmented label={t('Account')} value={mode} onChange={(k) => { setMode(k); setErr(null); }} options={[['up', t('New account')], ['in', t('I have one')]]} />
              <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
              <Field label={t('Password')} hint={mode === 'up' ? t('at least 6 characters') : undefined} value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'up' ? 'newPassword' : 'password'} />
            </>
          )}
        </Card>

        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        <Button v="primary" wide title={t('Join {company}', { company: peek.orgName })} loading={busy} onPress={join} />
        <T v="small">{t('You can install the app on your phone in the next step.')}</T>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** How to put the web app on the home screen, for the phone being used. */
function Install() {
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  const d = device();
  if (d === 'native' || d === 'installed') return null;
  return (
    <Card>
      <T v="h3">{t('Install the app')}</T>
      {d === 'ios' ? (
        <>
          <T>{t('1. Tap the Share button at the bottom of Safari (the square with an arrow).')}</T>
          <T>{tj('2. Tap {add}, then {ok}.', { add: <T key="a" v="medium">{t('Add to Home Screen')}</T>, ok: <T key="o" v="medium">{t('Add')}</T> })}</T>
          <T>{t('3. Open Fratius from your home screen and sign in with the same email and password.')}</T>
          <T v="small">{t('Use Safari: other browsers on iPhone can\'t add apps to the home screen.')}</T>
        </>
      ) : d === 'android' ? (
        canPromptInstall()
          ? <><T>{t('Put Fratius on your home screen like any other app.')}</T><Button v="primary" title={t('Install the app')} onPress={() => promptInstall()} /></>
          : <><T>{t('1. In Chrome, tap the menu (three dots, top right).')}</T><T>{tj('2. Tap {install} or {add}.', { install: <T key="i" v="medium">{t('Install app')}</T>, add: <T key="a" v="medium">{t('Add to Home screen')}</T> })}</T><T>{t('3. Open Fratius from your home screen and sign in.')}</T></>
      ) : (
        <T>{t('Open this page on your phone to install the app there, or keep using it in this browser.')}</T>
      )}
    </Card>
  );
}
