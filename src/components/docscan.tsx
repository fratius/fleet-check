import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { LICENCE, TRAINING, WORK, saveRecord } from '@/components/driverrec';
import { Button, F, MARKER, Row, T, cap, useColors } from '@/components/ui';
import {
  CONTRACT, COSTS, DUE, HELP, INSURANCE, MILEAGE, OTHER, SIZE, VEHICLE, fromInput, get, saveCosts, saveDetails, show, toInput,
  type FieldSpec, type Vals,
} from '@/components/vanfacts';
import { flash } from '@/lib/flash';
import { today } from '@/lib/fleet';
import { newId, prepare, upload } from '@/lib/images';
import { retrying } from '@/lib/net';
import { useSession } from '@/lib/session';
import { AiError, ai, type DocRead } from '@/lib/store';
import type { Member, Vehicle } from '@/lib/types';
import { N_, t, tp } from '@/lib/i18n';

/**
 * Filling in a van's or a driver's record from a photo of a document. The AI says what the document is and reads
 * the details the app keeps; they come back sorted into the record's sections, ticked where they're new or
 * different, with what's there now beside them. Nothing is saved until the person checks it and taps Save. The
 * photos are deleted on the server straight after reading.
 */

type To = 'facts' | 'details' | 'costs' | 'record';
interface Section { title: string; fields: FieldSpec[]; to: To }
const NAME: FieldSpec[] = [
  { key: 'plate', label: N_('Number plate'), kind: 'upper' },
  { key: 'make', label: N_('Make'), kind: 'text' },
  { key: 'model', label: N_('Model'), kind: 'text' },
];
/** What the AI says the document is (the server's list, functions/src/documents.ts), as shown. */
const DOC_NAMES: Record<string, string> = {
  'registration certificate': N_('Registration certificate'), 'registration certificate part II': N_('Registration certificate part II'),
  'lease contract': N_('Lease contract'), 'rental contract': N_('Rental contract'), 'financing contract': N_('Financing contract'),
  'purchase contract or invoice': N_('Purchase contract or invoice'), 'insurance policy or certificate': N_('Insurance policy or certificate'),
  'inspection report (HU/AU)': N_('Inspection report (HU/AU)'), 'safety check (UVV)': N_('Safety check (UVV)'),
  'service invoice or record': N_('Service invoice or record'), 'tyre invoice': N_('Tyre invoice'), 'vehicle tax notice': N_('Vehicle tax notice'),
  'fuel or charging card': N_('Fuel or charging card'), 'driving licence': N_('Driving licence'), 'employment contract': N_('Employment contract'),
  'briefing record': N_('Briefing record'), other: N_('Other document'),
};
const docName = (kind: string | null | undefined) => (kind && DOC_NAMES[kind] ? t(DOC_NAMES[kind]) : cap(kind || t('the document')));
/**
 * The sections in the order of the van's Details page; costs only for owners. Built when used (not when this file
 * loads): the record pages import this file and it imports their field lists.
 */
const vanSections = (): Section[] => [
  { title: t('Vehicle'), fields: [...NAME, ...VEHICLE], to: 'facts' },
  { title: t('Size and load'), fields: SIZE, to: 'facts' },
  { title: t('If something happens'), fields: HELP, to: 'facts' },
  { title: t('Mileage'), fields: MILEAGE, to: 'details' },
  { title: t('Contract'), fields: CONTRACT, to: 'details' },
  { title: t('Insurance'), fields: INSURANCE, to: 'details' },
  { title: t('Costs'), fields: COSTS, to: 'costs' },
  { title: t('Deadlines'), fields: DUE, to: 'details' },
  { title: t('Fuel card and notes'), fields: OTHER, to: 'details' },
];
const driverSections = (): Section[] => [
  { title: t('Driving licence'), fields: LICENCE, to: 'record' },
  { title: t('Employment'), fields: WORK, to: 'record' },
  { title: t('Briefings'), fields: TRAINING, to: 'record' },
];
const EDITABLE = new Set(['text', 'upper', 'num', 'eur', 'day', 'month', 'phone', 'long']);
const norm = (x: unknown, f?: FieldSpec) => (Array.isArray(x) ? [...x].sort() : f?.kind === 'month' && typeof x === 'string' ? x.slice(0, 7) : x ?? null);
/** The same value as saved? A month (the inspection sticker) counts by its month. */
const same = (a: unknown, b: unknown, f?: FieldSpec) => JSON.stringify(norm(a, f)) === JSON.stringify(norm(b, f));

interface Row { key: string; f: FieldSpec; section: string; to: To; value: unknown; input: unknown; now: unknown; on: boolean; confidence: number | null; evidence: string; older?: boolean }

async function pick(camera: boolean): Promise<{ uri: string; w: number; h: number }[]> {
  if (camera && Platform.OS !== 'web') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('camera');
  }
  const r = camera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: true, selectionLimit: 6, orderedSelection: true });
  if (r.canceled || !r.assets?.length) return [];
  return r.assets.map((a) => ({ uri: a.uri, w: a.width, h: a.height }));
}

export function DocScan({ target, v, m }: { target: 'van' | 'driver'; v?: Vehicle; m?: Member }) {
  const s = useSession();
  const c = useColors();
  const [pages, setPages] = useState<{ uri: string; w: number; h: number }[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<DocRead | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [check, setCheck] = useState(false);
  if (s.mode !== 'firebase') return null;
  const owner = s.role === 'owner';
  const d = v ? s.details.find((x) => x.id === v.id) : undefined;
  const cost = v ? s.costs.find((x) => x.id === v.id) : undefined;
  const rec = m ? s.records.find((x) => x.id === m.uid) : undefined;
  const sections = (target === 'van' ? vanSections() : driverSections()).filter((x) => x.to !== 'costs' || owner);
  const current = (to: To, key: string) => get((to === 'facts' ? v : to === 'details' ? d : to === 'costs' ? cost : rec) as unknown as Vals, key);

  const add = async (camera: boolean) => {
    setErr(null);
    try {
      const got = await pick(camera);
      setPages((p) => [...p, ...got].slice(0, 6));
    } catch (e) { setErr(e instanceof Error && e.message === 'camera' ? t('Allow camera access in Settings to photograph the document.') : t('Couldn\'t open the photos.')); }
  };
  const reset = () => { setPages([]); setRead(null); setRows([]); setErr(null); setCheck(false); };
  const readIt = async () => {
    setErr(null);
    try {
      setStep(t('Uploading…'));
      const id = newId();
      const paths = await Promise.all(pages.map(async (p, i) => {
        const small = await prepare(p.uri, p.w, p.h, 2400, 0.9);
        return upload(small.uri, `orgs/${s.org!.id}/docs/${s.user!.uid}/${id}-${i + 1}.jpg`);
      }));
      setStep(t('Reading the document…'));
      const r = await retrying(() => ai.readDocument({ orgId: s.org!.id, target, id: target === 'van' ? v!.id : m!.uid, paths }));
      // Each detail in its section, ticked when it's new or different from what's there now.
      const out: Row[] = [];
      for (const sec of sections) {
        for (const f of sec.fields) {
          const x = r.fields.find((y) => y.key === f.key);
          if (!x) continue;
          const now = current(sec.to, f.key);
          // An odometer reading older than the one on record (an old invoice) isn't taken by default.
          const older = f.key === 'odometerKm' && typeof now === 'number' && (x.value as number) < now;
          out.push({ key: f.key, f, section: sec.title, to: sec.to, value: x.value, input: toInput(f, x.value), now, confidence: x.confidence, evidence: x.evidence,
            older, on: !same(now, x.value, f) && (x.confidence ?? 1) >= 0.5 && !older });
        }
      }
      setRows(out);
      setRead(r);
      setCheck(false);
    } catch (e) {
      setErr(e instanceof AiError ? e.message : t('The photos didn\'t upload. Check the connection and try again.'));
    } finally { setStep(null); }
  };
  const isLicence = read?.kind === 'driving licence';
  const chosen = rows.filter((r) => r.on);
  const save = async () => {
    setErr(null);
    const patch: Record<To, Vals> = { facts: {}, details: {}, costs: {}, record: {} };
    for (const r of chosen) {
      const out = EDITABLE.has(r.f.kind) ? fromInput(r.f, r.input) : { value: r.value };
      if ('error' in out) { setErr(out.error); return; }
      patch[r.to][r.key] = out.value;
    }
    // An odometer reading without its date is from the document's day if it gave one, otherwise today.
    if ('odometerKm' in patch.details && !('odometerAt' in patch.details)) patch.details.odometerAt = today();
    setStep(t('Saving…'));
    try {
      if (v && Object.keys(patch.facts).length) await s.store!.vehicles.update(v.id, patch.facts as Partial<Vehicle>);
      if (v && Object.keys(patch.details).length) await saveDetails(s, v, d, patch.details);
      if (v && owner && Object.keys(patch.costs).length) await saveCosts(s, v, cost, patch.costs);
      if (m && Object.keys(patch.record).length) await saveRecord(s, m, rec, patch.record);
      if (m && isLicence && check) await ai.recordLicenceCheck({ orgId: s.org!.id, uid: m.uid, ok: true, note: 'Original licence seen and photographed', day: today() });
      const what = read?.title || docName(read?.kind);
      flash(target === 'van' ? `van:${v!.id}` : `person:${m!.uid}`, m && isLicence && check
        ? tp(chosen.length, 'Saved {n} detail from {what}, and the licence check. The photo wasn\'t kept.', 'Saved {n} details from {what}, and the licence check. The photo wasn\'t kept.', { what })
        : tp(chosen.length, 'Saved {n} detail from {what}. The photo wasn\'t kept.', 'Saved {n} details from {what}. The photo wasn\'t kept.', { what }));
      reset();
    } catch (e) {
      setErr(e instanceof AiError ? e.message : t('Couldn\'t save. Check the connection and try again.'));
    } finally { setStep(null); }
  };
  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const intro = target === 'van'
    ? t('Registration certificate (Fahrzeugschein), lease, rental or insurance contract, inspection report, service invoice: the AI sees what it is and fills in the right sections below. You check everything before it\'s saved.')
    : t('Driving licence (both sides), employment contract or briefing record. Licence numbers, dates of birth and addresses aren\'t read or kept. You check everything before it\'s saved.');

  if (!read) {
    return (
      <View style={{ backgroundColor: MARKER, borderRadius: 4, borderWidth: 2, borderColor: '#000', padding: 14, gap: 10 }}>
        <Text style={{ fontFamily: F.condBold, fontSize: 24, lineHeight: 27, color: '#000' }}>{t('Fill in from a document')}</Text>
        <T v="small" color="#000">{intro}</T>
        {pages.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {pages.map((p, i) => (
              <View key={p.uri + i} style={{ alignItems: 'center', gap: 2 }}>
                <Image source={{ uri: p.uri }} style={{ width: 72, height: 96, borderRadius: 3, backgroundColor: '#000' }} contentFit="cover" />
                <T v="small" color="#000">{t('Page {n}', { n: i + 1 })}</T>
              </View>
            ))}
          </ScrollView>
        ) : null}
        {step ? <Button v="primary" wide title={step} loading disabled /> : pages.length ? (
          <>
            <Button v="primary" wide title={pages.length > 1 ? tp(pages.length, 'Read the document ({n} page)', 'Read the document ({n} pages)') : t('Read the document')} onPress={readIt} />
            <Row>
              {pages.length < 6 ? <Button small title={t('Add a page')} onPress={() => add(true)} /> : null}
              <Pressable accessibilityRole="button" onPress={reset} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 6 }}>
                <Text style={{ fontFamily: F.cond, fontSize: 17, color: '#000', textDecorationLine: 'underline' }}>{t('Start over')}</Text>
              </Pressable>
            </Row>
          </>
        ) : (
          <Row>
            <Button v="primary" title={t('Take a photo')} onPress={() => add(true)} />
            <Button title={t('Choose photos')} onPress={() => add(false)} />
          </Row>
        )}
        {pages.length && !step ? <T v="small" color="#000">{t('Flat, in good light, the whole page in the picture. More pages? Add them before reading.')}</T> : null}
        {err ? <T v="small" color="#9B1C12">{err}</T> : null}
      </View>
    );
  }

  const groups = sections.map((sec) => ({ sec, rows: rows.filter((r) => r.section === sec.title) })).filter((g) => g.rows.length);
  return (
    <View style={{ backgroundColor: c.paper, borderRadius: 4, borderWidth: 2, borderColor: c.ink, overflow: 'hidden' }}>
      <View style={{ backgroundColor: MARKER, padding: 14, gap: 4, borderBottomWidth: 2, borderColor: '#000' }}>
        <T v="small" color="#000">{t('This looks like')}</T>
        <Text style={{ fontFamily: F.condBold, fontSize: 24, lineHeight: 27, color: '#000' }}>{docName(read.kind)}{read.title && read.title.toLowerCase() !== read.kind ? ` (${read.title})` : ''}</Text>
        <T v="small" color="#000">
          {!read.readable ? t('Hard to read: check every value, or take the photo again.') : rows.length
            ? tp(rows.length, 'Found {n} detail. Ticked: new or different from what\'s saved. Correct anything that\'s wrong.', 'Found {n} details. Ticked: new or different from what\'s saved. Correct anything that\'s wrong.')
            : t('Nothing on it that the record keeps.')}
        </T>
      </View>
      <View style={{ padding: 12, gap: 14 }}>
        {read.sameName === 'no' && m ? <T v="medium" color={c.alert}>{t('The name on the document doesn\'t look like {name}. Check it\'s theirs before saving.', { name: m.name })}</T> : null}
        {read.notes ? <T v="small">{read.notes}</T> : null}
        {groups.map(({ sec, rows: rs }) => (
          <View key={sec.title} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 5, alignSelf: 'stretch', backgroundColor: c.ink, borderRadius: 2 }} />
              <T v="h3">{sec.title}</T>
              {sec.to === 'costs' ? <T v="small">{t('only owners see this')}</T> : null}
            </View>
            {rs.filter((r) => !same(r.now, r.value, r.f)).map((r) => <FoundRow key={r.key} r={r} onToggle={() => setRow(r.key, { on: !r.on })} onInput={(text) => setRow(r.key, { input: text, on: true })} />)}
            {/* What the document says that's already saved, in one line. */}
            {rs.some((r) => same(r.now, r.value, r.f)) ? <T v="small">{t('Same as saved: {list}.', { list: rs.filter((r) => same(r.now, r.value, r.f)).map((r) => t(r.f.label)).join(', ') })}</T> : null}
          </View>
        ))}
        {m && isLicence ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: check }} onPress={() => setCheck(!check)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderTopWidth: 1, borderColor: c.rule, paddingTop: 10 }}>
            <Box on={check} />
            <View style={{ flex: 1 }}>
              <T v="medium">{t('I saw the original licence today')}</T>
              <T v="small">{t('Records today\'s licence check under your name. Only tick it if you held the licence itself, not a copy.')}</T>
            </View>
          </Pressable>
        ) : null}
        {err ? <T v="small" color={c.alert}>{err}</T> : null}
        <Row>
          <Button v="primary" title={step || (chosen.length ? tp(chosen.length, 'Save {n} detail', 'Save {n} details') : check ? t('Save the licence check') : t('Nothing to save'))}
            loading={!!step} disabled={!!step || (!chosen.length && !check)} onPress={save} />
          <Button small v="link" title={t('Cancel')} onPress={reset} />
        </Row>
        <T v="small">{target === 'van' ? t('The photo was read and deleted; it isn\'t kept with the van.') : t('The photo was read and deleted; it isn\'t kept with the record.')}</T>
      </View>
    </View>
  );
}

function Box({ on }: { on: boolean }) {
  const c = useColors();
  return (
    <View style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: on ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
      {on ? <Text style={{ color: c.paper, fontFamily: F.semi, fontSize: 15, lineHeight: 17 }}>✓</Text> : null}
    </View>
  );
}

/** One detail found: tick to save it, the value (typed values can be corrected), what's there now, where it came from. */
function FoundRow({ r, onToggle, onInput }: { r: Row; onToggle: () => void; onInput: (text: string) => void }) {
  const c = useColors();
  const nowText = r.now == null || r.now === '' ? '' : show(r.f, r.now);
  const unchanged = same(r.now, r.value, r.f);
  const unsure = r.confidence != null && r.confidence < 0.7;
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 }}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={t('Save {field}', { field: t(r.f.label) })} accessibilityState={{ checked: r.on }} onPress={onToggle} hitSlop={8}>
        <Box on={r.on} />
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="small">{t(r.f.label)}{r.f.unit ? ` (${r.f.unit})` : r.f.kind === 'eur' ? ' (€)' : ''}</T>
        {EDITABLE.has(r.f.kind) ? (
          <TextInput value={String(r.input ?? '')} onChangeText={onInput} autoCapitalize={r.f.kind === 'upper' ? 'characters' : 'sentences'}
            keyboardType={r.f.kind === 'num' || r.f.kind === 'eur' ? 'decimal-pad' : r.f.kind === 'phone' ? 'phone-pad' : 'default'}
            style={{ fontFamily: r.key === 'vin' ? F.cond : F.medium, fontSize: r.key === 'vin' ? 19 : 17, color: c.ink, borderBottomWidth: 1.5, borderColor: unsure ? c.amber : c.rule, paddingVertical: 4 }} />
        ) : <Text style={{ fontFamily: F.medium, fontSize: 17, color: c.ink }}>{show(r.f, r.value)}</Text>}
        <T v="small" color={unsure ? c.amber : undefined}>
          {[unchanged ? t('Same as saved') : nowText ? t('Now: {value}', { value: nowText }) : t('Not filled in yet'), r.older ? t('Older than the saved reading') : '', unsure ? t('Not sure: check it') : '',
            r.evidence ? t('On the document: "{text}"', { text: r.evidence }) : ''].filter(Boolean).join('. ')}
        </T>
      </View>
    </View>
  );
}
