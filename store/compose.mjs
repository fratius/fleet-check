// Puts each store screenshot (tests/store-shots.mjs) under its caption (store/captions.json), on the brand yellow,
// at the sizes the stores take:
//   ios-6.9   1320 x 2868  App Store, iPhone 6.9" (iPhone 17 Pro Max class)
//   ios-6.3   1206 x 2622  App Store, iPhone 6.3" (iPhone 17 class)
//   play      1080 x 2160  Google Play phone (at most 2:1)
// JPEG, no transparency (the App Store refuses alpha).
//   node store/compose.mjs <folder with en/ and de/ raw screenshots> <output folder>
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
// The Playwright installed on this computer (with its browser), else the tests' copy.
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { ({ chromium } = createRequire(join(ROOT, 'tests/package.json'))('playwright')); }

const [, , RAW, OUT] = process.argv;
if (!RAW || !OUT) { console.error('Usage: node store/compose.mjs <raw shots> <output>'); process.exit(1); }
const captions = JSON.parse(readFileSync(join(ROOT, 'store/captions.json'), 'utf8'));
const SIZES = { 'ios-6.9': [1320, 2868], 'ios-6.3': [1206, 2622], play: [1080, 2160] };
const FONTS = join(ROOT, 'website/fonts');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function page(W, H, title, sub, shot) {
  // Everything in units of the width, so the three sizes look alike; the screenshot takes what height is left.
  const u = W / 100;
  const top = 9 * u, titleSize = 8.6 * u, subSize = 3.7 * u, gap = 5.5 * u, bottom = 5 * u;
  const textH = top + titleSize * 2 * 1.02 + 2.2 * u + subSize * 2 * 1.3 + gap;
  const shotH = Math.min(H - textH - bottom, (W * 0.8) * (2868 / 1320));
  const shotW = shotH * (1320 / 2868);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:BC;font-weight:700;src:url(file://${FONTS}/barlow-condensed-latin-700-normal.woff2)}
@font-face{font-family:BC;font-weight:700;src:url(file://${FONTS}/barlow-condensed-latin-ext-700-normal.woff2);unicode-range:U+0100-02BA,U+1E00-1EFF}
@font-face{font-family:B;font-weight:500;src:url(file://${FONTS}/barlow-latin-500-normal.woff2)}
@font-face{font-family:B;font-weight:500;src:url(file://${FONTS}/barlow-latin-ext-500-normal.woff2);unicode-range:U+0100-02BA,U+1E00-1EFF}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#E2FF1C;color:#000}
.t{position:absolute;left:${6 * u}px;right:${6 * u}px;top:${top}px;text-align:center}
h1{font:700 ${titleSize}px/1.02 BC;margin:0 0 ${2.2 * u}px;letter-spacing:-.01em;text-wrap:balance}
p{font:500 ${subSize}px/1.3 B;margin:0 auto;max-width:${82 * u}px;text-wrap:balance}
.s{position:absolute;left:${(W - shotW) / 2}px;top:${textH}px;width:${shotW}px;height:${shotH}px;border:${0.9 * u}px solid #000;border-radius:${5.5 * u}px;overflow:hidden;box-sizing:content-box;margin-left:-${0.9 * u}px;background:#fff}
.s img{width:100%;height:100%;display:block}
</style></head><body><div class="t"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="s"><img src="file://${shot}"></div></body></html>`;
}

const browser = await chromium.launch();
let n = 0;
for (const lang of ['en', 'de']) {
  for (const [size, [W, H]] of Object.entries(SIZES)) {
    const dir = join(OUT, size, lang);
    mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    let i = 0;
    for (const key of captions.order) {
      const raw = join(RAW, lang, `${key}.png`);
      if (!existsSync(raw)) { console.log(`missing ${lang}/${key}`); continue; }
      const [title, sub] = captions[lang][key];
      await pg.setContent(page(W, H, title, sub, raw), { waitUntil: 'load' });
      await pg.evaluate(() => document.fonts.ready);
      await pg.screenshot({ path: join(dir, `${String(++i).padStart(2, '0')}-${key.slice(3)}.jpg`), type: 'jpeg', quality: 90 });
      n++;
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${n} images in ${OUT}`);
