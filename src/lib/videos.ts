import * as ImagePicker from 'expo-image-picker';
import { doc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { Platform } from 'react-native';

import { fb } from './firebase';
import { newId } from './images';
import type { Assignment, Station, Video, Walkaround } from './types';

export interface Recorded { uri: string; mime: string; ext: string; size: number | null; file?: File }

/** Opens the camera to record one video (on the web: the phone's camera through the browser). Null if cancelled. */
export async function recordVideo(): Promise<Recorded | null> {
  if (Platform.OS !== 'web') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('camera');
  }
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 300, quality: 1 });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const name = (a.fileName || a.uri).toLowerCase();
  const mime = a.mimeType && a.mimeType.startsWith('video/') ? a.mimeType
    : name.endsWith('.mp4') || name.endsWith('.m4v') ? 'video/mp4' : name.endsWith('.webm') ? 'video/webm' : 'video/quicktime';
  const ext = mime === 'video/mp4' ? 'mp4' : mime === 'video/webm' ? 'webm' : mime === 'video/quicktime' ? 'mov' : (mime.split('/')[1] || 'mov').replace(/[^a-z0-9]/g, '').slice(0, 5);
  return { uri: a.uri, mime, ext, size: a.fileSize ?? a.file?.size ?? null, file: a.file };
}

/** Uploads the recording as it is (the server makes the playback copy). Returns the video id. */
export async function uploadVideo(orgId: string, uid: string, v: Recorded, onProgress: (sent: number, total: number) => void): Promise<string> {
  const f = fb();
  if (!f) throw new Error('Firebase is not configured');
  const id = newId();
  const blob: Blob = v.file ?? (await (await fetch(v.uri)).blob());
  const task = uploadBytesResumable(ref(f.storage, `orgs/${orgId}/videos/${uid}/${id}/original.${v.ext}`), blob, { contentType: v.mime });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (s) => onProgress(s.bytesTransferred, s.totalBytes), reject, () => resolve());
  });
  return id;
}

/** One video record, live; null when it isn't there or can't be read. */
export function watchVideo(orgId: string, id: string, cb: (v: Video | null) => void) {
  return onSnapshot(doc(fb()!.db, 'orgs', orgId, 'videos', id), (d) => cb(d.exists() ? ({ id: d.id, ...(d.data() as Omit<Video, 'id'>) }) : null), () => cb(null));
}

export const mb = (bytes: number | null | undefined) => (bytes ? `${(bytes / 1048576).toFixed(bytes > 10 * 1048576 ? 0 : 1)} MB` : '');

/**
 * The photos or video of each end of a handover, including ones added afterwards (they point to the handover):
 * the driver's pick-up photos or video for a van a manager gave them, or a video added later.
 */
export function handoverMedia(a: Assignment, videos: Video[], walks: Walkaround[] = []) {
  const end = (kind: 'pickup' | 'dropoff', walkId: string | null | undefined, videoId: string | null | undefined) => {
    const v = videos.find((x) => x.assignmentId === a.id && x.kind === kind) || null;
    const w = walks.find((x) => x.handover?.assignmentId === a.id && x.handover.kind === kind) || null;
    const added = !walkId && !videoId;
    return {
      walkId: walkId || w?.id || null,
      videoId: videoId || v?.id || null,
      late: added && !!(v?.late || w?.handover?.late),
    };
  };
  return { start: end('pickup', a.startWalkId, a.startVideoId), end: end('dropoff', a.endWalkId, a.endVideoId) };
}

/** A van given by a manager or owner whose driver hasn't taken the pick-up photos or video yet. */
export function needsPickup(a: Assignment, videos: Video[], walks: Walkaround[]) {
  if (!a.pickupRequested) return false;
  const m = handoverMedia(a, videos, walks).start;
  return !m.walkId && !m.videoId;
}
/** How long the driver has for the pick-up photos or video before the manager is told. */
export const PICKUP_GRACE_MS = 2 * 3600_000;

/** How long a driver can have a van at a pick-up-yourself station before the missing drop-off is flagged. */
export const OVERDUE_MS = 14 * 3600_000;
/** Ends that are the driver's job to film: they didn't drop it off (someone took over, or the manager ended it). */
const DRIVER_MISSED = new Set(['taken over', 'ended', 'reassigned']);

/** Is this ended handover missing the driver's drop-off video or photos (at a pick-up-yourself station)? */
export function noDropoff(a: Assignment, videos: Video[], walks: Walkaround[], stations: Station[]) {
  const st = stations.find((s) => s.id === a.stationId);
  if (!st?.selfAssign || a.end == null || !a.endReason || !DRIVER_MISSED.has(a.endReason)) return false;
  const m = handoverMedia(a, videos, walks);
  return !m.end.walkId && !m.end.videoId;
}
/** Has a driver had this van for longer than a shift without dropping it off (at a pick-up-yourself station)? */
export function stillOut(a: Assignment, stations: Station[]) {
  return a.end == null && Date.now() - a.start > OVERDUE_MS && !!stations.find((s) => s.id === a.stationId)?.selfAssign;
}

export interface Missing { a: Assignment; what: 'no-dropoff' | 'still-out' | 'no-pickup'; at: number }
/**
 * Handovers missing their photos or video, for the manager: a van given to a driver who hasn't taken the pick-up
 * photos or video after 2 hours (any station); and at stations where drivers pick up vans themselves, a van taken
 * over or ended without a drop-off, or a driver who has had it for more than 14 hours.
 */
export function missingHandovers(assignments: Assignment[], videos: Video[], walks: Walkaround[], stations: Station[], since: number): Missing[] {
  const selfStations = new Set(stations.filter((s) => s.selfAssign).map((s) => s.id));
  const out: Missing[] = [];
  for (const a of assignments) {
    if (needsPickup(a, videos, walks) && Date.now() - a.start > PICKUP_GRACE_MS && (a.end == null || a.end >= since)) {
      out.push({ a, what: 'no-pickup', at: a.start });
    }
    if (!a.stationId || !selfStations.has(a.stationId)) continue;
    const m = handoverMedia(a, videos, walks);
    if (a.end == null) {
      if (Date.now() - a.start > OVERDUE_MS) out.push({ a, what: 'still-out', at: a.start });
    } else if (a.end >= since && !m.end.walkId && !m.end.videoId && a.endReason && DRIVER_MISSED.has(a.endReason)) {
      out.push({ a, what: 'no-dropoff', at: a.end });
    }
  }
  return out.sort((x, y) => y.at - x.at);
}
