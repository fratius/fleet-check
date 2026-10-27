import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, MARKER, T } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { Recorded } from '@/lib/videos';

/** The server's limits for a van video (functions: VIDEO_MIN_MS, VIDEO_MAX_MS). */
const MIN_S = 8, MAX_S = 300;
/**
 * Records the van video in the app (iPhone and Android): 720p H.264 at about 3 Mbit/s, without sound. That's what
 * the server keeps anyway, so the upload is small (about 11 MB for 30 seconds instead of 50 to 200 MB from the
 * phone's camera app) and the server only repackages it instead of converting it.
 */
export const VIDEO_BITRATE = 3_000_000;

export function VideoRecorder({ open, onDone }: { open: boolean; onDone: (r: Recorded | null) => void }) {
  return (
    <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => onDone(null)} supportedOrientations={['portrait', 'landscape']}>
      {open ? <Recorder onDone={onDone} /> : null}
    </Modal>
  );
}

function Recorder({ onDone }: { onDone: (r: Recorded | null) => void }) {
  const [perm, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(0);

  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) request(); }, [perm, request]);
  useEffect(() => {
    if (!rec) return;
    const h = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(h);
  }, [rec]);

  const start = async () => {
    if (!cam.current || rec) return;
    setErr(null); setSecs(0); started.current = Date.now(); setRec(true);
    try {
      const r = await cam.current.recordAsync({ maxDuration: MAX_S, codec: 'avc1' });
      setRec(false);
      if (!r?.uri) { onDone(null); return; }
      const mov = r.uri.toLowerCase().endsWith('.mov');
      onDone({ uri: r.uri, mime: mov ? 'video/quicktime' : 'video/mp4', ext: mov ? 'mov' : 'mp4', size: null });
    } catch (e) {
      setRec(false);
      setErr(e instanceof Error && e.message ? e.message : t('The camera couldn\'t start.'));
    }
  };
  const stop = () => { if (rec && secs >= MIN_S) cam.current?.stopRecording(); };
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (perm && !perm.granted) {
    return (
      <SafeAreaView style={[st.page, { justifyContent: 'center', padding: 24, gap: 16 }]}>
        <T color="#fff">{t('Allow camera access in Settings to record the video.')}</T>
        <Button title={t('Cancel')} onPress={() => onDone(null)} />
      </SafeAreaView>
    );
  }
  return (
    <View style={st.page}>
      {perm?.granted ? (
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" mode="video" videoQuality="720p" videoBitrate={VIDEO_BITRATE} mute
          onCameraReady={() => setReady(true)} onMountError={(e) => setErr(e.message || t('The camera couldn\'t start.'))} />
      ) : null}
      <SafeAreaView style={{ flex: 1, justifyContent: 'space-between' }} pointerEvents="box-none">
        <View style={st.bar}>
          <T color="#fff" style={{ flex: 1 }}>{t('Film once around the van: start at the front, walk slowly round with the whole side in view, end at the front. 20 to 60 seconds.')}</T>
          {rec ? <View style={st.time}><View style={st.dot} /><T v="h3" color="#fff">{mmss}</T></View> : null}
        </View>
        <View style={[st.bar, { flexDirection: 'column', gap: 12 }]}>
          {err ? <T v="small" color="#FF8A80">{err}</T> : null}
          {rec && secs < MIN_S ? <T v="small" color={MARKER}>{t('Keep filming: at least {n} seconds.', { n: MIN_S })}</T> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' }}>
            <View style={{ flex: 1 }}>{rec ? null : <Button v="link" title={t('Cancel')} onPress={() => onDone(null)} style={{ alignSelf: 'flex-start' }} />}</View>
            <Pressable accessibilityRole="button" accessibilityLabel={rec ? t('Stop recording') : t('Start recording')} disabled={!ready || (rec && secs < MIN_S)}
              onPress={rec ? stop : start} style={[st.shutter, { opacity: !ready || (rec && secs < MIN_S) ? 0.5 : 1 }]}>
              <View style={rec ? st.stopIn : st.recIn} />
            </Pressable>
            <View style={{ flex: 1 }} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recIn: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FF3B30' },
  stopIn: { width: 28, height: 28, borderRadius: 4, backgroundColor: '#FF3B30' },
});
