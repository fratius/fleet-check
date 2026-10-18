import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { F, MARKER, Svg, mmss } from '@/components/ui';
import { buildFrames, makeSpec, overlaySVG } from '@/lib/frames';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import { saveWalk, type LocalShot } from '@/lib/walks';

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

export default function ScanScreen() {
  const { id, handover } = useLocalSearchParams<{ id: string; handover?: string }>();
  // Picking up or dropping off a van (drivers, where the station allows it) needs every photo of the walk-around.
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
  const [walkId, setWalkId] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const ft0 = useRef(Date.now());
  const totalMs = useRef<number | null>(null);
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  useEffect(() => { if (slots.length !== frames.length) setSlots(frames.map(() => null)); }, [frames, slots.length]);

  if (!v || !sp) {
    return <SafeAreaView style={st.root}><Text style={st.msg}>This vehicle isn&apos;t in the fleet any more.</Text><Btn title="Close" onPress={() => router.back()} /></SafeAreaView>;
  }
  const f = frames[i];
  const taken = slots.filter((x) => x && x !== 'skip').length;

  // Camera box: portrait 3:4, as large as fits between the header and the controls.
  const headH = 92, footH = 196;
  const boxH = Math.max(240, Math.min(((W) * 4) / 3, H - insets.top - insets.bottom - headH - footH));
  const boxW = Math.round((boxH * 3) / 4);

  const close = () => {
    if (phase === 'summary' || !slots.some(Boolean)) { router.back(); return; }
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
    router.back();
  };
  const goTo = (k: number, summary?: boolean) => {
    if (walkId) return; // already uploaded for the pick-up or drop-off
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
    } catch { setCamErr('Couldn\'t take the photo. Try again.'); }
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
    setPhase('saving'); setSaveErr(null); setProgress(s.mode === 'firebase' ? `Uploading 0 of ${shots.length}` : 'Saving');
    let wid = walkId;
    try {
      if (!wid) {
        wid = await saveWalk(s.store!, v, s.user?.uid ?? null, shots, {
          source: 'camera', frames: frames.length, skipped: slots.filter((x) => x === 'skip').length, retakes, totalMs: totalMs.current,
        }, (d, t) => setProgress(`Uploading ${d} of ${t}`));
        setWalkId(wid);
      }
    } catch {
      setPhase('summary'); setSaveErr('Couldn\'t upload the photos. Check the connection and tap Save again.');
      return;
    }
    if (!ho) { router.replace(`/walk/${wid}`); return; }
    setProgress(ho === 'pickup' ? `Picking up ${v.name}` : `Dropping off ${v.name}`);
    try {
      await (ho === 'pickup' ? ai.pickUpVan : ai.dropOffVan)({ orgId: s.org!.id, vehicleId: v.id, walkId: wid });
      router.replace({ pathname: '/vehicle/[id]', params: { id: v.id, done: ho } });
    } catch (e) {
      setPhase('summary');
      setSaveErr(`${e instanceof AiError ? e.message : 'Couldn\'t reach the server.'} The photos are saved as a walk-around.`);
    }
  };

  const header = (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Btn title={armed ? 'Tap again to stop' : phase === 'summary' ? 'Done' : 'Close'} kind={armed ? 'armed' : 'outline'} onPress={close} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.step} numberOfLines={1}>{phase === 'summary' || phase === 'saving' ? v.name : `${v.name}, frame ${f.n} of ${frames.length}`}</Text>
          <Text style={st.name} numberOfLines={1}>{phase === 'summary' || phase === 'saving' ? (ho === 'pickup' ? 'Pick-up photos' : ho === 'dropoff' ? 'Drop-off photos' : 'Walk-around done') : f.label}</Text>
        </View>
        {phase === 'aim' && ready ? <Btn title="Light" kind={torch ? 'marker' : 'outline'} onPress={() => setTorch(!torch)} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {frames.map((fr, k) => {
          const sl = slots[k];
          return <Pressable key={fr.n} accessibilityLabel={`Frame ${fr.n}, ${fr.label}`} onPress={() => (phase === 'aim' || phase === 'summary' || phase === 'review') && goTo(k, phase === 'summary' ? true : undefined)}
            style={{ flex: 1, height: 10, borderRadius: 2, backgroundColor: sl === 'skip' ? 'rgba(255,255,255,0.55)' : sl ? MARKER : 'rgba(255,255,255,0.22)',
              borderWidth: k === i && phase !== 'summary' ? 2 : 0, borderColor: '#fff' }} />;
        })}
      </View>
    </View>
  );

  if (!perm) return <SafeAreaView style={st.root}><ActivityIndicator color="#fff" /></SafeAreaView>;
  if (!perm.granted) {
    return (
      <SafeAreaView style={[st.root, { padding: 24, gap: 16, justifyContent: 'center' }]}>
        <Text style={st.name}>Camera access</Text>
        <Text style={st.msg}>The walk-around uses the camera with an outline to fit the vehicle into.</Text>
        <Btn title={perm.canAskAgain ? 'Allow camera' : 'Open Settings to allow the camera'} kind="marker" onPress={() => requestPerm()} />
        <Btn title="Close" kind="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (phase === 'summary' || phase === 'saving') {
    const skipped = slots.filter((x) => x === 'skip').length;
    return (
      <SafeAreaView style={st.root} edges={['top', 'bottom']}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <View style={st.stats}>
            <View style={st.stat}><Text style={st.statV}>{mmss(totalMs.current)}</Text><Text style={st.statL}>total time</Text></View>
            <View style={st.stat}><Text style={st.statV}>{taken}/{frames.length}</Text><Text style={st.statL}>photos{skipped ? `, ${skipped} skipped` : ''}</Text></View>
            <View style={st.stat}><Text style={st.statV}>{retakes}</Text><Text style={st.statL}>retakes</Text></View>
          </View>
          <Text style={st.note}>{walkId ? 'Uploaded.' : ho && taken < frames.length ? `All ${frames.length} photos are needed to ${ho === 'pickup' ? 'pick up' : 'drop off'} the van. Tap a missing one to take it.` : 'Tap a photo to retake it.'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {frames.map((fr, k) => {
              const sl = slots[k];
              return (
                <Pressable key={fr.n} onPress={() => phase === 'summary' && goTo(k, true)} style={{ width: (W - 32 - 20) / 3 }}>
                  <View style={{ aspectRatio: 3 / 4, borderRadius: 3, overflow: 'hidden', backgroundColor: '#16181C', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                    {sl && sl !== 'skip' ? <Image source={{ uri: sl.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={st.note}>{sl === 'skip' ? 'Skipped' : 'No photo'}</Text>}
                    <View style={st.badge}><Text style={st.badgeT}>{fr.n}</Text></View>
                  </View>
                  <Text style={st.thumbL} numberOfLines={2}>{fr.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {saveErr ? <Text style={[st.note, { color: '#FF8A80' }]}>{saveErr}</Text> : null}
          {phase === 'saving' ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><ActivityIndicator color={MARKER} /><Text style={st.msg}>{progress}</Text></View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {ho ? (
                <Btn title={walkId ? 'Try again' : ho === 'pickup' ? `Pick up ${v.name}` : `Drop off ${v.name}`} kind="marker" disabled={taken < frames.length} onPress={save} />
              ) : taken ? <Btn title={`Save ${taken} photos`} kind="marker" onPress={save} /> : null}
              <Btn title={walkId ? 'Close' : 'Discard'} kind="ghost" onPress={() => router.back()} />
            </View>
          )}
          <Text style={st.note}>{ho ? 'The photos show the van\'s state when you ' + (ho === 'pickup' ? 'took it' : 'brought it back') + ', so damage that was already there isn\'t put on you. They\'re kept with the van\'s history.'
            : s.mode === 'firebase' ? 'Photos upload to your company\'s storage, so the walk-around is kept as evidence.' : 'Firebase isn\'t connected yet, so photos stay on this phone.'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const xml = overlaySVG(sp, f, 3 / 4, boxW);
  return (
    <SafeAreaView style={st.root} edges={['top', 'bottom']}>
      {header}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: boxW, height: boxH, overflow: 'hidden', backgroundColor: '#111' }}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" ratio="4:3" enableTorch={torch && phase === 'aim'} animateShutter
            onCameraReady={() => setReady(true)} onMountError={(e) => setCamErr(e.message || 'The camera couldn\'t start.')} />
          {phase === 'review' && pending ? <Image source={{ uri: pending.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}><Svg xml={xml} width={boxW} height={boxH} /></View>
          {!ready && !camErr ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" /> : null}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10, gap: 10, minHeight: footH - 10 }}>
        {camErr ? <Text style={[st.hint, { color: '#FF8A80' }]}>{camErr}</Text> : null}
        <Text style={st.hint}>
          {phase === 'review' ? 'Does the vehicle line up with the outline?' : <><Text style={{ color: MARKER, fontFamily: F.semi }}>Fit the vehicle to the outline. </Text>About {f.dist.toLocaleString(undefined, { maximumFractionDigits: 1 })} m away. {f.hint}</>}
        </Text>
        {phase === 'review' ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
            <Btn title="Retake" onPress={retake} />
            <Btn title="Use photo" kind="marker" onPress={use} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              {fromSummary ? <Btn title="Cancel" kind="ghost" onPress={toSummary} /> : i > 0 ? <Btn title="Back" kind="ghost" onPress={() => goTo(i - 1)} /> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Take photo ${f.n}`} disabled={!ready || busyShot} onPress={shoot}
              style={({ pressed }) => ({ width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff', backgroundColor: MARKER, opacity: !ready || busyShot ? 0.4 : pressed ? 0.8 : 1 })} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>{ho ? null : <Btn title="Skip" kind="ghost" onPress={skip} />}</View>
          </View>
        )}
      </View>
    </SafeAreaView>
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
