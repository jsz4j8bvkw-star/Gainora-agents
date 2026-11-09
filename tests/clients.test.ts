import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canMessage, dedupeKey, dueFor, dueGroups, dueThisWeek, exportClient, filterClients, inQuietHours, intervalFor, newlyDue, normalisePhone, optOut, snoozeUntil, suggestAmount, summarise, treatmentIdFor,
  type Client, type Visit,
} from '../shared/clients';
import { planToday } from '../shared/today';
import { SAMPLE_PROFILE } from '../src/lib/demo';

const DAY = 86_400_000; const WEEK = 7 * DAY;
const now = new Date('2026-11-09T12:00:00Z'); // 12:00 UTC = 12:00 GMT in November
const iso = (t: number) => new Date(t).toISOString();
const weeksAgo = (w: number) => iso(now.getTime() - w * WEEK).slice(0, 10);

const client = (over: Partial<Client> = {}): Client => ({ id: 'c1', name: 'Sarah Mitchell', phone: '+447700900123', email: 'sarah@example.com', consent: 'soft_opt_in', source: 'manual', createdAt: iso(now.getTime() - 200 * DAY), ...over });
const visit = (over: Partial<Visit> = {}): Visit => ({ id: 'v' + Math.random().toString(36).slice(2, 6), clientId: 'c1', at: weeksAgo(14), treatment: 'Anti-wrinkle injections – 2 areas', treatmentId: 'aw-2', amount: 195, createdAt: iso(now.getTime()), ...over });

test('clients: UK mobiles normalise to +447…, landlines and rubbish do not, and the dedupe key prefers mobile then email', () => {
  assert.equal(normalisePhone('07700 900123'), '+447700900123');
  assert.equal(normalisePhone('+44 (0)7700-900123'), '+447700900123');
  assert.equal(normalisePhone('0044 7700 900123'), '+447700900123');
  assert.equal(normalisePhone('447700900123'), '+447700900123');
  assert.equal(normalisePhone('01270 123456'), null);   // landline: cannot be texted
  assert.equal(normalisePhone('0770090012'), null);     // too short
  assert.equal(normalisePhone(''), null);
  assert.equal(dedupeKey({ phone: '+447700900123', email: 'a@b.com', name: 'Sarah' }), 'p:+447700900123');
  assert.equal(dedupeKey({ phone: '', email: 'Sarah@Example.com', name: 'Sarah' }), 'e:sarah@example.com');
  assert.equal(dedupeKey({ phone: '', email: '', name: 'Sarah  Mitchell' }), 'n:sarah mitchell');
});

test('clients: due dates come from the last visit of each treatment and the interval that applies, in order: client, setting, typical', () => {
  const c = client();
  // Anti-wrinkle 14 weeks ago with the typical 13-week gap: overdue by a week.
  let d = dueFor(c, [visit()], {}, now);
  assert.equal(d.status, 'overdue'); assert.equal(d.weeksOverdue, 1); assert.equal(d.intervalSource, 'typical'); assert.equal(d.intervalWeeks, 13); assert.equal(d.lastPrice, 195);
  assert.equal(d.dueAt!.slice(0, 10), weeksAgo(1));
  // The owner's per-treatment setting (16 weeks) wins over the typical gap: now upcoming.
  d = dueFor(c, [visit()], { intervals: { 'aw-2': 16 } }, now);
  assert.equal(d.status, 'upcoming'); assert.equal(d.intervalSource, 'setting');
  // The per-client interval ("Sarah comes every 10 weeks") beats both.
  d = dueFor({ ...c, intervalWeeks: 10 }, [visit()], { intervals: { 'aw-2': 16 } }, now);
  assert.equal(d.status, 'overdue'); assert.equal(d.weeksOverdue, 4); assert.equal(d.intervalSource, 'client');
  // Two treatments: the earliest due wins (lip filler 20 weeks ago has a 39-week gap; anti-wrinkle 12 weeks ago is due this week).
  d = dueFor(c, [visit({ at: weeksAgo(20), treatment: 'Lip filler 1ml', treatmentId: 'lip-1', amount: 220 }), visit({ at: weeksAgo(12) })], {}, now);
  assert.equal(d.status, 'due'); assert.equal(d.treatmentId, 'aw-2'); assert.equal(d.lastPrice, 195);
  // A treatment with no known interval produces no due date rather than a guess; a per-client interval rescues it.
  assert.equal(dueFor(c, [visit({ treatment: 'Something bespoke', treatmentId: null })], {}, now).status, 'none');
  assert.equal(dueFor({ ...c, intervalWeeks: 8 }, [visit({ treatment: 'Something bespoke', treatmentId: null })], {}, now).status, 'overdue');
  // No visits at all: none.
  assert.equal(dueFor(c, [], {}, now).status, 'none');
  assert.deepEqual(intervalFor({ intervalWeeks: null }, 'hydrafacial'), { weeks: 4, source: 'typical' });
  assert.deepEqual(intervalFor({ intervalWeeks: null }, null), { weeks: null, source: 'none' });
});

test('clients: snooze, not coming back and opt-out change what the owner is reminded about', () => {
  const c = client();
  assert.equal(dueFor({ ...c, snoozedUntil: snoozeUntil(3, now) }, [visit()], {}, now).status, 'snoozed');
  assert.equal(dueFor({ ...c, snoozedUntil: iso(now.getTime() - DAY) }, [visit()], {}, now).status, 'overdue'); // snooze over
  const gone = dueFor({ ...c, notComingBack: true }, [visit()], {}, now);
  assert.equal(gone.status, 'not_coming_back'); assert.equal(gone.dueAt, null);
  const stopped = optOut(c, now);
  assert.equal(stopped.consent, 'opted_out'); assert.equal(stopped.consentSource, 'stop');
  // Opted-out clients are still *listed* as due (the owner may ring them) but can never be messaged.
  assert.equal(dueFor(stopped, [visit()], {}, now).status, 'overdue');
  assert.equal(canMessage(stopped, 'rebook', { visits: 1, sent: [], now }).reason, 'Opted out of messages');
});

test('clients: grouping by treatment carries the value at the last price, and Home gets a due-this-week line', () => {
  const clients = [client(), client({ id: 'c2', name: 'Gemma Taylor', phone: '+447700900124' }), client({ id: 'c3', name: 'Rachel Price', phone: '+447700900125' }), client({ id: 'c4', name: 'Not Due', phone: '+447700900126' })];
  const visits = [
    visit({ clientId: 'c1' }), visit({ clientId: 'c2', amount: 210 }),
    visit({ clientId: 'c3', at: weeksAgo(30), treatment: 'Profhilo (2 sessions)', treatmentId: 'profhilo-2', amount: 390 }),
    visit({ clientId: 'c4', at: weeksAgo(2) }),
  ];
  const groups = dueGroups(clients, visits, {}, now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length, g.value]), [['Anti-wrinkle injections, 2 areas', 2, 405], ['Profhilo, 2 sessions', 1, 390]]);
  const week = dueThisWeek(clients, visits, {}, now);
  assert.equal(week.count, 3); assert.equal(week.value, 795); assert.equal(week.overdue, 3); assert.deepEqual(week.names, ['Sarah', 'Gemma', 'Rachel']);
  // Since last Monday's digest: all three became due in the window.
  assert.equal(newlyDue(clients, visits, {}, new Date(now.getTime() - 5 * WEEK), now).length, 3);
  assert.equal(newlyDue(clients, visits, {}, new Date(now.getTime() - 3 * WEEK), now).length, 2); // Rachel became due four weeks ago
  assert.equal(newlyDue(clients, visits, {}, new Date(now.getTime() + DAY), now).length, 0);
  // The Today list carries a due-back item with the real value.
  const today = planToday({ profile: SAMPLE_PROFILE, agents: ['watcher', 'scout', 'brief'], now, clients: { clients, visits } }, 5);
  const due = today.find((t) => t.id === 'due-back')!;
  assert.ok(due); assert.equal(due.agent, 'clients'); assert.match(due.why, /Sarah and Gemma and 1 more are due \(3 overdue\), worth £795 at their last prices/); assert.equal(due.link, '/clients?tab=due');
});

test('clients: consent and opt-out rules, quiet hours, the weekly cap and the 90-day review gap', () => {
  const c = client();
  const ok = canMessage(c, 'rebook', { visits: 1, sent: [], now });
  assert.deepEqual(ok, { ok: true, reason: null });
  // Soft opt-in only applies to existing clients: no visit, no text.
  assert.match(canMessage(c, 'rebook', { visits: 0, sent: [], now }).reason!, /No consent recorded/);
  assert.equal(canMessage({ ...c, consent: 'opted_in' }, 'rebook', { visits: 0, sent: [], now }).ok, true);
  assert.match(canMessage({ ...c, consent: 'unknown' }, 'rebook', { visits: 3, sent: [], now }).reason!, /No consent recorded/);
  assert.equal(canMessage({ ...c, phone: '' }, 'rebook', { visits: 1, sent: [], now }).reason, 'No mobile number');
  assert.equal(canMessage({ ...c, notComingBack: true }, 'rebook', { visits: 1, sent: [], now }).reason, 'Marked as not coming back');
  // Weekly cap: one message of any kind per client per week by default; the owner can raise it.
  const sent = [{ clientId: 'c1', kind: 'review_request', sentAt: iso(now.getTime() - 2 * DAY) }];
  assert.equal(canMessage(c, 'rebook', { visits: 1, sent, now }).reason, 'Already messaged this week');
  assert.equal(canMessage(c, 'rebook', { visits: 1, sent, now, settings: { weeklyCap: 2 } }).ok, true);
  assert.equal(canMessage(c, 'rebook', { visits: 1, sent: [{ ...sent[0], sentAt: iso(now.getTime() - 8 * DAY) }], now }).ok, true);
  // Review requests: never more than once per client per 90 days.
  assert.match(canMessage({ ...c, lastReviewAskAt: iso(now.getTime() - 60 * DAY) }, 'review_request', { visits: 1, sent: [], now }).reason!, /last 90 days/);
  assert.equal(canMessage({ ...c, lastReviewAskAt: iso(now.getTime() - 91 * DAY) }, 'review_request', { visits: 1, sent: [], now }).ok, true);
  // Quiet hours: 20:00 to 08:00 UK time by default; 21:30 GMT is quiet, 12:00 is not; the owner can change them.
  const late = new Date('2026-11-09T21:30:00Z');
  assert.equal(inQuietHours(late), true); assert.equal(inQuietHours(now), false);
  assert.equal(canMessage(c, 'rebook', { visits: 1, sent: [], now: late }).reason, 'Quiet hours until 8am');
  assert.equal(inQuietHours(late, { quietStart: 22, quietEnd: 8 }), false);
  // British Summer Time: 19:30 UTC is 20:30 in London, so quiet.
  assert.equal(inQuietHours(new Date('2026-07-01T19:30:00Z')), true);
  assert.equal(inQuietHours(new Date('2026-07-01T18:30:00Z')), false);
});

test('clients: history, filters, amount suggestions and the export the owner can hand over', () => {
  const visits = [visit({ at: weeksAgo(40), amount: 180 }), visit({ at: weeksAgo(27), amount: 190 }), visit({ at: weeksAgo(14), amount: 195 }), visit({ at: weeksAgo(20), treatment: 'Lip filler 1ml', treatmentId: 'lip-1', amount: 220 })];
  const s = summarise(visits);
  assert.equal(s.visits, 4); assert.equal(s.totalSpent, 785); assert.equal(s.lastTreatmentId, 'aw-2'); assert.equal(s.lastAmount, 195); assert.equal(s.firstVisitAt, weeksAgo(40));
  assert.deepEqual(s.lastPriceByTreatment, { 'aw-2': 195, 'lip-1': 220 });
  assert.equal(suggestAmount('aw-2', s), 195);
  assert.equal(suggestAmount('profhilo-2', s, { 'profhilo-2': 390 }), 390);
  assert.equal(suggestAmount('hydrafacial', s), null);
  assert.equal(treatmentIdFor('Botox 2 areas'), 'aw-2'); assert.equal(treatmentIdFor('Something bespoke'), null);
  const clients = [client(), client({ id: 'c2', name: 'Gemma Taylor', phone: '+447700900124', consent: 'opted_out' }), client({ id: 'c3', name: 'Old Client', phone: '', email: '' })];
  const all = [...visits, visit({ clientId: 'c2', at: weeksAgo(3), amount: 2000 }), visit({ clientId: 'c3', at: weeksAgo(40), treatment: 'Dermaplaning', treatmentId: 'dermaplaning', amount: 45 })];
  assert.deepEqual(filterClients(clients, all, {}, { filter: 'due' }, now).map((c) => c.id), ['c1']);                // c3 is lapsed, not due
  assert.equal(dueFor(clients[2], all, {}, now).status, 'lapsed');                                                     // dermaplaning 40 weeks ago on a 4-week gap
  assert.deepEqual(filterClients(clients, all, {}, { filter: 'lapsed' }, now).map((c) => c.id), ['c3']);           // lapsed, or no visit in 26 weeks
  assert.deepEqual(filterClients(clients, all, {}, { filter: 'top' }, now).map((c) => c.id), ['c2', 'c1', 'c3']);   // by total spent
  assert.deepEqual(filterClients(clients, all, {}, { filter: 'opted_out' }, now).map((c) => c.id), ['c2']);
  assert.deepEqual(filterClients(clients, all, {}, { q: 'lip' }, now).map((c) => c.id), ['c1']);                    // by treatment
  assert.deepEqual(filterClients(clients, all, {}, { treatmentId: 'dermaplaning' }, now).map((c) => c.id), ['c3']);
  const ex = exportClient(client({ notes: 'Prefers mornings' }), visits, [{ kind: 'rebook', sentAt: iso(now.getTime()), text: 'Hi Sarah…' }]) as any;
  assert.equal(ex.client.name, 'Sarah Mitchell'); assert.equal(ex.visits.length, 4); assert.equal(ex.visits[0].date, weeksAgo(40)); assert.equal(ex.messages.length, 1); assert.equal(ex.client.consent, 'Existing client (soft opt-in, can opt out)');
});
