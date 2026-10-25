import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { dur } from '@/components/history';
import { Button, F, MARKER, Pill, Row, T, ZoomPhoto, cap, fmtWhen, useColors } from '@/components/ui';
import { cropRegion, likelySame, whoHadIt, type Damage } from '@/lib/damage';
import { loc, t, tp } from '@/lib/i18n';
import { photoUrl } from '@/lib/images';
import { addDamageNote, watchVanRecords } from '@/lib/people';
import { useSession } from '@/lib/session';
import type { Assignment, Check, DamageNote, Photo, Walkaround } from '@/lib/types';
import type { Pos } from '@/lib/van3d';

/** A part of a photo (fractions x, y, w, h), with the damage box drawn on it. */
function Crop({ photo, region, box, width }: { photo: Photo; region: [number, number, number, number]; box: [number, number, number, number] | null; width: number }) {
  const [url, setUrl] = useState<string | null>(photo.uri || null);
  useEffect(() => { let live = true; photoUrl(photo).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [photo]);
  const h = Math.round((width * 3) / 4);
  const [x, y, w, hh] = region;
  const iw = width / w, ih = h / hh;
  return (
    <View style={{ width, height: h, overflow: 'hidden', borderRadius: 3, backgroundColor: '#16181C' }}>
      {url ? (
        // The whole photo, scaled so the crop fills the box. The sizing is on a plain view: expo-image on the web
        // keeps the photo's own proportions when it is given a size directly.
        <View style={{ position: 'absolute', left: -x * iw, top: -y * ih, width: iw, height: ih }}>
          <Image source={{ uri: url }} contentFit="fill" style={{ width: '100%', height: '100%' }} />
        </View>
      ) : null}
      {box ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: (box[0] - x) * iw - 4, top: (box[1] - y) * ih - 4, width: (box[2] - box[0]) * iw + 8, height: (box[3] - box[1]) * ih + 8,
          borderWidth: 2, borderColor: MARKER, borderRadius: 3 }} />
      ) : null}
    </View>
  );
}

/** Before and after: the same part of the van in the walk-around before, and where the damage was found. */
export function Proof({ d, width }: { d: Damage; width: number }) {
  const c = useColors();
  const pw = Math.floor((width - 8) / 2);
  const ratio = (p: Photo | null) => (p && p.w && p.h ? [p.w, p.h] : [3, 4]);
  const region = (p: Photo | null): [number, number, number, number] => {
    if (!d.box || !p) return [0, 0, 1, 1];
    const [W, H] = ratio(p);
    return cropRegion(d.box, W, H);
  };
  const label = (text: string, when: number | null) => <T v="small" numberOfLines={1}>{when ? t('{label}, {when}', { label: text, when: fmtWhen(when) }) : text}</T>;
  const cell = (p: Photo | null, ref: string | null, before: boolean, when: number | null, caption: string) => (
    <View style={{ width: pw, gap: 3 }}>
      {label(before ? t('Before') : t('After'), when)}
      {ref ? <ZoomPhoto src={ref} caption={caption} style={{ width: pw, height: Math.round((pw * 3) / 4) }} />
        : p && d.box ? <ZoomPhoto src={p} caption={caption} thumb={<Crop photo={p} region={region(p)} box={d.box} width={pw} />} />
          : p ? <ZoomPhoto src={p} caption={caption} style={{ width: pw, height: Math.round((pw * 3) / 4) }} />
          : <View style={{ width: pw, height: Math.round((pw * 3) / 4), borderRadius: 3, borderWidth: 1.5, borderColor: c.rule, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: 6 }}>
            <T v="small" style={{ textAlign: 'center' }}>{before ? t('No earlier photos of this van') : t('No photo')}</T>
          </View>}
    </View>
  );
  return (
    <Row gap={8} style={{ flexWrap: 'nowrap' }}>
      {cell(d.beforePhoto, null, true, d.beforeWalk?.createdAt ?? null, t('Before: {panel}, {when}', { panel: d.panel, when: fmtWhen(d.beforeWalk?.createdAt) }))}
      {cell(d.afterPhoto, d.refPath, false, d.foundAt, t('Found: {panel}, {when}', { panel: d.panel, when: fmtWhen(d.foundAt) }))}
    </Row>
  );
}

/** The damage type in words (a type from the fixed list is translated), with its size. */
const title = (d: Damage) => (d.sizeCm ? t('{type}, about {cm} cm', { type: cap(t(d.type)), cm: d.sizeCm }) : cap(t(d.type)));
export const whenText = (d: Damage) => d.from != null
  ? t('Between {from} and {to}', { from: fmtWhen(d.from), to: fmtWhen(d.to) })
  : t('Before {when}. There are no earlier photos of this van.', { when: fmtWhen(d.to) });

/** Who had the van then, as staff see it (everyone) or as a driver sees it (only themselves). */
function useWho(d: Damage, history: Assignment[] | null, vehicleId: string) {
  const s = useSession();
  if (!history) return null;
  const { during, atFound } = whoHadIt(d, history, vehicleId);
  const me = s.user?.uid;
  if (!s.staff) {
    const mine = during.filter((a) => a.driverId === me);
    return mine.length ? { line: t('You had the van in that time.'), people: mine } : null;
  }
  const names = [...new Set(during.map((a) => a.driverName))];
  if (d.from == null) return { line: atFound ? t('{name} had the van when it was found.', { name: atFound.driverName }) : t('No earlier photos, so it can\'t be narrowed down.'), people: atFound ? [atFound] : [] };
  if (!names.length) return { line: t('Nobody had the van in that time.'), people: [] };
  return { line: names.length === 1 ? t('{name} had the van.', { name: names[0] }) : tp(names.length, '{n} driver had the van: {names}.', '{n} drivers had the van: {names}.', { names: names.join(', ') }), people: during };
}

/** The bubble on the 3D van: what, when, who, before and after, and the latest comment. */
export function DamageBubble({ d, history, notes, vehicleId, onClose, onMore }: {
  d: Damage; history: Assignment[] | null; notes: DamageNote[]; vehicleId: string; onClose: () => void; onMore: () => void;
}) {
  const c = useColors();
  const s = useSession();
  const who = useWho(d, history, vehicleId);
  const mine = notes.filter((n) => n.damageKey === d.key);
  const last = mine[mine.length - 1];
  const [w, setW] = useState(0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 6, padding: 10, gap: 6,
      shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ minWidth: 26, height: 26, borderRadius: 13, backgroundColor: c.alert, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: F.cond, fontSize: 15, color: '#fff' }}>{d.no}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="h3" numberOfLines={1}>{title(d)}</T>
          <T v="small" numberOfLines={1}>{cap(d.panel)}</T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} hitSlop={10} onPress={onClose}><T v="h3" color={c.ink2}>×</T></Pressable>
      </View>
      <T v="small">{whenText(d)}</T>
      {who ? <T v="small" color={c.ink}>{who.line}</T> : null}
      {w ? <Proof d={d} width={w - 24} /> : null}
      {s.staff && last ? <T v="small" numberOfLines={2}>{last.byName}: {last.text}{mine.length > 1 ? ` ${tp(mine.length - 1, '(+{n} more)', '(+{n} more)')}` : ''}</T> : null}
      <Button small v="link" title={t('All details')} onPress={onMore} style={{ alignSelf: 'flex-start', paddingHorizontal: 0, minHeight: 30 }} />
    </View>
  );
}

/** Every damage on the van, newest first, with everything known about it. */
export function DamageList({ damages, history, notes, vehicleId, stationId, selected, onShow, onLayoutItem }: {
  damages: Damage[]; history: Assignment[] | null; notes: DamageNote[]; vehicleId: string; stationId: string | null;
  selected: string | null; onShow: (key: string) => void; onLayoutItem: (key: string, y: number) => void;
}) {
  if (!damages.length) return <T v="hint">{t('No damage on record. Damage goes on the record when a fleet manager approves it in a check.')}</T>;
  return (
    <View style={{ gap: 10 }}>
      {damages.map((d) => (
        <View key={d.key} onLayout={(e) => onLayoutItem(d.key, e.nativeEvent.layout.y)}>
          <DamageCard d={d} history={history} notes={notes.filter((n) => n.damageKey === d.key)} vehicleId={vehicleId} stationId={stationId}
            on={selected === d.key} onShow={() => onShow(d.key)} />
        </View>
      ))}
    </View>
  );
}

function DamageCard({ d, history, notes, vehicleId, stationId, on, onShow }: {
  d: Damage; history: Assignment[] | null; notes: DamageNote[]; vehicleId: string; stationId: string | null; on: boolean; onShow: () => void;
}) {
  const c = useColors();
  const s = useSession();
  const who = useWho(d, history, vehicleId);
  const [w, setW] = useState(0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: on ? c.alert : c.ink, borderRadius: 4, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ minWidth: 30, height: 30, borderRadius: 15, backgroundColor: c.alert, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: F.cond, fontSize: 17, color: '#fff' }}>{d.no}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <T v="h3">{title(d)}</T>
          <T v="medium">{cap(d.panel)}</T>
          <Row gap={6}>
            {d.severity ? <Pill v={d.severity === 'cosmetic' ? 'muted' : 'amber'} text={d.severity === 'cosmetic' ? t('Cosmetic') : d.severity === 'repair' ? t('Needs repair') : cap(d.severity)} /> : null}
            {d.later.length ? <Pill v="default" text={tp(d.later.length, 'Seen again in {n} later check', 'Seen again in {n} later checks')} /> : null}
            {d.manual ? <Pill v="muted" text={t('Added by the manager')} /> : null}
          </Row>
        </View>
      </View>

      <Section label={t('When it happened')}>
        <T>{whenText(d)}</T>
        {d.from != null ? <T v="small">{t('That\'s a window of {time}: the last photos without it to the photos it was found in.', { time: dur(d.to - d.from) })}</T> : null}
      </Section>

      {who ? (
        <Section label={s.staff ? t('Who had the van') : t('You')}>
          <T>{who.line}</T>
          {s.staff ? who.people.map((a) => (
            <Pressable key={a.id} onPress={() => router.push(`/person/${a.driverId}`)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <T v="small" style={{ flex: 1 }}>{a.startedBy === a.driverId
                ? t('{name}: {from} to {to}, picked up themselves', { name: a.driverName, from: fmtWhen(a.start), to: a.end ? fmtWhen(a.end) : t('now') })
                : t('{name}: {from} to {to}, given by {by}', { name: a.driverName, from: fmtWhen(a.start), to: a.end ? fmtWhen(a.end) : t('now'), by: a.startedByName })}</T>
              <T v="h3" color={c.ink2}>›</T>
            </Pressable>
          )) : null}
          {s.staff ? <T v="small">{t('That\'s who had the van, not proof of who caused it. Compare the photos.')}</T> : null}
        </Section>
      ) : null}

      <Section label={t('Proof')}>
        {w ? <Proof d={d} width={w - 28} /> : null}
        {d.markPath || d.closeups.length ? (
          <Row gap={8}>
            {(d.markPath ? [d.markPath] : d.closeups.slice(0, 1)).concat(d.closeups.slice(1, 3)).map((p, i) => (
              <ZoomPhoto key={p + i} src={p} caption={t('Close-up {no}: {panel}', { no: i + 1, panel: d.panel })} style={{ width: 84, height: 112 }} />
            ))}
          </Row>
        ) : null}
        <T v="small">{t('Tap a photo to see it whole.')}</T>
      </Section>

      <Section label={t('Found and approved')}>
        <T v="small">{d.foundBy ? t('Found {when} in a check by {name}.', { when: fmtWhen(d.foundAt), name: d.foundBy }) : t('Found {when}.', { when: fmtWhen(d.foundAt) })}{' '}
          {d.approvedAt ? t('Approved by {name}, {when}.', { name: d.approvedBy || t('the fleet manager'), when: fmtWhen(d.approvedAt) }) : t('Approved by {name}.', { name: d.approvedBy || t('the fleet manager') })}</T>
        {d.note ? <T v="small">{t('Manager\'s note: {note}', { note: d.note })}</T> : null}
        {d.aiReason ? <T v="small">{t('AI: {reason}', { reason: d.aiReason })}</T> : null}
        {d.pos.approx ? <T v="small">{t('The dot is placed from the panel name, so its spot on the van is rough.')}</T> : null}
        {d.later.length ? <T v="small">{t('Seen again: {dates}.', { dates: d.later.map((x) => fmtWhen(x.check.createdAt)).join(', ') })}</T> : null}
      </Section>

      {s.staff ? <Notes d={d} notes={notes} vehicleId={vehicleId} stationId={stationId} /> : null}

      <Row>
        <Button small title={t('Show on the van')} onPress={onShow} />
        <Button small v="link" title={t('Open the check')} onPress={() => router.push(`/check/${d.first.check.id}`)} />
      </Row>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ gap: 4, borderTopWidth: 1, borderColor: c.rule, paddingTop: 8 }}><T v="small" color={c.ink2}>{label.toLocaleUpperCase(loc())}</T>{children}</View>;
}

/** Comments by owners and managers. They stay: nobody edits or deletes them. */
function Notes({ d, notes, vehicleId, stationId }: { d: Damage; notes: DamageNote[]; vehicleId: string; stationId: string | null }) {
  const s = useSession();
  const c = useColors();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canWrite = s.mode === 'firebase' && s.runs(stationId);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      await addDamageNote(s.org!.id, { vehicleId, stationId, damageKey: d.key, text, by: s.user!.uid, byName: s.user!.name });
      setText('');
    } catch { setErr(t('Couldn\'t save the comment. Check the connection.')); } finally { setBusy(false); }
  };
  return (
    <Section label={notes.length ? t('Comments ({n})', { n: notes.length }) : t('Comments')}>
      {notes.map((n) => (
        <View key={n.id} style={{ gap: 1 }}>
          <T v="small" color={c.ink2}>{n.byName}, {fmtWhen(n.createdAt)}</T>
          <T selectable>{n.text}</T>
        </View>
      ))}
      {!notes.length ? <T v="small">{t('No comments yet. For example: what the driver said, the repair or the insurance claim.')}</T> : null}
      {canWrite ? (
        <View style={{ gap: 6 }}>
          <InputBox value={text} onChange={setText} />
          <Row>
            <Button small v="primary" title={t('Add comment')} loading={busy} disabled={!text.trim()} onPress={add} />
            <T v="small">{t('Comments can\'t be edited or deleted.')}</T>
          </Row>
        </View>
      ) : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </Section>
  );
}

function InputBox({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const c = useColors();
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={t('Add a comment')} placeholderTextColor={c.ink2} multiline maxLength={1000}
      style={{ minHeight: 64, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 10, color: c.ink, fontFamily: F.body, fontSize: 16, backgroundColor: c.page, textAlignVertical: 'top' }} />
  );
}

/**
 * A van's walk-arounds and checks: all of them (up to 300 each) from Firestore, or the ones the app already has
 * while those load, in test mode, or if the query fails.
 */
export function useVanRecords(vehicleId: string | undefined) {
  const s = useSession();
  const [recs, setRecs] = useState<{ walks: Walkaround[] | null; checks: Check[] | null }>({ walks: null, checks: null });
  const [error, setError] = useState<string | null>(null);
  const orgId = s.org?.id;
  const scope = s.role === 'owner' ? '*' : s.myStations.map((st) => st.id).join(',');
  useEffect(() => {
    if (s.mode !== 'firebase' || !orgId || !vehicleId) return;
    setRecs({ walks: null, checks: null }); setError(null);
    return watchVanRecords(orgId, vehicleId, scope === '*' ? null : scope ? scope.split(',') : [], setRecs,
      () => setError(t('Couldn\'t load all of this van\'s records, so only the latest are shown.')));
  }, [orgId, vehicleId, scope, s.mode]);
  const walks = recs.walks ?? s.walks.filter((w) => w.vehicleId === vehicleId);
  const checks = recs.checks ?? s.checks.filter((k) => k.vehicleId === vehicleId);
  return { walks, checks, error };
}

/**
 * In a review: is this damage new, or one already on the van's record? Suggests the nearest damage on the same
 * side; the manager can switch.
 */
export function KnownChooser({ pos, value, damages, excludeCheck, onPick }: {
  pos: Pos; value: string | null | undefined; damages: Damage[]; excludeCheck: string; onPick?: (key: string | null) => void;
}) {
  const c = useColors();
  const near = likelySame(pos, damages, excludeCheck).slice(0, 3);
  const cur = value ? damages.find((d) => d.key === value || d.later.some((x) => x.key === value)) : null;
  const options = cur && !near.includes(cur) ? [cur, ...near] : near;
  const label = (d: Damage) => `#${d.no} ${t(d.type)}, ${d.panel}`;
  return (
    <View style={{ gap: 6, backgroundColor: c.page, borderRadius: 4, padding: 8 }}>
      <T v="small" color={c.ink}>{cur ? t('Already on the van: {damage}, found {when}. It stays one damage, seen again.', { damage: label(cur), when: fmtWhen(cur.foundAt) })
        : t('New damage: it goes on the van\'s record with this check as the first sighting.')}</T>
      {onPick && options.length ? (
        <Row gap={6}>
          <Pressable onPress={() => onPick(null)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: !cur ? c.ink : c.rule, borderRadius: 4, backgroundColor: !cur ? c.paper : 'transparent' }}>
            <T v="small" color={c.ink}>{t('New damage')}</T>
          </Pressable>
          {options.map((d) => (
            <Pressable key={d.key} onPress={() => onPick(d.key)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: cur === d ? c.ink : c.rule, borderRadius: 4, backgroundColor: cur === d ? c.paper : 'transparent' }}>
              <T v="small" color={c.ink}>{t('Same as {damage}', { damage: label(d) })}</T>
            </Pressable>
          ))}
        </Row>
      ) : null}
    </View>
  );
}
