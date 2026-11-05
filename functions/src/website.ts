/**
 * The request form on fratius.com ("Start your 30 days"): checks what was sent and writes the email the team gets.
 * The function itself (websiteSignup in index.ts) stores the request, guards against spam and sends the email.
 */
import { createHash } from 'node:crypto';

import { tr } from './i18n';

export const PLANS: Record<string, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };
/** Vans each plan covers (null = unlimited). The website's CONFIG.plans shows the same: change both. */
export const PLAN_VANS: Record<string, number | null> = { basic: 50, pro: 150, premium: null };
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
  /** The website's language when the form was sent (en, de, ro…). */
  lang: string;
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
    req: { plan, aiWaitlist: b.aiWaitlist === true, company, country: text(b.country, 60) || 'Not given', stations, vans, firstName, lastName, email, phone, lang: /^[a-z]{2}$/.test(text(b.lang, 5)) ? text(b.lang, 5) : 'en' },
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
    `Language:  ${r.lang || 'en'}`,
    `AI damage: ${r.aiWaitlist ? 'wants to hear when it is ready' : 'no'}`,
    '',
    'Reply to this email to answer them directly.',
  ];
  return { subject: `Website request: ${r.company} (${plan}, ${r.vans} vans)`, text: lines.join('\n') };
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * The email the person who sent the form gets: a welcome, what they sent, what happens next. In the language the
 * website was in (the app's translations; English when a text isn't translated yet). Plain text and HTML.
 */
export function welcomeMail(r: SignupRequest) {
  const lang = r.lang || 'en';
  // Western digits in every language, as on the website (Persian would otherwise get ۱۵۰).
  const num = (n: number) => { try { return new Intl.NumberFormat(`${lang}-u-nu-latn`).format(n); } catch { return String(n); } };
  const plan = PLANS[r.plan] || r.plan;
  const max = PLAN_VANS[r.plan];
  const name = r.firstName;
  const subject = tr(lang, 'Welcome to Fratius, {name}', { name });
  const hello = tr(lang, 'Hi {name},', { name });
  const intro = tr(lang, 'Thanks for your request for {company}. Welcome to Fratius!', { company: r.company });
  const sentTitle = tr(lang, 'What you sent us');
  const sent = [
    max ? tr(lang, 'Plan: {plan}, up to {n} vans', { plan, n: num(max) }) : tr(lang, 'Plan: {plan}, unlimited vans', { plan }),
    tr(lang, 'Stations: {n}', { n: num(r.stations) }),
    tr(lang, 'Vans: {n}', { n: num(r.vans) }),
    tr(lang, 'Mobile: {phone}', { phone: r.phone }),
  ];
  const nextTitle = tr(lang, 'What happens next');
  const next = [
    tr(lang, 'We set up your company in Fratius.'),
    tr(lang, 'You get a second email with a link to sign in as the fleet owner.'),
    tr(lang, 'Your 30 free days start on that day. Nothing is charged now.'),
  ];
  const questions = tr(lang, 'Questions? Just reply to this email.');
  const why = tr(lang, "You get this email because a request with this address was sent on fratius.com. If that wasn't you, ignore it.");
  const tagline = tr(lang, 'Fleet management for delivery partners');

  const text = [
    hello, '', intro, '',
    sentTitle, ...sent.map((x) => `- ${x}`), '',
    nextTitle, ...next.map((x, i) => `${i + 1}. ${x}`), '',
    questions, '', '--', `Fratius · ${tagline}`, 'https://fratius.com · info@fratius.com · https://fratius.com/impressum', '', why,
  ].join('\n');

  const rtl = lang === 'ar' || lang === 'fa';
  const e = escHtml;
  const font = "font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans',Arial,sans-serif";
  const html = `<!doctype html><html lang="${e(lang)}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#ECEEF1;color:#000;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:2px solid #000;border-radius:4px">
<tr><td style="background:#E2FF1C;border-bottom:2px solid #000;padding:16px 24px;font-size:24px;font-weight:700;letter-spacing:.01em" translate="no">Fratius</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.55">
<p style="margin:0 0 12px">${e(hello)}</p>
<p style="margin:0 0 20px">${e(intro)}</p>
<p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#565C66">${e(sentTitle)}</p>
<ul style="margin:0 0 20px;padding-${rtl ? 'right' : 'left'}:20px">${sent.map((x) => `<li>${e(x)}</li>`).join('')}</ul>
<p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#565C66">${e(nextTitle)}</p>
<ol style="margin:0 0 20px;padding-${rtl ? 'right' : 'left'}:20px">${next.map((x) => `<li style="margin:0 0 4px">${e(x)}</li>`).join('')}</ol>
<p style="margin:0">${e(questions)}</p>
</td></tr>
<tr><td style="border-top:2px solid #000;padding:14px 24px;font-size:13px;line-height:1.5;color:#565C66">
<span translate="no">Fratius</span> · ${e(tagline)}<br><a href="https://fratius.com" style="color:#000">fratius.com</a> · <a href="mailto:info@fratius.com" style="color:#000">info@fratius.com</a> · <a href="https://fratius.com/impressum" style="color:#000">Impressum</a>
<p style="margin:10px 0 0;font-size:12px">${e(why)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
