import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, Text, View, type ViewStyle } from 'react-native';
import Svg, { G, Polygon, Polyline } from 'react-native-svg';

import { F, MARKER, T, useColors } from '@/components/ui';
import type { Spec } from '@/lib/frames';
import { HOME_VIEW, VIEWS, camera, vanMesh, yawFacing, type Face3, type Line3, type Pos, type V3 } from '@/lib/van3d';

export interface Dot { key: string; label: string; pos: Pos }

/** Mixes two #rrggbb colours: t = 0 gives a, 1 gives b. */
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
}
const LIGHT_DIR: V3 = (() => { const v: V3 = [-0.35, 0.9, 0.45]; const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; })();
const centroid = (pts: V3[]): V3 => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0] as V3);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const isFace = (d: Line3 | Face3): d is Face3 => (d as Face3).kind !== undefined;

/**
 * The vehicle in 3D with a numbered dot on each damage. Drag sideways to turn it (up and down to tilt), or use the
 * view buttons. Tapping a dot selects it and shows `bubble` next to it. `focus` turns the vehicle to face a dot.
 */
export function Van3D({ sp, dots, selected, onSelect, bubble, focus, height = 340 }: {
  sp: Spec; dots: Dot[]; selected: string | null; onSelect: (key: string | null) => void;
  bubble?: React.ReactNode; focus?: { key: string; n: number } | null; height?: number;
}) {
  const c = useColors();
  const [w, setW] = useState(0);
  const [view, setView] = useState<{ yaw: number; pitch: number }>(HOME_VIEW);
  const live = useRef(view);
  useEffect(() => { live.current = view; }, [view]);
  const anim = useRef<number | null>(null);
  const mesh = useMemo(() => vanMesh(sp), [sp]);

  const animateTo = (yaw: number, pitch: number) => {
    if (anim.current != null) cancelAnimationFrame(anim.current);
    const from = live.current, dy = wrap(yaw - from.yaw), dp = pitch - from.pitch, t0 = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / 420), e = 1 - Math.pow(1 - t, 3);
      setView({ yaw: from.yaw + dy * e, pitch: from.pitch + dp * e });
      anim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (anim.current != null) cancelAnimationFrame(anim.current); }, []);

  // Turn to a damage picked from the list.
  const focusKey = focus ? `${focus.key}#${focus.n}` : '';
  useEffect(() => {
    if (!focus) return;
    const d = dots.find((x) => x.key === focus.key);
    if (!d) return;
    const up = d.pos.n[1] > 0.7;
    animateTo(up ? live.current.yaw : yawFacing(d.pos.n), up ? 1.1 : 0.22);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useMemo(() => {
    let start = { yaw: 0, pitch: 0 };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderGrant: () => { if (anim.current != null) cancelAnimationFrame(anim.current); start = { ...live.current }; },
      onPanResponderMove: (_, g) => setView({ yaw: start.yaw - g.dx * 0.011, pitch: Math.max(0.02, Math.min(1.35, start.pitch + g.dy * 0.006)) }),
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

  // The drawing area is inside the 2 px border.
  const cw = w - 4, ch = height - 4;
  const cam = w ? camera(sp, view.yaw, view.pitch, cw, ch) : null;
  const ink = c.ink;
  const bodyBase = c.dark ? mix('#1B1E23', MARKER, 0.1) : mix('#FFFFFF', MARKER, 0.2);
  const shade = (n: V3, base: string) => {
    const k = Math.max(0, n[0] * LIGHT_DIR[0] + n[1] * LIGHT_DIR[1] + n[2] * LIGHT_DIR[2]);
    return mix(base, '#000000', (1 - (0.7 + 0.3 * k)) * (c.dark ? 0.6 : 0.55));
  };
  const fillOf = (f: Face3) => f.kind === 'glass' ? (c.dark ? '#0B0D10' : '#3A4250')
    : f.kind === 'wheel' ? '#16181C' : f.kind === 'light' ? (c.dark ? '#D9DDE3' : '#FFFFFF')
      : f.kind === 'dark' ? '#30343A' : shade(f.n, bodyBase);

  const drawn: React.ReactNode[] = [];
  const dotViews: React.ReactNode[] = [];
  const at: { x: number; y: number }[] = [];
  if (cam) {
    const P = (pts: V3[]) => pts.map((p) => { const [x, y] = cam.project(p); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
    // A soft shadow on the ground.
    drawn.push(<Polygon key="shadow" points={P([[-0.25, 0, sp.W / 2 + 0.18], [sp.L + 0.25, 0, sp.W / 2 + 0.18], [sp.L + 0.25, 0, -sp.W / 2 - 0.18], [-0.25, 0, -sp.W / 2 - 0.18]])}
      fill={ink} fillOpacity={c.dark ? 0.22 : 0.08} />);
    const visible = mesh.filter((f) => cam.facing(centroid(f.pts), f.n) > 0.01)
      .map((f) => ({ f, z: cam.project(centroid(f.pts))[2] })).sort((a, b) => b.z - a.z);
    for (const { f } of visible) {
      const parts: React.ReactNode[] = [<Polygon key="p" points={P(f.pts)} fill={fillOf(f)} stroke={ink} strokeWidth={1.3} strokeLinejoin="round" />];
      f.details.forEach((d, i) => {
        if (isFace(d)) {
          parts.push(<Polygon key={i} points={P(d.pts)} fill={fillOf(d)} stroke={d.kind === 'wheel' ? ink : ink} strokeWidth={d.kind === 'glass' ? 1 : 1.2} strokeOpacity={d.kind === 'glass' ? 0.6 : 1} />);
          d.details.forEach((dd, j) => { if (!isFace(dd)) parts.push(<Polyline key={`${i}-${j}`} points={P(dd.closed ? [...dd.pts, dd.pts[0]] : dd.pts)} fill="none" stroke="#9DA1A8" strokeWidth={1.2} />); });
        } else {
          parts.push(<Polyline key={i} points={P(d.closed ? [...d.pts, d.pts[0]] : d.pts)} fill="none" stroke={ink} strokeWidth={1} strokeOpacity={d.faint ? 0.35 : 0.7}
            strokeDasharray={d.dashed ? '4 4' : undefined} />);
        }
      });
      drawn.push(<G key={f.key}>{parts}</G>);
    }
    for (const d of dots) {
      const lift: V3 = [d.pos.p[0] + d.pos.n[0] * 0.03, d.pos.p[1] + d.pos.n[1] * 0.03, d.pos.p[2] + d.pos.n[2] * 0.03];
      if (cam.facing(d.pos.p, d.pos.n) < 0.08) continue;
      const [x, y] = cam.project(lift);
      const on = d.key === selected, size = on ? 32 : 26;
      if (on) at.push({ x, y });
      dotViews.push(
        <Pressable key={d.key} accessibilityRole="button" accessibilityLabel={`Damage ${d.label}`} hitSlop={8} onPress={() => onSelect(on ? null : d.key)}
          style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
            backgroundColor: on ? MARKER : c.alert, borderWidth: 2, borderColor: on ? '#000' : '#FFFFFF', borderStyle: d.pos.approx ? 'dashed' : 'solid', zIndex: on ? 3 : 2 }}>
          <Text style={{ fontFamily: F.cond, fontSize: on ? 16 : 14, color: on ? '#000' : '#FFFFFF', lineHeight: on ? 18 : 16 }}>{d.label}</Text>
        </Pressable>,
      );
    }
  }
  const sel = selected ? dots.find((d) => d.key === selected) : null;
  const anchor = at[0] || null;
  const bw = Math.min(310, cw - 12);
  // The bubble opens just below its dot and may hang over what's under the van; the page has room there.
  const bubbleStyle: ViewStyle | null = anchor && bubble ? {
    position: 'absolute', zIndex: 10, elevation: 10, width: bw, left: Math.max(6, Math.min(cw - bw - 6, anchor.x - bw / 2)), top: anchor.y + 20,
  } : null;

  return (
    <View style={{ gap: 8, zIndex: 5 }}>
      <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} {...pan.panHandlers}
        style={[{ height, backgroundColor: c.paper, borderWidth: 2, borderColor: ink, borderRadius: 4, overflow: 'visible', zIndex: 5 },
          Platform.OS === 'web' ? ({ touchAction: 'pan-y', userSelect: 'none', cursor: 'grab' } as unknown as ViewStyle) : null]}>
        <Pressable accessible={false} onPress={() => onSelect(null)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
          {w ? <Svg width={cw} height={ch}>{drawn}</Svg> : null}
        </Pressable>
        {dotViews}
        {bubbleStyle ? <View style={bubbleStyle}>{bubble}</View> : null}
        {sel && !anchor ? (
          <View style={{ position: 'absolute', bottom: 8, left: 8, right: 8, alignItems: 'center' }} pointerEvents="none">
            <T v="small" style={{ backgroundColor: c.page, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3 }}>Damage {sel.label} is on the other side. Turn the van.</T>
          </View>
        ) : null}
        {/* View buttons sit on top of the drawing, so a bubble hanging below a dot never covers them. */}
        <View style={{ position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 4, zIndex: 4 }}>
          {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => (
            <Pressable key={k} accessibilityRole="button" onPress={() => animateTo(VIEWS[k].yaw, VIEWS[k].pitch)}
              style={{ paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1.5, borderColor: c.rule, borderRadius: 4, backgroundColor: c.paper }}>
              <T v="small" color={ink}>{VIEWS[k].label}</T>
            </Pressable>
          ))}
        </View>
        {!dots.length || !sel ? (
          <View pointerEvents="none" style={{ position: 'absolute', right: 8, bottom: 6 }}>
            <T v="small">{dots.length ? 'Drag to turn. Tap a dot.' : 'Drag to turn.'}</T>
          </View>
        ) : null}
      </View>
    </View>
  );
}
