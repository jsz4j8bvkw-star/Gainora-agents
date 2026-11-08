import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { extractLinks, visibleText, extractPrices, extractOffers, snapshot, diffSnapshots, describeDiff, extractForms } from '../shared/pages';
import { analyseWeeks, findUnsupportedNumbers, metricsFor } from '../shared/metrics';
import { writeBrief } from '../shared/brief-writer';
import { SECTIONS, emptyProfile, isValidUrl, validateSection, setPath } from '../src/lib/questions';
import { verifyStripeSignature, agentForProduct, agentsForProduct } from '../netlify/lib/stripe';
import { cleanScoutResults } from '../netlify/lib/agents';
import { extractJson, hasBanned } from '../netlify/lib/ai';
import { SAMPLE_PROFILE } from '../src/lib/demo';

test('extractLinks keeps same-site http links, drops mailto/tel/fragments', () => {
  const html = `<a href="/about">A</a><a href='contact#form'>C</a><a href="https://other.com/x">X</a><a href="mailto:a@b.com">M</a><a href=tel:123>T</a><a href="https://www.shop.co.uk/p?x=1&amp;y=2">P</a>`;
  const links = extractLinks(html, 'https://shop.co.uk/');
  assert.deepEqual(links.sort(), ['https://shop.co.uk/about', 'https://shop.co.uk/contact', 'https://www.shop.co.uk/p?x=1&y=2'].sort());
});

test('visibleText strips scripts and decodes entities', () => {
  const t = visibleText('<html><script>var a=1</script><style>.x{}</style><h1>Hello &amp; welcome</h1><p>Mugs &pound;18</p></html>');
  assert.equal(t, 'Hello & welcome\nMugs £18');
});

test('prices and offers are extracted', () => {
  assert.deepEqual(extractPrices('Mugs £18.00, sets from £1,200 and £ 5'), ['£18.00', '£1,200', '£5']);
  assert.deepEqual(extractOffers('Welcome\nFree delivery on orders over £40\nAbout us'), ['Free delivery on orders over £40']);
});

test('forms are found with absolute actions', () => {
  const f = extractForms('<form action="/send" method="post"><input name=a><textarea></textarea></form>', 'https://x.co.uk/contact');
  assert.deepEqual(f, [{ action: 'https://x.co.uk/send', method: 'post', fields: 2 }]);
});

test('diffSnapshots detects a new offer and a price change, ignores cookie noise', () => {
  const a = snapshot('https://c.co.uk', '<p>Mugs £18</p><p>Handmade in Devon</p><p>We use cookies</p>');
  const b = snapshot('https://c.co.uk', '<p>Mugs £22</p><p>Handmade in Devon</p><p>Free delivery over £40</p><p>We use cookies on this site</p>');
  const d = diffSnapshots(a, b);
  assert.equal(d.changed, true);
  assert.ok(d.addedPrices.includes('£22'));
  assert.ok(d.removedPrices.includes('£18'));
  assert.equal(describeDiff('Cove', d)!.kind, 'offer');
  const same = diffSnapshots(a, a);
  assert.equal(same.changed, false);
  assert.equal(describeDiff('Cove', same), null);
});

test('analyseWeeks computes change and average', () => {
  const m = metricsFor(['Enquiries']);
  const weeks = [10, 10, 10, 10, 15].map((v, i) => ({ weekOf: `2026-10-0${i + 1}`, values: { enquiries: v } }));
  const [c] = analyseWeeks(weeks, m);
  assert.equal(c.current, 15); assert.equal(c.previous, 10); assert.equal(c.changePct, 50); assert.equal(c.average4, 10); assert.equal(c.direction, 'up');
});

test('findUnsupportedNumbers flags invented figures but allows inputs, years and small counts', () => {
  assert.deepEqual(findUnsupportedNumbers('Enquiries rose from 28 to 42 (50%) in 2026. Do 3 things.', [28, 42, 50]), []);
  assert.deepEqual(findUnsupportedNumbers('Revenue hit £9,999 this week', [28, 42]), ['£9,999']);
});

test('writeBrief explains a fall in orders and gives three actions', () => {
  const m = metricsFor(['Orders or sales', 'Enquiries']);
  const weeks = [
    { weekOf: '2026-10-19', values: { orders: 20, enquiries: 40 } },
    { weekOf: '2026-10-26', values: { orders: 14, enquiries: 52 } },
  ];
  const b = writeBrief(analyseWeeks(weeks, m), SAMPLE_PROFILE);
  assert.match(b.headline, /Enquiries up, orders down/);
  assert.equal(b.actions.length, 3);
  assert.ok(b.paragraphs.some((p) => p.includes('For every 100 enquiries')));
  const empty = writeBrief([], SAMPLE_PROFILE);
  assert.match(empty.headline, /Add this week/);
  // Week-on-week and the four-week average are both stated, in one readable bracket.
  assert.match(b.paragraphs[0], /Orders fell from 20 to 14 \(down 30% on last week\)\./);
});

test('writeBrief ties its priorities to the goal and to what the other agents found', () => {
  const m = metricsFor(['Orders or sales', 'Enquiries', 'Revenue']);
  const weeks = [
    { weekOf: '2026-10-12', values: { orders: 40, enquiries: 30, revenue: 1500 } },
    { weekOf: '2026-10-19', values: { orders: 42, enquiries: 28, revenue: 1532 } },
    { weekOf: '2026-10-26', values: { orders: 35, enquiries: 42, revenue: 1230 } },
  ];
  const b = writeBrief(analyseWeeks(weeks, m), SAMPLE_PROFILE, {
    dueFollowUps: ['The Driftwood Room'], leadsToContact: ['The Quay Pantry', 'Kittiwake & Co', 'Fern & Flint'], wonLeads: 1, inConversation: 2,
    tenders: [{ title: 'Locally made gifts and homeware for visitor centre shops', value: 18000, daysLeft: 21 }],
    urgentIssue: 'Your contact page needs attention', weeksLeft: 13,
  });
  // The goal line uses the pipeline, since the goal is wholesale stockists.
  assert.ok(b.paragraphs.some((p) => /Against your goal of 6 new wholesale stockists by the end of February \(13 weeks left\), you have 1 stockist won and 2 in conversation\./.test(p)), b.paragraphs.join(' | '));
  assert.equal(b.actions.length, 3);
  assert.match(b.actions[0], /^Your contact page needs attention: fix it first/);
  assert.match(b.actions[1], /Follow up with The Driftwood Room/);
  assert.match(b.actions[2], /Send your introduction to The Quay Pantry and Kittiwake & Co and 1 more/);
  // Without findings, the numbers still drive sensible priorities and the contract is offered when there is one.
  const plain = writeBrief(analyseWeeks(weeks, m), SAMPLE_PROFILE, { tenders: [{ title: 'Café crockery', value: 14000, daysLeft: 30 }] });
  assert.match(plain.actions[0], /Decide whether to bid for “Café crockery” \(published value £14,000\), which closes in 30 days/);
  assert.ok(plain.actions.some((a) => /Reply to every open enquiry/.test(a)));
  // A contract closing in two days is not pushed: too late to bid well.
  const late = writeBrief(analyseWeeks(weeks, m), SAMPLE_PROFILE, { tenders: [{ title: 'Café crockery', value: 14000, daysLeft: 2 }] });
  assert.ok(!late.actions.some((a) => /Café crockery/.test(a)));
  // A metric goal reports this week's figure against the target.
  const enq = { ...SAMPLE_PROFILE, goals: { ...SAMPLE_PROFILE.goals, focus: 'More enquiries', target: '50 enquiries a week' } };
  const g = writeBrief(analyseWeeks(weeks, m), enq, { weeksLeft: 8 });
  assert.ok(g.paragraphs.some((p) => /Against your goal of 50 enquiries a week \(8 weeks left\), this week’s enquiries came in at 42\./.test(p)), g.paragraphs.join(' | '));
});

test('questionnaire validation catches missing and malformed answers', () => {
  const p = emptyProfile();
  const errs = validateSection(SECTIONS[0], p);
  assert.ok(errs['business.name'] && errs['business.website'] && errs['business.teamSize']);
  const ok = validateSection(SECTIONS[0], SAMPLE_PROFILE);
  assert.deepEqual(ok, {});
  const bad = validateSection(SECTIONS[0], setPath(SAMPLE_PROFILE, 'business.website', 'not a site'));
  assert.ok(bad['business.website']);
  assert.equal(isValidUrl('shop.co.uk'), true);
  assert.equal(isValidUrl('localhost'), false);
  const comp = validateSection(SECTIONS[3], setPath(SAMPLE_PROFILE, 'competitors.list', [{ name: 'X', url: 'nope' }]));
  assert.ok(comp['competitors.list']);
  for (const s of SECTIONS) assert.deepEqual(validateSection(s, SAMPLE_PROFILE), {}, `sample answers pass ${s.id}`);
});

test('Stripe signatures: valid, tampered and stale', () => {
  const secret = 'whsec_test';
  const payload = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, 300, t + 10), true);
  assert.equal(verifyStripeSignature(payload + ' ', `t=${t},v1=${sig}`, secret, 300, t + 10), false);
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, 300, t + 1000), false);
  assert.equal(verifyStripeSignature(payload, null, secret), false);
});

test('product → agent mapping comes from STRIPE_AGENT_PRODUCTS', () => {
  process.env.STRIPE_AGENT_PRODUCTS = '{"prod_A":"watcher","prod_B":"nonsense"}';
  assert.equal(agentForProduct('prod_A'), 'watcher');
  assert.equal(agentForProduct('prod_B'), null);
  assert.equal(agentForProduct('prod_C'), null);
  process.env.STRIPE_AGENT_PRODUCTS = '{"prod_CC":"all","prod_D":["watcher","brief","nope"]}';
  assert.deepEqual(agentsForProduct('prod_CC'), ['watcher', 'scout', 'brief']);
  assert.deepEqual(agentsForProduct('prod_D'), ['watcher', 'brief']);
  assert.equal(agentForProduct('prod_CC'), null);
});

test('Scout results: drops personal data, own site, competitors, uncited sources and duplicates', () => {
  const profile = { business: { website: 'https://mine.co.uk' }, competitors: { list: [{ name: 'Rival', url: 'https://rival.co.uk' }] } };
  const raw: any[] = [
    { name: 'Good Shop', location: 'Truro', website: 'https://goodshop.co.uk', fit: 'strong', reason: 'Stocks local makers.', source_url: 'https://goodshop.co.uk/about' },
    { name: 'Good Shop again', location: 'Truro', website: 'https://www.goodshop.co.uk', fit: 'strong', reason: 'Dup.', source_url: 'https://goodshop.co.uk/' },
    { name: 'Me', website: 'https://mine.co.uk', fit: 'strong', reason: 'x', source_url: 'https://mine.co.uk' },
    { name: 'Rival', website: 'https://rival.co.uk', fit: 'strong', reason: 'x', source_url: 'https://rival.co.uk' },
    { name: 'Emailer', website: 'https://e.co.uk', fit: 'possible', reason: 'Contact jane@e.co.uk', source_url: 'https://e.co.uk' },
    { name: 'Made up', website: 'https://ghost.co.uk', fit: 'strong', reason: 'Sounds right.', source_url: 'https://ghost.co.uk' },
    { name: 'Listed', location: 'Bath', website: '', fit: 'banana', reason: 'In a directory of gift shops.', source_url: 'https://directory.co.uk/gifts' },
  ];
  const cited = new Set(['goodshop.co.uk', 'mine.co.uk', 'rival.co.uk', 'e.co.uk', 'directory.co.uk']);
  const out = cleanScoutResults(raw, profile, cited);
  assert.deepEqual(out.map((r) => r.name), ['Good Shop', 'Listed']);
  assert.equal(out[1].fit, 'possible');
  assert.equal(out[0].saved, false);
});

test('extractJson handles fences, prose and braces inside strings', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": "x}y", "b": [1,2]}\n```'), { a: 'x}y', b: [1, 2] });
  assert.deepEqual(extractJson('Results: [{"n":1}] done'), [{ n: 1 }]);
  assert.throws(() => extractJson('no json here'));
});

test('banned phrases are caught', () => {
  assert.equal(hasBanned('We guarantee results'), true);
  assert.equal(hasBanned('This should help'), false);
});
