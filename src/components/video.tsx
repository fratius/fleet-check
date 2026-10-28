import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { VideoRecorder } from '@/components/recorder';
import { Button, Photo, T, fmtWhen, useColors } from '@/components/ui';
import { UploadRow } from '@/components/uploads';
import { photoUrl } from '@/lib/images';
import { queueVideo, useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { VIDEO_TITLE, type Vehicle, type Video } from '@/lib/types';
import { recordVideo, type Recorded } from '@/lib/videos';
import { fwd, N_, t } from '@/lib/i18n';

/** Plays a stored video. */
export function VideoPlayer({ path, aspect }: { path: string; aspect: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; photoUrl(path).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [path]);
  return url ? <Player key={url} url={url} aspect={aspect} /> : <View style={{ width: '100%', aspectRatio: aspect, backgroundColor: '#000', borderRadius: 4 }} />;
}
function Player({ url, aspect }: { url: string; aspect: number }) {
  const player = useVideoPlayer({ uri: url }, (p) => { p.loop = false; });
  return <VideoView player={player} style={{ width: '100%', aspectRatio: aspect, backgroundColor: '#000', borderRadius: 4 }} nativeControls fullscreenOptions={{ enable: true }} contentFit="contain" />;
}

/** A video in a list: poster, what it is, who, when. Opens the video page. */
export function VideoRow({ v }: { v: Video }) {
  const c = useColors();
  return (
    <Pressable onPress={() => router.push(`/video/${v.id}`)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 8 }}>
      {v.posterPath ? <Photo src={v.posterPath} style={{ width: 54, height: 72 }} /> : <View style={{ width: 54, height: 72, borderRadius: 3, backgroundColor: '#16181C', alignItems: 'center', justifyContent: 'center' }}><T v="h3" color="#fff">▶</T></View>}
      <View style={{ flex: 1, gap: 2 }}>
        <T v="h3">{v.late ? t('{title}, added later', { title: VIDEO_TITLE[v.kind] ? t(VIDEO_TITLE[v.kind]) : t('Video') }) : VIDEO_TITLE[v.kind] ? t(VIDEO_TITLE[v.kind]) : t('Video')}</T>
        <T v="small">{[v.byName, fmtWhen(v.recordedAt || v.createdAt), `${Math.round(v.durationMs / 1000)} s`].filter(Boolean).join(', ')}</T>
      </View>
      <T v="h3" color={c.ink2}>{fwd()}</T>
    </Pressable>
  );
}

/**
 * Records a video and uses it for a pick-up or drop-off (the server checks it and records the handover), adds it
 * to a handover that's missing one, or keeps it with the van as a walk-around. The recording is saved on the phone
 * at once and goes through the outbox (lib/outbox.ts): it uploads by itself, also without a connection for a while,
 * after leaving the page or closing the app, so it's never recorded twice. While it's on its way this shows how far.
 */
export function VideoHandover({ v, kind, assignmentId, title, primary, wide, onDone }: {
  v: Vehicle; kind: Video['kind']; assignmentId?: string; title: string; primary?: boolean; wide?: boolean; onDone?: () => void;
}) {
  const s = useSession();
  const c = useColors();
  const ob = useOutbox();
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // On the phone the video is recorded in the app (components/recorder.tsx); on the web with the browser's camera.
  const [recording, setRecording] = useState(false);
  const recorded = useRef<((r: Recorded | null) => void) | null>(null);
  const record = (): Promise<Recorded | null> => (Platform.OS === 'web' ? recordVideo()
    : new Promise((resolve) => { recorded.current = resolve; setRecording(true); }));
  // This video's upload, also after the page was left and opened again.
  const job = ob.jobs.find((j) => j.type === 'video' && j.uid === s.user?.uid && j.vehicleId === v.id && j.what === kind && (j.assignmentId || null) === (assignmentId || null)) || null;
  const finished = !!sent && (ob.done.has(sent) || !ob.jobs.some((j) => j.id === sent));
  useEffect(() => { if (finished) { setSent(null); onDone?.(); } }, [finished, onDone]);
  const go = async () => {
    setErr(null);
    try {
      const rec = await record();
      if (!rec) return;
      setStep(t('Saving the video…'));
      setSent(await queueVideo({ orgId: s.org!.id, uid: s.user!.uid, v, rec, what: kind, assignmentId }));
    } catch (e) {
      setErr(e instanceof Error && e.message === 'camera' ? t('Allow camera access in Settings to record the video.') : t('Couldn\'t save the video on this phone. Record it again.'));
    } finally { setStep(null); }
  };
  return (
    <View style={{ gap: 6 }}>
      <VideoRecorder open={recording} onDone={(r) => { setRecording(false); recorded.current?.(r); recorded.current = null; }} />
      {job ? <UploadRow j={job} /> : (
        <Button v={primary ? 'primary' : 'secondary'} wide={wide} title={step || title} loading={!!step} disabled={!!step} onPress={go} />
      )}
      {err ? <T v="small" color={c.alert}>{err}</T> : null}
    </View>
  );
}

/** How to film the van (English; show it with t(VIDEO_HOW)). */
export const VIDEO_HOW = N_('Film once around the van: start at the front, walk slowly round with the whole side in view, end at the front. 20 to 60 seconds.');
