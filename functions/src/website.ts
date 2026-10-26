/**
 * The request form on fratius.com ("Start your 30 days"): checks what was sent and writes the email the team gets.
 * The function itself (websiteSignup in index.ts) stores the request, guards against spam and sends the email.
 */
import { createHash } from 'node:crypto';

export const PLANS: Record<string, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };
/** Where requests go. The SMTP_URL secret decides which mailbox sends them. */
export const SIGNUP_TO = 'info@fratius.com';
/** Requests from one connection per day, and from everyone per day, before the form says "try later". */
export const PER_CONNECTION = 5;
export const PER_DAY = 300;
/** Faster than this (ms from opening the page to sending) is a script, not a person typing. */
export const MIN_ELAPSED = 3000;

export interface SignupRequest {
  plan: string; aiWaitlist: boolean; company: string; country: string; stations: number; vans: number;
  firstName: string; lastName: string; email: string; phone: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (v: unknown, max: number) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= max ? Number(v) : null);

/** What the form sent, cleaned, or the message to show next to the form. */
export function readSignup(body: unknown): { ok: true; req: SignupRequest } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const plan = text(b.plan, 20);
  if (!PLANS[plan]) return { ok: false, error: 'Pick a plan.' };
  const company = text(b.company, 120);
  if (company.length < 2) return { ok: false, error: "Enter your company's name." };
  const stations = int(b.stations, 999);
  if (!stations) return { ok: false, error: 'Enter how many stations you run, 1 or more.' };
  const vans = int(b.vans, 9999);
  if (!vans) return { ok: false, error: 'Enter how many vans you run, 1 or more.' };
  const firstName = text(b.firstName, 60), lastName = text(b.lastName, 60);
  if (!firstName || !lastName) return { ok: false, error: 'Enter your first and last name.' };
  const email = text(b.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter an email address like name@company.de.' };
  const phone = text(b.phone, 40);
  if (phone.replace(/\D/g, '').length < 7) return { ok: false, error: 'Enter a mobile number with the country code, like +49 151 2345 6789.' };
  return {
    ok: true,
    req: { plan, aiWaitlist: b.aiWaitlist === true, company, country: text(b.country, 60) || 'Not given', stations, vans, firstName, lastName, email, phone },
  };
}

/** A bot filled the hidden field or sent the form faster than a person can type: answer "sent", keep nothing. */
export function looksAutomated(body: unknown): boolean {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website.trim()) return true;
  const elapsed = Number(b.elapsed);
  return !Number.isFinite(elapsed) || elapsed < MIN_ELAPSED;
}

/** A one-way code for the connection, new every day, so requests can be counted without keeping the IP address. */
export function connectionKey(ip: string, day: string): string {
  return createHash('sha256').update(`fratius-signup|${day}|${ip}`).digest('hex').slice(0, 40);
}

export function signupMail(r: SignupRequest, id: string) {
  const plan = PLANS[r.plan];
  const lines = [
    `New request from the website (${id})`,
    '',
    `Company:   ${r.company} (${r.country})`,
    `Plan:      ${plan}`,
    `Fleet:     ${r.stations} station${r.stations === 1 ? '' : 's'}, ${r.vans} vans`,
    `Name:      ${r.firstName} ${r.lastName}`,
    `Email:     ${r.email}`,
    `Mobile:    ${r.phone}`,
    `AI damage: ${r.aiWaitlist ? 'wants to hear when it is ready' : 'no'}`,
    '',
    'Reply to this email to answer them directly.',
  ];
  return { subject: `Website request: ${r.company} (${plan}, ${r.vans} vans)`, text: lines.join('\n') };
}
