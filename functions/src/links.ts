import { randomBytes } from 'node:crypto';

import { getFirestore, type Transaction } from 'firebase-admin/firestore';

/**
 * The company's driver link (ROLES.md, "Joining"): one link for all its drivers, at orgs/{org}/links/drivers (owners and
 * managers read it), with its token in companyLinks/{token} (server only). Every company has one from the start
 * (product owner, 2026-11-26; blind test, cause 2b): made with the company (the trigger driverLinkOnNewCompany in
 * index.ts), and once for the companies made before (functions/scripts/driver-links.cjs, run by Deploy). Owners and
 * fleet managers make a new one; the old one stops at once, for every station.
 */
const db = () => getFirestore();
export const linkToken = () => randomBytes(24).toString('base64url'); // 32 characters, not guessable
export interface DriverLinkDoc { token: string; createdAt: number; createdBy: string; createdByName: string }

/** In a transaction: the company's link now. `reset`: a new one, the old one stops. `made`: a link was written. */
export async function driverLinkIn(tx: Transaction, orgId: string, by: { uid: string; name: string }, reset: boolean) {
  const cur = db().doc(`orgs/${orgId}/links/drivers`);
  const c = await tx.get(cur);
  const had = c.exists ? (c.data() as DriverLinkDoc) : null;
  if (had && !reset) return { link: had, made: false, old: null as DriverLinkDoc | null };
  const now = Date.now();
  if (had) tx.set(db().doc(`companyLinks/${had.token}`), { active: false, replacedAt: now, replacedBy: by.uid }, { merge: true });
  const token = linkToken();
  const link: DriverLinkDoc = { token, createdAt: now, createdBy: by.uid, createdByName: by.name };
  tx.create(db().doc(`companyLinks/${token}`), { orgId, active: true, ...link });
  tx.set(cur, link);
  return { link, made: true, old: had };
}

/** The company's link, made now if it has none (safe to run again). */
export function ensureDriverLink(orgId: string, by: { uid: string; name: string }) {
  return db().runTransaction((tx) => driverLinkIn(tx, orgId, by, false));
}
