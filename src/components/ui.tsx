import { Image } from 'expo-image';
import { useScrollToTop } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useColorScheme, type PressableProps, type ScrollViewInstance, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';

import { photoUrl } from '@/lib/images';

export const MARKER = '#E2FF1C';
const LIGHT = { page: '#ECEEF1', paper: '#FFFFFF', ink: '#000000', ink2: '#565C66', rule: '#CDD1D7', alert: '#C42A1F', ok: '#1B7A3B', amber: '#8A5A00', warn: '#D9480F' };
const DARK = { page: '#111316', paper: '#1B1E23', ink: '#F2F3F5', ink2: '#A2A8B2', rule: '#383D45', alert: '#FF7468', ok: '#5FD18E', amber: '#F2B54A', warn: '#FF922B' };
export type Colors = typeof LIGHT;
export function useColors(): Colors & { dark: boolean } {
  const dark = useColorScheme() === 'dark';
  return { ...(dark ? DARK : LIGHT), dark };
}

export const F = {
  body: 'Barlow_400Regular', medium: 'Barlow_500Medium', semi: 'Barlow_600SemiBold',
  cond: 'BarlowCondensed_600SemiBold', condMed: 'BarlowCondensed_500Medium', condBold: 'BarlowCondensed_700Bold',
};

type TV = 'h1' | 'h2' | 'h3' | 'body' | 'medium' | 'hint' | 'small' | 'big';
export function T({ v = 'body', style, color, children, ...rest }: { v?: TV; color?: string; style?: StyleProp<TextStyle>; children?: React.ReactNode; numberOfLines?: number; selectable?: boolean }) {
  const c = useColors();
  const base: Record<TV, TextStyle> = {
    h1: { fontFamily: F.cond, fontSize: 36, lineHeight: 38, color: c.ink, letterSpacing: -0.3 },
    h2: { fontFamily: F.cond, fontSize: 26, lineHeight: 29, color: c.ink },
    h3: { fontFamily: F.cond, fontSize: 21, lineHeight: 24, color: c.ink },
    big: { fontFamily: F.condBold, fontSize: 34, lineHeight: 36, color: c.ink, fontVariant: ['tabular-nums'] },
    body: { fontFamily: F.body, fontSize: 16, lineHeight: 23, color: c.ink },
    medium: { fontFamily: F.medium, fontSize: 16, lineHeight: 23, color: c.ink },
    hint: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: c.ink2 },
    small: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: c.ink2 },
  };
  return <Text {...rest} style={[base[v], color ? { color } : null, style]}>{children}</Text>;
}

export function Screen({ children, scroll = true, edges = ['top'], pad = true, style, scrollRef, wide }: {
  children: React.ReactNode; scroll?: boolean; edges?: Edge[]; pad?: boolean; style?: StyleProp<ViewStyle>; scrollRef?: React.Ref<ScrollViewInstance>;
  /** Tables: use the width of a computer screen. */
  wide?: boolean;
}) {
  const c = useColors();
  // Tapping the tab you're on scrolls its first page back to the top.
  const own = useRef<ScrollViewInstance | null>(null);
  useScrollToTop(own);
  const setRef = (r: ScrollViewInstance | null) => {
    own.current = r;
    if (typeof scrollRef === 'function') scrollRef(r);
    else if (scrollRef && typeof scrollRef === 'object') (scrollRef as React.RefObject<ScrollViewInstance | null>).current = r;
  };
  const inner = <View style={[{ gap: 14, paddingHorizontal: pad ? 16 : 0, paddingTop: 12, paddingBottom: 32, width: '100%', maxWidth: wide ? 1400 : 760, alignSelf: 'center' }, style]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.page }}>
      {scroll ? <ScrollView ref={setRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

type BV = 'primary' | 'secondary' | 'link' | 'danger' | 'marker';
export function Button({ title, onPress, v = 'secondary', small, wide, disabled, loading, style, ...rest }: {
  title: string; onPress?: () => void; v?: BV; small?: boolean; wide?: boolean; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
} & Omit<PressableProps, 'style' | 'onPress'>) {
  const c = useColors();
  const bg = v === 'primary' ? c.ink : v === 'marker' ? MARKER : v === 'link' ? 'transparent' : c.paper;
  const fg = v === 'primary' ? c.paper : v === 'marker' ? '#000' : v === 'danger' ? c.alert : c.ink;
  const border = v === 'link' ? 'transparent' : v === 'danger' ? c.alert : v === 'marker' ? '#000' : c.ink;
  return (
    <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} {...rest}
      style={({ pressed }) => [{
        minHeight: small ? 40 : wide ? 56 : 48, paddingHorizontal: small ? 12 : 18, paddingVertical: small ? 6 : 10,
        borderWidth: 2, borderColor: border, borderRadius: 4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
        flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : pressed ? 0.75 : 1, alignSelf: wide ? 'stretch' : 'flex-start',
      }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ fontFamily: F.cond, fontSize: small ? 17 : wide ? 23 : 20, color: fg, textDecorationLine: v === 'link' ? 'underline' : 'none' }}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style, dashed }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; dashed?: boolean }) {
  const c = useColors();
  return <View style={[{ backgroundColor: dashed ? 'transparent' : c.paper, borderWidth: 2, borderStyle: dashed ? 'dashed' : 'solid', borderColor: dashed ? c.ink2 : c.ink, borderRadius: 4, padding: 16, gap: 10 }, style]}>{children}</View>;
}

export type PillV = 'default' | 'good' | 'bad' | 'solid' | 'amber' | 'muted';
export function Pill({ text, v = 'default' }: { text: string; v?: PillV }) {
  const c = useColors();
  const color = v === 'good' ? c.ok : v === 'bad' ? c.alert : v === 'amber' ? c.amber : v === 'muted' ? c.ink2 : v === 'solid' ? c.paper : c.ink;
  return (
    <View style={{ borderWidth: 1.5, borderColor: v === 'solid' ? c.ink : color, backgroundColor: v === 'solid' ? c.ink : 'transparent', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ fontFamily: F.medium, fontSize: 13, lineHeight: 17, color }}>{text}</Text>
    </View>
  );
}
export const Row = ({ children, gap = 8, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) =>
  <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'center' }, style]}>{children}</View>;

export function Field({ label, hint, error, ...props }: { label: string; hint?: string; error?: string | null } & TextInputProps) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <T v="medium">{label}{hint ? <T v="hint">{'  ' + hint}</T> : null}</T>
      <TextInput placeholderTextColor={c.ink2} {...props}
        style={[{ minHeight: 48, borderWidth: 2, borderColor: error ? c.alert : c.ink, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10,
          fontFamily: F.body, fontSize: 18, color: c.ink, backgroundColor: c.paper }, props.style]} />
      {error ? <T v="hint" color={c.alert}>{error}</T> : null}
    </View>
  );
}

export function Segmented<K extends string>({ options, value, onChange, label }: { options: [K, string][]; value: K; onChange: (k: K) => void; label?: string }) {
  const c = useColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', borderWidth: 2, borderColor: c.ink, borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start' }}>
      {options.map(([k, t], i) => (
        <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: k === value }} onPress={() => onChange(k)}
          style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', backgroundColor: k === value ? c.ink : c.paper, borderLeftWidth: i ? 2 : 0, borderColor: c.ink }}>
          <Text style={{ fontFamily: F.cond, fontSize: 17, color: k === value ? c.paper : c.ink }}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Chip({ text, on, onPress }: { text: string; on?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress}
      style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 999, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', backgroundColor: on ? c.ink : c.paper }}>
      <Text style={{ fontFamily: F.medium, fontSize: 15, color: on ? c.paper : c.ink }}>{text}</Text>
    </Pressable>
  );
}

export function Plate({ text, small }: { text: string; small?: boolean }) {
  if (!text) return null;
  return (
    <View style={{ flexDirection: 'row', borderWidth: small ? 1.5 : 2, borderColor: '#000', borderRadius: small ? 3 : 4, backgroundColor: '#fff', overflow: 'hidden', alignSelf: 'flex-start' }}>
      <View style={{ width: small ? 7 : 10, backgroundColor: '#1F4FB4' }} />
      <Text style={{ fontFamily: F.cond, fontSize: small ? 14 : 17, letterSpacing: small ? 0.8 : 1.2, color: '#000', paddingHorizontal: small ? 6 : 8, paddingVertical: small ? 0 : 2 }}>{text}</Text>
    </View>
  );
}

/** SvgXml in a clipping box, so drawings never spill outside their frame. */
export function Svg({ xml, width, height, style }: { xml: string; width: number; height: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width, height, overflow: 'hidden' }, style]}><SvgXml xml={xml} width={width} height={height} /></View>;
}

/** Shows a photo by local uri or storage path. */
export function Photo({ src, style, contentFit = 'cover' }: { src: { uri?: string; path?: string } | string | null | undefined; style?: StyleProp<ViewStyle>; contentFit?: 'cover' | 'contain' }) {
  const c = useColors();
  const [url, setUrl] = useState<string | null>(typeof src === 'object' && src?.uri ? src.uri : null);
  useEffect(() => { let live = true; photoUrl(src).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [src]);
  return (
    <View style={[{ backgroundColor: c.dark ? '#000' : '#16181C', overflow: 'hidden', borderRadius: 3 }, style]}>
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit={contentFit} transition={150} /> : <ActivityIndicator style={{ flex: 1 }} color="#888" />}
    </View>
  );
}

/** A photo that opens full screen when tapped, so the proof can be checked closely. */
export function ZoomPhoto({ src, style, caption, contentFit, thumb }: {
  src: Parameters<typeof Photo>[0]['src']; style?: StyleProp<ViewStyle>; caption?: string; contentFit?: 'cover' | 'contain';
  /** What to show before it's opened, instead of the photo (for example a crop of it). */
  thumb?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={caption ? `Open photo: ${caption}` : 'Open photo'} onPress={() => setOpen(true)}>
        {thumb || <Photo src={src} style={style} contentFit={contentFit} />}
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} supportedOrientations={['portrait', 'landscape']}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <Photo src={src} style={{ flex: 1, backgroundColor: '#000', borderRadius: 0 }} contentFit="contain" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <Text style={{ flex: 1, color: '#fff', fontFamily: F.body, fontSize: 15 }} numberOfLines={2}>{caption || ''}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ borderWidth: 2, borderColor: '#fff', borderRadius: 4, paddingHorizontal: 18, minHeight: 48, justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontFamily: F.cond, fontSize: 20 }}>Close</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

export function Notice({ text, tone = 'default' }: { text: string; tone?: 'default' | 'bad' }) {
  const c = useColors();
  return <View style={{ borderWidth: 2, borderColor: tone === 'bad' ? c.alert : c.ink, borderRadius: 4, padding: 12, backgroundColor: c.paper }}><T color={tone === 'bad' ? c.alert : undefined}>{text}</T></View>;
}

export function Stat({ value, label }: { value: string; label: string }) {
  return <View style={{ flex: 1, minWidth: 0, padding: 12, gap: 2 }}><T v="big">{value}</T><T v="small">{label}</T></View>;
}
export function Stats({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper }}>{children}</View>;
}

export const secs = (ms: number | null | undefined) => (ms == null ? '–' : (ms / 1000).toFixed(1) + ' s');
export const mmss = (ms: number | null | undefined) => { const s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
/** Dollars with enough decimals to tell small per-image costs apart: $0.0077, $0.155, $0.31, $2.40. */
export function usd(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '–';
  let s = v.toFixed(v < 0.01 ? 4 : v < 1 ? 3 : 2);
  if (v < 1) s = s.replace(/0+$/, '');
  const dec = s.split('.')[1] || '';
  return '$' + (dec.length < 2 ? Number(s).toFixed(2) : s);
}
export function fmtWhen(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export const cap = (s: string | null | undefined) => { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); };

/** A page in parts (a van's Damage, Details, Drivers): one full-width switch. */
export function Tabs<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: [K, string, number | null][] }) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderWidth: 2, borderColor: c.ink, borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
      {items.map(([k, label, n], i) => {
        const on = k === value;
        return (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(k)}
            style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? c.ink : c.paper, borderLeftWidth: i ? 2 : 0, borderColor: c.ink }}>
            <Text style={{ fontFamily: F.cond, fontSize: 19, color: on ? c.paper : c.ink }}>{label}</Text>
            {n ? <Text style={{ fontFamily: F.condBold, fontSize: 17, color: on ? c.paper : c.ink2, fontVariant: ['tabular-nums'] }}>{n}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
