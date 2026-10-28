import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { takePhoto } from '@/components/dash';
import { dur } from '@/components/history';
import { Button, Card, Chip, Field, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { newId, prepare, upload } from '@/lib/images';
import { retrying } from '@/lib/net';
import { N_, t, tp } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AiError, ai } from '@/lib/store';
import type { Routine, RoutineHow, RoutineTodo, Vehicle } from '@/lib/types';

/**
 * Checks for drivers: an owner or fleet manager says what drivers check on their van (the oil level, the cargo
 * area…), how often and on which vans. The driver who has the van sees what's due on it and ticks it off: fine, or
 * a problem with a note, with a photo where the check asks for one. The server keeps what's due on each van, reminds
 * the driver after an hour and tells the fleet managers after three (functions/src/routines.ts).
 */

/** Suggestions, so setting one up is a tap. Kept as the English text: each person sees them in their language. */
export const SUGGESTED: { key: string; how: RoutineHow; vans: 'all' | 'electric'; photo: boolean }[] = [
  { key: N_('Oil level'), how: 'weekly', vans: 'all', photo: false },
  { key: N_('Coolant level'), how: 'weekly', vans: 'all', photo: false },
  { key: N_('Washer fluid'), how: 'weekly', vans: 'all', photo: false },
  { key: N_('Tyres'), how: 'daily', vans: 'all', photo: false },
  { key: N_('Lights'), how: 'daily', vans: 'all', photo: false },
  { key: N_('Plugged in to charge'), how: 'daily', vans: 'electric', photo: false },
  { key: N_('Cargo area clean and empty'), how: 'every', vans: 'all', photo: true },
  { key: N_('First aid kit and warning triangle'), how: 'weekly', vans: 'all', photo: false },
];

export const routineName = (r: { key: string | null; name: string }) => (r.key ? t(r.key) : r.name);

export function howText(r: { how: RoutineHow; days: number | null }) {
  if (r.how === 'every') return t('Every time a driver gets the van');
  if (r.how === 'daily') return t('Once a day');
  if (r.how === 'weekly') return t('Once a week');
  return t('Every {n} days', { n: r.days || 2 });
}

/** Does the check apply to the van? (the same as on the server) */
export function appliesTo(r: Routine, v: Vehicle) {
  if (v.retired) return false;
  if (r.stationId && r.stationId !== v.stationId) return false;
  if (r.vans === 'all') return true;
  if (r.vans === 'electric') return v.fuel === 'electric';
  return Array.isArray(r.vans) && r.vans.includes(v.id);
}

/** What's due on the van now, if someone has it (the server works it out; a van without a driver has nothing due). */
export function dueOn(v: Vehicle | null | undefined): RoutineTodo[] {
  return v && v.assignedTo && !v.retired ? v.todo || [] : [];
}

function useVansText() {
  const s = useSession();
  return (r: Routine) => {
    const vans = r.vans === 'all' ? t('All vans') : r.vans === 'electric' ? t('Electric vans') : tp(r.vans.length, '{n} van', '{n} vans');
    if (s.stations.length < 2) return vans;
    return `${vans}, ${r.stationId ? s.stationName(r.stationId) : t('every station')}`;
  };
}

/** The checks to do on a van now: for the driver who has it, and the station's fleet managers. */
export function DueChecks({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  const todo = dueOn(v);
  const mine = v.assignedTo?.driverId === s.user?.uid;
  if (!todo.length || (!mine && !s.runs(v.stationId)) || s.mode !== 'firebase') return null;
  return (
    <View style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper, padding: 14, gap: 10 }}>
      <T v="h3">{tp(todo.length, '{n} check to do', '{n} checks to do')}</T>
      <T v="small">{mine ? t('Set by your fleet manager. Tick each one off when you\'ve checked it.') : t('{name} has the van and does these.', { name: v.assignedTo!.driverName })}</T>
      {todo.map((x, i) => <DueCheck key={x.id} v={v} x={x} first={i === 0} />)}
    </View>
  );
}

function DueCheck({ v, x, first }: { v: Vehicle; x: RoutineTodo; first: boolean }) {
  const s = useSession();
  const c = useColors();
  const [problem, setProblem] = useState(false);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const late = Date.now() - x.since > 3 * 3600_000;
  const shoot = async () => {
    setErr(null);
    try { const p = await takePhoto(); if (p) setPhoto(p); } catch { setErr(t('The camera isn\'t allowed. Allow it in the phone\'s settings.')); }
  };
  const save = async (ok: boolean) => {
    if (x.photo && !photo) { setErr(t('Take the photo first.')); return; }
    if (!ok && note.trim().length < 3) { setErr(t('Say what\'s wrong.')); return; }
    setBusy(ok ? 'ok' : 'bad'); setErr(null);
    try {
      let path: string | null = null;
      if (photo) {
        const small = await prepare(photo.uri, photo.w, photo.h, 1600, 0.8);
        path = await upload(small.uri, `orgs/${s.org!.id}/routines/${s.user!.uid}/${newId()}.jpg`);
      }
      // Named here, so sending it again without a connection never records it twice.
      const id = newId();
      await retrying(() => ai.routineDone({ orgId: s.org!.id, vehicleId: v.id, routineId: x.id, ok, note: ok ? '' : note.trim(), path, id }));
    } catch (e) {
      setErr(e instanceof AiError ? e.message : t('Couldn\'t save that. Check the connection.'));
      setBusy(null);
    }
  };
  return (
    <View style={{ gap: 8, borderTopWidth: first ? 0 : 1, borderColor: c.rule, paddingTop: first ? 0 : 10 }}>
      <View style={{ gap: 1 }}>
        <T v="h3">{routineName(x)}</T>
        <T v="small" color={late ? c.alert : undefined}>{t('Due since {when} ({ago})', { when: fmtWhen(x.since), ago: dur(Date.now() - x.since) })}{x.photo ? `. ${t('Needs a photo.')}` : ''}</T>
      </View>
      {x.photo ? <Button small title={photo ? t('Photo taken. Take again') : t('Take the photo')} onPress={shoot} /> : null}
      {problem ? (
        <>
          <Field label={t('What\'s wrong?')} value={note} onChangeText={setNote} maxLength={500} multiline placeholder={t('For example: oil below the minimum, needs a litre')} />
          <Row>
            <Button v="primary" title={t('Send the problem')} loading={busy === 'bad'} disabled={!!busy} onPress={() => save(false)} />
            <Button v="link" title={t('Cancel')} onPress={() => { setProblem(false); setErr(null); }} />
          </Row>
          <T v="small">{t('Your fleet manager gets it straight away.')}</T>
        </>
      ) : (
        <Row>
          <Button v="primary" title={t('Done, all fine')} loading={busy === 'ok'} disabled={!!busy} onPress={() => save(true)} />
          <Button title={t('There\'s a problem')} disabled={!!busy} onPress={() => setProblem(true)} />
        </Row>
      )}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}

/** On the van page: every check that applies to the van and when it was last done. */
export function VanRoutines({ v }: { v: Vehicle }) {
  const s = useSession();
  const c = useColors();
  const rules = s.routines.filter((r) => appliesTo(r, v)).sort((a, b) => routineName(a).localeCompare(routineName(b)));
  if (!rules.length && !s.runs(v.stationId)) return null;
  return (
    <View style={{ gap: 8 }}>
      <T v="h2">{t('Checks for drivers')}</T>
      {!rules.length ? <T v="hint">{t('No checks for this van yet.')}</T> : (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {rules.map((r, i) => {
            const last = v.routines?.[r.id];
            const due = dueOn(v).some((x) => x.id === r.id);
            return (
              <View key={r.id} style={{ paddingVertical: 8, gap: 2, borderTopWidth: i ? 1 : 0, borderColor: c.rule }}>
                <Row>
                  <T v="medium" style={{ flex: 1 }}>{routineName(r)}</T>
                  {due ? <Pill v="amber" text={t('Due')} /> : last && !last.ok ? <Pill v="bad" text={t('Problem')} /> : null}
                </Row>
                <T v="small">{howText(r)}</T>
                <T v="small" color={last && !last.ok ? c.alert : undefined}>{last
                  ? (last.ok ? t('Last done {when}, {name}: fine.', { when: fmtWhen(last.at), name: last.byName }) : t('Last done {when}, {name}: {note}', { when: fmtWhen(last.at), name: last.byName, note: last.note || '' }))
                  : t('Not done yet.')}</T>
              </View>
            );
          })}
        </Card>
      )}
      {s.runs(v.stationId) ? <Button small v="link" title={t('Add or change checks')} onPress={() => router.push('/checks')} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

/** The checks an owner or fleet manager sees and changes (the "Checks for drivers" page). */
export function RoutineList() {
  const s = useSession();
  const c = useColors();
  const vansText = useVansText();
  const [edit, setEdit] = useState<Routine | 'new' | null>(null);
  const may = (r: Routine) => s.role === 'owner' || (!!r.stationId && s.myStations.some((st) => st.id === r.stationId));
  const mine = s.routines.filter((r) => s.role === 'owner' || !r.stationId || s.myStations.some((st) => st.id === r.stationId))
    .sort((a, b) => routineName(a).localeCompare(routineName(b)));
  return (
    <View style={{ gap: 12 }}>
      <T v="hint">{t('Checks drivers do on their van, like the oil level or the cargo area. The driver who has the van sees what\'s due and ticks it off. They get a reminder after an hour; you hear about it if it\'s still not done after 3 hours, and straight away when a driver finds a problem. Reminders only between 6:00 and 20:00.')}</T>
      {edit === 'new' ? <RoutineEditor onDone={() => setEdit(null)} /> : <Button v="primary" title={t('Add check')} onPress={() => setEdit('new')} style={{ alignSelf: 'flex-start' }} />}
      {!mine.length && edit !== 'new' ? <Card dashed><T v="hint">{t('No checks yet. Add one: the suggestions make it a few taps.')}</T></Card> : null}
      {mine.map((r) => (edit !== 'new' && edit?.id === r.id ? <RoutineEditor key={r.id} r={r} onDone={() => setEdit(null)} /> : (
        <Pressable key={r.id} disabled={!may(r)} onPress={() => setEdit(r)} accessibilityRole="button"
          style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
          <Row>
            <T v="h3" style={{ flex: 1 }}>{routineName(r)}</T>
            {r.photo ? <Pill text={t('Photo')} /> : null}
          </Row>
          <T v="small">{[howText(r), vansText(r)].join('. ')}</T>
          {!may(r) ? <T v="small">{t('Set by the fleet owner for every station.')}</T> : null}
        </Pressable>
      )))}
    </View>
  );
}

/** Add or change one check: a suggestion or a name, how often, which vans, and whether it needs a photo. */
function RoutineEditor({ r, onDone }: { r?: Routine; onDone: () => void }) {
  const s = useSession();
  const c = useColors();
  const owner = s.role === 'owner';
  const stations = owner ? s.stations : s.myStations;
  const [key, setKey] = useState<string | null>(r?.key ?? null);
  const [name, setName] = useState(r ? routineName(r) : '');
  const [how, setHow] = useState<RoutineHow>(r?.how || 'daily');
  const [days, setDays] = useState(r?.days || 3);
  const [station, setStation] = useState<string | null>(r ? r.stationId : owner && stations.length > 1 ? null : stations[0]?.id || null);
  const [vans, setVans] = useState<'all' | 'electric' | 'pick'>(r ? (Array.isArray(r.vans) ? 'pick' : r.vans) : 'all');
  const [picked, setPicked] = useState<string[]>(r && Array.isArray(r.vans) ? r.vans : []);
  const [photo, setPhoto] = useState(r?.photo ?? false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pool = s.vehicles.filter((v) => !v.retired && (!station || v.stationId === station) && (owner || s.myStations.some((st) => st.id === v.stationId)));
  const suggest = (x: (typeof SUGGESTED)[number]) => { setKey(x.key); setName(t(x.key)); setHow(x.how); setVans(x.vans); setPhoto(x.photo); };
  const save = async () => {
    if (name.trim().length < 2) { setErr(t('Give the check a name.')); return; }
    if (vans === 'pick' && !picked.length) { setErr(t('Choose the vans.')); return; }
    setBusy(true); setErr(null);
    try {
      // A suggestion keeps its English key (shown in each driver's language), unless its name was changed.
      const k = key && name.trim() === t(key) ? key : null;
      await ai.routine.save({ orgId: s.org!.id, action: 'save', ...(r ? { id: r.id } : {}), key: k, name: name.trim(), how, days: how === 'days' ? days : null,
        vans: vans === 'pick' ? picked : vans, stationId: station, photo });
      onDone();
    } catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that. Check the connection.')); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
    setBusy(true); setErr(null);
    try { await ai.routine.remove({ orgId: s.org!.id, action: 'delete', id: r!.id }); onDone(); }
    catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that. Check the connection.')); setBusy(false); }
  };
  return (
    <Card>
      <T v="h3">{r ? t('Change check') : t('Add check')}</T>
      {!r ? (
        <>
          <T v="medium">{t('Suggestions')}</T>
          <Row gap={6}>{SUGGESTED.map((x) => <Chip key={x.key} text={t(x.key)} on={key === x.key && name === t(x.key)} onPress={() => suggest(x)} />)}</Row>
        </>
      ) : null}
      <Field label={t('What to check')} value={name} onChangeText={setName} maxLength={60} placeholder={t('For example: oil level')} />
      <T v="medium">{t('How often')}</T>
      <Row gap={6}>
        {([['every', t('Every time a driver gets the van')], ['daily', t('Once a day')], ['days', t('Every few days')], ['weekly', t('Once a week')]] as const)
          .map(([k, label]) => <Chip key={k} text={label} on={how === k} onPress={() => setHow(k)} />)}
      </Row>
      {how === 'days' ? <Row gap={6}>{[2, 3, 4, 5, 6].map((n) => <Chip key={n} text={t('Every {n} days', { n })} on={days === n} onPress={() => setDays(n)} />)}</Row> : null}
      {stations.length > 1 || (owner && s.stations.length > 1) ? (
        <>
          <T v="medium">{t('Station')}</T>
          <Row gap={6}>
            {owner ? <Chip text={t('Every station')} on={station === null} onPress={() => { setStation(null); setPicked([]); }} /> : null}
            {stations.map((st) => <Chip key={st.id} text={st.name} on={station === st.id} onPress={() => { setStation(st.id); setPicked((p) => p.filter((id) => s.vehicles.find((v) => v.id === id)?.stationId === st.id)); }} />)}
          </Row>
        </>
      ) : null}
      <T v="medium">{t('Which vans')}</T>
      <Row gap={6}>
        <Chip text={t('All vans')} on={vans === 'all'} onPress={() => setVans('all')} />
        <Chip text={t('Electric vans')} on={vans === 'electric'} onPress={() => setVans('electric')} />
        <Chip text={t('Choose vans')} on={vans === 'pick'} onPress={() => setVans('pick')} />
      </Row>
      {vans === 'pick' ? (
        <Row gap={6}>{pool.map((v) => <Chip key={v.id} text={v.plate ? `${v.name} (${v.plate})` : v.name} on={picked.includes(v.id)}
          onPress={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id]))} />)}</Row>
      ) : null}
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <View style={{ flex: 1, gap: 1 }}>
          <T v="medium">{t('Needs a photo')}</T>
          <T v="small">{t('The driver takes one as proof, for example of the cargo area.')}</T>
        </View>
        <Switch value={photo} onValueChange={setPhoto} accessibilityLabel={t('Needs a photo')} />
      </Row>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      <Row>
        <Button v="primary" title={r ? t('Save changes') : t('Add check')} loading={busy} disabled={busy} onPress={save} />
        <Button v="link" title={t('Cancel')} onPress={onDone} />
        {r ? <Button v="link" title={armed ? t('Tap again to remove') : t('Remove')} onPress={remove} disabled={busy} /> : null}
      </Row>
    </Card>
  );
}

/** In the Account tab: how many checks there are, and the way to the page. */
export function RoutinesCard() {
  const s = useSession();
  const n = s.routines.filter((r) => s.role === 'owner' || !r.stationId || s.myStations.some((st) => st.id === r.stationId)).length;
  return (
    <Card>
      <T v="h3">{t('Checks for drivers')}</T>
      <T v="hint">{n ? tp(n, '{n} check drivers do on their van.', '{n} checks drivers do on their van.') : t('Like the oil level or the cargo area: drivers tick them off on their van and get a reminder when one is due.')}</T>
      <Button small title={n ? t('See and change checks') : t('Add check')} onPress={() => router.push('/checks')} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}
