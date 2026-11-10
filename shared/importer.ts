// Switching to Gainora: reading a clinic's appointments from the spreadsheet (CSV) their old system exports
// (Fresha, Phorest, Timely, Cliniko, Pabau, a Google Sheet…). Columns are matched by name, the owner can change
// the match, and dates in UK formats are understood. Pure, so the app shows a preview before anything is saved.

import { normPhone, type CaptureSettings } from './capture';
import { findType, londonTime, teamOf } from './diary';

export type Column = 'name' | 'first' | 'last' | 'phone' | 'email' | 'date' | 'time' | 'service' | 'staff' | 'status' | 'price';
export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'name', label: 'Client name' }, { id: 'first', label: 'First name' }, { id: 'last', label: 'Last name' },
  { id: 'phone', label: 'Mobile' }, { id: 'email', label: 'Email' }, { id: 'date', label: 'Date (or date and time)' },
  { id: 'time', label: 'Time' }, { id: 'service', label: 'Treatment' }, { id: 'staff', label: 'Team member' },
  { id: 'status', label: 'Status' }, { id: 'price', label: 'Price paid' },
];
export type Mapping = Partial<Record<Column, number>>;

export interface ImportedBooking { name: string; phone: string; email: string; start: string; type: string; who: string; price: number | null; past: boolean; key: string }
export interface ImportResult { upcoming: ImportedBooking[]; past: ImportedBooking[]; skipped: { row: number; why: string }[] }

/** A CSV file as rows of cells: quotes, commas and line breaks inside quotes, Windows line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  const sep = (src.split('\n')[0].match(/;/g)?.length ?? 0) > (src.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((c) => c)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

const RULES: [Column, RegExp][] = [
  ['first', /^(client )?(first|given|forename)/i], ['last', /^(client )?(last|sur|family)\s?name/i],
  ['name', /^(client|customer|patient|full)?\s*name$|^client$|^customer$|^patient$/i],
  ['phone', /mobile|phone|tel|cell/i], ['email', /e-?mail/i],
  ['date', /(appointment|booking|start)?\s*(date|day|scheduled|start)/i], ['time', /time|^start$/i],
  ['service', /service|treatment|appointment type|^type$|procedure/i], ['staff', /staff|team|employee|practitioner|therapist|stylist|with/i],
  ['status', /status|state/i], ['price', /price|total|amount|value|paid|£/i],
];

/** Best guess at which column is which, from the header row. */
export function guessColumns(headers: string[]): Mapping {
  const m: Mapping = {};
  headers.forEach((h, i) => {
    const t = h.trim();
    for (const [col, re] of RULES) {
      if (m[col] !== undefined || !re.test(t)) continue;
      if (col === 'date' && /time/i.test(t) && !/date/i.test(t)) continue;
      if (col === 'time' && /date/i.test(t) && !/time/i.test(t)) continue;
      if (col === 'name' && (m.first !== undefined || m.last !== undefined) && /first|last/i.test(t)) continue;
      m[col] = i; break;
    }
  });
  return m;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date (and maybe a time) in the formats UK systems export, as YYYY-MM-DD and minutes past midnight. */
export function readDate(raw: string): { date: string; minutes: number | null } | null {
  const s = raw.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let y = 0, m = 0, d = 0;
  let rest = s;
  let k: RegExpMatchArray | null;
  if ((k = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +k[1]; m = +k[2]; d = +k[3]; rest = s.replace(k[0], ' '); }
  else if ((k = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/))) { d = +k[1]; m = +k[2]; y = +k[3] < 100 ? 2000 + +k[3] : +k[3]; rest = s.replace(k[0], ' '); }
  else if ((k = s.match(/(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]* (\d{4})/))) { d = +k[1]; m = MONTHS.indexOf(k[2]) + 1; y = +k[3]; rest = s.replace(k[0], ' '); }
  else if ((k = s.match(/([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)? (\d{4})/))) { m = MONTHS.indexOf(k[1]) + 1; d = +k[2]; y = +k[3]; rest = s.replace(k[0], ' '); }
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { date, minutes: readTime(rest) };
}
export function readTime(raw: string): number | null {
  const k = raw.trim().toLowerCase().match(/(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm)?/);
  if (!k || (!k[2] && !k[3])) return null;
  let h = +k[1]; const min = +(k[2] || 0);
  if (k[3] === 'pm' && h < 12) h += 12;
  if (k[3] === 'am' && h === 12) h = 0;
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Turns the rows into bookings: upcoming ones go in the diary, past attended ones become visit history. */
export function readBookings(rows: string[][], map: Mapping, s: CaptureSettings, now = new Date()): ImportResult {
  const out: ImportResult = { upcoming: [], past: [], skipped: [] };
  const team = teamOf(s);
  const at = (r: string[], c: Column) => (map[c] !== undefined ? String(r[map[c]!] ?? '').trim() : '');
  rows.forEach((r, i) => {
    const line = i + 2;   // spreadsheet row number, after the header
    const name = (at(r, 'name') || `${at(r, 'first')} ${at(r, 'last')}`).replace(/\s+/g, ' ').trim().slice(0, 120);
    const status = at(r, 'status').toLowerCase();
    if (/cancel|no.?show|did not|didn.t|deleted|declined/.test(status)) return out.skipped.push({ row: line, why: 'Cancelled or no-show' });
    const when = readDate(at(r, 'date'));
    const minutes = when?.minutes ?? readTime(at(r, 'time'));
    if (!when || minutes == null) return out.skipped.push({ row: line, why: 'No date and time we could read' });
    if (!name) return out.skipped.push({ row: line, why: 'No name' });
    const phone = normPhone(at(r, 'phone'));
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(at(r, 'email')) ? at(r, 'email').toLowerCase() : '';
    if (!/^\+\d{10,15}$/.test(phone) && !email) return out.skipped.push({ row: line, why: 'No mobile or email' });
    const start = londonTime(when.date, minutes).toISOString();
    const svc = at(r, 'service');
    const type = findType(s, svc)?.name || svc.slice(0, 80);
    const staffRaw = at(r, 'staff').split(' ')[0];
    const who = team.find((t) => t.toLowerCase() === staffRaw.toLowerCase()) ?? '';
    const priceNum = Number(at(r, 'price').replace(/[^\d.]/g, ''));
    const b: ImportedBooking = {
      name, phone: /^\+\d{10,15}$/.test(phone) ? phone : '', email, start, type, who,
      price: Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) / 100 : null,
      past: new Date(start).getTime() < now.getTime(),
      key: `import:${(phone || email)}:${start}`.slice(0, 120),
    };
    (b.past ? out.past : out.upcoming).push(b);
  });
  return out;
}
