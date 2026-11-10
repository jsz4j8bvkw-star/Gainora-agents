import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFake } from './fake-sb';
import { newSite, servicesFromPriceList, siteFromProfile, guessIndustry, readHours, type Site } from '../shared/site/data';
import { pagesOf, renderPage, readableAccent, sitemap, robots, copyOf, defaultFaqs } from '../shared/site/render';
import { adsPlan, adsCsv, checks, profilePack, reviewKit, launchPlan, planProgress } from '../shared/site/kit';
import { cleanEvent, performance, sourceLabel, type SiteEvent } from '../shared/site/stats';
import { SAMPLE_PROFILE } from '../src/lib/demo';

function clinic(): Site {
  const s = newSite('aesthetics');
  s.slug = 'willow-skin';
  Object.assign(s.business, { name: 'Willow Skin & Beauty', phone: '01632 960 123', email: 'hello@willow.example', line1: '14 Market Street', town: 'Harrogate', postcode: 'HG1 1AA', areas: ['Knaresborough', 'Ripon'], owner: 'Amy Walker', founded: '2019', credentials: ['Fully insured'], differences: ['Every treatment starts with a free consultation'] });
  return s;
}
const OPTS = { base: '/', siteId: '00000000-0000-4000-8000-000000000009', origin: 'https://willow.example' };

test('the site has five to eight real pages, each with its own title, and one clear next step', () => {
  const s = clinic();
  const pages = pagesOf(s);
  const visible = pages.filter((p) => p.kind !== 'thanks' && p.kind !== 'privacy');
  assert.ok(visible.length >= 5 && visible.length <= 8, `${visible.length} pages`);
  assert.equal(new Set(pages.map((p) => p.title)).size, pages.length, 'titles are unique');
  assert.ok(pages.every((p) => p.title.length <= 70 && p.description.length <= 160));
  const home = renderPage(s, '', OPTS)!.html;
  assert.match(home, /<h1>Natural-looking results, planned with you in Harrogate<\/h1>/);
  assert.match(home, /href="tel:\+441632960123"/);
  assert.match(home, /"@type":"MedicalBusiness"/);
  assert.match(home, /"@type":"FAQPage"/);
  assert.match(home, /<link rel="canonical" href="https:\/\/willow\.example\/">/);
  assert.match(home, /action="\/api\/site-enquiry\/00000000-0000-4000-8000-000000000009"/);
  assert.match(home, /navigator\.sendBeacon/);
  assert.ok(!/googletagmanager/.test(home), 'no Google tags unless the owner adds them');
  assert.ok(!/class="consent"/.test(home), 'so no cookie banner either');
  const svc = renderPage(s, 'services/lip-filler/', OPTS)!.html;
  assert.match(svc, /<h1>Lip filler in Harrogate<\/h1>/);
  assert.match(svc, /<option selected>Lip filler<\/option>/);
  assert.equal(renderPage(s, 'nope/', OPTS), null);
});

test('what the owner types can never break the page, and preview pages are never indexed or counted', () => {
  const s = clinic();
  s.business.name = 'A <script>alert(1)</script> "Clinic"';
  s.copy['home.intro'] = '</p><img src=x onerror=alert(1)>';
  s.reviews = [{ id: 'r', name: 'Jo <b>', source: 'Google', text: 'Great "service" </blockquote><script>' }];
  s.booking.url = 'javascript:alert(1)';
  const html = renderPage(s, '', OPTS)!.html;
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:alert'));
  assert.ok(!/<\/blockquote><script>/.test(html));
  const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)!;
  for (const b of ldBlocks) assert.ok(!/<\/script>[\s\S]*<\/script>/.test(b.slice(0, -9)), 'structured data cannot close its script tag');
  const preview = renderPage(s, '', { ...OPTS, preview: true })!.html;
  assert.match(preview, /<meta name="robots" content="noindex">/);
  assert.ok(!/sendBeacon/.test(preview));
});

test('Google tags load only after consent, and the accent colour is always readable', () => {
  const s = clinic();
  s.tracking = { ga4: 'G-ABC1234', adsId: 'AW-123456789', adsLabel: 'xyzLabel' };
  const html = renderPage(s, '', OPTS)!.html;
  assert.match(html, /K='gainora-consent'/);
  assert.match(html, /send_to:'AW-123456789\/xyzLabel'/);
  s.tracking.ga4 = "G-1');alert(1);//";
  assert.ok(!renderPage(s, '', OPTS)!.html.includes('alert(1)'));
  // Pale yellow is darkened until white text passes 4.5:1.
  const a = readableAccent('#F5E663');
  const lum = (h: string) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  assert.ok(1.05 / (lum(a) + 0.05) >= 4.5, a);
});

test('every design combination renders a complete page', () => {
  const s = clinic();
  s.look.hero = { id: 'h', url: 'https://cdn.example/hero.jpg', name: 'hero.jpg', alt: 'The treatment room' };
  s.look.gallery = [1, 2, 3, 4].map((i) => ({ id: `g${i}`, url: `https://cdn.example/${i}.jpg`, name: `${i}.jpg`, alt: `Photo ${i}` }));
  for (const fonts of ['classic', 'editorial', 'grand', 'friendly', 'modern', 'clean', 'geometric'] as const)
    for (const heroLayout of ['split', 'full', 'centred'] as const)
      for (const surface of ['light', 'tinted', 'deep'] as const) {
        s.look = { ...s.look, fonts, heroLayout, surface };
        const html = renderPage(s, '', OPTS)!.html;
        assert.match(html, /<h1>/);
        assert.match(html, /fonts\.googleapis\.com\/css2\?family=/);
        if (heroLayout === 'full') assert.match(html, /class="hero full"/);
      }
  s.look.sections = { how: false, why: false, reviews: false, faq: false, gallery: false };
  const bare = renderPage(s, '', OPTS)!.html;
  assert.ok(!/id="how-h"/.test(bare) && !/id="faq-h"/.test(bare) && !/class="strip"/.test(bare));
  // Full-photo layout without a photo falls back to the side-by-side layout.
  s.look.hero = null; s.look.heroLayout = 'full';
  assert.ok(!/class="hero full"/.test(renderPage(s, '', OPTS)!.html));
});

test('sitemap and robots: the live domain is listed, the Gainora address is not', () => {
  const s = clinic();
  const map = sitemap(s, 'https://willow.example');
  assert.match(map, /<loc>https:\/\/willow\.example\/services\/lip-filler\/<\/loc>/);
  assert.ok(!map.includes('/thanks/'));
  assert.match(robots('https://willow.example', true), /Sitemap: https:\/\/willow\.example\/sitemap\.xml/);
  assert.match(robots('https://app.gainora.co.uk/site/x', false), /Disallow: \//);
});

test('aesthetics: prescription-only medicines are flagged on the site and kept out of the ads', () => {
  const s = clinic();
  s.services.push({ id: 'b', name: 'Botox', price: '£180', duration: '30 minutes', summary: 'Anti-wrinkle.', page: false });
  const c = checks(s);
  assert.ok(c.some((x) => x.level === 'fix' && /Botox/.test(x.text) && /Prescription-only/.test(x.text)));
  const aw = clinic(); aw.services.push({ id: 'a', name: 'Anti-wrinkle injections', price: '£150', duration: '', summary: '', page: false });
  assert.ok(checks(aw).some((x) => x.level === 'fix' && /Anti-wrinkle injection/i.test(x.text)));
  assert.ok(adsPlan(aw, 'https://willow.example').excluded.some((x) => /Anti-wrinkle/.test(x.service)));
  const ads = adsPlan(s, 'https://willow.example');
  assert.ok(ads.excluded.some((x) => x.service === 'Botox'));
  assert.ok(!ads.groups.some((g) => /botox/i.test(g.keywords.join(' '))));
  for (const g of ads.groups) {
    assert.ok(g.headlines.length >= 3 && g.headlines.every((h) => h.length <= 30), g.name);
    assert.ok(g.descriptions.length >= 2 && g.descriptions.every((d) => d.length <= 90), g.name);
  }
  assert.match(adsCsv(ads), /^Campaign,Ad group,Keyword,Match type,Final URL\n/);
  assert.ok(ads.daily > 0 && Math.abs(ads.daily * 30.4 - ads.monthly) < 1);
});

test('the Google profile pack fits Google’s limits and warns about keyword-stuffed names', () => {
  const s = clinic();
  const p = profilePack(s, 'https://willow.example/');
  assert.ok(p.description.length <= 750);
  assert.equal(p.primary, 'Skin care clinic');
  assert.match(p.website, /utm_campaign=gbp/);
  assert.equal(sourceLabel('', new URLSearchParams('utm_source=google&utm_medium=organic&utm_campaign=gbp'), 'willow.example'), 'Google Business Profile');
  assert.equal(p.nameWarning, null);
  s.business.name = 'Willow Skin Clinic Harrogate';
  assert.ok(profilePack(s, 'https://willow.example/').nameWarning);
  const kit = reviewKit(s);
  assert.ok(kit.rules.some((r) => /Never confirm/.test(r)), 'health businesses never confirm a client in a reply');
  assert.ok(kit.rules.some((r) => /April 2025/.test(r)));
});

test('checks catch the basics and the launch plan counts progress', () => {
  const s = newSite('plumber');
  const c = checks(s);
  assert.ok(c.some((x) => /business name/.test(x.text)));
  assert.ok(c.some((x) => /phone number/.test(x.text)));
  assert.ok(c.some((x) => /areas covered/.test(x.text)));
  assert.ok(c.some((x) => /Gas Safe/.test(x.text)), 'boiler work needs a Gas Safe number');
  const all = launchPlan(s).flatMap((w) => w.tasks);
  assert.equal(new Set(all.map((t) => t.id)).size, all.length);
  s.plan = { [all[0].id]: true, [all[1].id]: true };
  assert.deepEqual(planProgress(s), { done: 2, total: all.length });
});

test('a first draft comes from the onboarding answers', () => {
  const s = siteFromProfile(SAMPLE_PROFILE);
  assert.equal(s.business.name, SAMPLE_PROFILE.business.name);
  assert.ok(s.slug.length >= 3);
  assert.equal(guessIndustry('Aesthetics clinic'), 'aesthetics');
  assert.equal(guessIndustry('Gas and heating engineer'), 'plumber');
  const list = servicesFromPriceList('Lip filler £250\nSkin boosters - from £200\n\nPeel');
  assert.deepEqual(list.map((x) => [x.name, x.price]), [['Lip filler', '£250'], ['Skin boosters', 'From £200'], ['Peel', '']]);
  assert.deepEqual(readHours('9:00-17:30'), [540, 1050]);
  assert.equal(readHours('closed'), null);
  assert.ok(defaultFaqs(s).length >= 3);
  assert.ok(copyOf(s)['meta.description'].length <= 158);
  assert.match(copyOf(s)['meta.description'], /\.$/, 'the Google description ends on a whole sentence');
});

test('performance: people once a day, actions credited to where the visitor came from', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const at = (d: number, h = 10) => new Date(now.getTime() - d * 86_400_000 - h * 3_600_000 + 10 * 3_600_000).toISOString();
  const ev: SiteEvent[] = [
    { at: at(1), kind: 'view', path: '/', source: 'Google Ads', device: 'phone', visitor: 'a' },
    { at: at(1, 9), kind: 'view', path: '/services/', source: 'This website', device: 'phone', visitor: 'a' },
    { at: at(1, 8), kind: 'call', path: '/services/', source: 'This website', device: 'phone', visitor: 'a' },
    { at: at(2), kind: 'view', path: '/', source: 'Google search', device: 'computer', visitor: 'b' },
    { at: at(2, 9), kind: 'enquiry', path: '/contact/', source: 'Google search', device: 'computer', visitor: 'b' },
    { at: at(3), kind: 'view', path: '/', source: 'Direct', device: 'phone', visitor: 'c' },
    { at: at(40), kind: 'view', path: '/', source: 'Direct', device: 'phone', visitor: 'old' },
  ];
  const p = performance(ev, 28, now);
  assert.equal(p.people, 3);
  assert.equal(p.views, 4);
  assert.equal(p.calls, 1);
  assert.equal(p.enquiries, 1);
  assert.equal(p.actions, 2);
  assert.equal(p.previous.people, 1);
  assert.equal(p.daily.length, 28);
  assert.deepEqual(p.sources.find((r) => r.source === 'Google Ads'), { source: 'Google Ads', people: 1, actions: 1 }, 'the call is credited to the ad, not "This website"');
  assert.deepEqual(p.sources.find((r) => r.source === 'Google search'), { source: 'Google search', people: 1, actions: 1 });
  assert.equal(p.pages[0].path, '/');
  assert.equal(cleanEvent({ s: 'not-a-uuid', k: 'view' }), null);
  assert.equal(cleanEvent({ s: '00000000-0000-4000-8000-000000000009', k: 'enquiry', p: '/' }), null, 'only the form handler records enquiries');
  assert.equal(cleanEvent({ s: '00000000-0000-4000-8000-000000000009', k: 'view', p: '/<script>' }), null);
});

test('end to end: draft from onboarding, publish, serve, count a visit, receive an enquiry', async () => {
  const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@willow.example', token: 'tok' };
  const fake = await startFake({
    __users: [USER],
    entitlements: [{ user_id: USER.id, email: USER.email, agent: 'website', status: 'active' }],
    profiles: [{ user_id: USER.id, data: SAMPLE_PROFILE }],
    sites: [], site_events: [], site_enquiries: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 'secret', APP_URL: 'https://app.gainora.co.uk', RESEND_API_KEY: 'k' });
  const emails: any[] = [];
  fake.external('api.resend.com', (_m, _p, body) => { emails.push(body); return { id: 'e1' }; });
  try {
    const { default: site } = await import('../netlify/functions/site');
    const { default: serve } = await import('../netlify/functions/site-serve');
    const { default: event } = await import('../netlify/functions/site-event');
    const { default: enquiry } = await import('../netlify/functions/site-enquiry');
    const call = async (b: any, token = 'tok') => site(new Request('https://app.gainora.co.uk/api/site', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));

    // Without Launch & Grow: no website.
    fake.tables.entitlements[0].agent = 'watcher';
    assert.equal((await call({ op: 'get' })).status, 403);
    fake.tables.entitlements[0].agent = 'website';

    const first = (await (await call({ op: 'get' })).json()).site;
    assert.equal(first.data.business.name, SAMPLE_PROFILE.business.name);
    assert.equal(first.live, false);
    assert.match(first.previewUrl, /^https:\/\/app\.gainora\.co\.uk\/site\/[a-z0-9-]+\/$/);

    // Not published yet: "Coming soon".
    const slug = first.slug;
    assert.equal((await serve(new Request(`https://app.gainora.co.uk/site/${slug}/`))).status, 404);

    // Saving cleans what it's given: bad links dropped, long text cut.
    const draft = { ...first.data, booking: { url: 'javascript:alert(1)', label: 'Book' }, business: { ...first.data.business, phone: '01632 960 123', name: 'Renamed by the client' } };
    const saved = (await (await call({ op: 'save', data: draft })).json()).site;
    assert.equal(saved.data.booking.url, '');
    assert.equal(saved.data.business.name, 'Willow Aesthetics', 'the business name is Gainora’s to change');
    const pub = (await (await call({ op: 'publish', data: saved.data })).json()).site;
    assert.equal(pub.live, true);
    assert.equal(pub.changed, false);

    // Live on its Gainora address: served, not indexed, sitemap points at the right place.
    const home = await serve(new Request(`https://app.gainora.co.uk/site/${slug}/`));
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /<title>Willow Aesthetics/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.equal((await serve(new Request(`https://app.gainora.co.uk/site/${slug}`))).status, 301);
    assert.equal((await serve(new Request(`https://app.gainora.co.uk/site/${slug}/nope/`))).status, 404);

    // Its own domain: indexable, canonical on the domain.
    // Connecting the domain is Gainora's job.
    fake.tables.__users.push({ id: '22222222-2222-4222-8222-222222222222', email: 'hello@gainora.co.uk', token: 'gtok' });
    assert.equal((await call({ op: 'domain', domain: 'willow.example' })).status, 403);
    const dom = (await (await call({ op: 'domain', domain: 'https://www.Willow.example/', as: slug }, 'gtok')).json()).site;
    assert.equal(dom.domain, 'willow.example');
    assert.equal((await call({ op: 'domain', domain: 'evil.gainora.co.uk', as: slug }, 'gtok')).status, 400);
    const onDomain = await serve(new Request('https://app.gainora.co.uk/api/site-host?h=www.willow.example&p=/about/'));
    assert.equal(onDomain.status, 200);
    const about = await onDomain.text();
    assert.ok(!/content="noindex"/.test(about));
    assert.match(about, /<link rel="canonical" href="https:\/\/willow\.example\/about\/">/);
    assert.match(await (await serve(new Request('https://app.gainora.co.uk/api/site-host?h=willow.example&p=/robots.txt'))).text(), /Sitemap: https:\/\/willow\.example\/sitemap\.xml/);

    // A visit and a call tap are counted, with no IP kept; bots are not.
    const beacon = (body: any, ua = 'Mozilla/5.0 (iPhone)') => event(new Request('https://willow.example/api/site-event', { method: 'POST', headers: { 'user-agent': ua, 'x-nf-client-connection-ip': '203.0.113.9' }, body: JSON.stringify(body) }));
    assert.equal((await beacon({ s: pub.id, k: 'view', p: '/', src: 'Google Ads', d: 'phone' })).status, 204);
    await beacon({ s: pub.id, k: 'call', p: '/', src: 'Google Ads', d: 'phone' });
    await beacon({ s: pub.id, k: 'view', p: '/', src: 'Direct', d: 'phone' }, 'Googlebot/2.1');
    assert.equal(fake.tables.site_events.length, 2);
    assert.ok(fake.tables.site_events.every((e) => e.visitor && !JSON.stringify(e).includes('203.0.113.9')));

    // An enquiry through the form: saved, emailed to the owner, visitor sent to the thank-you page.
    const form = new URLSearchParams({ name: 'Hannah M', phone: '07700 900111', email: 'hannah@example.com', service: 'Lip filler', message: 'Evenings please', page: '/contact/', source: 'Google Ads', website_url_confirm: '' });
    const r = await enquiry(new Request(`https://willow.example/api/site-enquiry/${pub.id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)', 'x-nf-client-connection-ip': '203.0.113.9' }, body: form.toString() }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/thanks/');
    assert.equal(fake.tables.site_enquiries.length, 1);
    assert.equal(fake.tables.site_enquiries[0].user_id, USER.id);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /New website enquiry from Hannah M/);
    // A bot filling the hidden field is thanked and ignored.
    const bot = await enquiry(new Request(`https://willow.example/api/site-enquiry/${pub.id}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'x', phone: '1', website_url_confirm: 'http://spam' }).toString() }));
    assert.equal(bot.headers.get('location'), '/thanks/');
    assert.equal(fake.tables.site_enquiries.length, 1);

    // Performance and the enquiry list in Command Centre.
    const perf = (await (await call({ op: 'stats', days: 28 })).json()).performance;
    assert.equal(perf.people, 1);
    assert.equal(perf.calls, 1);
    assert.equal(perf.enquiries, 1);
    assert.deepEqual(perf.sources[0], { source: 'Google Ads', people: 1, actions: 2 });
    const list = (await (await call({ op: 'enquiries' })).json()).enquiries;
    assert.equal(list[0].name, 'Hannah M');

    // The client can't change the address, domain, design or wording; Gainora's team can.
    assert.equal((await call({ op: 'slug', slug: 'new-address' })).status, 403);
    const before = fake.tables.sites[0].data;
    const sneaky = { ...before, look: { ...before.look, accent: '#FF0000', fonts: 'grand' }, copy: { 'home.title': 'Cheapest in town!' }, notes: 'x',
      services: before.services.map((x: any, i: number) => ({ ...x, price: i === 0 ? '£99' : x.price, page: !x.page })),
      business: { ...before.business, name: 'Renamed Ltd', phone: '01632 960 999' } };
    const afterClient = (await (await call({ op: 'save', data: sneaky })).json()).site;
    assert.equal(afterClient.role, 'owner');
    assert.equal(afterClient.data.business.phone, '01632 960 999', 'their phone number is theirs to change');
    assert.equal(afterClient.data.services[0].price, '£99', 'and their prices');
    assert.equal(afterClient.data.business.name, 'Willow Aesthetics', 'the name stays as Gainora set it');
    assert.equal(afterClient.data.look.accent, before.look.accent, 'the design stays');
    assert.deepEqual(afterClient.data.copy, before.copy, 'the wording stays');
    assert.deepEqual(afterClient.data.services.map((x: any) => x.page), before.services.map((x: any) => x.page), 'which services have pages stays');

    // The client asks for a change; Gainora gets an email, does it and the client hears back.
    const asked = (await (await call({ op: 'request', page: 'Home', text: 'Please use the new photo at the top.' })).json()).request;
    assert.equal(asked.status, 'open');
    assert.ok(emails.some((e) => /Website change for Willow Aesthetics/.test(e.subject) && e.to[0] === 'hello@gainora.co.uk'));
    const sitesList = (await (await call({ op: 'list' }, 'gtok')).json()).sites;
    assert.deepEqual(sitesList.map((x: any) => [x.name, x.openRequests]), [['Willow Aesthetics', 1]]);
    assert.equal((await call({ op: 'list' })).status, 403, 'clients can’t list other sites');
    const asGainora = (b: any) => call({ ...b, as: slug }, 'gtok');
    const gView = (await (await asGainora({ op: 'get' })).json()).site;
    assert.equal(gView.role, 'gainora');
    const redesigned = (await (await asGainora({ op: 'save', data: { ...gView.data, look: { ...gView.data.look, fonts: 'editorial', heroLayout: 'centred', surface: 'deep', accent: '#5B3A57' }, notes: 'Prefers plum' } })).json()).site;
    assert.equal(redesigned.data.look.fonts, 'editorial');
    assert.equal(redesigned.data.notes, 'Prefers plum');
    assert.equal((await (await call({ op: 'get' })).json()).site.data.notes, '', 'Gainora’s notes never reach the client');
    const doneReq = (await (await asGainora({ op: 'request-done', id: asked.id, reply: 'Done, have a look.' })).json()).request;
    assert.equal(doneReq.status, 'done');
    assert.ok(emails.some((e) => /Your website change is done/.test(e.subject)));
    assert.equal((await (await call({ op: 'requests' })).json()).requests[0].reply, 'Done, have a look.');
    assert.equal((await asGainora({ op: 'slug', slug: 'Bad Slug!' })).status, 400);
  } finally { fake.server.close(); }
});
