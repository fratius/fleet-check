// Adding the whole fleet from a file (functions/src/fleetfile.ts): opening Excel and CSV files in code, and turning
// their rows into van records once the AI has said which column holds what. No AI here: the mapping is written out
// as the AI would answer it. The AI's side runs on the emulators (tests/history.test.mjs, "the whole fleet from a file").
// fleet.xlsx was saved by openpyxl the way Excel saves one: shared strings, date styles, a title above the headings,
// a totals row, a second sheet and a hidden one. fleet.csv is what German Excel saves as CSV: semicolons, Windows-1252.
//
// Run: node --import ./tests/alias.mjs --test tests/fleetfile.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import {
  FileProblem, buildRows, classSchema, decodeText, excelDay, fieldsFor, mapPrompt, mapSchema, parseCsv, readTables, safeCard, sniff, splitValues, tidyPlate,
} from '../functions/src/fleetfile.ts';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

test('an Excel file: every visible sheet, shared strings, dates as days, numbers as typed', () => {
  const b = fixture('fleet.xlsx');
  assert.equal(sniff(b), 'xlsx');
  const tables = readTables(b, 'xlsx');
  assert.deepEqual(tables.map((t) => t.name), ['Fahrzeuge', 'Notizen'], 'the hidden sheet is left out');
  const t = tables[0];
  assert.equal(t.rows[0][0], 'Fuhrparkliste Muster DSP GmbH, Stand 01.11.2026');
  assert.deepEqual(t.rows[1], [], 'the empty row keeps its place, so row numbers match Excel');
  assert.equal(t.rows[2][0], 'Kennzeichen');
  assert.deepEqual(t.rows[3].slice(0, 9), ['B-DX 1234', '101', 'DBE3', 'Mercedes-Benz Sprinter 316 CDI Hochdach', 'WDB9066331S123456', '2023-05-15', '2027-03-31', 'Diesel', '705.5']);
  assert.equal(tables[1].rows[0][0], 'Bitte & Danke <ok>', 'XML entities are read back');
});

test('a CSV from German Excel: semicolons, quotes, Windows-1252', () => {
  const b = fixture('fleet.csv');
  assert.equal(sniff(b), 'csv');
  const [t] = readTables(b, 'csv', 'fleet.csv');
  assert.deepEqual(t.rows[0], ['Kennzeichen', 'Marke', 'Modell', 'Kraftstoff', 'Nächste HU', 'Bemerkung']);
  assert.deepEqual(t.rows[1], ['M-AB 123E', 'Mercedes-Benz', 'eVito', 'Elektro', '03/2027', 'Schlüssel "2", Garage; Süd']);
  assert.equal(t.rows.length, 3);
  assert.deepEqual(parseCsv('a,b\n1,"x\ny"\n'), [['a', 'b'], ['1', 'x y']], 'a line break inside quotes stays in the cell');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Kennzeichen\tFIN', 'utf16le')])), 'Kennzeichen\tFIN', 'UTF-16 (Excel\'s "Unicode text")');
});

test('files that can\'t be read say what they are', () => {
  assert.equal(sniff(Buffer.from('%PDF-1.7\n')), 'pdf');
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image');
  assert.equal(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), 'xls');
  assert.throws(() => readTables(Buffer.alloc(8), 'xls'), (e) => e instanceof FileProblem && e.problem === 'xls');
  assert.equal(sniff(Buffer.from([0, 1, 2, 3, 4, 5, 0, 0, 0, 7])), 'unknown');
});

test('a date Excel stores as a number', () => {
  assert.equal(excelDay(45061), '2023-05-15');
  assert.equal(excelDay(43599, true), '2023-05-15', 'workbooks counting from 1904 (old Mac Excel)');
});

/** The mapping as the AI answers it for fleet.xlsx. */
const MAP = {
  tables: [
    { table: 1, use: true, headerRow: 3, firstRow: 4, lastRow: 8, station: null, columns: [
      { col: 'A', key: 'plate' }, { col: 'B', key: 'name' }, { col: 'C', key: 'station' }, { col: 'D', key: 'vehicle' }, { col: 'E', key: 'vin' },
      { col: 'F', key: 'firstReg' }, { col: 'G', key: 'due.hu' }, { col: 'H', key: 'fuel' }, { col: 'I', key: 'monthly' }, { col: 'J', key: 'driver' }, { col: 'K', key: 'fuelCard' },
    ] },
    { table: 2, use: false, headerRow: null, firstRow: 1, lastRow: null, station: null, columns: [] },
  ],
  dates: 'day-first',
  values: [{ key: 'fuel', from: 'Elektro', to: 'electric' }],
  notes: null,
};

test('rows become vans: plate, name, station, details; lines without a plate and the same plate twice', () => {
  const tables = readTables(fixture('fleet.xlsx'), 'xlsx');
  const r = buildRows(tables, MAP, fieldsFor(true));
  assert.deepEqual(r.rows.map((x) => x.plate), ['B-DX 1234', 'B-DX 1235', 'B DX 1236']);
  assert.equal(r.noPlate, 1, 'the spare van without a plate (the totals row is after lastRow)');
  assert.equal(r.twice, 1, 'B-DX 1234 is in the list twice');
  assert.equal(r.drivers, true);
  const [a, b, c] = r.rows;
  assert.deepEqual(a.at, { table: 'Fahrzeuge', row: 4 });
  assert.equal(a.name, '101');
  assert.equal(a.station, 'DBE3');
  assert.equal(a.desc, 'Mercedes-Benz Sprinter 316 CDI Hochdach');
  assert.deepEqual(a.values, { vin: 'WDB9066331S123456', firstReg: '2023-05-15', 'due.hu': '2027-03-31', fuel: 'diesel', monthly: 705.5, fuelCard: 'DKV …5678' });
  assert.equal(b.values.fuel, 'electric', 'the AI\'s word for "Elektro"');
  assert.equal(b.values['due.hu'], '2026-12-31');
  assert.equal(c.values.monthly, 650, '"650,00" typed as text');
  assert.equal(c.values.fuelCard, 'UTA ...9911', 'already only the last digits');
  assert.equal(c.station, 'DBE5');
  assert.deepEqual(r.columns.find((x) => x.key === 'plate'), { key: 'plate', heading: 'Kennzeichen' });
});

test('a manager isn\'t asked for money, and money a phone sends back is dropped for a manager', () => {
  const tables = readTables(fixture('fleet.xlsx'), 'xlsx');
  const fields = fieldsFor(false);
  assert.ok(!fields.some((f) => f.key === 'monthly'));
  assert.ok(!mapPrompt(tables, fields).includes('monthly'));
  assert.ok(!JSON.stringify(mapSchema(fields, 2)).includes('"monthly"'));
  const r = buildRows(tables, MAP, fields);
  assert.equal(r.rows[0].values.monthly, undefined);
  const s = splitValues({ monthly: 705.5, vin: 'WDB9066331S123456', 'due.hu': '2027-03-31', fuelCard: 'DKV 7034560012345678' }, false);
  assert.deepEqual(s, { facts: { vin: 'WDB9066331S123456' }, details: { 'due.hu': '2027-03-31', fuelCard: 'DKV …5678' }, costs: {} });
  assert.deepEqual(splitValues({ monthly: 705.5 }, true).costs, { monthly: 705.5 });
});

test('dates written month first, plates, card numbers', () => {
  const tables = [{ name: 'CSV', rows: [['Plate', 'Inspection due'], ['CA 12 ABC', '03/31/2027']] }];
  const map = { tables: [{ table: 1, use: true, headerRow: 1, firstRow: 2, lastRow: null, station: 'Main', columns: [{ col: 'A', key: 'plate' }, { col: 'B', key: 'due.uvv' }] }], dates: 'month-first', values: [], notes: null };
  const [row] = buildRows(tables, map, fieldsFor(true)).rows;
  assert.equal(row.values['due.uvv'], '2027-03-31');
  assert.equal(row.station, 'Main', 'the table\'s station when the row has none');
  assert.equal(tidyPlate('KENNZEICHEN'), null, 'a heading is not a plate');
  assert.equal(tidyPlate(' b - dx  1234 '), 'B-DX 1234');
  assert.equal(safeCard('7034 5600 1234 5678'), '…5678');
  assert.equal(safeCard('Shell 4471'), 'Shell 4471');
});

test('the schemas the AI answers in are valid for structured output', () => {
  const s = mapSchema(fieldsFor(true), 2);
  assert.equal(s.properties.tables.items.properties.table.maximum, 2);
  assert.ok(s.properties.tables.items.properties.columns.items.properties.key.enum.includes('due.hu'));
  assert.deepEqual(classSchema(['large_van']).properties.types.items.properties.cls.anyOf[0].enum, ['large_van']);
});

test('an Excel file written another way: inline strings, deflated, no shared strings', () => {
  // A minimal zip, deflated, as other programs (Numbers, LibreOffice, Google Sheets) write them.
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Vans" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Plate</t></is></c><c r="C1" t="inlineStr"><is><r><t>Ma</t></r><r><t>ke</t></r></is></c></row>'
      + '<row r="2"><c r="A2" t="str"><v>B-AB 1</v></c><c r="C2" t="inlineStr"><is><t>Ford</t></is></c></row></sheetData></worksheet>',
  };
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(local, n, data); central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const b = Buffer.concat([...parts, cd, end]);
  assert.equal(sniff(b), 'xlsx');
  assert.deepEqual(readTables(b, 'xlsx'), [{ name: 'Vans', rows: [['Plate', '', 'Make'], ['B-AB 1', '', 'Ford']] }]);
});
