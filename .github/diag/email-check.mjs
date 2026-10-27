// Checks the website's email setup without printing secrets (this repository is public):
// the GitHub secret, the copy the live function uses, a real SMTP sign-in, a test email, and recent requests.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const gh = (process.env.SMTP_GH || '').trim();
const sm = (process.env.SMTP_SM || '').trim();
const out = [];
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
function describe(u) {
  try {
    const x = new URL(u);
    const user = decodeURIComponent(x.username);
    return { protocol: x.protocol, host: x.hostname, port: x.port || '(default)', user: user.replace(/^(.)[^@]*(@.*)$/, '$1…$2'),
      passwordLength: decodeURIComponent(x.password).length, passwordHasSpaces: /\s|%20/.test(x.password), userHasRawAt: /@/.test(x.username) };
  } catch (e) { return { notAValidUrl: String(e.message) }; }
}
out.push(`GitHub secret SMTP_URL: ${gh ? 'set' : 'MISSING'}`);
if (gh) out.push(`  ${JSON.stringify(describe(gh))}`);
out.push(`Live function's copy (Secret Manager): ${!sm ? 'not readable' : sm === 'none' ? '"none" (email off: Deploy ran before the GitHub secret existed)' : 'set'}`
  + `; same as the GitHub secret: ${gh && sm ? hash(gh) === hash(sm) : 'n/a'}`);
if (gh) {
  try {
    const t = nodemailer.createTransport(gh);
    await t.verify();
    out.push('SMTP sign-in: OK');
    const from = decodeURIComponent(new URL(gh).username);
    const info = await t.sendMail({ from: `Fratius website <${from}>`, to: 'info@fratius.com', subject: 'Fratius website: email test',
      text: `This is a test from the GitHub check (run ${process.env.GITHUB_RUN_ID}). If you can read it, the website can email you.` });
    out.push(`Test email to info@fratius.com: sent (${String(info.response).slice(0, 60)})`);
  } catch (e) {
    out.push(`SMTP failed: code=${e.code || '-'} responseCode=${e.responseCode || '-'} ${String(e.response || e.message).replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}
try {
  initializeApp({ projectId: process.env.PROJECT });
  const q = await getFirestore().collection('siteRequests').orderBy('createdAt', 'desc').limit(10).get();
  out.push(`Website requests stored: ${q.size} recent` + (q.size ? `; emailed: ${q.docs.filter((d) => d.data().mailed).length} of them; newest ${new Date(q.docs[0].data().createdAt).toISOString()}` : ''));
} catch (e) { out.push(`Requests: couldn't read (${String(e.message).slice(0, 120)})`); }
console.log(out.join('\n'));
for (const line of out) console.log(`::notice title=Email check::${line.replace(/\n/g, ' ')}`);
