import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessColumns, parseCsv, readBookings, readDate, readTime } from '../shared/importer';
import { report, withDefaults, type EnquiryRecord } from '../shared/capture';
import { dueNow } from '../shared/automations';
import { rebookDue } from '../shared/insight';
import { BEAUTY_SETTINGS } from '../src/lib/demo';

const s = withDefaults(structuredClone(BEAUTY_SETTINGS));
for (const w of Object.values(s.automations)) w!.since = '2026-01-01T00:00:00Z';
const NOW = new Date('2026-11-10T09:00:00Z');

test('import: CSV with quotes, commas inside quotes, semicolons and Windows line endings', () => {
  assert.deepEqual(parseCsv('Name,Note\r\n"Martin, Chloe","said ""hi"""\r\n'), [['Name', 'Note'], ['Martin, Chloe', 'said "hi"']]);
  assert.deepEqual(parseCsv('﻿a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('import: UK dates and times in the formats systems export', () => {
  assert.deepEqual(readDate('12/11/2026 14:30'), { date: '2026-11-12', minutes: 870 });
  assert.deepEqual(readDate('2026-11-12'), { date: '2026-11-12', minutes: null });
  assert.deepEqual(readDate('Thu, 12 Nov 2026 2:15 PM'), { date: '2026-11-12', minutes: 855 });
  assert.deepEqual(readDate('12th November 2026'), { date: '2026-11-12', minutes: null });
  assert.equal(readTime('9am'), 540);
  assert.equal(readTime('12:00 am'), 0);
  assert.equal(readDate('soon'), null);
});

test('import: columns are matched by name, and rows become bookings and visit history', () => {
  const csv = [
    'Appointment date,Start time,Client first name,Client last name,Mobile number,Email,Service,Team member,Status,Total price',
    '12/11/2026,14:00,Chloe,Martin,07700 900410,chloe@example.com,Lip filler,Amy Carter,Booked,£250',
    '01/10/2026,11:00,Grace,Lee,07700 900477,,HydraFacial,Leah,Completed,120',
    '02/10/2026,11:00,Old,Client,07700 900478,,HydraFacial,Leah,Cancelled,120',
    '03/10/2026,,No,Time,07700 900479,,HydraFacial,Leah,Completed,120',
    '04/10/2026,10:00,No,Contact,,,HydraFacial,Leah,Completed,120',
  ].join('\n');
  const rows = parseCsv(csv);
  const map = guessColumns(rows[0]);
  assert.deepEqual(map, { date: 0, time: 1, first: 2, last: 3, phone: 4, email: 5, service: 6, staff: 7, status: 8, price: 9 });
  const r = readBookings(rows.slice(1), map, s, NOW);
  assert.equal(r.upcoming.length, 1);
  assert.deepEqual({ ...r.upcoming[0], key: undefined }, { name: 'Chloe Martin', phone: '+447700900410', email: 'chloe@example.com', start: '2026-11-12T14:00:00.000Z', type: 'Lip filler', who: 'Amy', price: 250, past: false, key: undefined });
  assert.equal(r.past.length, 1);
  assert.equal(r.past[0].start, '2026-10-01T10:00:00.000Z', 'October is BST: 11am UK is 10:00 UTC');
  assert.deepEqual(r.skipped.map((x) => [x.row, x.why]), [[4, 'Cancelled or no-show'], [5, 'No date and time we could read'], [6, 'No mobile or email']]);
  assert.deepEqual(guessColumns(['Client', 'Phone', 'Date', 'Time', 'Treatment', 'Staff']), { name: 0, phone: 1, date: 2, time: 3, service: 4, staff: 5 });
});

test('import: imported history is quiet: no texts except the reminder, and not counted as caught enquiries', () => {
  const base = { channel: 'call' as const, postcode: '', summary: '', transcript: '', recordingUrl: '', urgency: 'normal' as const, kind: 'booking' as const, reasons: [], afterHours: false, notes: '', quoteAmount: null, quotedAt: null, chasersSent: 0, invoiceDue: null, paymentRemindersSent: 0, isTest: false };
  const upcoming: EnquiryRecord = { ...base, id: 'u', name: 'Chloe Martin', phone: '+447700900410', email: '', status: 'booked', bookedFor: '2026-11-12T14:00:00Z', bookedType: 'Lip filler', bookedWith: 'Amy', jobValue: null, paidAt: null, reviewAskedAt: null, repliedAt: '2026-11-10T08:00:00Z', receivedAt: '2026-11-10T08:00:00Z',
    history: [{ at: '2026-11-10T08:00:00Z', text: 'Imported from Fresha' }, { at: '2026-11-10T08:00:00Z', text: 'Booked in for Thu 12 Nov: Lip filler with Amy' }] };
  const past: EnquiryRecord = { ...base, id: 'p', name: 'Grace Lee', phone: '+447700900477', email: '', status: 'won', bookedFor: '2026-10-07T10:00:00Z', bookedType: 'HydraFacial', bookedWith: 'Leah', jobValue: 120, paidAt: '2026-10-07T10:00:00Z', reviewAskedAt: '2026-10-07T10:00:00Z', repliedAt: '2026-10-07T10:00:00Z', receivedAt: '2026-10-07T10:00:00Z',
    history: [{ at: '2026-11-10T08:00:00Z', text: 'Imported from Fresha' }, { at: '2026-10-07T10:00:00Z', text: 'Attended' }] };
  assert.deepEqual(dueNow(upcoming, s, [], false, NOW, [upcoming, past]).map((d) => d.step), [], 'no confirmation or thank-you on import');
  assert.deepEqual(dueNow(upcoming, s, [], false, new Date('2026-11-11T09:30:00Z'), [upcoming, past]).map((d) => d.step), ['reminder'], 'the reminder still goes the day before');
  assert.deepEqual(dueNow(past, s, [], false, NOW, [upcoming, past]), [], 'no rebook, review or check-in texts for imported history');
  assert.equal(report([upcoming, past], new Date('2026-10-01'), new Date('2026-11-30'), s, NOW).caught, 0);
  assert.deepEqual(rebookDue([upcoming, past], s, NOW).map((x) => x.enquiry.id), ['p'], 'but past visits do show who is due back, for the owner to invite');
});
