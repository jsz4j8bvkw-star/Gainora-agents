import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPatch, effectiveBookingMode, enquiryValue, isNoShow, normaliseEnquiry, packFromSettings, parsePrice, rebookWeeksFor, report, triage, typePrice, withDefaults,
  type EnquiryRecord,
} from '../shared/capture';
import { advice, nextStep, priority, rebookDue, rebookText, suggestReply, topicOf } from '../shared/insight';
import { dueNow } from '../shared/automations';
import { BEAUTY_SETTINGS, DEMO_SETTINGS } from '../src/lib/demo';

const beauty = withDefaults(structuredClone(BEAUTY_SETTINGS));
for (const w of Object.values(beauty.automations)) w!.since = '2026-01-01T00:00:00Z';
const trade = withDefaults(structuredClone(DEMO_SETTINGS));
const NOW = new Date('2026-11-08T10:00:00Z');

const rec = (over: Partial<EnquiryRecord> = {}): EnquiryRecord => ({
  id: 'e1', channel: 'call', name: 'Chloe Martin', phone: '+447700900410', email: '', postcode: '', summary: 'Would like anti-wrinkle treatment before a wedding.', transcript: '', recordingUrl: '',
  urgency: 'normal', kind: 'booking', reasons: [], status: 'new', afterHours: true, notes: '', history: [{ at: '2026-11-08T07:45:00Z', text: 'Call answered by your receptionist (out of hours)' }],
  repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null, jobValue: null, invoiceDue: null, paidAt: null,
  paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: '2026-11-08T07:45:00Z', isTest: false, ...over,
});

test('prices come only from the owner’s list, and "from" prices are marked as minimums', () => {
  assert.deepEqual(parsePrice('£250'), { amount: 250, from: false });
  assert.deepEqual(parsePrice('from £180'), { amount: 180, from: true });
  assert.deepEqual(parsePrice('Free'), { amount: 0, from: false });
  assert.deepEqual(parsePrice('£60-£90'), { amount: 60, from: true });
  assert.equal(parsePrice('ask'), null);
  assert.deepEqual(typePrice('lip filler', beauty.bookings.types), { amount: 250, from: false });
  assert.equal(typePrice('Tattoo removal', beauty.bookings.types), null);
  assert.deepEqual(enquiryValue(rec({ status: 'booked', bookedType: 'HydraFacial' }), beauty), { amount: 120, from: false, source: 'list' });
  assert.deepEqual(enquiryValue(rec({ status: 'won', bookedType: 'HydraFacial', jobValue: 135 }), beauty), { amount: 135, from: false, source: 'entered' });
  assert.equal(enquiryValue(rec({ status: 'booked', bookedType: 'Free consultation' }), beauty), null);   // free: no value claimed
  assert.equal(enquiryValue(rec({ status: 'new' }), beauty), null);
});

test('rebook interval: per treatment when set, otherwise the clinic’s general one', () => {
  const s = structuredClone(beauty);
  s.bookings.types = s.bookings.types.map((t) => (t.name === 'Gel nails' ? { ...t, rebookWeeks: 3 } : t));
  assert.equal(rebookWeeksFor('Gel nails', s), 3);
  assert.equal(rebookWeeksFor('HydraFacial', s), 6);   // 42 days
  assert.equal(rebookWeeksFor(undefined, s), 6);
  // The automatic "time to rebook" text follows the treatment's own interval.
  let e = applyPatch(rec({ name: 'Jade Morris' }), { status: 'booked', bookedFor: '2026-09-03T11:00:00Z', bookedType: 'Gel nails', bookedWith: 'Jess' }, s, new Date('2026-09-01T10:05:00Z'));
  e = applyPatch(e, { status: 'won', jobValue: 35 }, s, new Date('2026-09-03T12:00:00Z'));
  e = applyPatch(e, { paid: true, reviewAsked: true }, s, new Date('2026-09-03T12:10:00Z'));
  const at3w = new Date('2026-09-24T12:30:00Z');
  assert.ok(dueNow(e, s, [], false, at3w).some((d) => d.workflow === 'rebook'), 'gel nails rebook at 3 weeks');
  assert.ok(!dueNow(e, beauty, [], false, at3w).some((d) => d.workflow === 'rebook'), 'not before 6 weeks without an interval');
});

test('clients due back: by interval, skipping anyone who came back, with the owner’s wording', () => {
  const s = structuredClone(beauty);
  s.bookings.types = s.bookings.types.map((t) => (t.name === 'Lash lift and tint' ? { ...t, rebookWeeks: 6 } : t));
  const attended = (id: string, name: string, phone: string, type: string, when: string) => {
    let e = applyPatch(rec({ id, name, phone, receivedAt: when, history: [] }), { status: 'booked', bookedFor: when, bookedType: type, bookedWith: 'Jess' }, s, new Date(when));
    return applyPatch(e, { status: 'won', jobValue: 55 }, s, new Date(new Date(when).getTime() + 3_600_000));
  };
  const olivia = attended('o', 'Olivia Grant', '+447700900417', 'Lash lift and tint', '2026-09-20T12:00:00Z');   // due 1 Nov: overdue
  const isla = attended('i', 'Isla Roberts', '+447700900425', 'Lash lift and tint', '2026-10-01T12:00:00Z');       // due 12 Nov: within a week
  const grace = attended('g', 'Grace Hughes', '+447700900423', 'Lash lift and tint', '2026-10-20T12:00:00Z');      // due 1 Dec: not yet
  const back = rec({ id: 'o2', name: 'Olivia Grant', phone: '07700 900417', receivedAt: '2026-11-05T09:00:00Z', status: 'booked' });
  const due = rebookDue([olivia, isla, grace], s, NOW);
  assert.deepEqual(due.map((d) => d.enquiry.name), ['Olivia Grant', 'Isla Roberts']);
  assert.equal(due[0].overdueDays, 6);
  assert.deepEqual(rebookDue([olivia, isla, grace, back], s, NOW).map((d) => d.enquiry.name), ['Isla Roberts']);
  assert.equal(rebookDue([olivia], trade, NOW).length, 0);
  const t = rebookText(due[0], s);
  assert.match(t, /^Hi Olivia, it's been about 6 weeks since your Lash lift and tint at Willow Skin & Beauty/);
  assert.match(t, /book you in with Jess/);
  assert.match(t, /Reply STOP/);
});

test('the receptionist’s own call analysis feeds the inbox: type, booking, spam', () => {
  const call = (custom: Record<string, unknown>, summary = 'Caller rang about an appointment.') => normaliseEnquiry({ event: 'call_analyzed', call: { call_id: 'c9', from_number: '+447700900555', transcript: 'Agent: Hello', call_analysis: { call_summary: summary, custom_analysis_data: { caller_name: 'Megan Hall', ...custom } } } }, undefined, NOW)!;
  const booked = call({ call_type: 'new booking', booked: true, booked_for: '2026-11-14T10:00:00Z', appointment_type: 'Gel nails', booked_with: 'Jess', new_or_returning: 'new', preferred_times: 'Saturday morning' });
  assert.equal(booked.facts.bookedFor, '2026-11-14T10:00:00.000Z');
  assert.equal(booked.facts.appointmentType, 'Gel nails');
  assert.equal(booked.summary, 'Caller rang about an appointment. New client. Wants: Gel nails. Prefers: Saturday morning.');
  assert.equal(triage(booked.summary, { callType: booked.facts.callType, booked: true }).kind, 'booking');
  // A booking time in the past, or not marked booked, is never believed.
  assert.equal(call({ booked: true, booked_for: '2026-11-08T09:00:00Z' }).facts.bookedFor, null);
  assert.equal(call({ booked: false, booked_for: '2026-11-14T10:00:00Z' }).facts.bookedFor, null);
  assert.equal(call({ booked: true, booked_for: 'next Tuesday' }).facts.bookedFor, null);
  // Nothing added twice.
  assert.equal(call({ appointment_type: 'HydraFacial' }, 'Returning client wants a HydraFacial with Leah.').summary, 'Returning client wants a HydraFacial with Leah.');
  // Call types the receptionist sorts for us.
  assert.equal(triage('Offered to help the clinic with its social media.', { callType: 'sales call' }).kind, 'spam');
  assert.equal(triage('Caller offered Instagram marketing and more Google reviews for the clinic.').kind, 'spam');
  assert.equal(triage('I found you through your Google reviews and want to book a facial.').kind, 'booking');
  assert.equal(triage('Asked about parking.', { callType: 'wrong number' }).kind, 'spam');
  const concern = triage('Caller described swelling after a treatment.', { callType: 'concern after treatment' });
  assert.equal(concern.urgency, 'emergency');
  assert.equal(triage('Running 15 minutes late for her 2pm.', { callType: 'running late' }).urgency, 'urgent');
  assert.equal(triage('Not happy with the result of her filler.', { callType: 'complaint' }).kind, 'complaint');
  assert.equal(triage('Lash lift on Saturday', {}).urgency, 'normal');
});

test('no-shows are recorded in the history and counted in the report', () => {
  let e = applyPatch(rec(), { status: 'booked', bookedFor: '2026-11-05T11:00:00Z', bookedType: 'HydraFacial' }, beauty, new Date('2026-11-03T10:00:00Z'));
  e = applyPatch(e, { status: 'lost', lostReason: 'noshow' }, beauty, new Date('2026-11-05T12:00:00Z'));
  assert.equal(e.history.at(-1)!.text, 'Didn’t turn up for Thu 5 Nov');
  assert.ok(isNoShow(e.history.at(-1)!));
  const plain = applyPatch(rec(), { status: 'lost' }, beauty, NOW);
  assert.equal(plain.history.at(-1)!.text, 'Didn’t go ahead');
  const r = report([e, plain, rec({ id: 'b', status: 'booked', bookedType: 'Lip filler', afterHours: true })], new Date('2026-11-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'), beauty, NOW);
  assert.equal(r.noShows, 1);
  assert.equal(r.bookedValue, 250); assert.equal(r.bookedValued, 1); assert.equal(r.afterHoursBooked, 1); assert.equal(r.afterHoursValue, 250);
  assert.equal(r.byDay[6], 3);   // all three on Sunday 8 November
});

test('priority puts an emergency first, then a client who replied, then the longest wait', () => {
  const emergency = rec({ id: 'a', urgency: 'emergency', reasons: ['Possible reaction after a treatment: swollen'], status: 'new' });
  const replied = rec({ id: 'b', status: 'booked', bookedFor: '2026-11-10T11:00:00Z', bookedType: 'Free consultation' });
  const old = rec({ id: 'c', receivedAt: '2026-11-06T20:00:00Z', kind: 'quote' });
  const fresh = rec({ id: 'd', receivedAt: '2026-11-08T09:50:00Z' });
  const spam = rec({ id: 'e', status: 'spam' });
  const ctx = (e: EnquiryRecord) => ({ now: NOW, unreadReply: e.id === 'b' ? { body: 'Is it OK to wear make-up?', at: '2026-11-08T09:40:00Z' } : null });
  const order = [fresh, spam, old, replied, emergency].map((e) => ({ e, p: priority(e, beauty, ctx(e)) })).sort((x, y) => y.p.score - x.p.score).map((x) => x.e.id);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
  assert.match(priority(old, beauty, ctx(old)).why, /Waiting 2 days/);
  assert.match(priority(replied, beauty, ctx(replied)).why, /Replied/);
  assert.equal(priority(spam, beauty, ctx(spam)).score, -1);
});

test('next step reads the situation', () => {
  const n = (e: EnquiryRecord, extra = {}) => nextStep(e, beauty, { now: NOW, ...extra });
  assert.equal(n(rec({ urgency: 'emergency' })).action, 'call');
  assert.match(n(rec({ status: 'booked', bookedFor: '2026-11-10T11:00:00Z' }), { unreadReply: { body: 'Is it OK to wear make-up?', at: '2026-11-08T09:40:00Z' } }).title, /Chloe asked a question/);
  assert.equal(n(rec({ kind: 'quote' })).action, 'reply');
  assert.match(n(rec({ kind: 'booking' })).title, /Find Chloe a time/);
  assert.match(n(rec({ status: 'booked', bookedFor: '2026-11-05T11:00:00Z', bookedType: 'HydraFacial' })).title, /Did Chloe attend\?/);
  assert.match(n(rec({ status: 'booked', bookedFor: '2026-11-10T11:00:00Z', bookedType: 'Free consultation', bookedWith: 'Amy' })).title, /^Free consultation, Tuesday 10 November at 11am with Amy\.$/);
  assert.equal(nextStep(rec({ status: 'new', kind: 'other' }), trade, { now: NOW }).detail, 'The first to get back usually gets the job.');
});

test('a reply drafted from what the client actually said, never with medical advice', () => {
  const booked = rec({ status: 'booked', bookedFor: '2026-11-10T11:00:00Z', bookedType: 'Free consultation', bookedWith: 'Amy' });
  const makeup = suggestReply(booked, beauty, { now: NOW, unreadReply: { body: 'Thank you! Is it OK to wear make-up to the consultation?', at: '2026-11-08T09:40:00Z' } });
  assert.equal(makeup, 'Hi Chloe, good question. Please arrive 5 minutes early with clean skin and no make-up on the area being treated. Pay-and-display parking on Arwenack Street. See you on Tuesday 10 November at 11am with Amy. Amy');
  const times = suggestReply(rec({ name: 'Laura Bennett' }), beauty, { now: NOW, unreadReply: { body: 'Weekday evenings are best for me', at: '2026-11-08T09:40:00Z' } });
  assert.match(times, /^Hi Laura, thanks, weekday it is\. I'll check the diary and text you a couple of times/);
  const medical = suggestReply(booked, beauty, { now: NOW, unreadReply: { body: 'My lip is quite swollen, is that normal?', at: '2026-11-08T09:40:00Z' } });
  assert.match(medical, /I'll call you today/); assert.match(medical, /emergency line now: 07700 900444/); assert.doesNotMatch(medical, /normal/);
  const laser = suggestReply(rec({ name: 'Laura Bennett', kind: 'quote', summary: 'Asked how many laser hair removal sessions she would need for underarms and whether she needs a patch test first.' }), beauty, { now: NOW });
  assert.equal(topicOf({ summary: 'Asked how many laser hair removal sessions she would need', bookedType: '' }, beauty), 'laser hair removal');
  assert.match(laser, /^Hi Laura, thanks for asking about laser hair removal\. It's from £60, and a free chat first is always welcome\. Would you like me to find you a time\? Amy$/);
  const wedding = suggestReply(rec(), beauty, { now: NOW });
  assert.match(wedding, /about anti-wrinkle treatment\./); assert.match(wedding, /in good time for the big day/);
  const email = suggestReply(rec({ phone: '', email: 'c@example.com' }), beauty, { now: NOW });
  assert.match(email, /^Subject: Your enquiry with Willow Skin & Beauty\n\n/);
  const plumber = suggestReply(rec({ name: 'Tom Hughes', kind: 'quote', summary: 'Quote for replacing a small family bathroom.' }), trade, { now: NOW });
  assert.match(plumber, /^Hi Tom, thanks for getting in touch with Smith Plumbing & Heating about a price for the job\. I'll call you back today/);
});

test('report advice: only from the owner’s own numbers', () => {
  const list: EnquiryRecord[] = [];
  for (let i = 0; i < 10; i++) list.push(rec({ id: `n${i}`, receivedAt: `2026-10-${String(5 + i).padStart(2, '0')}T20:00:00Z`, afterHours: i < 6, status: i < 4 ? 'booked' : 'won', bookedType: 'HydraFacial', bookedFor: `2026-10-${String(7 + i).padStart(2, '0')}T11:00:00Z`, repliedAt: `2026-10-${String(5 + i).padStart(2, '0')}T20:10:00Z` }));
  list.push(rec({ id: 'old', receivedAt: '2026-10-20T10:00:00Z', status: 'new' }));
  list.push(rec({ id: 'ns', receivedAt: '2026-10-21T10:00:00Z', status: 'lost', history: [{ at: '2026-10-22T10:00:00Z', text: 'Didn’t turn up for Wed 22 Oct' }] }));
  const range = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
  const r = report(list, range.from, range.to, beauty, NOW);
  const a = advice(r, list, beauty, range, NOW);
  assert.ok(a.some((x) => /67% of enquiries came in while you were closed/.test(x.title)), 'out of hours');
  assert.ok(a.some((x) => /1 enquiry has had no reply/.test(x.title)), 'unanswered');
  assert.ok(a.some((x) => /1 no-show/.test(x.title) && /Reminders are already going out/.test(x.detail)), 'no-show');
  assert.ok(a.some((x) => /HydraFacial was booked most: 10 times/.test(x.title) && /Listed at £120/.test(x.detail)), 'top treatment');
  assert.ok(a.length <= 4);
  assert.deepEqual(advice(report([], range.from, range.to, beauty, NOW), [], beauty, range, NOW), []);
});

test('the receptionist never offers to check a diary it can’t see', () => {
  assert.equal(effectiveBookingMode({ mode: 'book', status: 'connected', system: 'Phorest' }), 'book');
  assert.equal(effectiveBookingMode({ mode: 'book', status: 'requested', system: 'Phorest' }), 'callback');
  assert.equal(effectiveBookingMode({ mode: 'offer', status: 'connected', system: 'A paper diary, or nothing yet' }), 'callback');
  const s = structuredClone(beauty); s.bookings.status = 'not_connected';
  const text = packFromSettings(s).text;
  assert.match(text, /Don't book a time\. Take the details/);
  assert.doesNotMatch(text, /Check the diary/);
  assert.match(packFromSettings(beauty).text, /Check the diary for free times/);
});
