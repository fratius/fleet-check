import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { VideoPlayer } from '@/components/video';
import { Button, Card, Notice, Pill, Row, Screen, T, fmtWhen } from '@/components/ui';
import { photoUrl } from '@/lib/images';
import { useSession } from '@/lib/session';
import { ai } from '@/lib/store';
import type { Video } from '@/lib/types';
import { mb, watchVideo } from '@/lib/videos';

/** One handover video: the player and what's known about it. */
export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useSession();
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
  const stuck = !!v && ((v.status === 'uploaded' && Date.now() - v.createdAt > 90_000) || v.status === 'failed');
  useEffect(() => {
    if (!v || !orgId || kicked.current || !stuck || v.status === 'failed') return;
    kicked.current = true;
    ai.processVideo({ orgId, videoId: v.id }).catch(() => {});
  }, [v, orgId, stuck]);

  if (!v) return <Screen edges={[]}><Card dashed><T v="hint">{older === null ? 'This video isn\'t available.' : 'Loading…'}</T></Card></Screen>;
  const ready = v.status === 'ready' && v.playPath;
  const aspect = v.width && v.height ? v.width / v.height : 9 / 16;
  const title = v.kind === 'pickup' ? 'Pick-up video' : 'Drop-off video';
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: `${title}, ${v.vehicleName}` }} />
      <View style={{ alignSelf: 'center', width: aspect < 1 ? '72%' : '100%', maxWidth: 520 }}>
        <VideoPlayer path={ready ? v.playPath! : v.path} aspect={aspect} />
      </View>
      {!ready ? (
        <Notice text={v.status === 'failed' ? 'The copy that plays on every phone couldn\'t be made. This is the original; it plays on iPhones and Macs.'
          : 'Making a copy that plays on every phone (about a minute). Until then this is the original, which may not play in every browser.'} />
      ) : null}
      <View style={{ gap: 4 }}>
        <T v="h2">{title}{v.late ? ', added later' : ''}</T>
        <Row>
          <Pill text={`${Math.round(v.durationMs / 1000)} seconds`} />
          {v.late ? <Pill v="amber" text="Added after the handover" /> : null}
        </Row>
        <T>Recorded by {v.byName}{v.recordedAt ? `, ${fmtWhen(v.recordedAt)}` : ''}.</T>
        <T v="small">Uploaded {fmtWhen(v.createdAt)}{v.device ? `, ${v.device}` : ''}{v.size ? `, original ${mb(v.size)}` : ''}{v.playSize ? `, playback copy ${mb(v.playSize)}` : ''}.</T>
      </View>
      <Row>
        <Button small title={`Open ${v.vehicleName}`} onPress={() => router.push(`/vehicle/${v.vehicleId}`)} />
        {s.staff ? <Button small v="link" title="Download the original" onPress={async () => { const u = await photoUrl(v.path); if (u) Linking.openURL(u); }} /> : null}
      </Row>
    </Screen>
  );
}
