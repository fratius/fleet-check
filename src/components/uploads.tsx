import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, F, MARKER, Row, T, fmtWhen, useColors } from '@/components/ui';
import { t, tp } from '@/lib/i18n';
import { useWaitingCount } from '@/lib/net';
import { jobTitle, outbox, pendingHandover, useOutbox, type Job } from '@/lib/outbox';
import type { Live } from '@/lib/outboxcore';
import { useSession } from '@/lib/session';
import { mb } from '@/lib/videos';

/**
 * What the outbox (lib/outbox.ts) is doing, for the person who took the photos or video: a strip above the tab bar,
 * a row per upload (on the van page, in the video button, on the Uploads page) with Try again for one that stopped.
 */

/** Is an earlier upload of this person still to go first (they go one at a time, oldest first)? */
export function isBehind(jobs: Job[], j: Job) {
  const i = jobs.findIndex((x) => x.id === j.id);
  return jobs.slice(0, Math.max(0, i)).some((x) => x.uid === j.uid && x.status === 'queued');
}

/** One line: uploading, waiting for the connection, sending, or why it stopped. */
export function stateText(j: Job, l: Live | undefined, behind = false) {
  if (j.status === 'failed') return j.error || t('Something went wrong. Try again.');
  if (!l || !l.step) return behind ? t('Saved on this phone. It uploads after the one before it.') : t('Waiting to upload.');
  if (l.waiting) {
    return j.type === 'video' ? t('No connection. The video is saved on this phone and uploads by itself when there\'s a connection.')
      : t('No connection. The photos are saved on this phone and upload by themselves when there\'s a connection.');
  }
  if (l.step === 'upload') {
    if (j.type === 'video') return t('Uploading {pct}% of {size}', { pct: Math.round((l.sent / Math.max(1, l.total)) * 100), size: mb(l.total) });
    return t('Uploading {done} of {total}', { done: j.files.filter((f) => f.done).length, total: j.files.length });
  }
  if (l.step === 'save') return t('Saving the walk-around…');
  const fn = j.then?.fn;
  if (j.type === 'video') return t('Checking the video…');
  if (fn === 'pickUpVan') return t('Picking up {van}', { van: j.vehicleName });
  if (fn === 'dropOffVan') return t('Dropping off {van}', { van: j.vehicleName });
  return t('Saving the pick-up photos');
}

/** One upload: what, its state, and what can be done. */
export function UploadRow({ j, bare }: { j: Job; bare?: boolean }) {
  const c = useColors();
  const ob = useOutbox();
  const [armed, setArmed] = useState(false);
  const l = ob.live.get(j.id);
  const failed = j.status === 'failed';
  const arm = () => { setArmed(true); setTimeout(() => setArmed(false), 3000); };
  const remove = () => { if (!armed) { arm(); return; } outbox.remove(j.id); };
  return (
    <View style={[{ gap: 6 }, bare ? null : { borderWidth: 2, borderColor: failed ? c.alert : c.ink, borderRadius: 4, padding: 12, backgroundColor: c.paper }]}>
      <T v="h3">{jobTitle(j)}</T>
      <T v="small">{t('Taken {when}', { when: fmtWhen(j.createdAt) })}</T>
      <T v="medium" color={failed ? c.alert : undefined}>{stateText(j, l, isBehind(ob.jobs, j))}</T>
      {failed && j.walkSaved && j.then ? <T v="small">{t('The photos are saved as a walk-around.')}</T> : null}
      {failed && j.type === 'video' && j.files.every((f) => f.done) && j.then ? <T v="small">{t('The video is uploaded but wasn\'t used.')}</T> : null}
      <Row>
        {failed ? <Button small v="primary" title={t('Try again')} onPress={() => outbox.retry(j.id)} /> : null}
        <Button small v="link" title={armed ? (failed ? t('Tap again to remove it') : t('Tap again: it won\'t be sent')) : failed ? t('Remove') : t('Cancel')} onPress={remove} />
      </Row>
    </View>
  );
}

/** The photos or video of this van's pick-up or drop-off that are still on their way, in place of the buttons. */
export function HandoverWaiting({ vehicleId, what, assignmentId }: { vehicleId: string; what: 'pickup' | 'dropoff'; assignmentId?: string | null }) {
  const s = useSession();
  const ob = useOutbox();
  const j = pendingHandover(ob.jobs, s.user?.uid, vehicleId, what, assignmentId);
  return j ? <UploadRow j={j} /> : null;
}
/** Is a pick-up or drop-off of this van on its way? */
export function useHandoverWaiting(vehicleId: string, what: 'pickup' | 'dropoff', assignmentId?: string | null) {
  const s = useSession();
  const ob = useOutbox();
  return !!pendingHandover(ob.jobs, s.user?.uid, vehicleId, what, assignmentId);
}

/** Above the tab bar while something is uploading, waiting for the connection, or stopped. Opens the Uploads page. */
export function UploadsStrip() {
  const s = useSession();
  const c = useColors();
  const ob = useOutbox();
  const others = useWaitingCount();
  const mine = ob.jobs.filter((j) => j.uid === s.user?.uid);
  const failed = mine.filter((j) => j.status === 'failed').length;
  const queued = mine.length - failed;
  const waiting = others > 0 || mine.some((j) => ob.live.get(j.id)?.waiting);
  if (!mine.length && !waiting) return null;
  const text = failed ? tp(failed, '{n} upload stopped. Tap to see why.', '{n} uploads stopped. Tap to see why.')
    : waiting ? (queued ? tp(queued, 'No connection. {n} upload waits on this phone and goes up by itself.', 'No connection. {n} uploads wait on this phone and go up by themselves.')
      : t('No connection. Trying again by itself…'))
      : tp(queued, 'Uploading {n} item…', 'Uploading {n} items…');
  const bg = failed ? c.alert : waiting ? MARKER : c.paper;
  const fg = failed ? (c.dark ? '#000' : '#fff') : waiting ? '#000' : c.ink;
  return (
    <Pressable accessibilityRole="link" disabled={!mine.length} onPress={() => router.push('/uploads')}
      style={{ backgroundColor: bg, paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 2, borderColor: failed || waiting ? '#000' : c.ink }}>
      <Text numberOfLines={2} style={{ fontFamily: F.medium, fontSize: 14, lineHeight: 18, color: fg }}>{text}</Text>
    </Pressable>
  );
}

/** Everything this person has on its way, on the Uploads page. */
export function UploadList() {
  const s = useSession();
  const ob = useOutbox();
  const mine = ob.jobs.filter((j) => j.uid === s.user?.uid);
  return (
    <View style={{ gap: 10 }}>
      <T v="body">{t('Photos and videos are saved on this phone first, then uploaded. Without a connection they wait here and go up by themselves, so you never take them again. Keep the app open, or open it again later.')}</T>
      {mine.length ? mine.map((j) => <UploadRow key={j.id} j={j} />) : <T v="hint">{t('Nothing waiting. Everything is uploaded.')}</T>}
    </View>
  );
}
