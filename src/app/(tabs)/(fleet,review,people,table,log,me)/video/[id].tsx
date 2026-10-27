import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { KeepCard, useMediaGone } from '@/components/keep';
import { VideoPlayer } from '@/components/video';
import { Button, Card, Notice, Pill, Row, Screen, T, fmtWhen } from '@/components/ui';
import { photoUrl } from '@/lib/images';
import { useSession } from '@/lib/session';
import { ai } from '@/lib/store';
import { VIDEO_TITLE, type Video } from '@/lib/types';
import { mb, watchVideo } from '@/lib/videos';
import { t, tp } from '@/lib/i18n';

/** One video of a van (pick-up, drop-off or walk-around): the player and what's known about it. */
export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useSession();
  const gone = useMediaGone();
  const loaded = s.videos.find((v) => v.id === id);
  const [older, setOlder] = useState<Video | null | undefined>(undefined);
  const orgId = s.org?.id;
  useEffect(() => {
    if (loaded || !orgId || s.mode !== 'firebase') return;
    return watchVideo(orgId, id, setOlder);
  }, [loaded, orgId, id, s.mode]);
  const v = loaded || older || null;
  // If the playback copy wasn't made (the phone went offline right after the upload), start it again.
  const kicked = useRef(false);
  const stuck = !!v && ((v.status === 'uploaded' && Date.now() - v.createdAt > 90_000) || v.status === 'failed') && !gone(v.createdAt, v.keepUntil);
  useEffect(() => {
    if (!v || !orgId || kicked.current || !stuck || v.status === 'failed') return;
    kicked.current = true;
    ai.processVideo({ orgId, videoId: v.id }).catch(() => {});
  }, [v, orgId, stuck]);

  if (!v) return <Screen edges={[]}><Card dashed><T v="hint">{older === null ? t('This video isn\'t available.') : t('Loading…')}</T></Card></Screen>;
  const ready = v.status === 'ready' && v.playPath;
  const aspect = v.width && v.height ? v.width / v.height : 9 / 16;
  const title = VIDEO_TITLE[v.kind] ? t(VIDEO_TITLE[v.kind]) : t('Video');
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('{title}, {van}', { title, van: v.vehicleName }) }} />
      {gone(v.createdAt, v.keepUntil) ? null : (
        <View style={{ alignSelf: 'center', width: aspect < 1 ? '72%' : '100%', maxWidth: 520 }}>
          <VideoPlayer path={ready ? v.playPath! : v.path} aspect={aspect} />
        </View>
      )}
      {!ready && !gone(v.createdAt, v.keepUntil) ? (
        <Notice text={v.status === 'failed' ? t('The copy that plays on every phone couldn\'t be made. This is the original; it plays on iPhones and Macs.')
          : t('Making a copy that plays on every phone (about a minute). Until then this is the original, which may not play in every browser.')} />
      ) : null}
      <View style={{ gap: 4 }}>
        <T v="h2">{v.late ? t('{title}, added later', { title }) : title}</T>
        <Row>
          <Pill text={tp(Math.round(v.durationMs / 1000), '{n} second', '{n} seconds')} />
          {v.late ? <Pill v="amber" text={t('Added after the handover')} /> : null}
        </Row>
        <T>{v.recordedAt ? t('Recorded by {name}, {when}.', { name: v.byName, when: fmtWhen(v.recordedAt) }) : t('Recorded by {name}.', { name: v.byName })}</T>
        <T v="small">{[t('Uploaded {when}', { when: fmtWhen(v.createdAt) }), v.device || '', v.size ? t('original {size}', { size: mb(v.size) }) : '',
          v.playSize ? t('playback copy {size}', { size: mb(v.playSize) }) : ''].filter(Boolean).join(', ')}.</T>
      </View>
      <KeepCard kind="video" id={v.id} createdAt={v.createdAt} stationId={v.stationId} keepUntil={v.keepUntil} keepMark={v.keepMark} />
      <Row>
        <Button small title={t('Open {name}', { name: v.vehicleName })} onPress={() => router.push(`/vehicle/${v.vehicleId}`)} />
        {s.staff && !gone(v.createdAt, v.keepUntil) ? <Button small v="link" title={v.originalDeleted ? t('Download the video') : t('Download the original')}
          onPress={async () => { const u = await photoUrl(v.originalDeleted && v.playPath ? v.playPath : v.path); if (u) Linking.openURL(u); }} /> : null}
      </Row>
    </Screen>
  );
}
