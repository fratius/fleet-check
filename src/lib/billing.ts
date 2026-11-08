import { Platform } from 'react-native';

import { fb } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
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
export const TERMS_VERSION: string | null = '2026-11-08';
export const TERMS_URL = 'https://fratius.com/agb';
export const AVV_URL = 'https://fratius.com/avv';

type BillingStatus = NonNullable<Org['billing']>['status'];
export type Standing = 'legacy' | 'demo' | 'trial' | 'trial_over' | Exclude<BillingStatus, 'trialing'>;

export function standing(o: Org | null | undefined, now = Date.now()): { standing: Standing; trialEnd: number | null } {
  if (!o) return { standing: 'legacy', trialEnd: null };
  if (o.demo) return { standing: 'demo', trialEnd: null };
  const b = o.billing;
  if (b && typeof b.status === 'string') {
    // With a card on file Stripe charges it when the trial ends; until its webhook says so, it's still the trial.
    if (b.status === 'trialing') return { standing: now < (b.trialEnd || 0) || (b.via === 'stripe' && b.card) ? 'trial' : 'trial_over', trialEnd: b.trialEnd || null };
    return { standing: b.status, trialEnd: b.trialEnd || null };
  }
  const created = Number(o.createdAt);
  if (!(created >= SIGNUP_START)) return { standing: 'legacy', trialEnd: null };
  const end = created + TRIAL_DAYS * 86400_000;
  return { standing: now < end ? 'trial' : 'trial_over', trialEnd: end };
}

/* ---------- Plans and payment (the server: functions/src/billing.ts and payments.ts; change both) ---------- */

export const PLAN_IDS = ['basic', 'pro', 'premium'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type Interval = 'month' | 'year';
export const PLAN_NAME: Record<PlanId, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };
/** Plans go by vans only; drivers and stations are unlimited. null: unlimited. */
export const PLAN_VANS: Record<PlanId, number | null> = { basic: 50, pro: 150, premium: null };
export const ADDON_VANS = 15;
/** Net prices in euro cents (VAT on top); a year is 12 months. The launch offer takes 30 % off the first year's plan. */
export const PRICE_CENTS: Record<PlanId | 'addon', Record<Interval, number>> = {
  basic: { month: 4000, year: 48000 }, pro: { month: 9000, year: 108000 }, premium: { month: 20000, year: 240000 }, addon: { month: 1000, year: 12000 },
};
export const YEARLY_LAUNCH_OFF = 30;
export function allowedVans(plan: string | null | undefined, addon: boolean): number | null {
  const p = PLAN_IDS.find((x) => x === plan);
  if (!p) return null;
  const n = PLAN_VANS[p];
  return n == null ? null : n + (addon ? ADDON_VANS : 0);
}
export const netCents = (plan: PlanId, interval: Interval, addon: boolean) => PRICE_CENTS[plan][interval] + (addon && plan !== 'premium' ? PRICE_CENTS.addon[interval] : 0);
/** Where the company can't work until the owner adds a card or a plan (only while payments are on). */
export const BLOCKED: readonly Standing[] = ['incomplete', 'trial_over', 'canceled', 'unpaid', 'paused'];

/** How payments are set up (config/payments, written by Deploy): live, test (Stripe's test keys), or off. */
export interface PayMode { mode: 'live' | 'test' | null; publishableKey: string | null }
let payModeP: Promise<PayMode> | null = null;
export function payMode(): Promise<PayMode> {
  if (!payModeP) {
    const f = fb();
    payModeP = !f ? Promise.resolve({ mode: null, publishableKey: null }) : getDoc(doc(f.db, 'config', 'payments')).then((d) => {
      const x = d.data() as Partial<PayMode> | undefined;
      const mode = x?.mode === 'live' || x?.mode === 'test' ? x.mode : null;
      return { mode, publishableKey: mode ? x?.publishableKey || null : null };
    }, () => { payModeP = null; return { mode: null, publishableKey: null }; });
  }
  return payModeP;
}
/**
 * Does the company wait for its owner's card or plan? As the server decides it (paymentsBlock in functions/src/index.ts):
 * with live keys every company that signed up by itself, with test keys only the ones that signed up through Stripe.
 */
export function blocked(o: Org | null | undefined, mode: PayMode['mode'], creator: boolean): boolean {
  if (!o || !mode || creator) return false;
  if (mode !== 'live' && o.billing?.via !== 'stripe') return false;
  return BLOCKED.includes(standing(o).standing);
}
/** Euros, the way the person's language writes them. */
export function euro(cents: number, locale: string): string {
  const whole = cents % 100 === 0;
  try { return new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: 'currency', currency: 'EUR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100); } catch { return `€${(cents / 100).toFixed(whole ? 0 : 2)}`; }
}

/**
 * Came from the website's "Sign up" button (app.fratius.com/sign-in?mode=up&plan=pro): the app opens on "Create
 * account" and then on "Create a company". Kept for the browser tab, so a reload in between still knows.
 */
export interface SignupIntent { signup: boolean; plan: string | null; interval?: Interval; offer?: string | null }
function readIntent(): SignupIntent {
  const none = { signup: false, plan: null };
  if (Platform.OS !== 'web' || typeof window === 'undefined') return none;
  try {
    const q = new URLSearchParams(window.location.search);
    // The website's buttons: /sign-in?mode=up&plan=pro (free trial without a card), or /start?plan=pro&interval=year
    // and the app creator's sign-up links /start?offer=CODE (with a card, payments.ts).
    if (q.get('mode') === 'up' || window.location.pathname.replace(/\/+$/, '') === '/start') {
      const plan = ['basic', 'pro', 'premium'].find((p) => p === q.get('plan')) || null;
      const offer = (q.get('offer') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || null;
      const it: SignupIntent = { signup: true, plan, interval: q.get('interval') === 'year' ? 'year' : 'month', offer };
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
