import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Photo, T, fmtWhen, useColors } from '@/components/ui';
import { flash } from '@/lib/flash';
import { photoUrl } from '@/lib/images';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { VIDEO_TITLE, type Vehicle, type Video } from '@/lib/types';
import { mb, recordVideo, uploadVideo } from '@/lib/videos';

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
        <T v="h3">{VIDEO_TITLE[v.kind] || 'Video'}{v.late ? ', added later' : ''}</T>
        <T v="small">{[v.byName, fmtWhen(v.recordedAt || v.createdAt), `${Math.round(v.durationMs / 1000)} s`].filter(Boolean).join(', ')}</T>
      </View>
      <T v="h3" color={c.ink2}>›</T>
    </Pressable>
  );
}

/**
 * Records a video and uses it for a pick-up or drop-off (the server checks it and records the handover), adds it
 * to a handover that's missing one, or keeps it with the van as a walk-around. Shows the upload as it goes.
 */
export function VideoHandover({ v, kind, assignmentId, title, primary, wide, onDone }: {
  v: Vehicle; kind: Video['kind']; assignmentId?: string; title: string; primary?: boolean; wide?: boolean; onDone?: () => void;
}) {
  const s = useSession();
  const c = useColors();
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const send = async (id: string) => {
    setStep('Checking the video…');
    if (kind === 'walkaround') await ai.addVanVideo({ orgId: s.org!.id, vehicleId: v.id, videoId: id });
    else if (assignmentId) await ai.addHandoverVideo({ orgId: s.org!.id, assignmentId, kind, videoId: id });
    else if (kind === 'pickup') await ai.pickUpVan({ orgId: s.org!.id, vehicleId: v.id, videoId: id });
    else await ai.dropOffVan({ orgId: s.org!.id, vehicleId: v.id, videoId: id });
    // The playback copy is made in the background; nobody waits for it.
    ai.processVideo({ orgId: s.org!.id, videoId: id }).catch(() => {});
    setVideoId(null);
    flash(`van:${v.id}`, kind === 'walkaround' ? `The video of ${v.name} is saved with the van.` : assignmentId ? (kind === 'pickup' ? `The pick-up video of ${v.name} is saved with its history.` : 'The video was added.') : kind === 'pickup' ? `You picked up ${v.name}. The video is kept with its history.` : `You dropped off ${v.name}. The video is kept with its history.`);
    onDone?.();
  };
  const go = async () => {
    setErr(null);
    try {
      if (videoId) { await send(videoId); return; }
      const rec = await recordVideo();
      if (!rec) return;
      setStep(`Uploading${rec.size ? ` ${mb(rec.size)}` : ''}…`);
      const id = await uploadVideo(s.org!.id, s.user!.uid, rec, (sent, total) => setStep(`Uploading ${Math.round((sent / Math.max(1, total)) * 100)}% of ${mb(total)}`));
      setVideoId(id);
      await send(id);
    } catch (e) {
      const m = e instanceof Error && e.message === 'camera' ? 'Allow camera access in Settings to record the video.'
        : e instanceof AiError ? e.message : 'The upload didn\'t finish. Check the connection and try again.';
      setErr(m);
    } finally { setStep(null); }
  };
  // A video that was uploaded but not accepted (for example the van was taken meanwhile) can be sent again
  // without uploading it again, or replaced with a new recording.
  return (
    <View style={{ gap: 6 }}>
      <Button v={primary ? 'primary' : 'secondary'} wide={wide} title={step || (videoId ? 'Try again with this video' : title)} loading={!!step} disabled={!!step} onPress={go} />
      {videoId && !step ? <Button small v="link" title="Record a new video instead" onPress={() => { setVideoId(null); setErr(null); }} /> : null}
      {err ? <T v="small" color={c.alert}>{err}</T> : null}
    </View>
  );
}

export const VIDEO_HOW = 'Film once around the van: start at the front, walk slowly round with the whole side in view, end at the front. 20 to 60 seconds.';
