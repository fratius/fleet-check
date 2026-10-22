import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, F, T, useColors } from '@/components/ui';
import { VIDEO_HOW, VideoHandover } from '@/components/video';
import { CLS, buildFrames, makeSpec } from '@/lib/frames';
import { useSession } from '@/lib/session';
import type { Vehicle } from '@/lib/types';

/**
 * One "Start scanning" button. Tapping it asks how: the photo set (the camera shows the outline to fit for each
 * photo) or one video walking around the van, which is kept with the van. Without the backend (test mode) there's
 * no video, so it goes straight to the photos.
 */
export function ScanChoice({ v, minutes, onMarker = true, small, caption }: { v: Vehicle; minutes?: number; onMarker?: boolean; small?: boolean; caption?: string }) {
  const s = useSession();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const frames = buildFrames(makeSpec(v.cls, v)).length;
  const ink = onMarker ? '#000' : undefined;
  const photos = () => { setOpen(false); router.push(`/scan/${v.id}`); };
  if (!open) {
    // Without the backend (test mode) there's no video: straight to the photos.
    const button = <Button v="primary" wide={!small} small={small} title="Start scanning" onPress={s.mode !== 'firebase' ? photos : () => setOpen(true)} />;
    return caption ? <View style={{ gap: 8 }}>{button}<T v="medium" color={ink} style={{ fontSize: 14 }}>{caption}</T></View> : button;
  }
  const rule = { borderTopWidth: 1.5, borderColor: onMarker ? 'rgba(0,0,0,0.3)' : 'rgba(127,127,127,0.35)', paddingTop: 10 };
  return (
    <View style={{ gap: 10, width: '100%' }}>
      <T v="h3" color={ink}>Scan with photos or a video?</T>
      <View style={{ gap: 6 }}>
        <Button v="primary" wide title="Photos" onPress={photos} />
        <T v="small" color={ink}>
          {frames} photos{CLS[v.cls] ? ` for this ${CLS[v.cls].lower}` : ''}{minutes ? `, about ${minutes} min` : ''}. The camera shows the outline to fit for each one.
          Only photos get the AI damage check.
        </T>
      </View>
      <View style={[{ gap: 6 }, rule]}>
        <VideoHandover v={v} kind="walkaround" title="Video" wide onDone={() => setOpen(false)} />
        <T v="small" color={ink}>{VIDEO_HOW} The video is kept with the van.</T>
      </View>
      {/* Black on the yellow card in dark mode too (a plain link would turn light). */}
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 }}>
        <Text style={{ fontFamily: F.cond, fontSize: 17, color: ink || c.ink, textDecorationLine: 'underline' }}>Cancel</Text>
      </Pressable>
    </View>
  );
}
