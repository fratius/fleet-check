import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Pill, Row, Screen, Segmented, Stat, Stats, T, cap, fmtWhen, mmss, secs, usd, useColors } from '@/components/ui';
import { CLS } from '@/lib/frames';
import { useSession } from '@/lib/session';
import { TIER_NAME, aiWasRight, type Check, type Scan } from '@/lib/types';

type Tab = 'checks' | 'scans' | 'walks';

const median = (xs: number[]) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
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
  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T v="h1">Test log</T>
        <T v="hint">How fast, how much and how often the AI was right, from every run {s.mode === 'local' ? 'on this phone' : `in ${s.org?.name || 'this company'}`}.</T>
      </View>
      <Segmented<Tab> label="Show" value={tab} onChange={setTab}
        options={[['checks', `Damage checks${s.checks.length ? ` (${s.checks.length})` : ''}`], ['scans', `Type scans${s.scans.length ? ` (${s.scans.length})` : ''}`], ['walks', 'Walk-arounds']]} />
      {tab === 'checks' ? <Checks rows={s.checks} /> : tab === 'scans' ? <Scans rows={s.scans} /> : <Walks />}
    </Screen>
  );
}

function Checks({ rows }: { rows: Check[] }) {
  const c = useColors();
  if (!rows.length) return <Card dashed><T v="hint">No damage checks yet. Open a walk-around and tap Check for damage, or check photos from a vehicle page.</T></Card>;
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
        <Stat value={String(spots.length)} label={`spots in ${rows.length} check${rows.length === 1 ? '' : 's'}`} />
        <Stat value={String(judged.length)} label="checked with close-ups" />
        <Stat value={pct(fb.filter(Boolean).length, fb.length)} label={`right, of ${fb.length} decided by a manager`} />
      </Stats>
      {judged.length ? (
        <Card>
          <T v="h3">What the close-ups showed</T>
          <Row>
            <Pill v="bad" text={`${count('damage')} damage`} />
            <Pill v="good" text={`${count('dirt')} dirt`} />
            <Pill v="good" text={`${count('reflection')} reflection`} />
            <Pill v="good" text={`${count('no_damage')} no damage`} />
            <Pill v="muted" text={`${count('unclear')} unclear`} />
          </Row>
          <T v="hint">Spots the first pass marked that turned out to be dirt or reflections are the false alarms the close-ups remove.</T>
        </Card>
      ) : null}
      <T v="h2">By model</T>
      {byModel(rows).map(([model, ks]) => {
        const p1 = ks.map((k) => k.pass1).filter(Boolean) as NonNullable<Check['pass1']>[];
        const p2 = ks.map((k) => k.pass2).filter(Boolean) as NonNullable<Check['pass2']>[];
        const imgs1 = sum(p1.map((u) => u.images)), imgs2 = sum(p2.map((u) => u.images));
        const cost = sum(p1.map((u) => u.cost)) + sum(p2.map((u) => u.cost));
        const sp = ks.flatMap((k) => k.spots);
        const rated = judgedBy(ks);
        return (
          <Card key={model}>
            <Row><T v="h3" style={{ flex: 1 }}>{shortModel(model)}</T><Pill text={`${ks.length} check${ks.length === 1 ? '' : 's'}`} /></Row>
            <Table rows={[
              ['Find spots, per check', secs(median(p1.map((u) => u.ms))), 'median'],
              ['Find spots, per photo', secs(imgs1 ? sum(p1.map((u) => u.ms)) / imgs1 : null), usd(imgs1 ? sum(p1.map((u) => u.cost)) / imgs1 : null)],
              ['Close-up check, per spot', secs(median(p2.flatMap((u) => (u.calls ? [u.ms / u.calls] : [])))), usd(sum(p2.map((u) => u.calls)) ? sum(p2.map((u) => u.cost)) / sum(p2.map((u) => u.calls)) : null)],
              ['Cost per check, all in', usd(cost / ks.length), `${imgs1 + imgs2} images`],
              ['Spots per check', (sp.length / ks.length).toFixed(1), `${pct(rated.filter(Boolean).length, rated.length)} right`],
            ]} />
          </Card>
        );
      })}
      {missed.length ? (
        <Card>
          <T v="h3">Damage it missed{missedByAi ? ` (${missedByAi} added by managers)` : ''}</T>
          {missed.slice(0, 20).map((k) => (
            <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ borderTopWidth: 1, borderColor: c.rule, paddingTop: 8, gap: 2 }}>
              {k.missedNote ? <T>{k.missedNote}</T> : null}
              {(k.review?.manual || []).map((m, x) => <T key={x}>{m.panel}: {m.type}{m.note ? `, ${m.note}` : ''}</T>)}
              <T v="small">{k.vehicleName}, {fmtWhen(k.createdAt)}, {shortModel(k.model)}</T>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <T v="h2">Every check</T>
      {rows.slice(0, 50).map((k) => {
        const dmg = k.spots.filter((p) => p.verdict?.verdict === 'damage').length;
        return (
          <Pressable key={k.id} onPress={() => router.push(`/check/${k.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
            <T v="h3">{k.vehicleName}: {k.spots.length} spot{k.spots.length === 1 ? '' : 's'}, {dmg} damage</T>
            <T v="hint">{[fmtWhen(k.createdAt), `${k.photos} photos`, TIER_NAME[k.tier], k.pass1 ? secs(k.pass1.ms) : '', usd((k.pass1?.cost || 0) + (k.pass2?.cost || 0))].filter(Boolean).join(', ')}</T>
          </Pressable>
        );
      })}
    </>
  );
}

function Scans({ rows }: { rows: Scan[] }) {
  const c = useColors();
  if (!rows.length) return <Card dashed><T v="hint">No type scans yet. Add a vehicle and tap Identify the type.</T></Card>;
  const rated = rows.filter((r) => r.verdict);
  return (
    <>
      <Stats>
        <Stat value={String(rows.length)} label="scans" />
        <Stat value={pct(rated.filter((r) => r.verdict === 'correct').length, rated.length)} label={`right, of ${rated.length} rated`} />
        <Stat value={secs(median(rows.map((r) => r.ms)))} label="median time" />
      </Stats>
      <T v="h2">By model</T>
      {byModel(rows).map(([model, rs]) => {
        const rr = rs.filter((r) => r.verdict);
        const imgs = sum(rs.map((r) => r.photos));
        return (
          <Card key={model}>
            <Row><T v="h3" style={{ flex: 1 }}>{shortModel(model)}</T><Pill text={`${rs.length} scan${rs.length === 1 ? '' : 's'}`} /></Row>
            <Table rows={[
              ['Time per scan', secs(median(rs.map((r) => r.ms))), 'median'],
              ['Cost per scan', usd(sum(rs.map((r) => r.cost)) / rs.length), usd(imgs ? sum(rs.map((r) => r.cost)) / imgs : null) + ' per photo'],
              ['Type right', pct(rr.filter((r) => r.verdict === 'correct').length, rr.length), `of ${rr.length} rated`],
            ]} />
          </Card>
        );
      })}
      <T v="h2">Every scan</T>
      {rows.slice(0, 50).map((r) => (
        <View key={r.id} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 4 }}>
          <Row>
            <T v="h3" style={{ flex: 1 }}>{r.predicted && CLS[r.predicted] ? CLS[r.predicted].name : 'Not identified'}{[r.vMake, r.vModel].filter(Boolean).length ? ', ' + [r.vMake, r.vModel].filter(Boolean).join(' ') : ''}</T>
            {r.verdict ? <Pill v={r.verdict === 'correct' ? 'good' : 'bad'} text={r.verdict === 'correct' ? 'Right' : `Wrong${r.actual && CLS[r.actual] ? ', was ' + CLS[r.actual].lower : ''}`} /> : <Pill v="muted" text="Not rated" />}
          </Row>
          <T v="hint">{[fmtWhen(r.createdAt), `${r.photos} photo${r.photos === 1 ? '' : 's'}`, TIER_NAME[r.tier], secs(r.ms), usd(r.cost), r.confidence != null ? `${Math.round(r.confidence * 100)}% sure` : ''].filter(Boolean).join(', ')}</T>
        </View>
      ))}
    </>
  );
}

function Walks() {
  const s = useSession();
  const c = useColors();
  const rows = s.walks.filter((w) => w.source === 'camera');
  if (!rows.length) return <Card dashed><T v="hint">No walk-arounds yet. Open a vehicle and tap Start scanning.</T></Card>;
  const timed = rows.filter((w) => w.totalMs && w.taken);
  return (
    <>
      <Stats>
        <Stat value={String(rows.length)} label="walk-arounds" />
        <Stat value={timed.length ? mmss(median(timed.map((w) => w.totalMs!))) : '–'} label="median time" />
        <Stat value={secs(median(timed.map((w) => w.totalMs! / w.taken)))} label="per photo" />
      </Stats>
      <Card>
        <T v="h3">Photos</T>
        <Table rows={[
          ['Photos taken', String(sum(rows.map((w) => w.taken))), `of ${sum(rows.map((w) => w.frames))} frames`],
          ['Skipped', String(sum(rows.map((w) => w.skipped))), pct(sum(rows.map((w) => w.skipped)), sum(rows.map((w) => w.frames)))],
          ['Retakes', String(sum(rows.map((w) => w.retakes))), (sum(rows.map((w) => w.retakes)) / rows.length).toFixed(1) + ' per walk'],
        ]} />
      </Card>
      {rows.slice(0, 50).map((w) => (
        <Pressable key={w.id} onPress={() => router.push(`/walk/${w.id}`)} style={{ backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 4, padding: 12, gap: 2 }}>
          <T v="h3">{w.vehicleName}</T>
          <T v="hint">{[fmtWhen(w.createdAt), `${w.taken} of ${w.frames} photos`, w.totalMs ? mmss(w.totalMs) : '', `${w.retakes} retake${w.retakes === 1 ? '' : 's'}`].filter(Boolean).join(', ')}</T>
        </Pressable>
      ))}
      {s.walks.length > rows.length ? <T v="hint">{s.walks.length - rows.length} photo sets from the library aren't counted here.</T> : null}
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
