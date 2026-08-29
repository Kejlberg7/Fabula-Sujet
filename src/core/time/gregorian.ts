/**
 * The Gregorian time system.
 *
 * Story time is a whole number of seconds from the Unix epoch, and it may be
 * negative -- a story set in 1200 is ordinary, not an edge case. Never a JS
 * Date: dates carry a timezone nobody asked for, and story time has no timezone.
 *
 * This is the only time system today. It is a module rather than a hardcoded
 * assumption so that an invented calendar, or a ship's clock running slow, is a
 * sibling of this file rather than a rewrite of the solver.
 */

import { PRECISION } from '../../db/schema/_shared';

export type Precision = (typeof PRECISION)[number];

export interface FuzzyInstant {
  /** Earliest second the moment could be. */
  earliest: number;
  /** Latest second it could be. */
  latest: number;
  precision: Precision;
}

const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export const SECONDS = { SECOND, MINUTE, HOUR, DAY, WEEK: 7 * DAY } as const;

const MONTHS_DA = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
];

function utc(y: number, mo = 1, d = 1, h = 0, mi = 0, s = 0): number {
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Reads what was written and keeps the vagueness.
 *
 * "1985" is a year wide, "1985-06" a month, "1985-06-12" a day. Widening a
 * vague date into a precise one is exactly the mistake this model exists to
 * avoid, so nothing here invents a time of day that was not given.
 */
export function parseInstant(text: string): FuzzyInstant {
  const value = text.trim();

  let m = /^(-?\d{1,6})$/.exec(value);
  if (m) {
    const y = Number(m[1]);
    return { earliest: utc(y, 1, 1), latest: utc(y, 12, 31, 23, 59, 59), precision: 'year' };
  }

  m = /^(-?\d{1,6})-(\d{2})$/.exec(value);
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]);
    return {
      earliest: utc(y, mo, 1),
      latest: utc(y, mo, daysInMonth(y, mo), 23, 59, 59),
      precision: 'month',
    };
  }

  m = /^(-?\d{1,6})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { earliest: utc(y, mo, d), latest: utc(y, mo, d, 23, 59, 59), precision: 'day' };
  }

  m = /^(-?\d{1,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value);
  if (m) {
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
    const at = utc(y, mo, d, h, mi);
    return { earliest: at, latest: at + 59, precision: 'minute' };
  }

  m = /^(-?\d{1,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (m) {
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    const at = utc(y, mo, d, h, mi, s);
    return { earliest: at, latest: at, precision: 'minute' };
  }

  throw new Error(`Kan ikke læse tidspunktet: "${text}"`);
}

/** How it reads back to the writer, no more precisely than it was given. */
export function formatInstant(seconds: number, precision: Precision = 'day'): string {
  const d = new Date(seconds * 1000);
  const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (precision) {
    case 'year': return String(y);
    case 'month': return `${MONTHS_DA[mo]} ${y}`;
    case 'day': return `${day}. ${MONTHS_DA[mo]} ${y}`;
    case 'hour': return `${day}. ${MONTHS_DA[mo]} ${y} kl. ${pad(d.getUTCHours())}`;
    case 'minute':
      return `${day}. ${MONTHS_DA[mo]} ${y} kl. ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}`;
    default: return `${day}. ${MONTHS_DA[mo]} ${y}`;
  }
}

/** Elapsed time, said the way a person would say it. */
export function formatSpan(seconds: number): string {
  const abs = Math.abs(Math.round(seconds));
  if (abs < MINUTE) return `${abs} sekunder`;
  if (abs < HOUR) return `${Math.round(abs / MINUTE)} minutter`;
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.round((abs % HOUR) / MINUTE);
    return m ? `${h} timer ${m} minutter` : `${h} timer`;
  }
  if (abs < 14 * DAY) {
    const days = Math.floor(abs / DAY);
    const h = Math.round((abs % DAY) / HOUR);
    return h ? `${days} døgn ${h} timer` : `${days} døgn`;
  }
  if (abs < 120 * DAY) return `${Math.round(abs / DAY)} døgn`;
  return `${(abs / (365.2425 * DAY)).toFixed(1).replace('.', ',')} år`;
}

/** Reads a plain-language span: "3 dage", "10 min", "2 uger". */
export function parseSpan(text: string): number {
  const m = /^\s*(-?[\d.,]+)\s*([a-zæøå]+)\s*$/i.exec(text);
  if (!m) throw new Error(`Kan ikke læse varigheden: "${text}"`);
  const n = Number(m[1]!.replace(',', '.'));
  const unit = m[2]!.toLowerCase();
  const table: Record<string, number> = {
    sek: SECOND, sekund: SECOND, sekunder: SECOND, s: SECOND,
    min: MINUTE, minut: MINUTE, minutter: MINUTE, m: MINUTE,
    time: HOUR, timer: HOUR, t: HOUR,
    dag: DAY, dage: DAY, døgn: DAY, d: DAY,
    uge: 7 * DAY, uger: 7 * DAY,
    måned: 30 * DAY, måneder: 30 * DAY,
    år: Math.round(365.2425 * DAY),
  };
  const factor = table[unit];
  if (!factor) throw new Error(`Ukendt tidsenhed: "${unit}"`);
  return Math.round(n * factor);
}
