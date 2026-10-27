import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, T, useColors } from '@/components/ui';
import { t } from '@/lib/i18n';
import { authMessage, useSession } from '@/lib/session';
import { ai } from '@/lib/store';
import type { AccountCompany } from '@/lib/types';

/**
 * Deleting your own account (the App Store and Google Play require it in the app). The server (deleteAccount) says
 * first what happens in each company: you leave it; it's deleted with you when you're its only member (or it's your
 * demo); or, as its only fleet owner with other people in it, you hand it over first. Then the password again.
 */
export function DeleteAccount() {
  const s = useSession();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<AccountCompany[] | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (s.mode !== 'firebase' || !s.user) return null;
  if (s.creator) return null;

  const start = async () => {
    setOpen(true); setErr(null); setPlan(null);
    try { setPlan((await ai.accountPlan({ check: true })).companies); } catch (e) { setErr(authMessage(e)); }
  };
  const blocked = (plan || []).filter((x) => x.outcome === 'blocked');
  const go = async () => {
    if (!password) { setErr(t('Enter your password.')); return; }
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    setBusy(true); setErr(null); setArmed(false);
    try { await s.deleteAccount(password); } catch (e) { setErr(authMessage(e)); setBusy(false); }
  };

  if (!open) return <Button v="link" small title={t('Delete account')} onPress={start} />;
  return (
    <Card>
      <T v="h3">{t('Delete your account')}</T>
      <T v="hint">{t('Your login and your profile (name, mobile number, Transporter ID) are deleted, and your phones stop getting notifications. The companies you worked for keep their records with your name: which vans you had and when, walk-arounds, damage checks, refuels and your driver record. Their photos and videos are deleted after 30 days, or 90 when marked as damage.')}</T>
      {plan ? (
        <View style={{ gap: 6 }}>
          {plan.map((x) => (
            <T key={x.id} v="small" color={x.outcome === 'blocked' ? c.alert : undefined}>
              {x.outcome === 'blocked' ? t('{company}: you\'re its fleet owner. Make another person fleet owner first (People, the person, Role), then come back here.', { company: x.name })
                : x.outcome === 'close' ? (x.demo ? t('{company}: your demo company is deleted.', { company: x.name }) : t('{company}: you\'re its only member, so the company is deleted with everything in it.', { company: x.name }))
                  : t('{company}: you leave the company.', { company: x.name })}
            </T>
          ))}
        </View>
      ) : err ? null : <T v="small">{t('Loading…')}</T>}
      {plan && !blocked.length ? (
        <>
          <Field label={t('Password')} value={password} onChangeText={(v) => { setPassword(v); setArmed(false); }} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />
          <Button v="danger" wide title={armed ? t('Tap again to delete your account for good') : t('Delete my account')} loading={busy} onPress={go} />
        </>
      ) : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title={t('Cancel')} onPress={() => { setOpen(false); setPassword(''); setErr(null); setArmed(false); }} />
    </Card>
  );
}
