import './i18n';
import { N_ } from './i18n';

/**
 * The free trial and, later, the paid plan of a company: `billing` on the company, written only by the server
 * (createCompany now, the payment provider's webhook later). The rules keep the app away from it.
 *
 *   incomplete  signed up with payments on, but no card yet (payments.ts): the app asks the owner for one first.
 *   trialing    30 days from sign-up (trialStart, trialEnd), with a card that is charged only after; the AI has a
 *               daily allowance (AI_DAY).
 *   later       Stripe's status: active, past_due, unpaid, paused, canceled; comped for pilot companies that don't
 *               pay for a while. The names are Stripe's (payments.ts writes them from its webhook).
 *
 * Companies made before self-serve sign-up (createdAt before SIGNUP_START) were set up by hand: no trial, no
 * limits ("legacy"). A company an older app made by itself after that date has no `billing` yet; its trial counts
 * from createdAt (the rules only let the app write a createdAt of now). A demo company has the trial's AI allowance.
 * The app shows the same thing (src/lib/billing.ts): change both.
 */
export const TRIAL_DAYS = 30;
export const SIGNUP_START = Date.UTC(2026, 10, 1); // 1 November 2026
/** The plans a company can choose (product owner, 2026-11-12). */
export const PLAN_IDS = ['basic', 'pro', 'business', 'ultimate'] as const;
/**
 * Every plan a company can be on: the ones offered, and Premium (unlimited vans, EUR 200 a month), sold until
 * 12 November 2026. A company on it keeps it at its price until it changes plan; nobody can choose it any more.
 */
export const ALL_PLANS = [...PLAN_IDS, 'premium'] as const;
export type PlanId = (typeof ALL_PLANS)[number];
export type OfferedPlan = (typeof PLAN_IDS)[number];
export const offered = (p: unknown): OfferedPlan | undefined => PLAN_IDS.find((x) => x === p);
export type Interval = 'month' | 'year';
/** Plans go by vans only; drivers and stations are unlimited (product owner, 2026-11-05). null: unlimited. */
export const PLAN_VANS: Record<PlanId, number | null> = { basic: 50, pro: 150, business: 400, ultimate: 1000, premium: null };
/** The add-on: 15 more vans for EUR 10 a month, once, on Basic and Pro; beyond that, the next plan. */
export const ADDON_VANS = 15;
export const ADDON_PLANS: readonly PlanId[] = ['basic', 'pro'];
export const addonOn = (plan: PlanId, addon: boolean) => addon && ADDON_PLANS.includes(plan);
/**
 * Regular net prices in euro cents (VAT comes on top): EUR 2 a van on a full plan. A year is 12 months. Change a price
 * here and Deploy makes the new one in Stripe (functions/scripts/stripe-setup.cjs); companies already paying keep theirs.
 */
export const PRICE_CENTS: Record<PlanId | 'addon', Record<Interval, number>> = {
  basic: { month: 10000, year: 120000 },
  pro: { month: 30000, year: 360000 },
  business: { month: 80000, year: 960000 },
  ultimate: { month: 200000, year: 2400000 },
  premium: { month: 20000, year: 240000 },
  addon: { month: 1000, year: 12000 },
};
/**
 * The early-bird price (product owner, 2026-11-12): 60 % off the regular price of every plan, EUR 0.80 a van on a
 * full plan, for every company that signs up before EARLY_BIRD_END. It is the plan's price for as long as that
 * subscription runs, also after a change of plan; a company that cancels and comes back later pays the regular price.
 * Its own prices in Stripe (lookup key ..._early), not a coupon: a sign-up link's discount comes off this price.
 * Not on the add-on. The website counts down to the same moment (CONFIG.earlyBird in website/index.html) and the
 * price list in the terms names it (website/agb.html, terms.html): change all of them together.
 */
export const EARLY_BIRD_END = Date.UTC(2027, 2, 31, 22, 0, 0); // 1 April 2027, 00:00 in Germany
export const EARLY_BIRD_OFF = 60;
export const EARLY_CENTS: Record<OfferedPlan, Record<Interval, number>> = {
  basic: { month: 4000, year: 48000 },
  pro: { month: 12000, year: 144000 },
  business: { month: 32000, year: 384000 },
  ultimate: { month: 80000, year: 960000 },
};
/** Does a subscription that started at `started` have the early-bird price? */
export const earlyBird = (started: number) => started < EARLY_BIRD_END;
/** A plan's net price per invoice (without the add-on), at the early-bird price or the regular one. */
export function planCents(plan: PlanId, interval: Interval, early: boolean): number {
  const o = offered(plan);
  return early && o ? EARLY_CENTS[o][interval] : PRICE_CENTS[plan][interval];
}
/**
 * The yearly launch offer (30 % off the first year) is not given on top of the early-bird price; after the early
 * bird it is the app creator's switch again (platform/billing.launchOffer).
 */
export const YEARLY_LAUNCH_OFF = 30;
/** How many vans a plan allows (null: unlimited). */
export function allowedVans(plan: string | null | undefined, addon: boolean): number | null {
  const p = ALL_PLANS.find((x) => x === plan);
  if (!p) return null;
  const n = PLAN_VANS[p];
  return n == null ? null : n + (addonOn(p, addon) ? ADDON_VANS : 0);
}
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
export const TERMS_VERSION: string | null = '2026-11-12';

export type BillingStatus = 'incomplete' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'paused' | 'canceled' | 'comped';
export interface Billing {
  status: BillingStatus;
  trialStart: number;
  trialEnd: number;
  /** Where the company signed up: the website's button, or the app. */
  source: 'website' | 'app';
  /** The plan: picked at sign-up, then Stripe's. */
  plan: string | null;
  /** Billed through Stripe (payments.ts); the rest below is set from it. */
  via?: 'stripe';
  interval?: Interval;
  /** The add-on of 15 more vans. */
  addon?: boolean;
  /** Vans the plan allows (null: unlimited). */
  vans?: number | null;
  /** A card is on file. */
  card?: boolean;
  /** End of the period paid for, and when the plan ends if it was cancelled. */
  periodEnd?: number | null;
  cancelAt?: number | null;
  /** The sign-up link (offer) used, if any. */
  offer?: string | null;
  /** On the early-bird price (the subscription started before EARLY_BIRD_END). */
  early?: boolean;
  /** What Stripe charges per invoice for the plan and the add-on, in cents before VAT and discounts (the prices the company signed up at). */
  net?: number | null;
  /** Made with Stripe's test keys: no real money. */
  testMode?: boolean;
  updatedAt?: number;
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
      // With a card on file Stripe charges it when the trial ends and its webhook says so; until then it's still the trial.
      return { standing: now < end || (b.via === 'stripe' && b.card === true) ? 'trial' : 'trial_over', trialEnd: end, limited: true };
    }
    const s = (['incomplete', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'comped'] as const).find((x) => x === b.status) || 'canceled';
    return { standing: s, trialEnd: Number(b.trialEnd) || null, limited: s !== 'active' && s !== 'comped' };
  }
  const created = Number(o.createdAt);
  if (!(created >= SIGNUP_START)) return { standing: 'legacy', trialEnd: null, limited: false };
  const end = created + TRIAL_DAYS * 86400_000;
  return { standing: now < end ? 'trial' : 'trial_over', trialEnd: end, limited: true };
}

/**
 * Standings in which the company can't work until the owner adds a card or a plan (only when payments are on, see
 * paymentsBlock in index.ts): no card yet, a trial without a card that ran out, or a plan that ended or isn't paid.
 * past_due still works while Stripe tries the card again.
 */
export const BLOCKED: readonly Standing[] = ['incomplete', 'trial_over', 'canceled', 'unpaid', 'paused'];

/** Today in Germany, as 2026-11-03: the AI allowance starts again at midnight there. */
export const berlinDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
