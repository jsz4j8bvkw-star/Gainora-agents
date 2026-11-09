import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbKindFor, decodeFocus, defaultFocus, encodeFocus, FOCUS, FOCUS_BY_MODE, looksLikeAPerson, PRIVATE_HOSTS, scoutMode, scrubPeople } from '../shared/scout';
import { cleanScoutResults } from '../netlify/lib/agents';
import { sizeVerdict, signalsFor, signalsForYou, type TrackedCompetitor } from '../shared/competitors';
import { SAMPLE_PROFILE } from '../src/lib/demo';

const clinic: any = { business: { industry: 'Hair, beauty and wellbeing', location: 'Crewe, Cheshire', website: 'https://you.example' }, offer: { salesChannels: ['In person'] }, customers: { ideal: 'Women aged 30 to 55 within 20 minutes of Crewe' }, goals: { focus: 'More enquiries' }, competitors: { list: [{ name: 'Glow', url: 'https://glow.example' }] } };

test('scout: a clinic’s customers are people, so it gets the consumer mode; a wholesaler keeps the business mode', () => {
  assert.equal(scoutMode(clinic), 'consumer');
  assert.equal(scoutMode(SAMPLE_PROFILE), 'consumer', 'the sample clinic');
  assert.equal(scoutMode({ ...clinic, goals: { focus: 'Find new wholesale or B2B clients' } }), 'b2b');
  assert.equal(scoutMode({ business: { industry: 'Manufacturing and wholesale' }, offer: {}, customers: {}, goals: {} }), 'b2b');
  assert.equal(scoutMode({ business: { industry: 'Creative and design' }, offer: {}, customers: { ideal: 'Marketing managers at mid-sized companies' }, goals: {} }), 'b2b');
  assert.deepEqual(FOCUS_BY_MODE.consumer, ['demand', 'communities', 'partners', 'local', 'corporate']);
  assert.deepEqual(FOCUS_BY_MODE.b2b, ['customers', 'local']);
  assert.equal(defaultFocus('consumer'), 'demand');
  assert.ok(FOCUS.demand.suggestions('Crewe', 'lip filler')[0].includes('Crewe'));
  // The focus survives the two-kind database column as a marker on the query, invisible to the owner.
  const enc = encodeFocus('People asking for lip filler near Crewe', 'demand');
  assert.equal(enc, '[demand] People asking for lip filler near Crewe');
  assert.equal(dbKindFor('demand'), 'customers');
  assert.equal(dbKindFor('local'), 'local');
  assert.deepEqual(decodeFocus(enc, 'customers'), { query: 'People asking for lip filler near Crewe', focus: 'demand' });
  assert.deepEqual(decodeFocus('Markets near Crewe', 'local'), { query: 'Markets near Crewe', focus: 'local' });
  assert.deepEqual(decodeFocus('Shops that could stock us', 'customers'), { query: 'Shops that could stock us', focus: 'customers' });
});

test('scout: public posts keep the question and the page, never the person', () => {
  assert.equal(scrubPeople('Anyone recommend lip filler near Crewe? asked by @sarah_j (u/crewemum)'), 'Anyone recommend lip filler near Crewe?');
  assert.ok(looksLikeAPerson('Sarah Jones'));
  assert.ok(looksLikeAPerson('@crewemum'));
  assert.ok(!looksLikeAPerson('Crewe Mums Group'));
  assert.ok(!looksLikeAPerson('Anyone recommend somewhere for lip filler near Crewe?'));
  assert.ok(PRIVATE_HOSTS.test('https://www.instagram.com/p/abc/'));
  assert.ok(PRIVATE_HOSTS.test('https://www.facebook.com/groups/crewemums/posts/123'));
  assert.ok(!PRIVATE_HOSTS.test('https://www.facebook.com/groups/crewemums/'), 'a group can be recommended by its public link');
  assert.ok(!PRIVATE_HOSTS.test('https://www.reddit.com/r/Crewe/comments/abc/lip_filler/'));
  const raw: any[] = [
    { name: 'Anyone recommend somewhere for lip filler near Crewe? (posted by u/crewemum)', platform: 'Reddit r/Crewe', location: 'Crewe', when: 'October 2026', fit: 'strong', reason: 'Asking for exactly this within 5 miles, no replies yet.', next: 'Reply on the thread.', draft: 'Hi, I run a nurse-led clinic in Crewe…', source_url: 'https://www.reddit.com/r/Crewe/comments/abc/lip_filler/', source_title: 'r/Crewe' },
    { name: 'Sarah Jones', platform: 'Mumsnet', location: 'Nantwich', fit: 'possible', reason: 'A mum asking about Botox prices', source_url: 'https://www.mumsnet.com/talk/x', source_title: 'Mumsnet' },
    { name: 'Best place for Botox in Cheshire?', platform: 'Facebook', location: 'Crewe', fit: 'strong', reason: 'x', source_url: 'https://www.facebook.com/groups/crewe/posts/999', source_title: 'FB' },
    { name: 'Where do you go for brows in Crewe?', platform: 'Nextdoor', location: 'Crewe', fit: 'possible', reason: 'Call me on 07700 900123 for details', source_url: 'https://nextdoor.co.uk/p/abc', source_title: 'Nextdoor' },
    { name: 'Lip filler recommendations Cheshire', platform: 'Reddit', location: 'Chester', fit: 'possible', reason: 'ok', source_url: 'https://www.reddit.com/r/Crewe/comments/abc/lip_filler/', source_title: 'dup' },
  ];
  const out = cleanScoutResults(raw, clinic, new Set(['reddit.com', 'mumsnet.com', 'facebook.com', 'nextdoor.co.uk']), null, 'demand');
  assert.deepEqual(out.map((r) => r.name), ['Anyone recommend somewhere for lip filler near Crewe?'], 'the person-named, the login-only, the phone-number and the duplicate post are all dropped');
  assert.equal(out[0].platform, 'Reddit r/Crewe');
  assert.equal(out[0].next, 'Reply on the thread.');
  assert.match(out[0].draft, /nurse-led clinic in Crewe/);
  assert.ok(!/u\//.test(out[0].name));
  // Groups: recommended by public link; partners: businesses, as before.
  const groups = cleanScoutResults([{ name: 'Crewe Mums Group', platform: 'Facebook group', location: 'Crewe', website: 'https://www.facebook.com/groups/crewemums/', fit: 'strong', reason: 'Local parents group', next: 'Join, read the rules, then post', draft: 'Hello, I’m Hannah…', source_url: 'https://www.facebook.com/groups/crewemums/', source_title: 'Group page' }] as any, clinic, new Set(['facebook.com']), null, 'communities');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].website, 'https://www.facebook.com/groups/crewemums/');
});

test('you vs them: size is described from public figures only, with the reasons, and says “looks”', () => {
  const now = new Date('2026-11-08T06:00:00Z');
  const d = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const you = signalsForYou({ rating: 4.9, count: 61, history: [{ at: d(35), rating: 4.9, count: 55 }, { at: d(0), rating: 4.9, count: 61 }], you: { venue: { platform: 'Fresha', url: 'u', rating: 5, reviews: 48, team: 1, serviceCount: 18, checkedAt: d(0) }, services: [{ name: 'Lip filler 1ml', price: '£200', url: '', seenAt: d(0) }, { name: 'Dermaplaning', price: '£40', url: '', seenAt: d(0) }], instagram: { handle: 'you', url: 'u', checkedAt: d(0), followers: 1200, mediaCount: 300, followersHistory: [], postsLast30: 5, posts: [], findings: [], error: null } }, website: '', instagram: '@you' }, now);
  assert.equal(you.startingPrice, 40);
  assert.equal(you.reviews30, 6);
  assert.equal(you.website, false);
  const glow: TrackedCompetitor = { key: 'p:g', name: 'Glow Aesthetics', source: 'found', url: 'https://glow.example', rating: 4.8, count: 212, history: [{ at: d(35), rating: 4.8, count: 190 }, { at: d(0), rating: 4.8, count: 212 }], services: [{ name: 'Lip filler 1ml', price: '£220', url: 'u', seenAt: d(0) }], offers: [], bookingPages: [], venue: { platform: 'Fresha', url: 'u', rating: 4.9, reviews: 320, team: 4, serviceCount: 42, checkedAt: d(0) }, social: { handle: 'glow', url: 'u', checkedAt: d(0), followers: 3800, mediaCount: 900, followersHistory: [], postsLast30: 12, posts: [], findings: [], error: null }, instagram: 'https://www.instagram.com/glow/', firstSeenAt: d(30), distanceKm: 2.1 };
  const v = sizeVerdict(you, signalsFor(glow, now));
  assert.match(v.text, /^Looks bigger or busier than you: more Google reviews, more new reviews this month and a bigger team\./);
  assert.ok(!/book|revenue|turnover/i.test(v.text));
  const small: TrackedCompetitor = { ...glow, key: 'p:s', name: 'Lash Bar', url: '', rating: 5, count: 12, history: [], venue: null, social: null, instagram: undefined };
  const v2 = sizeVerdict(you, signalsFor(small, now));
  assert.match(v2.text, /^Looks smaller or quieter than you: fewer Google reviews/);
  const unknown: TrackedCompetitor = { ...small, rating: null, count: null, services: [] };
  assert.match(sizeVerdict(you, signalsFor(unknown, now)).text, /Not enough public figures/);
});
