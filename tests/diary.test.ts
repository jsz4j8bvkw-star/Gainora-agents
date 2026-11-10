import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults, type EnquiryRecord } from '../shared/capture';
import { busyFromBookings, freeTimes, londonTime, matchStaff, offerTimes, pageOf, parseSlotId, sayTime, slotId, slugify, stillFree, teamOf, whoDoes, findType } from '../shared/diary';
import { BEAUTY_SETTINGS, DEMO_SETTINGS } from '../src/lib/demo';

// Willow Skin & Beauty: Tue–Sat 9am–7pm, 2 hours' notice, 8 weeks ahead; Amy, Leah and Jess.
const beauty = withDefaults(structuredClone(BEAUTY_SETTINGS));
const NOW = new Date('2026-11-10T08:00:00Z');   // Tuesday 8am

const rec = (over: Partial<EnquiryRecord>): EnquiryRecord => ({
  id: 'e', channel: 'call', name: 'Chloe Martin', phone: '+447700900410', email: '', postcode: '', summary: '', transcript: '', recordingUrl: '',
  urgency: 'normal', kind: 'booking', reasons: [], status: 'booked', afterHours: false, notes: '', history: [], repliedAt: null, quoteAmount: null, quotedAt: null,
  chasersSent: 0, bookedFor: null, jobValue: null, invoiceDue: null, paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: '2026-11-09T09:00:00Z', isTest: false, ...over,
});

test('diary: UK wall-clock times survive the clocks changing', () => {
  assert.equal(londonTime('2026-11-12', 14 * 60).toISOString(), '2026-11-12T14:00:00.000Z');   // GMT
  assert.equal(londonTime('2026-07-02', 14 * 60).toISOString(), '2026-07-02T13:00:00.000Z');   // BST
  assert.equal(londonTime('2026-03-29', 10 * 60).toISOString(), '2026-03-29T09:00:00.000Z');   // the day BST starts
});

test('diary: the team, who does what, and slugs', () => {
  assert.deepEqual(teamOf(beauty), ['Amy', 'Leah', 'Jess']);
  assert.deepEqual(whoDoes(beauty, findType(beauty, 'lip filler')), ['Amy']);
  assert.deepEqual(whoDoes(beauty, findType(beauty, 'Gel nails')), ['Jess']);
  assert.equal(matchStaff(beauty, 'amy'), 'Amy');
  assert.equal(matchStaff(beauty, 'anyone'), '');
  assert.equal(slugify('Willow Skin & Beauty'), 'willow-skin-beauty');
  assert.equal(slugify('Ré'), 're-clinic');
  assert.equal(pageOf(beauty).slug, 'willow-skin-beauty');
  assert.equal(pageOf(beauty).on, true, 'the sample clinic has its page on');
  assert.equal(pageOf(withDefaults(structuredClone(DEMO_SETTINGS))).on, false, 'off until the owner switches it on');
});

test('diary: free times respect opening days and hours, notice, length and who does it', () => {
  const days = freeTimes(beauty, { type: 'Lip filler', days: 7, now: NOW });
  // Tuesday: opens 9am, 2 hours' notice from 8am → first time 10am. Sunday and Monday closed.
  assert.equal(days[0].date, '2026-11-10');
  assert.equal(days[0].slots[0].start, '2026-11-10T10:00:00.000Z');
  assert.ok(days.every((d) => !['2026-11-15', '2026-11-16'].includes(d.date)), 'closed Sun and Mon');
  // 45 minutes, closing at 7pm: the last start is 6.15pm.
  assert.equal(days[0].slots[days[0].slots.length - 1].start, '2026-11-10T18:15:00.000Z');
  assert.ok(days.every((d) => d.slots.every((x) => x.who === 'Amy')), 'only Amy does lip filler');
});

test('diary: bookings block their person, and an unassigned one blocks everyone', () => {
  const booked = [
    rec({ id: 'a', bookedFor: '2026-11-12T14:00:00Z', bookedType: 'Lip filler', bookedWith: 'Amy' }),
    rec({ id: 'b', bookedFor: '2026-11-12T16:00:00Z', bookedType: 'HydraFacial', bookedWith: '' }),
  ];
  const busy = busyFromBookings(booked, beauty, NOW);
  assert.deepEqual(busy[0], { start: '2026-11-12T14:00:00Z', end: '2026-11-12T14:45:00.000Z', who: 'Amy' });
  const thu = freeTimes(beauty, { type: 'Lip filler', from: '2026-11-12', days: 1, busy, now: NOW })[0].slots.map((x) => x.start.slice(11, 16));
  assert.ok(!thu.includes('14:00') && !thu.includes('13:30') && !thu.includes('14:30'), 'Amy is busy 2–2.45pm');
  assert.ok(thu.includes('13:15') && thu.includes('14:45'));
  assert.ok(!thu.includes('16:00'), 'the unassigned 4pm booking blocks everyone');
  // Gel nails is Jess's, so Amy's 2pm doesn't block it.
  const nails = freeTimes(beauty, { type: 'Gel nails', from: '2026-11-12', days: 1, busy, now: NOW })[0].slots.map((x) => x.start.slice(11, 16));
  assert.ok(nails.includes('14:00'));
  assert.equal(stillFree(beauty, 'Lip filler', '2026-11-12T14:00:00Z', 'Amy', busy, NOW), false);
  assert.equal(stillFree(beauty, 'Lip filler', '2026-11-12T15:00:00Z', 'Amy', busy, NOW), true);
});

test('diary: a gap after appointments and coarser start times', () => {
  const s = withDefaults({ ...structuredClone(BEAUTY_SETTINGS), diary: { step: 30, buffer: 15 } });
  const busy = [{ start: '2026-11-12T14:00:00Z', end: '2026-11-12T14:45:00Z', who: 'Amy' }];
  const thu = freeTimes(s, { type: 'Lip filler', from: '2026-11-12', days: 1, busy, now: NOW })[0].slots.map((x) => x.start.slice(11, 16));
  assert.ok(thu.every((t) => t.endsWith(':00') || t.endsWith(':30')));
  assert.ok(thu.includes('15:00'), '2.45pm plus a 15-minute gap: 3pm is the first time after');
  assert.ok(!thu.includes('14:30'));
  assert.ok(thu.includes('13:00'), 'a 1pm lip filler ends at 1.45, leaving exactly the 15-minute gap');
  assert.ok(!thu.includes('13:30'), 'a 1.30pm one would end at 2.15, into Amy’s 2pm');
  const noGap = freeTimes(withDefaults({ ...structuredClone(BEAUTY_SETTINGS), diary: { step: 15, buffer: 0 } }), { type: 'Lip filler', from: '2026-11-12', days: 1, busy, now: NOW })[0].slots.map((x) => x.start.slice(11, 16));
  assert.ok(noGap.includes('13:15') && noGap.includes('14:45'));
  const gap = freeTimes(withDefaults({ ...structuredClone(BEAUTY_SETTINGS), diary: { step: 15, buffer: 15 } }), { type: 'Lip filler', from: '2026-11-12', days: 1, busy, now: NOW })[0].slots.map((x) => x.start.slice(11, 16));
  assert.ok(!gap.includes('13:15') && !gap.includes('14:45'), 'with a 15-minute gap, back-to-back times go');
});

test('diary: offers are spread out, and read naturally', () => {
  const days = freeTimes(beauty, { type: 'Lip filler', days: 7, now: NOW });
  const offer = offerTimes(days);
  assert.equal(offer.length, 3);
  assert.ok(new Date(offer[1].start).getTime() - new Date(offer[0].start).getTime() >= 2 * 3_600_000);
  assert.equal(sayTime(offer[0]), 'Tuesday 10 November at 10am with Amy');
  const evening = offerTimes(days, { part: 'evening', count: 2 });
  assert.ok(evening.every((x) => new Date(x.start).getUTCHours() >= 17));
  const id = slotId(offer[0]);
  assert.deepEqual(parseSlotId(id), { start: offer[0].start, who: 'Amy' });
  assert.equal(parseSlotId('nonsense'), null);
});

test('diary: no team listed means one diary for the business', () => {
  const trade = withDefaults(structuredClone(DEMO_SETTINGS));
  trade.bookings.staff = '';
  const days = freeTimes(trade, { type: 'Boiler service', days: 3, now: NOW });
  assert.ok(days.length > 0);
  assert.ok(days[0].slots.every((x) => x.who === ''));
});
