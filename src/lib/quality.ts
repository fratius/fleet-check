/**
 * The photo check on the phone, right after a walk-around photo is taken: too dark, too bright, blurred, or a lot
 * of glare on the van. It runs without a connection (a small copy of the photo is decoded here, no server, no AI).
 *
 * It warns, it doesn't block: the driver sees what's wrong and is asked to take it again, and can use the photo
 * anyway (a dark yard at 6 am can't always be fixed, and a pick-up must not get stuck). What it warned about and
 * its measures are kept with the photo (Photo.q), so managers see it and the limits can be set from real photos.
 *
 * The limits below are a first guess and must be checked against the pilot companies' photos.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

import { N_ } from './i18n';
import type { PhotoQuality } from './types';

/** Width of the copy that is measured (a phone photo is about 3000 px: 1 px here is about 5 there). */
const SIZE = 640;
export const LIMITS = {
  /** Average brightness (0-255) below which a photo is too dark, above which too bright. */
  dark: 50,
  bright: 232,
  /** Edge strength (the strongest 1 % of the image's edges) below which it's blurred. */
  blur: 18,
  /** Share of the middle of the photo that is pure white. */
  glare: 0.25,
};

/** Measures one photo. Null when it couldn't be read (the photo is used as it is; the reason goes to the console). */
export async function checkPhoto(uri: string): Promise<PhotoQuality | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    ctx.resize({ width: SIZE });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92, base64: true });
    if (!out.base64) return null;
    const raw = decode(fromBase64(out.base64), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
    return measure(raw.data, raw.width, raw.height);
  } catch (e) {
    console.warn('The photo check could not read the photo', e);
    return null;
  }
}

/** Brightness, edge strength and glare of an RGBA image, and what's wrong with it. */
export function measure(px: ArrayLike<number>, w: number, h: number): PhotoQuality {
  const Y = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, j = 0; i < Y.length; i++, j += 4) { const y = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; Y[i] = y; sum += y; }
  const light = sum / Y.length;
  // Glare: pure white in the middle of the photo, where the van is.
  let white = 0, mid = 0;
  for (let y = Math.floor(h * 0.15); y < h * 0.9; y++) for (let x = Math.floor(w * 0.1); x < w * 0.9; x++) { mid++; if (Y[y * w + x] >= 250) white++; }
  const glare = mid ? white / mid : 0;
  // Sharpness: how strong the strongest edges are, across and up separately (a blurred photo has none; a shaken one
  // keeps the edges along the shake, so the weaker direction counts). A white van still has its seams and wheels.
  const hx = new Uint32Array(511), hy = new Uint32Array(511);
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      hx[Math.min(510, Math.round(Math.abs(2 * Y[i] - Y[i - 1] - Y[i + 1])))]++;
      hy[Math.min(510, Math.round(Math.abs(2 * Y[i] - Y[i - w] - Y[i + w])))]++;
      count++;
    }
  }
  const top = (hist: Uint32Array) => {
    let need = Math.max(1, Math.round(count * 0.01)), acc = 0, n = 0;
    for (let v = 510; v >= 0 && need > 0; v--) { const k = Math.min(hist[v], need); acc += k * v; n += k; need -= k; }
    return n ? acc / n : 0;
  };
  const sharp = Math.min(top(hx), top(hy));
  const issues: PhotoQuality['issues'] = [];
  if (light < LIMITS.dark) issues.push('dark');
  else if (light > LIMITS.bright) issues.push('bright');
  else if (glare > LIMITS.glare) issues.push('glare');
  if (sharp < LIMITS.blur && light >= LIMITS.dark) issues.push('blur');
  return { issues, light: Math.round(light), sharp: Math.round(sharp * 10) / 10, glare: Math.round(glare * 1000) / 1000 };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => { const t = new Uint8Array(256); for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i; return t; })();
/** Base64 to bytes, without Node's Buffer (not in the phone app). */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)], b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)] : 0, d = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)] : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/** What to tell the driver, per issue: shown with t(). */
export const ISSUE_TEXT: Record<PhotoQuality['issues'][number], string> = {
  dark: N_('Too dark to see damage. Turn on the light, or take it where it\'s brighter.'),
  bright: N_('Too bright. Step aside so the sun or a lamp doesn\'t shine into the camera.'),
  glare: N_('Strong glare on the van. Step a little to the side and take it again.'),
  blur: N_('The photo is blurred. Hold the phone still and take it again.'),
};
