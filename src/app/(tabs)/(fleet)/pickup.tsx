import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { takePhoto } from '@/components/dash';
import { Button, Card, Field, Notice, Plate, Row, Screen, T, useColors } from '@/components/ui';
import { VideoHandover } from '@/components/video';
import { t } from '@/lib/i18n';
import { newId, prepare, upload } from '@/lib/images';
import { findVanByPlate, toVansTab, type PickVan } from '@/lib/pickvan';
import { useSession } from '@/lib/session';
import { failText } from '@/lib/store';
import { vanName } from '@/lib/vans';

/**
 * A driver picks up the van they were told to take by its number plate (product owner, 2026-11-26; blind test,
 * cause 3a): a photo of the plate or the plate typed; the server finds the van at their station. Then the walk-around
 * (or a video) as before. A van another driver has is taken over only after the driver says so.
 */
export default function PickUp() {
  const s = useSession();
  const c = useColors();
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<PickVan | null>(null);
  const [takeOver, setTakeOver] = useState(false);
  // The lists usually answer within a second; never more than a short wait on a spinner (blind tester, round 2).
  const [waited, setWaited] = useState(false);
  useEffect(() => { const h = setTimeout(() => setWaited(true), 4000); return () => clearTimeout(h); }, []);
  const title = <Stack.Screen options={{ title: t('Pick up a van') }} />;
  if (s.staff) return <Screen edges={[]}>{title}<Card dashed><T v="hint">{t('Fleet managers give out vans from the van\'s page.')}</T></Card></Screen>;
  // Until the session knows whether they have a van (the page opened by its address).
  if ((!s.loaded.vehicles || !s.loaded.stations) && !waited) return <Screen edges={[]}>{title}<ActivityIndicator color={c.ink} /></Screen>;
  // Pick-ups by drivers are off at their station: said before any plate (the server refuses it too).
  if (!s.myVan && s.myStations.length && !s.myStations.some((st) => st.selfAssign)) {
    return <Screen edges={[]}>{title}<Notice text={t('At this station your fleet manager gives out the vans. Ask them, or ask them to let drivers pick up vans themselves.')} /></Screen>;
  }
  if (s.myVan) {
    return <Screen edges={[]}>{title}<Notice text={t('You have {van}. Drop it off first, with a video or its photos, then you can pick up this one.', { van: vanName(s.myVan) })} /></Screen>;
  }
  const find = async (by: { plate?: string; path?: string }) => {
    setErr(null); setFound(null); setTakeOver(false);
    try { setFound(await findVanByPlate(s.org!.id, by)); } catch (e) { setErr(failText(e, 'Finding the van by its plate')); } finally { setBusy(null); }
  };
  const photo = async () => {
    setErr(null);
    try {
      const p = await takePhoto();
      if (!p) return;
      setBusy(t('Reading the plate…'));
      const small = await prepare(p.uri, p.w, p.h, 1600, 0.85);
      const path = await upload(small.uri, `orgs/${s.org!.id}/dash/${s.user!.uid}/plate-${newId()}.jpg`);
      await find({ path });
    } catch (e) { setBusy(null); setErr(e instanceof Error && e.message === 'camera' ? t('Allow camera access in Settings to take the photo.') : failText(e, 'The photo of the plate')); }
  };
  const go = () => {
    if (!found) return;
    router.push({ pathname: '/scan/[id]', params: { id: found.van.id, handover: 'pickup', plate: found.plate, ...(takeOver ? { takeOver: '1', expect: found.expect || '' } : {}) } });
  };
  const ready = !!found && !found.mine && (!found.taken || takeOver);
  return (
    <Screen edges={[]}>
      {title}
      <View style={{ gap: 4 }}>
        <T v="h1">{t('Pick up a van')}</T>
        <T>{t('Take a photo of the number plate of the van you were told to take, or type it. Then walk around it with the camera.')}</T>
      </View>
      <Card>
        <Button v="primary" wide title={busy || t('Take a photo of the plate')} loading={!!busy} disabled={!!busy} onPress={photo} />
        <Field label={t('Or type the number plate')} value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="B-XY 123" />
        <Row><Button title={t('Find the van')} disabled={!!busy || !plate.trim()} onPress={() => { setBusy(t('Finding the van…')); find({ plate: plate.trim() }); }} /></Row>
        {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      </Card>
      {found ? (
        <Card>
          <Plate text={found.plate} />
          {found.mine ? <T>{t('You have {van}.', { van: found.plate })}</T> : found.taken && !takeOver ? (
            <View style={{ gap: 8 }}>
              <T color={c.alert}>{t('Another driver has this van now. Take it over?')}</T>
              <T v="small">{t('Only if you were told to take it. The other driver gets a notification, and your fleet manager sees it.')}</T>
              <Row>
                <Button v="danger" title={t('Take it over')} onPress={() => setTakeOver(true)} />
                <Button v="link" title={t('Cancel')} onPress={() => setFound(null)} />
              </Row>
            </View>
          ) : null}
          {ready ? (
            <View style={{ gap: 8 }}>
              <Button v="primary" wide title={t('Take the photos to pick it up')} onPress={go} />
              <VideoHandover v={found.van} kind="pickup" title={t('Record a video instead')} wide
                pick={{ plate: found.plate, ...(takeOver ? { takeOver: true, expect: found.expect } : {}) }} onDone={toVansTab} />
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
