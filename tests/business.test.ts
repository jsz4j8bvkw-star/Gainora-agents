import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { afterSend, canEmail, DEFAULT_SEQUENCES, dueFollowUps, fill, funnel, prospectsFromCsv, sameProspect } from '../shared/admin/sales';
import { DEFAULT_PRICE_BOOK, packagesFromGrants, proposalTotals, fromPriceItem, toWebsitePrices } from '../shared/admin/prices';
import { healthOf, resultsEmail } from '../shared/admin/care';
import { dueSoon, expensesIn, nextOccurrence, sum, vatStatus } from '../shared/admin/books';

test('who may be emailed (PECR) and the do-not-contact list', () => {
  const base = { email: 'amy@willow.example', consent: false, unsubscribed_at: null, bounced_at: null };
  assert.equal(canEmail({ ...base, company_type: 'limited' }).ok, true);
  assert.equal(canEmail({ ...base, company_type: 'llp' }).ok, true);
  assert.equal(canEmail({ ...base, company_type: 'sole_trader' }).ok, false);
  assert.match(canEmail({ ...base, company_type: 'sole_trader' }).why, /need to say yes/);
  assert.equal(canEmail({ ...base, company_type: 'sole_trader', consent: true }).ok, true);
  assert.match(canEmail({ ...base, company_type: 'unknown' }).why, /Companies House/);
  assert.equal(canEmail({ ...base, company_type: 'limited', unsubscribed_at: '2026-11-01' }).ok, false);
  assert.equal(canEmail({ ...base, company_type: 'limited' }, new Set(['willow.example'])).ok, false, 'a blocked domain blocks everyone at it');
  assert.equal(canEmail({ ...base, email: '', company_type: 'limited' }).ok, false);
});

test('messages fill in, and the personal line disappears when there is nothing real to say', () => {
  const tpl = DEFAULT_SEQUENCES[0].steps[0];
  const me = { name: 'Adelin', booking: 'https://calendar.app.google/x' };
  const withLine = fill(tpl.body, { contact_name: 'Amy Walker', business_name: 'Willow', personal_line: 'I saw your lip filler reviews and they’re glowing.' }, me);
  assert.match(withLine, /^Hi Amy,\n\nI saw your lip filler reviews/);
  assert.match(withLine, /pick any time here: https:\/\/calendar\.app\.google\/x/);
  const without = fill(tpl.body, { contact_name: 'Amy Walker', business_name: 'Willow', personal_line: '' }, me);
  assert.match(without, /^Hi Amy,\n\nI’m Adelin, founder of Gainora/);
  assert.ok(!/\{/.test(without), 'no unfilled gaps');
  assert.equal(fill('Calls at {business}', { business_name: 'Willow' }, me), 'Calls at Willow');
  assert.equal(fill('Hi {first_name}', { contact_name: '' }, me), 'Hi there');
});

test('follow-ups: one on day 4 from the first message, then stop; replies stop it', () => {
  const seq = DEFAULT_SEQUENCES[0];
  assert.deepEqual(afterSend(seq, 0, '2026-11-10'), { step: 1, next_on: '2026-11-14' });
  assert.deepEqual(afterSend(seq, 1, '2026-11-10'), { step: 2, next_on: null });
  const list = [
    { id: 'a', next_on: '2026-11-10', stage: 'contacted', unsubscribed_at: null },
    { id: 'b', next_on: '2026-11-12', stage: 'contacted', unsubscribed_at: null },
    { id: 'c', next_on: '2026-11-09', stage: 'replied', unsubscribed_at: null },
    { id: 'd', next_on: '2026-11-08', stage: 'new', unsubscribed_at: null },
  ] as any[];
  assert.deepEqual(dueFollowUps(list, '2026-11-10').map((p) => p.id), ['d', 'a']);
  const f = funnel([{ stage: 'new' }, { stage: 'contacted' }, { stage: 'replied' }, { stage: 'call' }, { stage: 'won' }] as any[], [{ prospect_id: 'x', sent_at: '2026-11-09T10:00:00Z', status: 'sent' }], '2026-11-10');
  assert.equal(f.reached, 4);
  assert.equal(f.replyRate, 3 / 4);
  assert.equal(f.sentThisWeek, 1);
});

test('importing a prospect list from a spreadsheet', () => {
  const csv = 'Clinic,Owner,Email,Phone,Website,Town,Instagram\n"Willow Skin Ltd",Amy Walker,AMY@willow.example,01632 960123,https://www.willow.example/,Harrogate,@willowskin\n,No name,x@y.z,,,,\nGlow Studio,Jo,,07700 900111,glow.example,Leeds,';
  const { rows, skipped } = prospectsFromCsv(csv);
  assert.equal(skipped, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].business_name, 'Willow Skin Ltd');
  assert.equal(rows[0].company_type, 'limited', '“Ltd” in the name means a limited company');
  assert.equal(rows[0].email, 'amy@willow.example');
  assert.equal(rows[1].company_type, 'unknown');
  assert.ok(sameProspect({ website: 'willow.example' }, { website: 'https://www.willow.example/contact' }));
  assert.ok(sameProspect({ phone: '+44 1632 960123' }, { phone: '01632 960123' }));
  assert.ok(!sameProspect({ email: 'a@b.c' }, { email: 'd@b.c' }));
});

test('the price book matches what gainora.co.uk shows today', () => {
  const site = '/home/claude/gainora-web/site.config.json';
  const web = toWebsitePrices(DEFAULT_PRICE_BOOK);
  if (existsSync(site)) {
    const cfg = JSON.parse(readFileSync(site, 'utf8')).prices;
    for (const k of ['audit', 'commandCentre']) assert.equal(web[k], cfg[k], k);
    for (const k of ['setup', 'monthly', 'foundingSetup', 'minimumMonths']) assert.equal(web.launchGrow[k], cfg.launchGrow[k], `launchGrow.${k}`);
    for (const k of ['setup', 'monthly', 'separateSetup', 'separateMonthly']) assert.equal(web.bundle[k], cfg.bundle[k], `bundle.${k}`);
    for (const t of ['never', 'booking', 'desk']) for (const k of ['name', 'setup', 'monthly', 'minutes']) assert.equal(web.cc[t][k], cfg.cc[t][k], `cc.${t}.${k}`);
    assert.equal(web.cc.extraMinutes, cfg.cc.extraMinutes);
    for (const k of ['setup', 'monthly', 'months']) assert.equal(web.cc.founding[k], cfg.cc.founding[k], `cc.founding.${k}`);
    for (const k of ['audit', 'focused', 'core', 'whole', 'monthly', 'minimumMonths']) assert.equal(web.partner[k], cfg.partner[k], `partner.${k}`);
  }
  const changed = DEFAULT_PRICE_BOOK.map((p) => (p.key === 'command-centre' ? { ...p, monthly: 349 } : p));
  assert.equal(toWebsitePrices(changed).commandCentre, '£349');
  const t = proposalTotals([fromPriceItem(DEFAULT_PRICE_BOOK.find((p) => p.key === 'capture-booking')!), fromPriceItem(DEFAULT_PRICE_BOOK.find((p) => p.key === 'command-centre')!)]);
  assert.deepEqual(t, { monthly: 698, today: 995, minimum: 3, firstYear: 995 + 698 * 12 });
  assert.deepEqual(packagesFromGrants(['watcher', 'scout', 'brief', 'website']), ['command', 'launch']);
});

test('client health: facts only, in plain words', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const a = { billing: 'active' as const, overdue: 0, packages: ['capture' as const], status: 'active' as const, renewsOn: null };
  assert.deepEqual(healthOf(a, { lastSignIn: '2026-11-09T09:00:00Z', startedOn: '2026-09-01', enquiries14: 12, visits14: null, oldestRequestDays: null }, now), { level: 'good', reasons: [] });
  const quiet = healthOf(a, { lastSignIn: '2026-10-20T09:00:00Z', startedOn: '2026-09-01', enquiries14: 0, visits14: null, oldestRequestDays: 5 }, now);
  assert.equal(quiet.level, 'watch');
  assert.deepEqual(quiet.reasons, ['Hasn’t signed in for 21 days', 'No enquiries through Capture & Convert in 14 days', 'A change they asked for has waited 5 days']);
  assert.equal(healthOf({ ...a, billing: 'past_due' }, { lastSignIn: '2026-11-09T09:00:00Z', startedOn: '2026-09-01', enquiries14: 3, visits14: null, oldestRequestDays: null }, now).level, 'risk');
  assert.equal(healthOf(a, { lastSignIn: null, startedOn: '2026-11-05', enquiries14: 0, visits14: null, oldestRequestDays: null }, now).level, 'good', 'a brand-new client isn’t flagged yet');
  const mail = resultsEmail('Amy', { month: '2026-10-01', capture: { enquiries: 23, calls: 17, afterHours: 6, booked: 9 }, website: { visitors: 412, contacts: 19 }, command: null })!;
  assert.equal(mail.subject, 'Your October with Gainora');
  assert.ok(mail.paragraphs.includes('Capture & Convert caught 23 enquiries, including 17 calls your receptionist answered (6 out of hours). 9 became bookings.'));
  assert.equal(resultsEmail('Amy', { month: '2026-10-01', capture: { enquiries: 0, calls: 0, afterHours: 0, booked: 0 }, website: null, command: null }), null, 'nothing to say, no email');
});

test('books: monthly costs, VAT threshold and repeating deadlines', () => {
  const ex = [
    { id: '1', supplier: 'Retell', category: 'Phone and calls', amount: 40, recurring: true, starts_on: '2026-09-01', ends_on: null, note: '' },
    { id: '2', supplier: 'Old tool', category: 'Hosting and software', amount: 10, recurring: true, starts_on: '2026-01-01', ends_on: '2026-10-31', note: '' },
    { id: '3', supplier: 'Laptop', category: 'Equipment', amount: 900, recurring: false, starts_on: '2026-11-03', ends_on: null, note: '' },
  ];
  assert.deepEqual(expensesIn('2026-11-01', ex).map((e) => e.id), ['1', '3']);
  assert.equal(sum(expensesIn('2026-10-01', ex)), 50);
  assert.equal(vatStatus(40_000).level, 'fine');
  assert.equal(vatStatus(70_000).level, 'near');
  assert.equal(vatStatus(91_000).level, 'over');
  assert.equal(nextOccurrence('2027-01-31', 'monthly'), '2027-02-28');
  assert.equal(nextOccurrence('2026-11-10', 'yearly'), '2027-11-10');
  assert.equal(nextOccurrence('2026-11-10', 'none'), null);
  assert.equal(dueSoon([{ id: 'a', title: 'x', category: '', due_on: '2026-11-20', repeat: 'none', note: '', done_at: null }, { id: 'b', title: 'y', category: '', due_on: '2027-01-31', repeat: 'yearly', note: '', done_at: null }], '2026-11-10').length, 1);
});

test('greeting people properly', async () => {
  const { firstName } = await import('../shared/admin/sales');
  assert.equal(firstName('Kate Moss'), 'Kate');
  assert.equal(firstName('Dr Priya Shah'), 'Dr Shah');
  assert.equal(firstName('Dr. Tom Ellis'), 'Dr Ellis');
  assert.equal(firstName('Mrs Jane Smith'), 'Jane');
  assert.equal(firstName('Mrs Smith'), 'Mrs Smith');
  assert.equal(firstName(''), 'there');
  assert.equal(firstName('Dr'), 'there');
  assert.equal(firstName('Mari and Carys'), 'Mari and Carys');
});
