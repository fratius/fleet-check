import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Pill, Row, Screen, Segmented, Stat, Stats, T, cap, fmtWhen, mmss, secs, usd, useColors } from '@/components/ui';
import { CLS } from '@/lib/frames';
import { comma, t, tp } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { NOT_COMPARED } from '@/lib/compare';
import { TIER_NAME, aiWasRight, type Check, type Compare, type Scan } from '@/lib/types';

type Tab = 'checks' | 'compares' | 'scans' | 'walks';

const median = (xs: number[]) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b || 0), 0);
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '–');
const shortModel = (m: string) => cap(m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2'));

function byModel<T extends { model: string }>(rows: T[]) {
  const g = new Map<string, T[]>();
  rows.forEach((r) => g.set(r.model || 'unknown', [...(g.get(r.model || 'unknown') || []), r]));
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
}

export default function Log() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>('checks');
  // Checks a driver ran; the automatic comparison's have their own tab.
  const manual = s.checks.filter((k) => !k.auto);
  // Only for the app creator (the tab is hidden for everyone else; this covers links opened directly).
  if (!s.seesAiStats) return <Screen><T v="h1">{t('Test log')}</T><Card dashed><T v="hint">{t('Only the app creator sees the test log.')}</T></Card></Screen>;
  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">{t('Test log')}</T>
        <T v="hint">{s.mode === 'local' ? t('How fast, how much and how often the AI was right, from every run on this phone.')
          : t('How fast, how much and how often the AI was right, from every run in {company}.', { company: s.org?.name || t('this company') })}</T>
      </View>
      <Segmented<Tab> label={t('Show')} value={tab} onChange={setTab}
        options={[['checks', manual.length ? t('Damage checks ({n})', { n: manual.length }) : t('Damage checks')],
          ['compares', s.compares.length ? t('Comparisons ({n})', { n: s.compares.length }) : t('Comparisons')],
          ['scans', s.scans.length ? t('Type scans ({n})', { n: s.scans.length }) : t('Type scans')], ['walks', t('Walk-arounds')]]} />
      {tab === 'checks' ? <Checks rows={manual} /> : tab === 'compares' ? <Compares rows={s.compares} /> : tab === 'scans' ? <Scans rows={s.scans} /> : <Walks />}
    </Screen>
  );
}

function Checks({ rows }: { rows: Check[] }) {
  const s = useSession();
  const c = useColors();
  if (!rows.length) return <Card dashed><T v="hint">{t('No damage checks yet. Open a walk-around and tap Check for damage, or check photos from a vehicle page.')}</T></Card>;
  const spots = rows.flatMap((k) => k.spots);
  const judged = spots.filter((p) => p.verdict && p.verdict.verdict !== 'skipped');
  // Right or wrong, judged by the fleet manager's decision (or the older right/wrong buttons).
  const judgedBy = (ks: Check[]) => ks.flatMap((k) => k.spots.map((_, i) => aiWasRight(k, i))).filter((x): x is boolean => x !== null);
  const fb = judgedBy(rows);
  const missedByAi = rows.reduce((n, k) => n + (k.review?.manual?.length || 0), 0);
  const missed = rows.filter((k) => k.missedNote?.trim() || k.review?.manual?.length);
  const count = (v: string) => judged.filter((p) => p.verdict!.verdict === v).length;
  return (
    <>
      <Stats>
        <Stat value={String(spots.length)} label={tp(rows.length, 'spots in {n} check', 'spots in {n} checks')} />
        <Stat value={String(judged.length)} label={t('checked with close-ups')} />
        <Stat value={pct(fb.filter(Boolean).length, fb.length)} label={tp(fb.length, 'right, of {n} decided by a manager', 'right, of {n} decided by a manager')} />
      </Stats>
      {judged.length ? (
        <Card>
          <T v="h3">{t('What the close-ups showed')}</T>
          <Row>
            <Pill v="bad" text={tp(count('damage'), '{n} damage', '{n} damage')} />
            <Pill v="good" text={tp(count('dirt'), '{n} dirt', '{n} dirt')} />
            <Pill v="good" text={tp(count('reflection'), '{n} reflection', '{n} reflections')} />
            <Pill v="good" text={tp(count('no_damage'), '{n} no damage', '{n} no damage')} />
            <Pill v="muted" text={tp(count('unclear'), '{n} unclear', '{n} unclear')} />
          </Row>
          <T v="hint">{t('Spots the first pass marked that turned out to be dirt or reflections are the false alarms the close-ups remove.')}</T>
        </Card>
      ) : null}
      <T v="h2">{t('By model')}</T>
      {byModel(rows).map(([model, ks]) => {
        const p1 = ks.map((k) => k.pass1).filter(Boolean) as NonNullable<Check['pass1']>[];
        const p2 = ks.map((k) => k.pass2).filter(Boolean) as NonNullable<Check['pass2']>[];
        const imgs1 = sum(p1.map((u) => u.images)), imgs2 = sum(p2.map((u) => u.images));
        const cost = sum(p1.map((u) => u.cost)) + sum(p2.map((u) => u.cost));
        const sp = ks.flatMap((k) => k.spots);
        const rated = judgedBy(ks);
        return (
          <Card key={model}>
            <Row><T v="h3" style={{ flex: 1 }}>{shortModel(model)}</T><Pill text={tp(ks.length, '{n} check', '{n} checks')} /></Row>
            <Table rows={[
              [t('Find spots, per check'), secs(median(p1.map((u) => u.ms))), t('median')],
              [t('Find spots, per photo'), secs(imgs1 ? sum(p1.map((u) => u.ms)) / imgs1 : null), usd(imgs1 ? sum(p1.map((u) => u.cost)) / imgs1 : null)],
              [t('Close-up check, per spot'), secs(median(p2.flatMap((u) => (u.calls ? [u.ms / u.calls] : [])))), usd(sum(p2.map((u) => u.calls)) ? sum(p2.map((u) => u.cost)) / sum(p2.map((u) => u.calls)) : null)],
              [t('Cost per check, all in'), usd(cost / ks.length), tp(imgs1 + imgs2, '{n} image', '{n} images')],
              [t('Spots per check'), (sp.length / ks.length).toFixed(1), t('{pct} right', { pct: pct(rated.filter(Boolean).length, rated.length) })],
            ]} />
          </Card>
        );
      })}
      {missed.length ? (
        <Card>
          <T v="h3">{missedByAi ? tp(missedByAi, 'Damage it missed ({n} added by a manager)', 'Damage it missed ({n} added by managers)') : t('Damage it missed')}</T>
          {missed.slice(0, 20).map((k) => (
            <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 8, gap: 2 }}>
              {k.missedNote ? <T>{k.missedNote}</T> : null}
              {(k.review?.manual || []).map((m, x) => <T key={x}>{m.panel}: {t(m.type)}{m.note ? `${comma()}${m.note}` : ''}</T>)}
              <T v="small">{s.vanName(k)}, {fmtWhen(k.createdAt)}, {shortModel(k.model)}</T>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <T v="h2">{t('Every check')}</T>
      {rows.slice(0, 50).map((k) => {
        const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
        return (
          <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="h3">{tp(k.spots.length, '{van}: {n} spot, {damage} damage', '{van}: {n} spots, {damage} damage', { van: s.vanName(k), damage: dmg })}</T>
            <T v="hint">{[fmtWhen(k.createdAt), tp(k.photos, '{n} photo', '{n} photos'), t(TIER_NAME[k.tier]), k.pass1 ? secs(k.pass1.ms) : '', usd((k.pass1?.cost || 0) + (k.pass2?.cost || 0))].filter(Boolean).join(comma())}</T>
          </Pressable>
        );
      })}
    </>
  );
}

/**
 * The automatic damage comparison: how often the first look (Haiku) marks a frame, what the second look (Opus) makes
 * of it, what the fleet managers decided, and what it costs. Accuracy is the managers' decisions: spots they rejected
 * are false alarms, damage they added is what the AI missed.
 */
function Compares({ rows }: { rows: Compare[] }) {
  const s = useSession();
  const c = useColors();
  if (!rows.length) return <Card dashed><T v="hint">{t('No comparisons yet. Every walk-around taken with the camera is compared with the van\'s earlier photos.')}</T></Card>;
  const ran = rows.filter((r) => r.status === 'done');
  const frames = ran.flatMap((r) => r.frames || []);
  const compared = frames.filter((f) => !f.why);
  const marked = compared.filter((f) => f.haiku && (f.haiku.changes.length || f.haiku.unsure));
  const seconds = marked.filter((f) => f.opus);
  const verdicts = seconds.flatMap((f) => f.opus!.decisions.map((d) => d.verdict));
  const count = (v: string) => verdicts.filter((x) => x === v).length;
  const added = sum(seconds.map((f) => f.opus!.more.length));
  const checks = s.checks.filter((k) => k.auto === 'compare');
  const decided = checks.flatMap((k) => k.spots.map((_, i) => k.review?.decisions?.[String(i)]).filter((d): d is NonNullable<typeof d> => !!d));
  const approved = decided.filter((d) => d.damage).length;
  const missed = sum(checks.map((k) => k.review?.manual?.length || 0));
  const haiku = sum(rows.map((r) => r.haiku?.cost)), opus = sum(rows.map((r) => r.opus?.cost));
  const per = ran.length ? (haiku + opus) / ran.length : null;
  const gaps = new Map<string, number>();
  frames.filter((f) => f.why && f.why !== 'first').forEach((f) => gaps.set(f.why!, (gaps.get(f.why!) || 0) + 1));
  return (
    <>
      <Stats>
        <Stat value={String(ran.length)} label={tp(compared.length, 'walk-arounds, {n} photo compared', 'walk-arounds, {n} photos compared')} />
        <Stat value={pct(marked.length, compared.length)} label={tp(marked.length, 'marked by the first look ({n} photo)', 'marked by the first look ({n} photos)')} />
        <Stat value={pct(approved, decided.length)} label={tp(decided.length, 'approved, of {n} spot a manager decided', 'approved, of {n} spots a manager decided')} />
      </Stats>
      <Card>
        <T v="h3">{t('Second look')}</T>
        <Row>
          <Pill v="bad" text={tp(count('new'), '{n} new', '{n} new')} />
          <Pill v="good" text={tp(count('old'), '{n} already there', '{n} already there')} />
          <Pill v="good" text={tp(count('not_damage'), '{n} not damage', '{n} not damage')} />
          <Pill v="muted" text={tp(count('unclear'), '{n} unclear', '{n} unclear')} />
          {added ? <Pill v="amber" text={tp(added, '{n} added', '{n} added')} /> : null}
        </Row>
        <T v="hint">{t('Spots the first look marked that the second look calls already there or not damage are the false alarms it removes. Damage the managers added is what both missed.')}</T>
      </Card>
      <Card>
        <T v="h3">{t('Cost')}</T>
        <Table rows={[
          [t('First look, per walk-around'), usd(ran.length ? haiku / ran.length : null), secs(median(nums(ran.map((r) => r.haiku?.ms))))],
          [t('Second look, per photo checked'), usd(seconds.length ? opus / seconds.length : null), tp(seconds.length, '{n} photo', '{n} photos')],
          [t('All in, per walk-around'), usd(per), usd(haiku + opus)],
          [t('Per van and month'), usd(per == null ? null : per * 52), t('at 2 walk-arounds a day, 26 days')],
          [t('Damage the managers added'), String(missed), tp(checks.length, 'in {n} check', 'in {n} checks')],
        ]} />
      </Card>
      {gaps.size ? (
        <Card>
          <T v="h3">{t('Not compared')}</T>
          <Table rows={[...gaps.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => [t(NOT_COMPARED[why as keyof typeof NOT_COMPARED]), String(n), pct(n, frames.length)] as [string, string, string])} />
        </Card>
      ) : null}
      <T v="h2">{t('Every comparison')}</T>
      {rows.slice(0, 50).map((r) => {
        const sm = r.summary;
        return (
          <Pressable key={r.id} onPress={() => router.push(r.checkId ? `/check/${r.checkId}` : `/walk/${r.walkId}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <Row>
              <T v="h3" style={{ flex: 1 }}>{s.vanName(r)}</T>
              <Pill v={r.status === 'failed' ? 'bad' : sm?.found ? 'bad' : sm?.unsure ? 'amber' : 'muted'} text={r.status === 'done' ? (sm?.found || sm?.unsure ? tp((sm?.found || 0) + (sm?.unsure || 0), '{n} spot', '{n} spots') : t('No new damage'))
                : r.status === 'first' ? t('First walk-around') : r.status === 'limit' ? t('Trial limit') : r.status === 'running' ? t('Running') : t('Failed')} />
            </Row>
            <T v="hint">{[fmtWhen(r.walkAt), sm ? tp(sm.compared, '{n} photo compared', '{n} photos compared') : '', r.serverMs ? secs(r.serverMs) : '', r.cost != null ? usd(r.cost) : '', r.error || ''].filter(Boolean).join(comma())}</T>
          </Pressable>
        );
      })}
    </>
  );
}

function Scans({ rows }: { rows: Scan[] }) {
  const c = useColors();
  if (!rows.length) return <Card dashed><T v="hint">{t('No type scans yet. Add a vehicle and tap Identify the type.')}</T></Card>;
  const rated = rows.filter((r) => r.verdict);
  return (
    <>
      <Stats>
        <Stat value={String(rows.length)} label={t('scans')} />
        <Stat value={pct(rated.filter((r) => r.verdict === 'correct').length, rated.length)} label={tp(rated.length, 'right, of {n} rated', 'right, of {n} rated')} />
        <Stat value={secs(median(nums(rows.map((r) => r.ms))))} label={t('median time')} />
      </Stats>
      <T v="h2">{t('By model')}</T>
      {byModel(rows).map(([model, rs]) => {
        const rr = rs.filter((r) => r.verdict);
        const imgs = sum(rs.map((r) => r.photos));
        return (
          <Card key={model}>
            <Row><T v="h3" style={{ flex: 1 }}>{shortModel(model)}</T><Pill text={tp(rs.length, '{n} scan', '{n} scans')} /></Row>
            <Table rows={[
              [t('Time per scan'), secs(median(nums(rs.map((r) => r.ms)))), t('median')],
              [t('Cost per scan'), usd(sum(rs.map((r) => r.cost)) / rs.length), t('{cost} per photo', { cost: usd(imgs ? sum(rs.map((r) => r.cost)) / imgs : null) })],
              [t('Type right'), pct(rr.filter((r) => r.verdict === 'correct').length, rr.length), tp(rr.length, 'of {n} rated', 'of {n} rated')],
            ]} />
          </Card>
        );
      })}
      <T v="h2">{t('Every scan')}</T>
      {rows.slice(0, 50).map((r) => (
        <View key={r.id} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 4 }}>
          <Row>
            <T v="h3" style={{ flex: 1 }}>{r.predicted && CLS[r.predicted] ? t(CLS[r.predicted].name) : t('Not identified')}{[r.vMake, r.vModel].filter(Boolean).length ? comma() + [r.vMake, r.vModel].filter(Boolean).join(' ') : ''}</T>
            {r.verdict ? <Pill v={r.verdict === 'correct' ? 'good' : 'bad'} text={r.verdict === 'correct' ? t('Correct') : r.actual && CLS[r.actual] ? t('Wrong, was {type}', { type: t(CLS[r.actual].lower) }) : t('Wrong')} /> : <Pill v="muted" text={t('Not rated')} />}
          </Row>
          <T v="hint">{[fmtWhen(r.createdAt), tp(r.photos, '{n} photo', '{n} photos'), t(TIER_NAME[r.tier]), secs(r.ms), usd(r.cost), r.confidence != null ? t('{pct}% sure', { pct: Math.round(r.confidence * 100) }) : ''].filter(Boolean).join(comma())}</T>
        </View>
      ))}
    </>
  );
}

function Walks() {
  const s = useSession();
  const c = useColors();
  const rows = s.walks.filter((w) => w.source === 'camera');
  if (!rows.length) return <Card dashed><T v="hint">{t('No walk-arounds yet. Open a vehicle and tap Start scanning.')}</T></Card>;
  const timed = rows.filter((w) => w.totalMs && w.taken);
  return (
    <>
      <Stats>
        <Stat value={String(rows.length)} label={t('walk-arounds')} />
        <Stat value={timed.length ? mmss(median(timed.map((w) => w.totalMs!))) : '–'} label={t('median time')} />
        <Stat value={secs(median(timed.map((w) => w.totalMs! / w.taken)))} label={t('per photo')} />
      </Stats>
      <Card>
        <T v="h3">{t('Photos')}</T>
        <Table rows={[
          [t('Photos taken'), String(sum(rows.map((w) => w.taken))), tp(sum(rows.map((w) => w.frames)), 'of {n} frame', 'of {n} frames')],
          [t('Skipped'), String(sum(rows.map((w) => w.skipped))), pct(sum(rows.map((w) => w.skipped)), sum(rows.map((w) => w.frames)))],
          [t('Retakes'), String(sum(rows.map((w) => w.retakes))), t('{n} per walk-around', { n: (sum(rows.map((w) => w.retakes)) / rows.length).toFixed(1) })],
        ]} />
      </Card>
      {rows.slice(0, 50).map((w) => (
        <Pressable key={w.id} onPress={() => router.push(`/walk/${w.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
          <T v="h3">{s.vanName(w)}</T>
          <T v="hint">{[fmtWhen(w.createdAt), tp(w.frames, '{taken} of {n} photo', '{taken} of {n} photos', { taken: w.taken }), w.totalMs ? mmss(w.totalMs) : '', tp(w.retakes, '{n} retake', '{n} retakes')].filter(Boolean).join(comma())}</T>
        </Pressable>
      ))}
      {s.walks.length > rows.length ? <T v="hint">{tp(s.walks.length - rows.length, '{n} photo set from the library isn\'t counted here.', '{n} photo sets from the library aren\'t counted here.')}</T> : null}
    </>
  );
}

function Table({ rows }: { rows: [string, string, string][] }) {
  const c = useColors();
  return (
    <View>
      {rows.map(([a, b, d], i) => (
        <View key={a} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: c.rule, alignItems: 'baseline' }}>
          <T style={{ flex: 1.4 }}>{a}</T>
          <T v="h3" style={{ flex: 0.8, textAlign: 'right' }}>{b}</T>
          <T v="small" style={{ flex: 0.9, textAlign: 'right' }}>{d}</T>
        </View>
      ))}
    </View>
  );
}
