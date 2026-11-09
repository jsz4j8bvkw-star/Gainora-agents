import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionLink, planToday } from '../shared/today';
import { SAMPLE_PROFILE_SHOP as SAMPLE_PROFILE } from '../src/lib/demo';
import type { Lead, Tender, WatcherState } from '../src/lib/types';

const DAY = 86_400_000;
const now = new Date('2026-11-08T09:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

const watcher = (over: Partial<WatcherState> = {}): WatcherState => ({
  site: 'https://example.com', up: true, responseMs: 800, uptime30d: 99.7, sslDaysLeft: 60, pagesChecked: 10,
  brokenLinks: [], issues: [], history: [], changes: [], reviews: null, speed: null, prices: null, ...over,
});
const lead = (over: Partial<Lead>): Lead => ({ id: 'l1', name: 'The Driftwood Room', location: 'Exeter', website: 'https://example.com', reason: 'Features local makers.', source: { title: 't', url: 'https://example.com' }, stage: 'to_contact', followUps: 0, createdAt: iso(now.getTime() - DAY), ...over });
const tender = (over: Partial<Tender>): Tender => ({ id: 't1', tenderId: 'x', title: 'Locally made gifts for visitor centre shops', buyer: 'Heritage trust', summary: '', value: 18000, deadline: iso(now.getTime() + 21 * DAY), url: 'https://www.contractsfinder.service.gov.uk/', region: null, sme: true, fit: 'strong', reason: 'They want locally made homeware.', status: 'new', foundAt: iso(now.getTime() - DAY), ...over });

test('today: a broken contact page and a 2-star review outrank a follow-up, and a published contract value is quoted', () => {
  const items = planToday({
    profile: SAMPLE_PROFILE, agents: ['watcher', 'scout', 'brief'], now,
    watcher: watcher({
      issues: [{ id: 'contact', level: 'urgent', title: 'Your contact page needs attention', detail: 'Your contact page returned an error.' }],
      reviews: { placeId: 'p', placeName: 'x', mapsUrl: 'https://maps', rating: 4.6, count: 87, previousCount: 84, checkedAt: iso(now.getTime()), competitors: [], reviews: [
        { id: 'rv1', author: 'Mark D.', rating: 2, text: 'Ordered a dinner set online and one bowl arrived chipped.', when: '2 days ago', isNew: true },
        { id: 'rv2', author: 'Emma R.', rating: 5, text: 'Lovely.', when: '4 days ago', isNew: true },
      ] },
    }),
    leads: [lead({ id: 'l1', stage: 'contacted', contactedAt: iso(now.getTime() - 4 * DAY), nextFollowUp: iso(now.getTime() - 3600_000) })],
    tenders: [tender({})],
    hasThisWeeksNumbers: true,
  }, 5);
  assert.deepEqual(items.map((i) => i.id), ['contact', 'review-rv1', 'follow-l1', 'tender-t1']);
  assert.equal(items[1].link, '/watcher?tab=reviews&review=rv1');
  assert.match(items[1].why, /Mark wrote 2 days ago: “Ordered a dinner set/);
  assert.match(items[2].why, /4 days ago/);
  assert.match(items[3].why, /published value of £18,000, closing in 21 days/);
  // Only the top three by default.
  assert.equal(planToday({ profile: SAMPLE_PROFILE, agents: ['watcher', 'scout', 'brief'], now, watcher: watcher(), leads: [lead({ id: 'a' }), lead({ id: 'b', name: 'B' })], tenders: [tender({})], hasThisWeeksNumbers: false }).length, 3);
});

test('today: agents not on the plan contribute nothing, and nothing new means an empty list', () => {
  const w = watcher({ reviews: { placeId: 'p', placeName: 'x', mapsUrl: '', rating: 5, count: 1, previousCount: 1, checkedAt: iso(now.getTime()), competitors: [], reviews: [] } });
  assert.deepEqual(planToday({ profile: SAMPLE_PROFILE, agents: ['watcher'], now, watcher: w, leads: [lead({})], tenders: [tender({})] }), []);
  const scoutOnly = planToday({ profile: SAMPLE_PROFILE, agents: ['scout'], now, watcher: w, leads: [lead({})] });
  assert.equal(scoutOnly.length, 1);
  assert.equal(scoutOnly[0].id, 'intro-l1');
  assert.equal(scoutOnly[0].link, '/scout?tab=leads&lead=l1');
});

test('today: a contract closing in two days is dropped below a lead, and a lapsing certificate jumps the queue', () => {
  const items = planToday({
    profile: SAMPLE_PROFILE, agents: ['watcher', 'scout'], now,
    watcher: watcher({ sslDaysLeft: 5 }),
    leads: [lead({})], tenders: [tender({ deadline: iso(now.getTime() + 2 * DAY) })],
  }, 5);
  assert.equal(items[0].id, 'ssl');
  assert.ok(items.findIndex((i) => i.id === 'intro-l1') < items.findIndex((i) => i.id === 'tender-t1'));
});

test('today: a revenue dip suggests win-back, and missing numbers ask for them', () => {
  const metric = { id: 'revenue', label: 'Revenue', unit: 'money' as const };
  const items = planToday({
    profile: SAMPLE_PROFILE, agents: ['brief'], now,
    changes: [{ metric, current: 1230, previous: 1532, change: -302, changePct: -19.7, average4: 1500, vsAveragePct: -18, direction: 'down' }],
    hasThisWeeksNumbers: false,
  });
  assert.deepEqual(items.map((i) => i.id), ['winback', 'numbers']);
  assert.match(items[0].why, /Revenue fell 19.7% on last week/);
});

test('actionLink: to-do items from the agents lead somewhere useful; the owner’s own do not', () => {
  assert.equal(actionLink({ agent: 'watcher', text: 'Reply to Mark D.’s 2-star review' }), '/watcher?tab=reviews');
  assert.equal(actionLink({ agent: 'scout', text: 'Follow up with The Driftwood Room today' }), '/scout?tab=leads');
  assert.equal(actionLink({ agent: 'scout', text: 'Look at the visitor centre contract before it closes' }), '/scout?tab=contracts');
  assert.equal(actionLink({ agent: 'watcher', text: 'Decide whether to match Cove Living’s free delivery threshold' }), '/watcher?tab=competitors');
  assert.equal(actionLink({ agent: 'watcher', text: 'Fix your contact page so enquiries reach you' }), '/watcher?tab=overview');
  assert.equal(actionLink({ agent: 'watcher', text: 'Shrink your photos (you can do this yourself)' }), '/watcher?tab=speed');
  assert.equal(actionLink({ agent: 'brief', text: 'Add this week’s numbers to The Brief' }), '/brief');
  assert.equal(actionLink({ agent: 'brief', text: 'Write down what drove the rise in enquiries so you can repeat it' }), '/brief');
  assert.equal(actionLink({ agent: 'you', text: 'Order more boxes' }), null);
});

/* ---------- Ask: which findings an answer came from ---------- */
import { parseSources, sourceCatalogue } from '../shared/ask';

test('ask: the SOURCES line is stripped and turned into links to the agent pages', () => {
  const cat = sourceCatalogue({ reviews: '8 Nov' });
  const r = parseSources('Reply to Mark D. first.\n\nThen chase The Driftwood Room.\n\nSOURCES: reviews, leads, made-up', cat);
  assert.equal(r.text, 'Reply to Mark D. first.\n\nThen chase The Driftwood Room.');
  assert.deepEqual(r.sources, [
    { title: 'The Watcher’s Google reviews (8 Nov)', url: '/watcher?tab=reviews' },
    { title: 'The Scout’s lead pipeline', url: '/scout?tab=leads' },
  ]);
  // Variations the model produces: bold, brackets, "none"; and a reply without the line keeps its text.
  assert.deepEqual(parseSources('Answer.\n**Sources:** [brief], [numbers]', cat).sources.map((s) => s.url), ['/brief', '/brief']);
  assert.deepEqual(parseSources('Answer.\nSOURCES: none', cat), { text: 'Answer.', sources: [] });
  assert.deepEqual(parseSources('Just an answer.', cat), { text: 'Just an answer.', sources: [] });
});
