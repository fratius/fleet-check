// The web build for the emulators, served like Hosting does (every page is the app), for the blind tester.
// Run: APP_DIR=dist-qa node qa/serve.mjs   (port 8099, or QA_PORT)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const APP_DIR = process.env.APP_DIR ? resolve(process.env.APP_DIR) : '';
const PORT = Number(process.env.QA_PORT || 8099);
if (!APP_DIR || !existsSync(join(APP_DIR, 'index.html'))) throw new Error('APP_DIR must be the web build (npx expo export -p web).');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  // Source maps aren't served: the tester sees the app, not its code.
  let f = join(APP_DIR, p);
  if (p.endsWith('.map') || !f.startsWith(APP_DIR) || !existsSync(f) || statSync(f).isDirectory()) f = join(APP_DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': p === '/sw.js' ? 'no-cache' : 'no-store' });
  createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`Web app on http://127.0.0.1:${PORT}`));
