import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { cmpStuck, gapList } from '@/lib/compare';
import { t, tp } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ai, failText } from '@/lib/store';
import type { CmpSummary, Walkaround } from '@/lib/types';

/** How long after a walk-around is saved the app waits for the comparison to start before offering to run it. */
const START_MS = 10 * 60_000;

/**
 * The automatic damage comparison of one walk-around, for owners and the station's fleet managers: running, the
 * van's first walk-around, nothing new, possible new damage (with the way to the review), or didn't finish (run it
 * again). Drivers don't see it: they scan, the fleet manager decides (ROLES.md).
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
                </View>
              )}
      {cmp?.checkId && cmp.status === 'done' ? <Button v="primary" title={t('Review the spots')} onPress={() => router.push(`/check/${cmp.checkId}`)} /> : null}
      {(stuck || never) && s.aiCompare && !w.mediaDeletedAt ? <Button title={t('Compare with the photos before')} loading={busy} onPress={again} /> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}
