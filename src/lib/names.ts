import { useEffect, useMemo, useState } from 'react';

import { t } from './i18n';
import { watchMembers } from './people';
import { useSession } from './session';
import type { Member } from './types';

/**
 * Who someone is, by account id: for records that only keep the id (like walk-arounds). Names come from what
 * the server wrote (van history, damage checks, videos) and, for owners and managers, the company's people.
 */
export function useNameOf(): (uid: string | null | undefined) => string | null {
  const s = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const orgId = s.org?.id;
  useEffect(() => {
    if (s.mode !== 'firebase' || !s.staff || !orgId) return;
    return watchMembers(orgId, setMembers, () => {});
  }, [s.mode, s.staff, orgId]);
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const a of s.assignments) {
      m.set(a.driverId, a.driverName);
      if (a.startedBy && a.startedByName) m.set(a.startedBy, a.startedByName);
    }
    for (const k of s.checks) if (k.createdBy && k.createdByName) m.set(k.createdBy, k.createdByName);
    for (const v of s.videos) if (v.by && v.byName) m.set(v.by, v.byName);
    for (const p of members) if (p.name) m.set(p.uid, p.name);
    if (s.user && s.mode === 'firebase') m.set(s.user.uid, s.user.name);
    return (uid) => (uid ? m.get(uid) || null : null);
  }, [s.assignments, s.checks, s.videos, members, s.user, s.mode]);
}

/**
 * The same for showing who did something: owners and managers see every name; drivers only see their own work
 * (as "you"), since they don't see who else had a van.
 */
export function useWhoDid(): (uid: string | null | undefined) => string | null {
  const s = useSession();
  const nameOf = useNameOf();
  return (uid) => (s.staff ? nameOf(uid) : uid && uid === s.user?.uid && s.mode === 'firebase' ? t('you') : null);
}
