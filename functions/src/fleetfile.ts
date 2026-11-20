/**
 * Adding the whole fleet from a file (product owner, 2026-11-20): an owner or a fleet manager uploads the fleet list
 * they already have (Excel, CSV, a PDF, or photos of a printed list) and every van in it is added at once, with the
 * details the file has. Nothing is saved until the person has checked the list (readFleetFile, then addVans in
 * index.ts).
 *
 * How a file is read:
 * - Excel (.xlsx) and CSV are opened here, in code, so a list of 1,000 vans is read whole and exactly. The AI only
 *   sees the first rows and a few values of each column, and says which column holds what (mapPrompt). The rows are
 *   then turned into van records here (buildRows), with the same clean-up as a document photo (documents.ts).
 * - A PDF or photos of a printed list: the AI copies the list into a table first (transcribePrompt), up to 300 vans
 *   per file, and the table goes the same way.
 * - The van type (which photo frames the driver gets) comes from the make and model: one AI question for each
 *   different model in the list (classPrompt), not one per van.
 *
 * This file has no Firebase in it, so tests/fleetfile.test.mjs runs it in plain Node.
 */
import { inflateRawSync } from 'node:zlib';

import { VAN_FIELDS, cleanFields, type Found } from './documents';

/* ---------- what a fleet file can fill in ---------- */

type Kind = 'text' | 'upper' | 'num' | 'day' | 'month' | 'choice' | 'multi' | 'phone' | 'long' | 'vin';
interface F { key: string; kind: Kind; what: string; options?: string[]; owner?: boolean; max?: number }

/** Everything a document photo can fill in, and notes. */
export const IMPORT_FIELDS: F[] = [
  ...(VAN_FIELDS as F[]).filter((f) => f.key !== 'emptyKg'),
  { key: 'emptyKg', kind: 'num', what: 'empty weight or mass in running order in kg; used to work out the payload' },
  { key: 'notes', kind: 'long', what: 'notes or remarks about the van', max: 1000 },
];
/** On the van, which everyone at its station reads (Vehicle in src/lib/types.ts). */
export const FACT_KEYS = ['vin', 'firstReg', 'modelYear', 'color', 'fuel', 'powerKw', 'gearbox', 'tankL', 'batteryKwh', 'rangeKm', 'lengthM', 'heightM',
  'grossKg', 'payloadKg', 'cargoM3', 'tyreSize', 'insurer', 'policyNo', 'claimsPhone', 'breakdownPhone'];
/** The business side, owners and the station's managers (vehicleDetails); `due.` keys go in its `due` map. */
export const DETAIL_KEYS = ['due.hu', 'due.uvv', 'due.service', 'due.serviceKm', 'due.tyres', 'due.tax', 'odometerKm', 'odometerAt', 'ownership',
  'provider', 'contractNo', 'start', 'end', 'kmPerYear', 'kmAtStart', 'included', 'contact', 'returnNotes', 'coverage', 'insuranceRenewal', 'fuelCard', 'notes'];
/** Money, owners only (vehicleCosts). */
export const COST_KEYS = ['monthly', 'purchasePrice', 'excessPerKm', 'premium', 'deductible'];

/** What a column can be besides a field: the van's own name or fleet number, its station, its make and model in one, its body type, who drives it, or nothing. */
export const META_KEYS = ['name', 'station', 'vehicle', 'body', 'driver', 'skip'] as const;

/** The fields this person may fill in: money only for owners (managers aren't even asked for it). */
export const fieldsFor = (owner: boolean) => IMPORT_FIELDS.filter((f) => !f.owner || owner);

/* ---------- opening the file ---------- */

export type FileKind = 'xlsx' | 'csv' | 'pdf' | 'image' | 'xls' | 'ods' | 'docx' | 'unknown';
/** Something about the file itself that stops it being read; index.ts says it in the person's words. */
export type Problem = 'xls' | 'ods' | 'docx' | 'unknown' | 'empty' | 'broken' | 'too-big';
export class FileProblem extends Error {
  problem: Problem;
  constructor(problem: Problem) { super(problem); this.problem = problem; }
}

/** What the file is, from its first bytes (a file name can lie, and phones often send none). */
export function sniff(b: Buffer): FileKind {
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const names = zipNames(b);
    if (names.includes('xl/workbook.xml')) return 'xlsx';
    if (names.includes('content.xml') && b.subarray(0, 120).toString('latin1').includes('opendocument.spreadsheet')) return 'ods';
    if (names.some((n) => n.startsWith('word/'))) return 'docx';
    return 'unknown';
  }
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image';
  if (b.subarray(4, 12).toString('latin1').match(/^ftyp(heic|heix|mif1|avif)/)) return 'image';
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0) return 'xls';
  return looksLikeText(b) ? 'csv' : 'unknown';
}
function looksLikeText(b: Buffer) {
  if (!b.length) return false;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return true;
  const s = b.subarray(0, 4000);
  let bad = 0;
  for (const c of s) if (c < 9 || (c > 13 && c < 32)) bad++;
  return bad / s.length < 0.01;
}

/** A table: a sheet of a workbook, a CSV, or what the AI copied from a PDF or photos. Rows are numbered from 1. */
export interface Table { name: string; rows: string[][] }

const MAX_ROWS = 5000;
const MAX_COLS = 60;

/* -- CSV -- */

/** Text in whatever the spreadsheet saved it as: UTF-8, UTF-16 (Excel's "Unicode text"), or Windows-1252. */
export function decodeText(b: Buffer): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) { const s = Buffer.from(b.subarray(2)); s.swap16(); return s.toString('utf16le'); }
  const u = b.toString('utf8');
  if (!u.includes('�')) return u;
  try { return new TextDecoder('windows-1252').decode(b); } catch { return b.toString('latin1'); }
}

/** The separator a CSV uses: the one that splits the first lines into the same number of columns most often. */
function separator(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, sep).length);
    const often = new Map<number, number>();
    for (const n of counts) often.set(n, (often.get(n) || 0) + 1);
    // The number of columns most lines have, and how many lines have it.
    const [mode, times] = [...often].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [0, 0];
    if (mode < 2) continue;
    const score = times * 100 + mode;
    if (score > bestScore) { best = sep; bestScore = score; }
  }
  return best;
}
const splitLine = (l: string, sep: string) => parseCsv(l, sep)[0] || [];

/** A CSV as rows of cells: quotes, doubled quotes and line breaks inside quotes. */
export function parseCsv(text: string, sep?: string): string[][] {
  const s = sep ?? separator(text);
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && !cell.trim()) { q = true; cell = ''; }
    else if (ch === s) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length >= MAX_ROWS) return rows.map(tidyRow);
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(tidyRow);
}
const tidyRow = (r: string[]) => r.slice(0, MAX_COLS).map((c) => c.replace(/\s+/g, ' ').trim());

export function readCsv(b: Buffer, name = 'CSV'): Table[] {
  const rows = parseCsv(decodeText(b));
  return rows.some((r) => r.some(Boolean)) ? [{ name, rows }] : [];
}

/* -- Excel (.xlsx): a zip of XML files, read without a library (as src/lib/xlsx.ts writes one) -- */

interface ZipEntry { name: string; method: number; csize: number; size: number; at: number }
function zipEntries(b: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new FileProblem('broken');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new FileProblem('broken');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32);
    const at = b.readUInt32LE(p + 42);
    out.push({ name: b.subarray(p + 46, p + 46 + nameLen).toString('utf8'), method, csize, size, at });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function zipNames(b: Buffer): string[] { try { return zipEntries(b).map((e) => e.name); } catch { return []; } }
function unzip(b: Buffer, e: ZipEntry): Buffer {
  if (e.size > 80 * 1024 * 1024) throw new FileProblem('too-big');
  const p = e.at;
  if (b.readUInt32LE(p) !== 0x04034b50) throw new FileProblem('broken');
  const start = p + 30 + b.readUInt16LE(p + 26) + b.readUInt16LE(p + 28);
  // The size from the central directory: the local header may leave it to a descriptor after the data.
  const data = b.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data.subarray(0, e.size));
  if (e.method === 8) { try { return inflateRawSync(data, { maxOutputLength: 80 * 1024 * 1024 }); } catch { throw new FileProblem('broken'); } }
  throw new FileProblem('broken');
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unxml(m[1]) : null; };
/** The text of every <t> in a piece of XML, without the phonetic guides (<rPh>) Japanese files carry. */
const texts = (x: string) => [...x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

/** Excel's built-in date formats (14 to 17, 22, and the East Asian ones) and any custom one with a day or a year. */
function dateFormat(id: number, code: string | undefined) {
  if ((id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
  if (!code) return false;
  // Without text in quotes, escaped characters and [colour] or [$€-407] parts: a day or a year means a date.
  return /[dy]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''));
}
/** An Excel date number as a day (YYYY-MM-DD). */
export function excelDay(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
/** Numbers as people typed them: no float noise (705.5, not 705.4999999). */
const numText = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function readXlsx(b: Buffer): Table[] {
  const entries = zipEntries(b);
  const get = (name: string) => { const e = entries.find((x) => x.name === name || x.name === name.replace(/^\//, '')); return e ? unzip(b, e).toString('utf8') : null; };
  const wb = get('xl/workbook.xml');
  if (!wb) throw new FileProblem('broken');
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), t = attr(m[0], 'Target');
    if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
  }
  const shared: string[] = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? texts(m[1]) : '');
  // Which cell styles show a number as a date.
  const styles = get('xl/styles.xml') || '';
  const codes = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) codes.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') || '');
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
  const isDate = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => { const id = Number(attr(m[0], 'numFmtId') || 0); return dateFormat(id, codes.get(id)); });

  const out: Table[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    if (attr(m[0], 'state') === 'hidden' || attr(m[0], 'state') === 'veryHidden') continue;
    const rid = attr(m[0], 'r:id') || [...m[0].matchAll(/\s[\w]+:id="([^"]*)"/g)][0]?.[1] || '';
    const path = target.get(rid);
    const xml = path ? get(path) : null;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rn = Number(attr(`<row${r[1]}>`, 'r')) || rows.length + 1;
      if (rn > MAX_ROWS) break;
      const cells: string[] = [];
      let next = 0;
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const ref = attr(tag, 'r');
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        if (ci >= MAX_COLS) continue;
        const body = c[2] || '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const type = attr(tag, 't');
        let text = '';
        if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = texts(body);
        else if (type === 'str' || type === 'e') text = v != null ? unxml(v) : '';
        else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (type === 'd') text = v ? unxml(v).slice(0, 10) : '';
        else if (v != null) {
          const n = Number(v);
          text = isDate[Number(attr(tag, 's') || 0)] ? excelDay(n, date1904) ?? numText(n) : Number.isFinite(n) ? numText(n) : unxml(v);
        }
        cells[ci] = text.replace(/\s+/g, ' ').trim();
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
      while (rows.length < rn - 1) rows.push([]);
      rows[rn - 1] = cells;
    }
    if (rows.some((x) => x.some(Boolean))) out.push({ name: attr(m[0], 'name') || `Sheet ${out.length + 1}`, rows });
  }
  return out;
}

/** Excel and CSV files as tables; a PDF or photos go to the AI first (transcribePrompt). */
export function readTables(b: Buffer, kind: FileKind, name?: string): Table[] {
  if (kind === 'xlsx') return readXlsx(b);
  if (kind === 'csv') return readCsv(b, name || 'CSV');
  if (kind === 'xls' || kind === 'ods' || kind === 'docx') throw new FileProblem(kind);
  throw new FileProblem('unknown');
}

/* ---------- the AI's three questions ---------- */

const NEVER = 'Never copy or use: PINs, full card numbers (only the last 4 digits), bank details, drivers\' birth dates, home addresses, licence or ID numbers, pay, health information.';

/** A PDF or photos of a printed list, copied into a table first. */
export function transcribePrompt(pages: number, pdf: boolean) {
  return `${pdf ? 'This PDF' : pages === 1 ? 'This photo' : `These ${pages} photos`} should show a list of vehicles of a delivery company (an Amazon delivery partner): a fleet list, a leasing or insurance schedule, or a printed table. A fleet app adds every vehicle in it.

Copy the list into one table:
- rows: the first row is the column headings as printed (in the document's language). Where the document has no headings, use short English ones like "Number plate", "Make and model", "VIN". Then one row per vehicle, every row with the same number of cells, in the same order as the headings.
- Copy each value exactly as printed (dates, numbers and plates as written), "" where a vehicle has nothing in that column. Join a vehicle's details that are spread over several lines into its one row.
- Leave out totals, page numbers, and anything that isn't a vehicle.
- At most 300 vehicles. If the document has more, stop after 300 and set more to true.
- readable: false if this isn't a list of vehicles or can't be read (blurred, cut off).
- notes: one short sentence on anything the person should know (a page cut off, a column you couldn't read), or null.

${NEVER} Leave such columns out of the table.`;
}
export const transcribeSchema = {
  type: 'object', additionalProperties: false, required: ['readable', 'rows', 'more', 'notes'],
  properties: {
    readable: { type: 'boolean' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    more: { type: 'boolean' },
    notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

const CHOICE_KEYS = (fields: F[]) => fields.filter((f) => f.kind === 'choice' || f.kind === 'multi');
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** What the AI sees of the tables: the first rows as they are, and a few different values of each column. */
export function preview(tables: Table[]): string {
  return tables.slice(0, 8).map((t, ti) => {
    const width = Math.min(MAX_COLS, Math.max(0, ...t.rows.map((r) => r.length)));
    const used = Array.from({ length: width }, (_, i) => i).filter((i) => t.rows.some((r) => r[i]));
    const first = t.rows.map((r, i) => ({ r, n: i + 1 })).filter((x) => x.r.some(Boolean)).slice(0, 14);
    const lines = first.map(({ r, n }) => `  row ${n}: ${used.filter((i) => r[i]).map((i) => `${colName(i)}=${JSON.stringify(clip(r[i], 40))}`).join(' | ')}`);
    const cols = used.map((i) => {
      const vals = [...new Set(t.rows.map((r) => r[i]).filter(Boolean))];
      return `  ${colName(i)}: ${vals.length} different, like ${vals.slice(0, 8).map((v) => JSON.stringify(clip(v, 30))).join(', ')}`;
    });
    return `Table ${ti + 1}, "${t.name}", ${t.rows.length} rows:\n${lines.join('\n')}\n Columns:\n${cols.join('\n')}`;
  }).join('\n\n');
}

/** Which table, which rows and which column holds what. */
export function mapPrompt(tables: Table[], fields: F[]) {
  const choices = CHOICE_KEYS(fields);
  return `A delivery company (an Amazon delivery partner, mostly in Germany) uploaded its fleet list to a fleet app, which will add every vehicle in it. Below is the start of each table in the file and a few values of each column. Say where the vehicles are and which column holds what.

${preview(tables)}

1. tables: one entry for each table above (table is its number). use: true if it lists vehicles, one per row. headerRow: the row number of the column headings, or null if there are none. firstRow: the first row with a vehicle. lastRow: the last row with a vehicle if rows after it are something else (totals, notes), else null. station: if the whole table belongs to one station, depot or site (the sheet's name or a title says so), its name, else null.
2. columns, for each table you use: each column (by its letter) and what it holds, one of:
   - plate: the number plate (Kennzeichen, amtl. Kennzeichen, Registration, Nr. de înmatriculare)
   - name: the company's own name or fleet number for the van (Fahrzeugnummer, Fleet no., Interne Nr.), not the plate
   - station: the station, depot, site or location the van belongs to (Station, Standort, Depot, Niederlassung, delivery station codes like DBE3)
   - make, model: the make, and the model on its own
   - vehicle: make and model together, or a vehicle description ("Mercedes-Benz Sprinter 316 CDI")
   - body: the body type or vehicle type (Kastenwagen hoch, panel van, Fahrzeugart)
   - driver: the person who drives it (only noted; vans aren't given to drivers from a file)
${fields.filter((f) => !['plate', 'make', 'model'].includes(f.key)).map((f) => `   - ${f.key}: ${f.what}`).join('\n')}
   - skip: anything else (and every column you aren't sure about)
   Use each key for one column at most, except skip. A column of full card numbers goes to fuelCard (the app keeps only the last 4 digits).
3. dates: "day-first" (31.03.2027, 31/03/2027) or "month-first" (03/31/2027) for how the file writes dates; "day-first" if you can't tell.
4. values: for the columns you gave one of these keys, how each of their values above is said in the app's words (from: the value as in the file, to: the app's word). Only values that differ from the app's word.
${choices.map((f) => `   - ${f.key}: ${f.options!.join(', ')}`).join('\n')}
5. notes: one short sentence on anything the person should know (two plate columns, vans spread over several tables), or null.

${NEVER} Such columns are skip.`;
}
export function mapSchema(fields: F[], tables: number) {
  const keys = ['plate', 'make', 'model', ...META_KEYS, ...fields.map((f) => f.key).filter((k) => !['plate', 'make', 'model'].includes(k))];
  const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });
  return {
    type: 'object', additionalProperties: false, required: ['tables', 'dates', 'values', 'notes'],
    properties: {
      tables: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['table', 'use', 'headerRow', 'firstRow', 'lastRow', 'station', 'columns'],
          properties: {
            table: { type: 'integer', minimum: 1, maximum: Math.max(1, tables) }, use: { type: 'boolean' },
            headerRow: nullable('integer'), firstRow: { type: 'integer' }, lastRow: nullable('integer'), station: nullable('string'),
            columns: {
              type: 'array',
              items: { type: 'object', additionalProperties: false, required: ['col', 'key'], properties: { col: { type: 'string' }, key: { type: 'string', enum: keys } } },
            },
          },
        },
      },
      dates: { type: 'string', enum: ['day-first', 'month-first'] },
      values: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['key', 'from', 'to'],
          properties: { key: { type: 'string', enum: CHOICE_KEYS(fields).map((f) => f.key) }, from: { type: 'string' }, to: { type: 'string' } },
        },
      },
      notes: nullable('string'),
    },
  };
}

export interface ColumnMap { col: string; key: string }
export interface TableMap { table: number; use: boolean; headerRow: number | null; firstRow: number; lastRow: number | null; station: string | null; columns: ColumnMap[] }
export interface Mapping { tables: TableMap[]; dates: 'day-first' | 'month-first'; values: { key: string; from: string; to: string }[]; notes: string | null }

/** The AI's answer, checked: known tables, columns A to BH, keys from the list, at most one column per key. */
export function cleanMapping(raw: unknown, fields: F[], tables: number): Mapping {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const keys = new Set<string>(['plate', 'make', 'model', ...META_KEYS, ...fields.map((f) => f.key)]);
  const choice = new Set(CHOICE_KEYS(fields).map((f) => f.key));
  const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const done = new Set<number>();
  const ts: TableMap[] = [];
  for (const t of list(o.tables)) {
    const table = int(t?.table);
    if (!table || table > tables || done.has(table)) continue;
    done.add(table);
    const columns = list(t.columns).map((c) => ({ col: String(c?.col || '').toUpperCase(), key: String(c?.key || '') }))
      .filter((c) => /^[A-Z]{1,2}$/.test(c.col) && keys.has(c.key) && colIndex(c.col) < MAX_COLS);
    ts.push({ table, use: t.use === true, headerRow: int(t.headerRow), firstRow: int(t.firstRow) || 1, lastRow: int(t.lastRow), station: str(t.station, 40), columns });
  }
  return {
    tables: ts,
    dates: o.dates === 'month-first' ? 'month-first' : 'day-first',
    values: list(o.values).map((v) => ({ key: String(v?.key || ''), from: String(v?.from || '').slice(0, 60), to: String(v?.to || '').toLowerCase().slice(0, 40) }))
      .filter((v) => choice.has(v.key) && v.from && v.to),
    notes: str(o.notes, 200),
  };
}

/** The van types the app knows (functions/src/prompts.ts and src/lib/frames.ts), with what fits each. */
export function classPrompt(descs: string[], classes: { id: string; desc: string }[]) {
  return `A delivery company's fleet list names these vehicles. For each, say its make, its model and the body class that decides which walk-around photo frames the driver gets in a fleet app.

${descs.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Body classes (answer with the id):
${classes.map((c) => `- ${c.id}: ${c.desc}`).join('\n')}

For each vehicle (n is its number above):
- make: the make as usually written (Mercedes-Benz, Ford, Volkswagen, Fiat, Renault, Peugeot, Opel, Citroën, Iveco), or null.
- model: the model's short name (Sprinter, eSprinter, Vito, Transit, Transit Custom, Crafter, e-Crafter, Ducato, Master, Daily, Vivaro, Boxer, Jumper), without engine or trim codes, or null.
- cls: the body class, or null if the text doesn't say enough (only a make, or a model with very different lengths and no length or wheelbase given: then the most common delivery version only if one clearly dominates, else null).
- roof: "high" for a raised roof (Hochdach, high roof, H2, H3), "low" for a standard roof, "unknown" if it doesn't say.`;
}
export function classSchema(classIds: string[]) {
  return {
    type: 'object', additionalProperties: false, required: ['types'],
    properties: {
      types: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['n', 'make', 'model', 'cls', 'roof'],
          properties: {
            n: { type: 'integer' }, make: { anyOf: [{ type: 'string' }, { type: 'null' }] }, model: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            cls: { anyOf: [{ type: 'string', enum: classIds }, { type: 'null' }] }, roof: { type: 'string', enum: ['high', 'low', 'unknown'] },
          },
        },
      },
    },
  };
}

/* ---------- the rows, as van records ---------- */

/** A plate as people write it: capitals, single spaces, "B-DX 1234". Null for anything that can't be a plate. */
export function tidyPlate(v: unknown): string | null {
  const p = typeof v === 'string' ? v.toUpperCase().replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim() : '';
  const k = plateKey(p);
  return k.length >= 2 && k.length <= 12 && p.length <= 14 && /\d/.test(k) ? p : null;
}
export const plateKey = (p: unknown) => (typeof p === 'string' ? p.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '') : '');

/** Only the last 4 digits of a card number are kept (the refuel card check needs no more). */
export function safeCard(v: string): string {
  const digits = v.replace(/\D/g, '');
  if (digits.length < 8) return v;
  const words = v.replace(/[\d\s*xX.-]{6,}/g, ' ').replace(/\s+/g, ' ').trim();
  return `${words ? words + ' ' : ''}…${digits.slice(-4)}`.trim();
}

export interface ImportRow {
  /** Where it is in the file: the table's name and the row number. */
  at: { table: string; row: number };
  plate: string;
  name: string | null;
  station: string | null;
  /** Make, model and body as the file writes them (the van type comes from this). */
  desc: string | null;
  make: string | null;
  model: string | null;
  /** The details, by field key, as they are stored (documents.ts: cleanFields). */
  values: Record<string, unknown>;
}
export interface Built {
  rows: ImportRow[];
  /** Lines with something in them but no plate (totals, headings repeated on each page, a van without a plate). */
  noPlate: number;
  /** The same plate twice: the later line filled in what the first one didn't have. */
  twice: number;
  /** Columns used, by key: the heading as in the file. */
  columns: { key: string; heading: string }[];
  /** A column of drivers was there (vans aren't given to drivers from a file). */
  drivers: boolean;
}

/** 03/31/2027 written month first, as 31/03/2027. */
const swapDay = (s: string) => s.replace(/^(\d{1,2})([./])(\d{1,2})\2(\d{2,4})$/, '$3$2$1$2$4');

export function buildRows(tables: Table[], map: Mapping, fields: F[]): Built {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const valueMap = new Map(map.values.map((v) => [`${v.key}\u0000${v.from.trim().toLowerCase()}`, v.to]));
  const out = new Map<string, ImportRow>();
  let noPlate = 0, twice = 0, drivers = false;
  const columns = new Map<string, string>();
  for (const tm of map.tables) {
    const t = tables[tm.table - 1];
    if (!tm.use || !t) continue;
    const cols = tm.columns.map((c) => ({ i: colIndex(c.col.toUpperCase()), key: c.key })).filter((c) => c.i >= 0 && c.i < MAX_COLS && c.key !== 'skip');
    const seen = new Set<string>();
    const use = cols.filter((c) => (c.key === 'driver' ? true : !seen.has(c.key) && !!seen.add(c.key)));
    if (!use.some((c) => c.key === 'plate')) continue;
    const head = tm.headerRow ? t.rows[tm.headerRow - 1] || [] : [];
    for (const c of use) if (!columns.has(c.key)) columns.set(c.key, head[c.i] || colName(c.i));
    if (use.some((c) => c.key === 'driver')) drivers = true;
    const plateCol = use.find((c) => c.key === 'plate')!;
    const first = Math.max(1, tm.firstRow || (tm.headerRow ? tm.headerRow + 1 : 1));
    const last = Math.min(t.rows.length, tm.lastRow || t.rows.length);
    for (let n = first; n <= last; n++) {
      const r = t.rows[n - 1] || [];
      if (!r.some(Boolean)) continue;
      const cell = (key: string) => { const c = use.find((x) => x.key === key); return c ? (r[c.i] || '').trim() : ''; };
      const rawPlate = r[plateCol.i] || '';
      // The headings again (a list printed over several pages).
      if (rawPlate && head[plateCol.i] && rawPlate === head[plateCol.i]) continue;
      const plate = tidyPlate(rawPlate);
      if (!plate) { noPlate++; continue; }
      const raw: { key: string; value: string; confidence: number; evidence: string }[] = [];
      for (const c of use) {
        const f = byKey.get(c.key);
        if (!f || c.key === 'plate' || c.key === 'make' || c.key === 'model') continue;
        let v = (r[c.i] || '').trim();
        if (!v) continue;
        v = valueMap.get(`${c.key}\u0000${v.toLowerCase()}`) ?? v;
        if ((f.kind === 'day' || f.kind === 'month') && map.dates === 'month-first') v = swapDay(v);
        if (f.key === 'fuelCard') v = safeCard(v);
        raw.push({ key: c.key, value: v, confidence: 1, evidence: '' });
      }
      const values: Record<string, unknown> = {};
      for (const x of cleanFields(raw, fields) as Found[]) values[x.key] = x.value;
      const make = cell('make') || null, model = cell('model') || null;
      const desc = [cell('vehicle') || [make, model].filter(Boolean).join(' '), cell('body')].filter(Boolean).join(', ').slice(0, 120) || null;
      const row: ImportRow = {
        at: { table: t.name, row: n }, plate, name: cell('name').slice(0, 60) || null,
        station: (cell('station') || tm.station || '').slice(0, 40) || null, desc, make: make?.slice(0, 40) || null, model: model?.slice(0, 40) || null, values,
      };
      const k = plateKey(plate);
      const prev = out.get(k);
      if (!prev) { out.set(k, row); continue; }
      twice++;
      for (const key of ['name', 'station', 'desc', 'make', 'model'] as const) if (!prev[key] && row[key]) prev[key] = row[key];
      for (const [key, v] of Object.entries(row.values)) if (prev.values[key] == null) prev.values[key] = v;
    }
  }
  return { rows: [...out.values()], noPlate, twice, columns: [...columns].map(([key, heading]) => ({ key, heading: heading.slice(0, 60) })), drivers };
}

/** The key of a vehicle description, so each model is asked about once. */
export const descKey = (d: string | null) => (d || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/**
 * A van's details split by where they're kept, after checking them again (they came back from the person's phone).
 * Money only for owners.
 */
export function splitValues(values: Record<string, unknown> | null | undefined, owner: boolean) {
  const fields = fieldsFor(owner);
  const raw = Object.entries(values || {}).map(([key, v]) => ({
    key, value: Array.isArray(v) ? v.join(', ') : typeof v === 'number' || typeof v === 'string' ? String(v) : '', confidence: 1, evidence: '',
  }));
  const clean = Object.fromEntries((cleanFields(raw, fields) as Found[]).map((x) => [x.key, x.value]));
  if (typeof clean.fuelCard === 'string') clean.fuelCard = safeCard(clean.fuelCard);
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => clean[k] != null).map((k) => [k, clean[k]]));
  return { facts: pick(FACT_KEYS), details: pick(DETAIL_KEYS), costs: owner ? pick(COST_KEYS) : {} };
}
