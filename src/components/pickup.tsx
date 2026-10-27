import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { dur } from '@/components/history';
import { Button, Card, Row, T, fmtWhen, useColors } from '@/components/ui';
import { VIDEO_HOW, VideoHandover } from '@/components/video';
import { buildFrames, makeSpec } from '@/lib/frames';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { useSession } from '@/lib/session';
import type { Assignment, Vehicle } from '@/lib/types';
import { needsPickup } from '@/lib/videos';
import { N_, t } from '@/lib/i18n';

/** The driver's open assignment of this van, when it was given to them and still needs its pick-up photos or video. */
export function usePickupRequest(v: Vehicle | null | undefined): Assignment | null {
  const s = useSession();
  if (!v || s.mode !== 'firebase' || v.assignedTo?.driverId !== s.user?.uid) return null;
  const a = s.assignments.find((x) => x.id === v.assignedTo!.assignmentId)
    || s.assignments.find((x) => x.end == null && x.vehicleId === v.id && x.driverId === s.user?.uid);
  return a && needsPickup(a, s.videos, s.walks) ? a : null;
}

/**
 * A van a manager or owner gave this driver: before driving, the driver films it or takes its photos, so damage
 * that was already there isn't put on them. Shown on the Vans tab and the van's page.
 */
export function PickupRequest({ v, a, compact }: { v: Vehicle; a: Assignment; compact?: boolean }) {
  const frames = buildFrames(makeSpec(v.cls, v)).length;
  return (
    <View style={{ backgroundColor: '#E2FF1C', borderRadius: 4, padding: 14, gap: 8, borderWidth: 2, borderColor: '#000' }}>
      {compact ? <T v="medium" color="#000">{t('{name} gave you a van', { name: a.startedByName })}</T> : null}
      <T v="h2" color="#000">{compact ? `${v.name}${v.plate ? `, ${v.plate}` : ''}` : t('Take the pick-up video or photos')}</T>
      <T v="body" color="#000">
        {t('{name} gave it to you {when} ({time} ago). Before you drive, film it or take its photos, so damage that was already there isn\'t put on you. Your fleet manager sees if they\'re missing.',
          { name: a.startedByName, when: fmtWhen(a.start), time: dur(Date.now() - a.start) })}
      </T>
      <VideoHandover v={v} kind="pickup" assignmentId={a.id} title={t('Record the pick-up video')} primary wide />
      <Button wide title={t('Take the {n} pick-up photos', { n: frames })} onPress={() => router.push({ pathname: '/scan/[id]', params: { id: v.id, handover: 'pickup', assignment: a.id } })} />
      <T v="small" color="#000">{t(VIDEO_HOW)}</T>
      {compact ? <Button small v="link" title={t('Open {name}', { name: v.name })} onPress={() => router.push(`/vehicle/${v.id}`)} /> : null}
    </View>
  );
}

const STATE_TEXT: Record<PushState, string> = {
  native: N_('Phone notifications work in the web app (on the home screen), not in Expo Go.'),
  install: N_('On iPhone, notifications work once Fratius is on your home screen: tap Share, then Add to Home Screen, open it from there and turn them on here.'),
  unsupported: N_('This browser can\'t show notifications. Use Chrome on Android, or the app on an iPhone\'s home screen.'),
  blocked: N_('Notifications are blocked for Fratius. Allow them in the phone\'s settings (iPhone: Settings > Notifications > Fratius; Android: Chrome > Site settings > Notifications), then come back here.'),
  off: N_('Get a notification on this phone when someone gives you a van.'),
  on: N_('This phone gets a notification when someone gives you a van.'),
};

/** Turning phone notifications on or off for this phone (Account tab), or a short prompt (Vans tab). */
export function Notifications({ prompt }: { prompt?: boolean }) {
  const s = useSession();
  const c = useColors();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; pushState().then((x) => { if (live) setState(x); }).catch(() => {}); return () => { live = false; }; }, []);
  if (s.mode !== 'firebase' || !state || !s.user) return null;
  // The prompt on the Vans tab only asks when the phone can do it and it's off.
  if (prompt && state !== 'off') return null;
  const turnOn = async () => {
    setErr(null); setBusy(true);
    try { setState(await enablePush(s.user!.uid)); } catch (e) { setErr(e instanceof Error ? t(e.message) : t('Couldn\'t turn notifications on.')); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setErr(null); setBusy(true);
    try { await disablePush(s.user!.uid); setState(await pushState()); } finally { setBusy(false); }
  };
  if (prompt) {
    return (
      <Card>
        <Row><T v="h3" style={{ flex: 1 }}>{t('Get told when you\'re given a van')}</T></Row>
        <T v="hint">{t('A notification on this phone, so you know before you get to the station.')}</T>
        <Button small v="primary" title={t('Turn on notifications')} loading={busy} onPress={turnOn} />
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      </Card>
    );
  }
  return (
    <Card>
      <T v="h3">{t('Notifications')}</T>
      <T v="hint">{t(STATE_TEXT[state])}</T>
      {state === 'off' ? <Button small v="primary" title={t('Turn on notifications')} loading={busy} onPress={turnOn} /> : null}
      {state === 'on' ? <Button small v="link" title={t('Turn off on this phone')} loading={busy} onPress={turnOff} /> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}
