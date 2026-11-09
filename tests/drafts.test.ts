import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitorResponseText, forSms, hasIncentive, mentionsHealth, OPT_OUT_LINE, quietDayText, rebookText, reviewLink, reviewReplyDraft, reviewRequestText, safeReply, scrubHealth, sinceWords, smsLink, smsSegments, treatmentPhrase } from '../shared/drafts';
import { coverLine, likelyOutcomes, moneySentence, moneySummary, type ClientAction, type Outcome } from '../shared/money';
import { eventTreatment, packWorthy, responsePack } from '../shared/responses';
import { firstActions, isNewAccount, reviewPosition } from '../shared/firstten';
import { SAMPLE_PROFILE } from '../src/lib/demo';
import { sampleCompetitors } from '../src/lib/demo-data';
import type { Client, Visit } from '../shared/clients';
import type { WatcherState } from '../src/lib/types';

const DAY = 86_400_000;
const now = new Date('2026-11-09T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const voice = { clinic: 'Willow Aesthetics', owner: 'Hannah', style: 'Short and direct', bookingUrl: 'https://www.fresha.com/a/willow' };

test('drafts: a rebook text names the client and treatment in the clinic’s voice, offers one way to book and always ends with the opt-out line', () => {
  const t = rebookText(voice, { name: 'Sarah Mitchell', treatment: 'Anti-wrinkle injections – 2 areas', treatmentId: 'aw-2', lastVisitAt: iso(now.getTime() - 14 * 7 * DAY) }, now);
  assert.equal(t, 'Hi Sarah, it’s Hannah at Willow Aesthetics. It’s been about 3 months since your anti-wrinkle top-up, so you’re due about now. Book here: https://www.fresha.com/a/willow Reply STOP to opt out.');
  assert.ok(t.endsWith(OPT_OUT_LINE));
  const warm = rebookText({ ...voice, style: 'Warm and friendly', bookingUrl: '' }, { name: 'Gemma', treatment: 'Lip filler 1ml', treatmentId: 'lip-1', lastVisitAt: iso(now.getTime() - 40 * 7 * DAY) }, now);
  assert.match(warm, /^Hi Gemma, it’s Hannah from Willow Aesthetics\. It’s been about 9 months since your lip filler/);
  assert.match(warm, /Reply to this text to book\. Reply STOP to opt out\.$/);
  assert.equal(treatmentPhrase('Profhilo (2 sessions)', 'profhilo-2'), 'your profhilo');
  assert.equal(treatmentPhrase('Dermaplaning', 'dermaplaning'), 'your dermaplaning');
  assert.equal(treatmentPhrase(null, null), 'your next appointment');
  assert.equal(sinceWords(iso(now.getTime() - 3 * 7 * DAY), now), '3 weeks'); assert.equal(sinceWords(iso(now.getTime() - 5 * 7 * DAY), now), 'about a month'); assert.equal(sinceWords(null), 'a while');
  // Two segments at most, and the SMS-safe version keeps GSM-7.
  const seg = smsSegments(forSms(t));
  assert.ok(seg.segments <= 2, `segments ${seg.segments}`); assert.equal(seg.encoding, 'GSM-7');
  assert.equal(smsSegments('Hi ' + 'x'.repeat(170)).segments, 2);
  assert.equal(smsLink('+447700900123', 'Hi Sarah, it’s Hannah'), 'sms:+447700900123?body=Hi%20Sarah%2C%20it%E2%80%99s%20Hannah');
});

test('drafts: review requests carry the Google link, never an incentive, and quiet-day and competitor texts stay personal and opt-outable', () => {
  const link = reviewLink('ChIJabc123');
  assert.equal(link, 'https://search.google.com/local/writereview?placeid=ChIJabc123');
  const r = reviewRequestText(voice, { name: 'Rachel Price', treatment: 'Anti-wrinkle injections', treatmentId: 'aw-2' }, link);
  assert.match(r, /^Hi Rachel, it’s Hannah at Willow Aesthetics\. Thank you for coming in for your anti-wrinkle top-up\. If you were happy, would you leave us a Google review\? https:\/\/search\.google\.com/);
  assert.ok(r.endsWith(OPT_OUT_LINE)); assert.equal(hasIncentive(r), false);
  assert.equal(hasIncentive('Leave a review and get 10% off your next visit'), true);
  assert.equal(hasIncentive('Leave a review and we’ll send a free gift'), true);
  const q = quietDayText(voice, { name: 'Sarah', treatment: 'Anti-wrinkle 2 areas', treatmentId: 'aw-2' }, { dayLabel: 'Thursday', timeLabel: 'afternoon' });
  assert.match(q, /space come up on Thursday afternoon if you’d like to get your anti-wrinkle top-up booked in/); assert.ok(q.endsWith(OPT_OUT_LINE));
  const c = competitorResponseText(voice, { name: 'Sarah', treatment: 'Profhilo (2 sessions)', treatmentId: 'profhilo-2' }, 'As always: a free two-week review.');
  assert.match(c, /You’re about due for your profhilo\. As always: a free two-week review\. Book here/); assert.ok(c.endsWith(OPT_OUT_LINE));
});

test('drafts: review replies thank by first name, move complaints offline, never argue, never offer anything, and never carry health details', () => {
  const v = { ...voice, edge: 'Nurse prescriber, 45-minute appointments, a free two-week review and no sales pressure.' };
  const praise = reviewReplyDraft({ id: 'r1', author: 'Gemma T.', rating: 5, text: 'Natural lips, no duck face, and she checked in two weeks later for free.', when: '4 days ago' }, v);
  assert.match(praise, /^Thank you, Gemma\. It means a great deal to hear that the result looks natural/); assert.match(praise, /\n\nHannah$/); assert.doesNotMatch(praise, /discount|voucher|in exchange/i);
  const complaint = reviewReplyDraft({ id: 'r2', author: 'Claire M.', rating: 3, text: 'Lovely results and Hannah is brilliant, but I messaged on Instagram three times to rebook and heard nothing for a week.', when: '2 days ago' }, v);
  assert.match(complaint, /^Claire, thank you for taking the time to tell us this\. I’m glad you were happy with the result itself, and I’m sorry that you waited so long for a reply/);
  assert.match(complaint, /message or call me directly/); assert.doesNotMatch(complaint, /discount|refund|voucher/i);
  const angry = reviewReplyDraft({ id: 'r3', author: 'Dee', rating: 1, text: 'Rude receptionist and I was overcharged.', when: 'today' }, v);
  assert.match(angry, /I’m sorry that the cost did not feel clear/);
  // Health details never reach a public reply, whether the reviewer wrote them or an AI draft repeated them.
  const health = 'Thank you, Jo. I’m glad the swelling from your filler settled and that your medication was not a problem. We look forward to seeing you again.';
  assert.equal(mentionsHealth(health), true);
  assert.equal(scrubHealth(health), 'Thank you, Jo. We look forward to seeing you again.');
  assert.equal(safeReply('Thanks Jo. We can offer a refund if you change the review. See you soon.'), 'Thanks Jo. See you soon.');
  const healthy = reviewReplyDraft({ id: 'r4', author: 'Jo', rating: 5, text: 'My rosacea is so much better after the treatment, Hannah checked my medication first.', when: 'today' }, v);
  assert.equal(mentionsHealth(healthy), false);
});

const client = (over: Partial<Client> = {}): Client => ({ id: 'c1', name: 'Sarah Mitchell', phone: '+447700900123', email: '', consent: 'soft_opt_in', source: 'manual', createdAt: iso(now.getTime() - 300 * DAY), ...over });
const visit = (over: Partial<Visit> = {}): Visit => ({ id: 'v1', clientId: 'c1', at: iso(now.getTime() - 5 * DAY).slice(0, 10), treatment: 'Anti-wrinkle 2 areas', treatmentId: 'aw-2', amount: 195, createdAt: iso(now.getTime()), ...over });
const action = (over: Partial<ClientAction> = {}): ClientAction => ({ id: 'a1', clientId: 'c1', kind: 'rebook', channel: 'sms_phone', text: 'Hi Sarah…', sentAt: iso(now.getTime() - 12 * DAY), treatmentId: 'aw-2', amountHint: 195, ...over });

test('money: only confirmed bookings make the headline; a visit within 21 days of a message is only ever "likely" until the owner says so', () => {
  const since = new Date('2026-11-01T00:00:00Z');
  const outcomes: Outcome[] = [
    { id: 'o1', actionId: 'a1', clientId: 'c1', amount: 195, status: 'confirmed', at: iso(now.getTime() - 3 * DAY), title: 'Sarah rebooked', createdAt: iso(now.getTime() - 3 * DAY) },
    { id: 'o2', actionId: 'a2', clientId: 'c2', amount: 220, status: 'confirmed', at: iso(now.getTime() - 1 * DAY), title: 'Gemma rebooked', createdAt: iso(now.getTime()) },
    { id: 'o3', actionId: 'a3', clientId: 'c3', amount: 390, status: 'likely', at: iso(now.getTime() - 2 * DAY), title: 'Rachel visited after a rebook text', createdAt: iso(now.getTime()) },
    { id: 'o4', actionId: null, clientId: 'c4', amount: 500, status: 'confirmed', at: '2026-10-20T10:00:00Z', title: 'Last month', createdAt: '2026-10-20T10:00:00Z' },
    { id: 'o5', actionId: 'a5', clientId: 'c5', amount: 100, status: 'dismissed', at: iso(now.getTime() - DAY), title: 'Not from us', createdAt: iso(now.getTime()) },
  ];
  const actions = [action(), action({ id: 'a2', clientId: 'c2' }), action({ id: 'a3', clientId: 'c3' }), action({ id: 'a5', clientId: 'c5', kind: 'review_request' })];
  const s = moneySummary(outcomes, actions, since);
  assert.equal(s.confirmed, 415); assert.equal(s.bookings, 2); assert.equal(s.likely.length, 1); assert.equal(s.likelyValue, 390);
  assert.deepEqual(s.byKind, { rebook: { bookings: 2, amount: 415 } });
  assert.equal(moneySentence(s, 'this month'), 'This month Gainora helped bring in £415 from 2 bookings you confirmed.');
  assert.equal(coverLine(s), 'That covers this month’s £299 subscription.');
  assert.equal(coverLine(moneySummary([outcomes[0]], actions, since)), '£104 short of this month’s £299 subscription so far.');
  assert.match(moneySentence(moneySummary([], [], since), 'this month'), /^No bookings confirmed/);
  assert.equal(coverLine(moneySummary([], [], since)), null);
  // Attribution: a visit 7 days after a text to the same client is likely; one 30 days after is not; a visit before the text is not; each visit links once.
  let n = 0;
  const likely = likelyOutcomes([action(), action({ id: 'a9', clientId: 'c9', sentAt: iso(now.getTime() - 40 * DAY) }), action({ id: 'a8', clientId: 'c8', sentAt: iso(now.getTime() - 2 * DAY) })],
    [visit(), visit({ id: 'v9', clientId: 'c9', at: iso(now.getTime() - 5 * DAY).slice(0, 10) }), visit({ id: 'v8', clientId: 'c8', at: iso(now.getTime() - 10 * DAY).slice(0, 10) })], [], () => `o${++n}`, now);
  assert.equal(likely.length, 1); assert.equal(likely[0].visitId, 'v1'); assert.equal(likely[0].status, 'likely'); assert.equal(likely[0].amount, 195); assert.equal(likely[0].title, 'Anti-wrinkle 2 areas after a rebook text');
  assert.equal(likelyOutcomes([action()], [visit()], likely, () => 'x', now).length, 0); // already linked
});

test('responses: a competitor offer or price change gets a pack built only from the owner’s own facts, naming no competitor and matching no price', () => {
  const comps = sampleCompetitors(SAMPLE_PROFILE, SAMPLE_PROFILE.competitors.list, now.getTime());
  const e = { id: 'e1', kind: 'offer', competitor: 'Glow Aesthetics Crewe', summary: 'Glow Aesthetics Crewe added a banner: 20% off Profhilo for new clients this November.', at: iso(now.getTime() - 2 * DAY) };
  assert.equal(eventTreatment(e), 'profhilo-1');
  const dueClient = client({ id: 'c3', name: 'Rachel Price' });
  const pack = responsePack(e, { profile: SAMPLE_PROFILE, comparison: comps.comparison, due: [{ client: dueClient, due: { clientId: 'c3', status: 'overdue', dueAt: iso(now.getTime() - 7 * DAY), weeksOverdue: 1, treatment: 'Profhilo (2 sessions)', treatmentId: 'profhilo-1', lastVisitAt: null, lastPrice: 390, intervalWeeks: 26, intervalSource: 'typical' } }] });
  assert.equal(pack.label, 'Profhilo, 1 session');
  assert.doesNotMatch(pack.caption, /Glow/); assert.doesNotMatch(pack.whyUs, /Glow/); assert.doesNotMatch(pack.caption, /20%|match/i);
  assert.match(pack.caption, /nurse prescriber/i); assert.match(pack.whyUs, /^Willow Aesthetics: Nurse prescriber/);
  assert.ok(pack.text); assert.equal(pack.text!.audience.length, 1); assert.match(pack.text!.draft, /^Hi Rachel, it’s Hannah at Willow Aesthetics\. You’re about due for your profhilo\. As always: nurse prescriber/);
  assert.ok(pack.facts.some((f) => /What the Watcher saw: .*20% off Profhilo/.test(f)));
  assert.match(pack.rule, /does not match their price/);
  // A price change on a treatment the owner lists quotes the owner's own price and the local average, from the comparison.
  const p = responsePack({ id: 'e2', kind: 'price', competitor: 'Glow', summary: 'Glow changed the price of lip filler, 1ml from £220 to £240', at: iso(now.getTime()) }, { profile: SAMPLE_PROFILE, comparison: comps.comparison });
  assert.equal(p.treatmentId, 'lip-1'); assert.match(p.caption, /Lip filler, 1ml is £220 here, and that is the whole price/); assert.ok(p.facts.some((f) => /Local average £/.test(f)));
  assert.equal(p.text, null);
  // An audience is filtered by whether each client may be texted.
  const none = responsePack(e, { profile: SAMPLE_PROFILE, comparison: comps.comparison, due: [{ client: { ...dueClient, consent: 'opted_out' }, due: { clientId: 'c3', status: 'due', dueAt: null, weeksOverdue: 0, treatment: 'Profhilo', treatmentId: 'profhilo-1', lastVisitAt: null, lastPrice: null, intervalWeeks: null, intervalSource: 'none' } }], canText: (c) => c.consent !== 'opted_out' });
  assert.equal(none.text, null);
  assert.equal(packWorthy('followers'), false); assert.equal(packWorthy('price'), true);
});

test('first ten minutes: review position against nearby, and three real first actions for a new account', () => {
  const comps = sampleCompetitors(SAMPLE_PROFILE, SAMPLE_PROFILE.competitors.list, now.getTime());
  const w = { site: '', up: true, responseMs: 0, uptime30d: 100, sslDaysLeft: null, pagesChecked: 0, brokenLinks: [], issues: [], history: [], changes: [], competitors: comps,
    reviews: { placeId: 'p', placeName: 'Willow', mapsUrl: '', rating: 4.9, count: 61, previousCount: 59, reviews: [], competitors: [], checkedAt: iso(now.getTime()) } } as WatcherState;
  const pos = reviewPosition(w)!;
  assert.equal(pos.ratingRank, 2); assert.equal(pos.of, 6); assert.ok(pos.countRank! > 1); assert.match(pos.text, /^4\.9 stars from 61 reviews: 2nd of 6 nearby by rating, but \d(st|nd|rd|th) of 6 by number of reviews; the busiest-looking has 212\./);
  assert.equal(reviewPosition({ ...w, competitors: { ...comps, list: comps.list.filter((c) => c.name !== 'The Lip Lounge') } })!.ratingRank, 1);
  assert.equal(reviewPosition({ ...w, reviews: null }), null);
  const empty = firstActions({ watcher: { ...w, reviews: null }, clientsReady: true, clients: [], visits: [], hasBookingSystem: true, hasPrices: true, now });
  assert.deepEqual(empty.map((a) => a.id), ['import', 'google', 'price-lip-1'].slice(0, empty.length));
  // A brand-new account with nothing yet: import, prices, and the search in progress.
  const brandNew = firstActions({ watcher: { ...w, reviews: null, competitors: { ...comps, foundAt: null, comparison: null } }, clientsReady: true, clients: [], visits: [], hasBookingSystem: false, hasPrices: false, now });
  assert.deepEqual(brandNew.map((a) => a.id), ['import', 'google', 'prices']);
  assert.equal(firstActions({ watcher: { ...w, competitors: { ...comps, foundAt: null, comparison: null } }, clientsReady: true, clients: [], visits: [], hasBookingSystem: true, hasPrices: true, now }).map((a) => a.id).join(','), 'import,wait-nearby');
  assert.equal(empty[0].link, '/clients?tab=import'); assert.match(empty[0].title, /^Import your clients/);
  const some = firstActions({ watcher: w, clientsReady: true, clients: [client()], visits: [visit()], hasBookingSystem: true, now });
  assert.equal(some[0].id, 'ask-reviews'); assert.match(some[0].title, /Ask your last 1 clients for a Google review/);
  assert.equal(isNewAccount({ completedAt: iso(now.getTime() - 2 * DAY) }, [], now), true);
  assert.equal(isNewAccount({ completedAt: iso(now.getTime() - 20 * DAY) }, [], now), false);
  assert.equal(isNewAccount({ completedAt: iso(now.getTime() - 2 * DAY) }, [client()], now), false);
});
