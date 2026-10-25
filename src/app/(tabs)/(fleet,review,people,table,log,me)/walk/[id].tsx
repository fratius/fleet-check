import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { Button, Card, Screen, ZoomPhoto, Stat, Stats, T, fmtWhen, mmss, secs, usd, useColors } from '@/components/ui';
import { t, tp } from '@/lib/i18n';
import { useWhoDid } from '@/lib/names';
import { fetchWalk } from '@/lib/people';
import { useSession } from '@/lib/session';
import type { Walkaround } from '@/lib/types';

export default function WalkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useSession();
  const whoDid = useWhoDid();
  const c = useColors();
  const { width } = useWindowDimensions();
  const loadedW = s.walks.find((x) => x.id === id);
  // Older walk-arounds (linked from a van's history) aren't among the ones the app keeps loaded: fetch them.
  const [older, setOlder] = useState<Walkaround | null | undefined>(undefined);
  const orgId = s.org?.id;
  useEffect(() => {
    if (loadedW || !s.loaded.walks || !orgId || s.mode !== 'firebase') return;
    let live = true;
    fetchWalk(orgId, id).then((r) => { if (live) setOlder(r); });
    return () => { live = false; };
  }, [loadedW, s.loaded.walks, orgId, id, s.mode]);
  const w = loadedW || older;
  if (!w) return <Screen edges={[]}><Card dashed><T v="hint">{s.loaded.walks && older === null ? t('This walk-around isn\'t available.') : t('Loading…')}</T></Card></Screen>;
  const checks = s.checks.filter((k) => k.walkId === w.id);
  const tile = (Math.min(width, 760) - 32 - 20) / 3;
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: w.handover ? (w.handover.kind === 'pickup' ? t('Pick-up photos') : t('Drop-off photos')) : t('Walk-around') }} />
      <View style={{ gap: 4 }}>
        <T v="hint">{(() => {
          const what = w.handover ? (w.handover.kind === 'pickup' ? t('Pick-up photos') : t('Drop-off photos')) : w.source === 'library' ? t('Photos from the library') : t('Walk-around');
          const who = whoDid(w.createdBy);
          return who ? t('{what}, {van}, by {who}', { what, van: w.vehicleName, who }) : t('{what}, {van}', { what, van: w.vehicleName });
        })()}</T>
        <T v="h1">{fmtWhen(w.createdAt)}</T>
      </View>
      <Stats>
        <Stat value={w.totalMs ? mmss(w.totalMs) : '–'} label={t('total time')} />
        <Stat value={`${w.taken}/${w.frames}`} label={w.skipped ? tp(w.skipped, 'photos, {n} skipped', 'photos, {n} skipped') : t('photos')} />
        <Stat value={String(w.retakes)} label={t('retakes')} />
      </Stats>
      {s.mode === 'firebase' ? (
        <View style={{ backgroundColor: '#E2FF1C', borderRadius: 4, padding: 14, gap: 8 }}>
          <Button v="primary" wide title={checks.length ? t('Check for damage again') : t('Check for damage')}
            onPress={() => router.push({ pathname: '/check/[id]', params: { id: 'new', walk: w.id } })} />
          <T v="medium" color="#000" style={{ fontSize: 14 }}>{t('The AI marks possible damage, then asks for close-ups of each spot.')}</T>
        </View>
      ) : <T v="hint">{t('Damage checks need the Firebase backend.')}</T>}
      {checks.map((k) => {
        const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
        return (
          <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="h3">{tp(k.spots.length, 'Check: {n} spot, {dmg} damage', 'Check: {n} spots, {dmg} damage', { dmg })}</T>
            <T v="hint">{[s.seesAiStats && k.pass1 ? t('found in {time}', { time: secs(k.pass1.ms) }) : '', s.seesAiStats && k.pass1 ? t('{cost} est.', { cost: usd((k.pass1?.cost || 0) + (k.pass2?.cost || 0)) }) : '', fmtWhen(k.createdAt)].filter(Boolean).join(', ')}</T>
          </Pressable>
        );
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {w.photos.map((p) => (
          <View key={p.n} style={{ width: tile, gap: 4 }}>
            <ZoomPhoto src={p} caption={`${p.n}. ${t(p.label)}`} style={{ width: tile, height: (tile * 4) / 3 }} />
            <T v="small" numberOfLines={2}>{p.n}. {t(p.label)}</T>
          </View>
        ))}
      </View>
    </Screen>
  );
}
