import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, MARKER, T } from '@/components/ui';
import { t, lang } from '@/lib/i18n';
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
    // A Modal is its own native window: the app's SafeAreaProvider doesn't reach it, so it gets its own. Before this,
    // SafeAreaView inside the Modal got no size and the controls (Cancel, record) were off screen: only the camera showed.
    <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => onDone(null)}
      supportedOrientations={['portrait', 'landscape']} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {open ? <Recorder onDone={onDone} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function Recorder({ onDone }: { onDone: (r: Recorded | null) => void }) {
  const st = styles();
  const [perm, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(0);
  const cancelled = useRef(false);
  // Same as the photo scan screen: plain Views padded by the insets, with the window's insets as a floor.
  const insets = useSafeAreaInsets();
  const first = initialWindowMetrics?.insets;
  const pad = {
    top: Math.max(insets.top, first?.top ?? 0, 12), bottom: Math.max(insets.bottom, first?.bottom ?? 0, 12),
    left: Math.max(insets.left, first?.left ?? 0), right: Math.max(insets.right, first?.right ?? 0),
  };

  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) request(); }, [perm, request]);
  useEffect(() => {
    if (!rec) return;
    const h = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(h);
  }, [rec]);

  const start = async () => {
    if (!cam.current || rec) return;
    setErr(null); setSecs(0); started.current = Date.now(); cancelled.current = false; setRec(true);
    try {
      const r = await cam.current.recordAsync({ maxDuration: MAX_S, codec: 'avc1' });
      setRec(false);
      if (cancelled.current || !r?.uri) { onDone(null); return; }
      const mov = r.uri.toLowerCase().endsWith('.mov');
      onDone({ uri: r.uri, mime: mov ? 'video/quicktime' : 'video/mp4', ext: mov ? 'mov' : 'mp4', size: null });
    } catch (e) {
      setRec(false);
      if (cancelled.current) { onDone(null); return; }
      setErr(e instanceof Error && e.message ? e.message : t('The camera couldn\'t start.'));
    }
  };
  const stop = () => { if (rec && secs >= MIN_S) cam.current?.stopRecording(); };
  /** Always available, also while recording: the recording is thrown away and nothing is uploaded. */
  const close = () => {
    if (rec) { cancelled.current = true; cam.current?.stopRecording(); return; } // recordAsync then ends with onDone(null)
    onDone(null);
  };
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (perm && !perm.granted) {
    return (
      <View style={[st.page, { justifyContent: 'center', padding: 24, gap: 16, paddingTop: pad.top, paddingBottom: pad.bottom }]}>
        <T color="#fff">{t('Allow camera access in Settings to record the video.')}</T>
        <Button title={t('Cancel')} onPress={() => onDone(null)} />
      </View>
    );
  }
  return (
    <View style={st.page}>
      {perm?.granted ? (
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" mode="video" videoQuality="720p" videoBitrate={VIDEO_BITRATE} mute
          onCameraReady={() => setReady(true)} onMountError={(e) => setErr(e.message || t('The camera couldn\'t start.'))} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, st.over, { paddingTop: pad.top, paddingBottom: pad.bottom, paddingLeft: pad.left, paddingRight: pad.right }]} pointerEvents="box-none">
        <View style={st.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Cancel')} onPress={close} hitSlop={12} style={st.close}>
            <T v="h3" color="#fff">✕</T>
          </Pressable>
          <T color="#fff" style={{ flex: 1 }}>{t('Film once around the van: start at the front, walk slowly round with the whole side in view, end at the front. 20 to 60 seconds.')}</T>
          {rec ? <View style={st.time}><View style={st.dot} /><T v="h3" color="#fff">{mmss}</T></View> : null}
        </View>
        <View style={[st.bar, { flexDirection: 'column', gap: 12 }]}>
          {err ? <T v="small" color="#FF8A80">{err}</T> : null}
          {rec && secs < MIN_S ? <T v="small" color={MARKER}>{t('Keep filming: at least {n} seconds.', { n: MIN_S })}</T> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' }}>
            <View style={{ flex: 1 }}><Button v="link" title={t('Cancel')} onPress={close} style={{ alignSelf: 'flex-start' }} /></View>
            <Pressable accessibilityRole="button" accessibilityLabel={rec ? t('Stop recording') : t('Start recording')} disabled={!ready || (rec && secs < MIN_S)}
              onPress={rec ? stop : start} style={[st.shutter, { opacity: !ready || (rec && secs < MIN_S) ? 0.5 : 1 }]}>
              <View style={rec ? st.stopIn : st.recIn} />
            </Pressable>
            <View style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </View>
  );
}

// Made per language: the fonts and heading sizes depend on it (components/ui.tsx).
const makeSheet = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  over: { justifyContent: 'space-between', zIndex: 1, elevation: 1 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recIn: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FF3B30' },
  stopIn: { width: 28, height: 28, borderRadius: 4, backgroundColor: '#FF3B30' },
});

const sheets = new Map<string, ReturnType<typeof makeSheet>>();
function styles() {
  const k = lang();
  let s = sheets.get(k);
  if (!s) { s = makeSheet(); sheets.set(k, s); }
  return s;
}
