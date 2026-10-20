import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { watchHistory, watchMembers } from '@/lib/people';
import { useSession } from '@/lib/session';
import { handoverMedia, needsPickup, noDropoff, stillOut } from '@/lib/videos';
import { VideoHandover } from '@/components/video';
import { flash } from '@/lib/flash';
import { AiError, ai } from '@/lib/store';
import { END_REASON, ROLE_NAME, approvedDamage, roleOf, type Assignment, type Member, type Vehicle } from '@/lib/types';

/** "3 days", "5 h", "40 min". */
export function dur(ms: number) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} days`;
}
export const sinceText = (ms: number) => `since ${fmtWhen(ms)} (${dur(Date.now() - ms)})`;

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
      () => setError('Couldn\'t load the history. Check the connection.'));
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
        {open ? <Pill v="solid" text="Now" /> : null}
        {canOpen ? <T v="h3" color={c.ink2}>›</T> : null}
      </Row>
      <T v="small">{fmtWhen(a.start)} to {open ? 'now' : fmtWhen(a.end)}, {dur(end - a.start)}</T>
      <T v="small">
        {[a.startedBy === a.driverId ? 'Picked up by the driver' : `Given by ${a.startedByName}`, !open && a.endReason ? `${END_REASON[a.endReason] || a.endReason}${a.endedByName ? ' by ' + a.endedByName : ''}` : '',
          s.stations.length > 1 && s.staff ? s.stationName(a.stationId) : ''].filter(Boolean).join('. ')}
      </T>
      {m.start.walkId || m.end.walkId || m.start.videoId || m.end.videoId ? (
        <Row gap={6}>
          {m.start.walkId ? <Button small v="link" title={m.start.late ? 'Pick-up photos (added later)' : 'Pick-up photos'} onPress={() => router.push(`/walk/${m.start.walkId}`)} /> : null}
          {m.start.videoId ? <Button small v="link" title={m.start.late ? 'Pick-up video (added later)' : 'Pick-up video'} onPress={() => router.push(`/video/${m.start.videoId}`)} /> : null}
          {m.end.walkId ? <Button small v="link" title={a.endReason === 'taken over' ? 'Photos at takeover' : 'Drop-off photos'} onPress={() => router.push(`/walk/${m.end.walkId}`)} /> : null}
          {m.end.videoId ? <Button small v="link" title={a.endReason === 'taken over' ? 'Video at takeover' : m.end.late ? 'Drop-off video (added later)' : 'Drop-off video'} onPress={() => router.push(`/video/${m.end.videoId}`)} /> : null}
        </Row>
      ) : null}
      {missing ? <T v="small" color={c.alert}>No drop-off video or photos{a.endReason === 'taken over' ? `: ${a.driverName} didn't drop it off, ${a.endedByName || 'the next driver'} took it over` : ''}.</T> : null}
      {out ? <T v="small" color={c.alert}>Not dropped off after {dur(Date.now() - a.start)}.</T> : null}
      {noPickup ? <T v="small" color={c.alert}>No pick-up video or photos yet.</T> : null}
      {van && s.mode === 'firebase' && missing && s.runs(a.stationId) ? <VideoHandover v={van} kind="dropoff" assignmentId={a.id} title="Add the drop-off video" /> : null}
      {van && s.mode === 'firebase' && open && !m.start.walkId && !m.start.videoId && (a.driverId === s.user?.uid || s.runs(a.stationId))
        ? <VideoHandover v={van} kind="pickup" assignmentId={a.id} title="Add a pick-up video" /> : null}
      {walks.length || checks.length ? (
        <T v="small">{[`${walks.length} walk-around${walks.length === 1 ? '' : 's'}`, `${checks.length} check${checks.length === 1 ? '' : 's'}`,
          damage ? `${damage} approved damage${damage === 1 ? '' : 's'} found` : ''].filter(Boolean).join(', ')} in this time</T>
      ) : null}
    </Pressable>
  );
}

export function HistoryList({ rows, error, show, empty }: { rows: Assignment[] | null; error: string | null; show: 'driver' | 'van'; empty: string }) {
  const c = useColors();
  if (error) return <T v="hint" color={c.alert}>{error}</T>;
  if (!rows) return <T v="hint">Loading…</T>;
  if (!rows.length) return <T v="hint">{empty}</T>;
  return <View style={{ gap: 10 }}>{rows.map((a, i) => <HistoryRow key={a.id} a={a} show={show} first={i === 0} />)}</View>;
}

/** What happened after giving a van: whether the driver got a notification on their phone. */
function given(person: string, van: string, r: { notified?: number; unchanged?: boolean }, self: boolean) {
  if (r.unchanged || self) return `${self ? 'You have' : person + ' has'} ${van}.`;
  return r.notified
    ? `${person} has ${van} now. Their phone got a notification asking for the pick-up video or photos.`
    : `${person} has ${van} now. Their phone doesn't have notifications on, so they'll see it, and the request for the pick-up video or photos, when they open the app.`;
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
    return watchMembers(orgId, setMembers, () => setErr('Couldn\'t load the people of this station.'));
  }, [orgId]);
  const vanOf = useMemo(() => new Map(s.vehicles.filter((x) => x.assignedTo && !x.retired).map((x) => [x.assignedTo!.driverId, x])), [s.vehicles]);
  const people = (members || [])
    .filter((m) => ['driver', 'manager'].includes(roleOf(m) || '') && (m.stationIds || []).includes(v.stationId || ''))
    .sort((a, b) => (roleOf(a) === roleOf(b) ? a.name.localeCompare(b.name) : roleOf(a) === 'driver' ? -1 : 1));
  const give = async (m: Member) => {
    setBusy(m.uid); setErr(null);
    try {
      const r = await ai.assignVan({ orgId: orgId!, vehicleId: v.id, driverId: m.uid });
      flash(`van:${v.id}`, given(m.name, v.name, r, m.uid === s.user?.uid));
      onDone();
    }
    catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t give the van. Check the connection.'); } finally { setBusy(null); }
  };
  return (
    <View style={{ gap: 8 }}>
      <T v="medium">Give {v.name} to</T>
      <T v="small">People of {s.stationName(v.stationId)}. Someone who already has a van hands it back: it becomes free.</T>
      {!members ? <T v="hint">Loading…</T> : !people.length ? <T v="hint">Nobody at this station yet. Invite drivers under People.</T> : null}
      {people.map((m) => {
        const has = vanOf.get(m.uid);
        const current = v.assignedTo?.driverId === m.uid;
        return (
          <Pressable key={m.uid} disabled={!!busy || current} onPress={() => give(m)} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: current ? c.ink : c.rule, borderRadius: 4, padding: 10, opacity: busy && busy !== m.uid ? 0.5 : 1 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="medium" numberOfLines={1}>{m.name}</T>
              <T v="small" numberOfLines={1}>{current ? 'Has this van now' : has ? `Has ${has.name} now` : 'No van'}{roleOf(m) === 'manager' ? `, ${ROLE_NAME.manager.toLowerCase()}` : ''}</T>
            </View>
            {busy === m.uid ? <T v="small">Saving…</T> : !current ? <Pill v={has ? 'amber' : 'good'} text={has ? 'Swap' : 'Free'} /> : null}
          </Pressable>
        );
      })}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title="Cancel" onPress={onDone} />
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
      const r = await ai.assignVan({ orgId: s.org!.id, vehicleId: v.id, driverId: m.uid });
      flash(`person:${m.uid}`, given(m.name, v.name, r, m.uid === s.user?.uid));
      onDone();
    }
    catch (e) { setErr(e instanceof AiError ? e.message : 'Couldn\'t give the van. Check the connection.'); } finally { setBusy(null); }
  };
  return (
    <View style={{ gap: 8 }}>
      <T v="medium">Give {m.name} a van</T>
      <T v="small">Free vans first. Taking a van from someone else leaves them without one.</T>
      {!vans.length ? <T v="hint">No vans at {s.stationName(m.stationIds?.[0])}.</T> : null}
      {vans.map((v) => {
        const current = v.assignedTo?.driverId === m.uid;
        return (
          <Pressable key={v.id} disabled={!!busy || current} onPress={() => give(v)} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, borderColor: current ? c.ink : c.rule, borderRadius: 4, padding: 10, opacity: busy && busy !== v.id ? 0.5 : 1 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="medium" numberOfLines={1}>{v.name}{v.plate ? `, ${v.plate}` : ''}</T>
              <T v="small" numberOfLines={1}>{current ? `${m.name} has it now` : v.assignedTo ? `${v.assignedTo.driverName} has it now` : 'Free'}</T>
            </View>
            {busy === v.id ? <T v="small">Saving…</T> : !current ? <Pill v={v.assignedTo ? 'amber' : 'good'} text={v.assignedTo ? 'Take over' : 'Free'} /> : null}
          </Pressable>
        );
      })}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Button v="link" small title="Cancel" onPress={onDone} />
    </View>
  );
}
