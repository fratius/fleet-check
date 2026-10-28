// Fratius service worker: shows phone notifications (web push) and opens the app at the right page when one
// is tapped. It also keeps the app's own files (the page, its script, fonts, icons, translations), so the web app
// opens without a connection (the data comes from the phone's saved copy, src/lib/offline.ts). The page is always
// asked for online first, so a new version shows as soon as there's a connection.
const CACHE = 'fratius-app-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('fratius-app-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const same = (url) => url.origin === self.location.origin;
// The app's files: built once per version (their names change), so the kept copy is fine. (Icons keep their
// names across versions: asked online first, like everything else.)
const lasting = (url) => /^\/(_expo|assets|fonts)\//.test(url.pathname);
// Only the app's own page is kept: not a hotel or station Wi-Fi's sign-in page that answered instead.
const ourPage = (res) => res.ok && !res.redirected && res.type === 'basic' && /text\/html/.test(res.headers.get('content-type') || '');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!same(url) || url.pathname === '/sw.js' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) return;
  if (req.mode === 'navigate') {
    // The page: online first; without a connection the kept one (any address: the app finds the page itself).
    // A connection that is there but hardly works (a garage): after 4 s the kept page, and the new one is kept
    // for next time when it arrives.
    const online = fetch(req).then(async (res) => {
      if (ourPage(res)) { const c = await caches.open(CACHE); await c.put('/index.html', res.clone()); }
      return res;
    });
    e.waitUntil(online.catch(() => {}));
    e.respondWith((async () => {
      const kept = () => caches.match('/index.html');
      const slow = new Promise((r) => setTimeout(r, 4000)).then(kept);
      try {
        const first = await Promise.race([online, slow]);
        return first || (await online);
      } catch {
        return (await kept()) || Response.error();
      }
    })());
    return;
  }
  if (lasting(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
      return res;
    })());
    return;
  }
  // Everything else of the app's own (translations, the manifest): online first, the kept copy without a connection.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
      return res;
    } catch {
      return (await caches.match(req)) || Response.error();
    }
  })());
});

// The page tells which files it loaded (on the first visit, before this worker could see them): kept, and older
// versions' files dropped.
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'keep' || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const want = new Set();
    for (const u of d.urls) {
      try {
        const url = new URL(u, self.location.origin);
        if (!same(url) || url.pathname === '/sw.js') continue;
        want.add(url.href);
        if (!(await c.match(url.href))) { const res = await fetch(url.href); if (res.ok) await c.put(url.href, res); }
      } catch { /* kept next time */ }
    }
    if (!(await c.match('/index.html'))) { try { const res = await fetch('/'); if (ourPage(res)) await c.put('/index.html', res); } catch { /* next time */ } }
    // The scripts of older versions aren't needed any more.
    for (const r of await c.keys()) {
      const url = new URL(r.url);
      if (url.pathname.startsWith('/_expo/') && !want.has(url.href)) await c.delete(r);
    }
  })());
});

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Fratius', {
    body: m.body || '',
    tag: m.tag || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: m.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      await c.focus();
      if ('navigate' in c) await c.navigate(url).catch(() => {});
      return;
    }
    await self.clients.openWindow(url);
  })());
});
