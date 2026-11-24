import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, View } from 'react-native';

import { LanguageLink } from '@/components/language';
import { Button, Card, Field, Notice, Pill, Row, Screen, Segmented, T, fmtWhen, useColors } from '@/components/ui';
import { lang, t, tj } from '@/lib/i18n';
import { device } from '@/lib/install';
import { inviteUrl, loadWebUrl } from '@/lib/people';
import { authMessage, useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { APP_STORE, GOOGLE_PLAY, androidUrl, appTarget } from '@/lib/stores';
import { ROLE_NAME, type InvitePeek } from '@/lib/types';

/**
 * Where an invite link lands: who invited you and to what, your details, an account, then how to put the
 * app on your home screen. Each link works for one person within 24 hours.
 * The company's driver link lands here too (CompanyJoin): the driver picks their station and asks to join; a fleet
 * manager of that station or an owner approves them.
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
  if (peek.kind === 'company') return <CompanyJoin token={String(token || '')} peek={peek} onPeek={setPeek} />;

  if (done) {
    return (
      <Screen>
        {header}
        <Card>
          <T>{done.role === 'manager' ? t('You joined as a fleet manager at {station}.', { station: done.stationName }) : t('You joined as a driver at {station}.', { station: done.stationName })}</T>
          {done.role === 'driver' ? <T v="hint">{t('You\'ll see the vans of your station. Scan a van before and after your route; your fleet manager reviews any damage.')}</T> : null}
        </Card>
        <GetApp />
        <Button v={device() === 'native' || device() === 'installed' ? 'primary' : 'secondary'} wide title={t('Continue in the browser')} onPress={() => router.replace('/')} />
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

/**
 * The company's driver link: pick your station, your details and an account, then wait. Until a fleet manager or the
 * owner approves, the person isn't in the company and sees nothing of it.
 */
function CompanyJoin({ token, peek, onPeek }: { token: string; peek: InvitePeek; onPeek: (p: InvitePeek) => void }) {
  const s = useSession();
  const c = useColors();
  const stations = peek.stations || [];
  const [station, setStation] = useState<string | null>(stations.length === 1 ? stations[0].id : null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [mode, setMode] = useState<'up' | 'in'>('up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const signedIn = s.status === 'ready' || s.status === 'needsOrg';
  useEffect(() => {
    if (!signedIn || !s.user) return;
    const parts = (s.user.name || '').split(' ');
    if (!first && parts[0] && !s.user.name.includes('@')) setFirst(parts[0]);
    if (!last && parts.length > 1) setLast(parts.slice(1).join(' '));
  }, [signedIn, s.user]); // eslint-disable-line react-hooks/exhaustive-deps
  // Signed in after the page opened: ask again whether this account already asked or is in the company.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    ai.peekInvite({ token }).then((p) => { if (live && p.status !== peek.status) onPeek(p); }).catch(() => {});
    return () => { live = false; };
  }, [signedIn, s.user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setErr(null); setInfo(null);
    if (busy) return;
    if (!station) { setErr(t('Pick your station.')); return; }
    if (!first.trim() || !last.trim()) { setErr(t('Enter your first and last name.')); return; }
    if (!signedIn) {
      if (!email.trim()) { setErr(t('Enter your email address.')); return; }
      if (password.length < 6) { setErr(t('Use at least 6 characters for the password.')); return; }
    }
    setBusy(true);
    try {
      if (!signedIn) {
        if (mode === 'up') {
          await s.signUp(email, password, `${first.trim()} ${last.trim()}`).catch((e) => {
            // The email has an account already (a driver who signed up before): switch to signing in, the email kept.
            if ((e as { code?: string })?.code === 'auth/email-already-in-use') { setMode('in'); setPassword(''); }
            throw e;
          });
        } else await s.signIn(email, password);
      }
      // Name, email and password are enough (product owner, 2026-11-24): no phone number or Transporter ID.
      const r = await ai.requestToJoin({ token, stationId: station, details: { firstName: first, lastName: last }, lang: lang() });
      onPeek({ ...peek, status: 'pending', stationName: r.stationName, requestedAt: Date.now() });
    } catch (e) {
      setErr(e instanceof AiError ? e.message : authMessage(e));
    } finally { setBusy(false); }
  };
  // Forgot the password: the reset email's link comes back to this driver link.
  const forgot = async () => {
    setErr(null); setInfo(null);
    if (!email.trim()) { setErr(t('Enter your email address first.')); return; }
    setBusy(true);
    try {
      await s.resetPassword(email, await linkBack(token));
      setInfo(t('Check your inbox for a link to set a new password.'));
    } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  };

  const header = (
    <View style={{ gap: 6, paddingTop: 16 }}>
      <T v="hint">Fratius</T>
      <T v="h1">{peek.status === 'pending' ? t('Request sent') : t('Join {company}', { company: peek.orgName || '' })}</T>
      <LanguageLink />
    </View>
  );

  if (peek.status === 'replaced' || peek.status === 'member') {
    return (
      <Screen>
        {header}
        <Notice tone={peek.status === 'member' ? undefined : 'bad'} text={peek.status === 'member'
          ? t('You\'re already in {company}.', { company: peek.orgName || '' })
          : t('This link was replaced by a new one. Ask your fleet manager for the new link.')} />
        <Button title={signedIn ? t('Open Fratius') : t('Sign in')} onPress={() => router.replace(signedIn ? '/' : '/sign-in')} />
      </Screen>
    );
  }

  if (peek.status === 'pending') {
    return (
      <Screen>
        {header}
        <Card>
          <T>{tj('You asked to join {company} as a driver at {station}.', { company: <T key="c" v="medium">{peek.orgName}</T>, station: <T key="s" v="medium">{peek.stationName}</T> })}</T>
          <T v="hint">{t('A fleet manager of your station or the owner approves you. You get a notification, and Fratius opens your station once you\'re in.')}</T>
          {s.user?.email ? <T v="small">{t('We sent a confirmation to {email}.', { email: s.user.email })}</T> : null}
        </Card>
        <GetApp />
        <Button v={device() === 'native' || device() === 'installed' ? 'primary' : 'secondary'} wide title={t('Continue in the browser')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        {header}
        <Card>
          <T>{tj('Sign up as a driver at {company}.', { company: <T key="c" v="medium">{peek.orgName}</T> })}</T>
          <T v="hint">{t('Pick your station. A fleet manager of that station or the owner then approves you.')}</T>
        </Card>

        <Card>
          <T v="h3">{t('1. Your station')}</T>
          {stations.length ? (
            <View style={{ gap: 8 }}>
              {stations.map((st) => (
                <Button key={st.id} wide v={station === st.id ? 'primary' : 'secondary'} title={st.code && st.code !== st.name ? `${st.name} (${st.code})` : st.name}
                  onPress={() => { setStation(st.id); setErr(null); }} accessibilityState={{ selected: station === st.id }} />
              ))}
            </View>
          ) : <T v="hint">{t('This company has no stations yet. Ask your fleet manager.')}</T>}
        </Card>

        <Card>
          <T v="h3">{t('2. Your details')}</T>
          <Field label={t('First name')} value={first} onChangeText={setFirst} autoCapitalize="words" textContentType="givenName" />
          <Field label={t('Last name')} value={last} onChangeText={setLast} autoCapitalize="words" textContentType="familyName" />
        </Card>

        <Card>
          <T v="h3">{t('3. Your account')}</T>
          {signedIn ? (
            <>
              <T>{t('Signed in as {email}. You\'ll join with this account.', { email: s.user?.email })}</T>
              <Row><Button small v="link" title={t('Use another account')} onPress={() => s.signOut()} /></Row>
            </>
          ) : (
            <>
              <Segmented label={t('Account')} value={mode} onChange={(k) => { setMode(k); setErr(null); setInfo(null); }} options={[['up', t('New account')], ['in', t('I have one')]]} />
              <Field label={t('Email')} hint={mode === 'up' ? t('Tip: use the same email as in your Amazon app.') : undefined} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
              <Field label={t('Password')} hint={mode === 'up' ? t('Choose a safe password of your own, at least 6 characters.') : undefined} value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'up' ? 'newPassword' : 'password'} />
              {mode === 'in' ? <Row><Button small v="link" title={t('Forgot your password?')} onPress={forgot} disabled={busy} /></Row> : null}
            </>
          )}
        </Card>

        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        {info ? <T v="hint">{info}</T> : null}
        <Button v="primary" wide title={t('Send request')} loading={busy} onPress={send} disabled={!stations.length || busy} />
        <T v="small">{t('You can install the app on your phone in the next step.')}</T>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/**
 * "Get Fratius": the App Store on an iPhone, the Android app on an Android phone (Google Play once it's there, the test
 * version on fratius.com until then), both on a computer (product owner, 2026-11-24: the link should open the iPhone or
 * Android app, not the home-screen web app). Nothing inside the app itself.
 */
function GetApp() {
  const d = device();
  if (d === 'native' || d === 'installed') return null;
  const target = appTarget();
  const ios = target === 'ios' || target === 'both';
  const android = target === 'android' || target === 'both';
  return (
    <Card>
      <T v="h3">{t('Get Fratius')}</T>
      <T>{target === 'both'
        ? t('Install Fratius on your phone and sign in with the same email and password.')
        : t('Install the app and sign in with the same email and password.')}</T>
      {ios ? <Button v="primary" wide title={t('iPhone: open the App Store')} onPress={() => openOut(APP_STORE)} /> : null}
      {android ? <Button v={target === 'both' ? 'secondary' : 'primary'} wide title={GOOGLE_PLAY ? t('Android: open Google Play') : t('Android: download the app')} onPress={() => openOut(androidUrl())} /> : null}
      {android && !GOOGLE_PLAY ? <T v="small">{t('Fratius isn\'t in Google Play yet: Android asks once to allow installing it from your browser.')}</T> : null}
    </Card>
  );
}

/** Opens a store page: the same tab on a phone (the store app takes over), a new tab on a computer. */
function openOut(url: string) {
  if (typeof window !== 'undefined' && Platform.OS === 'web') {
    if (appTarget() === 'both') window.open(url, '_blank', 'noopener');
    else window.location.href = url;
  } else Linking.openURL(url).catch((e) => console.warn('Store page not opened', e));
}

/** The address of this driver link in the web app, for the password reset email to come back to. */
async function linkBack(token: string): Promise<string> {
  await loadWebUrl();
  return inviteUrl(token);
}
