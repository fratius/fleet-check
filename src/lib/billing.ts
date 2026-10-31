import { Platform } from 'react-native';

import type { Org } from './types';

/**
 * The free trial of a company and sign-up from the website. The server decides (functions/src/billing.ts); this is the
 * same rule for what the app shows. Change both.
 */
export const TRIAL_DAYS = 30;
const SIGNUP_START = Date.UTC(2026, 10, 1);
/**
 * The version of the terms (AGB) and data processing agreement (AVV) a new fleet owner accepts; null until they are
 * published on fratius.com. Set it together with TERMS_VERSION in functions/src/billing.ts.
 */
export const TERMS_VERSION: string | null = null;
export const TERMS_URL = 'https://fratius.com/agb';
export const AVV_URL = 'https://fratius.com/avv';

type BillingStatus = NonNullable<Org['billing']>['status'];
export type Standing = 'legacy' | 'demo' | 'trial' | 'trial_over' | Exclude<BillingStatus, 'trialing'>;

export function standing(o: Org | null | undefined, now = Date.now()): { standing: Standing; trialEnd: number | null } {
  if (!o) return { standing: 'legacy', trialEnd: null };
  if (o.demo) return { standing: 'demo', trialEnd: null };
  const b = o.billing;
  if (b && typeof b.status === 'string') {
    if (b.status === 'trialing') return { standing: now < (b.trialEnd || 0) ? 'trial' : 'trial_over', trialEnd: b.trialEnd || null };
    return { standing: b.status, trialEnd: b.trialEnd || null };
  }
  const created = Number(o.createdAt);
  if (!(created >= SIGNUP_START)) return { standing: 'legacy', trialEnd: null };
  const end = created + TRIAL_DAYS * 86400_000;
  return { standing: now < end ? 'trial' : 'trial_over', trialEnd: end };
}

/**
 * Came from the website's "Sign up" button (app.fratius.com/sign-in?mode=up&plan=pro): the app opens on "Create
 * account" and then on "Create a company". Kept for the browser tab, so a reload in between still knows.
 */
export interface SignupIntent { signup: boolean; plan: string | null }
function readIntent(): SignupIntent {
  const none = { signup: false, plan: null };
  if (Platform.OS !== 'web' || typeof window === 'undefined') return none;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('mode') === 'up') {
      const plan = ['basic', 'pro', 'premium'].find((p) => p === q.get('plan')) || null;
      const it = { signup: true, plan };
      try { window.sessionStorage.setItem('fc.signup', JSON.stringify(it)); } catch { /* private mode */ }
      return it;
    }
    const kept = window.sessionStorage.getItem('fc.signup');
    if (kept) return { ...none, ...(JSON.parse(kept) as Partial<SignupIntent>), signup: true };
  } catch { /* no storage */ }
  return none;
}
export const signupIntent: SignupIntent = readIntent();
export function signupDone() {
  try { if (Platform.OS === 'web') window.sessionStorage.removeItem('fc.signup'); } catch { /* no storage */ }
}
