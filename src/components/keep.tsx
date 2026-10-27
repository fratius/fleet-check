import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { t } from '@/lib/i18n';
import { damageUntil, day, keptUntil, mediaGone } from '@/lib/media';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import type { KeepMark } from '@/lib/types';

/** Has this record's photos or video been deleted (30 days, or 90 when kept)? False in demo companies and test mode. */
export function useMediaGone() {
  const s = useSession();
  const demo = s.mode !== 'firebase' || !!s.org?.demo;
  return (createdAt: number, keepUntil?: number | null) => mediaGone(createdAt, keepUntil, demo);
}

/**
 * How long a walk-around's photos or a video are kept, and for owners and the station's fleet managers the button
 * to mark them as damage (kept 90 days from when they were taken) or to take the mark off.
 */
export function KeepCard({ kind, id, createdAt, stationId, keepUntil, keepMark, keepDamage }: {
  kind: 'walk' | 'video'; id: string; createdAt: number; stationId?: string | null;
  keepUntil?: number | null; keepMark?: KeepMark | null; keepDamage?: string[];
}) {
  const s = useSession();
  const c = useColors();
  const gone = useMediaGone();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Shown until the server's answer arrives with the record.
  const [mine, setMine] = useState<{ mark: KeepMark | null; until: number | null } | null>(null);
  if (s.mode !== 'firebase') return null;
  const mark = mine ? mine.mark : keepMark || null;
  const until = mine ? mine.until : keepUntil;
  const demo = !!s.org?.demo;
  const can = s.staff && s.runs(stationId);
  if (gone(createdAt, until)) {
    return (
      <Card dashed>
        <T v="hint">{kind === 'video' ? t('This video was deleted on {date}. The record of it stays.', { date: day(keptUntil(createdAt, until)) })
          : t('These photos were deleted on {date}. The record of the walk-around stays.', { date: day(keptUntil(createdAt, until)) })}</T>
      </Card>
    );
  }
  const set = async (on: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await ai.markDamage({ orgId: s.org!.id, kind, id, on });
      setMine({ mark: on ? { by: s.user!.uid, byName: s.user!.name, at: Date.now() } : null, until: r.keepUntil });
    } catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that. Check the connection.')); } finally { setBusy(false); }
  };
  const damage = (keepDamage || []).length > 0;
  return (
    <Card>
      <Row>
        <T v="h3" style={{ flex: 1 }}>{kind === 'video' ? t('Keeping the video') : t('Keeping the photos')}</T>
        {mark || damage ? <Pill v="bad" text={t('Damage')} /> : null}
      </Row>
      <View style={{ gap: 4 }}>
        {mark ? <T v="small">{t('Marked as damage by {name}, {when}.', { name: mark.byName, when: fmtWhen(mark.at) })}</T> : null}
        {damage ? <T v="small">{t('Damage was approved in a check of these photos.')}</T> : null}
        {demo ? <T v="small">{t('Demo company: photos and videos aren\'t deleted.')}</T>
          : <T v="small">{mark || damage ? t('Kept until {date}, 90 days after they were taken.', { date: day(keptUntil(createdAt, until)) })
            : t('Photos and videos are kept 30 days: these until {date}.', { date: day(keptUntil(createdAt, until)) })}</T>}
        {can && !mark ? <T v="small">{t('If they show damage, mark them to keep them until {date}.', { date: day(damageUntil(createdAt)) })}</T> : null}
      </View>
      {can ? (mark
        ? <Button small v="link" title={t('Take the damage mark off')} loading={busy} onPress={() => set(false)} />
        : <Button small title={t('Mark as damage')} loading={busy} onPress={() => set(true)} />) : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Card>
  );
}
