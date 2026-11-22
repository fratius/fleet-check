import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { closeupState, cmpStuck, gapList } from '@/lib/compare';
import { loc, t, tp } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ai, failText } from '@/lib/store';
import type { Check, CmpSummary, Walkaround } from '@/lib/types';

/** How long after a walk-around is saved the app waits for the comparison to start before offering to run it. */
const START_MS = 10 * 60_000;
const clock = (ms: number) => new Date(ms).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });

/**
 * The automatic damage comparison of one walk-around, for owners and the station's fleet managers: running, the
 * van's first walk-around, nothing new, possible new damage (with the way to the review), or didn't finish (run it
 * again). Drivers see the comparison of their own pick-ups and drop-offs (DriverCompareCard); the fleet manager
 * decides (ROLES.md).
 */
export function CompareCard({ w }: { w: Walkaround }) {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<CmpSummary | null>(null);
  // Demo companies are compared too (the blind tester found the card hidden there); only their made-up walk-arounds
  // (drawings, w.demo) aren't.
  if (s.mode !== 'firebase' || !s.staff || !s.runs(w.stationId) || w.source !== 'camera' || w.demo) return null;
  const cmp = mine && (!w.cmp || w.cmp.at < mine.at) ? mine : w.cmp || null;
  const stuck = cmpStuck(cmp);
  // Not compared: taken before comparisons started, or the comparison is off. Offered once the start had its time.
  const never = !cmp && Date.now() - w.createdAt > START_MS;
  if (!cmp && !never) return null;
  if (!cmp && !s.aiCompare) return null;
  const again = async () => {
    setBusy(true); setErr(null);
    try {
      setMine((await ai.compareWalk({ orgId: s.org!.id, walkId: w.id })).cmp);
    } catch (e) { setErr(failText(e, 'Comparing with the photos before')); } finally { setBusy(false); }
  };
  const n = cmp ? cmp.found + cmp.unsure : 0;
  // A pick-up or drop-off: the driver takes close-ups of the spots first (product owner, 2026-11-22).
  const k = cmp?.checkId ? s.checks.find((x) => x.id === cmp.checkId) : undefined;
  const waiting = k?.status === 'checking' && k.closeupBy ? k.closeupBy : null;
  return (
    <Card>
      <Row>
        <T v="h3" style={{ flex: 1 }}>{t('AI comparison')}</T>
        {cmp?.status === 'done' ? <Pill v={cmp.found ? 'bad' : cmp.unsure ? 'amber' : 'good'} text={cmp.found ? tp(cmp.found, '{n} possible new damage', '{n} possible new damages')
          : cmp.unsure ? t('Not sure') : t('No new damage')} /> : null}
      </Row>
      {!cmp ? <T v="hint">{t('These photos weren\'t compared with the van\'s earlier photos.')}</T>
        : stuck ? <T v="hint">{t('The comparison with the van\'s earlier photos didn\'t finish.')}</T>
          : cmp.status === 'running' ? (
            <Row><ActivityIndicator color={c.ink} /><T v="hint" style={{ flex: 1 }}>{t('Comparing every photo with the van\'s earlier photos. This takes about a minute.')}</T></Row>
          ) : cmp.status === 'first' ? <T v="hint">{t('No earlier photos of this van to compare with yet. The next walk-around is compared with these photos.')}</T>
            : cmp.status === 'limit' ? <T v="hint">{tp(2, 'Not compared: during the free trial and in demo companies each van gets {n} comparison a day.', 'Not compared: during the free trial and in demo companies each van gets {n} comparisons a day.')}</T>
              : (
                <View style={{ gap: 4 }}>
                  <T>{n ? tp(n, 'The AI marked {n} spot that may be new. Review it: your decision goes on the van\'s record.', 'The AI marked {n} spots that may be new. Review them: your decision goes on the van\'s record.')
                    : t('The AI found no new damage. It can miss small damage.')}</T>
                  <T v="small">{cmp.refAt ? tp(cmp.compared, '{n} photo compared with the van\'s photos from {when}.', '{n} photos compared with the van\'s photos from {when}.', { when: fmtWhen(cmp.refAt) })
                    : tp(cmp.compared, '{n} photo compared with the van\'s earlier photos.', '{n} photos compared with the van\'s earlier photos.')}</T>
                  {cmp.notCompared.length ? <T v="small">{t('Not compared: {list}.', { list: gapList(cmp.notCompared) })}</T> : null}
                  {waiting ? <T v="small">{t('The driver who took the photos is taking close-ups of the spots, until {time}. The check comes to Review then, with or without them.', { time: clock(waiting) })}</T> : null}
                </View>
              )}
      {cmp?.checkId && cmp.status === 'done' ? <Button v="primary" title={t('Review the spots')} onPress={() => router.push(`/check/${cmp.checkId}`)} /> : null}
      {(stuck || never) && s.aiCompare && !w.mediaDeletedAt ? <Button title={t('Compare with the photos before')} loading={busy} onPress={again} /> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}

/**
 * The comparison of a driver's own pick-up or drop-off photos, for that driver (product owner, 2026-11-22): it's
 * running, the photos are the van's starting point, nothing new, or spots to take close-ups of (with the before and
 * after on the check), then where the check stands with the fleet manager. Never anyone else's photos, and never a
 * decision: the fleet manager approves or rejects damage (ROLES.md).
 */
export function DriverCompareCard({ w }: { w: Walkaround }) {
  const s = useSession();
  const c = useColors();
  if (s.mode !== 'firebase' || s.staff || !w.handover || !s.user || w.createdBy !== s.user.uid || w.source !== 'camera' || w.demo) return null;
  const cmp = w.cmp || null;
  // Not compared (the comparison is off, or the photos came before it started): nothing to tell.
  if (!cmp && Date.now() - w.createdAt > START_MS) return null;
  const pick = w.handover.kind === 'pickup';
  const k = cmp?.checkId ? s.checks.find((x) => x.id === cmp.checkId) : undefined;
  const running = !cmp || (cmp.status === 'running' && !cmpStuck(cmp));
  return (
    <Card>
      <Row>
        <T v="h3" style={{ flex: 1 }}>{pick ? t('AI check of your pick-up photos') : t('AI check of your drop-off photos')}</T>
        {cmp?.status === 'done' && !cmp.checkId ? <Pill v="good" text={t('No new damage')} /> : null}
        {cmp?.status === 'first' ? <Pill v="muted" text={t('Starting point')} /> : null}
      </Row>
      <T v="small">{s.vanName(w)}, {fmtWhen(w.createdAt)}</T>
      {running ? (
        <Row><ActivityIndicator color={c.ink} /><T v="hint" style={{ flex: 1 }}>{t('Comparing your photos with the van\'s earlier photos. This takes about a minute.')}</T></Row>
      ) : cmpStuck(cmp) ? <T v="hint">{t('The comparison with the van\'s earlier photos didn\'t finish. Your fleet manager can run it again.')}</T>
        : cmp!.status === 'first' ? <T>{t('These are the first photos of this van: the next pick-ups and drop-offs are compared with them.')}</T>
          : cmp!.status === 'limit' ? <T v="hint">{tp(2, 'Not compared: during the free trial and in demo companies each van gets {n} comparison a day.', 'Not compared: during the free trial and in demo companies each van gets {n} comparisons a day.')}</T>
            : !cmp!.checkId ? (
              <View style={{ gap: 4 }}>
                <T>{pick ? t('No new damage on your pick-up photos.') : t('No new damage on your drop-off photos.')}</T>
                <T v="small">{t('The AI compared them with the van\'s earlier photos. It can miss small damage.')}</T>
              </View>
            ) : !k ? <T v="hint">{t('Loading…')}</T> : <DriverCheckState k={k} />}
    </Card>
  );
}

/** Where the comparison's check of a driver's photos stands, for that driver, with the way to the close-ups. */
function DriverCheckState({ k }: { k: Check }) {
  const c = useColors();
  const st = closeupState(k);
  const n = k.spots.length;
  const late = k.sentLate ? (k.noCloseups ? t('Nobody took close-ups within 30 minutes, so the spots went to your fleet manager without them.')
    : t('The 30 minutes for close-ups were up, so the spots went to your fleet manager with the close-ups taken.')) : null;
  if (st === 'closeups') {
    const over = !!k.closeupBy && Date.now() > k.closeupBy;
    return (
      <View style={{ gap: 8 }}>
        <T>{tp(n, 'The AI found {n} spot that may be new damage. Take close-ups of it now: you see the before and after of that part of the van.',
          'The AI found {n} spots that may be new damage. Take close-ups of each one now: you see the before and after of that part of the van.')}</T>
        {k.closeupBy ? <T v="small" color={over ? c.alert : undefined}>{over ? t('The 30 minutes for close-ups are up: the spots go to your fleet manager now.')
          : t('Take them by {time}. After that the spots go to your fleet manager without close-ups.', { time: clock(k.closeupBy) })}</T> : null}
        <Button v="primary" title={t('Take close-ups')} onPress={() => router.push(`/check/${k.id}`)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {late ? <T>{late}</T> : null}
      <T>{st === 'damage' ? t('Your fleet manager is reviewing the possible damage.')
        : st === 'clean' ? t('Your close-ups show no damage. Your fleet manager confirms it.')
          : st === 'reviewed' ? t('Your fleet manager reviewed the spots.')
            : t('The spots are with your fleet manager, who decides.')}</T>
      <Button small title={t('See the spots')} onPress={() => router.push(`/check/${k.id}`)} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

/**
 * The comparison of the driver's newest pick-up or drop-off photos of the last 12 hours (of one van, or any), for that
 * driver: on the Vans tab and on the van, where the driver is after a handover. Older ones still waiting for their
 * close-ups stay too (a drop-off, then a pick-up of another van at once: both).
 */
export function MyHandoverCompare({ vehicleId }: { vehicleId?: string }) {
  const s = useSession();
  if (s.mode !== 'firebase' || s.staff || !s.user) return null;
  const since = Date.now() - 12 * 3600_000;
  const mine = s.walks.filter((x) => x.createdBy === s.user!.uid && x.handover && x.source === 'camera' && !x.demo && x.createdAt > since
    && (!vehicleId || x.vehicleId === vehicleId)).sort((a, b) => b.createdAt - a.createdAt);
  const waiting = (x: Walkaround) => !!x.cmp?.checkId && s.checks.find((k) => k.id === x.cmp!.checkId)?.status === 'checking';
  const shown = mine.filter((x, i) => i === 0 || waiting(x)).slice(0, 3);
  return shown.length ? <>{shown.map((w) => <DriverCompareCard key={w.id} w={w} />)}</> : null;
}
