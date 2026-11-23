/**
 * Dates and times as people type them, and the calendar's grid. Plain functions (no React), tested in
 * tests/datefmt.test.mjs.
 *
 * Typing: only digits are needed; the dots, the colon and the slash come by themselves, as soon as a part is
 * complete (31 → "31.", 0930 → "09:30", 032027 → "03/2027"). A part is complete at two digits, or at one digit
 * that can't start a longer one (a day 4–9, a month 2–9, an hour 3–9). Typing the separator yourself works too
 * (1.3.2027), and deleting is never reformatted, so a separator can be taken out like any other character.
 */

type Part = { max: number; /** The highest number that part can hold, for "4 is already a whole day". */ top: number };
const DAY: Part[] = [{ max: 2, top: 31 }, { max: 2, top: 12 }, { max: 4, top: 9999 }];
const MONTH: Part[] = [{ max: 2, top: 12 }, { max: 4, top: 9999 }];
const TIME: Part[] = [{ max: 2, top: 23 }, { max: 2, top: 59 }];

function shape(prev: string, next: string, parts: Part[], sep: string, seps: RegExp, allowed: RegExp): string {
  // Deleting, pasting something else (2027-03-31, letters): leave it as typed.
  if (next.length <= prev.length || !allowed.test(next)) return next;
  const typed = next.split(seps);
  const out: string[] = [];
  let open = '';
  const lastPart = () => out.length >= parts.length - 1;
  // A part is whole at its length, or at one digit that can't start a longer number (4 for a day).
  const whole = () => { const p = parts[out.length]; return open.length >= p.max || (open.length === 1 && p.max === 2 && Number(open) * 10 > p.top); };
  for (let i = 0; i < typed.length; i++) {
    for (const ch of typed[i]) {
      const p = parts[out.length];
      if (open.length >= p.max) break; // the last part is full: more digits are dropped
      // A second digit too big for the part (a month 13, an hour 25) starts the next part instead.
      if (open.length === 1 && p.max === 2 && Number(open + ch) > p.top && !lastPart()) { out.push(open); open = ch; }
      else open += ch;
      if (!lastPart() && whole()) { out.push(open); open = ''; }
    }
    // A separator the person typed closes the part (when it has a digit).
    if (i < typed.length - 1 && open && !lastPart()) { out.push(open); open = ''; }
  }
  if (!out.length) return open;
  return out.join(sep) + sep + open;
}

/** A date field as it's typed: 31032027 → 31.03.2027. */
export const typeDay = (prev: string, next: string) => shape(prev, next, DAY, '.', /[./]/, /^[\d./]*$/);
/** A month field (the TÜV sticker): 032027 → 03/2027. */
export const typeMonth = (prev: string, next: string) => shape(prev, next, MONTH, '/', /[./]/, /^[\d./]*$/);
/** A time field: 0930 → 09:30, 9 → 9:, 14 → 14:. */
export const typeTime = (prev: string, next: string) => shape(prev, next, TIME, ':', /[:.h]/, /^[\d:.h]*$/);

/** "2027-03-31" → "31.03.2027", the way the forms show a day. */
export const dayText = (iso: string) => iso.split('-').reverse().join('.');
/** "2027-03-31" → "03/2027". */
export const monthText = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * The days of a month as the calendar shows them: weeks from Monday, `null` before the 1st and after the last day.
 * `m` is 0–11.
 */
export function monthGrid(y: number, m: number): (number | null)[][] {
  const first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Whether a day ("YYYY-MM-DD") can be picked: between `min` and `max`, either of which may be left out. */
export const pickable = (iso: string, min?: string | null, max?: string | null) => (!min || iso >= min) && (!max || iso <= max);

/** The wheel's minutes: 00, 05 … 55. A typed time between two steps shows at the nearest step. */
export const MINUTE_STEP = 5;
export const wheelMinute = (mi: number, step = MINUTE_STEP) => Math.min(60 - step, Math.round(mi / step) * step);

/** "9", "9:" (as the field types it), "930", "9:30", "09.30" → "09:30"; null when it isn't a time. */
export function readTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})(?:[:.h ]?(\d{2})?)?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
