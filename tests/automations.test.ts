import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, withDefaults, type EnquiryRecord } from '../shared/capture';
import { defaultAutomations, dueNow, keyword, outOfQuietHours, ownerAlert, render, smsParts, upcoming, type MessageLite } from '../shared/automations';
import { CLINIC_SETTINGS, DEMO_SETTINGS } from '../src/lib/demo';

const clinic = withDefaults(structuredClone(CLINIC_SETTINGS));
const trade = withDefaults(structuredClone(DEMO_SETTINGS));
clinic.automations.booking!.since = trade.automations.ack!.since = '2026-01-01T00:00:00Z';
for (const s of [clinic, trade]) for (const w of Object.values(s.automations)) w!.since = '2026-01-01T00:00:00Z';

const rec = (over: Partial<EnquiryRecord> = {}): EnquiryRecord => ({
  id: 'e1', channel: 'call', name: 'George Hammond', phone: '+447700900310', email: '', postcode: '', summary: 'Lower back pain', transcript: '', recordingUrl: '',
  urgency: 'normal', kind: 'booking', reasons: [], status: 'new', afterHours: false, notes: '', history: [{ at: '2026-11-08T09:00:00Z', text: 'Call answered by your receptionist' }],
  repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null, jobValue: null, invoiceDue: null, paidAt: null,
  paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: '2026-11-08T09:00:00Z', isTest: false, ...over,
});
const sent = (d: { enquiryId: string; key: string }, at: string): MessageLite => ({ enquiryId: d.enquiryId, direction: 'out', key: d.key, status: 'sent', createdAt: at, automatic: true });

test('a booking on the call gets the confirmation George expects, then a reminder', () => {
  let e = rec();
  e = applyPatch(e, { status: 'booked', bookedFor: '2026-11-10T10:00:00Z', bookedType: 'Initial consultation', bookedWith: 'Sarah' }, clinic, new Date('2026-11-08T09:03:00Z'));
  const now = new Date('2026-11-08T09:03:30Z');
  const d = dueNow(e, clinic, [], false, now);
  assert.deepEqual(d.map((x) => x.step), ['confirm']);   // no "thanks for contacting us": he booked on the call
  assert.equal(d[0].to, '+447700900310');
  assert.equal(d[0].body, 'Hi George, thank you for booking with Lemon Street Physio. Your initial consultation appointment is on Tuesday 10 November at 10am with Sarah, at 12 Lemon Street, Truro TR1 2LS. Please wear loose, comfortable clothing and arrive 5 minutes early. Free parking behind the clinic. Need to change it? Just reply to this message.');
  // Sent once only; the reminder comes at 9am the day before.
  const msgs = [sent(d[0], now.toISOString())];
  assert.equal(dueNow(e, clinic, msgs, false, new Date('2026-11-09T08:30:00Z')).length, 0);
  const r = dueNow(e, clinic, msgs, false, new Date('2026-11-09T09:00:00Z'));
  assert.deepEqual(r.map((x) => x.step), ['reminder']);
  assert.match(r[0].body, /Hi George, a reminder of your initial consultation appointment at Lemon Street Physio tomorrow at 10am with Sarah\. Please give 24 hours' notice/);
  assert.equal(upcoming(e, clinic, msgs, now)[0].title, 'Reminder');
  // Moving the booking sends a new confirmation.
  const moved = applyPatch(e, { bookedFor: '2026-11-11T16:30:00Z' }, clinic, new Date('2026-11-08T12:00:00Z'));
  assert.match(dueNow(moved, clinic, msgs, false, new Date('2026-11-08T12:00:30Z'))[0].body, /Wednesday 11 November at 4:30pm/);
});

test('thank-you, quote chasers, quiet hours, stop on reply and STOP', () => {
  const e = rec({ name: 'Tom Hughes', receivedAt: '2026-11-08T21:15:00Z', history: [] });
  const ack = dueNow(e, trade, [], false, new Date('2026-11-08T21:15:20Z'));
  assert.deepEqual(ack.map((x) => x.step), ['ack']);                 // instant replies ignore quiet hours
  assert.match(ack[0].body, /^Hi Tom, thanks for contacting Smith Plumbing & Heating\. Dave will call you back/);
  assert.equal(dueNow(e, trade, [], true, new Date('2026-11-08T21:15:20Z')).length, 0);   // opted out, no email: nothing

  let q = applyPatch(rec({ name: 'Priya Shah' }), { status: 'quoted', quoteAmount: 640 }, trade, new Date('2026-11-01T15:00:00Z'));
  const msgs: MessageLite[] = [{ enquiryId: 'e1', direction: 'out', key: 'ack.ack', status: 'sent', createdAt: '2026-11-01T09:00:00Z', automatic: true }];
  // Day 3 falls at 3pm: due then. At 9pm it would wait until 8am.
  assert.equal(dueNow(q, trade, msgs, false, new Date('2026-11-04T14:59:00Z')).length, 0);
  const c1 = dueNow(q, trade, msgs, false, new Date('2026-11-04T15:00:00Z'));
  assert.equal(c1[0].step, 'chase1'); assert.match(c1[0].body, /quote for £640 reached you/); assert.deepEqual(c1[0].patch, { chaserSent: true });
  assert.equal(outOfQuietHours('2026-11-04T21:30:00Z'), '2026-11-05T08:00:00.000Z');
  assert.equal(outOfQuietHours('2026-07-04T21:30:00Z'), '2026-07-05T07:00:00.000Z');   // 8am BST
  // The customer replied: chasers pause.
  const replied = [...msgs, { enquiryId: 'e1', direction: 'in' as const, key: null, status: 'received', createdAt: '2026-11-02T10:00:00Z', automatic: false }];
  assert.equal(dueNow(q, trade, replied, false, new Date('2026-11-04T15:00:00Z')).length, 0);
  // Switched off: nothing.
  const off = withDefaults(structuredClone(trade)); off.automations.quote!.on = false;
  assert.equal(dueNow(q, off, msgs, false, new Date('2026-11-04T15:00:00Z')).length, 0);
  // Switched on after the quote went out: old quotes aren't chased.
  const late = withDefaults(structuredClone(trade)); late.automations.quote!.since = '2026-11-03T00:00:00Z';
  assert.equal(dueNow(q, late, msgs, false, new Date('2026-11-04T15:00:00Z')).length, 0);
  q = applyPatch(q, { chaserSent: true }, trade, new Date('2026-11-04T15:00:00Z'));
  assert.equal(dueNow(q, trade, [...msgs, sent(c1[0], '2026-11-04T15:00:00Z')], false, new Date('2026-11-09T15:00:00Z'))[0].step, 'chase2');
});

test('payments, the final reminder waits for approval, reviews carry the opt-out', () => {
  let e = applyPatch(rec({ name: 'Linda Moss' }), { status: 'won', jobValue: 320 }, trade, new Date('2026-11-01T12:00:00Z'));
  assert.equal(e.invoiceDue, '2026-11-15');
  assert.equal(dueNow(e, trade, [], false, new Date('2026-11-15T09:00:00Z')).filter((d) => d.workflow === 'payment').length, 0);
  const p1 = dueNow(e, trade, [], false, new Date('2026-11-15T10:00:00Z')).find((d) => d.workflow === 'payment')!;
  assert.match(p1.body, /£320 for your recent booking with Smith Plumbing & Heating is due today\. You can pay here: https:\/\/pay\.example/);
  assert.equal(p1.ask, false);
  e = applyPatch(applyPatch(e, { paymentReminderSent: true }, trade), { paymentReminderSent: true }, trade);
  const p3 = dueNow(e, trade, [], false, new Date('2026-11-29T10:00:00Z')).find((d) => d.workflow === 'payment')!;
  assert.equal(p3.step, 'pay3'); assert.equal(p3.ask, true);
  e = applyPatch(e, { paid: true }, trade, new Date('2026-11-30T10:00:00Z'));
  const rv = dueNow(e, trade, [], false, new Date('2026-12-01T10:00:00Z')).find((d) => d.workflow === 'review')!;
  assert.match(rv.body, /Google review really helps/); assert.match(rv.body, /Reply STOP to stop these messages\.$/);
});

test('wording, owner alerts and keywords', () => {
  assert.equal(render('Hi {first name}[, with {who}]. Bye', { 'first name': 'Jo', who: '' }), 'Hi Jo. Bye');
  assert.equal(render('Hi {first name}[, with {who}].', { 'first name': 'Jo', who: 'Sam' }), 'Hi Jo, with Sam.');
  assert.equal(smsParts('a'.repeat(160)), 1); assert.equal(smsParts('a'.repeat(161)), 2);
  assert.equal(keyword(' Stop '), 'stop'); assert.equal(keyword('START'), 'start'); assert.equal(keyword('stop by tomorrow?'), null);
  const a = ownerAlert(rec({ urgency: 'emergency', name: 'Jane Price', postcode: 'TR1 2AB', summary: 'Boiler stopped, elderly mother.', phone: '+447700900123' }), trade);
  assert.equal(a, 'EMERGENCY for Smith Plumbing & Heating: Jane Price, TR1 2AB. Boiler stopped, elderly mother. Call back: 07700900123');
  // A clinic red-flag call gets no "we'll find you an appointment" text.
  assert.equal(dueNow(rec({ urgency: 'emergency' }), clinic, [], false, new Date('2026-11-08T09:00:10Z')).length, 0);
  // Test enquiries and spam never get messages.
  assert.equal(dueNow(rec({ isTest: true }), trade, [], false, new Date('2026-11-08T09:00:10Z')).length, 0);
});

test('aftercare check-in and rebook: after an attended appointment, never if they already came back', async () => {
  const { BEAUTY_SETTINGS } = await import('../src/lib/demo');
  const { applyPatch } = await import('../shared/capture');
  const s = structuredClone(BEAUTY_SETTINGS);
  s.automations = defaultAutomations('appointments', '2026-01-01T00:00:00Z');
  s.bookings.types = s.bookings.types.map((t) => ({ ...t, rebookWeeks: undefined }));   // the general six-week nudge
  const base: any = { id: 'e1', name: 'Rosie Turner', phone: '+447700900419', email: '', channel: 'call', status: 'new', urgency: 'normal', kind: 'booking', receivedAt: '2026-09-01T10:00:00Z', history: [], summary: 'Lip filler', transcript: '', postcode: '', reasons: [], afterHours: false, notes: '', isTest: false, chasersSent: 0, paymentRemindersSent: 0, quoteAmount: null, quotedAt: null, bookedFor: null, jobValue: null, invoiceDue: null, paidAt: null, reviewAskedAt: null, repliedAt: null, externalId: null, recordingUrl: '', bookedType: 'Lip filler', bookedWith: 'Amy' };
  let e = applyPatch(base, { status: 'booked', bookedFor: '2026-09-03T11:00:00Z', bookedType: 'Lip filler', bookedWith: 'Amy' }, s, new Date('2026-09-01T10:05:00Z'));
  e = applyPatch(e, { status: 'won', jobValue: 250 }, s, new Date('2026-09-03T12:00:00Z'));
  const day1 = dueNow(e, s, [], false, new Date('2026-09-04T12:30:00Z'));
  assert.ok(day1.some((d) => d.workflow === 'aftercare' && /checking in after your lip filler appointment/.test(d.body)));
  assert.ok(!dueNow(e, s, [], false, new Date('2026-09-20T12:00:00Z')).some((d) => d.workflow === 'aftercare'), 'no late check-in');
  const sixWeeks = new Date('2026-10-15T12:00:00Z');
  const r = dueNow(e, s, [], false, sixWeeks);
  assert.ok(r.some((d) => d.workflow === 'rebook' && /Reply STOP/.test(d.body)), 'rebook goes out with opt-out');
  const back: any = { ...base, id: 'e2', receivedAt: '2026-10-01T09:00:00Z' };
  assert.ok(!dueNow(e, s, [], false, sixWeeks, [e, back]).some((d) => d.workflow === 'rebook'), 'no rebook if they came back');
  const trade = structuredClone(s); trade.business.kind = 'trade';
  assert.ok(!dueNow({ ...e }, trade, [], false, sixWeeks).some((d) => d.workflow === 'rebook' || d.workflow === 'aftercare'), 'not for trades');
});
