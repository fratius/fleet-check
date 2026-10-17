import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Card, Field, Notice, Pill, Row, Screen, Segmented, T, fmtWhen, useColors } from '@/components/ui';
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
    if (!first.trim() || !last.trim()) { setErr('Enter your first and last name.'); return; }
    if (!signedIn) {
      if (!email.trim()) { setErr('Enter your email address.'); return; }
      if (password.length < 6) { setErr('Use at least 6 characters for the password.'); return; }
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
      <T v="hint">Fleet Check</T>
      <T v="h1">{done ? `You're in ${done.orgName}` : peek?.status === 'ok' || peek?.status === 'mine' ? `Join ${peek.orgName}` : 'Invite link'}</T>
    </View>
  );

  if (!peek) return <Screen>{header}<ActivityIndicator color={c.ink} style={{ alignSelf: 'flex-start' }} /></Screen>;

  if (done) {
    return (
      <Screen>
        {header}
        <Card>
          <T>You joined as a {ROLE_NAME[done.role as 'driver'].toLowerCase()} at {done.stationName}.</T>
          {done.role === 'driver' ? <T v="hint">You'll see the vans of your station. Scan a van before and after your route; your fleet manager reviews any damage.</T> : null}
        </Card>
        <Install />
        <Button v="primary" wide title="Open Fleet Check" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (peek.status !== 'ok' && peek.status !== 'mine') {
    const why = peek.status === 'used' ? 'This link was already used. Each link works for one person.'
      : peek.status === 'expired' ? 'This link has expired. Links work for 24 hours.'
        : 'This link doesn\'t exist or was cancelled.';
    return (
      <Screen>
        {header}
        <Notice tone="bad" text={`${why} Ask ${peek.invitedBy || 'your fleet manager'} for a new one.`} />
        <Button title={signedIn ? 'Open Fleet Check' : 'Sign in'} onPress={() => router.replace(signedIn ? '/' : '/sign-in')} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        {header}
        <Card>
          <T>{peek.invitedBy ? `${peek.invitedBy} invited you` : 'You\'re invited'} to join <T v="medium">{peek.orgName}</T> as a {ROLE_NAME[role].toLowerCase()} at <T v="medium">{peek.stationName}</T>.</T>
          <Row><Pill text={ROLE_NAME[role]} /><Pill v="muted" text={`Link works until ${fmtWhen(peek.expiresAt)}`} /></Row>
        </Card>

        <Card>
          <T v="h3">1. Your details</T>
          <Field label="First name" value={first} onChangeText={setFirst} autoCapitalize="words" textContentType="givenName" />
          <Field label="Last name" value={last} onChangeText={setLast} autoCapitalize="words" textContentType="familyName" />
          <Field label="Mobile number" hint="so your manager can reach you" value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+49 170 1234567" />
          {role === 'driver' ? <Field label="Amazon Transporter ID" hint="optional" value={tid} onChangeText={(t) => setTid(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} /> : null}
        </Card>

        <Card>
          <T v="h3">2. Your account</T>
          {signedIn ? (
            <>
              <T>Signed in as {s.user?.email}. You'll join with this account.</T>
              <Row><Button small v="link" title="Use another account" onPress={() => s.signOut()} /></Row>
            </>
          ) : (
            <>
              <Segmented label="Account" value={mode} onChange={(k) => { setMode(k); setErr(null); }} options={[['up', 'New account'], ['in', 'I have one']]} />
              <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
              <Field label="Password" hint={mode === 'up' ? 'at least 6 characters' : undefined} value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'up' ? 'newPassword' : 'password'} />
            </>
          )}
        </Card>

        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        <Button v="primary" wide title={`Join ${peek.orgName}`} loading={busy} onPress={join} />
        <T v="small">You can install the app on your phone in the next step.</T>
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
      <T v="h3">Install the app</T>
      {d === 'ios' ? (
        <>
          <T>1. Tap the Share button at the bottom of Safari (the square with an arrow).</T>
          <T>2. Tap <T v="medium">Add to Home Screen</T>, then <T v="medium">Add</T>.</T>
          <T>3. Open Fleet Check from your home screen and sign in with the same email and password.</T>
          <T v="small">Use Safari: other browsers on iPhone can't add apps to the home screen.</T>
        </>
      ) : d === 'android' ? (
        canPromptInstall()
          ? <><T>Put Fleet Check on your home screen like any other app.</T><Button v="primary" title="Install the app" onPress={() => promptInstall()} /></>
          : <><T>1. In Chrome, tap the menu (three dots, top right).</T><T>2. Tap <T v="medium">Install app</T> or <T v="medium">Add to Home screen</T>.</T><T>3. Open Fleet Check from your home screen and sign in.</T></>
      ) : (
        <T>Open this page on your phone to install the app there, or keep using it in this browser.</T>
      )}
    </Card>
  );
}
