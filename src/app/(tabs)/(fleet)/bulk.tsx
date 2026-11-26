import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button, Card, Chip, F, Field, MARKER, Notice, Pill, Plate, Row, Screen, T, hs, useColors } from '@/components/ui';
import { CONTRACT, COSTS, DUE, HELP, INSURANCE, MILEAGE, OTHER, SIZE, VEHICLE, show, type FieldSpec } from '@/components/vanfacts';
import { CLASSES, CLS } from '@/lib/frames';
import { importPhotoPath, pickFleetFile, uploadFleetFile, type Picked } from '@/lib/fleetfile';
import { N_, t, tp } from '@/lib/i18n';
import { newId, prepare, upload } from '@/lib/images';
import { QUEUED, sendCall } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { ai, failText, type FleetAdded, type FleetRead, type FleetRow } from '@/lib/store';
import { plateKey } from '@/lib/vans';

/**
 * Adding the whole fleet from a file (product owner, 2026-11-20). Owners and fleet managers upload the fleet list they
 * already have: an Excel file, a CSV, a PDF, or photos of a printed list. The AI reads it (functions/src/fleetfile.ts)
 * and every van comes back here to be checked: its type, its station, its plate and name. Nothing is saved until
 * "Add N vans". The product owner's rules: a van already in the fleet only gets the details it doesn't have yet;
 * vans aren't given to drivers from a file; an owner can create a station the file names; more vans than the plan
 * has room for are shown before saving, so the person unticks some or takes a bigger plan. Money only for owners.
 */

/** Every field a van's record has, for the labels of the details read. */
const SPECS: FieldSpec[] = [...VEHICLE, ...SIZE, ...HELP, ...MILEAGE, ...CONTRACT, ...INSURANCE, ...COSTS, ...DUE, ...OTHER];
const COLUMN: Record<string, string> = {
  plate: N_('Number plate'), name: N_('Own name or fleet number'), station: N_('Station'), make: N_('Make'), model: N_('Model'),
  vehicle: N_('Make and model'), body: N_('Body'), driver: N_('Driver'), emptyKg: N_('Empty weight'), notes: N_('Notes'),
};
const labelOf = (key: string) => (COLUMN[key] ? t(COLUMN[key]) : SPECS.find((f) => f.key === key) ? t(SPECS.find((f) => f.key === key)!.label) : key);
/** Station names as a file writes them ("DBE3", "Berlin Spandau"), so the same one is one group. */
const sKey = (x: string | null | undefined) => (x || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
const tKey = (x: string | null | undefined) => (x || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const MAX_MB = 15;
const SHOWN = 40;

/** Where the vans of a group go: a station there is, or a new one (owners). */
type Dest = { id: string } | { make: string };
type Shot = { uri: string; w: number; h: number };

/**
 * Owners and fleet managers add vans. A driver who opens this page by its link is told it isn't for them (blind test,
 * 26 Nov 2026, cause 2; the rules and the server refuse them too).
 */
export default function AddFleet() {
  const s = useSession();
  if (s.role === 'driver') return <Screen edges={[]}><Card dashed><T v="hint">{t('Not available for drivers: only fleet managers and owners add vans.')}</T></Card></Screen>;
  return <AddFleetPage />;
}

function AddFleetPage() {
  const s = useSession();
  const c = useColors();
  const [shots, setShots] = useState<Shot[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<FleetRead | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [off, setOff] = useState<Record<number, boolean>>({});
  const [types, setTypes] = useState<Record<string, string | null>>({});
  const [dests, setDests] = useState<Record<string, Dest | null>>({});
  const [edits, setEdits] = useState<Record<number, { plate?: string; name?: string }>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [changing, setChanging] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<FleetAdded | 'queued' | null>(null);

  const owner = s.role === 'owner';
  // Stations this person adds vans to: every station for owners, their own for managers.
  const mine = s.mode === 'local' ? s.stations : s.myStations.filter((st) => s.runs(st.id));

  const begin = (r: FleetRead, name: string | null) => {
    // The type of each model and the station of each group, as the file and the AI said; the person changes them.
    const ty: Record<string, string | null> = {};
    const de: Record<string, Dest | null> = {};
    const out: Record<number, boolean> = {};
    for (const x of r.rows) {
      if (!(tKey(x.desc) in ty)) ty[tKey(x.desc)] = x.cls;
      const k = sKey(x.station);
      if (!(k in de)) de[k] = x.stationId ? (s.runs(x.stationId) ? { id: x.stationId } : null) : x.station && owner ? { make: x.station } : mine[0] ? { id: mine[0].id } : null;
      // At another station: the server leaves it out; a station that isn't this manager's: not theirs to add.
      if (x.elsewhere || (!x.have && x.stationId && !s.runs(x.stationId))) out[x.i] = true;
    }
    setTypes(ty); setDests(de); setOff(out); setEdits({}); setOpen(null); setChanging([]); setAll(false); setRead(r); setFile(name);
  };
  const reset = () => { setRead(null); setShots([]); setErr(null); setDone(null); setFile(null); };

  const readFile = async () => {
    setErr(null);
    let p: Picked | null;
    try { p = await pickFleetFile(); } catch (e) { setErr(failText(e, 'Opening the file')); return; }
    if (!p) return;
    if (p.size > MAX_MB * 1024 * 1024) { setErr(t('The file is bigger than {n} MB. Upload the list on its own, as .xlsx or CSV.', { n: MAX_MB })); return; }
    // A photo chosen as the file: like the photos of a printed list.
    if (p.mime.startsWith('image/')) { setShots((x) => [...x, { uri: p.uri, w: 0, h: 0 }].slice(0, 6)); return; }
    try {
      setStep(t('Uploading the file…'));
      const path = await uploadFleetFile(s.org!.id, s.user!.uid, p);
      setStep(t('Reading the list…'));
      begin(await ai.readFleetFile({ orgId: s.org!.id, paths: [path], name: p.name }), p.name);
    } catch (e) { setErr(failText(e, 'Reading the fleet list')); } finally { setStep(null); }
  };
  const addShots = async (camera: boolean) => {
    setErr(null);
    try {
      if (camera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setErr(t('Allow camera access in Settings to take photos.')); return; }
      }
      const r = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: true, selectionLimit: 6 - shots.length, orderedSelection: true });
      if (r.canceled) return;
      setShots((x) => [...x, ...r.assets.map((a) => ({ uri: a.uri, w: a.width, h: a.height }))].slice(0, 6));
    } catch { setErr(t('Couldn\'t open the camera or photos.')); }
  };
  const readShots = async () => {
    setErr(null);
    try {
      setStep(t('Uploading photos'));
      const batch = newId();
      const paths = await Promise.all(shots.map(async (sh, i) => {
        const small = await prepare(sh.uri, sh.w, sh.h, 2400, 0.9);
        return upload(small.uri, importPhotoPath(s.org!.id, s.user!.uid, batch, i + 1));
      }));
      setStep(t('Reading the list…'));
      begin(await ai.readFleetFile({ orgId: s.org!.id, paths, name: null }), null);
    } catch (e) { setErr(failText(e, 'Reading the fleet list')); } finally { setStep(null); }
  };

  if (s.mode !== 'firebase') {
    return <Screen edges={[]}><Notice text={t('Reading a fleet list needs the Firebase backend. Until it\'s connected, add vans one by one.')} /></Screen>;
  }
  if (!mine.length && !owner) {
    return <Screen edges={[]}><Notice tone="bad" text={t('You aren\'t managing a station yet.')} /></Screen>;
  }

  /* ---------- done ---------- */
  if (done) {
    const d = done === 'queued' ? null : done;
    return (
      <Screen edges={[]}>
        <Card>
          <T v="h1">{!d ? t('Saving the vans') : d.added ? tp(d.added, '{n} van added', '{n} vans added') : d.filled ? tp(d.filled, '{n} van filled in', '{n} vans filled in') : t('Nothing new to add')}</T>
          {d ? (
            <>
              {d.filled ? <T>{tp(d.filled, '{n} van already in the fleet got the details it didn\'t have yet.', '{n} vans already in the fleet got the details they didn\'t have yet.')}</T> : null}
              {d.unchanged ? <T v="hint">{tp(d.unchanged, '{n} van already in the fleet had everything already.', '{n} vans already in the fleet had everything already.')}</T> : null}
              {d.elsewhere ? <T v="hint">{tp(d.elsewhere, '{n} van is at another station and was left as it is.', '{n} vans are at another station and were left as they are.')}</T> : null}
              {d.stations.length ? <T>{tp(d.stations.length, 'New station: {names}', 'New stations: {names}', { names: d.stations.join(', ') })}</T> : null}
              <T v="hint">{t('Give the vans to drivers as usual, from the van or from the person: each handover gets its pick-up photos.')}</T>
            </>
          ) : <T>{t('There\'s no connection. The vans are saved by themselves when it\'s back; the strip at the bottom shows it.')}</T>}
          <Row>
            <Button v="primary" title={t('Open the fleet')} onPress={() => router.dismissTo('/')} />
            <Button title={t('Upload another list')} onPress={reset} />
          </Row>
        </Card>
      </Screen>
    );
  }

  /* ---------- choosing the file ---------- */
  if (!read) {
    return (
      <Screen edges={[]}>
        <View style={{ gap: 4 }}>
          <T v="h1">{t('Add the whole fleet')}</T>
          <T v="hint">{t('Upload the fleet list you already have. The AI reads every van in it with its details, and you check them all before anything is saved.')}</T>
        </View>
        <View style={{ backgroundColor: MARKER, borderRadius: 4, borderWidth: 2, borderColor: '#000', padding: 14, gap: 10 }}>
          <Text style={{ fontFamily: F.condBold, fontSize: hs(24), lineHeight: hs(27), color: '#000' }}>{t('Your fleet list')}</Text>
          <T v="small" color="#000">{t('Excel (.xlsx), CSV or PDF: a fleet list, a leasing or insurance list, an export from another system. One van per line, with its number plate. Anything else the file has is read too: VIN, first registration, TÜV, contract, insurance, fuel card, station.')}</T>
          {step ? <Button v="primary" wide title={step} loading disabled /> : <Button v="primary" wide title={t('Choose a file')} onPress={readFile} />}
          {step ? <T v="small" color="#000">{t('A long list takes a minute or two. Keep this page open.')}</T> : null}
        </View>
        <Card>
          <T v="h2">{t('Or photos of a printed list')}</T>
          <T v="hint">{t('Up to 6 pages, each straight on and sharp.')}</T>
          {shots.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {shots.map((p, i) => (
                <Pressable key={p.uri + i} accessibilityLabel={t('Remove photo {n}', { n: i + 1 })} onPress={() => setShots(shots.filter((_, k) => k !== i))} style={{ alignItems: 'center', gap: 2 }}>
                  <Image source={{ uri: p.uri }} style={{ width: 72, height: 96, borderRadius: 3, backgroundColor: '#000' }} contentFit="cover" />
                  <T v="small">{t('Page {n}', { n: i + 1 })} ×</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <Row>
            <Button title={t('Take photo')} disabled={shots.length >= 6 || !!step} onPress={() => addShots(true)} />
            <Button title={t('Choose photos')} disabled={shots.length >= 6 || !!step} onPress={() => addShots(false)} />
          </Row>
          {shots.length ? <Button v="primary" wide title={tp(shots.length, 'Read the list ({n} page)', 'Read the list ({n} pages)')} loading={!!step} disabled={!!step} onPress={readShots} /> : null}
        </Card>
        {err ? <Notice tone="bad" text={err} /> : null}
        <T v="small">{t('The file is deleted straight after reading. Vans aren\'t given to drivers from a file.')}</T>
      </Screen>
    );
  }

  /* ---------- checking what was read ---------- */
  const rows = read.rows;
  const plateOf = (x: FleetRow) => edits[x.i]?.plate ?? x.plate;
  const nameOf = (x: FleetRow) => edits[x.i]?.name ?? x.name ?? '';
  // A plate changed to one already in the fleet: that van gets the details instead (the server decides finally).
  const haveOf = (x: FleetRow) => (edits[x.i]?.plate == null ? !!x.have : s.vehicles.some((v) => plateKey(v.plate) === plateKey(plateOf(x))));
  const blocked = (x: FleetRow) => x.elsewhere || (!haveOf(x) && !!x.stationId && !s.runs(x.stationId));
  const on = (x: FleetRow) => !off[x.i] && !blocked(x);
  const ticked = rows.filter(on);
  const fresh = ticked.filter((x) => !haveOf(x));
  const filling = ticked.filter(haveOf);
  const typeOf = (x: FleetRow) => types[tKey(x.desc)] ?? null;
  const destOf = (x: FleetRow) => dests[sKey(x.station)] ?? null;
  // Plates in the list twice after an edit, and new vans without a type or a station.
  const counts = new Map<string, number>();
  for (const x of ticked) counts.set(plateKey(plateOf(x)), (counts.get(plateKey(plateOf(x))) || 0) + 1);
  const twice = ticked.filter((x) => (counts.get(plateKey(plateOf(x))) || 0) > 1);
  const noType = fresh.filter((x) => !typeOf(x));
  const noDest = fresh.filter((x) => !destOf(x));
  const badPlate = ticked.filter((x) => plateKey(plateOf(x)).length < 2);
  // The plan's room for new vans (firestore.rules and addVans hold the same limit).
  const max = s.org?.billing?.vans;
  const room = max == null || s.creator ? null : Math.max(0, max - (s.org?.fleetSize || 0));
  const over = room != null && fresh.length > room;
  const problem = !ticked.length ? t('Tick the vans to add first.')
    : twice.length ? t('{plate} is in the list twice.', { plate: plateOf(twice[0]) })
      : badPlate.length ? t('This number plate isn\'t right: {plate}.', { plate: plateOf(badPlate[0]) || '–' })
        : noType.length ? tp(noType.length, 'Pick the type of {n} van above.', 'Pick the type of {n} vans above.')
          : noDest.length ? tp(noDest.length, 'Pick the station of {n} van above.', 'Pick the station of {n} vans above.')
            : over ? tp(room!, 'The plan has room for {n} more van.', 'The plan has room for {n} more vans.') : null;

  const groupsBy = <K,>(list: FleetRow[], key: (x: FleetRow) => K) => {
    const m = new Map<K, FleetRow[]>();
    for (const x of list) m.set(key(x), [...(m.get(key(x)) || []), x]);
    return [...m];
  };
  // Types and stations only matter for new vans: one already in the fleet keeps its own.
  const newRows = rows.filter((x) => !haveOf(x) && !blocked(x));
  const typeGroups = groupsBy(newRows, (x) => tKey(x.desc));
  const stationGroups = groupsBy(newRows, (x) => sKey(x.station));

  const save = async () => {
    if (problem) { setErr(problem); return; }
    setErr(null); setSaving(true);
    try {
      const vans = ticked.map((x) => {
        const d = destOf(x);
        return {
          i: x.i, cls: typeOf(x), stationId: d && 'id' in d ? d.id : null, newStation: d && 'make' in d ? d.make : null,
          ...(edits[x.i]?.plate != null ? { plate: edits[x.i]!.plate } : {}), ...(edits[x.i]?.name != null ? { name: edits[x.i]!.name } : {}),
        };
      });
      const r = await sendCall<FleetAdded>('addVans', { orgId: s.org!.id, importId: read.importId, vans },
        { title: tp(ticked.length, 'Add {n} van from a file', 'Add {n} vans from a file') });
      setDone(r === QUEUED ? 'queued' : r);
    } catch (e) { setErr(failText(e, 'Adding the vans')); } finally { setSaving(false); }
  };

  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <Screen edges={[]}>
      <View style={{ gap: 4 }}>
        <T v="h1">{tp(rows.length, '{n} van in the list', '{n} vans in the list')}</T>
        <T v="hint">{file ? t('Read from {file}. Check them, then add them.', { file }) : t('Read from your photos. Check them, then add them.')}</T>
      </View>
      <Row>
        <Pill v="good" text={tp(fresh.length, '{n} new', '{n} new')} />
        {filling.length ? <Pill text={tp(filling.length, '{n} already in the fleet', '{n} already in the fleet')} /> : null}
        {rows.some((x) => x.elsewhere) ? <Pill v="muted" text={tp(rows.filter((x) => x.elsewhere).length, '{n} at another station', '{n} at another station')} /> : null}
      </Row>

      {/* What the person should know about the file. */}
      {read.more ? <Notice tone="bad" text={t('The list has more than 300 vans: only the first 300 were read. Upload it as an Excel file or CSV to read them all.')} /> : null}
      {read.noPlate ? <T v="hint">{tp(read.noPlate, '{n} line without a number plate was left out (totals, headings, a van without a plate).', '{n} lines without a number plate were left out (totals, headings, a van without a plate).')}</T> : null}
      {read.twice ? <T v="hint">{tp(read.twice, '{n} plate was in the list twice: its lines were joined.', '{n} plates were in the list twice: their lines were joined.')}</T> : null}
      {read.drivers ? <Notice text={t('The list names drivers. Vans aren\'t given to drivers from a file: give them out as usual, so each handover gets its pick-up photos.')} /> : null}
      {read.notes.map((n) => <T key={n} v="hint">{n}</T>)}
      {read.columns.length ? (
        <T v="small">{t('Read: {columns}', { columns: read.columns.filter((x) => x.key !== 'driver').map((x) => `${x.heading} → ${labelOf(x.key)}`).join(', ') })}</T>
      ) : null}
      {filling.length ? <T v="hint">{t('Vans already in the fleet keep everything they have: they only get the details they don\'t have yet.')}</T> : null}

      {/* The type of each model: it decides the driver's photo frames. */}
      {typeGroups.length ? (
        <Card>
          <T v="h2">{t('Van types')}</T>
          <T v="hint">{t('The type decides the photo frames drivers get on a walk-around.')}</T>
          {typeGroups.map(([k, list]) => {
            const cur = types[k] ?? null;
            // A type the AI gave stays one line until the person wants to change it.
            const pick = !cur || changing.includes(k);
            return (
              <View key={k || '-'} style={{ gap: 6, borderTopWidth: 1, borderColor: c.ink2, paddingTop: 8 }}>
                <T v="medium">{list[0].desc || t('No make or model in the list')} <T v="hint">{tp(list.length, '{n} van', '{n} vans')}</T></T>
                {!cur ? <T v="hint" color={c.alert}>{t('Pick the type')}</T> : null}
                {pick ? <Row gap={6}>{CLASSES.map((cl) => <Chip key={cl.id} text={t(cl.name)} on={cl.id === cur} onPress={() => setTypes((x) => ({ ...x, [k]: cl.id }))} />)}</Row>
                  : <Row gap={6}><Pill v="solid" text={t(CLS[cur].name)} /><Button v="link" small title={t('Change')} onPress={() => setChanging((x) => [...x, k])} /></Row>}
              </View>
            );
          })}
        </Card>
      ) : null}

      {/* Stations: by the name or code in the file; owners can create the ones that don't exist yet. */}
      {stationGroups.length && (stationGroups.length > 1 || mine.length > 1 || stationGroups.some(([k]) => k) || owner) ? (
        <Card>
          <T v="h2">{t('Stations')}</T>
          {stationGroups.map(([k, list]) => {
            const cur = dests[k] ?? null;
            const text = list[0].station;
            const canMake = owner && !!text && !list[0].stationId;
            return (
              <View key={k || '-'} style={{ gap: 6, borderTopWidth: 1, borderColor: c.ink2, paddingTop: 8 }}>
                <T v="medium">{text || t('No station in the list')} <T v="hint">{tp(list.length, '{n} van', '{n} vans')}</T></T>
                {!cur ? <T v="hint" color={c.alert}>{t('Pick the station')}</T> : null}
                <Row gap={6}>
                  {canMake ? <Chip text={t('New station: {name}', { name: text! })} on={!!cur && 'make' in cur} onPress={() => setDests((x) => ({ ...x, [k]: { make: text! } }))} /> : null}
                  {mine.map((st) => <Chip key={st.id} text={st.name} on={!!cur && 'id' in cur && cur.id === st.id} onPress={() => setDests((x) => ({ ...x, [k]: { id: st.id } }))} />)}
                </Row>
              </View>
            );
          })}
        </Card>
      ) : null}

      {/* The vans, each with a tick. */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <T v="h2">{t('Vans')}</T>
          <Row gap={4}>
            <Button v="link" small title={t('Tick all')} onPress={() => setOff({})} />
            <Button v="link" small title={t('Untick all')} onPress={() => setOff(Object.fromEntries(rows.map((x) => [x.i, true])))} />
          </Row>
        </View>
        {shown.map((x) => {
          const isOn = on(x);
          const ty = typeOf(x);
          const d = destOf(x);
          const details = Object.keys(x.values).length;
          const where = d && 'id' in d ? s.stationName(d.id) : d && 'make' in d ? d.make : '';
          return (
            <View key={x.i} style={{ borderTopWidth: 1, borderColor: c.ink2, paddingTop: 8, gap: 6, opacity: isOn ? 1 : 0.55 }}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isOn, disabled: blocked(x) }} accessibilityLabel={plateOf(x)} disabled={blocked(x)}
                  onPress={() => setOff((o) => ({ ...o, [x.i]: isOn }))}
                  style={{ width: 30, height: 30, borderWidth: 2, borderColor: c.ink, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: isOn ? c.ink : c.paper }}>
                  {isOn ? <T v="medium" color={c.paper} style={{ lineHeight: 20 }}>✓</T> : null}
                </Pressable>
                <Pressable style={{ flex: 1, gap: 3, minWidth: 0 }} onPress={() => setOpen(open === x.i ? null : x.i)} accessibilityRole="button" accessibilityLabel={t('Open {plate}', { plate: plateOf(x) })}>
                  <Row gap={6}>
                    <Plate text={plateOf(x)} small />
                    {nameOf(x) ? <T v="medium">{nameOf(x)}</T> : null}
                  </Row>
                  <T v="small" numberOfLines={2}>{[x.desc, haveOf(x) ? '' : ty && CLS[ty] ? t(CLS[ty].name) : '', haveOf(x) ? '' : where, details ? tp(details, '{n} detail', '{n} details') : ''].filter(Boolean).join(' · ')}</T>
                  <Row gap={6}>
                    {x.elsewhere ? <Pill v="muted" text={t('At another station')} />
                      : blocked(x) ? <Pill v="muted" text={t('Station {name} isn\'t yours', { name: x.station || '' })} />
                        : haveOf(x) ? <Pill text={x.retired ? t('Already in the fleet, retired') : t('Already in the fleet')} />
                          : null}
                  </Row>
                </Pressable>
              </View>
              {open === x.i ? (
                <View style={{ gap: 8, paddingLeft: 40 }}>
                  {!x.elsewhere ? (
                    <>
                      <Field label={t('Number plate')} value={plateOf(x)} autoCapitalize="characters" autoCorrect={false} maxLength={14}
                        onChangeText={(v) => setEdits((e) => ({ ...e, [x.i]: { ...e[x.i], plate: v.toUpperCase() } }))} />
                      <Field label={t('Own name or fleet number')} hint={t('optional')} value={nameOf(x)} maxLength={60}
                        onChangeText={(v) => setEdits((e) => ({ ...e, [x.i]: { ...e[x.i], name: v } }))} />
                    </>
                  ) : null}
                  {Object.entries(x.values).map(([k, v]) => {
                    const f = SPECS.find((y) => y.key === k);
                    return <T key={k} v="small"><T v="small" color={c.ink}>{labelOf(k)}: </T>{f ? show(f, v) : String(v)}</T>;
                  })}
                  {x.at ? <T v="small">{t('Line {row} of {table}', { row: x.at.row, table: x.at.table })}</T> : null}
                </View>
              ) : null}
            </View>
          );
        })}
        {!all && rows.length > SHOWN ? <Button title={tp(rows.length, 'Show all {n} vans', 'Show all {n} vans')} onPress={() => setAll(true)} /> : null}
      </Card>

      {room != null ? (
        <Notice tone={over ? 'bad' : 'default'} text={[tp(room, 'The plan has room for {n} more van.', 'The plan has room for {n} more vans.'),
          over ? tp(fresh.length, '{n} new van is ticked: untick some, or choose a bigger plan.', '{n} new vans are ticked: untick some, or choose a bigger plan.') : ''].filter(Boolean).join(' ')} />
      ) : null}
      {over && owner && Platform.OS === 'web' ? <Button title={t('Plan and billing')} onPress={() => router.push('/plan')} /> : null}
      {err || problem ? <T v="hint" color={c.alert}>{err || problem}</T> : null}
      {fresh.length && filling.length ? <T v="hint">{tp(filling.length, 'And {n} van already in the fleet gets the details it doesn\'t have yet.', 'And {n} vans already in the fleet get the details they don\'t have yet.')}</T> : null}
      <Button v="primary" wide loading={saving} disabled={saving || !!problem} onPress={save}
        title={fresh.length ? tp(fresh.length, 'Add {n} van', 'Add {n} vans') : tp(filling.length, 'Fill in {n} van', 'Fill in {n} vans')} />
      <Button v="link" title={t('Upload another list')} onPress={reset} />
    </Screen>
  );
}
