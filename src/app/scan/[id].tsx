import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import { F, MARKER, Svg, mmss, hs } from '@/components/ui';
import { buildFrames, makeSpec, overlaySVG } from '@/lib/frames';
import { useSession } from '@/lib/session';
import { flash } from '@/lib/flash';
import { outbox, outboxReady, queueWalk, useOutbox, type PickInfo } from '@/lib/outbox';
import { toVansTab, usePickVan } from '@/lib/pickvan';
import { isBehind, stateText } from '@/components/uploads';
import { saveWalk, type LocalShot } from '@/lib/walks';
import { newId, upright } from '@/lib/images';
import { draftKey, dropDraft, keepDraftPhoto, loadDraft, saveDraft, type DraftSlot, type WalkDraft } from '@/lib/walkdraft';
import { ISSUE_TEXT, checkPhoto } from '@/lib/quality';
import type { PhotoQuality } from '@/lib/types';
import { loc, t, tp, lang } from '@/lib/i18n';
import { vanName } from '@/lib/vans';

type Slot = LocalShot | 'skip' | null;
/** What the camera needs of the navigator: to hold a "back" until the driver chose what happens to the photos. */
type LeaveEvent = { preventDefault(): void; data: { action: unknown } };
type Nav = { addListener(type: 'beforeRemove', cb: (e: LeaveEvent) => void): () => void; dispatch(action: never): void };

function Btn({ title, onPress, kind = 'outline', disabled }: { title: string; onPress: () => void; kind?: 'outline' | 'marker' | 'ghost' | 'armed'; disabled?: boolean }) {
  const bg = kind === 'marker' ? MARKER : kind === 'armed' ? '#FF8A80' : 'transparent';
  const fg = kind === 'marker' || kind === 'armed' ? '#000' : '#fff';
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 46, minWidth: 46, paddingHorizontal: 14, borderRadius: 4, borderWidth: kind === 'ghost' ? 0 : 2,
        borderColor: kind === 'outline' ? 'rgba(255,255,255,0.7)' : bg, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ fontFamily: F.cond, fontSize: hs(19), color: fg, textDecorationLine: kind === 'ghost' ? 'underline' : 'none' }}>{title}</Text>
    </Pressable>
  );
}

/**
 * The camera covers the whole screen, so it keeps clear of the status bar, the notch or Dynamic Island and the home
 * bar itself. Opened as a full-screen modal on iPhones, the measured safe area can come through as zero for a moment;
 * the phone's own values from app start are the minimum.
 */
function Shell({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const st = styles();
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
  const st = styles();
  const { id, handover, assignment, plate, takeOver, expect } = useLocalSearchParams<{ id: string; handover?: string; assignment?: string; plate?: string; takeOver?: string; expect?: string }>();
  // Picking up or dropping off a van (drivers, where the station allows it) needs every photo of the walk-around.
  // With `assignment`: the pick-up photos of a van a manager gave the driver (the handover already happened).
  const ho = handover === 'pickup' || handover === 'dropoff' ? handover : null;
  const s = useSession();
  // A driver's pick-up: the van found by its plate (drivers don't see the station's other vans; lib/pickvan.ts).
  const own = s.vehicles.find((x) => x.id === id);
  const picking = ho === 'pickup' && !assignment && !own;
  const { pv, err: pickErr } = usePickVan(picking ? id : null, picking ? plate || null : null);
  // Kept once sent: the van is the driver's soon after, and the camera still goes where a pick-up by plate goes.
  const byPlate = useRef(false);
  useEffect(() => { if (picking) byPlate.current = true; }, [picking]);
  const v = own || pv?.van;
  const pick: PickInfo | null = ho === 'pickup' && !assignment && (plate || pv?.plate || own?.plate)
    ? { plate: (plate || pv?.plate || own?.plate)!, ...(takeOver === '1' ? { takeOver: true, expect: expect || null } : {}) } : null;
  const sp = useMemo(() => (v ? makeSpec(v.cls, v) : null), [v]);
  const frames = useMemo(() => (sp ? buildFrames(sp) : []), [sp]);
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [slots, setSlots] = useState<Slot[]>(() => frames.map(() => null));
  const [pending, setPending] = useState<{ uri: string; w: number; h: number; view: string } | null>(null);
  // The photo check of the photo under review (lib/quality.ts): 'checking' until it's measured, null if it couldn't be.
  const [quality, setQuality] = useState<PhotoQuality | null | 'checking'>(null);
  const checkSeq = useRef(0);
  const [phase, setPhase] = useState<'aim' | 'review' | 'summary' | 'saving'>('aim');
  const [torch, setTorch] = useState(false);
  const [retakes, setRetakes] = useState(0);
  const retakesNow = useRef(0);
  useEffect(() => { retakesNow.current = retakes; }, [retakes]);
  const [fromSummary, setFromSummary] = useState(false);
  const [busyShot, setBusyShot] = useState(false);
  const [progress, setProgress] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // The walk-around in the outbox (lib/outbox.ts): kept on the phone, uploading, then the pick-up or drop-off.
  const [walkId, setWalkId] = useState<string | null>(null);
  const ob = useOutbox();
  const job = walkId ? ob.jobs.find((j) => j.id === walkId) || null : null;
  const live = walkId ? ob.live.get(walkId) : undefined;
  // Through (also when another tab of the web app sent it: then it's just gone from the list).
  const sent = !!walkId && (ob.done.has(walkId) || !job);
  // The draft on the phone (lib/walkdraft.ts): every used photo is kept at once, so a reload or a closed app loses
  // nothing, and its id becomes the walk-around's, so it's sent once whatever is pressed (product owner, 2026-11-26).
  const what = ho || 'walkaround';
  const dkey = s.mode === 'firebase' && s.user && s.org && id ? draftKey({ uid: s.user.uid, orgId: s.org.id, vehicleId: id, what, assignmentId: assignment || null }) : null;
  const draft = useRef<WalkDraft | null>(null);
  const kept = useRef(new Map<number, { key: string; uri: string }>());
  const keeping = useRef<Promise<void>>(Promise.resolve());
  // Which draft was looked for (the account may load a moment after the screen).
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  // (The real app looks first; test mode keeps no drafts.)
  const restored = s.mode !== 'firebase' || !id || (!!dkey && restoredFor === dkey);
  const [resumed, setResumed] = useState<{ kept: number; dropped: number } | null>(null);
  // Leaving with photos that aren't sent asks first: send, keep taking, or throw away (nothing is lost silently).
  const [leave, setLeave] = useState(false);
  const allowLeave = useRef(false);
  const leaveAction = useRef<unknown>(null);
  const nav = useNavigation() as unknown as Nav;
  const dirty = !walkId && slots.some((x) => !!x && x !== 'skip');
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // The iPhone's back swipe and the Android back button ask too. A browser's own back button can't be held (the
  // navigator lets it through on the web): there, as when the app or tab is closed, the draft keeps every photo and
  // the camera continues with them next time.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    return nav.addListener('beforeRemove', (e) => {
      if (allowLeave.current || !dirtyRef.current) return;
      e.preventDefault();
      leaveAction.current = e.data.action;
      setLeave(true);
    });
  }, [nav]);
  const t0 = useRef(Date.now());
  const ft0 = useRef(Date.now());
  const totalMs = useRef<number | null>(null);
  const { width: W, height: winH } = useWindowDimensions();
  // Only a browser turns the page with the phone (the apps stay upright): then the camera box lies flat too.
  const wide = Platform.OS === 'web' && W > winH;
  // The space between the header and the controls, measured, so the camera box never covers either.
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => { if (slots.length !== frames.length) setSlots(frames.map(() => null)); }, [frames, slots.length]);
  // Through: a walk-around opens (in the tab you came from); a pick-up or drop-off goes back to the van. Opened by a
  // link or after a reload there is nothing to go back to: then the van's (or walk-around's) page opens instead.
  const went = useRef(false);
  useEffect(() => {
    if (!sent || !walkId || went.current) return;
    went.current = true;
    allowLeave.current = true;
    if (!ho) {
      if (router.canGoBack()) { router.back(); setTimeout(() => router.push(`/walk/${walkId}`), 0); } else router.replace(`/walk/${walkId}`);
      return;
    }
    // A pick-up by the plate: to the Vans tab, which shows it on its way and then the van (not back to the plate page,
    // which would offer the same pick-up again).
    if (byPlate.current) {
      if (router.canGoBack()) { router.back(); setTimeout(toVansTab, 0); } else router.replace('/');
      return;
    }
    if (router.canGoBack()) router.back(); else router.replace({ pathname: '/vehicle/[id]', params: { id: id! } });
  }, [sent, walkId, ho, id]);
  // Opening: the draft of this walk-around, if one is kept on the phone, or (a pick-up or drop-off) the one already
  // on its way from this phone (pressed, then the page reloaded).
  useEffect(() => {
    if (!dkey || !frames.length || restored) return;
    let gone = false;
    (async () => {
      await outboxReady();
      const got = await loadDraft(dkey, frames.length, !!ho);
      if (gone) return;
      const busy = ho ? outbox.jobs.find((j) => j.type === 'walk' && j.vehicleId === id && j.what === ho && j.uid === s.user?.uid) : undefined;
      if (got && (outbox.jobs.some((j) => j.id === got.draft.id) || outbox.done.has(got.draft.id))) {
        await dropDraft(dkey, got.draft);
        setWalkId(got.draft.id); setPhase('summary');
      } else if (got) {
        draft.current = got.draft;
        got.slots.forEach((x, k) => { const d = got.draft.slots[k]; if (x && x !== 'skip' && d && d !== 'skip') kept.current.set(d.n, { key: d.key, uri: x.uri }); });
        setSlots(got.slots); setRetakes(got.draft.retakes);
        t0.current = Date.now() - (got.draft.elapsedMs || 0); totalMs.current = got.draft.totalMs;
        const first = got.slots.findIndex((x) => !x);
        if (first < 0) setPhase('summary'); else setI(first);
        setResumed({ kept: got.slots.filter((x) => !!x && x !== 'skip').length, dropped: got.dropped });
      } else if (busy) {
        setWalkId(busy.id); setPhase('summary');
      }
    })().catch((e) => console.warn('Draft not read', e)).finally(() => { if (!gone) setRestoredFor(dkey); });
    return () => { gone = true; };
  }, [dkey, frames.length, restored, ho, id, s.user?.uid]);


  const goAway = () => {
    allowLeave.current = true;
    if (router.canGoBack()) router.back();
    // A driver has no page for a van that isn't theirs: the Vans tab.
    else if (s.role === 'driver' && !own) router.replace('/');
    else router.replace({ pathname: '/vehicle/[id]', params: { id: id! } });
  };

  // Drivers have only their own van in the app (blind test, cause 3a): what the server would refuse is said here, before
  // the van is looked for.
  const myVanNow = s.role === 'driver' && s.user ? s.vehicles.find((x) => !x.retired && x.assignedTo?.driverId === s.user!.uid) : undefined;
  if (s.role === 'driver' && !own && !assignment && !walkId) {
    const why = ho === 'dropoff' ? t('You don\'t have this van.')
      : ho === 'pickup' && myVanNow ? t('You have {van}. Drop it off first, with a video or its photos, then you can pick up this one.', { van: vanName(myVanNow) })
        : ho !== 'pickup' ? t('You don\'t have this van.')
          : !plate && !pv ? t('Pick up a van by its number plate.') : pickErr;
    if (why) {
      return <Shell style={{ padding: 24, gap: 16, justifyContent: 'center' }}><Text style={st.msg}>{why}</Text>
        {ho === 'pickup' && !myVanNow ? <Btn title={t('Pick up a van')} onPress={() => { allowLeave.current = true; router.replace('/pickup'); }} /> : null}
        <Btn title={t('Close')} onPress={goAway} /></Shell>;
    }
    if (ho === 'pickup' && !pv) return <Shell style={{ justifyContent: 'center' }}><ActivityIndicator color="#fff" /></Shell>;
  }
  if (!v || !sp) {
    return <Shell style={{ padding: 24, gap: 16, justifyContent: 'center' }}><Text style={st.msg}>{t('This vehicle isn\'t in the fleet any more.')}</Text><Btn title={t('Close')} onPress={goAway} /></Shell>;
  }
  if (!restored) return <Shell style={{ justifyContent: 'center' }}><ActivityIndicator color="#fff" /></Shell>;
  // A pick-up or drop-off the server would refuse says so before any photo (blind tester: a drop-off camera of a van
  // the driver no longer had took 12 photos and only then refused).
  if (ho && !assignment && !walkId && s.user) {
    const me = s.user.uid;
    const mine = s.vehicles.find((x) => !x.retired && x.assignedTo?.driverId === me);
    const why = ho === 'dropoff' ? (v.assignedTo?.driverId !== me ? t('You don\'t have this van.') : null)
      : mine?.id === v.id ? t('You have {van}.', { van: vanName(v) })
        : mine ? t('You have {van}. Drop it off first, with a video or its photos, then you can pick up this one.', { van: vanName(mine) }) : null;
    if (why) return <Shell style={{ padding: 24, gap: 16, justifyContent: 'center' }}><Text style={st.msg}>{why}</Text><Btn title={t('Close')} onPress={goAway} /></Shell>;
  }
  const f = frames[i];
  const taken = slots.filter((x) => x && x !== 'skip').length;

  // Camera box: upright 3:4, as large as fits between the header and the controls. A frame taken sideways keeps
  // the upright box in the apps (the outline is drawn turned, the driver turns the phone); in a browser that turned
  // the page, the box lies flat (4:3) for it.
  const land = f.orient === 'landscape', flat = land && wide;
  const boxH = area ? Math.floor(flat ? Math.min(area.h, (area.w * 3) / 4) : Math.min(area.h, (area.w * 4) / 3)) : 0;
  const boxW = Math.floor(flat ? (boxH * 4) / 3 : (boxH * 3) / 4);
  const holdHint = land ? (wide ? null : t('Turn the phone sideways, its top to the left.'))
    : wide || (i > 0 && frames[i - 1].orient === 'landscape') ? t('Hold the phone upright.') : null;

  const close = () => {
    if (!dirty) { goAway(); return; }
    leaveAction.current = null;
    setLeave(true);
  };
  /** Keeps the photos as they are now on the phone (one at a time, in order). */
  const keep = (next: Slot[]) => {
    if (!dkey) return;
    const dk = dkey;
    keeping.current = keeping.current.then(async () => {
      if (!draft.current) draft.current = { id: newId(), slots: [], retakes: 0, elapsedMs: 0, totalMs: null, savedAt: Date.now() };
      const d = draft.current;
      const out: DraftSlot[] = [];
      for (const x of next) {
        if (!x || x === 'skip') { out.push(x); continue; }
        let k = kept.current.get(x.n);
        if (!k || k.uri !== x.uri) { k = { key: await keepDraftPhoto(d.id, x.n, x.uri), uri: x.uri }; kept.current.set(x.n, k); }
        const { uri: _uri, ...rest } = x;
        out.push({ ...rest, key: k.key });
      }
      if (draft.current !== d) return; // sent or thrown away meanwhile
      draft.current = { ...d, slots: out, retakes: retakesNow.current, elapsedMs: Date.now() - t0.current, totalMs: totalMs.current };
      await saveDraft(dk, draft.current);
    }).catch((e) => console.warn('Photo not kept on this phone', e));
  };
  const throwAway = async () => {
    setLeave(false);
    await keeping.current;
    const d = draft.current;
    draft.current = null;
    if (dkey) await dropDraft(dkey, d).catch(() => {});
    allowLeave.current = true;
    const a = leaveAction.current;
    leaveAction.current = null;
    if (a) nav.dispatch(a as never); else goAway();
  };
  const stay = () => { setLeave(false); leaveAction.current = null; };
  const goTo = (k: number, summary?: boolean) => {
    if (walkId) return; // saved and on its way
    checkSeq.current++; setQuality(null);
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
      if (p?.uri) {
        // Taken sideways while the screen stayed upright, the photo lies on its side: it's stored the right way up
        // (the review shows it as the camera did).
        const shot = land && p.width < p.height ? await upright(p.uri) : { uri: p.uri, w: p.width, h: p.height };
        setPending({ ...shot, view: p.uri }); setPhase('review');
        const seq = ++checkSeq.current;
        setQuality('checking');
        checkPhoto(shot.uri).then((q) => { if (seq === checkSeq.current) setQuality(q); });
      }
    } catch { setCamErr(t('Couldn\'t take the photo. Try again.')); }
    finally { setBusyShot(false); }
  };
  const use = () => {
    if (!pending) return;
    const prev = slots[i];
    const shot: LocalShot = { n: f.n, label: f.label, uri: pending.uri, w: pending.w, h: pending.h, takenAt: Date.now(),
      retakes: prev && prev !== 'skip' ? (prev.retakes || 0) + 1 : 0, q: quality && quality !== 'checking' ? quality : null };
    checkSeq.current++; setQuality(null);
    if (prev && prev !== 'skip') setRetakes((r) => r + 1);
    const next = slots.slice(); next[i] = shot; setSlots(next); setPending(null); setResumed(null);
    keep(next);
    advance(next);
  };
  const retake = () => { checkSeq.current++; setQuality(null); setPending(null); setRetakes((r) => r + 1); setPhase('aim'); };
  const skip = () => { const next = slots.slice(); next[i] = 'skip'; setSlots(next); keep(next); advance(next); };
  const save = async () => {
    const shots = slots.filter((x): x is LocalShot => !!x && x !== 'skip');
    if (!shots.length) { goAway(); return; }
    if (ho && shots.length < frames.length) return;
    if (job) { outbox.retry(job.id); return; }
    setPhase('saving'); setSaveErr(null);
    const meta = { source: 'camera' as const, frames: frames.length, skipped: slots.filter((x) => x === 'skip').length, retakes, totalMs: totalMs.current,
      ...(sp.ver >= 2 ? { overlay: sp.ver as 2 | 3 | 4 } : {}) };
    if (s.mode !== 'firebase') {
      // Test mode: the photos stay on this phone as they are.
      setProgress(t('Saving'));
      try {
        const wid = await saveWalk(s.store!, v, s.user?.uid ?? null, shots, meta);
        allowLeave.current = true;
        if (router.canGoBack()) { router.back(); setTimeout(() => router.push(`/walk/${wid}`), 0); } else router.replace(`/walk/${wid}`);
      } catch { setPhase('summary'); setSaveErr(t('Couldn\'t save the photos.')); }
      return;
    }
    // Kept on the phone first (made smaller), then they upload by themselves, with or without a connection.
    setProgress(t('Saving the photos on this phone…'));
    try {
      // Every photo kept first, so the walk-around takes the draft's id: one walk-around, however often this is pressed.
      await keeping.current;
      const wid = await queueWalk({ orgId: s.org!.id, uid: s.user!.uid, v, shots, what: ho || 'walkaround', assignmentId: assignment || null, meta, id: draft.current?.id, pick },
        (d, n) => setProgress(t('Saving {done} of {total} on this phone', { done: d, total: n })));
      // Now in the outbox with its own copy of the photos: the draft goes.
      const d = draft.current;
      draft.current = null;
      if (dkey) await dropDraft(dkey, d).catch(() => {});
      setWalkId(wid);
      setPhase('summary');
    } catch {
      setPhase('summary'); setSaveErr(t('Couldn\'t save the photos on this phone. Try again.'));
    }
  };
  const header = (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Btn title={t('Close')} onPress={close} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.step} numberOfLines={1}>{phase === 'summary' || phase === 'saving' ? vanName(v) : t('{van}, frame {n} of {total}', { van: vanName(v), n: f.n, total: frames.length })}</Text>
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
      {resumed && !walkId ? (
        <Text style={st.note}>
          {tp(resumed.kept, 'Continued where you stopped: {n} photo kept.', 'Continued where you stopped: {n} photos kept.')}
          {resumed.dropped ? ` ${tp(resumed.dropped, '{n} photo was more than two hours old: take it again.', '{n} photos were more than two hours old: take them again.')}` : ''}
        </Text>
      ) : null}
    </View>
  );
  const canSend = ho ? taken === frames.length : taken > 0;
  const sendTitle = ho ? (assignment ? t('Save the pick-up photos') : ho === 'pickup' ? t('Pick up {van}', { van: vanName(v) }) : t('Drop off {van}', { van: vanName(v) }))
    : tp(taken, 'Save {n} photo', 'Save {n} photos');
  const sheet = leave ? (
    <View style={st.sheetBack}>
      <View accessibilityViewIsModal style={st.sheet}>
        <Text style={st.name}>{tp(taken, '{n} photo isn\'t sent yet.', '{n} photos aren\'t sent yet.')}</Text>
        <Text style={st.note}>{t('Photos you keep stay on this phone, also if the app closes.')}</Text>
        {canSend ? <Btn title={sendTitle} kind="marker" onPress={() => { stay(); save(); }} /> : null}
        <Btn title={canSend ? t('Back to the photos') : t('Keep taking photos')} onPress={stay} />
        <Btn title={tp(taken, 'Throw away {n} photo', 'Throw away {n} photos')} kind="ghost" onPress={throwAway} />
      </View>
    </View>
  ) : null;

  if (!perm) return <Shell style={{ justifyContent: 'center' }}><ActivityIndicator color="#fff" /></Shell>;
  if (!perm.granted) {
    return (
      <Shell style={{ padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={st.name}>{t('Camera access')}</Text>
        <Text style={st.msg}>{t('The walk-around uses the camera with an outline to fit the vehicle into.')}</Text>
        <Btn title={perm.canAskAgain ? t('Allow camera') : t('Open Settings to allow the camera')} kind="marker" onPress={() => requestPerm()} />
        <Btn title={t('Close')} kind="ghost" onPress={goAway} />
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
                    {sl && sl !== 'skip' ? <Image source={{ uri: sl.uri }} style={StyleSheet.absoluteFill} contentFit={sl.w > sl.h ? 'contain' : 'cover'} /> : <Text style={st.note}>{sl === 'skip' ? t('Skipped') : t('No photo')}</Text>}
                    <View style={st.badge}><Text style={st.badgeT}>{fr.n}</Text></View>
                    {sl && sl !== 'skip' && sl.q?.issues.length ? (
                      <View accessibilityLabel={sl.q.issues.map((k) => t(ISSUE_TEXT[k])).join(' ')} style={[st.badge, { left: undefined, right: 4, backgroundColor: '#FFB74D' }]}><Text style={st.badgeT}>!</Text></View>
                    ) : null}
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
                {/* Another driver has the van now (got it after the photos were taken): the driver says so (cause 3a). */}
                {job.status === 'failed' && job.then?.fn === 'pickUpVan' && /already-exists/.test(job.errorCode || '')
                  ? <Btn title={t('Take it over')} kind="marker" onPress={() => outbox.takeOver(job.id)} />
                  : job.status === 'failed' ? <Btn title={t('Try again')} kind="marker" onPress={save} /> : null}
                <Btn title={t('Close')} kind={job.status === 'failed' ? 'ghost' : 'outline'} onPress={goAway} />
              </View>
            </>
          ) : phase === 'saving' ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><ActivityIndicator color={MARKER} /><Text style={st.msg}>{progress}</Text></View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {ho || taken ? <Btn title={sendTitle} kind="marker" disabled={!canSend} onPress={save} /> : null}
              <Btn title={t('Discard')} kind="ghost" onPress={close} />
            </View>
          )}
          <Text style={st.note}>{ho ? (ho === 'pickup' ? t('The photos show the van\'s state when you took it, so damage that was already there isn\'t put on you. They\'re kept with the van\'s history.')
            : t('The photos show the van\'s state when you brought it back, so damage that was already there isn\'t put on you. They\'re kept with the van\'s history.'))
            : s.mode === 'firebase' ? t('Photos upload to your company\'s storage, so the walk-around is kept as evidence.') : t('Firebase isn\'t connected yet, so photos stay on this phone.')}</Text>
        </ScrollView>
        {sheet}
      </Shell>
    );
  }

  const xml = boxW > 0 ? overlaySVG(sp, f, 3 / 4, boxW, !wide) : '';
  const warned = quality && quality !== 'checking' && quality.issues.length ? quality.issues : null;
  return (
    <Shell style={wide ? { flexDirection: 'row' } : undefined}>
      {wide ? null : header}
      <View style={{ flex: 1, minHeight: 0, minWidth: 0, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setArea((a) => (a && Math.abs(a.w - width) < 1 && Math.abs(a.h - height) < 1 ? a : { w: width, h: height })); }}>
        {boxH > 0 ? <View style={{ width: boxW, height: boxH, overflow: 'hidden', backgroundColor: '#111' }}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" ratio="4:3" enableTorch={torch && phase === 'aim'} animateShutter
            onCameraReady={() => setReady(true)} onMountError={(e) => setCamErr(e.message || t('The camera couldn\'t start.'))} />
          {phase === 'review' && pending ? <Image source={{ uri: pending.view }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}><Svg xml={xml} width={boxW} height={boxH} /></View>
          {!ready && !camErr ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" /> : null}
        </View> : null}
      </View>
      <View style={wide ? { width: 300, justifyContent: 'center', gap: 6 } : null}>
      {wide ? header : null}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10, minHeight: wide ? 0 : 196 }}>
        {camErr ? <Text style={[st.hint, { color: '#FF8A80' }]}>{camErr}</Text> : null}
        {phase === 'review' && warned ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
            {warned.map((k) => <Text key={k} style={[st.hint, { color: '#FFB74D', fontFamily: F.semi }]}>{t(ISSUE_TEXT[k])}</Text>)}
          </View>
        ) : (
          <Text style={st.hint}>
            {phase === 'review' ? (quality === 'checking' ? t('Checking the photo…') : t('Does the vehicle line up with the outline?'))
              : <><Text style={{ color: MARKER, fontFamily: F.semi }}>{holdHint ? `${holdHint} ` : ''}{t('Fit the vehicle to the outline.')} </Text>{t('About {m} m away.', { m: f.dist.toLocaleString(loc(), { maximumFractionDigits: 1 }) })} {t(f.hint)}</>}
          </Text>
        )}
        {phase === 'review' ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
            {warned ? (
              <>
                <Btn title={t('Use anyway')} kind="ghost" onPress={use} />
                <Btn title={t('Retake')} kind="marker" onPress={retake} />
              </>
            ) : (
              <>
                <Btn title={t('Retake')} onPress={retake} />
                <Btn title={t('Use photo')} kind="marker" onPress={use} />
              </>
            )}
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
      </View>
      {sheet}
    </Shell>
  );
}

// Made per language: the fonts and heading sizes depend on it (components/ui.tsx).
const makeSheet = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  step: { fontFamily: F.body, fontSize: 13, color: '#B9BEC7' },
  name: { fontFamily: F.cond, fontSize: hs(22), color: '#fff' },
  msg: { fontFamily: F.body, fontSize: 16, color: '#E6E8EC' },
  hint: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: '#E6E8EC', textAlign: 'center' },
  note: { fontFamily: F.body, fontSize: 13, color: '#B9BEC7' },
  stats: { flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 4 },
  stat: { flex: 1, padding: 10 },
  statV: { fontFamily: F.condBold, fontSize: hs(30), color: '#fff' },
  statL: { fontFamily: F.body, fontSize: 12, color: '#B9BEC7' },
  badge: { position: 'absolute', left: 4, top: 4, backgroundColor: MARKER, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  badgeT: { fontFamily: F.condBold, fontSize: hs(14), color: '#000' },
  thumbL: { fontFamily: F.cond, fontSize: hs(15), color: '#fff', marginTop: 4 },
  sheetBack: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'flex-end', padding: 16 },
  sheet: { backgroundColor: '#16181C', borderRadius: 6, padding: 16, gap: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
});

const sheets = new Map<string, ReturnType<typeof makeSheet>>();
function styles() {
  const k = lang();
  let s = sheets.get(k);
  if (!s) { s = makeSheet(); sheets.set(k, s); }
  return s;
}
