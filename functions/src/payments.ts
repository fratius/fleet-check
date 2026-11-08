import { createHash } from 'node:crypto';

import { getFirestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';

import { PLAN_IDS, PLAN_VANS, PRICE_CENTS, allowedVans, type Billing, type BillingStatus, type Interval, type PlanId } from './billing';
import { N_, tr } from './i18n';

/**
 * Payments through Stripe, only on the web (product owner, 2026-11-05; the store apps sell nothing).
 *
 * Everyone adds a card at sign-up, in one step, also with a free trial or a custom offer: "We ask for a card to
 * verify your company and keep out fake accounts. Nothing is charged before {date}; cancel any time before then."
 * The browser collects the card with Stripe's own fields (Stripe.js), so card numbers never reach Fratius.
 *
 *   monthly   a subscription with a 30-day trial; the card is saved now (a SetupIntent) and charged after the trial.
 *   yearly    no trial, paid at sign-up (the first invoice's PaymentIntent); the launch offer takes 30 % off the first
 *             year while the app creator leaves it on.
 *   offers    sign-up links the app creator makes for one DSP (offers/{code}): trial days, a discount, a fixed plan.
 *
 * Stripe is the source of truth: after every step and every webhook the server reads the subscription back and
 * writes orgs/{org}.billing from it (billingOf below). The Stripe ids sit in payments/{org}, server only.
 *
 * Deploy sets things up (functions/scripts/stripe-setup.cjs): products and prices (by lookup key), the launch coupon,
 * tax, the customer portal and the webhook; it writes what it made to platform/stripe (no secrets) and the webhook's
 * signing secret to Secret Manager. Without a key (STRIPE_SECRET_KEY "none") payments are off and sign-up works as
 * before. In the emulator tests the key is "not-used-in-tests" and a fake Stripe keeps its objects in Firestore.
 */

export const STRIPE_API = '2026-10-28.endive' as const;
export const LAUNCH_COUPON = 'fratius_yearly_launch_30';
export type Item = PlanId | 'addon';
export const priceKey = (item: Item, interval: Interval) => `fratius_${item === 'addon' ? 'addon15' : item}_${interval}`;
export function readKey(key: string | null | undefined): { item: Item; interval: Interval } | null {
  const m = /^fratius_(basic|pro|premium|addon15)_(month|year)$/.exec(String(key || ''));
  if (!m) return null;
  return { item: m[1] === 'addon15' ? 'addon' : (m[1] as PlanId), interval: m[2] as Interval };
}
export const TEST_KEY = 'not-used-in-tests';

/** platform/stripe: what Deploy set up in Stripe. Public parts only (the publishable key is meant for browsers). */
export interface PayConfig {
  mode: 'live' | 'test' | 'fake' | null;
  publishableKey?: string | null;
  /** Lookup key -> price id. */
  prices?: Record<string, string>;
  tax?: { mode: 'automatic' | 'rate' | 'none'; rateId?: string | null };
  portalConfig?: string | null;
  accountName?: string | null;
}
let cached: { at: number; c: PayConfig } | null = null;
/** Read at most once a minute per server (every call that may be blocked reads it). */
export async function payConfig(fresh = false): Promise<PayConfig> {
  // Not kept on the emulators: the tests switch payments on and off.
  if (!fresh && cached && Date.now() - cached.at < 60_000 && process.env.FUNCTIONS_EMULATOR !== 'true') return cached.c;
  const d = (await getFirestore().doc('platform/stripe').get()).data() as Partial<PayConfig> | undefined;
  const mode = d?.mode === 'live' || d?.mode === 'test' || d?.mode === 'fake' ? d.mode : null;
  const c: PayConfig = { ...(d || {}), mode };
  cached = { at: Date.now(), c };
  return c;
}
/** platform/billing: the app creator's switches. */
export async function launchOfferOn(): Promise<boolean> {
  const d = (await getFirestore().doc('platform/billing').get()).data();
  return d?.launchOffer !== false;
}

/* ---------- the parts of Stripe Fratius uses, as one small interface (real or fake) ---------- */

export interface Address { line1: string; line2?: string; city: string; postal_code: string; state?: string; country: string }
export interface CustomerInput { name: string; email: string; address: Address | null; locales: string[]; orgId: string }
export interface Sub {
  id: string;
  status: Stripe.Subscription.Status;
  live: boolean;
  customer: string;
  created: number;
  trialStart: number | null;
  trialEnd: number | null;
  periodEnd: number | null;
  cancelAt: number | null;
  card: boolean;
  items: { id: string; key: string | null; price: string }[];
  metadata: Record<string, string>;
  coupons: string[];
  /** What the browser confirms with Stripe.js: the card for a trial (setup), or a payment. */
  next: { kind: 'setup' | 'payment'; clientSecret: string; amount: number } | null;
}
export interface SubInput {
  customer: string;
  prices: string[];
  trialEnd: number | null;
  coupon: string | null;
  tax: PayConfig['tax'];
  metadata: Record<string, string>;
}
export interface Coupon { percentOff: number | null; amountOff: number | null; months: number | null; name: string }
export interface PayEvent { id: string; type: string; live: boolean; subscription: string | null; customer: string | null }

export interface Pay {
  createCustomer(c: CustomerInput, idem: string): Promise<string>;
  updateCustomer(id: string, c: Partial<CustomerInput>): Promise<void>;
  addTaxId(customer: string, type: string, value: string): Promise<void>;
  createSubscription(s: SubInput, idem: string): Promise<Sub>;
  getSubscription(id: string): Promise<Sub | null>;
  /** New plan or add-on (and the coupon when switching to yearly); upgrades are charged now, downgrades credited. */
  changeItems(id: string, items: { id?: string; price?: string; deleted?: boolean }[], o: { charge: boolean; coupon: string | null }): Promise<Sub>;
  cancelNow(id: string): Promise<void>;
  /** The card a SetupIntent saved, if it succeeded for this customer. */
  setupCard(setupIntent: string, customer: string): Promise<string | null>;
  useCard(sub: string, customer: string, card: string): Promise<Sub>;
  portalUrl(customer: string, returnUrl: string, config: string | null): Promise<string>;
  ensureCoupon(id: string, c: Coupon): Promise<void>;
  /** Checks the webhook's signature; throws when it's wrong. */
  event(raw: Buffer, signature: string, secret: string): Promise<PayEvent>;
}

const sec = (t: number | null | undefined) => (t ? t * 1000 : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === 'string' ? x : x?.id || '');

function fromStripe(s: Stripe.Subscription): Sub {
  const inv = s.latest_invoice && typeof s.latest_invoice === 'object' ? s.latest_invoice : null;
  const si = s.pending_setup_intent && typeof s.pending_setup_intent === 'object' ? s.pending_setup_intent : null;
  let next: Sub['next'] = null;
  if (si?.client_secret && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(si.status)) {
    next = { kind: 'setup', clientSecret: si.client_secret, amount: 0 };
  } else if (inv && inv.status === 'open' && inv.amount_due > 0 && inv.confirmation_secret?.client_secret) {
    next = { kind: 'payment', clientSecret: inv.confirmation_secret.client_secret, amount: inv.amount_due };
  }
  const ends = s.items.data.map((i) => i.current_period_end).filter(Boolean);
  return {
    id: s.id, status: s.status, live: s.livemode, customer: idOf(s.customer), created: s.created * 1000,
    trialStart: sec(s.trial_start), trialEnd: sec(s.trial_end), periodEnd: ends.length ? Math.max(...ends) * 1000 : null,
    cancelAt: sec(s.cancel_at) || (s.cancel_at_period_end && ends.length ? Math.max(...ends) * 1000 : null),
    card: !!s.default_payment_method,
    items: s.items.data.map((i) => ({ id: i.id, key: i.price.lookup_key, price: i.price.id })),
    metadata: { ...(s.metadata || {}) },
    coupons: (s.discounts || []).map((d) => (typeof d === 'object' ? idOf(d.source?.coupon) : '')).filter(Boolean),
    next,
  };
}
const EXPAND = ['latest_invoice.confirmation_secret', 'pending_setup_intent'];

class RealPay implements Pay {
  constructor(private s: Stripe) {}
  async createCustomer(c: CustomerInput, idem: string) {
    const cu = await this.s.customers.create({
      name: c.name, email: c.email, preferred_locales: c.locales, metadata: { orgId: c.orgId },
      ...(c.address ? { address: c.address, tax: { validate_location: 'deferred' } } : {}),
    }, { idempotencyKey: idem });
    return cu.id;
  }
  async updateCustomer(id: string, c: Partial<CustomerInput>) {
    await this.s.customers.update(id, {
      ...(c.name ? { name: c.name } : {}), ...(c.email ? { email: c.email } : {}), ...(c.locales ? { preferred_locales: c.locales } : {}),
      ...(c.address ? { address: c.address } : {}),
    });
  }
  async addTaxId(customer: string, type: string, value: string) {
    const have = await this.s.customers.listTaxIds(customer, { limit: 20 });
    if (have.data.some((x) => x.value.replace(/\s/g, '').toUpperCase() === value)) return;
    await this.s.customers.createTaxId(customer, { type: type as Stripe.CustomerCreateTaxIdParams.Type, value });
  }
  async createSubscription(x: SubInput, idem: string) {
    const s = await this.s.subscriptions.create({
      customer: x.customer,
      items: x.prices.map((price) => ({ price })),
      payment_behavior: 'default_incomplete',
      payment_settings: { payment_method_types: ['card'], save_default_payment_method: 'on_subscription' },
      ...(x.trialEnd ? { trial_end: Math.floor(x.trialEnd / 1000), trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
      ...(x.coupon ? { discounts: [{ coupon: x.coupon }] } : {}),
      ...(x.tax?.mode === 'automatic' ? { automatic_tax: { enabled: true } } : x.tax?.mode === 'rate' && x.tax.rateId ? { default_tax_rates: [x.tax.rateId] } : {}),
      metadata: x.metadata,
      expand: EXPAND,
    }, { idempotencyKey: idem });
    return fromStripe(s);
  }
  async getSubscription(id: string) {
    try { return fromStripe(await this.s.subscriptions.retrieve(id, { expand: EXPAND })); } catch (e) {
      if ((e as { code?: string }).code === 'resource_missing') return null;
      throw e;
    }
  }
  async changeItems(id: string, items: { id?: string; price?: string; deleted?: boolean }[], o: { charge: boolean; coupon: string | null }) {
    if (o.coupon) await this.s.subscriptions.update(id, { discounts: [{ coupon: o.coupon }] });
    const s = await this.s.subscriptions.update(id, {
      items, proration_behavior: o.charge ? 'always_invoice' : 'create_prorations',
      // A bank that asks to confirm the payment: the change waits until the owner confirms it (Sub.next).
      payment_behavior: o.charge ? 'pending_if_incomplete' : 'allow_incomplete', expand: EXPAND,
    });
    return fromStripe(s);
  }
  async cancelNow(id: string) {
    try { await this.s.subscriptions.cancel(id, { prorate: false }); } catch (e) {
      if ((e as { code?: string }).code !== 'resource_missing') throw e;
    }
  }
  async setupCard(setupIntent: string, customer: string) {
    const si = await this.s.setupIntents.retrieve(setupIntent);
    return si.status === 'succeeded' && idOf(si.customer) === customer && si.payment_method ? idOf(si.payment_method) : null;
  }
  async useCard(sub: string, customer: string, card: string) {
    await this.s.customers.update(customer, { invoice_settings: { default_payment_method: card } });
    return fromStripe(await this.s.subscriptions.update(sub, { default_payment_method: card, expand: EXPAND }));
  }
  async portalUrl(customer: string, returnUrl: string, config: string | null) {
    const p = await this.s.billingPortal.sessions.create({ customer, return_url: returnUrl, locale: 'auto', ...(config ? { configuration: config } : {}) });
    return p.url;
  }
  async ensureCoupon(id: string, c: Coupon) {
    try { await this.s.coupons.retrieve(id); return; } catch (e) {
      if ((e as { code?: string }).code !== 'resource_missing') throw e;
    }
    await this.s.coupons.create({
      id, name: c.name.slice(0, 40),
      ...(c.percentOff ? { percent_off: c.percentOff } : { amount_off: c.amountOff || 0, currency: 'eur' }),
      ...(c.months ? { duration: 'repeating', duration_in_months: c.months } : { duration: 'forever' }),
    });
  }
  async event(raw: Buffer, signature: string, secret: string) {
    return eventOf(this.s.webhooks.constructEvent(raw, signature, secret));
  }
}

function eventOf(e: Stripe.Event): PayEvent {
  const o = e.data.object as unknown as { object?: string; id?: string; customer?: unknown; parent?: { subscription_details?: { subscription?: unknown } | null } | null };
  const subscription = o.object === 'subscription' ? String(o.id) : idOf(o.parent?.subscription_details?.subscription as string) || null;
  return { id: e.id, type: e.type, live: e.livemode, subscription, customer: idOf(o.customer as string) || null };
}

/**
 * Stripe for the emulator tests: the same answers, kept in Firestore (fakeStripe/{id}). The test stands in for the
 * browser by setting `confirmed` on a subscription (the card was entered and accepted).
 */
class FakePay implements Pay {
  private col = () => getFirestore().collection('fakeStripe');
  private async put<T extends object>(id: string, d: T) { await this.col().doc(id).set(d as Record<string, unknown>, { merge: true }); }
  private async read(id: string) { return (await this.col().doc(id).get()).data() as (Sub & { confirmed?: boolean; amount?: number }) | undefined; }
  private newId(p: string) { return `${p}_fake${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
  async createCustomer(c: CustomerInput, idem: string) {
    const id = `cus_fake_${createHash('sha256').update(idem).digest('hex').slice(0, 12)}`;
    await this.put(id, { object: 'customer', ...c });
    return id;
  }
  async updateCustomer(id: string, c: Partial<CustomerInput>) { await this.put(id, c); }
  async addTaxId(customer: string, type: string, value: string) {
    if (!/^[A-Z]{2}[0-9A-Z]{6,12}$/.test(value)) throw Object.assign(new Error('Invalid value for eu_vat.'), { type: 'StripeInvalidRequestError', code: 'tax_id_invalid' });
    await this.put(customer, { taxId: { type, value } });
  }
  async createSubscription(x: SubInput, idem: string) {
    const id = `sub_fake_${createHash('sha256').update(idem).digest('hex').slice(0, 12)}`;
    const had = await this.read(id);
    if (had) return this.view(id);
    const keys = x.prices; // fake prices are the lookup keys
    const cents = (k: string) => { const r = readKey(k); return r ? PRICE_CENTS[r.item][r.interval] : 0; };
    const full = keys.reduce((n, k) => n + cents(k), 0);
    const launch = x.coupon === LAUNCH_COUPON;
    const off = launch ? 30 : Number((await this.read(`coupon_${x.coupon}`))?.amount || 0);
    // The launch offer is on the plan only, not on the add-on (as its coupon in Stripe).
    const base = launch ? keys.filter((k) => readKey(k)?.item !== 'addon').reduce((n, k) => n + cents(k), 0) : full;
    const amount = Math.round(full - base * (off / 100));
    const now = Date.now();
    const trial = !!x.trialEnd;
    const s: Sub & { amount: number } = {
      id, status: trial || !amount ? 'trialing' : 'incomplete', live: false, customer: x.customer, created: now,
      trialStart: trial ? now : null, trialEnd: x.trialEnd, periodEnd: trial ? x.trialEnd : now + 30 * 86400_000, cancelAt: null, card: false,
      items: keys.map((k, i) => ({ id: `si_fake_${id}_${i}`, key: k, price: k })), metadata: x.metadata, coupons: x.coupon ? [x.coupon] : [],
      next: trial || !amount ? { kind: 'setup', clientSecret: `seti_fake_${id}_secret_x`, amount: 0 } : { kind: 'payment', clientSecret: `pi_fake_${id}_secret_x`, amount },
      amount,
    };
    if (!trial && !amount) { s.status = 'active'; s.trialStart = null; }
    await this.put(id, s);
    return this.view(id);
  }
  /** After the "browser" confirmed: the card is saved, and a payment is made. */
  private async view(id: string): Promise<Sub> {
    const s = await this.read(id);
    if (!s) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
    if (s.confirmed && s.next?.kind === 'payment') {
      await this.put(id, { status: 'active', card: true, next: null, confirmed: false });
      return this.view(id);
    }
    const { confirmed: _c, amount: _a, ...sub } = s;
    return sub;
  }
  async getSubscription(id: string) { return (await this.read(id)) ? this.view(id) : null; }
  async changeItems(id: string, items: { id?: string; price?: string; deleted?: boolean }[], o: { charge: boolean; coupon: string | null }) {
    const s = await this.view(id);
    let list = s.items.slice();
    for (const it of items) {
      if (it.deleted) list = list.filter((x) => x.id !== it.id);
      else if (it.id) list = list.map((x) => (x.id === it.id ? { ...x, key: it.price || x.key, price: it.price || x.price } : x));
      else if (it.price) list.push({ id: this.newId('si'), key: it.price, price: it.price });
    }
    await this.put(id, { items: list, ...(o.coupon ? { coupons: [o.coupon] } : {}), lastChange: { charge: o.charge, at: Date.now() } });
    return this.view(id);
  }
  async cancelNow(id: string) { if (await this.read(id)) await this.put(id, { status: 'canceled', next: null }); }
  async setupCard(setupIntent: string, customer: string) {
    const m = /^seti_fake_(sub_fake_[0-9a-f]+)/.exec(setupIntent);
    const s = m ? await this.read(m[1]) : undefined;
    return s && s.customer === customer && s.confirmed ? 'pm_fake_visa' : null;
  }
  async useCard(sub: string) {
    await this.put(sub, { card: true, next: null, confirmed: false });
    return this.view(sub);
  }
  async portalUrl(customer: string, returnUrl: string) { return `https://billing.stripe.test/p/${customer}?return=${encodeURIComponent(returnUrl)}`; }
  async ensureCoupon(id: string, c: Coupon) { await this.put(`coupon_${id}`, { amount: c.percentOff || 0, ...c }); }
  async event(raw: Buffer, signature: string, secret: string) {
    const e = new Stripe('sk_test_fake').webhooks.constructEvent(raw, signature, secret);
    const ev = eventOf(e);
    // Stripe would have changed the subscription before telling us: so does the fake.
    const o = e.data.object as unknown as Partial<Sub> & { object?: string };
    if (o.object === 'subscription' && o.id && (await this.read(o.id))) {
      const { object: _o, ...rest } = o;
      await this.put(o.id, rest);
    }
    return ev;
  }
}

/** Stripe with the secret key, or the fake in the emulator tests; null when payments are off. */
export function payWith(key: string | undefined, mode: PayConfig['mode']): Pay | null {
  const k = String(key || '').trim();
  if (!mode || !k || k === 'none') return null;
  if (k === TEST_KEY) return mode === 'fake' ? new FakePay() : null;
  if (mode === 'fake') return null;
  return new RealPay(new Stripe(k, { apiVersion: STRIPE_API, maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Fratius', url: 'https://fratius.com' } }));
}

/* ---------- what the company's billing says, from the subscription ---------- */

export function planOf(s: Pick<Sub, 'items'>): { plan: PlanId | null; interval: Interval | null; addon: boolean } {
  let plan: PlanId | null = null, interval: Interval | null = null, addon = false;
  for (const it of s.items) {
    const r = readKey(it.key);
    if (!r) continue;
    interval = r.interval;
    if (r.item === 'addon') addon = true; else plan = r.item;
  }
  return { plan, interval, addon };
}

/** orgs/{org}.billing from Stripe's subscription (prev: what was there, for the sign-up source). */
export function billingOf(s: Sub, prev: Partial<Billing> | undefined, now = Date.now()): Billing {
  const { plan, interval, addon } = planOf(s);
  // A trial without a card is not a trial yet: the owner still has to add one (or Stripe ends it at the trial's end).
  let status: BillingStatus;
  if (s.status === 'trialing') status = s.card ? 'trialing' : 'incomplete';
  else if (s.status === 'incomplete') status = 'incomplete';
  else if (['active', 'past_due', 'unpaid', 'paused', 'canceled'].includes(s.status)) status = s.status as BillingStatus;
  else status = 'canceled'; // incomplete_expired, or a status Stripe adds later
  const p = plan || (PLAN_IDS.find((x) => x === prev?.plan) ?? null);
  return {
    status,
    trialStart: s.trialStart ?? Number(prev?.trialStart || s.created),
    trialEnd: s.trialEnd ?? (s.status === 'trialing' ? Number(prev?.trialEnd || now) : Number(prev?.trialEnd || s.created)),
    source: prev?.source === 'website' ? 'website' : 'app',
    plan: p,
    via: 'stripe',
    interval: interval || (prev?.interval === 'year' ? 'year' : 'month'),
    addon,
    vans: allowedVans(p, addon),
    card: s.card,
    periodEnd: s.periodEnd,
    cancelAt: s.cancelAt,
    offer: s.metadata.offer || prev?.offer || null,
    testMode: !s.live,
    updatedAt: now,
  };
}

/* ---------- custom sign-up links (offers/{code}, server only) ---------- */

export interface Offer {
  code: string;
  /** Who it is for (only the app creator sees it), e.g. "Hart Logistics, 80 vans". */
  note: string;
  /** A fixed plan and interval, or null to let them pick. */
  plan: PlanId | null;
  interval: Interval | null;
  /** Free days before the first payment (0: pay at sign-up). */
  trialDays: number;
  /** A discount, in percent or in euro cents per invoice; for how many months (null: for as long as they stay). */
  percentOff: number | null;
  amountOff: number | null;
  months: number | null;
  validUntil: number | null;
  maxUses: number;
  uses: number;
  ended: boolean;
  createdAt: number;
  createdBy: string;
}
export const OFFER_CODE = /^[A-Z0-9]{6,16}$/;
export function newOfferCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
  let s = '';
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
export const offerCoupon = (o: Pick<Offer, 'code'>) => `fratius_offer_${o.code.toLowerCase()}`;
export function offerUsable(o: Offer | undefined, now = Date.now()): string | null {
  if (!o) return N_('This sign-up link doesn\'t exist. Check the link, or write to info@fratius.com.');
  if (o.ended || (o.validUntil && now > o.validUntil)) return N_('This sign-up link has ended. Write to info@fratius.com for a new one.');
  if (o.uses >= o.maxUses) return N_('This sign-up link has already been used. Write to info@fratius.com for a new one.');
  return null;
}
/** What the sign-up page may show about an offer (not the note, not who made it). */
export function offerPublic(o: Offer) {
  return { code: o.code, plan: o.plan, interval: o.interval, trialDays: o.trialDays, percentOff: o.percentOff, amountOff: o.amountOff, months: o.months, validUntil: o.validUntil };
}

/** VAT ID types Stripe knows for the countries DSPs are in; others are left out. */
const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);
export function vatType(country: string): string | null {
  if (EU.has(country)) return 'eu_vat';
  return ({ GB: 'gb_vat', CH: 'ch_vat', NO: 'no_vat', RS: 'rs_pib', AL: 'al_tin', TR: 'tr_tin', UA: 'ua_vat' } as Record<string, string>)[country] || null;
}
/** Invoices and Stripe's emails in German for German-speaking countries, else the person's language if Stripe has it. */
const STRIPE_LOCALES = new Set(['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'vi']);
export function localesFor(lang: string, country: string | null): string[] {
  if (country && ['DE', 'AT', 'CH', 'LI'].includes(country)) return ['de', 'en'];
  const l = lang.split('-')[0];
  return STRIPE_LOCALES.has(l) && l !== 'en' ? [l, 'en'] : ['en'];
}

/* ---------- the email after sign-up (what was ordered, the terms, how to cancel) ---------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const loc = (lang: string) => `${lang === 'en' ? 'en-GB' : lang}-u-nu-latn`;
export function euro(cents: number, lang: string) {
  try { return new Intl.NumberFormat(loc(lang), { style: 'currency', currency: 'EUR' }).format(cents / 100); } catch { return `€${(cents / 100).toFixed(2)}`; }
}
export function day(t: number, lang: string) {
  try { return new Date(t).toLocaleDateString(loc(lang), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }); } catch { return new Date(t).toISOString().slice(0, 10); }
}

export function orderMail(o: { lang: string; name: string; company: string; b: Billing; netCents: number; firstCents: number; appUrl: string; termsVersion: string | null }) {
  const { lang, b } = o;
  const plan = b.plan ? b.plan[0].toUpperCase() + b.plan.slice(1) : '';
  const base = PLAN_VANS[(b.plan || '') as PlanId];
  const vans = base == null ? tr(lang, 'unlimited vans') : tr(lang, 'up to {n} vans', { n: base });
  const per = b.interval === 'year' ? tr(lang, '{price} a year, plus VAT', { price: euro(o.netCents, lang) }) : tr(lang, '{price} a month, plus VAT', { price: euro(o.netCents, lang) });
  const subject = tr(lang, 'Your Fratius plan for {company}', { company: o.company });
  const hello = tr(lang, 'Hi {name},', { name: o.name });
  const intro = tr(lang, 'Thanks for signing up {company}. This is what you ordered:', { company: o.company });
  const rows = [
    tr(lang, 'Plan: {plan}, {vans}, unlimited drivers and stations', { plan, vans }),
    ...(b.addon && b.vans ? [tr(lang, 'Add-on: 15 more vans ({n} in all)', { n: b.vans })] : []),
    tr(lang, 'Price: {price}', { price: per }),
    ...(b.status === 'trialing'
      ? [tr(lang, 'Free until {date}. Nothing is charged before then; cancel any time before.', { date: day(b.trialEnd, lang) })]
      : [tr(lang, 'Paid today: {price}, plus VAT', { price: euro(o.firstCents, lang) })]),
    tr(lang, 'Renews {when} until you cancel. You can cancel any time to the end of the period paid for.', { when: b.interval === 'year' ? tr(lang, 'every year') : tr(lang, 'every month') }),
  ];
  const manage = tr(lang, 'Change your plan, card or billing address, see your invoices or cancel: Account, then Plan and billing, in the web app.');
  const terms = tr(lang, 'Our terms (AGB) and the data processing agreement (AVV) you accepted:');
  const links = [['https://fratius.com/agb', 'AGB'], ['https://fratius.com/avv', 'AVV'], ['https://fratius.com/datenschutz', tr(lang, 'Privacy policy')]];
  const invoices = tr(lang, 'Invoices come from Stripe, our payment provider, by email.');
  const questions = tr(lang, 'Questions? Just reply to this email.');
  const tagline = tr(lang, 'Fleet management for delivery partners');
  const text = [
    hello, '', intro, '', ...rows.map((r) => `- ${r}`), '', manage, `${o.appUrl}`, '', terms,
    ...links.map(([u, l]) => `${l}: ${u}`), ...(o.termsVersion ? [`(${o.termsVersion})`] : []), '', invoices, questions, '', '--',
    `Fratius · ${tagline}`, 'https://fratius.com · info@fratius.com · https://fratius.com/impressum',
  ].join('\n');
  const rtl = lang === 'ar' || lang === 'fa';
  const font = "font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans',Arial,sans-serif";
  const html = `<!doctype html><html lang="${esc(lang)}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#ECEEF1;color:#000;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:2px solid #000;border-radius:4px">
<tr><td style="background:#E2FF1C;border-bottom:2px solid #000;padding:16px 24px;font-size:24px;font-weight:700;letter-spacing:.01em" translate="no">Fratius</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.55">
<p style="margin:0 0 12px">${esc(hello)}</p>
<p style="margin:0 0 12px">${esc(intro)}</p>
<ul style="margin:0 0 20px;padding-${rtl ? 'right' : 'left'}:20px">${rows.map((x) => `<li style="margin:0 0 4px">${esc(x)}</li>`).join('')}</ul>
<p style="margin:0 0 6px">${esc(manage)}</p>
<p style="margin:0 0 20px"><a href="${esc(o.appUrl)}" style="color:#000;font-weight:600">${esc(o.appUrl.replace(/^https:\/\//, ''))}</a></p>
<p style="margin:0 0 6px">${esc(terms)}</p>
<p style="margin:0 0 20px">${links.map(([u, l]) => `<a href="${esc(u)}" style="color:#000">${esc(l)}</a>`).join(' · ')}${o.termsVersion ? ` <span style="color:#565C66">(${esc(o.termsVersion)})</span>` : ''}</p>
<p style="margin:0 0 6px">${esc(invoices)}</p>
<p style="margin:0">${esc(questions)}</p>
</td></tr>
<tr><td style="border-top:2px solid #000;padding:14px 24px;font-size:13px;line-height:1.5;color:#565C66">
<span translate="no">Fratius</span> · ${esc(tagline)}<br><a href="https://fratius.com" style="color:#000">fratius.com</a> · <a href="mailto:info@fratius.com" style="color:#000">info@fratius.com</a> · <a href="https://fratius.com/impressum" style="color:#000">Impressum</a>
</td></tr></table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

/** What a plan costs before VAT, per invoice, without discounts (the add-on is EUR 10 a month or EUR 120 a year). */
export function netCents(plan: PlanId, interval: Interval, addon: boolean): number {
  return PRICE_CENTS[plan][interval] + (addon && plan !== 'premium' ? PRICE_CENTS.addon[interval] : 0);
}
