import './i18n';
import { N_ } from './i18n';

/**
 * The free trial and, later, the paid plan of a company: `billing` on the company, written only by the server
 * (createCompany now, the payment provider's webhook later). The rules keep the app away from it.
 *
 *   trialing  30 days from sign-up (trialStart, trialEnd); the AI has a daily allowance (AI_DAY).
 *   later     the payment provider's (Stripe's) status: active, past_due, unpaid, paused, canceled; comped for pilot
 *             companies that don't pay for a while. The names are Stripe's, so its webhook can write them as they are.
 *
 * Companies made before self-serve sign-up (createdAt before SIGNUP_START) were set up by hand: no trial, no
 * limits ("legacy"). A company an older app made by itself after that date has no `billing` yet; its trial counts
 * from createdAt (the rules only let the app write a createdAt of now). A demo company has the trial's AI allowance.
 * The app shows the same thing (src/lib/billing.ts): change both.
 */
export const TRIAL_DAYS = 30;
export const SIGNUP_START = Date.UTC(2026, 10, 1); // 1 November 2026
export const PLAN_IDS = ['basic', 'pro', 'premium'] as const;
/** How much AI a trial or demo company gets per day (German time): damage checks, and other photo readings. */
export const AI_DAY = { checks: 20, reads: 100 } as const;
export type AiKind = keyof typeof AI_DAY;
export const AI_DAY_MESSAGE: Record<AiKind, string> = {
  checks: N_('This company has used today\'s {n} AI damage checks of the free trial. More from midnight, or write to info@fratius.com for more.'),
  reads: N_('This company has used today\'s {n} AI photo readings of the free trial. More from midnight, or write to info@fratius.com for more.'),
};
/** Companies one person can create (demo companies don't count); more on request. */
export const MAX_COMPANIES = 3;
/**
 * The version of the terms (AGB) and data processing agreement (AVV) people accept when they create a company; null
 * until they are published. Set it together with TERMS_VERSION in src/lib/billing.ts.
 */
export const TERMS_VERSION: string | null = null;

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'unpaid' | 'paused' | 'canceled' | 'comped';
export interface Billing {
  status: BillingStatus;
  trialStart: number;
  trialEnd: number;
  /** Where the company signed up: the website's button, or the app. */
  source: 'website' | 'app';
  /** The plan picked on the website, if any (the payment provider sets the real one later). */
  plan: string | null;
}
export type Standing = 'legacy' | 'demo' | 'trial' | 'trial_over' | Exclude<BillingStatus, 'trialing'>;

export function newTrial(now: number, source: Billing['source'], plan: string | null): Billing {
  return { status: 'trialing', trialStart: now, trialEnd: now + TRIAL_DAYS * 86400_000, source, plan };
}

/** Where a company stands, and whether the AI allowance applies. */
export function standing(o: { createdAt?: unknown; demo?: unknown; billing?: unknown } | undefined, now = Date.now()): { standing: Standing; trialEnd: number | null; limited: boolean } {
  if (!o) return { standing: 'legacy', trialEnd: null, limited: false };
  if (o.demo === true) return { standing: 'demo', trialEnd: null, limited: true };
  const b = o.billing as Partial<Billing> | undefined;
  if (b && typeof b === 'object' && typeof b.status === 'string') {
    if (b.status === 'trialing') {
      const end = Number(b.trialEnd) || 0;
      return { standing: now < end ? 'trial' : 'trial_over', trialEnd: end, limited: true };
    }
    const s = (['active', 'past_due', 'unpaid', 'paused', 'canceled', 'comped'] as const).find((x) => x === b.status) || 'canceled';
    return { standing: s, trialEnd: Number(b.trialEnd) || null, limited: s !== 'active' && s !== 'comped' };
  }
  const created = Number(o.createdAt);
  if (!(created >= SIGNUP_START)) return { standing: 'legacy', trialEnd: null, limited: false };
  const end = created + TRIAL_DAYS * 86400_000;
  return { standing: now < end ? 'trial' : 'trial_over', trialEnd: end, limited: true };
}

/** Today in Germany, as 2026-11-03: the AI allowance starts again at midnight there. */
export const berlinDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
