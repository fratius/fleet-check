import { useEffect, useMemo, useState } from 'react';

import { t } from './i18n';
import { watchMembers } from './people';
import { useSession } from './session';
import type { Member, Vehicle } from './types';

/**
 * Drivers never see another driver's name (product owner, 2026-11-20; functions/src/names.ts). The records drivers
 * read keep only account ids where someone else did something, so every screen shows people through these:
 *
 * - useNameOf: a name by account id, for owners and managers. From the company's names (session `names`, also of
 *   people who left), the people, the history and videos they read, and older records that still carry a name.
 *   Drivers get only their own (they read nothing else).
 * - useWhoDid: the same for a line like "by …": owners and managers see the name; a driver sees "you" for their own
 *   work and nothing for anyone else's.
 * - useHolder: who has a van: the name for owners and managers, "You" or "Another driver" for drivers.
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
    if (s.staff) {
      for (const a of s.assignments) {
        m.set(a.driverId, a.driverName);
        if (a.startedBy && a.startedByName) m.set(a.startedBy, a.startedByName);
      }
      for (const k of s.checks) if (k.createdBy && k.createdByName) m.set(k.createdBy, k.createdByName);
      for (const v of s.videos) if (v.by && v.byName) m.set(v.by, v.byName);
      for (const n of s.names) if (n.name) m.set(n.id, n.name);
      for (const p of members) if (p.name) m.set(p.uid, p.name);
    }
    if (s.user && s.mode === 'firebase') m.set(s.user.uid, s.user.name);
    return (uid) => (uid ? m.get(uid) || null : null);
  }, [s.staff, s.assignments, s.checks, s.videos, s.names, members, s.user, s.mode]);
}

/**
 * The same for showing who did something: owners and managers see every name; drivers only see their own work
 * (as "you"), since they don't see other drivers' names.
 */
export function useWhoDid(): (uid: string | null | undefined, older?: string | null) => string | null {
  const s = useSession();
  const nameOf = useNameOf();
  // `older`: the name an older record still carries, for owners and managers only.
  return (uid, older) => (s.staff ? nameOf(uid) || older || null : uid && uid === s.user?.uid && s.mode === 'firebase' ? t('you') : null);
}

/** Who has a van, in words: the name for owners and managers; "You" or "Another driver" for drivers. */
export function useHolder(): (v: Pick<Vehicle, 'assignedTo'>) => string {
  const s = useSession();
  const nameOf = useNameOf();
  return (v) => {
    const a = v.assignedTo;
    if (!a) return '';
    if (a.driverId === s.user?.uid) return t('You');
    if (!s.staff) return t('Another driver');
    return nameOf(a.driverId) || a.driverName || t('A driver');
  };
}
