import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

import { Button, Card, F, MARKER, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { t } from '@/lib/i18n';
import { inviteUrl, ownerCount } from '@/lib/people';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';

/**
 * A closed company (its only member deleted their account; blind test, 26 Nov 2026, cause 2b): records kept,
 * read-only for everyone, seen only by the app creator. Above the tab bar while one is open.
 */
export function ClosedStrip() {
  const s = useSession();
  if (!s.org?.closed) return null;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.navigate('/account')}
      style={{ backgroundColor: MARKER, paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 2, borderColor: '#000' }}>
      <Text numberOfLines={2} style={{ fontFamily: F.medium, fontSize: 14, lineHeight: 18, color: '#000' }}>
        {t('Closed on {day}: read-only, only you see it.', { day: fmtWhen(s.org.closed.at).split(',')[0] })}
      </Text>
    </Pressable>
  );
}

/**
 * For the app creator, on the open company: closed (who closed it, when; Reopen), and a one-time owner link for a
 * company without an owner (24 hours, one person), to share with its next owner.
 */
export function CompanyAdmin() {
  const s = useSession();
  const c = useColors();
  const [owners, setOwners] = useState<number | null>(null);
  const orgId = s.org?.id;
  const closed = !!s.org?.closed;
  useEffect(() => {
    if (!s.creator || !orgId || s.mode !== 'firebase' || closed) return;
    let live = true;
    ownerCount(orgId).then((n) => { if (live) setOwners(n); }).catch(() => {});
    return () => { live = false; };
  }, [s.creator, orgId, s.mode, closed]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ token: string; expiresAt: number } | null>(null);
  if (!s.creator || !s.org || s.mode !== 'firebase') return null;
  const org = s.org;
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that.')); } finally { setBusy(false); }
  };
  if (org.closed) {
    return (
      <Card>
        <Row><T v="h3" style={{ flex: 1 }}>{org.name}</T><Pill v="bad" text={t('Closed')} /></Row>
        <T>{t('Closed on {when}: its only member deleted their account. The records are kept and nobody can change anything. Only you see it.', { when: fmtWhen(org.closed.at) })}</T>
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
        <Row><Button v="primary" title={t('Reopen the company')} loading={busy} onPress={() => run(async () => { await ai.reopenCompany({ orgId: org.id }); await s.switchOrg(org.id); })} /></Row>
      </Card>
    );
  }
  if (owners == null || owners > 0) return null;
  const url = link ? inviteUrl(link.token) : '';
  return (
    <Card>
      <T v="h3">{org.name}</T>
      <T>{t('This company has no fleet owner. A one-time owner link lets one person join as its owner (it works for 24 hours).')}</T>
      {link ? (
        <View style={{ gap: 6 }}>
          <T v="small" selectable numberOfLines={2}>{url}</T>
          <Row><Button small v="primary" title={t('Share')} onPress={() => Share.share({ message: t('You\'re invited to be the fleet owner of {company} in Fratius: {link}', { company: org.name, link: url }) }).catch(() => {})} /></Row>
          <T v="small">{t('Works once, until {when}.', { when: fmtWhen(link.expiresAt) })}</T>
        </View>
      ) : <Row><Button v="primary" title={t('Make a one-time owner link')} loading={busy} onPress={() => run(async () => setLink((await ai.ownerLink({ orgId: org.id })).invite))} /></Row>}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}
