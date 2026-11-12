import sharp from 'sharp';

/** Claude's image limits for the 4.7+ models: long edge up to 2576 px and at most 4784 image tokens (28 x 28 px each). */
export const MAX_EDGE = 2576;
export const MAX_TOKENS = 4784;
export const imageTokens = (w: number, h: number) => Math.ceil(w / 28) * Math.ceil(h / 28);

export interface Sent { data: string; w: number; h: number; tokens: number }

/** Scales a photo to the largest size that fits the token budget, so the model sees as much detail as it can take. */
export async function fit(buf: Buffer, maxTokens = MAX_TOKENS, maxEdge = MAX_EDGE): Promise<Sent> {
  const img = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  let w = meta.autoOrient?.width || meta.width || 0, h = meta.autoOrient?.height || meta.height || 0;
  if (!w || !h) throw new Error('Unreadable image');
  let s = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt((maxTokens * 784) / (w * h)));
  let tw = Math.max(1, Math.floor(w * s)), th = Math.max(1, Math.floor(h * s));
  while (imageTokens(tw, th) > maxTokens) { s *= 0.99; tw = Math.floor(w * s); th = Math.floor(h * s); }
  const out = await img.resize(tw, th, { fit: 'fill' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return { data: out.toString('base64'), w: tw, h: th, tokens: imageTokens(tw, th) };
}

type Box = [number, number, number, number];

function boxSvg(W: number, H: number, x: number, y: number, w: number, h: number, lw: number) {
  const r = (v: number) => Math.round(v * 10) / 10;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="none" stroke="#000" stroke-width="${r(lw * 2.2)}" stroke-linejoin="round"/>`
    + `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="none" stroke="#E2FF1C" stroke-width="${r(lw)}" stroke-linejoin="round"/></svg>`);
}

/** A 4:3 crop around the spot from the full-size photo, 960 px wide, with the spot boxed in yellow. */
export async function refCrop(buf: Buffer, box: Box): Promise<Buffer> {
  const base = sharp(buf, { failOn: 'none' }).rotate();
  const { data, info } = await base.toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const bx = box[0] * W, by = box[1] * H, bw = (box[2] - box[0]) * W, bh = (box[3] - box[1]) * H;
  let cw = Math.max(bw * 3, ((bh * 3) * 4) / 3, Math.min(W, H) * 0.32), ch = (cw * 3) / 4;
  cw = Math.min(cw, W); ch = Math.min(ch, H);
  const cx = Math.max(0, Math.min(W - cw, bx + bw / 2 - cw / 2)), cy = Math.max(0, Math.min(H - ch, by + bh / 2 - ch / 2));
  const out = 960, k = out / cw, oh = Math.round(ch * k), pad = 8;
  const crop = await sharp(data).extract({ left: Math.round(cx), top: Math.round(cy), width: Math.max(1, Math.round(cw)), height: Math.max(1, Math.round(ch)) })
    .resize(out, oh, { fit: 'fill' }).toBuffer();
  return sharp(crop).composite([{ input: boxSvg(out, oh, (bx - cx) * k - pad, (by - cy) * k - pad, bw * k + pad * 2, bh * k + pad * 2, 4), top: 0, left: 0 }])
    .jpeg({ quality: 86 }).toBuffer();
}

/**
 * The number plate cut out of the full-size photo, for a second, closer read. The box comes from the type scan, which
 * saw the photo at about 2,000 image tokens, so it's taken generously: at least twice the plate's width and a fifth of
 * the photo's width, at least four times its height and a third of the crop's width. Scaled to 1,000 px wide, so the
 * model gets the characters large (about 450 to 1,000 image tokens).
 */
export async function plateCrop(buf: Buffer, box: Box): Promise<Buffer> {
  const { data, info } = await sharp(buf, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const bw = (box[2] - box[0]) * W, bh = (box[3] - box[1]) * H;
  const cw = Math.min(W, Math.max(bw * 2, W * 0.2)), ch = Math.min(H, Math.max(bh * 4, cw / 3));
  const cx = Math.max(0, Math.min(W - cw, box[0] * W + bw / 2 - cw / 2)), cy = Math.max(0, Math.min(H - ch, box[1] * H + bh / 2 - ch / 2));
  const left = Math.round(cx), top = Math.round(cy);
  const width = Math.max(1, Math.min(W - left, Math.round(cw))), height = Math.max(1, Math.min(H - top, Math.round(ch)));
  return sharp(data).extract({ left, top, width, height }).resize({ width: 1000 }).jpeg({ quality: 92 }).toBuffer();
}

/** The whole photo, at most 1400 px wide, with a box drawn on it. Used to mark damage on a close-up. */
export async function markBox(buf: Buffer, box: Box): Promise<Buffer> {
  const { data, info } = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1400, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  return sharp(data).composite([{ input: boxSvg(W, H, box[0] * W, box[1] * H, (box[2] - box[0]) * W, (box[3] - box[1]) * H, Math.max(3, W / 260)), top: 0, left: 0 }])
    .jpeg({ quality: 86 }).toBuffer();
}
