// Importing clients from a booking system's export (Fresha, Phorest, Pabau, Booksy, Timely,
// Treatwell or anything else that produces a spreadsheet). Everything here runs in the browser:
// the file never leaves the owner's device until the rows they approved are saved to their
// account. Pure functions, shared with the tests.
//
// What it does: reads CSV (RFC 4180) and .xlsx (the first sheet, read directly from the zip),
// recognises the usual column names, lets the owner correct the mapping, turns rows into clients
// and visits, merges rows that are the same person (mobile, then email, then name), skips what
// it cannot read and says why, and caps the size so a phone can handle it.

import { dedupeKey, normaliseEmail, normalisePhone, treatmentIdFor, type Client, type Consent, type Visit } from './clients';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;

/* ---------- CSV ---------- */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let inQ = false;
  // Semicolon-separated files (some European exports) are detected from the header line.
  const head = s.split(/\r?\n/, 1)[0] ?? '';
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) && !head.includes(',') ? ';' : (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/* ---------- XLSX (first sheet) ---------- */
const td = new TextDecoder('utf-8');
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('This browser cannot unpack .xlsx files. Save the file as CSV instead.');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The named files inside a zip, read from the central directory. Only what .xlsx needs. */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file.');
  const count = u16(b, eocd + 10); let p = u32(b, eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10); const csize = u32(b, p + 20); const nameLen = u16(b, p + 28); const extraLen = u16(b, p + 30); const commentLen = u16(b, p + 32); const local = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const lnameLen = u16(b, local + 26); const lextraLen = u16(b, local + 28);
    const start = local + 30 + lnameLen + lextraLen;
    const raw = b.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error('Unsupported .xlsx compression.'); })());
  }
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Excel's serial day count to an ISO date (1900 date system). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return null;
  const ms = Math.round((serial - 25_569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Rows from the first worksheet of an .xlsx file. Numbers come through as text; dates as Excel serials (see excelSerialToIso). */
export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of td.decode(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  // The first sheet in workbook order, via its relationship id; fall back to sheet1.xml.
  let sheetName = 'xl/worksheets/sheet1.xml';
  const wb = files.get('xl/workbook.xml'); const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = td.decode(wb).match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    const target = rid ? td.decode(rels).match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? td.decode(rels).match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : null;
    if (target) sheetName = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.?\//, '')}`;
  }
  const sheet = files.get(sheetName) ?? files.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The .xlsx file has no worksheet.');
  const xml = td.decode(sheet);
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]; const inner = c[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1]; const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      let v = '';
      if (type === 's') { const i = Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]); v = shared[i] ?? ''; }
      else if (type === 'inlineStr') v = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else v = unxml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      while (cells.length < idx) cells.push('');
      cells[idx] = v.trim();
    }
    if (cells.some((x) => x !== '')) rows.push(cells);
  }
  return rows;
}

/** Reads a CSV or .xlsx file into rows; the caller checks the size first. */
export async function readFile(file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer>; text?: () => Promise<string> }): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB: export a shorter date range, or split it.`);
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files cannot be read. Save it as .xlsx or CSV and try again.');
  const text = file.text ? await file.text() : td.decode(await file.arrayBuffer());
  return parseCsv(text);
}

/* ---------- Columns ---------- */
export type ImportField = 'firstName' | 'lastName' | 'name' | 'phone' | 'email' | 'date' | 'treatment' | 'amount' | 'practitioner' | 'consent' | 'notes';
export type Mapping = Partial<Record<ImportField, number>>;   // field → column index

export const FIELD_LABEL: Record<ImportField, string> = {
  name: 'Client name', firstName: 'First name', lastName: 'Last name', phone: 'Mobile', email: 'Email', date: 'Visit date', treatment: 'Treatment or service', amount: 'Amount paid (£)', practitioner: 'Practitioner', consent: 'Marketing consent', notes: 'Notes',
};

const ALIASES: Record<ImportField, RegExp> = {
  firstName: /^(client\s*)?(first|fore|given)[\s_-]*name$|^fname$|^first$/i,
  lastName: /^(client\s*)?(last|sur|family)[\s_-]*name$|^lname$|^surname$|^last$/i,
  name: /^(client|customer|guest|patient|full)?[\s_-]*(name|full name)$|^client$|^customer$|^customer name$|^client name$|^patient name$/i,
  phone: /mobile|^phone|cell|^tel|telephone|phone number|contact number|mobile number|mob\b/i,
  email: /e-?mail/i,
  date: /^(appointment|appt|visit|booking|service|sale|sales|start|start time|checkout|created|last visit|last appointment|date of visit)?[\s_-]*(date|time|day)$|^date$|^when$|^start$/i,
  treatment: /^(service|services|treatment|treatments|item|items|service name|treatment name|product|description|appointment type|booked service)s?$/i,
  amount: /^(price|total|amount|paid|revenue|sales?|net|gross|value|cost|charge|total paid|amount paid|price paid|sale total|net sales|gross sales|total price)(\s*\(?(£|gbp)\)?)?$/i,
  practitioner: /staff|employee|team member|practitioner|therapist|stylist|technician|provider|performed by|resource|member/i,
  consent: /marketing|opt[\s_-]*in|consent|sms allowed|text marketing|allow (sms|marketing|text)|gdpr|subscribed|promotions?/i,
  notes: /^notes?$|^comments?$|^client notes?$/i,
};

/** The booking system a header row most looks like, for a friendlier note; never required. */
export function guessSystem(headers: string[]): string | null {
  const h = headers.map((x) => x.toLowerCase()).join('|');
  if (/team member|fresha/.test(h)) return 'Fresha';
  if (/client first name|client last name|phorest/.test(h)) return 'Phorest';
  if (/fname|lname|pabau|practitioner/.test(h)) return 'Pabau';
  if (/booksy|e-mail|staffer/.test(h)) return 'Booksy';
  if (/timely|start date|customer name/.test(h) && /mobile/.test(h)) return 'Timely';
  if (/treatwell|appointment date|venue/.test(h)) return 'Treatwell';
  return null;
}

/** Guesses which column is which from the headers. Ambiguous or missing fields are left unmapped for the owner to set. */
export function detectColumns(headers: string[]): Mapping {
  const m: Mapping = {};
  const clean = headers.map((h) => h.replace(/[*:]/g, '').replace(/\s+/g, ' ').trim());
  const order: ImportField[] = ['firstName', 'lastName', 'name', 'phone', 'email', 'date', 'treatment', 'amount', 'practitioner', 'consent', 'notes'];
  for (const f of order) {
    const i = clean.findIndex((h, idx) => h && ALIASES[f].test(h) && !Object.values(m).includes(idx));
    if (i >= 0) m[f] = i;
  }
  // "Name" alone is a client name unless first/last are present; "Service name" is a treatment, not a name.
  if (m.name != null && m.firstName != null) delete m.name;
  if (m.name != null && m.treatment != null && m.name === m.treatment) delete m.name;
  if (m.date == null) { const i = clean.findIndex((h, idx) => /date/i.test(h) && !Object.values(m).includes(idx)); if (i >= 0) m.date = i; }
  if (m.phone == null) { const i = clean.findIndex((h, idx) => /number/i.test(h) && !/order|invoice|ref/i.test(h) && !Object.values(m).includes(idx)); if (i >= 0) m.phone = i; }
  return m;
}

/* ---------- Values ---------- */
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** A date from the ways exports write them: 12/03/2026, 2026-03-12, 12 Mar 2026, 12-Mar-26, ISO with a time, or an Excel serial. */
export function parseDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); return iso(y, Number(m[2]) - 1, Number(m[1])); }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s-,]+(\d{2,4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] != null) { const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); return iso(y, MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1])); }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] != null) return iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function iso(y: number, mo: number, d: number): string | null {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCMonth() !== mo) return null;
  return dt.toISOString().slice(0, 10);
}

/** £ paid from "£150.00", "150", "GBP 150", "1,250". Refunds, blanks and words give null. */
export function parseAmount(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').replace(/,/g, '').replace(/gbp/i, '').trim();
  if (!s || /^-/.test(s) || /^\(/.test(s)) return null;
  const m = s.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return v > 0 && v < 100_000 ? Math.round(v * 100) / 100 : null;
}

/** Consent from an export's column: yes/true/1/subscribed → opted in; no/false/0/unsubscribed → opted out; anything else → not stated. */
export function parseConsent(raw: string | null | undefined): Consent | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1|opted?[\s_-]?in|subscribed|allowed|allow|granted|consented|accepted)$/.test(s)) return 'opted_in';
  if (/^(n|no|false|0|opted?[\s_-]?out|unsubscribed|not allowed|declined|refused|stop|none)$/.test(s)) return 'opted_out';
  return null;
}

/* ---------- Rows → clients and visits ---------- */
export interface ImportVisit { at: string; treatment: string; treatmentId: string | null; amount: number | null; practitioner: string | null }
export interface ImportClient {
  key: string;
  name: string; phone: string; phoneRaw: string; email: string;
  consent: Consent;         // from the file when stated, else soft opt-in when they have a visit, else unknown
  consentStated: boolean;
  notes: string;
  visits: ImportVisit[];
  /** Set when an existing client in the account has the same mobile or email: the visits are added to them. */
  existingId: string | null;
  /** The name matched but neither mobile nor email did: shown so the owner can decide. */
  nameOnlyMatch: boolean;
}
export interface ImportResult {
  clients: ImportClient[];
  skipped: { row: number; reason: string }[];
  summary: { rows: number; clients: number; newClients: number; existing: number; visits: number; withMobile: number; withEmail: number; optedOut: number; nameOnly: number; noDate: number; truncated: boolean };
}

export interface ExistingClient { id: string; name: string; phone: string; email: string }

/**
 * Builds the import from mapped rows. Rows for the same person (same mobile, else same email,
 * else the same name) become one client with several visits. Rows with no usable name are skipped.
 * A row with a date but no treatment still counts as a visit ("Visit") so the due-back logic has a
 * last-seen date; a row with no date gives a client with no visit.
 */
export function buildImport(rows: string[][], mapping: Mapping, existing: ExistingClient[] = [], opts: { hasHeader?: boolean; source?: string } = {}): ImportResult {
  const data = (opts.hasHeader ?? true) ? rows.slice(1) : rows;
  const truncated = data.length > MAX_ROWS;
  const body = data.slice(0, MAX_ROWS);
  const col = (r: string[], f: ImportField) => (mapping[f] != null ? (r[mapping[f]!] ?? '').trim() : '');
  const byKey = new Map<string, ImportClient>();
  // Secondary indexes, so a row with only an email and a later row with the mobile still meet.
  const byPhone = new Map<string, ImportClient>(); const byEmail = new Map<string, ImportClient>(); const byName = new Map<string, ImportClient>();
  const skipped: ImportResult['skipped'] = [];
  const exByPhone = new Map(existing.filter((e) => e.phone).map((e) => [e.phone, e]));
  const exByEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e]));
  const exByName = new Map(existing.map((e) => [dedupeKey({ name: e.name }), e]));
  let noDate = 0;

  body.forEach((r, i) => {
    const rowNo = i + ((opts.hasHeader ?? true) ? 2 : 1);
    const name = (col(r, 'name') || `${col(r, 'firstName')} ${col(r, 'lastName')}`).replace(/\s+/g, ' ').trim();
    if (!name || /^(client|customer|name|total|totals|sum)$/i.test(name)) { skipped.push({ row: rowNo, reason: 'No client name' }); return; }
    const phoneRaw = col(r, 'phone'); const phone = normalisePhone(phoneRaw) ?? '';
    const email = normaliseEmail(col(r, 'email'));
    const key = dedupeKey({ phone, email, name });
    const stated = parseConsent(col(r, 'consent'));
    const dateRaw = col(r, 'date'); const at = parseDate(dateRaw);
    const treatment = col(r, 'treatment');
    const amount = parseAmount(col(r, 'amount'));
    if (dateRaw && !at) skipped.push({ row: rowNo, reason: `Could not read the date “${dateRaw.slice(0, 30)}”` });
    if (!dateRaw) noDate++;
    const nameKey = dedupeKey({ name });
    let c = byKey.get(key) ?? (phone ? byPhone.get(phone) : undefined) ?? (email ? byEmail.get(email) : undefined) ?? (!phone && !email ? byName.get(nameKey) : undefined);
    if (!c) {
      const ex = (phone && exByPhone.get(phone)) || (email && exByEmail.get(email)) || null;
      const nameOnly = !ex && !phone && !email ? exByName.get(key) ?? null : null;
      c = { key, name, phone, phoneRaw, email, consent: 'unknown', consentStated: false, notes: '', visits: [], existingId: ex?.id ?? nameOnly?.id ?? null, nameOnlyMatch: !!nameOnly };
      byKey.set(key, c); byName.set(nameKey, c);
    }
    if (!c.phone && phone) { c.phone = phone; c.phoneRaw = phoneRaw; if (!c.existingId && exByPhone.get(phone)) c.existingId = exByPhone.get(phone)!.id; }
    if (!c.email && email) { c.email = email; if (!c.existingId && exByEmail.get(email)) c.existingId = exByEmail.get(email)!.id; }
    if (c.phone) byPhone.set(c.phone, c);
    if (c.email) byEmail.set(c.email, c);
    if (!c.phoneRaw && phoneRaw) c.phoneRaw = phoneRaw;
    const notes = col(r, 'notes'); if (notes && !c.notes.includes(notes)) c.notes = [c.notes, notes].filter(Boolean).join('\n').slice(0, 2000);
    if (stated) { c.consentStated = true; if (stated === 'opted_out' || c.consent !== 'opted_out') c.consent = stated; }
    if (at && !c.visits.some((v) => v.at === at && v.treatment.toLowerCase() === (treatment || 'Visit').toLowerCase())) {
      c.visits.push({ at, treatment: treatment || 'Visit', treatmentId: treatment ? treatmentIdFor(treatment) : null, amount, practitioner: col(r, 'practitioner') || null });
    }
  });

  const clients = [...byKey.values()].map((c) => {
    if (!c.consentStated) c.consent = c.visits.length || c.existingId ? 'soft_opt_in' : 'unknown';
    c.visits.sort((a, b) => a.at.localeCompare(b.at));
    return c;
  });
  return {
    clients, skipped,
    summary: {
      rows: body.length, clients: clients.length, newClients: clients.filter((c) => !c.existingId).length, existing: clients.filter((c) => c.existingId).length,
      visits: clients.reduce((a, c) => a + c.visits.length, 0), withMobile: clients.filter((c) => c.phone).length, withEmail: clients.filter((c) => c.email).length,
      optedOut: clients.filter((c) => c.consent === 'opted_out').length, nameOnly: clients.filter((c) => c.nameOnlyMatch).length, noDate, truncated,
    },
  };
}

/** Turns an approved import into the rows to save. Existing clients only gain visits (and a stated opt-out); new ones are created. */
export function toRecords(result: ImportResult, mkId: () => string, now = new Date(), source = 'import'): { clients: Client[]; visits: Visit[]; optOutIds: string[] } {
  const clients: Client[] = []; const visits: Visit[] = []; const optOutIds: string[] = [];
  const stamp = now.toISOString();
  for (const c of result.clients) {
    let id = c.existingId;
    if (!id) {
      id = mkId();
      clients.push({ id, name: c.name, phone: c.phone, phoneRaw: c.phoneRaw || undefined, email: c.email, consent: c.consent, consentAt: c.consentStated ? stamp : null, consentSource: 'import', notes: c.notes || undefined, source: 'import', importedFrom: source, createdAt: stamp });
    } else if (c.consentStated && c.consent === 'opted_out') optOutIds.push(id);
    for (const v of c.visits) visits.push({ id: mkId(), clientId: id, at: v.at, treatment: v.treatment, treatmentId: v.treatmentId, amount: v.amount, practitioner: v.practitioner, createdAt: stamp });
  }
  return { clients, visits, optOutIds };
}
