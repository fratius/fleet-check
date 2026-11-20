import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';

import { newId, putBlob } from './images';
import { retrying, setWaiting } from './net';

/**
 * Adding the whole fleet from a file (functions/src/fleetfile.ts): picking the fleet list and uploading it for the
 * server to read. The server deletes it straight after reading. Excel, CSV and PDF files; photos of a printed list
 * go through the image picker and `upload()` (lib/images.ts) like every other photo.
 */

/** What the system file picker offers: spreadsheets, CSV and PDF (and photos, on the web). */
const TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values',
  'text/plain', 'text/tab-separated-values', 'application/csv', 'application/pdf',
];
/** The type the upload is stored with (storage.rules takes only these); the server goes by the file's first bytes. */
export function mimeOf(name: string, given?: string | null): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const byExt: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv', txt: 'text/plain',
    tsv: 'text/tab-separated-values', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
  };
  if (byExt[ext]) return byExt[ext];
  if (given && (TYPES.includes(given) || given.startsWith('image/'))) return given;
  return 'application/octet-stream';
}

/** `uri` opens it on this phone or browser (photos go through prepare() first). */
export interface Picked { name: string; mime: string; blob: Blob; size: number; uri: string }

/** Opens the file picker. Null when the person closed it without choosing. */
export async function pickFleetFile(): Promise<Picked | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv,.txt,.tsv,.pdf,image/*,' + TYPES.join(',');
      input.onchange = () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, mime: mimeOf(f.name, f.type), blob: f, size: f.size, uri: URL.createObjectURL(f) } : null);
      };
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
  // expo-file-system's picker (already in the app and in Expo Go: no new native package, so no new store build).
  const r = await FsFile.pickFileAsync({ mimeTypes: [...TYPES, 'image/*'] });
  if (r.canceled || !r.result) return null;
  const f = r.result;
  const blob = await fetch(f.uri).then((x) => x.blob());
  return { name: f.name || 'fleet', mime: mimeOf(f.name || '', f.type), blob, size: blob.size, uri: f.uri };
}

/** Uploads the fleet list to the person's own folder; tries again by itself without a connection. */
export async function uploadFleetFile(orgId: string, uid: string, p: Picked): Promise<string> {
  const ext = (p.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  const path = `orgs/${orgId}/imports/${uid}/${newId()}.${ext}`;
  let tried = false;
  const key = `u:${path}`;
  await retrying(async () => {
    const again = tried;
    tried = true;
    await putBlob(p.blob, path, p.mime, { again, onStall: (on) => setWaiting(key, on) });
  }).finally(() => setWaiting(key, false));
  return path;
}

/** Where the person's photos of a printed list go (uploaded with upload() in lib/images.ts). */
export const importPhotoPath = (orgId: string, uid: string, batch: string, n: number) => `orgs/${orgId}/imports/${uid}/${batch}-${n}.jpg`;
