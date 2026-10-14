import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Card, Field, Notice, Row, Screen, Segmented, T, useColors } from '@/components/ui';
import { authMessage, useSession } from '@/lib/session';

export default function SignIn() {
  const s = useSession();
  const c = useColors();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [code, setCode] = useState('');
  const [orgMode, setOrgMode] = useState<'create' | 'join'>('create');
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
          <T v="hint">Signed in as {s.user?.email}</T>
          <T v="h1">Your company</T>
          <T>Create your company, or join one with the invite code your fleet manager gave you.</T>
        </View>
        <Segmented label="Company" value={orgMode} onChange={(k) => { setOrgMode(k); setErr(null); }} options={[['create', 'Create a company'], ['join', 'Join with a code']]} />
        <Card>
          {orgMode === 'create' ? (
            <>
              <Field label="Company name" value={company} onChangeText={setCompany} autoCapitalize="words" placeholder="For example: Hart Logistics GmbH" />
              <T v="hint">You become its admin. Drivers join with the invite code shown under Account.</T>
              <Button v="primary" wide title="Create company" loading={busy}
                onPress={() => company.trim() ? run(() => s.createOrg(company)) : setErr('Enter your company name.')} />
            </>
          ) : (
            <>
              <Field label="Invite code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={6} placeholder="6 letters and numbers" />
              <Button v="primary" wide title="Join company" loading={busy}
                onPress={() => code.trim().length === 6 ? run(() => s.joinOrg(code)) : setErr('The invite code has 6 characters.')} />
            </>
          )}
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        </Card>
        <Button v="link" title="Sign out" onPress={() => s.signOut()} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ gap: 6, paddingTop: 24 }}>
          <T v="h1">Fleet Check</T>
          <T>Walk-around photos, van history and damage checks for your fleet.</T>
        </View>
        <Segmented label="Account" value={mode} onChange={(k) => { setMode(k); setErr(null); setInfo(null); }} options={[['in', 'Sign in'], ['up', 'Create account']]} />
        <Card>
          {mode === 'up' ? <Field label="Your name" value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" /> : null}
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'up' ? 'newPassword' : 'password'}
            onSubmitEditing={() => run(() => mode === 'in' ? s.signIn(email, password) : s.signUp(email, password, name))} />
          <Button v="primary" wide title={mode === 'in' ? 'Sign in' : 'Create account'} loading={busy}
            onPress={() => {
              if (!email.trim()) return setErr('Enter your email address.');
              if (!password) return setErr('Enter your password.');
              run(() => mode === 'in' ? s.signIn(email, password) : s.signUp(email, password, name));
            }} />
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
          {info ? <T v="hint">{info}</T> : null}
        </Card>
        {mode === 'in' ? (
          <Row><Button v="link" small title="Forgot your password?" onPress={() => email.trim()
            ? run(async () => { await s.resetPassword(email); setInfo('Check your inbox for a link to set a new password.'); })
            : setErr('Enter your email address first.')} /></Row>
        ) : null}
        {s.mode === 'local' ? <Notice text="Firebase isn't connected yet, so this app keeps everything on this phone." /> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
