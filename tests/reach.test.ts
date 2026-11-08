import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSample, adviseReach, bookingLinks, bookingPlatform, comparable, competitorKey, diffCompetitor, distanceKm, instagramHandle, mergeEvents, mergeTracked, newlyFound,
  postsInLast, reviewsSince, sameBusiness, searchTerms, validateCaptionFindings, validateOffers, validateServices, type FoundPlace, type TrackedCompetitor,
} from '../shared/competitors';
import { classifyGraphError, DISCOVERY_FIELDS, discoveryErrorText, exchangeTokenUrl, isoFromGraph, parseDiscovery } from '../shared/instagram';
import { planToday } from '../shared/today';
import { writeBrief } from '../shared/brief-writer';
import { analyseWeeks, metricsFor } from '../shared/metrics';
import { emptyProfile, SECTIONS, validateSection } from '../src/lib/questions';
import { SAMPLE_PROFILE } from '../src/lib/demo';

const DAY = 86_400_000;
const now = new Date('2026-11-08T06:00:00Z');
const d = (n: number) => new Date(now.getTime() - n * DAY).toISOString();

const tracked = (over: Partial<TrackedCompetitor>): TrackedCompetitor => ({
  key: 'p:x', name: 'The Beauty Room', source: 'found', url: 'https://beautyroom.example', placeId: 'x', rating: 4.8, count: 120, history: [], services: [], offers: [], bookingPages: [], social: null, firstSeenAt: d(40), ...over,
});

/* ---------- What to search for, and where ---------- */
test('reach: search terms come from what the business sells, with the industry as fallback', () => {
  assert.deepEqual(searchTerms({ business: { industry: 'Hair, beauty and wellbeing', oneLiner: 'Aesthetics clinic offering lip filler and anti-wrinkle injections' }, offer: { products: 'Dermal filler, skin boosters' } }), ['aesthetics clinic']);
  assert.deepEqual(searchTerms({ business: { industry: 'Hair, beauty and wellbeing', oneLiner: 'Hair salon and nail bar' }, offer: { products: 'Cuts, colour, gel nails' } }), ['nail salon', 'hair salon']);
  assert.deepEqual(searchTerms(SAMPLE_PROFILE), ['homeware and gift shop']);
  assert.deepEqual(searchTerms({ business: { industry: 'Property', oneLiner: 'We let flats' }, offer: { products: 'Lettings' } }), ['estate agent']);
  assert.deepEqual(searchTerms({ business: { industry: 'Other', oneLiner: 'Something unusual' }, offer: {} }), []);
});

test('reach: distances and business matching', () => {
  assert.equal(distanceKm({ lat: 50.1531, lng: -5.0705 }, { lat: 50.1531, lng: -5.0705 }), 0);
  assert.ok(Math.abs(distanceKm({ lat: 50.1531, lng: -5.0705 }, { lat: 50.2632, lng: -5.051 }) - 12.3) < 0.5); // Falmouth to Truro
  assert.ok(sameBusiness({ name: 'The Beauty Room Ltd', url: '' }, { name: 'Beauty Room', url: '' }));
  assert.ok(sameBusiness({ name: 'A', url: 'https://www.beautyroom.example/' }, { name: 'B', url: 'http://beautyroom.example/book' }));
  assert.ok(!sameBusiness({ name: 'Glow Clinic', url: '' }, { name: 'Glow Hair', url: '' }));
  assert.equal(competitorKey({ name: 'X', placeId: 'abc' }), 'p:abc');
  assert.equal(competitorKey({ name: 'X', url: 'https://www.x.co.uk/' }), 'h:x.co.uk');
  assert.equal(competitorKey({ name: 'The Beauty Room' }), 'n:the-beauty-room');
});

/* ---------- Review velocity ---------- */
test('reach: new reviews in 30 days come from sampled counts, and need enough history', () => {
  assert.equal(reviewsSince([], 30, now), null);
  assert.equal(reviewsSince([{ at: d(1), rating: 4.5, count: 100 }], 30, now), null);
  assert.equal(reviewsSince([{ at: d(2), rating: 4.5, count: 100 }, { at: d(0), rating: 4.5, count: 103 }], 30, now), null); // only two days of watching
  assert.equal(reviewsSince([{ at: d(35), rating: 4.5, count: 100 }, { at: d(28), rating: 4.5, count: 103 }, { at: d(0), rating: 4.5, count: 114 }], 30, now), 14);
  assert.equal(reviewsSince([{ at: d(10), rating: 4.5, count: 100 }, { at: d(0), rating: 4.5, count: 106 }], 30, now), 6); // ten days in: use the oldest sample
  const h = addSample(addSample([], 4.5, 100, new Date(now.getTime() - 3600_000)), 4.5, 101, now);
  assert.equal(h.length, 1, 'one sample a day');
  assert.equal(h[0].count, 101);
});

/* ---------- Booking pages ---------- */
test('reach: public booking pages are spotted from a website, logins are not', () => {
  const html = '<a href="https://www.fresha.com/a/the-beauty-room-falmouth-abc">Book</a><a href="https://www.fresha.com/login">x</a><a href="https://widget.treatwell.co.uk/place/the-beauty-room/">Treatwell</a><a href="https://instagram.com/beautyroom">IG</a><a href="/contact">c</a>';
  const links = bookingLinks(html, 'https://beautyroom.example/');
  assert.deepEqual(links, ['https://www.fresha.com/a/the-beauty-room-falmouth-abc', 'https://widget.treatwell.co.uk/place/the-beauty-room/']);
  assert.equal(bookingPlatform(links[0]), 'Fresha');
  assert.equal(bookingPlatform(links[1]), 'Treatwell');
});

/* ---------- Verbatim checks ---------- */
test('reach: services keep only names on the page with a price printed on it; paraphrases and invented prices are dropped', () => {
  const sources = { 'https://beautyroom.example/prices': 'Treatments\nLip Filler 1ml £220\nAnti-wrinkle injections from £180\nDermaplaning £45\nDeposit £20' };
  const raw = [
    { name: 'Lip Filler 1ml', price: '£220', url: 'https://beautyroom.example/prices' },
    { name: 'Anti-wrinkle injections', price: 'from £180', url: 'https://beautyroom.example/prices' },
    { name: 'Lip augmentation', price: '£220', url: 'https://beautyroom.example/prices' },          // paraphrased name
    { name: 'Dermaplaning', price: '£55', url: 'https://beautyroom.example/prices' },               // price not on page
    { name: 'Dermaplaning', price: '£45', url: 'https://beautyroom.example/other' },                // unknown page
    { name: 'Dermaplaning', price: '£45', url: 'http://www.beautyroom.example/prices/' },           // same page, different spelling
  ];
  const out = validateServices(raw, sources, d(0));
  assert.deepEqual(out.map((s) => [s.name, s.price]), [['Lip Filler 1ml', '£220'], ['Anti-wrinkle injections', 'from £180'], ['Dermaplaning', '£45']]);
  assert.equal(out[2].url, 'https://beautyroom.example/prices');
});

test('reach: offers must be quoted verbatim from the page or the caption', () => {
  const sources = { 'https://beautyroom.example/': 'Welcome\n20% off lip filler in November, book online\nGift vouchers' };
  const out = validateOffers([{ text: '20% off lip filler in November', url: 'https://beautyroom.example/' }, { text: '20% off all fillers this month', url: 'https://beautyroom.example/' }, { text: 'Gift', url: 'https://beautyroom.example/' }], sources, d(0));
  assert.deepEqual(out.map((o) => o.text), ['20% off lip filler in November']);
  const posts = [{ id: 'm1', caption: 'November offer: 20% off lip filler for new clients. DM to book.', at: d(1), likes: 10, comments: 1, url: 'https://www.instagram.com/p/abc/' }];
  const f = validateCaptionFindings([{ postId: 'm1', text: '20% off lip filler for new clients' }, { postId: 'm1', text: '20% off lip filler for everyone' }, { postId: 'nope', text: 'November offer' }], posts, d(0));
  assert.deepEqual(f.map((x) => [x.text, x.url, x.from]), [['20% off lip filler for new clients', 'https://www.instagram.com/p/abc/', 'instagram']]);
  assert.equal(instagramHandle('@The.BeautyRoom'), 'The.BeautyRoom');
  assert.equal(instagramHandle('https://www.facebook.com/x'), '');
  assert.equal(postsInLast(posts, 30, now), 1);
});

/* ---------- The watched list ---------- */
const found: FoundPlace[] = [
  { placeId: 'g1', name: 'Glow Aesthetics', address: 'High St', url: 'https://glow.example', rating: 4.9, count: 210, distanceKm: 0.4, mapsUrl: 'm1' },
  { placeId: 'g2', name: 'Skin Studio', address: 'Church St', rating: 4.7, count: 80, distanceKm: 1.2, mapsUrl: 'm2' },
  { placeId: 'g3', name: 'The Beauty Room', address: 'Quay St', url: 'https://beautyroom.example', rating: 4.8, count: 120, distanceKm: 0.9, mapsUrl: 'm3' },
  { placeId: 'g4', name: 'Face Place', address: 'A', rating: 4.5, count: 30, distanceKm: 2.5, mapsUrl: 'm4' },
  { placeId: 'g5', name: 'Lash Lab', address: 'B', rating: 5, count: 12, distanceKm: 3.1, mapsUrl: 'm5' },
  { placeId: 'g6', name: 'Brow Bar', address: 'C', rating: 4.6, count: 44, distanceKm: 3.4, mapsUrl: 'm6' },
  { placeId: 'g7', name: 'Nail Nook', address: 'D', rating: 4.4, count: 22, distanceKm: 4.0, mapsUrl: 'm7' },
  { placeId: 'g8', name: 'Far Away Spa', address: 'E', rating: 4.8, count: 300, distanceKm: 9.0, mapsUrl: 'm8' },
];

test('reach: typed competitors come first, the closest found ones fill up to five, the rest wait nearby, dismissed ones never return', () => {
  const typed = [{ name: 'The Beauty Room', url: 'https://beautyroom.example' }, { name: 'Rival With No Listing', url: '' }];
  const { list, nearby } = mergeTracked(undefined, typed, found, [{ key: 'p:g4', name: 'Face Place' }], now);
  assert.deepEqual(list.map((c) => `${c.name}:${c.source}`), ['The Beauty Room:typed', 'Rival With No Listing:typed', 'Glow Aesthetics:found', 'Skin Studio:found', 'Lash Lab:found', 'Brow Bar:found', 'Nail Nook:found']);
  assert.equal(list[0].placeId, 'g3', 'a typed competitor that Google also found gets its listing attached');
  assert.equal(list[0].distanceKm, 0.9);
  assert.deepEqual(nearby.map((n) => n.name), ['Far Away Spa']);
  // Next month: history and services carry over by key; a found one that drops out of Google's results stays watched.
  const prev = list.map((c) => (c.key === 'p:g1' ? { ...c, history: [{ at: d(7), rating: 4.9, count: 205 }], services: [{ name: 'Lip filler', price: '£200', url: 'https://glow.example', seenAt: d(7) }] } : c));
  const again = mergeTracked(prev, typed, found.filter((f) => f.placeId !== 'g2'), [{ key: 'p:g4', name: 'Face Place' }], now);
  assert.equal(again.list.find((c) => c.key === 'p:g1')!.services.length, 1);
  assert.ok(again.list.some((c) => c.key === 'p:g2'), 'still watched');
  // With no search this run, found is empty and the list simply carries over.
  assert.equal(mergeTracked(prev, typed, [], [], now).list.length, prev.length);
});

/* ---------- What changed ---------- */
test('reach: changes between two days become plain events; the first sight never does', () => {
  const prev = tracked({
    services: [{ name: 'Lip filler 1ml', price: '£220', url: 'u', seenAt: d(7) }, { name: 'Dermaplaning', price: '£45', url: 'u', seenAt: d(7) }],
    offers: [], history: [{ at: d(42), rating: 4.8, count: 90 }, { at: d(35), rating: 4.8, count: 93 }, { at: d(28), rating: 4.8, count: 96 }, { at: d(7), rating: 4.8, count: 104 }],
    social: { handle: 'beautyroom', url: 'https://www.instagram.com/beautyroom/', checkedAt: d(1), followers: 1000, mediaCount: 10, followersHistory: [{ at: d(7), n: 1000 }], postsLast30: 4, posts: [], findings: [], error: null },
  });
  const next = tracked({
    services: [{ name: 'Lip filler 1ml', price: '£240', url: 'u', seenAt: d(0) }, { name: 'Dermaplaning', price: '£45', url: 'u', seenAt: d(0) }, { name: 'Profhilo', price: '£300', url: 'u', seenAt: d(0) }],
    offers: [{ text: '20% off lip filler in November', url: 'u', seenAt: d(0), from: 'website' }],
    history: [...prev.history, { at: d(0), rating: 4.8, count: 110 }], count: 110,
    social: { ...prev.social!, followers: 1200, followersHistory: [{ at: d(7), n: 1000 }, { at: d(0), n: 1200 }], findings: [{ text: 'free consultation this week', url: 'https://www.instagram.com/p/z/', seenAt: d(0), from: 'instagram' }] },
  });
  assert.deepEqual(diffCompetitor(undefined, next, { reviews30: 2 }, now), []);
  const ev = diffCompetitor(prev, next, { reviews30: 2 }, now);
  assert.deepEqual(ev.map((e) => e.kind), ['service', 'price', 'offer', 'reviews', 'post', 'followers']);
  assert.equal(ev[0].summary, 'The Beauty Room now lists “Profhilo” at £300.');
  assert.equal(ev[1].summary, 'The Beauty Room changed the price of lip filler 1ml from £220 to £240.');
  assert.equal(ev[3].summary, 'The Beauty Room got 17 new Google reviews in the last 30 days; you got 2.');
  assert.match(ev[3].detail!, /sign of how busy/);
  assert.equal(ev[5].summary, 'The Beauty Room’s Instagram grew from 1,000 to 1,200 followers in a week.');
  // No surge when the owner is getting as many reviews.
  assert.ok(!diffCompetitor(prev, next, { reviews30: 15 }, now).some((e) => e.kind === 'reviews'));
  // Events merge without duplicates and keep the newest first.
  const m = mergeEvents(ev.slice(0, 2), ev);
  assert.equal(m.added.length, 4);
  assert.equal(m.events.length, 6);
  const opened = newlyFound([prev], [prev, tracked({ key: 'p:new', name: 'New Clinic', count: 3, distanceKm: 0.7, mapsUrl: 'm' })], now);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].summary, 'New on Google near you: New Clinic, 700 m away (3 reviews).');
  assert.equal(newlyFound(undefined, [prev], now).length, 0, 'first run is not "new"');
});

test('reach: rule-based advice compares like with like and never talks about bookings', () => {
  const list = [tracked({ services: [{ name: 'Lip filler 1ml', price: '£240', url: 'u', seenAt: d(0) }, { name: 'Brow lamination', price: '£40', url: 'u', seenAt: d(0) }] })];
  const you = { rating: 4.6, count: 60, reviews30: 2, services: [{ name: 'Lip Filler (1ml)', price: '£200', url: 'y', seenAt: d(0) }] };
  const events = [{ id: 'r', at: d(1), key: 'p:x', competitor: 'The Beauty Room', kind: 'reviews' as const, summary: 'The Beauty Room got 17 new Google reviews in the last 30 days; you got 2.' }];
  const lines = adviseReach(list, you, events, now);
  assert.match(lines[0].text, /sign of how busy they look/);
  assert.match(lines[0].action, /review/i);
  assert.match(lines[1].text, /charges £240 for lip filler 1ml; you charge £200 .*£40 less/);
  assert.ok(lines.every((l) => !/\d+ bookings|revenue|turnover/i.test(l.text)));
  assert.ok(comparable('Lip filler 1ml', 'Lip Filler (1ml)'));
  assert.ok(!comparable('Lip filler 1ml', 'Brow lamination'));
  assert.match(adviseReach([], you, [], now).length ? 'x' : 'none', /none/);
});

/* ---------- Instagram: Business Discovery responses ---------- */
const DISCOVERY = {
  business_discovery: {
    username: 'thebeautyroom', followers_count: 4120, media_count: 612, website: 'https://beautyroom.example', id: '17841400000000001',
    media: { data: [
      { id: '17900000000000001', caption: 'November offer: 20% off lip filler for new clients. DM to book.', timestamp: '2026-11-07T10:00:00+0000', like_count: 86, comments_count: 7, permalink: 'https://www.instagram.com/p/abc123/', media_type: 'IMAGE' },
      { id: '17900000000000002', caption: 'New: Profhilo now available, £300 for two sessions.', timestamp: '2026-11-02T09:30:00+0000', like_count: 142, comments_count: 12, permalink: 'https://www.instagram.com/p/def456/', media_type: 'CAROUSEL_ALBUM' },
    ], paging: { cursors: { before: 'x', after: 'y' } } },
  },
  id: '17841400000000099',
};
const NOT_BUSINESS = { error: { message: '(#110) Business Discovery: User not found', type: 'OAuthException', code: 110, fbtrace_id: 'AbC' } };

test('instagram: a recorded Business Discovery response becomes a profile with posts; errors are classified', () => {
  assert.match(DISCOVERY_FIELDS('thebeautyroom'), /^business_discovery\.username\(thebeautyroom\)\{username,followers_count,media_count,website,media\.limit\(12\)\{id,caption,timestamp,like_count,comments_count,permalink,media_type\}\}$/);
  const r = parseDiscovery(DISCOVERY, 'thebeautyroom');
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.followers, 4120); assert.equal(r.mediaCount, 612); assert.equal(r.posts.length, 2);
    assert.equal(r.posts[0].at, '2026-11-07T10:00:00.000Z');
    assert.equal(r.posts[0].url, 'https://www.instagram.com/p/abc123/');
    assert.equal(r.posts[1].likes, 142);
  }
  const e = parseDiscovery(NOT_BUSINESS, 'someone');
  assert.ok(!e.ok && e.error === 'not-business');
  assert.equal(discoveryErrorText['not-business'], 'This account is personal or private, so its posts can’t be read.');
  assert.equal(classifyGraphError({ code: 4, message: 'Application request limit reached' }), 'rate-limited');
  assert.equal(classifyGraphError({ code: 190, message: 'Error validating access token' }), 'token');
  assert.equal(classifyGraphError({ code: 1, message: 'Unknown' }), 'unavailable');
  assert.equal(isoFromGraph('2026-11-07T10:00:00+0100'), '2026-11-07T09:00:00.000Z');
  assert.match(exchangeTokenUrl('123', 'sec', 'tok'), /^https:\/\/graph\.facebook\.com\/v26\.0\/oauth\/access_token\?grant_type=fb_exchange_token&client_id=123&client_secret=sec&fb_exchange_token=tok$/);
});

/* ---------- End to end: a day of reach with every outside service faked ---------- */
const SITES: Record<string, string> = {
  'https://glow.example/': '<title>Glow</title><a href="/prices">Prices</a><a href="https://www.fresha.com/a/glow-aesthetics-123">Book</a><footer><a href="https://www.instagram.com/glowaesthetics/">IG</a><a href="https://facebook.com/glowaesthetics">FB</a></footer>',
  'https://glow.example/prices': '<h1>Price list</h1><p>Lip filler 1ml £220</p><p>Anti-wrinkle one area £150</p><p>Dermaplaning £45</p>',
  'https://www.fresha.com/a/glow-aesthetics-123': '<div>Glow Aesthetics</div><div>Profhilo 2 sessions £300</div><div>Skin booster £180</div><p>20% off lip filler in November</p>',
  'https://you.example/': '<title>You</title><a href="/treatments">Treatments</a><p>Lip filler 1ml £200</p><p>Dermaplaning £40</p>',
  'https://you.example/treatments': '<p>Lip filler 1ml £200</p><p>Dermaplaning £40</p>',
};
let glowPriceVersion = 0;

function fakeNetwork(log: { url: string; body?: any }[]) {
  const ai = (payload: any) => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
  return async (url: any, init: any) => {
    const u = String(url);
    log.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.startsWith('http://supabase.test/')) {
      if (u.includes('job_state')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(init?.method === 'POST' ? '[]' : '[]', { status: 200 });
    }
    if (u.includes('places:searchText')) {
      const q = JSON.parse(init.body).textQuery as string;
      if (/aesthetics clinic/.test(q)) return new Response(JSON.stringify({ places: [
        { id: 'ChIJ_you_place_0001', displayName: { text: 'Willow Skin' }, formattedAddress: 'Falmouth', rating: 4.6, userRatingCount: 60, websiteUri: 'https://you.example', location: { latitude: 50.153, longitude: -5.07 } },
        { id: 'ChIJ_glow_000000001', displayName: { text: 'Glow Aesthetics' }, formattedAddress: 'High St, Falmouth', rating: 4.9, userRatingCount: 210, websiteUri: 'https://glow.example', location: { latitude: 50.155, longitude: -5.072 } },
        { id: 'ChIJ_skin_000000002', displayName: { text: 'Skin Studio' }, formattedAddress: 'Church St, Falmouth', rating: 4.7, userRatingCount: 80, location: { latitude: 50.16, longitude: -5.08 } },
      ] }), { status: 200 });
      // The typed competitor's own lookup.
      return new Response(JSON.stringify({ places: [{ id: 'ChIJ_beautyroom_003', displayName: { text: 'The Beauty Room' }, formattedAddress: 'Quay St', rating: 4.8, userRatingCount: 120 }] }), { status: 200 });
    }
    if (/places\/ChIJ_you_place_0001/.test(u)) return new Response(JSON.stringify({ id: 'ChIJ_you_place_0001', location: { latitude: 50.153, longitude: -5.07 } }), { status: 200 });
    if (/places\/ChIJ_glow_000000001/.test(u)) return new Response(JSON.stringify({ id: 'ChIJ_glow_000000001', rating: 4.9, userRatingCount: 228 }), { status: 200 });
    if (/places\/(ChIJ_skin_000000002|ChIJ_beautyroom_003)/.test(u)) return new Response(JSON.stringify({ id: 'x', rating: 4.7, userRatingCount: 81 }), { status: 200 });
    if (u.startsWith('https://graph.facebook.com/')) {
      if (/glowaesthetics/.test(u)) return new Response(JSON.stringify(DISCOVERY), { status: 200 });
      return new Response(JSON.stringify(NOT_BUSINESS), { status: 400 });
    }
    if (u === 'https://api.anthropic.com/v1/messages') {
      const text = JSON.parse(init.body).messages[0].content as string;
      if (/Instagram captions/.test(JSON.parse(init.body).system)) return ai({ findings: [{ postId: '17900000000000001', text: '20% off lip filler for new clients' }, { postId: '17900000000000002', text: 'Profhilo now available, £300 for two sessions' }, { postId: '17900000000000002', text: 'Profhilo is cheap' }] });
      if (/explaining the competition/.test(JSON.parse(init.body).system)) return ai({ lines: [{ key: 'p:ChIJ_glow_000000001', text: 'Glow Aesthetics charges £220 for lip filler 1ml against your £200.', action: 'Say what your price includes where it is shown.' }, { key: null, text: 'They must be taking 500 bookings a week.', action: 'Panic.' }] });
      if (/like-for-like price comparison/.test(JSON.parse(init.body).system)) return ai({ rows: [{ item: 'Lip filler 1ml', yours: { price: '£200', url: 'https://you.example/treatments' }, theirs: [{ price: glowPriceVersion ? '£240' : '£220', url: 'https://glow.example/prices' }] }] });
      // Services extraction: answer from whichever site the lines came from, with one paraphrase and one invented price to be dropped.
      if (/BUSINESS: Glow/.test(text)) return ai({ services: [
        { name: 'Lip filler 1ml', price: glowPriceVersion ? '£240' : '£220', url: 'https://glow.example/prices' }, { name: 'Anti-wrinkle one area', price: '£150', url: 'https://glow.example/prices' },
        { name: 'Dermaplaning', price: '£45', url: 'https://glow.example/prices' }, { name: 'Profhilo 2 sessions', price: '£300', url: 'https://www.fresha.com/a/glow-aesthetics-123' },
        { name: 'Skin booster', price: '£180', url: 'https://www.fresha.com/a/glow-aesthetics-123' }, { name: 'Botox', price: '£150', url: 'https://glow.example/prices' }, { name: 'Lip filler 1ml', price: '£999', url: 'https://glow.example/prices' },
      ], offers: [{ text: '20% off lip filler in November', url: 'https://www.fresha.com/a/glow-aesthetics-123' }, { text: 'Half price everything', url: 'https://glow.example/' }] });
      return ai({ services: [{ name: 'Lip filler 1ml', price: '£200', url: 'https://you.example/treatments' }, { name: 'Dermaplaning', price: '£40', url: 'https://you.example/treatments' }], offers: [] });
    }
    const page = SITES[u] ?? SITES[u.replace(/\/$/, '')] ?? SITES[`${u}/`];
    if (page) return new Response(u.includes('glow.example/prices') && glowPriceVersion ? page.replace('£220', '£240') : page, { status: 200, headers: { 'Content-Type': 'text/html' } });
    return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/html' } });
  };
}

const CLINIC: any = {
  business: { name: 'Willow Skin', ownerName: 'Hannah', website: 'https://you.example', instagram: '@willowskin', industry: 'Hair, beauty and wellbeing', location: 'Falmouth, Cornwall', oneLiner: 'Aesthetics clinic offering lip filler, anti-wrinkle injections and skin treatments.', teamSize: 'Just me', legalForm: 'Sole trader' },
  offer: { products: 'Lip filler, anti-wrinkle injections, dermaplaning', typicalPrice: '£200', salesChannels: ['In person'], bestSeller: 'Lip filler' },
  customers: { ideal: 'Women 30-55', sources: ['Instagram'], areas: ['Local'] },
  competitors: { list: [{ name: 'The Beauty Room', url: '' }], ourEdge: 'Nurse-led', theirEdge: '' },
  goals: { focus: 'More enquiries', target: '20 enquiries a week', obstacle: 'Time', timePerWeek: '2–5 hours' },
  preferences: { style: 'Short and direct' },
};

test('reach: a full day finds the clinic’s competition, reads their prices and Instagram, then spots a price rise the next week', async () => {
  const log: { url: string; body?: any }[] = [];
  const real = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', GOOGLE_API_KEY: 'g', ANTHROPIC_API_KEY: 'sk-ant-api-test', META_IG_USER_ID: '17841400000000099', META_ACCESS_TOKEN: 'tok', AI_MONTHLY_CAP_USD: '100' });
  globalThis.fetch = fakeNetwork(log) as any;
  glowPriceVersion = 0;
  try {
    const { checkReach } = await import('../netlify/lib/reach');
    const day1 = await checkReach({ userId: 'u1', profile: CLINIC, prev: null, placeId: 'ChIJ_you_place_0001', you: { rating: 4.6, count: 60, history: [] }, now });
    const s = day1.state;
    // Who: the typed competitor plus the two found nearby; never the client's own listing.
    assert.deepEqual(s.list.map((c) => `${c.name}:${c.source}`), ['The Beauty Room:typed', 'Glow Aesthetics:found', 'Skin Studio:found']);
    assert.ok(!s.list.some((c) => c.placeId === 'ChIJ_you_place_0001'));
    assert.equal(s.list[0].placeId, 'ChIJ_beautyroom_003', 'typed competitor matched to its listing');
    const glow = s.list[1];
    assert.equal(glow.distanceKm, 0.3);
    assert.equal(glow.count, 210);
    assert.equal(glow.history.length, 1);
    // What they charge: website and Fresha page, verbatim-checked (Botox and £999 dropped), offer kept only where it really appears.
    assert.deepEqual(glow.services.map((x) => `${x.name} ${x.price}`), ['Lip filler 1ml £220', 'Anti-wrinkle one area £150', 'Dermaplaning £45', 'Profhilo 2 sessions £300', 'Skin booster £180']);
    assert.deepEqual(glow.bookingPages, ['https://www.fresha.com/a/glow-aesthetics-123']);
    assert.deepEqual(glow.offers.map((o) => o.text), ['20% off lip filler in November']);
    assert.equal(glow.instagram, 'https://www.instagram.com/glowaesthetics/');
    assert.equal(glow.facebook, 'https://www.facebook.com/glowaesthetics');
    // Instagram through Business Discovery: followers, posts and verbatim caption findings; the owner's own personal account is reported as such.
    assert.equal(glow.social?.followers, 4120);
    assert.equal(glow.social?.postsLast30, 2);
    assert.deepEqual(glow.social?.findings.map((f) => f.text), ['20% off lip filler for new clients', 'Profhilo now available, £300 for two sessions']);
    assert.equal(s.you?.instagram?.error, 'not-business');
    assert.deepEqual(s.you?.services?.map((x) => `${x.name} ${x.price}`), ['Lip filler 1ml £200', 'Dermaplaning £40']);
    // First sight: no events, but advice exists and the number guard dropped the invented "500 bookings" line.
    assert.equal(s.events.length, 0);
    assert.equal(s.advice?.lines.length, 1);
    assert.match(s.advice!.lines[0].text, /£220/);
    // Cost: one location lookup, two nearby searches (one term, "aesthetics clinic"), one typed lookup.
    assert.equal(s.placesCalls?.n, 3);
    const places = log.filter((l) => l.url.includes('places.googleapis.com'));
    assert.ok(places.every((l) => !/reviews|photos|openingHours/.test(JSON.stringify(l))), 'small field masks only');
    const graph = log.filter((l) => l.url.startsWith('https://graph.facebook.com/'));
    assert.equal(graph.length, 2);
    assert.match(decodeURIComponent(graph[0].url), /\/v26\.0\/17841400000000099\?fields=business_discovery\.username\(willowskin\)\{username,followers_count/);
    const aiCalls = log.filter((l) => l.url.includes('anthropic'));
    assert.equal(aiCalls.length, 4, 'own services, Glow services, Glow captions, advice'); // Skin Studio has no website; The Beauty Room has none either

    // A week later: Glow puts lip filler up to £240 and gets 18 more reviews. Pages unchanged elsewhere are not sent to the AI again.
    glowPriceVersion = 1; log.length = 0;
    const later = new Date(now.getTime() + 7 * DAY);
    const day2 = await checkReach({ userId: 'u1', profile: CLINIC, prev: s, placeId: 'ChIJ_you_place_0001', you: { rating: 4.6, count: 61, history: [{ at: d(30), rating: 4.6, count: 58 }, { at: later.toISOString(), rating: 4.6, count: 61 }] }, now: later });
    const kinds = day2.added.map((e) => `${e.kind}:${e.competitor}`);
    assert.ok(kinds.includes('price:Glow Aesthetics'), kinds.join());
    assert.equal(day2.added.find((e) => e.kind === 'price')!.summary, 'Glow Aesthetics changed the price of lip filler 1ml from £220 to £240.');
    assert.equal(day2.added.find((e) => e.kind === 'price')!.url, 'https://glow.example/prices');
    assert.equal(day2.state.list[1].count, 228);
    assert.equal(day2.state.list[1].history.length, 2);
    assert.ok(!log.some((l) => l.url.includes('places:searchText')), 'no new nearby search within the month');
    const aiAgain = log.filter((l) => l.url.includes('anthropic')).map((l) => l.body.system as string);
    assert.equal(aiAgain.filter((x) => /lines of text copied/.test(x)).length, 1, 'only the changed site is extracted again');
    assert.equal(log.filter((l) => l.url.startsWith('https://graph')).length, 2, 'Instagram read once a day per account');
    // Price table reuses what was gathered: no second fetch of the sites.
    const { buildPriceTable } = await import('../netlify/lib/watcher');
    log.length = 0;
    const table = await buildPriceTable('u1', CLINIC, later, day2.gathered, day2.state.list);
    assert.equal(table?.rows.length, 1);
    assert.equal(table?.rows[0].theirs[0]?.price, '£240');
    assert.ok(!log.some((l) => l.url.startsWith('https://glow.example')), 'no refetch');
  } finally { globalThis.fetch = real; for (const k of ['GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'META_IG_USER_ID', 'META_ACCESS_TOKEN']) delete process.env[k]; }
});

test('reach: with no Google key, no Meta token and no website, the check still runs and reports nothing it cannot know', async () => {
  const real = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  for (const k of ['GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'META_IG_USER_ID', 'META_ACCESS_TOKEN']) delete process.env[k];
  globalThis.fetch = (async () => new Response('[]', { status: 200 })) as any;
  try {
    const { checkReach } = await import('../netlify/lib/reach');
    const r = await checkReach({ userId: 'u2', profile: { ...CLINIC, business: { ...CLINIC.business, website: '', instagram: '' } }, prev: null, placeId: null, you: { rating: null, count: null, history: [] }, now });
    assert.deepEqual(r.state.list.map((c) => c.name), ['The Beauty Room']);
    assert.equal(r.state.list[0].rating, null);
    assert.equal(r.state.list[0].social, null);
    assert.equal(r.state.nearby.length, 0);
    assert.equal(r.added.length, 0);
    assert.equal(r.state.placesCalls?.n, 0);
  } finally { globalThis.fetch = real; }
});

/* ---------- Owner actions ---------- */
test('reach: the owner can say "not a competitor", watch another business nearby and set an Instagram handle', async () => {
  const real = globalThis.fetch;
  const writes: any[] = [];
  const state = { site: '', competitors: { checkedAt: d(0), list: [tracked({ key: 'p:g1', name: 'Glow Aesthetics' }), tracked({ key: 'n:the-beauty-room', name: 'The Beauty Room', source: 'typed' })], nearby: [{ key: 'p:g9', placeId: 'g9', name: 'Skin Studio', address: 'x', rating: 4.7, count: 80, distanceKm: 1.2 }], dismissed: [], events: [{ id: 'e1', at: d(0), key: 'p:g1', competitor: 'Glow Aesthetics', kind: 'offer', summary: 'x' }] } };
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'h@x.co.uk' }), { status: 200 });
    if (u.includes('/rest/v1/entitlements')) return new Response(JSON.stringify([{ agent: 'watcher' }]), { status: 200 });
    if (u.includes('/rest/v1/watcher_state') && init?.method === 'POST') { writes.push(JSON.parse(init.body)); return new Response('[]', { status: 200 }); }
    if (u.includes('/rest/v1/watcher_state')) return new Response(JSON.stringify([{ state: structuredClone(state) }]), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as any;
  try {
    const { default: handler } = await import('../netlify/functions/competitors');
    const call = (b: any) => handler(new Request('http://x/api/competitors', { method: 'POST', body: JSON.stringify(b), headers: { Authorization: 'Bearer t' } }));
    assert.equal((await call({ op: 'dismiss', key: 'p:g1' })).status, 200);
    let comps = writes.at(-1).state.competitors;
    assert.deepEqual(comps.list.map((c: any) => c.key), ['n:the-beauty-room']);
    assert.equal(comps.dismissed[0].name, 'Glow Aesthetics');
    assert.equal(comps.events.length, 0, 'events about a dismissed business go too');
    const typed = await call({ op: 'dismiss', key: 'n:the-beauty-room' });
    assert.equal(typed.status, 400, 'typed competitors are edited under Your business');
    assert.equal((await call({ op: 'watch', key: 'p:g9' })).status, 200);
    comps = writes.at(-1).state.competitors;
    assert.ok(comps.list.some((c: any) => c.key === 'p:g9' && c.source === 'found'));
    assert.equal(comps.nearby.length, 0);
    assert.equal((await call({ op: 'instagram', key: 'p:g1', handle: '@glow.aesthetics' })).status, 200);
    assert.equal(writes.at(-1).state.competitors.list[0].instagram, 'https://www.instagram.com/glow.aesthetics/');
    assert.equal((await call({ op: 'instagram', key: 'p:g1', handle: 'not a handle!!' })).status, 400);
    assert.equal((await call({ op: 'find' })).status, 202);
  } finally { globalThis.fetch = real; }
});

/* ---------- Where the findings go: Today, the Brief, the questionnaire ---------- */
test('reach: a review surge and a new offer reach the Today list with honest wording', () => {
  const items = planToday({
    profile: SAMPLE_PROFILE, agents: ['watcher'], now,
    watcher: { site: 'https://example.com', up: true, responseMs: 500, uptime30d: 100, sslDaysLeft: 90, pagesChecked: 5, brokenLinks: [], issues: [], history: [], changes: [], reviews: null, speed: null, prices: null,
      competitors: { checkedAt: d(0), list: [], nearby: [], dismissed: [], events: [
        { id: 'a', at: d(1), key: 'k', competitor: 'Cove Living', kind: 'reviews', summary: 'Cove Living got 14 new Google reviews in the last 30 days; you got 3.' },
        { id: 'b', at: d(1), key: 'k', competitor: 'Cove Living', kind: 'post', summary: 'Cove Living posted on Instagram: “20% off all gift sets until Sunday”.' },
        { id: 'c', at: d(0), key: 'k2', competitor: 'Pendower Living', kind: 'new-nearby', summary: 'New on Google near you: Pendower Living, 1.6 km away (4 reviews).' },
        { id: 'old', at: d(20), key: 'k', competitor: 'Cove Living', kind: 'offer', summary: 'old' },
      ], advice: { at: d(0), lines: [{ key: 'k', text: 't', action: 'Offer a bundle instead of a discount.' }] } } },
    googleConfigured: false,
  }, 5);
  assert.deepEqual(items.map((i) => i.id), ['reach-a', 'reach-b', 'reach-c']);
  assert.equal(items[0].title, 'Ask your recent customers for a Google review');
  assert.match(items[0].why, /sign of how busy a business looks/);
  assert.match(items[1].why, /Offer a bundle instead of a discount/);
  assert.equal(items[2].link, '/watcher?tab=competitors');
});

test('reach: the Brief’s priorities can name the competitor move and its action', () => {
  const metrics = metricsFor(['Enquiries']);
  const changes = analyseWeeks([{ weekOf: '2026-10-26', values: { enquiries: 20 } }, { weekOf: '2026-11-02', values: { enquiries: 22 } }], metrics);
  const b = writeBrief(changes, SAMPLE_PROFILE, { competitor: { summary: 'Cove Living is advertising “20% off candles this November”.', action: 'Lead with free gift wrapping in your next two posts' } });
  assert.ok(b.actions.some((a) => /Lead with free gift wrapping in your next two posts \(cove Living is advertising/.test(a)), b.actions.join(' | '));
});

test('reach: naming competitors is optional now that the Watcher finds them', () => {
  const p = emptyProfile();
  const sec = SECTIONS.find((s) => s.id === 'competitors')!;
  p.competitors.list = [];
  p.competitors.ourEdge = 'Nurse-led and unhurried.';
  assert.deepEqual(validateSection(sec, p), {});
  p.competitors.list = [{ name: '', url: 'https://x.co.uk' }];
  assert.ok(validateSection(sec, p)['competitors.list']);
});
