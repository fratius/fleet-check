import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, Row, T, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n';
import { sendCall } from '@/lib/outbox';
import { AiError } from '@/lib/store';
import { ROLE_NAME, roleOf, type Member } from '@/lib/types';

/** Owners change anyone's role and station but their own; managers remove drivers of their station. */
export function manageRights(s: ReturnType<typeof useSession>, m: Member) {
  const r = roleOf(m);
  const me = m.uid === s.user?.uid;
  const owner = s.role === 'owner';
  return {
    canEdit: owner && !me,
    canRemove: !me && (owner || (r === 'driver' && (m.stationIds || []).some((id) => s.runs(id)))),
  };
}

/**
 * Role, station and removal, all done on the server: a person who changes station or leaves also leaves their
 * van, which becomes free. Their history stays.
 */
export function ManagePerson({ m, onDone }: { m: Member; onDone?: () => void }) {
  const s = useSession();
  const c = useColors();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = roleOf(m)!;
  const { canEdit, canRemove } = manageRights(s, m);
  const van = s.vehicles.find((v) => !v.retired && v.assignedTo?.driverId === m.uid);
  const act = async (fn: () => Promise<unknown>, done = false) => {
    setErr(null); setBusy(true);
    try { await fn(); if (done) onDone?.(); } catch (e) { setErr(e instanceof AiError ? e.message : t('Couldn\'t save that change.')); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8, paddingBottom: 4, opacity: busy ? 0.6 : 1 }}>
      {canEdit ? (
        <>
          <T v="small">{t('Role')}</T>
          <Row>{(['owner', 'manager', 'driver'] as const).map((k) => <Chip key={k} text={t(ROLE_NAME[k])} on={r === k} onPress={() => (busy || r === k ? null : act(() => sendCall('changePerson', { orgId: s.org!.id, uid: m.uid, role: k }, { title: t('Make {name} {role}', { name: m.name, role: t(ROLE_NAME[k]) }), personId: m.uid })))} />)}</Row>
          {r !== 'owner' ? (
            <>
              <T v="small">{t('Station')}</T>
              <Row>{s.stations.map((st) => <Chip key={st.id} text={st.name} on={(m.stationIds || []).includes(st.id)} onPress={() => (busy || (m.stationIds || []).includes(st.id) ? null : act(() => sendCall('changePerson', { orgId: s.org!.id, uid: m.uid, stationId: st.id }, { title: t('Move {name} to {station}', { name: m.name, station: st.name }), personId: m.uid })))} />)}</Row>
            </>
          ) : null}
          {van ? <T v="small">{t('{name} has {van}. Moving them to another station or making them an owner makes the van free.', { name: m.name, van: van.name })}</T> : null}
        </>
      ) : null}
      {canRemove ? (
        <Button small v="danger" title={armed ? t('Tap again to remove') : t('Remove from {company}', { company: s.org?.name || '' })} loading={busy} onPress={() => {
          if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
          setArmed(false);
          act(() => sendCall('removePerson', { orgId: s.org!.id, uid: m.uid }, { title: t('Remove {name} from {company}', { name: m.name, company: s.org?.name || '' }), personId: m.uid }), true);
        }} />
      ) : null}
      {canRemove ? <T v="small">{van ? t('Their van becomes free; their history, walk-arounds and checks stay.') : t('Their history, walk-arounds and checks stay.')}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}
