/**
 * Handover videos: reading what a video is (length, when it was recorded, which phone) and making a playback copy
 * that plays everywhere. Phones' camera apps record HEVC, often HDR (iPhone), which doesn't play in every browser;
 * the copy is 720p H.264 with the HDR tone-mapped to normal colours and no location data. The app's own recorder
 * already records 720p H.264: that is only repackaged (seconds instead of a minute of conversion).
 */
import { spawn } from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';

const FFMPEG = ffmpegPath as unknown as string;

function run(args: string[], timeoutMs = 480_000): Promise<{ code: number; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 200_000) err = err.slice(-100_000); });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg took too long')); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, err }); });
  });
}

export interface Probe {
  durationMs: number;
  /** When the phone says it recorded the video (creation_time), if it says. */
  recordedAt: number | null;
  width: number;
  height: number;
  hdr: boolean;
  device: string | null;
  hasVideo: boolean;
  /** The video codec as ffmpeg names it (h264, hevc, ...). */
  codec: string | null;
}

/** Reads a video's header (ffmpeg -i prints it and stops). */
export async function probe(file: string): Promise<Probe> {
  const { err } = await run(['-hide_banner', '-i', file], 60_000);
  const dur = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationMs = dur ? Math.round(((+dur[1] * 60 + +dur[2]) * 60 + +dur[3]) * 1000) : 0;
  const created = err.match(/creation_time\s*:\s*([0-9T:\-.Z+]+)/);
  const recordedAt = created && !Number.isNaN(Date.parse(created[1])) ? Date.parse(created[1]) : null;
  const vline = err.split('\n').find((l) => /Stream #.*Video:/.test(l)) || '';
  const size = vline.match(/,\s*(\d{2,5})x(\d{2,5})/);
  // Phones store portrait video sideways with a rotation; report the size as it's shown.
  const rot = Math.abs(Number(err.match(/rotation of (-?[\d.]+) degrees/)?.[1] || err.match(/rotate\s*:\s*(-?\d+)/)?.[1] || 0));
  const turned = Math.round(rot) % 180 === 90;
  const make = err.match(/com\.apple\.quicktime\.make\s*:\s*(.+)/)?.[1]?.trim();
  const model = err.match(/com\.apple\.quicktime\.model\s*:\s*(.+)/)?.[1]?.trim() || err.match(/\bmodel\s*:\s*(.+)/)?.[1]?.trim();
  return {
    durationMs, recordedAt,
    width: size ? +size[turned ? 2 : 1] : 0, height: size ? +size[turned ? 1 : 2] : 0,
    hdr: /arib-std-b67|smpte2084/.test(vline),
    device: [make, model].filter(Boolean).join(' ').slice(0, 60) || null,
    hasVideo: !!vline,
    codec: vline.match(/Video:\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() || null,
  };
}

/** The shorter side at 720 px, keeping the phone's orientation (ffmpeg applies the rotation first). */
const SCALE = "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'";
const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

/** Already what the playback copy would be: H.264, at most 720p (short side), not HDR, at most about 4 Mbit/s. */
export function playsAsIs(p: Probe, bytes: number): boolean {
  const short = Math.min(p.width, p.height), long = Math.max(p.width, p.height);
  const mbit = p.durationMs ? (bytes * 8) / (p.durationMs / 1000) / 1e6 : Infinity;
  return p.codec === 'h264' && !p.hdr && short > 0 && short <= 720 && long <= 1280 && mbit <= 4.5;
}

/**
 * Makes the playback copy (H.264 720p, starts playing before it has fully loaded) and a poster frame. A video that
 * already plays everywhere (see playsAsIs) is only repackaged: same picture, without the phone's location and
 * other metadata.
 */
export async function makePlayback(input: string, outMp4: string, outJpg: string, hdr: boolean, asIs = false) {
  const vf = hdr ? `${SCALE},${TONEMAP},format=yuv420p` : `${SCALE},format=yuv420p`;
  const a = asIs
    ? await run(['-hide_banner', '-v', 'error', '-y', '-i', input, '-map_metadata', '-1', '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outMp4])
    : await run(['-hide_banner', '-v', 'error', '-y', '-i', input, '-map_metadata', '-1', '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '3M', '-bufsize', '6M',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outMp4]);
  if (a.code !== 0) throw new Error(`Converting the video failed: ${a.err.slice(-300)}`);
  const b = await run(['-hide_banner', '-v', 'error', '-y', '-ss', '1', '-i', outMp4, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outJpg]);
  if (b.code !== 0) throw new Error(`Making the poster failed: ${b.err.slice(-300)}`);
}
