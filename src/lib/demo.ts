import type { Api } from './api';
import type {
  Action, Alert, BriefReport, BusinessProfile, ChatMessage, FeedbackRecord, HomeData, Lead, ScoutResult, ScoutSearch, Tender,
  ValueEvent, ValueKind, WatcherState, WeekNumbers,
} from './types';
import { emptyProfile } from './questions';
import { metricsFor, analyseWeeks } from '../../shared/metrics';
import { writeBrief, type BriefContext } from '../../shared/brief-writer';
import { isDue } from '../../shared/leads';
import { daysLeft } from '../../shared/tenders';
import { fallbackReply } from '../../shared/reviews';
import { followUpSent, moveLead } from '../../shared/leads';
import { hostOf } from '../../shared/learning';
import { planToday } from '../../shared/today';
import { sourceCatalogue } from '../../shared/ask';
import { mondayOf, uid } from './format';

const KEY = 'gainora.agents.demo.v2';
const DAY = 86_400_000;

interface DemoState {
  user: { id: string; email: string } | null;
  profile: BusinessProfile | null;
  seeded: boolean;
  actions: Action[];
  alerts: Alert[];
  watcher: WatcherState | null;
  scout: ScoutSearch[];
  numbers: WeekNumbers[];
  briefs: BriefReport[];
  chat: ChatMessage[];
  values: ValueEvent[];
  feedback: FeedbackRecord[];
  leads: Lead[];
  tenders: Tender[];
}

const fresh = (): DemoState => ({ user: null, profile: null, seeded: false, actions: [], alerts: [], watcher: null, scout: [], numbers: [], briefs: [], chat: [], values: [], feedback: [], leads: [], tenders: [] });

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* storage unavailable: start fresh */ }
  return fresh();
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (t: number) => new Date(t).toISOString();
const firstNumber = (s: string): number | null => {
  const m = s.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const SAMPLE_PROFILE: BusinessProfile = {
  business: {
    ownerName: 'Sarah', name: 'Harbour & Home', website: 'https://example.com',
    oneLiner: 'We sell handmade homeware from Cornish makers, online and in our Falmouth shop.',
    industry: 'Retail and e-commerce', location: 'Falmouth, Cornwall', tradingSince: '2019', teamSize: '2–5', legalForm: 'Limited company',
  },
  offer: { products: 'Ceramic tableware, linen, candles and gift sets. Wholesale to a few local cafés.', typicalPrice: '£35 average order, gift sets £60–£90', salesChannels: ['Website', 'In person', 'Wholesale'], bestSeller: 'Hand-thrown mugs' },
  customers: { ideal: 'Homeowners aged 30–60 who value handmade and buy gifts several times a year.', sources: ['Instagram', 'Google search', 'Word of mouth', 'Walk-ins'], areas: ['Local', 'Across the UK'], repeat: 'Some' },
  competitors: { list: [{ name: 'Cove Living', url: 'https://example.org' }, { name: 'Saltwater Store', url: 'https://example.net' }], ourEdge: 'Everything is made within 30 miles and we gift-wrap for free.', theirEdge: 'Faster delivery and a bigger range.' },
  numbers: { revenueBand: '£5k–£20k', enquiriesPerWeek: '30', salesPerWeek: '42', averageOrder: '35', track: ['Revenue', 'Orders or sales', 'Enquiries', 'Website visitors'] },
  goals: { focus: 'Find new wholesale or B2B clients', target: '6 new wholesale stockists by the end of February', detail: 'Wholesale orders are steadier than retail through the quiet months.', twelveMonth: 'Wholesale making up a third of sales and a second member of staff.', obstacle: 'Time. I run the shop, the website and the social posts myself.', timePerWeek: '2–5 hours' },
  preferences: { reportDay: 'Monday', reportTime: '7am', alerts: 'Urgent only', style: 'Short and direct', extraRecipient: '' },
};

const SHOP_NAMES = ['The Driftwood Room', 'Kittiwake & Co', 'Saltmarsh General Store', 'Penhallow Gifts', 'The Linen Cupboard', 'Harbourside Interiors', 'Fern & Flint', 'Tidewater Home', 'The Quay Pantry', 'Gull Cottage Goods'];
const TOWNS = ['Truro', 'St Ives', 'Padstow', 'Penzance', 'Fowey', 'Exeter', 'Totnes', 'Plymouth', 'Bath', 'Bristol'];
const REASONS = [
  'Stocks several small UK makers and lists a wholesale enquiries contact on its website.',
  'Opened a second shop this year and is adding a homeware section.',
  'Sells candles and tableware but no ceramics yet, which is a gap your range fills.',
  'Runs a “meet the makers” page and features local craft brands each season.',
  'Café and shop combined; already buys from independent suppliers.',
  'Focuses on gifts for second-home owners, matching your typical customer.',
  'Recently posted that it is looking for new Christmas stock.',
  'Mostly cards and stationery, but a new home category appeared last month.',
];

function makeResults(seed: number, n: number, exclude: string[] = []): ScoutResult[] {
  const r = rng(seed);
  const names = [...SHOP_NAMES].filter((x) => !exclude.includes(x.toLowerCase())).sort(() => r() - 0.5).slice(0, n);
  const reasons = [...REASONS].sort(() => r() - 0.5);
  return names.map((name, i) => ({
    id: uid('r_'), name, location: TOWNS[Math.floor(r() * TOWNS.length)],
    website: 'https://example.com', fit: i < Math.ceil(n / 2) ? 'strong' : 'possible',
    reason: reasons[i % reasons.length],
    source: { title: `${name} – about page (sample)`, url: 'https://example.com' }, saved: false,
  }));
}

function localResults(town: string): ScoutResult[] {
  const items = [
    { name: `${town} Christmas Makers Market`, when: 'First Saturday in December', how: 'Stall applications are open on the organiser’s page. Pitches are listed at £35.', reason: 'A makers’ market in your own town in peak gift season, which is where your typical customer shops.' },
    { name: 'Independent Business Awards, retail category', when: 'Entries close at the end of November', how: 'Free to enter online. Shortlisted businesses get local press coverage.', reason: 'Cheap credibility and press, and the retail category suits a shop like yours.' },
    { name: `${town} business network breakfast`, when: 'Every second Thursday, 7.30am', how: 'Your first visit is free. Book through their events page.', reason: 'Local owners who buy gifts for clients and staff, and who could stock or recommend you.' },
    { name: 'Spring wedding fair at a local hotel', when: 'A Sunday in mid-March', how: 'Exhibitor packs are available from the venue’s events team.', reason: 'Couples buy gift sets and table linen, so your range is a natural fit.' },
    { name: 'Harbour food and craft festival', when: 'Late May bank holiday weekend', how: 'Trader applications usually open in January.', reason: 'Heavy footfall from visitors and second-home owners, your ideal customers.' },
    { name: 'Primary school Christmas fair', when: 'Second Friday in December', how: 'Contact the parents’ association to book a table, usually for a small donation.', reason: 'A low-cost way to reach local families before Christmas.' },
  ];
  return items.map((x, i) => ({
    id: uid('r_'), name: x.name, location: town, website: 'https://example.com', fit: i < 3 ? 'strong' : 'possible',
    reason: x.reason, when: x.when, how: x.how, source: { title: `${x.name} (sample)`, url: 'https://example.com' }, saved: false,
  }));
}

function ev(kind: ValueKind, agent: ValueEvent['agent'], title: string, at: number, amount?: number): ValueEvent {
  return { id: uid('v_'), kind, agent, title, at: iso(at), amount: amount ?? null };
}

/** What the other agents found, for the Brief's priorities (mirrors briefContext on the server). */
function briefContextOf(s: DemoState): BriefContext {
  const w = s.watcher;
  const leadNames = new Set(s.leads.map((l) => l.name.toLowerCase()));
  const strong = new Set(s.scout.flatMap((x) => x.results).filter((r) => r.fit === 'strong' && !r.dismissed && !leadNames.has(r.name.toLowerCase())).map((r) => r.name));
  const low = w?.reviews?.reviews.filter((r) => r.isNew && r.rating <= 3).sort((a, b) => a.rating - b.rating)[0];
  const fix = w?.speed?.fixes.find((f) => !f.done && f.impact === 'High');
  const started = new Date(s.profile?.completedAt || Date.now()).getTime();
  return {
    dueFollowUps: s.leads.filter((l) => l.stage === 'contacted' && isDue(l.nextFollowUp)).map((l) => l.name),
    leadsToContact: s.leads.filter((l) => l.stage === 'to_contact').map((l) => l.name),
    strongLeads: strong.size,
    wonLeads: s.leads.filter((l) => l.stage === 'won').length,
    inConversation: s.leads.filter((l) => l.stage === 'contacted' || l.stage === 'replied' || l.stage === 'meeting').length,
    tenders: s.tenders.filter((t) => t.status === 'new' || t.status === 'saved').map((t) => ({ title: t.title, value: t.value, daysLeft: daysLeft(t.deadline), fit: t.fit })).sort((a, b) => (a.fit === b.fit ? (b.value ?? 0) - (a.value ?? 0) : a.fit === 'strong' ? -1 : 1)).slice(0, 3),
    urgentIssue: w?.issues.find((i) => i.level === 'urgent')?.title ?? null,
    lowReview: low ? { author: low.author, rating: low.rating } : null,
    topFix: fix ? { title: fix.title, who: fix.who } : null,
    weeksLeft: Math.max(0, Math.ceil((started + 90 * DAY - Date.now()) / (7 * DAY))),
  };
}

function seed(s: DemoState) {
  const p = s.profile!;
  const now = Date.now();
  const r = rng(p.business.name.length * 977 + 13);
  const comps = p.competitors.list.filter((c) => c.name.trim());
  const c1 = comps[0]?.name || 'Your main competitor';
  const c2 = comps[1]?.name || c1;
  const town = p.business.location.split(',')[0].trim() || 'your town';
  const site = p.business.website.replace(/\/$/, '');

  // The Watcher
  const history = Array.from({ length: 30 }, (_, i) => {
    const up = i !== 11;
    return { at: iso(now - (29 - i) * DAY), ms: up ? Math.round(420 + r() * 380 + (i > 24 ? 160 : 0)) : 0, up };
  });
  s.watcher = {
    site: p.business.website, lastCheck: iso(now - 3 * 3_600_000), nextCheck: iso(now + 3_600_000 * 21),
    up: true, responseMs: history[29].ms, uptime30d: 99.7, sslDaysLeft: 23, pagesChecked: 48,
    brokenLinks: [
      { url: `${site}/products/winter-gift-set`, foundOn: `${site}/gift-guide`, status: 404 },
      { url: `${site}/collections/linen-old`, foundOn: `${site}/`, status: 404 },
    ],
    issues: [
      { id: 'contact', level: 'urgent', title: 'Your contact page needs attention', detail: 'Your contact page returned an error when we loaded it on Sunday night, so visitors may not be able to reach you until it is fixed.', link: `${site}/contact` },
      { id: 'ssl', level: 'notice', title: 'Your security certificate renews in 23 days', detail: 'Most hosts renew automatically. If yours doesn’t, visitors will see a warning page, so check it is set to auto-renew.' },
      { id: 'links', level: 'notice', title: '2 links lead to a missing page', detail: 'Visitors who click these see an error. Update or remove them; the list is below.' },
    ],
    history,
    changes: [
      { id: uid('c_'), competitor: c1, url: comps[0]?.url || '', at: iso(now - 2 * DAY), kind: 'offer', summary: `${c1} added free UK delivery on orders over £40.`, detail: 'New banner across the top of every page. Your free delivery threshold is higher, so this is worth reviewing before December.' },
      { id: uid('c_'), competitor: c2, url: comps[1]?.url || comps[0]?.url || '', at: iso(now - 4 * DAY), kind: 'new-page', summary: `${c2} published a Christmas gift guide.`, detail: 'Twelve products, mostly under £40, with gift wrapping as an add-on at £3.50.' },
      { id: uid('c_'), competitor: c1, url: comps[0]?.url || '', at: iso(now - 9 * DAY), kind: 'price', summary: `${c1} raised its mug prices from £18 to £22.`, detail: 'Your hand-thrown mugs are now the cheaper option for a comparable product.' },
    ],
    reviews: {
      placeId: 'sample-place', placeName: p.business.name, mapsUrl: 'https://www.google.com/maps', rating: 4.6, count: 87, previousCount: 84,
      checkedAt: iso(now - 3 * 3_600_000),
      reviews: [
        { id: 'rv1', author: 'Mark D.', rating: 2, text: 'Ordered a dinner set online and one bowl arrived chipped. I emailed but haven’t heard back after a week.', when: '2 days ago', isNew: true },
        { id: 'rv2', author: 'Emma R.', rating: 5, text: 'Bought three mugs as a birthday present and they were beautifully wrapped. Lovely shop and really friendly.', when: '4 days ago', isNew: true },
        { id: 'rv3', author: 'James T.', rating: 4, text: 'Gorgeous linen and candles. Delivery took a little longer than expected but worth the wait.', when: '6 days ago', isNew: true },
        { id: 'rv4', author: 'Priya S.', rating: 5, text: `My favourite shop in ${town} for gifts. Everything is made locally and you can tell.`, when: '3 weeks ago', isNew: false },
      ],
      competitors: [{ name: c1, rating: 4.3, count: 126 }, ...(c2 !== c1 ? [{ name: c2, rating: 4.7, count: 54 }] : [])],
    },
    speed: {
      checkedAt: iso(now - 2 * DAY), strategy: 'mobile',
      scores: { performance: 54, accessibility: 88, seo: 92, bestPractices: 96 },
      field: { lcp: { value: '3.4 s', rating: 'Needs work' }, inp: { value: '160 ms', rating: 'Good' }, cls: { value: '0.12', rating: 'Needs work' } },
      fixes: [
        { id: 'image-delivery-insight', title: 'Shrink your photos', impact: 'High', who: 'You', saving: 'could make the page about 1.8 s faster', why: 'Large images are the most common reason pages are slow on phones, and slow pages lose visitors before they see anything.', how: 'Resize photos to no more than 2,000 pixels wide and save them as WebP or compressed JPEG. Most website builders have an image compression setting or app.' },
        { id: 'lcp-discovery-insight', title: 'Load your main image first', impact: 'High', who: 'Your web person', saving: 'could make the page about 0.9 s faster', why: 'The biggest image at the top of the page is set to load late, so the page looks empty for longer.', how: 'Ask your web person to turn off “lazy loading” for the top banner image and mark it as high priority.' },
        { id: 'cls-culprits-insight', title: 'Stop the page jumping as it loads', impact: 'Medium', who: 'Your web person', why: 'Content moves around while the page loads, so people tap the wrong thing or lose their place.', how: 'Give every image and embedded item a fixed width and height, and reserve space for banners and pop-ups.' },
        { id: 'meta-description', title: 'Add a description for Google', impact: 'Medium', who: 'You', why: 'Google shows this short description under your link. Without one it picks random text from the page.', how: 'In your website’s SEO settings, write one or two sentences for each main page saying what you offer and why to choose you.' },
        { id: 'image-alt', title: 'Describe your images', impact: 'Medium', who: 'You', why: 'Images without descriptions are invisible to Google Images and to people using screen readers.', how: 'Add a short description (alt text) to each product and banner image in your website editor.' },
        { id: 'color-contrast', title: 'Make some text easier to read', impact: 'Medium', who: 'Your web person', why: 'Some text is too faint against its background, especially on a phone outdoors.', how: 'Darken light grey text or lighten its background until it is easy to read.' },
      ],
    },
    prices: {
      checkedAt: iso(now - 3 * DAY),
      competitors: [c1, ...(c2 !== c1 ? [c2] : [])],
      rows: [
        { item: p.offer.bestSeller || 'Hand-thrown mug', yours: { price: '£18', url: site }, theirs: [{ price: '£22', url: 'https://example.org' }, { price: '£16', url: 'https://example.net' }], note: `${c1} raised theirs from £18 last week.` },
        { item: 'Linen tea towel', yours: { price: '£12', url: site }, theirs: [{ price: '£14', url: 'https://example.org' }, null] },
        { item: 'Soy candle, 200g', yours: { price: '£16', url: site }, theirs: [{ price: '£15', url: 'https://example.org' }, { price: '£18', url: 'https://example.net' }] },
        { item: 'Gift set', yours: { price: '£60', url: site }, theirs: [{ price: '£55', url: 'https://example.org' }, { price: '£65', url: 'https://example.net' }], note: 'Yours includes free gift wrapping; theirs charge extra.' },
      ],
    },
  };

  // The Scout
  const query = p.goals.focus === 'Find new wholesale or B2B clients'
    ? 'Independent shops that could stock our products'
    : `Businesses near ${town} that could refer customers to us`;
  const results = makeResults(41, 10).map((x, i) => ({ ...x, saved: i < 3 }));
  s.scout = [{
    id: uid('s_'), query, area: 'South West England', createdAt: iso(now - DAY), status: 'ready', kind: 'customers',
    summary: 'Ten businesses matched. Five are a strong fit: they already stock independent makers and have a public way to contact the buyer.',
    results,
  }];
  const today9 = new Date(); today9.setHours(9, 0, 0, 0);
  const toLead = (x: ScoutResult, extra: Partial<Lead>): Lead => ({
    id: uid('l_'), name: x.name, location: x.location, website: x.website, reason: x.reason, source: x.source,
    stage: 'to_contact', followUps: 0, createdAt: iso(now - DAY), ...extra,
  });
  s.leads = [
    toLead(results[0], { stage: 'contacted', contactedAt: iso(now - 4 * DAY), nextFollowUp: today9.toISOString() }),
    toLead(results[1], {}),
    toLead(results[2], { stage: 'replied', contactedAt: iso(now - 8 * DAY), followUps: 1 }),
    { id: uid('l_'), name: 'The Linen Cupboard', location: 'Truro', website: 'https://example.com', reason: 'Stocks several small UK makers and lists a wholesale enquiries contact on its website.', source: { title: 'The Linen Cupboard – about page (sample)', url: 'https://example.com' }, stage: 'won', contactedAt: iso(now - 23 * DAY), followUps: 1, value: 1200, createdAt: iso(now - 24 * DAY) },
  ];

  // Public contracts
  s.tenders = [
    { id: 't1', tenderId: 'sample-1', title: 'Locally made gifts and homeware for visitor centre shops', buyer: 'Heritage trust (sample)', summary: 'Supply of gifts, ceramics and textiles made in the county for resale in three visitor centre shops, with seasonal reorders.', value: 18000, deadline: iso(now + 21 * DAY), url: 'https://www.contractsfinder.service.gov.uk/', region: 'South West', sme: true, fit: 'strong', reason: 'They want locally made homeware for resale, which is exactly what you sell, and everything you stock is made within 30 miles. You would need a price list, product photos and public liability insurance.', status: 'new', foundAt: iso(now - DAY) },
    { id: 't2', tenderId: 'sample-2', title: 'Corporate and civic gifts framework', buyer: 'County council (sample)', summary: 'Framework for locally sourced gifts for visiting dignitaries, staff awards and civic events over two years.', value: 45000, deadline: iso(now + 12 * DAY), url: 'https://www.contractsfinder.service.gov.uk/', region: 'South West', sme: true, fit: 'possible', reason: 'Your gift sets fit the brief, but they also want some branded items, so you may need a printing partner. Worth a look if you can supply gift sets in volume.', status: 'new', foundAt: iso(now - 2 * DAY) },
    { id: 't3', tenderId: 'sample-3', title: 'Café crockery and table linen replacement', buyer: 'Hospital trust (sample)', summary: 'Replacement crockery, mugs and table linen for two hospital cafés.', value: 14000, deadline: iso(now + 30 * DAY), url: 'https://www.contractsfinder.service.gov.uk/', region: 'South West', sme: null, fit: 'possible', reason: 'Matches your ceramics and linen, and you already supply cafés. Check whether they need commercial dishwasher-safe ratings for the mugs.', status: 'new', foundAt: iso(now - 2 * DAY) },
  ];

  // The Brief
  const metrics = metricsFor(p.numbers.track);
  const baseEnq = firstNumber(p.numbers.enquiriesPerWeek) ?? 30;
  const baseOrd = firstNumber(p.numbers.salesPerWeek) ?? 40;
  const aov = firstNumber(p.numbers.averageOrder) ?? 35;
  s.numbers = Array.from({ length: 6 }, (_, i) => {
    const w = mondayOf(new Date(now - (6 - i) * 7 * DAY));
    const last = i === 5;
    const enq = Math.round(baseEnq * (0.9 + r() * 0.2) * (last ? 1.3 : 1));
    const ord = Math.round(baseOrd * (0.92 + r() * 0.16) * (last ? 0.85 : 1));
    const values: Record<string, number | null> = {};
    for (const m of metrics) {
      if (m.id === 'enquiries') values[m.id] = enq;
      else if (m.id === 'orders') values[m.id] = ord;
      else if (m.id === 'revenue') values[m.id] = Math.round(ord * aov * (0.95 + r() * 0.1));
      else if (m.id === 'visitors') values[m.id] = Math.round(enq * 38 * (0.9 + r() * 0.2));
      else if (m.id === 'conversion') values[m.id] = Math.round((ord / Math.max(1, enq * 38)) * 1000) / 10;
      else if (m.id === 'repeat') values[m.id] = Math.round(ord * 0.3);
      else if (m.id === 'adspend') values[m.id] = Math.round(60 + r() * 40);
      else values[m.id] = Math.round(1 + r() * 4);
    }
    return { weekOf: w, values };
  });
  const b = writeBrief(analyseWeeks(s.numbers, metrics), p, briefContextOf(s));
  s.briefs = [{ id: uid('b_'), weekOf: s.numbers[5].weekOf, createdAt: iso(now - 6 * 3_600_000), ...b }];

  // Home
  s.actions = [
    { id: uid('a_'), text: `Follow up with ${results[0].name} today`, agent: 'scout', done: false, createdAt: iso(now - 2 * 3_600_000) },
    { id: uid('a_'), text: 'Reply to Mark D.’s 2-star review', agent: 'watcher', done: false, createdAt: iso(now - 3 * 3_600_000) },
    { id: uid('a_'), text: 'Fix your contact page so enquiries reach you', agent: 'watcher', done: false, createdAt: iso(now - 3 * 3_600_000) },
    { id: uid('a_'), text: 'Look at the visitor centre contract before it closes', agent: 'scout', done: false, createdAt: iso(now - DAY) },
    { id: uid('a_'), text: `Decide whether to match ${c1}’s free delivery threshold`, agent: 'watcher', done: false, createdAt: iso(now - 2 * DAY) },
    ...b.actions.slice(0, 1).map((t) => ({ id: uid('a_'), text: t, agent: 'brief' as const, done: false, createdAt: iso(now - 6 * 3_600_000) })),
  ];
  s.alerts = [
    { id: uid('al_'), agent: 'watcher', level: 'urgent', title: 'New 2-star review', body: 'Mark D. says a bowl arrived chipped and he hasn’t heard back. A reply is drafted for you.', at: iso(now - 2 * 3_600_000), read: false },
    { id: uid('al_'), agent: 'watcher', level: 'urgent', title: 'Contact page error', body: 'Your contact page returned an error when we checked it.', at: iso(now - 3 * 3_600_000), read: false },
    { id: uid('al_'), agent: 'scout', level: 'good', title: 'Public contract that fits you', body: 'Locally made gifts for visitor centre shops, worth £18,000.', at: iso(now - DAY), read: false },
    { id: uid('al_'), agent: 'watcher', level: 'notice', title: `${c1} added free delivery over £40`, body: 'Their new threshold is lower than yours.', at: iso(now - 2 * DAY), read: true },
  ];

  // Value tracker: this month and last month
  const h = (n: number) => now - n * 3_600_000;
  const d = (n: number) => now - n * DAY;
  s.values = [
    ev('issue_found', 'watcher', 'Found: your contact page returned an error', h(3)),
    ev('issue_found', 'watcher', 'Found: security certificate renews in 23 days', h(3)),
    ev('issue_found', 'watcher', 'Found: 2 links lead to a missing page', d(2)),
    ev('review_alert', 'watcher', 'New review from Mark D. (2 stars)', h(2)),
    ev('review_alert', 'watcher', 'New review from Emma R. (5 stars)', d(4)),
    ev('review_alert', 'watcher', 'New review from James T. (4 stars)', d(6)),
    ev('reply_drafted', 'watcher', 'Drafted a reply to Emma R.', d(4)),
    ev('competitor_change', 'watcher', `${c1} added free delivery over £40`, d(2)),
    ev('competitor_change', 'watcher', `${c2} published a Christmas gift guide`, d(4)),
    ev('price_check', 'watcher', 'Compared your prices with competitors', d(3)),
    ...results.map((x) => ev('lead_found', 'scout', `Lead found: ${x.name}, ${x.location}`, d(1))),
    ev('draft_written', 'scout', `Drafted an introduction to ${results[0].name}`, d(4)),
    ev('lead_contacted', 'you', `You contacted ${results[0].name}`, d(4)),
    ev('tender_found', 'scout', 'Contract found: locally made gifts for visitor centre shops', d(1), 18000),
    ev('tender_found', 'scout', 'Contract found: corporate and civic gifts framework', d(2), 45000),
    ev('tender_found', 'scout', 'Contract found: café crockery and table linen', d(2), 14000),
    ev('brief_written', 'brief', 'Weekly Brief written', h(6)),
    // Last month
    ev('lead_found', 'scout', 'Lead found: The Linen Cupboard, Truro', d(24)),
    ev('lead_found', 'scout', 'Lead found: Fern & Flint, Totnes', d(24)),
    ev('lead_found', 'scout', 'Lead found: Tidewater Home, Fowey', d(24)),
    ev('draft_written', 'scout', 'Drafted an introduction to The Linen Cupboard', d(23)),
    ev('lead_won', 'you', 'Won: first wholesale order from The Linen Cupboard', d(15), 1200),
    ev('issue_found', 'watcher', 'Found: product page took 6 seconds to load', d(20)),
    ev('issue_fixed', 'you', 'Fixed: product page speed', d(18)),
    ev('brief_written', 'brief', 'Weekly Brief written', d(14)),
    ev('brief_written', 'brief', 'Weekly Brief written', d(21)),
  ];
  s.feedback = [];
  s.chat = [];
  s.seeded = true;
}

function demoReply(text: string, s: DemoState): ChatMessage {
  const p = s.profile!;
  const t = text.toLowerCase();
  const c = s.watcher?.changes[0];
  const strong = s.scout[0]?.results.filter((r) => r.fit === 'strong' && !r.dismissed) ?? [];
  const due = s.leads.find((l) => l.stage === 'contacted');
  let reply: string;
  let keys: string[] = ['profile'];
  if (/review|rating|google/.test(t) && s.watcher?.reviews) {
    keys = ['reviews'];
    const rv = s.watcher.reviews;
    reply = `You’re on ${rv.rating} stars from ${rv.count} Google reviews, ahead of ${rv.competitors[0]?.name ?? 'your main competitor'} on ${rv.competitors[0]?.rating ?? '–'}. Three new reviews came in this week.\n\nThe one to deal with today is Mark D.’s 2-star review about a chipped bowl. A public, calm reply plus a replacement usually turns these round. I’ve drafted one on the Watcher’s Reviews tab.`;
  } else if (/contract|tender|council|public/.test(t) && s.tenders.length) {
    keys = ['tenders'];
    const t1 = s.tenders[0];
    reply = `The best public contract right now is “${t1.title}”, worth £${t1.value?.toLocaleString('en-GB')}. ${t1.reason}\n\nIt closes in about three weeks, so there’s time, but start the price list this week.`;
  } else if (/follow|chase|reply|lead/.test(t) && due) {
    keys = ['leads'];
    reply = `${due.name} is due a follow-up today. You contacted them four days ago and haven’t heard back, which is normal. A short, friendly nudge usually gets a reply. The Scout has written it for you on the Leads tab.`;
  } else if (/competitor|rival|cove|saltwater|deliver|price/.test(t) && c) {
    keys = ['changes', 'profile'];
    reply = `The biggest move this fortnight: ${c.summary} ${c.detail ?? ''}\n\nGiven that your edge is “${p.competitors.ourEdge.replace(/\.$/, '')}”, I wouldn’t race them on price. A better reply is to lower your free-delivery threshold for December only and lead with free gift-wrapping in your next two posts. That keeps your margin on the rest of the year.`;
  } else if (/stock|wholesale|shop|prospect|scout|client/.test(t) && strong.length) {
    keys = ['scout'];
    reply = `Start with ${strong.slice(0, 3).map((r) => `${r.name} in ${r.location}`).join(', ')}. All three already buy from independent makers, which is the strongest sign they’ll consider you.\n\nSend each a short note with photos of your three best sellers and an offer of a small first order. The Scout has a ready-to-edit introduction for each of them.`;
  } else if (/enquir|sales|orders|number|week|brief|revenue/.test(t) && s.briefs[0]) {
    keys = ['brief', 'numbers'];
    const b = s.briefs[0];
    reply = `${b.headline}\n\n${b.paragraphs[0]}\n\nIf you only do one thing this week: ${lower1(b.actions[0])}.`;
  } else if (/website|site|slow|form|broken|link|speed/.test(t) && s.watcher) {
    keys = ['site', 'speed'];
    reply = `Two things matter most on your website. Your contact page returned an error on Sunday, so enquiries may be going missing; fix that first. Then shrink your product photos: Google’s test says it could make your site about 1.8 seconds faster on phones, and you can do it yourself.`;
  } else if (/goal|target|plan|focus|priorit/.test(t)) {
    keys = ['profile', 'leads', 'tenders'];
    reply = `Your goal is ${lower1(p.goals.target)}. With ${p.goals.timePerWeek.toLowerCase()} a week, I’d spend it like this:\n\nFollow up with ${due?.name ?? 'your waiting leads'} today and contact two new strong-fit shops. Then put an hour into the visitor centre contract, which on its own could cover a good part of your target.`;
  } else {
    keys = ['site', 'reviews', 'leads', 'tenders'];
    reply = `Here’s where ${p.business.name} stands: one urgent website issue (the contact page), a 2-star review waiting for a reply, a follow-up due today and a public contract worth £18,000 that fits you well.\n\nAsk me about any of those, your competitors, your numbers or who to contact next.`;
  }
  const cat = sourceCatalogue({ site: 'today', reviews: 'today', brief: `week of ${s.briefs[0]?.weekOf ?? ''}` });
  const sources = keys.map((k) => cat.find((c) => c.key === k)!).filter(Boolean).map(({ title, url }) => ({ title, url }));
  return { id: uid('m_'), role: 'agent', text: reply, at: new Date().toISOString(), sources };
}

export function createDemoApi(): Api {
  let s = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* demo works without storage */ } };
  const ensure = () => { if (s.profile?.completedAt && !s.seeded) { seed(s); save(); } };
  const addValue = (kind: ValueKind, agent: ValueEvent['agent'], title: string, amount?: number) => { s.values = [ev(kind, agent, title, Date.now(), amount), ...s.values]; };

  return {
    mode: 'demo',
    async getUser() { await wait(120); return s.user; },
    async requestSignIn(email) { await wait(500); s.user = { id: 'demo', email }; save(); },
    async signOut() { s.user = null; save(); },

    async getProfile() { await wait(120); return s.profile; },
    async saveProfile(p) { await wait(250); s.profile = structuredClone(p); ensure(); save(); },
    async getPlan() { return { agents: ['watcher', 'scout', 'brief'], status: 'active', renewsOn: iso(Date.now() + 19 * DAY) }; },
    async billingUrl() { return null; },

    async getHome(): Promise<HomeData> {
      await wait(200); ensure();
      const p = s.profile!;
      const metrics = metricsFor(p.numbers.track);
      const latest = s.numbers[s.numbers.length - 1];
      const focusMetric = /enquir/i.test(p.goals.focus) ? 'enquiries' : /order value/i.test(p.goals.focus) ? 'revenue' : 'orders';
      const isWholesale = /wholesale|b2b/i.test(p.goals.focus);
      const won = s.leads.filter((l) => l.stage === 'won').length;
      const inProgress = s.leads.filter((l) => l.stage === 'contacted' || l.stage === 'replied' || l.stage === 'meeting').length;
      const target = firstNumber(p.goals.target);
      const started = new Date(p.completedAt || Date.now()).getTime();
      const weeksLeft = Math.max(0, Math.ceil((started + 90 * DAY - Date.now()) / (7 * DAY)));
      const strong = s.scout[0]?.results.filter((r) => r.fit === 'strong').length ?? 0;
      const due = s.leads.filter((l) => l.stage === 'contacted' && l.nextFollowUp && new Date(l.nextFollowUp).getTime() < Date.now() + DAY);
      const thisWeek = mondayOf();
      const today = planToday({
        profile: p, agents: ['watcher', 'scout', 'brief'], watcher: s.watcher, leads: s.leads, tenders: s.tenders, searches: s.scout.length,
        changes: analyseWeeks(s.numbers, metrics), hasThisWeeksNumbers: s.numbers.some((w) => w.weekOf === thisWeek),
      });
      return {
        today,
        notes: [
          { agent: 'watcher', body: `Mark D. left a 2-star review about a chipped bowl. Reply today; I’ve drafted it. Your contact page also returned an error on Sunday night, so some enquiries may not be reaching you.` },
          { agent: 'scout', body: `${due.length ? `${due[0].name} is due a follow-up today. ` : ''}I also found a public contract for locally made gifts worth £18,000 that fits you closely, and ${strong} shops that could stock your range.` },
          { agent: 'brief', body: s.briefs[0]?.headline ?? 'Add this week’s numbers to get your Brief.' },
        ],
        actions: s.actions,
        alerts: s.alerts,
        goalProgress: isWholesale
          ? { current: won, target, label: 'stockists won', weeksLeft, detail: inProgress ? `${inProgress} more in conversation` : undefined }
          : { current: latest?.values[focusMetric] ?? null, target, label: metrics.find((m) => m.id === focusMetric)?.label.toLowerCase() ?? 'this week', weeksLeft },
        agentStatus: {
          watcher: { line: '1 urgent issue, 3 new reviews, 3 competitor changes', lastRun: s.watcher?.lastCheck, nextRun: s.watcher?.nextCheck },
          scout: { line: `${due.length} follow-up due, ${s.tenders.filter((t) => t.status === 'new').length} new contracts, ${strong} strong leads`, lastRun: s.scout[0]?.createdAt },
          brief: { line: s.briefs[0]?.headline ?? 'Waiting for this week’s numbers', lastRun: s.briefs[0]?.createdAt },
        },
      };
    },
    async setActionDone(id, done) { s.actions = s.actions.map((a) => (a.id === id ? { ...a, done } : a)); save(); },
    async addAction(text) {
      const a: Action = { id: uid('a_'), text, agent: 'you', done: false, createdAt: new Date().toISOString() };
      s.actions = [a, ...s.actions]; save(); return a;
    },
    async markAlertsRead() { s.alerts = s.alerts.map((a) => ({ ...a, read: true })); save(); },

    async getWatcher() { await wait(200); ensure(); return s.watcher!; },
    async runWatcher() {
      await wait(2200);
      const w = s.watcher!;
      const ms = Math.round(450 + Math.random() * 300);
      w.history = [...w.history.slice(1), { at: new Date().toISOString(), ms, up: true }];
      w.responseMs = ms; w.lastCheck = new Date().toISOString();
      save(); return w;
    },

    async listScout() { await wait(150); ensure(); return s.scout; },
    async startScout(query, area, kind = 'customers') {
      const search: ScoutSearch = { id: uid('s_'), query, area, kind, createdAt: new Date().toISOString(), status: 'running', results: [] };
      s.scout = [search, ...s.scout]; save();
      setTimeout(() => {
        const found = s.scout.find((x) => x.id === search.id);
        if (!found) return;
        found.status = 'ready';
        if (kind === 'local') {
          found.results = localResults(s.profile!.business.location.split(',')[0].trim() || 'your town');
          found.summary = 'Six local opportunities in the next few months. The first three suit you best. In the demo these are samples; in your account each comes with its source.';
          found.results.forEach((x) => addValue('opportunity_found', 'scout', `Opportunity found: ${x.name}`));
        } else {
          const excluded = s.feedback.filter((f) => f.verdict === 'not_relevant' && f.itemKind === 'lead').map((f) => f.text.split(',')[0].trim().toLowerCase());
          found.results = makeResults(query.length * 31 + area.length, 8, excluded);
          found.summary = `${found.results.length} businesses matched. ${found.results.filter((r) => r.fit === 'strong').length} are a strong fit. In the demo these are sample businesses; in your account they are real, with a source for each.`;
          found.results.forEach((x) => addValue('lead_found', 'scout', `Lead found: ${x.name}, ${x.location}`));
        }
        save();
      }, 3500);
      return search;
    },
    async getScout(id) { await wait(150); return s.scout.find((x) => x.id === id)!; },
    async setScoutSaved(searchId, resultId, saved) {
      const r = s.scout.find((x) => x.id === searchId)?.results.find((x) => x.id === resultId);
      if (r) r.saved = saved; save();
    },
    async draftIntro(searchId, resultId) {
      await wait(400);
      const p = s.profile!;
      const r = s.scout.find((x) => x.id === searchId)?.results.find((x) => x.id === resultId)
        ?? (() => { const l = s.leads.find((x) => x.id === resultId); return l ? { name: l.name, reason: l.reason } as ScoutResult : undefined; })();
      if (!r) return '';
      addValue('draft_written', 'scout', `Drafted an introduction to ${r.name}`); save();
      return `Subject: ${p.business.name} for ${r.name}?\n\nHi there,\n\nI run ${p.business.name}. ${p.business.oneLiner}\n\nI noticed ${lower1(r.reason).replace(/\.$/, '')}, so I thought our ${p.offer.bestSeller ? p.offer.bestSeller.toLowerCase() : 'range'} might suit your customers.\n\nWould you be open to a small first order, or to me sending a few samples? I’m happy to work around what suits you.\n\nBest wishes,\n${p.business.ownerName}\n${p.business.name}\n\nIf this isn’t of interest, just reply “no thanks” and I won’t get in touch again.`;
    },

    async getNumbers() { await wait(150); ensure(); return s.numbers; },
    async saveNumbers(w) {
      await wait(1200);
      s.numbers = [...s.numbers.filter((x) => x.weekOf !== w.weekOf), w].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
      const b = writeBrief(analyseWeeks(s.numbers, metricsFor(s.profile!.numbers.track)), s.profile!, briefContextOf(s));
      const report: BriefReport = { id: uid('b_'), weekOf: w.weekOf, createdAt: new Date().toISOString(), ...b };
      s.briefs = [report, ...s.briefs.filter((x) => x.weekOf !== w.weekOf)];
      addValue('brief_written', 'brief', 'Weekly Brief written');
      save(); return report;
    },
    async listBriefs() { await wait(120); ensure(); return s.briefs; },

    async getChat() { await wait(100); return s.chat; },
    async sendChat(text) {
      s.chat = [...s.chat, { id: uid('m_'), role: 'user', text, at: new Date().toISOString() }];
      save();
      await wait(1400);
      const m = demoReply(text, s);
      s.chat = [...s.chat, m]; save();
      return m;
    },

    // Value tracker and learning
    async listValue() { await wait(150); ensure(); return s.values; },
    async sendFeedback(f) {
      const rec: FeedbackRecord = { id: uid('f_'), agent: f.agent, itemKind: f.itemKind, itemId: f.itemId, verdict: f.verdict, reason: f.reason ?? null, text: f.text, host: f.host ?? null, changeKind: f.changeKind ?? null, createdAt: new Date().toISOString() };
      s.feedback = [rec, ...s.feedback];
      if (f.verdict === 'not_relevant' && (f.itemKind === 'lead' || f.itemKind === 'opportunity')) {
        for (const search of s.scout) for (const r of search.results) if (r.id === f.itemId) r.dismissed = true;
      }
      if (f.itemKind === 'tender') s.tenders = s.tenders.map((t) => (t.id === f.itemId ? { ...t, status: f.verdict === 'useful' ? 'saved' : 'dismissed' } : t));
      save();
    },
    async listFeedback() { await wait(100); return s.feedback; },
    async forgetFeedback(id) { s.feedback = s.feedback.filter((f) => f.id !== id); save(); },

    // Reviews and speed
    async findPlaces(query) {
      await wait(700);
      const p = s.profile!;
      return [
        { id: 'sample-place', name: p.business.name, address: `High Street, ${p.business.location}`, rating: 4.6, count: 87 },
        { id: 'sample-2', name: `${p.business.name} Café`, address: `Harbour Road, ${p.business.location.split(',')[0]}`, rating: 4.2, count: 31 },
        { id: 'sample-3', name: query.split(' ').slice(0, 2).join(' ') + ' Studio', address: p.business.location, rating: null, count: null },
      ];
    },
    async selectPlace(placeId) {
      await wait(900);
      const w = s.watcher!;
      if (w.reviews) w.reviews = { ...w.reviews, placeId, checkedAt: new Date().toISOString() };
      save(); return w;
    },
    async draftReviewReply(reviewId) {
      await wait(800);
      const rv = s.watcher?.reviews?.reviews.find((x) => x.id === reviewId);
      if (!rv) return '';
      addValue('reply_drafted', 'watcher', `Drafted a reply to ${rv.author}`); save();
      const p = s.profile!;
      if (rv.rating <= 2) {
        return `Mark, thank you for letting us know, and I’m really sorry your bowl arrived chipped. That isn’t the standard we pack to, and you should have heard back from us by now. We’ll send a replacement straight away. Please get in touch through our website or pop into the shop, and I’ll arrange it personally today.\n\n${p.business.ownerName}, ${p.business.name}`;
      }
      return fallbackReply(rv, p.business.name, p.business.ownerName);
    },
    async setFixDone(title, done) {
      const sp = s.watcher?.speed;
      if (sp) sp.fixes = sp.fixes.map((f) => (f.title === title ? { ...f, done } : f));
      if (done) addValue('issue_fixed', 'you', `Fixed: ${lower1(title)}`);
      save();
    },

    // Leads
    async listLeads() { await wait(150); ensure(); return s.leads; },
    async addLead(searchId, resultId) {
      const r = s.scout.find((x) => x.id === searchId)?.results.find((x) => x.id === resultId);
      if (!r) throw new Error('That lead no longer exists.');
      r.saved = true;
      const existing = s.leads.find((l) => l.name === r.name);
      if (existing) { save(); return existing; }
      const lead: Lead = { id: uid('l_'), name: r.name, location: r.location, website: r.website, reason: r.reason, source: r.source, stage: 'to_contact', followUps: 0, createdAt: new Date().toISOString() };
      s.leads = [lead, ...s.leads]; save(); return lead;
    },
    async updateLead(id, patch) {
      await wait(250);
      let lead = s.leads.find((l) => l.id === id);
      if (!lead) throw new Error('That lead no longer exists.');
      const was = lead.stage;
      const firstContact = !lead.contactedAt;
      if (patch.stage && patch.stage !== lead.stage) {
        lead = moveLead(lead, patch.stage);
        if (patch.stage === 'contacted' && firstContact) addValue('lead_contacted', 'you', `You contacted ${lead.name}`);
      }
      if (patch.followUpSent) lead = followUpSent(lead);
      if (patch.value !== undefined) lead = { ...lead, value: patch.value };
      // Same rules as the server: one "won" entry per lead, carrying the value the owner entered.
      const title = `Won: ${lead.name}`;
      const existing = s.values.find((v) => v.kind === 'lead_won' && v.title === title);
      if (lead.stage === 'won') {
        if (!existing) addValue('lead_won', 'you', title, lead.value ?? undefined);
        else if (patch.value !== undefined) existing.amount = patch.value && patch.value > 0 ? patch.value : null;
      } else if (was === 'won' && existing) {
        s.values = s.values.filter((v) => v !== existing);
      }
      s.leads = s.leads.map((l) => (l.id === id ? lead! : l)); save();
      return lead;
    },
    async draftFollowUp(id) {
      await wait(600);
      const p = s.profile!;
      const l = s.leads.find((x) => x.id === id);
      if (!l) return '';
      addValue('draft_written', 'scout', `Drafted a follow-up to ${l.name}`); save();
      return l.followUps === 0
        ? `Subject: Re: ${p.business.name} for ${l.name}?\n\nHi again,\n\nI just wanted to check my note reached you last week. I know this is a busy time of year, so I’ll keep it short: I’d be happy to send a few samples of our ${(p.offer.bestSeller || 'best sellers').toLowerCase()} so you can see the quality for yourself.\n\nWould that be useful?\n\nBest wishes,\n${p.business.ownerName}\n${p.business.name}`
        : `Subject: Last note from ${p.business.name}\n\nHi,\n\nI won’t keep chasing. If stocking local, handmade homeware is ever of interest, I’d love to hear from you, and the offer of samples stands.\n\nThank you for your time,\n${p.business.ownerName}\n${p.business.name}`;
    },

    // Contracts
    async listTenders() { await wait(150); ensure(); return s.tenders; },
    async updateTender(id, status) { s.tenders = s.tenders.map((t) => (t.id === id ? { ...t, status } : t)); save(); },

    // Win-back
    async draftWinback() {
      await wait(1100);
      const p = s.profile!;
      addValue('draft_written', 'brief', 'Drafted win-back messages for past customers'); save();
      const best = (p.offer.bestSeller || 'our best sellers').toLowerCase();
      return {
        email: `Subject: Something new from ${p.business.name}\n\nHi {first name},\n\nIt’s been a little while since you last visited, so I wanted to share what’s new. Our makers have just finished a new batch of ${best}, and the winter gift sets are in.\n\nAs one of our regulars, you get free gift wrapping and free local delivery on anything you order this month. Just reply to this email or pop in.\n\nThank you for supporting ${p.business.name}.\n\n${p.business.ownerName}`,
        text: `Hi {first name}, it’s ${p.business.ownerName} from ${p.business.name}. New ${best} and winter gift sets are in. Free gift wrapping for you this month, just mention this message. Reply STOP to opt out.`,
        social: `New this week: a fresh batch of ${best} from our makers, plus the winter gift sets. Everything is made within 30 miles of the shop, and we still gift-wrap for free. Come and see us or order online.`,
      };
    },

    resetDemo() { s = fresh(); save(); },
    fillSample() {
      const p = structuredClone(SAMPLE_PROFILE);
      return { ...emptyProfile(), ...p };
    },
  };
}

export { hostOf };
