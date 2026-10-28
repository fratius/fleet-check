import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import { F, MARKER, Svg, mmss } from '@/components/ui';
import { buildFrames, makeSpec, overlaySVG } from '@/lib/frames';
import { useSession } from '@/lib/session';
import { flash } from '@/lib/flash';
import { outbox, queueWalk, useOutbox } from '@/lib/outbox';
import { isBehind, stateText } from '@/components/uploads';
import { saveWalk, type LocalShot } from '@/lib/walks';
import { loc, t, tp } from '@/lib/i18n';

type Slot = LocalShot | 'skip' | null;

function Btn({ title, onPress, kind = 'outline', disabled }: { title: string; onPress: () => void; kind?: 'outline' | 'marker' | 'ghost' | 'armed'; disabled?: boolean }) {
  const bg = kind === 'marker' ? MARKER : kind === 'armed' ? '#FF8A80' : 'transparent';
  const fg = kind === 'marker' || kind === 'armed' ? '#000' : '#fff';
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 46, minWidth: 46, paddingHorizontal: 14, borderRadius: 4, borderWidth: kind === 'ghost' ? 0 : 2,
        borderColor: kind === 'outline' ? 'rgba(255,255,255,0.7)' : bg, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ fontFamily: F.cond, fontSize: 19, color: fg, textDecorationLine: kind === 'ghost' ? 'underline' : 'none' }}>{title}</Text>
    </Pressable>
  );
}

/**
 * The camera covers the whole screen, so it keeps clear of the status bar, the notch or Dynamic Island and the home
 * bar itself. Opened as a full-screen modal on iPhones, the measured safe area can come through as zero for a moment;
 * the phone's own values from app start are the minimum.
 */
function Shell({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const start = initialWindowMetrics?.insets;
  return (
    <View style={[st.root, {
      paddingTop: Math.max(insets.top, start?.top ?? 0), paddingBottom: Math.max(insets.bottom, start?.bottom ?? 0),
      paddingLeft: insets.left, paddingRight: insets.right,
    }, style]}>
      <StatusBar style="light" />
      {children}
    </View>
  );
}

export default function ScanScreen() {
  const { id, handover, assignment } = useLocalSearchParams<{ id: string; handover?: string; assignment?: string }>();
  // Picking up or dropping off a van (drivers, where the station allows it) needs every photo of the walk-around.
  // With `assignment`: the pick-up photos of a van a manager gave the driver (the handover already happened).
  const ho = handover === 'pickup' || handover === 'dropoff' ? handover : null;
  const s = useSession();
  const v = s.vehicles.find((x) => x.id === id);
  const sp = useMemo(() => (v ? makeSpec(v.cls, v) : null), [v]);
  const frames = useMemo(() => (sp ? buildFrames(sp) : []), [sp]);
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [slots, setSlots] = useState<Slot[]>(() => frames.map(() => null));
  const [pending, setPending] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [phase, setPhase] = useState<'aim' | 'review' | 'summary' | 'saving'>('aim');
  const [torch, setTorch] = useState(false);
  const [retakes, setRetakes] = useState(0);
  const [fromSummary, setFromSummary] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busyShot, setBusyShot] = useState(false);
  const [progress, setProgress] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // The walk-around in the outbox (lib/outbox.ts): kept on the phone, uploading, then the pick-up or drop-off.
  const [walkId, setWalkId] = useState<string | null>(null);
  const ob = useOutbox();
  const job = walkId ? ob.jobs.find((j) => j.id === walkId) || null : null;
  const live = walkId ? ob.live.get(walkId) : undefined;
  const sent = !!walkId && ob.done.has(walkId);
  const t0 = useRef(Date.now());
  const ft0 = useRef(Date.now());
  const totalMs = useRef<number | null>(null);
  const { width: W } = useWindowDimensions();
  // The space between the header and the controls, measured, so the camera box never covers either.
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => { if (slots.length !== frames.length) setSlots(frames.map(() => null)); }, [frames, slots.length]);
  // Through: a walk-around opens (in the tab you came from); a pick-up or drop-off goes back to the van.
  useEffect(() => {
    if (!sent || !walkId) return;
    router.back();
    if (!ho) setTimeout(() => router.push(`/walk/${walkId}`), 0);
  }, [sent, walkId, ho]);


  if (!v || !sp) {
    return <Shell style={{ padding: 24, gap: 16, justifyContent: 'center' }}><Text style={st.msg}>{t('This vehicle isn\'t in the fleet any more.')}</Text><Btn title={t('Close')} onPress={() => router.back()} /></Shell>;
  }
  const f = frames[i];
  const taken = slots.filter((x) => x && x !== 'skip').length;

  // Camera box: portrait 3:4, as large as fits between the header and the controls.
  const boxH = area ? Math.floor(Math.min(area.h, (area.w * 4) / 3)) : 0;
  const boxW = Math.floor((boxH * 3) / 4);

  const close = () => {
    if (phase === 'summary' || !slots.some(Boolean)) { router.back(); return; }
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
    router.back();
  };
  const goTo = (k: number, summary?: boolean) => {
    if (walkId) return; // saved and on its way
    setPending(null); setI(k); setPhase('aim'); ft0.current = Date.now();
    if (summary !== undefined) setFromSummary(summary);
  };
  const advance = (next: Slot[]) => {
    if (fromSummary) { toSummary(); return; }
    for (let k = 1; k <= frames.length; k++) { const j = (i + k) % frames.length; if (!next[j]) { goTo(j); return; } }
    toSummary();
  };
  const toSummary = () => {
    if (totalMs.current == null) totalMs.current = Date.now() - t0.current;
    setPending(null); setPhase('summary'); setFromSummary(false);
  };
  const shoot = async () => {
    if (!cam.current || !ready || busyShot) return;
    setBusyShot(true);
    try {
      const p = await cam.current.takePictureAsync({ quality: 0.9 });
      if (p?.uri) { setPending({ uri: p.uri, w: p.width, h: p.height }); setPhase('review'); }
    } catch { setCamErr(t('Couldn\'t take the photo. Try again.')); }
    finally { setBusyShot(false); }
  };
  const use = () => {
    if (!pending) return;
    const prev = slots[i];
    const shot: LocalShot = { n: f.n, label: f.label, uri: pending.uri, w: pending.w, h: pending.h, takenAt: Date.now(),
      retakes: prev && prev !== 'skip' ? (prev.retakes || 0) + 1 : 0 };
    if (prev && prev !== 'skip') setRetakes((r) => r + 1);
    const next = slots.slice(); next[i] = shot; setSlots(next); setPending(null);
    advance(next);
  };
  const retake = () => { setPending(null); setRetakes((r) => r + 1); setPhase('aim'); };
  const skip = () => { const next = slots.slice(); next[i] = 'skip'; setSlots(next); advance(next); };
  const save = async () => {
    const shots = slots.filter((x): x is LocalShot => !!x && x !== 'skip');
    if (!shots.length) { router.back(); return; }
    if (ho && shots.length < frames.length) return;
    if (job) { outbox.retry(job.id); return; }
    setPhase('saving'); setSaveErr(null);
    const meta = { source: 'camera' as const, frames: frames.length, skipped: slots.filter((x) => x === 'skip').length, retakes, totalMs: totalMs.current };
    if (s.mode !== 'firebase') {
      // Test mode: the photos stay on this phone as they are.
      setProgress(t('Saving'));
      try {
        const wid = await saveWalk(s.store!, v, s.user?.uid ?? null, shots, meta);
        router.back(); setTimeout(() => router.push(`/walk/${wid}`), 0);
      } catch { setPhase('summary'); setSaveErr(t('Couldn\'t save the photos.')); }
      return;
    }
    // Kept on the phone first (made smaller), then they upload by themselves, with or without a connection.
    setProgress(t('Saving the photos on this phone…'));
    try {
      setWalkId(await queueWalk({ orgId: s.org!.id, uid: s.user!.uid, v, shots, what: ho || 'walkaround', assignmentId: assignment || null, meta },
        (d, n) => setProgress(t('Saving {done} of {total} on this phone', { done: d, total: n }))));
      setPhase('summary');
    } catch {
      setPhase('summary'); setSaveErr(t('Couldn\'t save the photos on this phone. Try again.'));
    }
  };
  const header = (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Btn title={armed ? t('Tap again to stop') : phase === 'summary' ? t('Done') : t('Close')} kind={armed ? 'armed' : 'outline'} onPress={close} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.step} numberOfLines={1}>{phase === 'summary' || phase === 'saving' ? v.name : t('{van}, frame {n} of {total}', { van: v.name, n: f.n, total: frames.length })}</Text>
          <Text style={st.name} numberOfLines={1}>{phase === 'summary' || phase === 'saving' ? (ho === 'pickup' ? t('Pick-up photos') : ho === 'dropoff' ? t('Drop-off photos') : t('Walk-around done')) : t(f.label)}</Text>
        </View>
        {phase === 'aim' && ready ? <Btn title={t('Light')} kind={torch ? 'marker' : 'outline'} onPress={() => setTorch(!torch)} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {frames.map((fr, k) => {
          const sl = slots[k];
          return <Pressable key={fr.n} accessibilityLabel={t('Frame {n}, {label}', { n: fr.n, label: t(fr.label) })} onPress={() => (phase === 'aim' || phase === 'summary' || phase === 'review') && goTo(k, phase === 'summary' ? true : undefined)}
            style={{ flex: 1, height: 10, borderRadius: 2, backgroundColor: sl === 'skip' ? 'rgba(255,255,255,0.55)' : sl ? MARKER : 'rgba(255,255,255,0.22)',
              borderWidth: k === i && phase !== 'summary' ? 2 : 0, borderColor: '#fff' }} />;
        })}
      </View>
    </View>
  );

  if (!perm) return <Shell style={{ justifyContent: 'center' }}><ActivityIndicator color="#fff" /></Shell>;
  if (!perm.granted) {
    return (
      <Shell style={{ padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={st.name}>{t('Camera access')}</Text>
        <Text style={st.msg}>{t('The walk-around uses the camera with an outline to fit the vehicle into.')}</Text>
        <Btn title={perm.canAskAgain ? t('Allow camera') : t('Open Settings to allow the camera')} kind="marker" onPress={() => requestPerm()} />
        <Btn title={t('Close')} kind="ghost" onPress={() => router.back()} />
      </Shell>
    );
  }

  if (phase === 'summary' || phase === 'saving') {
    const skipped = slots.filter((x) => x === 'skip').length;
    return (
      <Shell>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <View style={st.stats}>
            <View style={st.stat}><Text style={st.statV}>{mmss(totalMs.current)}</Text><Text style={st.statL}>{t('total time')}</Text></View>
            <View style={st.stat}><Text style={st.statV}>{taken}/{frames.length}</Text><Text style={st.statL}>{skipped ? tp(skipped, 'photos, {n} skipped', 'photos, {n} skipped') : t('photos')}</Text></View>
            <View style={st.stat}><Text style={st.statV}>{retakes}</Text><Text style={st.statL}>{t('retakes')}</Text></View>
          </View>
          <Text style={st.note}>{job ? t('The photos are saved on this phone. They upload by themselves, also if the connection drops. You can close this.') : ho && taken < frames.length
            ? (ho === 'pickup' ? tp(frames.length, 'All {n} photos are needed to pick up the van. Tap a missing one to take it.', 'All {n} photos are needed to pick up the van. Tap a missing one to take it.')
              : tp(frames.length, 'All {n} photos are needed to drop off the van. Tap a missing one to take it.', 'All {n} photos are needed to drop off the van. Tap a missing one to take it.'))
            : t('Tap a photo to retake it.')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {frames.map((fr, k) => {
              const sl = slots[k];
              return (
                <Pressable key={fr.n} onPress={() => phase === 'summary' && goTo(k, true)} style={{ width: (W - 32 - 20) / 3 }}>
                  <View style={{ aspectRatio: 3 / 4, borderRadius: 3, overflow: 'hidden', backgroundColor: '#16181C', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                    {sl && sl !== 'skip' ? <Image source={{ uri: sl.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={st.note}>{sl === 'skip' ? t('Skipped') : t('No photo')}</Text>}
                    <View style={st.badge}><Text style={st.badgeT}>{fr.n}</Text></View>
                  </View>
                  <Text style={st.thumbL} numberOfLines={2}>{t(fr.label)}</Text>
                </Pressable>
              );
            })}
          </View>
          {saveErr ? <Text style={[st.note, { color: '#FF8A80' }]}>{saveErr}</Text> : null}
          {job ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                {job.status === 'failed' ? null : <ActivityIndicator color={MARKER} />}
                <Text style={[st.msg, { flex: 1 }, job.status === 'failed' ? { color: '#FF8A80' } : live?.waiting ? { color: MARKER } : null]}>{stateText(job, live, isBehind(ob.jobs, job))}</Text>
              </View>
              {job.status === 'failed' && job.walkSaved && job.then ? <Text style={st.note}>{t('The photos are saved as a walk-around.')}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {job.status === 'failed' ? <Btn title={t('Try again')} kind="marker" onPress={save} /> : null}
                <Btn title={t('Close')} kind={job.status === 'failed' ? 'ghost' : 'outline'} onPress={() => router.back()} />
              </View>
            </>
          ) : phase === 'saving' ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><ActivityIndicator color={MARKER} /><Text style={st.msg}>{progress}</Text></View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {ho ? (
                <Btn title={assignment ? t('Save the pick-up photos') : ho === 'pickup' ? t('Pick up {van}', { van: v.name }) : t('Drop off {van}', { van: v.name })} kind="marker" disabled={taken < frames.length} onPress={save} />
              ) : taken ? <Btn title={tp(taken, 'Save {n} photo', 'Save {n} photos')} kind="marker" onPress={save} /> : null}
              <Btn title={t('Discard')} kind="ghost" onPress={() => router.back()} />
            </View>
          )}
          <Text style={st.note}>{ho ? (ho === 'pickup' ? t('The photos show the van\'s state when you took it, so damage that was already there isn\'t put on you. They\'re kept with the van\'s history.')
            : t('The photos show the van\'s state when you brought it back, so damage that was already there isn\'t put on you. They\'re kept with the van\'s history.'))
            : s.mode === 'firebase' ? t('Photos upload to your company\'s storage, so the walk-around is kept as evidence.') : t('Firebase isn\'t connected yet, so photos stay on this phone.')}</Text>
        </ScrollView>
      </Shell>
    );
  }

  const xml = boxW > 0 ? overlaySVG(sp, f, 3 / 4, boxW) : '';
  return (
    <Shell>
      {header}
      <View style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setArea((a) => (a && Math.abs(a.w - width) < 1 && Math.abs(a.h - height) < 1 ? a : { w: width, h: height })); }}>
        {boxH > 0 ? <View style={{ width: boxW, height: boxH, overflow: 'hidden', backgroundColor: '#111' }}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" ratio="4:3" enableTorch={torch && phase === 'aim'} animateShutter
            onCameraReady={() => setReady(true)} onMountError={(e) => setCamErr(e.message || t('The camera couldn\'t start.'))} />
          {phase === 'review' && pending ? <Image source={{ uri: pending.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}><Svg xml={xml} width={boxW} height={boxH} /></View>
          {!ready && !camErr ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" /> : null}
        </View> : null}
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10, minHeight: 196 }}>
        {camErr ? <Text style={[st.hint, { color: '#FF8A80' }]}>{camErr}</Text> : null}
        <Text style={st.hint}>
          {phase === 'review' ? t('Does the vehicle line up with the outline?') : <><Text style={{ color: MARKER, fontFamily: F.semi }}>{t('Fit the vehicle to the outline.')} </Text>{t('About {m} m away.', { m: f.dist.toLocaleString(loc(), { maximumFractionDigits: 1 }) })} {t(f.hint)}</>}
        </Text>
        {phase === 'review' ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
            <Btn title={t('Retake')} onPress={retake} />
            <Btn title={t('Use photo')} kind="marker" onPress={use} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              {fromSummary ? <Btn title={t('Cancel')} kind="ghost" onPress={toSummary} /> : i > 0 ? <Btn title={t('Back')} kind="ghost" onPress={() => goTo(i - 1)} /> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Take photo {n}', { n: f.n })} disabled={!ready || busyShot} onPress={shoot}
              style={({ pressed }) => ({ width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff', backgroundColor: MARKER, opacity: !ready || busyShot ? 0.4 : pressed ? 0.8 : 1 })} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>{ho ? null : <Btn title={t('Skip')} kind="ghost" onPress={skip} />}</View>
          </View>
        )}
      </View>
    </Shell>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  step: { fontFamily: F.body, fontSize: 13, color: '#B9BEC7' },
  name: { fontFamily: F.cond, fontSize: 22, color: '#fff' },
  msg: { fontFamily: F.body, fontSize: 16, color: '#E6E8EC' },
  hint: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: '#E6E8EC', textAlign: 'center' },
  note: { fontFamily: F.body, fontSize: 13, color: '#B9BEC7' },
  stats: { flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 4 },
  stat: { flex: 1, padding: 10 },
  statV: { fontFamily: F.condBold, fontSize: 30, color: '#fff' },
  statL: { fontFamily: F.body, fontSize: 12, color: '#B9BEC7' },
  badge: { position: 'absolute', left: 4, top: 4, backgroundColor: MARKER, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  badgeT: { fontFamily: F.condBold, fontSize: 14, color: '#000' },
  thumbL: { fontFamily: F.cond, fontSize: 15, color: '#fff', marginTop: 4 },
});
