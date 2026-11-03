// Where the web app is, for the app's invite links (config/web): https://app.fratius.com once that domain is connected
// to the app's Hosting site (Firebase console > Hosting > the default site > Add custom domain) and serves the app,
// the project's own address (https://PROJECT.web.app) until then. Run by Deploy; prints which one it found.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const project = process.env.PROJECT || process.env.GCLOUD_PROJECT;
const domain = (process.env.APP_DOMAIN || 'app.fratius.com').trim();

/** The domain answers with this app (not a parking page or an error): its page loads the app's own script. */
async function servesApp(url) {
  try {
    const r = await fetch(url + '/', { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return r.ok && (await r.text()).includes('/_expo/static/js/web/');
  } catch { return false; }
}

(async () => {
  if (!project) throw new Error('PROJECT is not set.');
  const custom = `https://${domain}`;
  const url = (await servesApp(custom)) ? custom : `https://${project}.web.app`;
  initializeApp({ projectId: project });
  const ref = getFirestore().doc('config/web');
  const cur = (await ref.get()).data() || {};
  if (cur.url !== url) await ref.set({ url, updatedAt: Date.now() });
  console.log(url === custom ? `The web app is at ${custom}.` : `${custom} doesn't serve the app yet; invite links use ${url}.`);
  if (process.env.GITHUB_OUTPUT) require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\nlive=${url === custom}\n`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
