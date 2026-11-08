// Sets up payments in Stripe for Fratius, from the keys in GitHub (run by the Deploy workflow; safe to run again):
//   products and prices (by lookup key, from PRICE_CENTS in src/billing.ts), the yearly launch coupon, tax (Stripe Tax
//   if it's on, else 19 % German VAT), the customer portal, the web app's domains (Google Pay, Apple Pay), and the
//   webhook that tells the functions about subscriptions and invoices.
// What it made goes to platform/stripe in Firestore (no secrets). A new webhook's signing secret is written to
// $RUNNER_TEMP/stripe-webhook.secret for the workflow to store in Secret Manager.
//
// Env: PROJECT, STRIPE_SECRET_KEY ("none" or empty: payments off), STRIPE_PUBLISHABLE_KEY, CURRENT_WEBHOOK_SECRET.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Stripe = require('stripe');

const { PLAN_IDS, PLAN_VANS, ADDON_VANS, PRICE_CENTS, YEARLY_LAUNCH_OFF } = require('../lib/billing');
const { STRIPE_API, LAUNCH_COUPON, priceKey } = require('../lib/payments');

const project = process.env.PROJECT || process.env.GCLOUD_PROJECT;
const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
const pk = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
const curSecret = String(process.env.CURRENT_WEBHOOK_SECRET || '').trim();
const outDir = process.env.RUNNER_TEMP || os.tmpdir();
const gh = (kind, title, msg) => console.log(process.env.GITHUB_ACTIONS ? `::${kind} title=${title}::${msg}` : `${title}: ${msg}`);
const summary = (lines) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n'); };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const idOf = (x) => (typeof x === 'string' ? x : x && x.id) || '';
const missing = (e) => e && (e.code === 'resource_missing' || e.statusCode === 404);
const euro = (c) => `€${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

const NAMES = { basic: 'Fratius Basic', pro: 'Fratius Pro', premium: 'Fratius Premium', addon: 'Fratius add-on: 15 more vans' };
const DESCRIPTION = {
  basic: `Up to ${PLAN_VANS.basic} vans, unlimited drivers and stations`,
  pro: `Up to ${PLAN_VANS.pro} vans, unlimited drivers and stations`,
  premium: 'Unlimited vans, drivers and stations',
  addon: `${ADDON_VANS} more vans on Basic or Pro`,
};
const EVENTS = [
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.trial_will_end',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required',
];

(async () => {
  if (!project) throw new Error('PROJECT is not set.');
  initializeApp({ projectId: project });
  const db = getFirestore();
  const ref = db.doc('platform/stripe');
  const cur = (await ref.get()).data() || {};
  const now = Date.now();

  if (!key || key === 'none') {
    await ref.set({ mode: null, updatedAt: now }, { merge: true });
    gh('notice', 'Payments off', 'No STRIPE_SECRET_KEY secret, so sign-up works without a card. README, "Payments", says how to turn them on.');
    summary(['### Payments', 'Off (no STRIPE_SECRET_KEY secret).']);
    return;
  }
  const mode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : null;
  if (!mode) throw new Error('The STRIPE_SECRET_KEY secret isn\'t a Stripe secret key (it starts with sk_test_ or sk_live_). Copy it again from Stripe: Developers, API keys.');
  if (!pk) throw new Error('Add the STRIPE_PUBLISHABLE_KEY variable (Settings > Secrets and variables > Actions > Variables), with the publishable key from Stripe: Developers, API keys.');
  if (!pk.startsWith(mode === 'live' ? 'pk_live_' : 'pk_test_')) {
    throw new Error(`The secret key is a ${mode} key but the publishable key isn't (it should start with ${mode === 'live' ? 'pk_live_' : 'pk_test_'}). Use both keys from the same mode in Stripe.`);
  }
  const stripe = new Stripe(key, { apiVersion: STRIPE_API, maxNetworkRetries: 2 });
  const web = (await db.doc('config/web').get()).data() || {};
  const appUrl = typeof web.url === 'string' && web.url.startsWith('https://') ? web.url : `https://${project}.web.app`;

  let account = null;
  try { account = await stripe.accounts.retrieve(); } catch (e) { gh('warning', 'Stripe', `Couldn't read the Stripe account (${e.message}). A restricted key needs read access to the account.`); }
  if (mode === 'live' && account && !account.charges_enabled) {
    gh('warning', 'Stripe', 'The Stripe account can\'t take payments yet. Finish the activation in the Stripe dashboard (business details, bank account).');
  }

  // 1. Products and prices. A price that changed in the code gets a new Stripe price with the same lookup key;
  //    companies already paying keep the price they signed up with.
  const items = [...PLAN_IDS, 'addon'];
  const keys = items.flatMap((i) => ['month', 'year'].map((iv) => priceKey(i, iv)));
  const have = (await stripe.prices.list({ lookup_keys: keys, active: true, limit: 100 })).data;
  const prices = {};
  const made = [];
  for (const item of items) {
    const productId = `fratius_${item === 'addon' ? 'addon15' : item}`;
    let product = await stripe.products.retrieve(productId).catch((e) => (missing(e) ? null : Promise.reject(e)));
    const want = { name: NAMES[item], description: DESCRIPTION[item], metadata: { fratius: '1' } };
    if (!product) {
      // SaaS for businesses; without the tax code if the account doesn't take it.
      product = await stripe.products.create({ id: productId, ...want, tax_code: 'txcd_10103001' })
        .catch(() => stripe.products.create({ id: productId, ...want }));
      made.push(product.name);
    } else if (!product.active || product.name !== want.name || product.description !== want.description) {
      await stripe.products.update(productId, { ...want, active: true });
    }
    for (const interval of ['month', 'year']) {
      const lk = priceKey(item, interval);
      const cents = PRICE_CENTS[item][interval];
      const p = have.find((x) => x.lookup_key === lk);
      if (p && p.unit_amount === cents && p.currency === 'eur' && p.recurring && p.recurring.interval === interval
        && p.tax_behavior === 'exclusive' && idOf(p.product) === productId) { prices[lk] = p.id; continue; }
      const np = await stripe.prices.create({
        product: productId, currency: 'eur', unit_amount: cents, recurring: { interval }, tax_behavior: 'exclusive',
        lookup_key: lk, transfer_lookup_key: true, nickname: `${NAMES[item]}, ${interval === 'year' ? 'yearly' : 'monthly'}`, metadata: { fratius: '1' },
      });
      if (p) await stripe.prices.update(p.id, { active: false }).catch(() => {});
      prices[lk] = np.id;
      made.push(`${lk} ${euro(cents)}`);
    }
  }

  // 2. The launch offer on yearly plans: a coupon for the first invoice (the first year).
  const coupon = await stripe.coupons.retrieve(LAUNCH_COUPON).catch((e) => (missing(e) ? null : Promise.reject(e)));
  if (!coupon) {
    // On the plan only, not on the add-on (AGB, price list).
    await stripe.coupons.create({
      id: LAUNCH_COUPON, percent_off: YEARLY_LAUNCH_OFF, duration: 'once', name: `Launch offer: ${YEARLY_LAUNCH_OFF} % off the first year`,
      applies_to: { products: PLAN_IDS.map((p) => `fratius_${p}`) },
    });
    made.push(`coupon ${LAUNCH_COUPON}`);
  }

  // 3. Tax: Stripe Tax if it's on (VAT by the customer's country, reverse charge for EU companies with a VAT ID),
  //    else 19 % German VAT on every invoice.
  let tax = null;
  try { const ts = await stripe.tax.settings.retrieve(); if (ts.status === 'active') tax = { mode: 'automatic', rateId: null }; } catch { /* no Stripe Tax */ }
  if (!tax) {
    const rates = (await stripe.taxRates.list({ active: true, limit: 100 })).data;
    let rate = rates.find((r) => r.metadata && r.metadata.fratius === 'de19' && r.percentage === 19 && !r.inclusive);
    if (!rate) {
      rate = await stripe.taxRates.create({
        display_name: 'USt.', description: 'Umsatzsteuer 19 % (Deutschland)', percentage: 19, inclusive: false,
        country: 'DE', jurisdiction: 'DE', tax_type: 'vat', metadata: { fratius: 'de19' },
      });
      made.push('tax rate 19 %');
    }
    tax = { mode: 'rate', rateId: rate.id };
    gh('notice', 'Stripe tax', 'Stripe Tax is off, so 19 % German VAT goes on every invoice. Before selling to companies outside Germany, turn on Stripe Tax (Stripe: Tax, register Germany) and run Deploy again.');
  }

  // 4. The customer portal: card, billing address, VAT ID, invoices, cancelling (to the end of the period). Plan
  //    changes stay in the app, which checks the vans in use.
  const portal = {
    business_profile: { headline: 'Fratius: plan, card and invoices', privacy_policy_url: 'https://fratius.com/datenschutz', terms_of_service_url: 'https://fratius.com/agb' },
    default_return_url: `${appUrl}/plan`,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true, mode: 'at_period_end', proration_behavior: 'none',
        cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] },
      },
      subscription_update: { enabled: false },
    },
    metadata: { fratius: '1' },
  };
  const portals = (await stripe.billingPortal.configurations.list({ active: true, limit: 100 })).data;
  const old = portals.find((c) => c.metadata && c.metadata.fratius === '1');
  const portalConfig = old ? await stripe.billingPortal.configurations.update(old.id, portal) : await stripe.billingPortal.configurations.create(portal);

  // 5. The web app's domains, for Google Pay and Apple Pay in the card form.
  const domains = [...new Set([new URL(appUrl).hostname, 'app.fratius.com', `${project}.web.app`])];
  for (const domain_name of domains) {
    try {
      const got = (await stripe.paymentMethodDomains.list({ domain_name, limit: 1 })).data;
      if (!got.length) { await stripe.paymentMethodDomains.create({ domain_name, enabled: true }); made.push(`domain ${domain_name}`); }
    } catch (e) { gh('warning', 'Stripe', `Couldn't register ${domain_name} for wallets (${e.message}). Cards work anyway.`); }
  }

  // 6. The webhook. Its signing secret is only shown when it's made: a new one is made when there's none for this
  //    mode, or when the secret in Secret Manager isn't the one stored with it (checked by its hash).
  const url = `https://us-central1-${project}.cloudfunctions.net/stripeWebhook`;
  const eps = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url === url);
  const ours = eps.find((e) => e.id === cur.webhookId);
  let webhookId = cur.webhookId || null, webhookSecretHash = cur.webhookSecretHash || null;
  if (ours && cur.mode === mode && curSecret.startsWith('whsec_') && sha(curSecret) === cur.webhookSecretHash) {
    const same = ours.enabled_events.length === EVENTS.length && EVENTS.every((x) => ours.enabled_events.includes(x));
    if (!same || ours.status !== 'enabled') await stripe.webhookEndpoints.update(ours.id, { enabled_events: EVENTS, disabled: false });
    for (const e of eps) if (e.id !== ours.id) await stripe.webhookEndpoints.del(e.id);
  } else {
    for (const e of eps) await stripe.webhookEndpoints.del(e.id);
    const ep = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, api_version: STRIPE_API, description: 'Fratius (made by the Deploy workflow)', metadata: { fratius: '1' } });
    fs.writeFileSync(path.join(outDir, 'stripe-webhook.secret'), ep.secret, { mode: 0o600 });
    webhookId = ep.id;
    webhookSecretHash = sha(ep.secret);
    made.push('webhook');
  }

  await ref.set({
    mode, publishableKey: pk, account: account ? account.id : null,
    accountName: account ? (account.settings && account.settings.dashboard && account.settings.dashboard.display_name) || (account.business_profile && account.business_profile.name) || null : null,
    prices, coupon: LAUNCH_COUPON, tax, portalConfig: portalConfig.id, webhookId, webhookSecretHash,
    liveSince: mode === 'live' ? cur.liveSince || now : null, updatedAt: now,
  });
  const name = (account && ((account.settings && account.settings.dashboard && account.settings.dashboard.display_name) || account.id)) || 'Stripe';
  console.log(`Payments ${mode === 'live' ? 'LIVE' : 'in test mode'} with ${name}.${made.length ? ` Made: ${made.join(', ')}.` : ' Nothing new.'}`);
  if (mode === 'test') gh('notice', 'Payments in test mode', 'Stripe test keys: cards are not charged. The website keeps its request form; the new sign-up page is at /start in the web app. Switch to live keys to go live.');
  summary([
    `### Payments (${mode === 'live' ? 'live' : 'test mode'})`,
    `Stripe account: ${name}. Tax: ${tax.mode === 'automatic' ? 'Stripe Tax' : '19 % German VAT'}. Webhook: ${url}`,
    '',
    '| Plan | Monthly | Yearly |', '|---|---|---|',
    ...items.map((i) => `| ${NAMES[i]} | ${euro(PRICE_CENTS[i].month)} | ${euro(PRICE_CENTS[i].year)} |`),
  ]);
})().catch((e) => {
  const msg = String((e && e.message) || e).split('\n')[0];
  console.log(process.env.GITHUB_ACTIONS ? `::error title=Payments::${msg}` : msg);
  process.exit(1);
});
