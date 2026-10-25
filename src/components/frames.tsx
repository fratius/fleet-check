import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { Svg, T, useColors } from '@/components/ui';
import { buildFrames, frameThumbSVG, mapSVG, type Spec } from '@/lib/frames';
import { loc } from '@/lib/i18n';

/** Walk-around map plus the numbered frame outlines, folded away until opened. */
export function FramesPanel({ sp, title }: { sp: Spec; title: string }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const frames = buildFrames(sp);
  const mapW = Math.min(width - 64, 520);
  const L = sp.L * 100, Wh = sp.W * 50;
  const mapH = mapW * ((2 * (Wh + 180)) / (L + 360));
  return (
    <View style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={{ padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="h3">{title} ({frames.length})</T>
        <T v="h3">{open ? '–' : '+'}</T>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
          <View style={{ backgroundColor: c.page, borderRadius: 4, padding: 8, alignItems: 'center', gap: 6 }}>
            <Svg xml={mapSVG(sp, frames, { ink: c.ink, ink2: c.ink2, paper: c.paper, page: c.page })} width={mapW} height={mapH} />
            <T v="hint" style={{ textAlign: 'center' }}>Seen from above, front on the left. Start at the front and walk down the vehicle&apos;s left side.</T>
          </View>
          {frames.map((f) => (
            <View key={f.n} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: c.rule }}>
              <Svg xml={frameThumbSVG(sp, f, 112)} width={84} height={112} style={{ borderRadius: 3 }} />
              <View style={{ flex: 1, gap: 4 }}>
                <T v="h3">{f.n}. {f.label}</T>
                <T v="hint">{f.hint}</T>
                <T v="medium" style={{ fontSize: 14 }}>About {f.dist.toLocaleString(loc(), { maximumFractionDigits: 1 })} m away</T>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
