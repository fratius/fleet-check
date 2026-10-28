import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, F, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { watchHistory, watchMembers } from '@/lib/people';
import { useSession } from '@/lib/session';
import { QUEUED, sendCall } from '@/lib/outbox';
import { handoverMedia, needsPickup, noDropoff, stillOut } from '@/lib/videos';
import { VideoHandover } from '@/components/video';
import { flash } from '@/lib/flash';
import { fwd, t, tp } from '@/lib/i18n';
import { AiError, ai } from '@/lib/store';
import { END_REASON, ROLE_NAME, approvedDamage, roleOf, type Assignment, type Member, type Vehicle } from '@/lib/types';

/** "3 days", "5 h", "40 min". */
export function dur(ms: number) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return t('{n} min', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('{n} h', { n: h });
  const d = Math.round(h / 24);
  return tp(d, '{n} day', '{n} days');
}
export const sinceText = (ms: number) => t('since {when} ({ago})', { when: fmtWhen(ms), ago: dur(Date.now() - ms) });

/**
 * The km a driver had a van from and to, from the dashboard photos while they had it (null: no photo then). The
 * start is the van's last reading if it was from the 24 hours before, so the km of the driver before aren't theirs.
 */
export function kmLine(a: { kmStart?: number | null; kmEnd?: number | null; end: number | null }): string | null {
  const from = a.kmStart, to = a.kmEnd;
  if (from == null) return null;
  if (to != null && to > from) {
    return a.end == null ? t('{from} to {to} km so far: {km} km', { from, to, km: to - from }) : t('{from} to {to} km: {km} km driven', { from, to, km: to - from });
  }
  return a.end == null ? t('Got it at {km} km', { km: from }) : t('Got it at {km} km; no dashboard photo after that', { km: from });
}

/**
 * The full assignment history of one van or one person, newest first. Owners read all of it, managers what
 * happened at their stations, drivers only their own (the rules enforce the same).
 */
export function useHistory(by: { vehicleId?: string; driverId?: string }) {
  const s = useSession();
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orgId = s.org?.id;
  const me = s.user?.uid;
  const own = s.role === 'driver' || (!!by.driverId && by.driverId === me);
  const scope = s.role === 'owner' ? '*' : s.myStations.map((st) => st.id).join(',');
  // Drivers can't query a van's history (it has other drivers in it), so they get their own rows from the session.
  const fromSession = s.mode !== 'firebase' || (s.role === 'driver' && !!by.vehicleId);
  useEffect(() => {
    if (fromSession || !orgId) return;
    setRows(null); setError(null);
    const stations = own || scope === '*' ? null : scope ? scope.split(',') : [];
    if (stations && !stations.length) { setRows([]); return; }
    return watchHistory(orgId, by, stations, setRows,
      () => setError(t('Couldn\'t load the history. Check the connection.')));
  }, [orgId, by.vehicleId, by.driverId, own, scope, fromSession]);
  const local = useMemo(() => s.assignments.filter((a) => (by.vehicleId ? a.vehicleId === by.vehicleId : a.driverId === by.driverId)),
    [s.assignments, by.vehicleId, by.driverId]);
  return { rows: fromSession ? local : rows, error: fromSession ? null : error };
}

/** One line of history: who had the van (or which van the person had), from when to when, and why it ended. */
export function HistoryRow({ a, show, first }: { a: Assignment; show: 'driver' | 'van'; first: boolean }) {
  const s = useSession();
  const c = useColors();
  const open = a.end == null;
  const end = a.end ?? Date.now();
  // What happened to the van while this person had it (from the records loaded in the app).
  const inside = (t: number) => t >= a.start && t <= end;
  const walks = s.walks.filter((w) => w.vehicleId === a.vehicleId && inside(w.createdAt));
  const checks = s.checks.filter((k) => k.vehicleId === a.vehicleId && inside(k.createdAt));
  const damage = checks.reduce((n, k) => n + approvedDamage(k).length, 0);
  const canOpen = show === 'driver' ? s.staff || a.driverId === s.user?.uid : s.vehicles.some((v) => v.id === a.vehicleId);
  const title = show === 'driver' ? a.driverName : [a.vehicleName, a.plate].filter(Boolean).join(', ');
  // The proof at each end (photos or video, also videos added later), and whether the drop-off is missing.
  const m = handoverMedia(a, s.videos, s.walks);
  const missing = noDropoff(a, s.videos, s.walks, s.stations);
  const noPickup = needsPickup(a, s.videos, s.walks);
  const out = stillOut(a, s.stations);
  const van = s.vehicles.find((x) => x.id === a.vehicleId);
  return (
    <Pressable disabled={!canOpen} accessibilityRole={canOpen ? 'button' : undefined}
      onPress={() => router.push(show === 'driver' ? `/person/${a.driverId}` : `/vehicle/${a.vehicleId}`)}
      style={{ gap: 3, borderTopWidth: first ? 0 : 1, borderColor: c.rule, paddingTop: first ? 0 : 10 }}>
      <Row>
        <T v="medium" style={{ flex: 1 }} numberOfLines={1}>{title}</T>
        {open ? <Pill v="solid" text={t('Now')} /> : null}
        {canOpen ? <T v="h3" color={c.ink2}>{fwd()}</T> : null}
      </Row>
      <T v="small">{open ? t('{from} to now, {time}', { from: fmtWhen(a.start), time: dur(end - a.start) }) : t('{from} to {to}, {time}', { from: fmtWhen(a.start), to: fmtWhen(a.end), time: dur(end - a.start) })}</T>
      {kmLine(a) ? <T v="small" style={{ fontFamily: F.semi }} color={c.ink}>{kmLine(a)}</T> : null}
      <T v="small">
        {[a.startedBy === a.driverId ? t('Picked up by the driver') : t('Given by {name}', { name: a.startedByName }),
          !open && a.endReason ? (a.endedByName ? t('{reason} by {name}', { reason: t(END_REASON[a.endReason] || a.endReason), name: a.endedByName }) : t(END_REASON[a.endReason] || a.endReason)) : '',
          s.stations.length > 1 && s.staff ? s.stationName(a.stationId) : ''].filter(Boolean).join('. ')}
      </T>
      {m.start.walkId || m.end.walkId || m.start.videoId || m.end.videoId ? (
        <Row gap={6}>
          {m.start.walkId ? <Button small v="link" title={m.start.late ? t('Pick-up photos (added later)') : t('Pick-up photos')} onPress={() => router.push(`/walk/${m.start.walkId}`)} /> : null}
          {m.start.videoId ? <Button small v="link" title={m.start.late ? t('Pick-up video (added later)') : t('Pick-up video')} onPress={() => router.push(`/video/${m.start.videoId}`)} /> : null}
          {m.end.walkId ? <Button small v="link" title={a.endReason === 'taken over' ? t('Photos at takeover') : t('Drop-off photos')} onPress={() => router.push(`/walk/${m.end.walkId}`)} /> : null}
          {m.end.videoId ? <Button small v="link" title={a.endReason === 'taken over' ? t('Video at takeover') : m.end.late ? t('Drop-off video (added later)') : t('Drop-off video')} onPress={() => router.push(`/video/${m.end.videoId}`)} /> : null}
        </Row>
      ) : null}
      {missing ? <T v="small" color={c.alert}>{a.endReason === 'taken over'
        ? (a.endedByName ? t('No drop-off video or photos: {driver} didn\'t drop it off, {next} took it over.', { driver: a.driverName, next: a.endedByName })
          : t('No drop-off video or photos: {driver} didn\'t drop it off, the next driver took it over.', { driver: a.driverName }))
        : t('No drop-off video or photos.')}</T> : null}
      {out ? <T v="small" color={c.alert}>{t('Not dropped off after {time}.', { time: dur(Date.now() - a.start) })}</T> : null}
      {noPickup ? <T v="small" color={c.alert}>{t('No pick-up video or photos yet.')}</T> : null}
      {van && s.mode === 'firebase' && missing && s.runs(a.stationId) ? <VideoHandover v={van} kind="dropoff" assignmentId={a.id} title={t('Add the drop-off video')} /> : null}
      {van && s.mode === 'firebase' && open && !m.start.walkId && !m.start.videoId && (a.driverId === s.user?.uid || s.runs(a.stationId))
        ? <VideoHandover v={van} kind="pickup" assignmentId={a.id} title={t('Add a pick-up video')} /> : null}
      {walks.length || checks.length ? (
        <T v="small">{damage
          ? t('In this time: {walks}, {checks}, {damage} found', { walks: tp(walks.length, '{n} walk-around', '{n} walk-arounds'), checks: tp(checks.length, '{n} check', '{n} checks'), damage: tp(damage, '{n} approved damage', '{n} approved damages') })
          : t('In this time: {walks}, {checks}', { walks: tp(walks.length, '{n} walk-around', '{n} walk-arounds'), checks: tp(checks.length, '{n} check', '{n} checks') })}</T>
      ) : null}
    </Pressable>
  );
}

export function HistoryList({ rows, error, show, empty }: { rows: Assignment[] | null; error: string | null; show: 'driver' | 'van'; empty: string }) {
  const c = useColors();
  if (error) return <T v="hint" color={c.alert}>{error}</T>;
  if (!rows) return <T v="hint">{t('Loading…')}</T>;
  if (!rows.length) return <T v="hint">{empty}</T>;
  return <View style={{ gap: 10 }}>{rows.map((a, i) => <HistoryRow key={a.id} a={a} show={show} first={i === 0} />)}</View>;
}

/** What happened after giving a van: whether the driver got a notification on their phone. */
function given(person: string, van: string, r: { notified?: number; unchanged?: boolean }, self: boolean) {
  if (self) return t('You have {van}.', { van });
  if (r.unchanged) return t('{person} has {van}.', { person, van });
  return r.notified
    ? t('{person} has {van} now. Their phone got a notification asking for the pick-up video or photos.', { person, van })
    : t('{person} has {van} now. Their phone doesn\'t have notifications on, so they\'ll see it, and the request for the pick-up video or photos, when they open the app.', { person, van });
}

/** Owners and managers of the van's station give it to a driver (or a fleet manager) of that station. */
export function DriverPicker({ v, onDone }: { v: Vehicle; onDone: () => void }) {
  const s = useSession();
  const c = useColors();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const orgId = s.org?.id;
  useEffect(() => {
    if (!orgId) return;
    return watchMembers(orgId, setMembers, () => setErr(t('Couldn\'t load the people of this station.')));
  }, [orgId]);
  const vanOf = useMemo(() => new Map(s.vehicles.filter((x) => x.assignedTo && !x.retired).map((x) => [x.assignedTo!.driverId, x])), [s.vehicles]);
  const people = (members || [])
    .filter((m) => ['driver', 'manager'].includes(roleOf(m) || '') && (m.stationIds || []).includes(v.stationId || ''))
    .sort((a, b) => (roleOf(a) === roleOf(b) ? a.name.localeCompare(b.name) : roleOf(a) === 'driver' ? -1 : 1));
  const give = async (m: Member) => {
    setBusy(m.uid); setErr(null);
    try {
      // Kept on the phone and sent by itself without a connection (lib/outbox.ts); only if the van hasn't changed meanwhile.
      const r = await sendCall<{ notified?: number; unchanged?: boolean }>('assignVan', { orgId: orgId!, vehicleId: v.id, driverId: m.uid, expect: v.assignedTo?.assignmentId ?? null },
        { title: t('Give {van} to {name}', { van: v.name, name: m.name }), vehicleId: v.id, vehicleName: v.name, personId: m.uid });
      flash(`van:${v.id}`, r === QUEUED ? t('Saved on this phone. It goes through by itself when there\'s a connection.') : given(m.name, v.name, r, m.uid === s.user?.uid));
      onDone();
    }
    catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t give the van. Check the connection.')); } finally { setBusy(null); }
  };
  return (
    <View style={{ gap: 8 }}>
      <T v="medium">{t('Give {van} to', { van: v.name })}</T>
      <T v="small">{t('People of {station}. Someone who already has a van hands it back: it becomes free.', { station: s.stationName(v.stationId) })}</T>
      {!members ? <T v="hint">{t('Loading…')}</T> : !people.length ? <T v="hint">{t('Nobody at this station yet. Invite drivers under People.')}</T> : null}
      {people.map((m) => {
        const has = vanOf.get(m.uid);
        const current = v.assignedTo?.driverId === m.uid;
        return (
          <Pressable key={m.uid} disabled={!!busy || current} onPress={() => give(m)} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: current ? c.ink : c.rule, borderRadius: 4, padding: 10, opacity: busy && busy !== m.uid ? 0.5 : 1 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="medium" numberOfLines={1}>{m.name}</T>
              <T v="small" numberOfLines={1}>{[current ? t('Has this van now') : has ? t('Has {van} now', { van: has.name }) : t('No van'), roleOf(m) === 'manager' ? t(ROLE_NAME.manager) : ''].filter(Boolean).join(', ')}</T>
            </View>
            {busy === m.uid ? <T v="small">{t('Saving…')}</T> : !current ? <Pill v={has ? 'amber' : 'good'} text={has ? t('Swap') : t('Give')} /> : null}
          </Pressable>
        );
      })}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title={t('Cancel')} onPress={onDone} />
    </View>
  );
}

/** The other direction: owners and managers give a person a van of their station. */
export function VanPicker({ m, onDone }: { m: Member; onDone: () => void }) {
  const s = useSession();
  const c = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const vans = s.vehicles
    .filter((v) => !v.retired && (m.stationIds || []).includes(v.stationId || '') && s.runs(v.stationId))
    .sort((a, b) => Number(!!a.assignedTo) - Number(!!b.assignedTo) || a.name.localeCompare(b.name));
  const give = async (v: Vehicle) => {
    setBusy(v.id); setErr(null);
    try {
      const r = await sendCall<{ notified?: number; unchanged?: boolean }>('assignVan', { orgId: s.org!.id, vehicleId: v.id, driverId: m.uid, expect: v.assignedTo?.assignmentId ?? null },
        { title: t('Give {van} to {name}', { van: v.name, name: m.name }), vehicleId: v.id, vehicleName: v.name, personId: m.uid });
      flash(`person:${m.uid}`, r === QUEUED ? t('Saved on this phone. It goes through by itself when there\'s a connection.') : given(m.name, v.name, r, m.uid === s.user?.uid));
      onDone();
    }
    catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t give the van. Check the connection.')); } finally { setBusy(null); }
  };
  return (
    <View style={{ gap: 8 }}>
      <T v="medium">{t('Give {name} a van', { name: m.name })}</T>
      <T v="small">{t('Free vans first. Taking a van from someone else leaves them without one.')}</T>
      {!vans.length ? <T v="hint">{t('No vans at {station}.', { station: s.stationName(m.stationIds?.[0]) })}</T> : null}
      {vans.map((v) => {
        const current = v.assignedTo?.driverId === m.uid;
        return (
          <Pressable key={v.id} disabled={!!busy || current} onPress={() => give(v)} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: current ? c.ink : c.rule, borderRadius: 4, padding: 10, opacity: busy && busy !== v.id ? 0.5 : 1 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="medium" numberOfLines={1}>{v.name}{v.plate ? `, ${v.plate}` : ''}</T>
              <T v="small" numberOfLines={1}>{current ? t('{name} has it now', { name: m.name }) : v.assignedTo ? t('{name} has it now', { name: v.assignedTo.driverName }) : t('Free')}</T>
            </View>
            {busy === v.id ? <T v="small">{t('Saving…')}</T> : !current ? <Pill v={v.assignedTo ? 'amber' : 'good'} text={v.assignedTo ? t('Take over') : t('Free')} /> : null}
          </Pressable>
        );
      })}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title={t('Cancel')} onPress={onDone} />
    </View>
  );
}
