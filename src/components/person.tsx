import { useState } from 'react';
import { View } from 'react-native';

import { Chip, ConfirmButton, Row, T, useColors } from '@/components/ui';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n';
import { sendCall } from '@/lib/outbox';
import { failText } from '@/lib/store';
import { useWaitingFor, Waiting } from '@/components/uploads';
import { ROLE_NAME, roleOf, type Member } from '@/lib/types';
import { vanName } from '@/lib/vans';

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
  // The van this person has as this screen shows it (cause 3, the guard): the server refuses if that changed meanwhile.
  const expect = s.vehicles.find((x) => x.assignedTo?.driverId === m.uid)?.assignedTo?.assignmentId ?? null;
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = roleOf(m)!;
  const { canEdit, canRemove } = manageRights(s, m);
  const van = s.vehicles.find((v) => !v.retired && v.assignedTo?.driverId === m.uid);
  // A role, station or removal of this person waiting on this phone (or stopped): not offered again (cause 3b).
  const changing = useWaitingFor('changePerson', (d) => d.uid === m.uid);
  const removing = useWaitingFor('removePerson', (d) => d.uid === m.uid);
  const act = async (fn: () => Promise<unknown>, done = false) => {
    setErr(null); setBusy(true);
    try { await fn(); if (done) onDone?.(); } catch (e) { setErr(failText(e, 'Changing a person')); } finally { setBusy(false); }
  };
  // The person page lists it at the top (PendingChanges).
  if (changing || removing) return <Waiting j={(removing || changing)!} above />;
  return (
    <View style={{ gap: 8, paddingBottom: 4, opacity: busy ? 0.6 : 1 }}>
      {canEdit ? (
        <>
          <T v="small">{t('Role')}</T>
          <Row>{(['owner', 'manager', 'driver'] as const).map((k) => <Chip key={k} text={t(ROLE_NAME[k])} on={r === k} onPress={() => (busy || r === k ? null : act(() => sendCall('changePerson', { orgId: s.org!.id, uid: m.uid, expect, role: k }, { title: t('Make {name} {role}', { name: m.name, role: t(ROLE_NAME[k]) }), personId: m.uid })))} />)}</Row>
          {r !== 'owner' ? (
            <>
              <T v="small">{t('Station')}</T>
              <Row>{s.stations.map((st) => <Chip key={st.id} text={st.name} on={(m.stationIds || []).includes(st.id)} onPress={() => (busy || (m.stationIds || []).includes(st.id) ? null : act(() => sendCall('changePerson', { orgId: s.org!.id, uid: m.uid, expect, stationId: st.id }, { title: t('Move {name} to {station}', { name: m.name, station: st.name }), personId: m.uid })))} />)}</Row>
            </>
          ) : null}
          {van ? <T v="small">{t('{name} has {van}. Moving them to another station or making them an owner makes the van free.', { name: m.name, van: vanName(van) })}</T> : null}
        </>
      ) : null}
      {canRemove ? (
        <ConfirmButton small v="danger" title={t('Remove from {company}', { company: s.org?.name || '' })} armedTitle={t('Tap again to remove')} loading={busy}
          onConfirm={() => act(() => sendCall('removePerson', { orgId: s.org!.id, uid: m.uid, expect }, { title: t('Remove {name} from {company}', { name: m.name, company: s.org?.name || '' }), personId: m.uid }), true)} />
      ) : null}
      {canRemove ? <T v="small">{van ? t('Their van becomes free; their history, walk-arounds and checks stay.') : t('Their history, walk-arounds and checks stay.')}</T> : null}
      {err ? <T v="hint" color={c.alert}>{err}</T> : null}
    </View>
  );
}
