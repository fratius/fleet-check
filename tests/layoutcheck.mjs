// The layout check of the blind test, 26 Nov 2026, cause 4: run inside a page of the web app (page.evaluate), it says
// what a person at phone width would see wrong. Used by tests/layout.e2e.mjs on every main screen in every language.
//   - offPage: the page is wider than the screen (the app pushed off it: Arabic and Persian were 10,000 px wide).
//   - offEdge: text of the app that runs past the screen's edge (not inside a list that scrolls sideways).
//   - cut: a text of the app (one of its translations) cut short: an ellipsis, or clipped by its box; a search box
//     whose hint doesn't fit.
//   - tiny: a text of the app drawn smaller than 10 px (the phones' own tab bars use 10 pt for their names).
//   - english: an English text of the app on a screen in another language, where that language has its own.
//   - broken: a word of the app's own texts broken in the middle across two lines ("Versicherungsverlängerung" in a
//     badge; names may break, they are data).
//   - comma: in Arabic and Persian, a list joined with the Latin comma "," instead of "،".
// Names, plates and other data people typed aren't checked for being cut (a long name may end in "…" on a list).

/** `dict`: the language's texts (public/i18n/<code>.json), `lang` its code. Returns the problems found. */
export function layoutProblems({ dict, lang }) {
  const W = window.innerWidth;
  const problems = [];
  const say = (kind, text, extra = '') => problems.push(`${kind}: "${String(text).replace(/\s+/g, ' ').trim().slice(0, 70)}"${extra ? ` (${extra})` : ''}`);
  // The app's own texts in this language, and the English ones that have their own words here.
  const own = new Set();
  const english = new Set();
  for (const [k, v] of Object.entries(dict || {})) {
    const forms = typeof v === 'string' ? [v] : Object.values(v || {});
    for (const f of forms) if (typeof f === 'string' && !/\{/.test(f)) own.add(f.trim());
    if (lang !== 'en' && !/\{/.test(k) && typeof v === 'string' && v.trim() !== k.trim() && k.trim().length > 3) english.add(k.trim());
  }
  // The words of the app's own texts (six letters or more), to tell a broken word of the app from a broken name.
  const words = new Set();
  for (const v of Object.values(dict || {})) {
    for (const f of typeof v === 'string' ? [v] : Object.values(v || {})) {
      if (typeof f === 'string') for (const w of f.replace(/\{\w+\}/g, ' ').match(/\p{L}{6,}/gu) || []) words.add(w);
    }
  }
  const rtl = document.documentElement.dir === 'rtl';
  // How wide a text is on its own line in the same font: to tell a size worked out too big from a box too small.
  const widthOf = (text, s) => {
    const sp = document.createElement('span');
    Object.assign(sp.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', whiteSpace: 'pre', font: s.font, letterSpacing: s.letterSpacing });
    sp.textContent = text;
    document.body.appendChild(sp);
    const w = sp.getBoundingClientRect().width;
    sp.remove();
    return w;
  };
  const visible = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      if (e.getAttribute('aria-hidden') === 'true') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight * 3;
  };
  // Inside something that scrolls sideways on purpose (a table, a row of chips): its own edge counts, not the screen's.
  const sideways = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
    }
    return false;
  };
  if (document.documentElement.scrollWidth > W + 1 || document.body.scrollWidth > W + 1) {
    say('offPage', `page ${Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)} px wide on a ${W} px screen`);
  }
  const seen = new Set();
  const walker = document.createTreeWalker(document.getElementById('root') || document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const whole = el.textContent.trim();
    const r = el.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !sideways(el)) say('offEdge', whole, `${Math.round(r.left)}–${Math.round(r.right)} px`);
    if (english.has(whole)) say('english', whole);
    if (rtl && /, /.test(n.textContent)) say('comma', whole);
    // A word of the app broken across lines: its letters sit on two lines.
    for (const m of n.textContent.matchAll(/\p{L}{6,}/gu)) {
      if (!words.has(m[0])) continue;
      const range = document.createRange();
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
      if (rects.length < 2) continue;
      const tops = rects.map((x) => x.top);
      if (Math.max(...tops) - Math.min(...tops) > Math.min(...rects.map((x) => x.height)) / 2) {
        const s = getComputedStyle(el);
        say('broken', whole, `"${m[0]}" on two lines: ${Math.round(widthOf(m[0], s))} px wide in ${el.clientWidth} px, ${s.fontSize} ${s.fontFamily.split(',')[0]}`);
      }
    }
    // Only the app's own texts are checked for size and cuts (names, plates and what people typed may end in "…").
    if (!own.has(whole)) continue;
    const s = getComputedStyle(el);
    if (parseFloat(s.fontSize) < 10) say('tiny', whole, `${s.fontSize}`);
    const clipped = (s.textOverflow === 'ellipsis' || s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1;
    if (clipped) {
      // What it was drawn in, to tell a size worked out wrong from a font that didn't load.
      const family = s.fontFamily.split(',')[0].trim().replace(/["']/g, '');
      const font = document.fonts && !document.fonts.check(`${s.fontSize} "${family}"`) ? ', font not loaded' : '';
      say('cut', whole, `${el.scrollWidth} px in ${el.clientWidth} px, ${s.fontSize} ${family}${font}; on its own ${Math.round(widthOf(whole, s))} px`);
    }
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) say('cut', whole, 'lines cut');
  }
  // Search boxes and other fields: the hint must fit.
  const ctx = document.createElement('canvas').getContext('2d');
  for (const f of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!visible(f) || !f.placeholder) continue;
    const s = getComputedStyle(f);
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const room = f.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const need = ctx.measureText(f.placeholder).width;
    if (f.tagName === 'INPUT' && need > room + 1) say('cut', f.placeholder, `search box hint ${Math.round(need)} px in ${Math.round(room)} px`);
    if (lang !== 'en' && english.has(f.placeholder.trim())) say('english', f.placeholder);
    const r = f.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !sideways(f)) say('offEdge', f.placeholder, 'field');
  }
  // Screen reader labels of buttons (the header's back button said "back" in every language).
  for (const b of document.querySelectorAll('[aria-label]')) {
    const l = (b.getAttribute('aria-label') || '').trim();
    if (lang !== 'en' && visible(b) && (english.has(l) || /^back$/i.test(l))) say('english', l, 'screen reader label');
  }
  return [...new Set(problems)];
}
