import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { DeleteAccount } from '@/components/deleteaccount';
import { AllCompanies } from '@/components/companies';
import { LanguageLink } from '@/components/language';
import { Button, Card, Field, Notice, Row, Screen, Segmented, T, useColors } from '@/components/ui';
import { tokenFrom } from '@/lib/people';
import { t } from '@/lib/i18n';
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
  const [station, setStation] = useState('');
  const [orgMode, setOrgMode] = useState<'create' | 'join'>('join');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

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
        <Segmented label={t('Company')} value={orgMode} onChange={(k) => { setOrgMode(k); setErr(null); }} options={[['join', t('I have an invite link')], ['create', t('Create a company')]]} />
        <Card>
          {orgMode === 'create' ? (
            <>
              <Field label={t('Company name')} value={company} onChangeText={setCompany} autoCapitalize="words" placeholder={t('For example: Hart Logistics GmbH')} />
              <Field label={t('First station')} hint={t('you can add more later')} value={station} onChangeText={setStation} autoCapitalize="characters" placeholder={t('For example: DXX1 Berlin')} />
              <T v="hint">{t('You become the fleet owner. You add stations, fleet managers and drivers under People.')}</T>
              <Button v="primary" wide title={t('Create company')} loading={busy}
                onPress={() => company.trim() ? run(() => s.createOrg(company, station)) : setErr(t('Enter your company name.'))} />
            </>
          ) : (
            <>
              <Field label={t('Invite link')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="https://…/join/…" />
              <Button v="primary" wide title={t('Continue')} loading={busy}
                onPress={() => { const tk = tokenFrom(code); if (tk) router.push({ pathname: '/join/[token]', params: { token: tk } }); else setErr(t('Paste the whole link you were sent.')); }} />
              <T v="small">{t('Each link works for one person, for 24 hours.')}</T>
            </>
          )}
          {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        </Card>
        {s.creator ? <AllCompanies /> : null}
        <Card dashed>
          <T v="h3">{t('Just looking?')}</T>
          <T v="hint">{t('Open a demo company with made-up stations, managers, drivers, vans and damage checks. It\'s yours alone and you can remove it any time.')}</T>
          <Button title={t('Open a demo company')} loading={demoBusy} onPress={async () => { setDemoBusy(true); setErr(null); try { await s.openDemo(); } catch (e) { setErr(authMessage(e)); } finally { setDemoBusy(false); } }} />
        </Card>
        <Button v="link" title={t('Sign out')} onPress={() => s.signOut()} />
        <DeleteAccount />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ gap: 6, paddingTop: 24 }}>
          <T v="h1">Fratius</T>
          <T>{t('Walk-around photos, van history and damage checks for your fleet.')}</T>
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
      </Screen>
    </KeyboardAvoidingView>
  );
}
