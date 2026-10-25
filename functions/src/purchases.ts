/**
 * Refuelling, washing and buying parts for a van: what the AI is asked about the fuel card and the receipt, and the
 * plain rules the server applies to the answers (does the card match the van's, what looks wrong on the receipt).
 * The callable function is in index.ts (section 16).
 */

export type BuyKind = 'fuel' | 'wash' | 'parts';
export const BUY_KINDS: BuyKind[] = ['fuel', 'wash', 'parts'];
export const BUY_WORD: Record<BuyKind, string> = { fuel: N_('Refuel'), wash: N_('Wash'), parts: N_('Parts') };

import { fill, N_, tr, type Vars } from './i18n';

const nullable = (type: string, extra: object = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] });

/** A text for a record: the English, and the template and values, so the app shows it in each reader's language. */
export interface Said { text: string; t: string; v: Record<string, string | number> }
export function said(t: string, v: Vars = {}): Said {
  const vals: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(v)) if (x != null) vals[k] = x;
  return { text: fill(t, vals), t, v: vals };
}

/* ---------- The fuel card ---------- */

/**
 * The digits to compare from the van's record ("DKV card ending 4471", "Shell 7002 ... 4471"): the last group of
 * at least 3 digits, at most its last 4. Null when the record has no digits (then there's nothing to check).
 */
export function cardDigits(fuelCard: unknown): string | null {
  if (typeof fuelCard !== 'string') return null;
  const groups = fuelCard.match(/\d{3,}/g);
  if (!groups?.length) return null;
  return groups[groups.length - 1].slice(-4);
}
export const normPlate = (p: unknown) => (typeof p === 'string' ? p.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '') : '');

export function cardPrompt(van: { name: string; plate?: string | null }) {
  return `This should be a photo of a fuel card (fleet card), taken at the pump by the driver of the delivery van ${van.name}${van.plate ? ` (number plate ${van.plate})` : ''}. A fleet app checks it is the van's own card before the driver fills up. Common issuers: DKV, UTA, Shell, Aral, BP, Esso, TotalEnergies, Eurowag, Routex, Avia, Westfalen, Q1, Jet, OMV; charging cards too.

Read:
- isCard: true if a card is visible at all.
- kind: "fuel" for a fuel, fleet or charging card; "bank" for a bank or credit card (Visa, Mastercard, Maestro, girocard, V PAY, American Express, a bank's debit card); "other" for anything else (a loyalty card, an ID card).
- issuer: the card's brand, or null.
- last4: the last 4 digits of the card number (the long number printed or embossed on the front). Only those 4 digits: never write the rest of the number. Null if you can't read all 4 with confidence.
- plate: a vehicle number plate printed on the card (fleet cards often carry one), exactly as printed, or null.
- expiry: the expiry date as printed (MM/YY), or null.
- confidence: 0 to 1, how sure you are of last4.
- issue: one short sentence on what made it hard to read (glare, blur, the number covered, too far away), or null.`;
}
export const cardSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['isCard', 'kind', 'issuer', 'last4', 'plate', 'expiry', 'confidence', 'issue'],
  properties: {
    isCard: { type: 'boolean' },
    kind: { type: 'string', enum: ['fuel', 'bank', 'other'] },
    issuer: nullable('string'),
    last4: nullable('string'),
    plate: nullable('string'),
    expiry: nullable('string'),
    confidence: { type: 'number' },
    issue: nullable('string'),
  },
};

export interface CardRead { isCard: boolean; kind: 'fuel' | 'bank' | 'other'; issuer: string | null; last4: string | null; plate: string | null; expiry: string | null; confidence: number; issue: string | null }
const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, n) : null);

/** The AI's answer, cleaned. Only the last 4 digits are kept, whatever came back. */
export function cleanCard(o: Record<string, unknown>): CardRead {
  const digits = typeof o.last4 === 'string' ? o.last4.replace(/\D/g, '') : '';
  return {
    isCard: o.isCard !== false,
    kind: o.kind === 'bank' ? 'bank' : o.kind === 'other' ? 'other' : 'fuel',
    issuer: s(o.issuer, 40),
    last4: digits.length >= 4 ? digits.slice(-4) : null,
    plate: s(o.plate, 20),
    expiry: typeof o.expiry === 'string' && /^\d{1,2}\s*\/\s*\d{2,4}$/.test(o.expiry.trim()) ? o.expiry.replace(/\s/g, '') : null,
    confidence: typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? Math.max(0, Math.min(1, o.confidence)) : 0,
    issue: s(o.issue, 200),
  };
}

export type CardResult = 'match' | 'mismatch' | 'unclear';
/**
 * Is it the van's card? The digits decide. A bank card is never the van's card. A photo where the digits can't be
 * read with confidence is "unclear": the driver takes it again.
 */
export function cardVerdict(expected: string, read: CardRead): { result: CardResult; why: Said } {
  if (!read.isCard) return { result: 'unclear', why: said('No card in the photo.') };
  if (read.kind === 'bank') return { result: 'mismatch', why: said('A bank card, not the van\'s fuel card.') };
  // What made it hard to read is the AI's own words: kept as written.
  if (!read.last4 || read.confidence < 0.6) return { result: 'unclear', why: read.issue ? said('{issue}', { issue: read.issue }) : said('The card number couldn\'t be read.') };
  const n = Math.min(expected.length, 4);
  if (read.last4.slice(-n) === expected.slice(-n)) return { result: 'match', why: said('Card ending {last4}.', { last4: read.last4 }) };
  return {
    result: 'mismatch',
    why: read.issuer ? said('Card ending {last4} ({issuer}); this van\'s card ends {expected}.', { last4: read.last4, issuer: read.issuer, expected })
      : said('Card ending {last4}; this van\'s card ends {expected}.', { last4: read.last4, expected }),
  };
}

/** "12/28" is still valid in December 2028; null when it can't tell. */
export function expired(expiry: string | null, now: number): boolean | null {
  const m = expiry?.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]), year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return null;
  const d = new Date(now);
  return year * 12 + month < d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
}

/* ---------- The receipt ---------- */

export const PRODUCTS = ['diesel', 'petrol', 'adblue', 'lpg', 'cng', 'electricity', 'wash', 'parts', 'oil', 'other'] as const;
export type Product = typeof PRODUCTS[number];

export function receiptPrompt(kind: BuyKind, van: { name: string; plate?: string | null; fuel?: string | null }) {
  const what = kind === 'fuel' ? 'a fuel station receipt for refuelling' : kind === 'wash' ? 'a receipt for washing' : 'a receipt or invoice for parts bought for';
  return `This is a photo of ${what} the delivery van ${van.name}${van.plate ? ` (number plate ${van.plate})` : ''}${van.fuel ? `, which runs on ${van.fuel}` : ''}. A fleet app records what was bought and checks the receipt fits the van.

Read:
- readable: false if this isn't a receipt or nothing on it can be read.
- merchant: the station, car wash or shop, as printed (brand and place if shown), or null.
- date: the date of the purchase as YYYY-MM-DD (expand a two-digit year to 20xx), or null.
- time: the time of the purchase as HH:MM (24-hour), or null.
- items: each line bought, in order:
  - product: "diesel", "petrol" (any petrol grade: Super, E10, Super Plus, 95, 98), "adblue", "lpg", "cng", "electricity", "wash" (a wash programme, vacuum, interior cleaning), "parts" (bulbs, wipers, a mirror, filters, tools and other parts), "oil" (engine oil, other fluids), "other" (food, drinks, deposits, anything else).
  - description: as printed, short.
  - quantity: the amount as a number (litres for fuel and AdBlue, kWh for electricity, pieces for the rest), or null.
  - unit: "l", "kWh", "pcs" or null.
  - unitPrice: the price per litre, kWh or piece, or null.
  - total: what the line cost, or null.
- total: the total paid, or null.
- currency: the currency code (EUR, PLN, CHF...), or null.
- cardLast4: the last 4 digits of the card it was paid with, if the receipt shows them (often masked like ************4471 or XXXX4471), or null. Never more than 4 digits.
- payment: "card", "cash" or "unknown".
- confidence: 0 to 1, how sure you are of the quantities and totals.
- issue: one short sentence on what made it hard to read, or null.
Write numbers as JSON numbers with a decimal point (45.20, not "45,20").`;
}
export const receiptSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'merchant', 'date', 'time', 'items', 'total', 'currency', 'cardLast4', 'payment', 'confidence', 'issue'],
  properties: {
    readable: { type: 'boolean' },
    merchant: nullable('string'),
    date: nullable('string'),
    time: nullable('string'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product', 'description', 'quantity', 'unit', 'unitPrice', 'total'],
        properties: {
          product: { type: 'string', enum: [...PRODUCTS] },
          description: { type: 'string' },
          quantity: nullable('number'),
          unit: nullable('string', { enum: ['l', 'kWh', 'pcs'] }),
          unitPrice: nullable('number'),
          total: nullable('number'),
        },
      },
    },
    total: nullable('number'),
    currency: nullable('string'),
    cardLast4: nullable('string'),
    payment: { type: 'string', enum: ['card', 'cash', 'unknown'] },
    confidence: { type: 'number' },
    issue: nullable('string'),
  },
};

export interface ReceiptItem { product: Product; description: string; quantity: number | null; unit: 'l' | 'kWh' | 'pcs' | null; unitPrice: number | null; total: number | null }
export interface Receipt {
  readable: boolean; merchant: string | null; date: string | null; time: string | null; items: ReceiptItem[]; total: number | null;
  currency: string | null; cardLast4: string | null; payment: 'card' | 'cash' | 'unknown'; confidence: number; issue: string | null;
}
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000 ? Math.round(v * 100) / 100 : null);
const qty = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10_000 ? Math.round(v * 100) / 100 : null);

export function cleanReceipt(o: Record<string, unknown>): Receipt {
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 30).map((x) => {
    const i = (x || {}) as Record<string, unknown>;
    const product = (PRODUCTS as readonly string[]).includes(i.product as string) ? (i.product as Product) : 'other';
    const unit = i.unit === 'l' || i.unit === 'kWh' || i.unit === 'pcs' ? i.unit : null;
    return { product, description: s(i.description, 60) || product, quantity: qty(i.quantity), unit, unitPrice: money(i.unitPrice), total: money(i.total) } as ReceiptItem;
  });
  const digits = typeof o.cardLast4 === 'string' ? o.cardLast4.replace(/\D/g, '') : '';
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  const time = typeof o.time === 'string' && /^\d{1,2}:\d{2}$/.test(o.time) ? o.time.padStart(5, '0') : null;
  const cur = typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency.trim()) ? o.currency.trim().toUpperCase() : null;
  return {
    readable: o.readable !== false, merchant: s(o.merchant, 80), date, time, items, total: money(o.total), currency: cur,
    cardLast4: digits.length >= 4 ? digits.slice(-4) : null, payment: o.payment === 'card' || o.payment === 'cash' ? o.payment : 'unknown',
    confidence: typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? Math.max(0, Math.min(1, o.confidence)) : 0,
    issue: s(o.issue, 200),
  };
}

/** The van's fuel on the receipt, in litres (AdBlue and oil left out). Hybrids and vans without a fuel: diesel or petrol. */
export function fuelLitres(r: Receipt, vanFuel: string | null | undefined): number | null {
  const want: Product[] = vanFuel === 'diesel' ? ['diesel'] : vanFuel === 'petrol' ? ['petrol'] : vanFuel === 'cng' ? ['cng'] : ['diesel', 'petrol'];
  const xs = r.items.filter((i) => want.includes(i.product) && i.quantity != null && (i.unit === 'l' || i.unit == null || i.product === 'cng'));
  if (!xs.length) return null;
  return Math.round(xs.reduce((n, i) => n + (i.quantity || 0), 0) * 100) / 100;
}

/* ---------- What looks wrong: shown to the fleet manager, never a block ---------- */

export interface Flag { key: string; text: string; t: string; v: Record<string, string | number> }
const flag = (key: string, t: string, v: Vars = {}): Flag => ({ key, ...said(t, v) });
export interface FlagInput {
  kind: BuyKind; byName: string; vanFuel: string | null; tankL: number | null; fuelPct: number | null; odometerKm: number | null; lastKm: number | null;
  litres: number | null; total: number | null; createdAt: number; vanDriverName: string | null; notTheirVan: boolean;
  card: { needed: boolean; expected: string | null; result: string | null; expired: boolean | null; plate: string | null } | null;
  vanPlate: string | null;
  decision: { allow: boolean; byName: string } | null;
  receipt: Receipt | null;
}
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const r0 = (n: number) => Math.round(n);

export function purchaseFlags(p: FlagInput): Flag[] {
  const out: Flag[] = [];
  if (p.notTheirVan) out.push(p.vanDriverName ? flag('van', '{driver} has this van, not {name}.', { driver: p.vanDriverName, name: p.byName }) : flag('van', '{name} doesn\'t have this van.', { name: p.byName }));
  const c = p.card;
  if (c?.needed && c.result && c.result !== 'match') {
    const by = p.decision?.allow ? p.decision.byName : null;
    out.push(c.result === 'missing' ? (by ? flag('card', 'No fuel card at the pump; {name} allowed it.', { name: by }) : flag('card', 'No fuel card at the pump.'))
      : c.result === 'unclear' ? (by ? flag('card', 'The card couldn\'t be checked; {name} allowed it.', { name: by }) : flag('card', 'The card couldn\'t be checked.'))
        : by ? flag('card', 'Not the van\'s card; {name} allowed it.', { name: by }) : flag('card', 'Not the van\'s card.'));
  }
  if (c?.expired) out.push(flag('expired', 'The fuel card has expired.'));
  if (c?.plate && p.vanPlate && normPlate(c.plate) !== normPlate(p.vanPlate)) out.push(flag('plate', 'The fuel card is for {cardPlate}; this van is {plate}.', { cardPlate: c.plate, plate: p.vanPlate }));
  const r = p.receipt;
  if (p.kind === 'fuel' && p.litres != null && p.tankL && p.fuelPct != null) {
    const room = p.tankL * (1 - p.fuelPct / 100);
    if (p.litres > room * 1.1 + 3) {
      out.push(flag('litres', '{litres} l, but the tank had room for about {room} l ({tank} l tank, {pct}% on the dashboard photo).', { litres: p.litres, room: r0(room), tank: p.tankL, pct: r0(p.fuelPct) }));
    }
  }
  if (p.kind === 'fuel' && p.litres != null && p.tankL && p.litres > p.tankL * 1.15) {
    if (!out.some((f) => f.key === 'litres')) out.push(flag('litres', '{litres} l is more than the {tank} l tank holds.', { litres: p.litres, tank: p.tankL }));
  }
  if (r) {
    if (c?.expected && r.cardLast4 && r.cardLast4.slice(-c.expected.length) !== c.expected) {
      out.push(flag('receiptCard', 'The receipt shows a card ending {last4}; this van\'s card ends {expected}.', { last4: r.cardLast4, expected: c.expected }));
    }
    if (r.date && Math.abs(Date.parse(r.date) - Date.parse(day(p.createdAt))) > 86400_000) out.push(flag('date', 'The receipt is dated {date}.', { date: r.date }));
    if (p.kind === 'fuel') {
      const other = p.vanFuel === 'diesel' ? 'petrol' : p.vanFuel === 'petrol' ? 'diesel' : null;
      if (other && r.items.some((i) => i.product === other)) out.push(other === 'petrol' ? flag('fuelType', 'Petrol on the receipt; the van runs on diesel.') : flag('fuelType', 'Diesel on the receipt; the van runs on petrol.'));
      const read = fuelLitres(r, p.vanFuel);
      if (read == null) out.push(flag('noFuel', 'No fuel for this van on the receipt.'));
      else if (p.litres != null && Math.abs(p.litres - read) > Math.max(0.5, read * 0.02)) {
        out.push(flag('typedLitres', '{name} saved {litres} l; the receipt says {read} l.', { name: p.byName, litres: p.litres, read }));
      }
      const extra = r.items.filter((i) => ['other', 'parts', 'oil', 'wash'].includes(i.product) && (i.total || 0) > 0);
      if (extra.length) out.push(flag('extra', 'Also on the receipt: {items}.', { items: extra.map((i) => i.description).slice(0, 4).join(', ') }));
    }
  }
  if (r?.total != null && p.total != null && Math.abs(p.total - r.total) > Math.max(0.5, r.total * 0.02)) {
    out.push(flag('typedTotal', '{name} saved a total of {total}; the receipt says {read}.', { name: p.byName, total: p.total.toFixed(2), read: r.total.toFixed(2) }));
  }
  if (p.odometerKm != null && p.lastKm != null && p.odometerKm < p.lastKm - 50) {
    out.push(flag('odometer', 'The odometer ({km} km) is lower than the van\'s last reading ({last} km).', { km: p.odometerKm, last: p.lastKm }));
  }
  return out;
}

const eur = (n: number | null, cur: string | null) => (n == null ? '' : `${cur && cur !== 'EUR' ? cur + ' ' : '€'}${n.toFixed(2)}`);

/** The notification to the fleet manager when it's done, in their language: everything that matters in two lines. */
export function doneMessage(lang: string, p: { kind: BuyKind; vehicleName: string; plate: string | null; byName: string; odometerKm: number | null; litres: number | null; total: number | null; currency: string | null; merchant: string | null; note: string | null; flags: Flag[] }) {
  const van = `${p.vehicleName}${p.plate ? ` (${p.plate})` : ''}`;
  const head = p.kind === 'fuel' ? tr(lang, 'Refuel: {van}', { van }) : p.kind === 'wash' ? tr(lang, 'Wash: {van}', { van }) : tr(lang, 'Parts: {van}', { van });
  const num = (n: number) => n.toLocaleString(lang === 'en' ? 'en-GB' : lang);
  const amount = [p.litres != null ? `${num(p.litres)} l` : '', eur(p.total, p.currency)].filter(Boolean).join(', ');
  const title = amount ? `${head}, ${amount}` : head;
  const who = p.merchant ? tr(lang, '{name} at {place}', { name: p.byName, place: p.merchant }) : p.byName;
  const body = [
    `${who}${p.odometerKm != null ? `, ${num(p.odometerKm)} km` : ''}.`,
    p.kind === 'parts' && p.note ? tr(lang, 'Why: {note}', { note: p.note.slice(0, 120) }) : '',
    p.flags.length ? tr(lang, 'Check: {list}', { list: p.flags.map((f) => (f.t ? tr(lang, f.t, f.v) : f.text)).join(' ') }) : '',
  ].filter(Boolean).join(' ');
  return { title: title.slice(0, 120), body: body.slice(0, 400) };
}
