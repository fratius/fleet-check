import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Card, Pill, Row, T, fmtWhen, useColors } from '@/components/ui';
import { allCompanies, type CompanyRow } from '@/lib/people';
import { useSession } from '@/lib/session';
import { ROLE_NAME } from '@/lib/types';

/** The person's own companies, to switch between them. */
export function MyCompanies() {
  const s = useSession();
  const c = useColors();
  if (s.companies.length < 2 && !(s.creator && s.org && !s.companies.some((x) => x.id === s.org!.id))) return null;
  return (
    <Card>
      <T v="h3">Your companies</T>
      {s.companies.map((x, i) => (
        <Pressable key={x.id} disabled={x.id === s.org?.id} onPress={() => s.switchOrg(x.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 10 : 0 }}>
          <View style={{ flex: 1 }}><T v="medium">{x.name}</T><T v="small">{ROLE_NAME[x.role]}</T></View>
          {x.id === s.org?.id ? <Pill v="solid" text="Open" /> : <T v="h3" color={c.ink2}>›</T>}
        </Pressable>
      ))}
    </Card>
  );
}

/** For the app creator: every company in the app, with a few numbers; tap one to open it. */
export function AllCompanies() {
  const s = useSession();
  const c = useColors();
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    allCompanies().then((r) => { if (live) setRows(r); }).catch(() => { if (live) setErr('Couldn\'t load the companies. Sign out and in again so the app creator access is picked up.'); });
    return () => { live = false; };
  }, [n]);
  const num = (v: number) => (v < 0 ? '–' : String(v));
  return (
    <Card>
      <Row><T v="h3" style={{ flex: 1 }}>All companies{rows ? ` (${rows.length})` : ''}</T><Pill v="solid" text="App creator" /></Row>
      <T v="hint">Every company using the app. Open one to see it as its owner would.</T>
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
      {!rows && !err ? <ActivityIndicator color={c.ink} style={{ alignSelf: 'flex-start' }} /> : null}
      {(rows || []).map((x, i) => (
        <Pressable key={x.id} onPress={() => s.switchOrg(x.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 1 : 0, borderColor: c.rule, paddingTop: i ? 10 : 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="medium" numberOfLines={1}>{x.name}</T>
            <T v="small">{num(x.vans)} vans, {num(x.people)} people, {num(x.checks)} damage checks{x.createdAt ? `, since ${fmtWhen(x.createdAt).split(',')[0]}` : ''}</T>
          </View>
          {x.id === s.org?.id ? <Pill v="solid" text="Open" /> : <T v="h3" color={c.ink2}>›</T>}
        </Pressable>
      ))}
      <Row><Button v="link" small title="Refresh" onPress={() => { setRows(null); setN(n + 1); }} /></Row>
    </Card>
  );
}
