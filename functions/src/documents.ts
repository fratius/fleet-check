/**
 * Filling in van and driver records from a photo of a document: the AI says what kind of document it is and
 * reads the details the app keeps (and nothing else). The person checks them before anything is saved; the photos
 * are deleted after reading.
 *
 * Kept out on purpose (FLEET_DATA.md): licence numbers, dates and places of birth, home addresses, pay, health
 * data, ID numbers. They aren't in the list of things to read, and the prompt says not to repeat them.
 */

type Kind = 'text' | 'upper' | 'num' | 'day' | 'month' | 'choice' | 'multi' | 'phone' | 'long' | 'vin';
interface F { key: string; kind: Kind; what: string; options?: string[]; owner?: boolean; max?: number }

export const VAN_DOCS = [
  'registration certificate', 'registration certificate part II', 'lease contract', 'rental contract', 'financing contract',
  'purchase contract or invoice', 'insurance policy or certificate', 'inspection report (HU/AU)', 'safety check (UVV)',
  'service invoice or record', 'tyre invoice', 'vehicle tax notice', 'fuel or charging card', 'other',
] as const;
export const DRIVER_DOCS = ['driving licence', 'employment contract', 'briefing record', 'other'] as const;

/** What can be read for a van, by the key the app stores it under. */
export const VAN_FIELDS: F[] = [
  { key: 'plate', kind: 'upper', what: 'number plate (field A on the German registration certificate)', max: 14 },
  { key: 'make', kind: 'text', what: 'make (D.1)', max: 40 },
  { key: 'model', kind: 'text', what: 'model or trade name (D.3)', max: 40 },
  { key: 'vin', kind: 'vin', what: 'vehicle identification number, 17 characters (E)' },
  { key: 'firstReg', kind: 'day', what: 'date of first registration (B)' },
  { key: 'modelYear', kind: 'num', what: 'model year' },
  { key: 'color', kind: 'text', what: 'colour (R)', max: 30 },
  { key: 'fuel', kind: 'choice', what: 'fuel or power source (P.3)', options: ['diesel', 'electric', 'petrol', 'hybrid', 'cng'] },
  { key: 'powerKw', kind: 'num', what: 'power in kW (P.2)' },
  { key: 'gearbox', kind: 'choice', what: 'gearbox', options: ['manual', 'automatic'] },
  { key: 'tankL', kind: 'num', what: 'fuel tank in litres' },
  { key: 'batteryKwh', kind: 'num', what: 'usable battery capacity in kWh' },
  { key: 'rangeKm', kind: 'num', what: 'range in km' },
  { key: 'lengthM', kind: 'num', what: 'length in metres (field 18, given in mm: divide by 1000)' },
  { key: 'heightM', kind: 'num', what: 'height in metres (field 20, given in mm: divide by 1000)' },
  { key: 'grossKg', kind: 'num', what: 'maximum permissible mass in kg (F.2, or F.1)' },
  { key: 'emptyKg', kind: 'num', what: 'mass in running order in kg (G); used to work out the payload' },
  { key: 'payloadKg', kind: 'num', what: 'payload in kg, if the document states it' },
  { key: 'cargoM3', kind: 'num', what: 'cargo volume in cubic metres' },
  { key: 'tyreSize', kind: 'upper', what: 'tyre size (15.1 or 15.2), like 235/65 R16 C', max: 30 },
  { key: 'insurer', kind: 'text', what: 'insurance company', max: 80 },
  { key: 'policyNo', kind: 'upper', what: 'insurance policy number', max: 40 },
  { key: 'claimsPhone', kind: 'phone', what: 'phone number to report an accident or claim' },
  { key: 'breakdownPhone', kind: 'phone', what: 'breakdown assistance phone number' },
  { key: 'due.hu', kind: 'month', what: 'month of the next main inspection (HU), like 03/2027' },
  { key: 'due.uvv', kind: 'day', what: 'date of the next yearly safety check for company vehicles (UVV)' },
  { key: 'due.service', kind: 'day', what: 'date of the next service' },
  { key: 'due.serviceKm', kind: 'num', what: 'odometer reading (km) at which the next service is due' },
  { key: 'due.tyres', kind: 'day', what: 'date of the next tyre change' },
  { key: 'due.tax', kind: 'day', what: 'date the next vehicle tax is due' },
  { key: 'odometerKm', kind: 'num', what: 'odometer reading in km stated on the document (an inspection report or service invoice)' },
  { key: 'odometerAt', kind: 'day', what: 'the date of that odometer reading' },
  { key: 'ownership', kind: 'choice', what: 'how the company holds the van', options: ['owned', 'leased', 'rented', 'financed', 'other'] },
  { key: 'provider', kind: 'text', what: 'leasing company, landlord, bank or seller', max: 120 },
  { key: 'contractNo', kind: 'upper', what: 'contract number', max: 40 },
  { key: 'start', kind: 'day', what: 'contract start date' },
  { key: 'end', kind: 'day', what: 'contract end date' },
  { key: 'kmPerYear', kind: 'num', what: 'kilometres allowed a year' },
  { key: 'kmAtStart', kind: 'num', what: 'odometer at the start of the contract' },
  { key: 'included', kind: 'multi', what: 'services included in the contract', options: ['maintenance', 'tyres', 'insurance', 'breakdown', 'replacement'] },
  { key: 'contact', kind: 'text', what: 'contact for the contract: name, phone or email of the provider\'s desk', max: 120 },
  { key: 'returnNotes', kind: 'long', what: 'conditions for returning the van at the end', max: 600 },
  { key: 'coverage', kind: 'choice', what: 'insurance cover: liability only, partial or full (Haftpflicht, Teilkasko, Vollkasko)', options: ['liability', 'partial', 'full'] },
  { key: 'insuranceRenewal', kind: 'day', what: 'insurance renewal or end date' },
  { key: 'fuelCard', kind: 'text', what: 'fuel or charging card: the provider and only the last 4 digits (never the full number or a PIN)', max: 60 },
  { key: 'monthly', kind: 'num', what: 'monthly rate in euros without VAT', owner: true },
  { key: 'purchasePrice', kind: 'num', what: 'purchase price in euros without VAT', owner: true },
  { key: 'excessPerKm', kind: 'num', what: 'price in euros of each kilometre over the allowance', owner: true },
  { key: 'premium', kind: 'num', what: 'insurance premium in euros a year', owner: true },
  { key: 'deductible', kind: 'num', what: 'insurance deductible (Selbstbeteiligung) in euros', owner: true },
];

export const LICENCE_CLASSES = ['B', 'BE', 'C1', 'C1E', 'C', 'CE', 'AM', 'A1', 'A2', 'A'];
/** What can be read for a driver. */
export const DRIVER_FIELDS: F[] = [
  { key: 'licenceClasses', kind: 'multi', what: 'driving licence classes held (field 9; on the back, classes with a date in column 10)', options: LICENCE_CLASSES },
  { key: 'licenceValid', kind: 'day', what: 'the date the licence runs out: field 4b on the EU card, or the earliest date in column 11 for the C classes on the back, whichever comes first' },
  { key: 'employment', kind: 'choice', what: 'kind of employment contract', options: ['full', 'part', 'mini', 'student', 'other'] },
  { key: 'employedFrom', kind: 'day', what: 'employment start date' },
  { key: 'employedTo', kind: 'day', what: 'employment end date, if the contract is fixed-term or ended' },
  { key: 'vanBriefing', kind: 'day', what: 'date of the first briefing on the vans' },
  { key: 'safetyBriefing', kind: 'day', what: 'date of the (yearly) safety briefing' },
];

const NEVER = 'Never read out or repeat, not even in "evidence": licence or ID numbers, dates or places of birth, home addresses, pay or salary, bank details, health information, full card numbers or PINs. Leave them out.';

export function docPrompt(target: 'van' | 'driver', about: string, fields: F[], pages: number) {
  const docs = target === 'van' ? VAN_DOCS : DRIVER_DOCS;
  return `${pages === 1 ? 'This photo shows a document' : `These ${pages} photos show pages of one document`} kept by a German delivery company (an Amazon delivery partner) about ${about}. A fleet app fills in its records from it.

1. documentType: what kind of document it is, one of: ${docs.join(', ')}.
2. title: its name as printed (for example "Zulassungsbescheinigung Teil I"), or null.
3. fields: every detail in this list that the document states. Use the key exactly. Leave out anything the document doesn't state; don't guess or calculate, except unit conversions.
${fields.map((f) => `- ${f.key}: ${f.what}${f.options ? ` (one of: ${f.options.join(', ')}${f.kind === 'multi' ? '; several separated by commas' : ''})` : ''}`).join('\n')}
   value: as text. Dates as YYYY-MM-DD, months as MM/YYYY, numbers as plain digits with a dot for decimals and no thousands separators, in the unit named above.
   confidence: 0 to 1, how sure you are you read it correctly.
   evidence: the few words on the document it comes from, as printed (for example "F.2 3500").
4. sameName: ${target === 'driver' ? `does the name on the document match ${about}? "yes", "no", "unclear" or "not shown".` : '"not shown".'}
5. readable: false if this isn't a document or can't be read (blurred, cut off, glare).
6. notes: one short sentence on anything the person should know (a page missing, a date that looks wrong), or null.

${NEVER}`;
}

export function docSchema(target: 'van' | 'driver', fields: F[]) {
  const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['documentType', 'title', 'readable', 'sameName', 'fields', 'notes'],
    properties: {
      documentType: { type: 'string', enum: [...(target === 'van' ? VAN_DOCS : DRIVER_DOCS)] },
      title: nullable('string'),
      readable: { type: 'boolean' },
      sameName: { type: 'string', enum: ['yes', 'no', 'unclear', 'not shown'] },
      fields: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['key', 'value', 'confidence', 'evidence'],
          properties: { key: { type: 'string', enum: fields.map((f) => f.key) }, value: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'string' } },
        },
      },
      notes: nullable('string'),
    },
  };
}

/* ---------- reading the answer ---------- */

/** 31.03.2027, 2027-03-31, 03/2027 (a month means its last day). */
function day(t: string, month = false): string | null {
  const s = t.trim();
  let y: number, m: number, d: number | null = null;
  let r = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (r) { y = +r[1]; m = +r[2]; d = r[3] ? +r[3] : null; } else if ((r = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/))) {
    d = +r[1]; m = +r[2]; y = +r[3] < 100 ? 2000 + +r[3] : +r[3];
  } else if ((r = s.match(/^(\d{1,2})[./](\d{4})$/))) { m = +r[1]; y = +r[2]; } else return null;
  if (m < 1 || m > 12 || y < 1950 || y > 2100) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (month || d == null) d = last;
  if (d < 1 || d > last) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Values that are never in the thousands: a dot or comma in them is always a decimal point. */
const SMALL = new Set(['heightM', 'lengthM', 'cargoM3', 'excessPerKm']);
function num(t: string, key: string): number | null {
  const s = t.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // "3.500" or "3,500" as thousands (German documents); "2,72" as a decimal comma.
  const norm = !SMALL.has(key) && /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(',', '.');
  let n = Number(norm);
  if (!Number.isFinite(n)) return null;
  // Lengths given in millimetres, as on the registration certificate.
  if ((key === 'heightM' && n > 10) || (key === 'lengthM' && n > 30)) n = n / 1000;
  return n;
}

export interface Found { key: string; value: unknown; confidence: number | null; evidence: string }

/** Turns the AI's text values into what the app stores, dropping anything that doesn't fit. */
export function cleanFields(raw: unknown, fields: F[]): Found[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = new Map<string, Found>();
  for (const x of (Array.isArray(raw) ? raw : []) as { key?: unknown; value?: unknown; confidence?: unknown; evidence?: unknown }[]) {
    const f = byKey.get(String(x?.key || ''));
    const t = typeof x?.value === 'string' ? x.value.trim() : typeof x?.value === 'number' ? String(x.value) : '';
    if (!f || !t || /^(null|n\/a|none|-)$/i.test(t)) continue;
    let value: unknown = null;
    switch (f.kind) {
      case 'day': value = day(t); break;
      case 'month': value = day(t, true); break;
      case 'num': { const n = num(t, f.key); value = n != null && n >= 0 && n < 10_000_000 ? n : null; break; }
      case 'choice': value = f.options!.includes(t.toLowerCase()) ? t.toLowerCase() : null; break;
      case 'multi': {
        const list = t.split(/[,;/]+/).map((p) => p.trim()).map((p) => f.options!.find((o) => o.toLowerCase() === p.toLowerCase())).filter((p): p is string => !!p);
        value = list.length ? Array.from(new Set(list)) : null;
        break;
      }
      case 'vin': { const v = t.toUpperCase().replace(/[^A-Z0-9]/g, ''); value = v.length === 17 ? v : null; break; }
      case 'phone': value = /^[+0-9 ()/-]{5,30}$/.test(t) ? t : null; break;
      case 'upper': value = t.toUpperCase().slice(0, f.max || 60); break;
      default: value = t.replace(/\s+/g, ' ').slice(0, f.max || 120);
    }
    if (value == null) continue;
    const confidence = typeof x.confidence === 'number' && Number.isFinite(x.confidence) ? Math.max(0, Math.min(1, x.confidence)) : null;
    const evidence = typeof x.evidence === 'string' ? x.evidence.trim().slice(0, 120) : '';
    const prev = out.get(f.key);
    if (!prev || (confidence ?? 0) > (prev.confidence ?? 0)) out.set(f.key, { key: f.key, value, confidence, evidence });
  }
  // The payload from the maximum mass and the mass in running order, when the document doesn't state it.
  const gross = out.get('grossKg'), empty = out.get('emptyKg');
  if (!out.has('payloadKg') && gross && empty && (gross.value as number) > (empty.value as number)) {
    out.set('payloadKg', { key: 'payloadKg', value: (gross.value as number) - (empty.value as number), confidence: Math.min(gross.confidence ?? 0.5, empty.confidence ?? 0.5), evidence: gross.evidence && empty.evidence ? `${gross.evidence} minus ${empty.evidence}` : 'maximum mass minus mass in running order' });
  }
  out.delete('emptyKg');
  return [...out.values()];
}
