import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, groupDay, summariseValue, valueSentence, type ValueEvent } from '../shared/value';
import { learnFrom, keywordsOf, type FeedbackRecord } from '../shared/learning';
import { carryDone, parsePageSpeed, scoreLabel } from '../shared/speed';
import { daysLeft, parseRelease, scoreTender, shortlist, type TenderRecord } from '../shared/tenders';
import { diffPriceTables, priceLines, pricePageCandidates, validatePriceTable, type PriceTable } from '../shared/prices';
import { followUpSent, isDue, moveLead, nextFollowUp } from '../shared/leads';
import { countWeekAgo, fallbackReply, markNew, parsePlace, parseSearch, pickCompetitorPlace, type ReviewItem } from '../shared/reviews';
import { cleanScoutResults } from '../netlify/lib/agents';
import { fetchNewTenders } from '../netlify/lib/contracts';
import { checkReviews } from '../netlify/lib/watcher';
import { SAMPLE_PROFILE } from '../src/lib/demo';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const ev = (kind: ValueEvent['kind'], title: string, when: string, amount?: number, agent: ValueEvent['agent'] = 'scout'): ValueEvent => ({ id: `${kind}-${title}-${when}`, kind, agent, title, at: when, amount: amount ?? null });

/* ---------- Results tracker ---------- */
test('results: counts, time saved and money only from real figures', () => {
  const events = [
    ev('lead_found', 'Lead found: The Linen Cupboard, Truro', '2026-11-03T10:00:00Z'),
    ev('lead_found', 'Lead found: Fern & Flint, Totnes', '2026-11-03T10:01:00Z'),
    ev('tender_found', 'Contract found: café crockery', '2026-11-04T09:00:00Z', 14000),
    ev('lead_won', 'Won: The Linen Cupboard', '2026-11-05T09:00:00Z', 1200, 'you'),
    ev('reply_drafted', 'Drafted a reply to Emma R.', '2026-11-05T11:00:00Z', undefined, 'watcher'),
    ev('brief_written', 'Weekly Brief written', '2026-10-20T08:00:00Z', undefined, 'brief'),
  ];
  const all = summariseValue(events);
  assert.equal(all.counts.lead_found, 2);
  assert.equal(all.minutesSaved, 15 + 15 + 15 + 0 + 10 + 30);
  assert.equal(all.wonValue, 1200);
  assert.equal(all.tenderValue, 14000);
  const nov = summariseValue(events, new Date('2026-11-01T00:00:00Z'));
  assert.equal(nov.counts.brief_written, 0);
  assert.equal(nov.events[0].kind, 'reply_drafted'); // newest first
  assert.equal(formatMinutes(330, true), '5h 30m');
  assert.equal(formatMinutes(330), '5 h 30 min');
  assert.equal(formatMinutes(45, true), '45m');
  assert.match(valueSentence(nov, 'in November'), /^In November your agents found 2 potential customers and 1 public contract, and drafted 1 message for you\.$/);
  assert.match(valueSentence(summariseValue([]), 'this month'), /getting started/);
});

test('results: runs of the same work on one day collapse into one line', () => {
  const day = ['A', 'B', 'C', 'D'].map((n, i) => ev('lead_found', `Lead found: ${n} Shop, Truro`, `2026-11-03T10:0${i}:00Z`));
  const lines = groupDay([...day, ev('draft_written', 'Drafted an introduction to A Shop', '2026-11-03T11:00:00Z')]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].title, '4 potential customers found: A Shop, B Shop, C Shop and 1 more');
  assert.equal(lines[1].title, 'Drafted an introduction to A Shop');
});

/* ---------- Learning ---------- */
const fb = (p: Partial<FeedbackRecord>): FeedbackRecord => ({ id: Math.random().toString(36), agent: 'scout', itemKind: 'lead', itemId: 'x', verdict: 'not_relevant', text: '', createdAt: '2026-11-01T10:00:00Z', ...p });

test('learning: dismissed leads are excluded, muted changes need two votes and no useful ones', () => {
  const l = learnFrom([
    fb({ itemKind: 'lead', text: 'Big Box Ltd, Bristol', host: 'https://www.bigbox.co.uk/', reason: 'Too big for us' }),
    fb({ itemKind: 'lead', text: 'Mega Store, Leeds', host: 'megastore.com', reason: 'Too big for us' }),
    fb({ agent: 'watcher', itemKind: 'change', changeKind: 'content', text: 'Updated their about page' }),
    fb({ agent: 'watcher', itemKind: 'change', changeKind: 'content', text: 'Changed a heading' }),
    fb({ agent: 'watcher', itemKind: 'change', changeKind: 'price', text: 'Raised mug prices' }),
    fb({ agent: 'watcher', itemKind: 'change', changeKind: 'price', text: 'Cut bowl prices' }),
    fb({ agent: 'watcher', itemKind: 'change', changeKind: 'price', verdict: 'useful', text: 'New price list' }),
  ]);
  assert.deepEqual(l.excludedNames.sort(), ['big box ltd', 'mega store']);
  assert.ok(l.excludedHosts.includes('bigbox.co.uk'));
  assert.deepEqual(l.mutedChangeKinds, ['content']); // price had a useful vote, so it stays on
  assert.ok(l.rules.some((r) => /general page updates/.test(r)));
  assert.ok(l.rules.some((r) => /Never suggest these again: .*Big Box Ltd/.test(r)));
});

test('learning: contract keywords dismissed twice become negative, useful ones win', () => {
  const l = learnFrom([
    fb({ itemKind: 'tender', text: 'Grounds maintenance and grass cutting' }),
    fb({ itemKind: 'tender', text: 'Grass cutting for parks' }),
    fb({ itemKind: 'tender', text: 'Parks signage' }),
    fb({ itemKind: 'tender', verdict: 'useful', text: 'Signage for visitor centre parks' }),
  ]);
  assert.ok(l.negativeKeywords.includes('grass'));
  assert.ok(l.negativeKeywords.includes('cutting'));
  assert.ok(!l.negativeKeywords.includes('park')); // also in a useful notice
  assert.ok(keywordsOf('Handmade Mugs and bowls').includes('mug'));
});

/* ---------- Google speed test ---------- */
const PSI = {
  lighthouseResult: {
    categories: { performance: { score: 0.54 }, accessibility: { score: 0.92 }, seo: { score: 0.88 }, 'best-practices': { score: 0.96 } },
    audits: {
      'uses-optimized-images': { score: 0.2, details: { overallSavingsMs: 900 } },
      'image-delivery-insight': { score: 0, metricSavings: { LCP: 1800 } },          // same plain fix, bigger saving
      'render-blocking-resources': { score: 0.5, details: { overallSavingsMs: 300 } },
      'uses-long-cache-ttl': { score: 0.4, details: { overallSavingsMs: 600 } },        // Low becomes Medium
      'meta-description': { score: 0 },
      'color-contrast': { score: 1 },                                                     // passing
      'font-display': { scoreDisplayMode: 'notApplicable' },
      'third-party-summary': { scoreDisplayMode: 'informative', details: { overallSavingsMs: 100 } }, // too small
    },
  },
  loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3400, category: 'AVERAGE' }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' } } },
};

test('speed: Google results become a short, ranked list of plain-English fixes', () => {
  const s = parsePageSpeed(PSI, at('2026-11-07T06:00:00Z'));
  assert.deepEqual(s.scores, { performance: 54, accessibility: 92, seo: 88, bestPractices: 96 });
  const titles = s.fixes.map((f) => f.title);
  assert.equal(titles.filter((t) => t === 'Shrink your photos').length, 1);
  assert.equal(s.fixes[0].title, 'Shrink your photos');
  assert.equal(s.fixes[0].impact, 'High');
  assert.match(s.fixes[0].saving!, /1\.8 s faster/);
  assert.equal(s.fixes.find((f) => f.title === 'Let browsers remember your files')!.impact, 'Medium');
  assert.ok(titles.includes('Add a description for Google'));
  assert.ok(!titles.includes('Make some text easier to read'));
  assert.ok(!titles.includes('Cut back on outside widgets'));
  assert.deepEqual(s.field, { lcp: { value: '3.4 s', rating: 'Needs work' }, inp: undefined, cls: { value: '0.05', rating: 'Good' } });
  assert.equal(scoreLabel(54).label, 'Needs work');
  const next = carryDone({ ...s, fixes: s.fixes.map((f, i) => (i === 0 ? { ...f, done: true } : f)) }, parsePageSpeed(PSI));
  assert.equal(next.fixes[0].done, true);
  assert.equal(next.fixes[1].done, undefined);
});

/* ---------- Public contracts ---------- */
const RELEASE = {
  ocid: 'ocds-b5fd17-1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d', id: 'x', date: '2026-11-05T09:00:00Z',
  buyer: { name: 'Cornwall Council' },
  tender: {
    title: 'Locally made gifts and homeware for visitor centre shops',
    description: 'Supply of handmade ceramics, mugs, bowls and gifts for three visitor centres.',
    value: { amount: 18000, currency: 'GBP' }, tenderPeriod: { endDate: '2026-11-28T12:00:00Z' },
    classification: { id: '39221000' }, items: [{ deliveryAddresses: [{ region: 'South West' }] }],
    suitability: { sme: true },
  },
};
const profile: any = { ...SAMPLE_PROFILE, business: { ...SAMPLE_PROFILE.business, industry: 'Retail and e-commerce', teamSize: '2–5' } };

test('contracts: an OCDS release becomes a notice with a working link', () => {
  const t = parseRelease(RELEASE)!;
  assert.equal(t.url, 'https://www.contractsfinder.service.gov.uk/Notice/1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d');
  assert.equal(t.buyer, 'Cornwall Council');
  assert.equal(t.value, 18000);
  assert.equal(t.region, 'South West');
  assert.equal(t.sme, true);
  assert.deepEqual(t.cpv, ['39221000']);
  assert.equal(parseRelease({ ocid: 'x', tender: {} }), null);
  assert.equal(daysLeft(t.deadline, at('2026-11-07T12:00:00Z')), 21);
});

test('contracts: matching rewards what they sell, rules out the impossible', () => {
  const now = at('2026-11-07T12:00:00Z');
  const t = parseRelease(RELEASE)!;
  const good = scoreTender(t, profile, null, now);
  assert.ok(good.score >= 4, `score ${good.score}`);
  assert.ok(good.matched.length > 0);
  assert.equal(scoreTender({ ...t, deadline: '2026-11-08T10:00:00Z' }, profile, null, now).score, -100); // closes too soon
  assert.ok(scoreTender({ ...t, value: 5_000_000 }, profile, null, now).score < 0);                    // too big for a small team
  const roads: TenderRecord = { ...t, id: 'roads', title: 'Highways resurfacing framework', description: 'Road resurfacing and drainage works.', cpv: ['45233000'] };
  assert.deepEqual(shortlist([roads, t], profile, null, 15, now).map((s) => s.tender.id), [t.id]);
});

test('contracts: the fetch follows the cursor and stops politely when rate-limited', async () => {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => {
    seen.push(String(url));
    if (seen.length === 1) return new Response(JSON.stringify({ releases: [RELEASE], links: { next: 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?cursor=abc' } }), { status: 200 });
    return new Response('Too many requests', { status: 403 });
  }) as any;
  try {
    const r = await fetchNewTenders('2026-11-05T00:00:00Z', '2026-11-07T00:00:00Z');
    assert.equal(r.tenders.length, 1);
    assert.equal(r.complete, false);
    assert.match(seen[0], /publishedFrom=2026-11-05T00%3A00%3A00&publishedTo=2026-11-07T00%3A00%3A00&stages=tender&limit=100/);
    assert.match(seen[1], /cursor=abc/);
  } finally { globalThis.fetch = real; }
});

/* ---------- Prices ---------- */
test('prices: only prices really on the page survive, and moves are spotted', () => {
  const sources = {
    'https://harbourhome.co.uk/shop': 'Large serving bowl £48\nMug £18',
    'https://cove.co.uk/collections/bowls/': 'Serving bowl £42.00\nMugs from £22',
  };
  const table: PriceTable = {
    checkedAt: '2026-11-07T06:00:00Z', competitors: ['Cove'],
    rows: [
      { item: 'Large serving bowl', yours: { price: '£48', url: 'https://harbourhome.co.uk/shop' }, theirs: [{ price: '£42', url: 'https://cove.co.uk/collections/bowls' }] }, // trailing slash differs
      { item: 'Mug', yours: { price: '£18', url: 'https://harbourhome.co.uk/shop' }, theirs: [{ price: '£19', url: 'https://cove.co.uk/collections/bowls/' }] },           // £19 is invented
      { item: 'Vase', yours: { price: '£30', url: 'https://made-up.example/' }, theirs: [null] },
    ],
  };
  const v = validatePriceTable(table, sources);
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].theirs[0]!.price, '£42');
  assert.equal(v.rows[0].theirs[0]!.url, 'https://cove.co.uk/collections/bowls/');
  const later = { ...v, rows: [{ ...v.rows[0], theirs: [{ price: '£45', url: 'https://cove.co.uk/collections/bowls/' }] }] };
  assert.deepEqual(diffPriceTables(v, later), [{ competitor: 'Cove', item: 'Large serving bowl', from: '£42', to: '£45' }]);
  assert.deepEqual(priceLines('Welcome\nBowl £48\nBowl £48\nAbout'), ['Bowl £48']);
  assert.deepEqual(pricePageCandidates([
    'https://x.co.uk/about', 'https://x.co.uk/shop/mugs/blue', 'https://x.co.uk/shop', 'https://x.co.uk/cart', 'https://x.co.uk/pricing', 'https://x.co.uk/menu.pdf',
  ]), ['https://x.co.uk/shop', 'https://x.co.uk/pricing', 'https://x.co.uk/shop/mugs/blue']);
});

/* ---------- Leads ---------- */
test('leads: follow-ups on day 4 and day 9 at 9am, never at the weekend', () => {
  const contacted = '2026-11-02T14:00:00Z'; // a Monday
  const first = new Date(nextFollowUp('contacted', contacted, 0)!);
  assert.equal(first.getDay(), 5); // Friday 6 November
  assert.equal(first.getHours(), 9);
  const second = new Date(nextFollowUp('contacted', contacted, 1)!);
  assert.equal(second.getDay(), 3); // Wednesday 11 November
  assert.equal(nextFollowUp('contacted', contacted, 2), null);
  assert.equal(nextFollowUp('replied', contacted, 0), null);
  const weekend = new Date(nextFollowUp('contacted', '2026-11-05T10:00:00Z', 0)!); // Thursday + 4 = Monday
  assert.equal(weekend.getDay(), 1);

  let lead = { stage: 'to_contact' as const, followUps: 0, contactedAt: null as string | null, nextFollowUp: null as string | null };
  const moved = moveLead(lead, 'contacted', at(contacted));
  assert.equal(moved.contactedAt, at(contacted).toISOString());
  assert.ok(moved.nextFollowUp);
  const once = followUpSent(moved);
  assert.equal(once.followUps, 1);
  const twice = followUpSent(once);
  assert.equal(twice.nextFollowUp, null);
  assert.equal(moveLead(moved, 'replied').nextFollowUp, null);
  assert.equal(isDue(moved.nextFollowUp, new Date(moved.nextFollowUp!)), true);
  assert.equal(isDue(moved.nextFollowUp, at('2026-11-03T12:00:00Z')), false);
});

/* ---------- Reviews ---------- */
const review = (id: string, rating: number, publishedAt?: string): ReviewItem => ({ id, author: `Person ${id}`, rating, text: 'Lovely shop', when: '1 week ago', publishedAt });

test('reviews: new ones are flagged for a week, old ones Google resurfaces are not', () => {
  const t0 = at('2026-11-01T06:00:00Z');
  const first = markNew(null, [review('a', 5)], t0);
  assert.equal(first[0].isNew, false); // first check: nothing is new
  const t1 = at('2026-11-02T06:00:00Z');
  const second = markNew(first, [review('b', 2, '2026-11-01T20:00:00Z'), review('old', 5, '2024-05-01T10:00:00Z'), review('a', 5)], t1);
  assert.deepEqual(second.map((r) => [r.id, r.isNew]), [['b', true], ['old', false], ['a', false]]);
  assert.equal(markNew(second, second, at('2026-11-05T06:00:00Z'))[0].isNew, true);
  assert.equal(markNew(second, second, at('2026-11-10T06:00:00Z'))[0].isNew, false);
  assert.equal(countWeekAgo([{ at: '2026-10-28T06:00:00Z', rating: 4.6, count: 84 }, { at: '2026-11-03T06:00:00Z', rating: 4.6, count: 86 }, { at: '2026-11-07T06:00:00Z', rating: 4.6, count: 87 }], at('2026-11-07T06:00:00Z')), 84);
  assert.equal(countWeekAgo([{ at: '2026-11-07T06:00:00Z', rating: 4.6, count: 87 }], at('2026-11-07T06:00:00Z')), 87);
});

test('reviews: competitor listings are matched by website or a clear name, never guessed', () => {
  const places = parseSearch({ places: [
    { id: '1', displayName: { text: 'Cove Pottery Studio' }, formattedAddress: 'Falmouth', rating: 4.4, userRatingCount: 50, websiteUri: 'https://www.covepottery.co.uk/' },
    { id: '2', displayName: { text: 'Saltwater Home' }, formattedAddress: 'Penryn', rating: 4.8, userRatingCount: 12 },
  ] });
  assert.equal(places[0].website, 'https://www.covepottery.co.uk/');
  assert.equal(pickCompetitorPlace(places, { name: 'Cove', url: 'https://covepottery.co.uk' })!.id, '1');
  assert.equal(pickCompetitorPlace(places, { name: 'Saltwater Home & Gifts' })!.id, '2');
  assert.equal(pickCompetitorPlace(places, { name: 'Harbour Lights' }), null);
  const parsed = parsePlace({ rating: 4.6, userRatingCount: 87, reviews: [{ name: 'places/x/reviews/1', rating: 2, authorAttribution: { displayName: 'Mark D.' }, originalText: { text: ' Bowl arrived chipped ' }, relativePublishTimeDescription: '2 days ago', publishTime: '2026-11-05T10:00:00Z' }] });
  assert.equal(parsed.reviews[0].text, 'Bowl arrived chipped');
  const reply = fallbackReply(parsed.reviews[0], 'Harbour & Home', 'Sarah');
  assert.match(reply, /^Mark, thank you/);
  assert.doesNotMatch(reply, /discount|voucher|refund/i);
});

test('reviews: a daily check spots new reviews and counts the ones Google has not shown yet', async () => {
  process.env.GOOGLE_API_KEY = 'test-key';
  const real = globalThis.fetch;
  const calls: { url: string; mask: string | null }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), mask: init?.headers?.['X-Goog-FieldMask'] ?? null });
    if (String(url).includes(':searchText')) {
      return new Response(JSON.stringify({ places: [{ id: 'c1', displayName: { text: 'Cove Pottery' }, rating: 4.4, userRatingCount: 51, websiteUri: 'https://covepottery.co.uk' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: 'ChIJ_test_place_001', displayName: { text: 'Harbour & Home' }, rating: 4.6, userRatingCount: 90,
      reviews: [
        { name: 'r-new', rating: 2, authorAttribution: { displayName: 'Mark D.' }, text: { text: 'Chipped bowl' }, publishTime: '2026-11-06T18:00:00Z' },
        { name: 'r-old', rating: 5, authorAttribution: { displayName: 'Emma R.' }, text: { text: 'Gorgeous' }, publishTime: '2026-10-20T18:00:00Z' },
      ],
    }), { status: 200 });
  }) as any;
  try {
    const p: any = { ...profile, competitors: { ...profile.competitors, list: [{ name: 'Cove Pottery', url: 'https://covepottery.co.uk' }] } };
    const prev: any = {
      placeId: 'ChIJ_test_place_001', placeName: 'Harbour & Home', mapsUrl: '', rating: 4.6, count: 87, previousCount: 85,
      reviews: [{ id: 'r-old', author: 'Emma R.', rating: 5, text: 'Gorgeous', when: '', isNew: false, seenAt: '2026-10-21T06:00:00Z' }],
      competitors: [{ name: 'Cove Pottery', rating: 4.4, count: 50 }], checkedAt: '2026-11-06T06:00:00Z', competitorsCheckedAt: '2026-11-04T06:00:00Z',
      history: [{ at: '2026-10-31T06:00:00Z', rating: 4.6, count: 85 }, { at: '2026-11-06T06:00:00Z', rating: 4.6, count: 87 }],
    };
    const r = await checkReviews('ChIJ_test_place_001', null, p, prev, at('2026-11-07T06:00:00Z'));
    assert.deepEqual(r.fresh.map((x) => x.author), ['Mark D.']);
    assert.equal(r.unseen, 2); // 90 - 87, minus the one we can see
    assert.equal(r.state.previousCount, 85);
    assert.equal(r.state.history!.length, 3);
    assert.ok(!calls.some((c) => c.url.includes(':searchText')), 'competitor ratings are weekly, not daily');
    assert.equal(calls[0].mask, 'id,displayName,rating,userRatingCount,reviews');
    const later = await checkReviews('ChIJ_test_place_001', null, p, { ...prev, competitorsCheckedAt: '2026-10-25T06:00:00Z' }, at('2026-11-07T06:00:00Z'));
    assert.equal(later.state.competitors[0].count, 51);
  } finally { globalThis.fetch = real; delete process.env.GOOGLE_API_KEY; }
});

/* ---------- The Scout learns ---------- */
test('Scout results drop anything the owner ruled out', () => {
  const raw: any[] = [
    { name: 'Big Box Ltd', location: 'Bristol', website: 'https://bigbox.co.uk', fit: 'strong', reason: 'Large homeware chain.', source_url: 'https://news.example/a' },
    { name: 'Fern & Flint', location: 'Totnes', website: 'https://fernandflint.co.uk', fit: 'strong', reason: 'Stocks local makers.', source_url: 'https://news.example/b' },
    { name: 'Tidewater Home', location: 'Fowey', website: 'https://tidewater.example', fit: 'possible', reason: 'Gift shop.', source_url: 'https://news.example/c' },
  ];
  const learned = learnFrom([fb({ text: 'Tidewater Home, Fowey' }), fb({ text: 'Other', host: 'https://bigbox.co.uk' })]);
  const out = cleanScoutResults(raw, profile, new Set(['news.example']), learned);
  assert.deepEqual(out.map((r) => r.name), ['Fern & Flint']);
  assert.equal(cleanScoutResults(raw, profile, new Set(['news.example'])).length, 3); // three arguments still work
});
