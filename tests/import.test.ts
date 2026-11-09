import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImport, detectColumns, excelSerialToIso, guessSystem, MAX_ROWS, parseAmount, parseConsent, parseCsv, parseDate, parseXlsx, readFile, toRecords } from '../shared/import';

/* A tiny zip writer (stored entries, no compression) so the xlsx reader is tested against a real file layout. */
function zip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  const le16 = (n: number) => [n & 255, (n >> 8) & 255]; const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name); const data = enc.encode(text);
    const local = new Uint8Array([...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(nameB.length), ...le16(0), ...nameB, ...data]);
    central.push(new Uint8Array([...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(nameB.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...nameB]));
    parts.push(local); offset += local.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array([...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(central.length), ...le16(central.length), ...le32(cdSize), ...le32(offset), ...le16(0)]);
  const all = new Uint8Array(offset + cdSize + eocd.length); let p = 0;
  for (const x of [...parts, ...central, eocd]) { all.set(x, p); p += x.length; }
  return all.buffer;
}

test('import: CSV parsing handles quotes, commas inside quotes, CRLF, a BOM and semicolons; dates, amounts and consent read the ways exports write them', () => {
  const rows = parseCsv('﻿Name,Mobile,"Service",Price\r\n"Mitchell, Sarah",07700 900123,"Anti-wrinkle ""2 areas""",£195.00\r\nGemma Taylor,,Lip filler 1ml,"1,220"\n');
  assert.deepEqual(rows, [['Name', 'Mobile', 'Service', 'Price'], ['Mitchell, Sarah', '07700 900123', 'Anti-wrinkle "2 areas"', '£195.00'], ['Gemma Taylor', '', 'Lip filler 1ml', '1,220']]);
  assert.deepEqual(parseCsv('Name;Mobile\nA;0770'), [['Name', 'Mobile'], ['A', '0770']]);
  assert.equal(parseDate('12/03/2026'), '2026-03-12');          // UK day first
  assert.equal(parseDate('2026-03-12T09:30:00Z'), '2026-03-12');
  assert.equal(parseDate('12 Mar 2026'), '2026-03-12');
  assert.equal(parseDate('12-Mar-26'), '2026-03-12');
  assert.equal(parseDate('March 12, 2026'), '2026-03-12');
  assert.equal(parseDate('45000'), '2023-03-15');                // Excel serial
  assert.equal(parseDate('31/02/2026'), null); assert.equal(parseDate('soon'), null); assert.equal(parseDate(''), null);
  assert.equal(excelSerialToIso(45000), '2023-03-15'); assert.equal(excelSerialToIso(12), null);
  assert.equal(parseAmount('£195.00'), 195); assert.equal(parseAmount('1,220'), 1220); assert.equal(parseAmount('GBP 45'), 45); assert.equal(parseAmount('-£20'), null); assert.equal(parseAmount('n/a'), null); assert.equal(parseAmount('0'), null);
  assert.equal(parseConsent('Yes'), 'opted_in'); assert.equal(parseConsent('FALSE'), 'opted_out'); assert.equal(parseConsent('unsubscribed'), 'opted_out'); assert.equal(parseConsent('maybe'), null); assert.equal(parseConsent(''), null);
});

test('import: common headers from Fresha, Phorest, Pabau, Booksy, Timely and Treatwell map themselves; ambiguous ones are left for the owner', () => {
  const fresha = ['First name', 'Last name', 'Mobile number', 'Email', 'Date', 'Service', 'Team member', 'Price', 'Accepts marketing'];
  assert.deepEqual(detectColumns(fresha), { firstName: 0, lastName: 1, phone: 2, email: 3, date: 4, treatment: 5, practitioner: 6, amount: 7, consent: 8 });
  assert.equal(guessSystem(fresha), 'Fresha');
  const phorest = ['Client First Name', 'Client Last Name', 'Mobile', 'Email Address', 'Appointment Date', 'Service Name', 'Staff', 'Total Paid'];
  assert.deepEqual(detectColumns(phorest), { firstName: 0, lastName: 1, phone: 2, email: 3, date: 4, treatment: 5, practitioner: 6, amount: 7 });
  assert.equal(guessSystem(phorest), 'Phorest');
  const pabau = ['Fname', 'Lname', 'Mobile', 'Email', 'Treatment', 'Practitioner', 'Amount', 'Date'];
  assert.deepEqual(detectColumns(pabau), { firstName: 0, lastName: 1, phone: 2, email: 3, date: 7, treatment: 4, amount: 6, practitioner: 5 });
  const booksy = ['Customer Name', 'Phone', 'E-mail', 'Service', 'Staffer', 'Price', 'Booking date'];
  assert.deepEqual(detectColumns(booksy), { name: 0, phone: 1, email: 2, date: 6, treatment: 3, amount: 5, practitioner: 4 });
  const timely = ['Customer', 'Mobile', 'Email', 'Start date', 'Service', 'Staff', 'Price'];
  assert.deepEqual(detectColumns(timely), { name: 0, phone: 1, email: 2, date: 3, treatment: 4, amount: 6, practitioner: 5 });
  const treatwell = ['Customer name', 'Phone number', 'Email', 'Appointment date', 'Treatment', 'Price (£)'];
  assert.deepEqual(detectColumns(treatwell), { name: 0, phone: 1, email: 2, date: 3, treatment: 4, amount: 5 });
  // A generic file with only a name and number still maps; a "Service name" column is a treatment, not a client.
  assert.deepEqual(detectColumns(['Client', 'Number', 'Service name', 'Notes']), { name: 0, phone: 1, treatment: 2, notes: 3 });
  assert.equal(detectColumns(['Column A', 'Column B']).name, undefined);
});

const HEADER = ['First name', 'Last name', 'Mobile number', 'Email', 'Date', 'Service', 'Team member', 'Price', 'Accepts marketing'];
const ROWS = [
  HEADER,
  ['Sarah', 'Mitchell', '07700 900123', 'sarah@example.com', '12/03/2026', 'Anti-wrinkle 2 areas', 'Hannah', '£195', 'Yes'],
  ['Sarah', 'Mitchell', '07700900123', '', '20/06/2026', 'Anti-wrinkle 2 areas', 'Hannah', '195.00', ''],
  ['Gemma', 'Taylor', '', 'GEMMA@example.com', '01/07/2026', 'Lip filler 1ml', 'Hannah', '£220', 'No'],
  ['Gemma', 'Taylor', '07700 900124', 'gemma@example.com', '02/10/2026', 'Lip filler 1ml', 'Hannah', '£220', ''],
  ['Rachel', 'Price', '01270 123456', '', '15/08/2026', 'Profhilo (2 sessions)', 'Hannah', '£390', ''],
  ['', '', '07700 900999', '', '15/08/2026', 'Dermaplaning', '', '£45', ''],
  ['Claire', 'Morgan', '07700 900125', '', 'next week', 'HydraFacial', '', '£95', ''],
  ['Jo', 'Walker', '07700 900126', 'jo@example.com', '', '', '', '', 'Yes'],
  ['Total', '', '', '', '', '', '', '£1,360', ''],
];

test('import: rows for the same person merge by mobile or email, existing clients gain visits, landlines are kept as text, bad rows are skipped with a reason', () => {
  const r = buildImport(ROWS, detectColumns(HEADER), [{ id: 'existing-1', name: 'Rachel Price', phone: '', email: '' }], { source: 'Fresha' });
  assert.equal(r.clients.length, 5);
  const sarah = r.clients.find((c) => c.name === 'Sarah Mitchell')!;
  assert.equal(sarah.phone, '+447700900123'); assert.equal(sarah.email, 'sarah@example.com'); assert.equal(sarah.visits.length, 2); assert.equal(sarah.consent, 'opted_in'); assert.equal(sarah.consentStated, true);
  assert.deepEqual(sarah.visits.map((v) => [v.at, v.treatmentId, v.amount]), [['2026-03-12', 'aw-2', 195], ['2026-06-20', 'aw-2', 195]]);
  // Gemma's two rows share an email (the first had no mobile); her stated opt-out sticks even though a later row left it blank.
  const gemma = r.clients.find((c) => c.name === 'Gemma Taylor')!;
  assert.equal(gemma.visits.length, 2); assert.equal(gemma.phone, '+447700900124'); assert.equal(gemma.consent, 'opted_out');
  // Rachel: landline is not a mobile (kept for display), matched to an existing client by name only, so flagged.
  const rachel = r.clients.find((c) => c.name === 'Rachel Price')!;
  assert.equal(rachel.phone, ''); assert.equal(rachel.phoneRaw, '01270 123456'); assert.equal(rachel.existingId, 'existing-1'); assert.equal(rachel.nameOnlyMatch, true); assert.equal(rachel.consent, 'soft_opt_in');
  // Claire: unreadable date is reported; she is still a client (with no visit, so no consent assumed).
  const claire = r.clients.find((c) => c.name === 'Claire Morgan')!;
  assert.equal(claire.visits.length, 0); assert.equal(claire.consent, 'unknown');
  // Jo: no visit, but a stated opt-in.
  assert.equal(r.clients.find((c) => c.name === 'Jo Walker')!.consent, 'opted_in');
  assert.deepEqual(r.skipped.map((s) => [s.row, s.reason]), [[7, 'No client name'], [8, 'Could not read the date “next week”'], [10, 'No client name']]);
  assert.deepEqual(r.summary, { rows: 9, clients: 5, newClients: 4, existing: 1, visits: 5, withMobile: 4, withEmail: 3, optedOut: 1, nameOnly: 1, noDate: 1, truncated: false });
  // Saving: new clients are created, the existing one only gains visits, ids are assigned.
  let n = 0; const rec = toRecords(r, () => `id${++n}`, new Date('2026-11-09T10:00:00Z'), 'Fresha');
  assert.equal(rec.clients.length, 4); assert.equal(rec.visits.length, 5); assert.equal(rec.visits.filter((v) => v.clientId === 'existing-1').length, 1);
  assert.equal(rec.clients.find((c) => c.name === 'Sarah Mitchell')!.importedFrom, 'Fresha');
  assert.equal(rec.clients.find((c) => c.name === 'Gemma Taylor')!.consentSource, 'import');
  assert.deepEqual(rec.optOutIds, []);
});

test('import: caps on rows and file size, and a .xlsx file reads through the zip with shared strings and serial dates', async () => {
  const big = [HEADER, ...Array.from({ length: MAX_ROWS + 10 }, (_, i) => ['A', `B${i}`, `0770090${String(i).padStart(4, '0')}`, '', '01/01/2026', 'X', '', '1', ''])];
  const r = buildImport(big, detectColumns(HEADER));
  assert.equal(r.summary.truncated, true); assert.equal(r.summary.rows, MAX_ROWS);
  await assert.rejects(readFile({ name: 'big.csv', size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }), /5 MB/);
  await assert.rejects(readFile({ name: 'old.xls', size: 10, arrayBuffer: async () => new ArrayBuffer(0) }), /\.xlsx or CSV/);

  const buf = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Mobile</t></si><si><t>Date</t></si><si><t>Service</t></si><si><r><t>Sarah </t></r><r><t>Mitchell</t></r></si><si><t>Lip &amp; cheek filler</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="inlineStr"><is><t>07700 900123</t></is></c><c r="C2" s="1"><v>46082</v></c><c r="D2" t="s"><v>5</v></c></row></sheetData></worksheet>',
  });
  const rows = await parseXlsx(buf);
  assert.deepEqual(rows, [['Name', 'Mobile', 'Date', 'Service'], ['Sarah Mitchell', '07700 900123', '46082', 'Lip & cheek filler']]);
  const m = detectColumns(rows[0]);
  const built = buildImport(rows, m);
  assert.equal(built.clients[0].phone, '+447700900123'); assert.equal(built.clients[0].visits[0].at, '2026-03-01'); assert.equal(built.clients[0].visits[0].treatment, 'Lip & cheek filler');
  const viaFile = await readFile({ name: 'clients.xlsx', size: buf.byteLength, arrayBuffer: async () => buf });
  assert.equal(viaFile.length, 2);
});
