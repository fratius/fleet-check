import { tr } from './i18n';
import { esc, footerText, frame, rtlOf } from './payments';

/**
 * Where drivers get the phone app. Keep in step with the website (`CONFIG.stores` in website/index.html) and the app
 * (src/lib/stores.ts): once Fratius is in Google Play, set GOOGLE_PLAY here too.
 */
export const APP_STORE = 'https://apps.apple.com/app/id6829174647';
export const GOOGLE_PLAY: string | null = null;
export const ANDROID_TEST = 'https://fratius.com/android';
export const androidUrl = () => GOOGLE_PLAY || ANDROID_TEST;

/**
 * The welcome email to a driver who signed up with the company's driver link (product owner, 2026-11-24): what they
 * asked for, that a fleet manager or the owner approves them (they get a notification), and where to get the app.
 * Sent once per request, in the language the sign-up page was in.
 */
export function joinMail(o: { lang: string; name: string; company: string; station: string; email: string; appUrl: string }) {
  const { lang } = o;
  const subject = tr(lang, 'Welcome to Fratius: your request to join {company}', { company: o.company });
  const hello = tr(lang, 'Hi {name},', { name: o.name });
  const lines = [
    tr(lang, 'You asked to join {company} as a driver at {station}.', { company: o.company, station: o.station }),
    tr(lang, 'A fleet manager of your station or the owner approves you. You get a notification, and Fratius opens your station once you\'re in.'),
  ];
  const get = tr(lang, 'Get the Fratius app now, so it\'s ready when you\'re approved:');
  const apps = [['iPhone', APP_STORE], ['Android', androidUrl()], [tr(lang, 'In the browser'), o.appUrl]];
  const login = tr(lang, 'Sign in with {email} and the password you chose.', { email: o.email });
  const forgot = tr(lang, 'Forgot the password? Tap "Forgot your password?" on the sign-in screen.');
  const ask = tr(lang, 'Questions about your request? Ask your fleet manager.');
  const notYou = tr(lang, 'Didn\'t sign up for Fratius? Just ignore this email.');
  const text = [
    hello, '', ...lines, '', get, ...apps.map(([l, u]) => `- ${l}: ${u}`), '', login, forgot, '', ask, notYou, '', ...footerText(lang),
  ].join('\n');
  const side = rtlOf(lang) ? 'right' : 'left';
  const html = frame(lang, subject, `<p style="margin:0 0 12px">${esc(hello)}</p>
${lines.map((x) => `<p style="margin:0 0 12px">${esc(x)}</p>`).join('\n')}
<p style="margin:0 0 6px">${esc(get)}</p>
<ul style="margin:0 0 20px;padding-${side}:20px">${apps.map(([l, u]) => `<li style="margin:0 0 4px"><a href="${esc(u)}" style="color:#000;font-weight:600">${esc(l)}</a></li>`).join('')}</ul>
<p style="margin:0 0 6px">${esc(login)}</p>
<p style="margin:0 0 20px">${esc(forgot)}</p>
<p style="margin:0 0 6px">${esc(ask)}</p>
<p style="margin:0;color:#565C66">${esc(notYou)}</p>`);
  return { subject, text, html };
}
