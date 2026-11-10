import type { Api } from './api';
import type {
  Action, Alert, BriefReport, BusinessProfile, ChatMessage, Client, ClientAction, FeedbackRecord, HomeData, Lead, Outcome, ScoutResult, ScoutSearch, Tender,
  User, ValueEvent, ValueKind, Visit, WatcherState, WeekNumbers,
} from './types';
import { likelyOutcomes } from '../../shared/money';
import { uuid } from './format';
import { emptyProfile } from './questions';
import { metricsFor, analyseWeeks } from '../../shared/metrics';
import { writeBrief, type BriefContext } from '../../shared/brief-writer';
import { isDue } from '../../shared/leads';
import { daysLeft } from '../../shared/tenders';
import { reviewReplyDraft } from '../../shared/drafts';
import { followUpSent, moveLead } from '../../shared/leads';
import { hostOf } from '../../shared/learning';
import { planToday } from '../../shared/today';
import { sourceCatalogue } from '../../shared/ask';
import { mondayOf, uid } from './format';
import { communityResults, corporateResults, demandResults, localResults, partnerResults, sampleClients, sampleCompetitors, SAMPLE_PROFILE, SAMPLE_PROFILE_SHOP } from './demo-data';
import { scoutMode } from '../../shared/scout';
import { reviewsSince } from '../../shared/competitors';
import { dueThisWeek } from '../../shared/clients';
import { moneySummary } from '../../shared/money';
import { startOfMonth } from '../../shared/value';
export { SAMPLE_PROFILE, SAMPLE_PROFILE_SHOP };

const KEY = 'gainora.agents.demo.v3';
const DAY = 86_400_000;

interface DemoState {
  user: User | null;
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
  clients: Client[];
  visits: Visit[];
  clientActions: ClientAction[];
  outcomes: Outcome[];
  /** When the sample account was seeded: for the first minute and a half the demo behaves like a brand-new account (first search running, no clients yet). */
  seededAt?: string;
}

/** How long a freshly set-up demo behaves like a new account, so the first ten minutes can be seen. */
export const DEMO_FIRST_MINUTES_MS = 90_000;

const fresh = (): DemoState => ({ user: null, profile: null, seeded: false, actions: [], alerts: [], watcher: null, scout: [], numbers: [], briefs: [], chat: [], values: [], feedback: [], leads: [], tenders: [], clients: [], visits: [], clientActions: [], outcomes: [] });

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
    dueBack: (() => { const d = dueThisWeek(s.clients, s.visits, s.profile?.clientSettings ?? {}); return d.count ? { count: d.count, names: d.names, value: d.value } : null; })(),
    brought: (() => { const m = moneySummary(s.outcomes, s.clientActions, startOfMonth()); return m.bookings ? { amount: m.confirmed, bookings: m.bookings } : null; })(),
  };
}

function seed(s: DemoState) {
  const p = s.profile!;
  const now = Date.now();
  const r = rng(p.business.name.length * 977 + 13);
  const comps = p.competitors.list.filter((c) => c.name.trim());
  const c1 = comps[0]?.name || 'Your main competitor';
  const town = p.business.location.split(',')[0].trim() || 'your town';
  const site = p.business.website.replace(/\/$/, '');

  // The Watcher
  const history = Array.from({ length: 30 }, (_, i) => {
    const up = i !== 11;
    return { at: iso(now - (29 - i) * DAY), ms: up ? Math.round(620 + r() * 380 + (i > 24 ? 160 : 0)) : 0, up };
  });
  const competitors = sampleCompetitors(p, comps, now);
  const glow = competitors.list[0].name;
  s.watcher = {
    site: p.business.website, lastCheck: iso(now - 3 * 3_600_000), nextCheck: iso(now + 3_600_000 * 21),
    up: true, responseMs: history[29].ms, uptime30d: 99.7, sslDaysLeft: 23, pagesChecked: 12,
    brokenLinks: [
      { url: `${site}/treatments/skin-boosters-old`, foundOn: `${site}/treatments`, status: 404 },
    ],
    issues: [
      { id: 'contact', level: 'urgent', title: 'Your contact page needs attention', detail: 'Your contact page has no form, email link or phone link that we could find. Visitors need an obvious way to reach you; most of your enquiries come through Instagram, but Google sends people here.', link: `${site}/contact` },
      { id: 'ssl', level: 'notice', title: 'Your security certificate renews in 23 days', detail: 'Most hosts renew automatically. If yours doesn’t, visitors will see a warning page, so check it is set to auto-renew.' },
      { id: 'links', level: 'notice', title: '1 link leads to a missing page', detail: 'Visitors who click it see an error. Update or remove it; the list is below.' },
    ],
    history,
    changes: [
      { id: uid('c_'), competitor: glow, url: comps[0]?.url || '', at: iso(now - 2 * DAY), kind: 'offer', summary: `${glow} added a banner: 20% off Profhilo for new clients this November.`, detail: 'Their Profhilo (two sessions) is £420 to your £390, so even at 20% off they land at about £336. Worth considering: say plainly what your two sessions include (the free two-week review, the nurse prescriber) where your price is shown, rather than cutting.' },
      { id: uid('c_'), competitor: glow, url: comps[0]?.url || '', at: iso(now - 9 * DAY), kind: 'new-page', summary: `${glow} published a “Meet the team” page with four practitioners.`, detail: 'A bigger team is a size signal, not a quality one. Your edge is one nurse who sees you every time; it belongs on your home page.' },
    ],
    reviews: {
      placeId: 'sample-place', placeName: p.business.name, mapsUrl: 'https://www.google.com/maps', rating: 4.9, count: 61, previousCount: 59,
      checkedAt: iso(now - 3 * 3_600_000),
      history: [{ at: iso(now - 35 * DAY), rating: 4.9, count: 55 }, { at: iso(now - 28 * DAY), rating: 4.9, count: 56 }, { at: iso(now - 21 * DAY), rating: 4.9, count: 58 }, { at: iso(now - 14 * DAY), rating: 4.9, count: 58 }, { at: iso(now - 7 * DAY), rating: 4.9, count: 59 }, { at: iso(now), rating: 4.9, count: 61 }],
      reviews: [
        { id: 'rv1', author: 'Claire M.', rating: 3, text: 'Lovely results and Hannah is brilliant, but I messaged on Instagram three times to rebook and heard nothing for a week.', when: '2 days ago', isNew: true },
        { id: 'rv2', author: 'Gemma T.', rating: 5, text: 'Finally found someone who listens. Natural lips, no duck face, and she checked in two weeks later for free.', when: '4 days ago', isNew: true },
        { id: 'rv3', author: 'Rachel P.', rating: 5, text: 'First time having anti-wrinkle injections and I was nervous. Hannah talked me through everything and the result is so subtle. Will be back.', when: '6 days ago', isNew: true },
        { id: 'rv4', author: 'Sophie L.', rating: 5, text: `Best clinic in ${town} by a mile. Profhilo has made such a difference to my skin.`, when: '3 weeks ago', isNew: false },
      ],
      competitors: competitors.list.filter((c) => c.rating != null).map((c) => ({ name: c.name, rating: c.rating, count: c.count })),
    },
    speed: {
      checkedAt: iso(now - 2 * DAY), strategy: 'mobile',
      scores: { performance: 61, accessibility: 90, seo: 88, bestPractices: 96 },
      field: { lcp: { value: '3.1 s', rating: 'Needs work' }, inp: { value: '140 ms', rating: 'Good' }, cls: { value: '0.08', rating: 'Good' } },
      fixes: [
        { id: 'image-delivery-insight', title: 'Shrink your photos', impact: 'High', who: 'You', saving: 'could make the page about 1.4 s faster', why: 'Large before-and-after photos are the most common reason clinic sites are slow on phones, and slow pages lose visitors before they see anything.', how: 'Resize photos to no more than 2,000 pixels wide and save them as WebP or compressed JPEG. Most website builders have an image compression setting or app.' },
        { id: 'lcp-discovery-insight', title: 'Load your main image first', impact: 'High', who: 'Your web person', saving: 'could make the page about 0.8 s faster', why: 'The biggest image at the top of the page is set to load late, so the page looks empty for longer.', how: 'Ask your web person to turn off “lazy loading” for the top banner image and mark it as high priority.' },
        { id: 'meta-description', title: 'Add a description for Google', impact: 'Medium', who: 'You', why: 'Google shows this short description under your link. Without one it picks random text from the page.', how: 'In your website’s SEO settings, write one or two sentences for each main page saying what you offer and why to choose you.' },
        { id: 'image-alt', title: 'Describe your images', impact: 'Medium', who: 'You', why: 'Images without descriptions are invisible to Google Images and to people using screen readers.', how: 'Add a short description (alt text) to each treatment and banner image in your website editor.' },
      ],
    },
    prices: null,
    competitors,
  };

  // The Scout
  const consumer = scoutMode(p) === 'consumer';
  const what = String(p.offer.bestSeller || 'what we offer').split(/[,.(]/)[0].trim().toLowerCase();
  const query = consumer ? `People asking for ${what} recommendations near ${town}` : p.goals.focus === 'Find new wholesale or B2B clients' ? 'Independent shops that could stock our products' : `Businesses near ${town} that could refer customers to us`;
  const results = consumer ? demandResults(town, what) : makeResults(41, 10, ['the linen cupboard']).map((x, i) => ({ ...x, saved: i < 3 }));
  const partners = consumer ? partnerResults(town) : [];
  s.scout = [
    { id: uid('s_'), query, area: town, createdAt: iso(now - DAY), status: 'ready', kind: consumer ? 'demand' : 'customers',
      summary: consumer ? 'Four public posts in the last month where people around Crewe are asking for exactly what you do, with no answer from a local clinic yet. Reply to the first two today; each has a draft. In the demo these are samples; in your account each links to the real thread.' : 'Nine businesses matched. Five are a strong fit: they already stock independent makers and have a public way to contact the buyer.',
      results },
    ...(consumer ? [{ id: uid('s_'), query: `Hairdressers, bridal shops and gyms near ${town} that could refer clients`, area: town, createdAt: iso(now - 3 * DAY), status: 'ready' as const, kind: 'partners' as const, summary: 'Four nearby businesses whose customers are yours at the right moment, none of which offers aesthetics. Two are a strong fit and have introductions drafted. In the demo these are samples with example links.', results: partners.map((x, i) => ({ ...x, saved: i < 2 })) }] : []),
  ];
  const today9 = new Date(); today9.setHours(9, 0, 0, 0);
  const toLead = (x: ScoutResult, extra: Partial<Lead>): Lead => ({
    id: uid('l_'), name: x.name, location: x.location, website: x.website, reason: x.reason, source: x.source,
    stage: 'to_contact', followUps: 0, createdAt: iso(now - DAY), ...extra,
  });
  const leadSource = consumer ? partners : results;
  s.leads = [
    toLead(leadSource[0], { stage: 'contacted', contactedAt: iso(now - 4 * DAY), nextFollowUp: today9.toISOString() }),
    toLead(leadSource[1], {}),
    ...(consumer
      ? [{ id: uid('l_'), name: 'Nantwich Road Hair Studio', location: town, website: 'https://example.com', reason: 'Salon with six stylists and no skin or injectable treatments; agreed to keep your referral cards at reception.', source: { title: 'Nantwich Road Hair Studio – website (sample)', url: 'https://example.com' }, stage: 'won' as const, contactedAt: iso(now - 23 * DAY), followUps: 1, value: 640, createdAt: iso(now - 24 * DAY) }]
      : [toLead(results[2], { stage: 'replied', contactedAt: iso(now - 8 * DAY), followUps: 1 }),
        { id: uid('l_'), name: 'The Linen Cupboard', location: 'Truro', website: 'https://example.com', reason: 'Stocks several small UK makers and lists a wholesale enquiries contact on its website.', source: { title: 'The Linen Cupboard – about page (sample)', url: 'https://example.com' }, stage: 'won' as const, contactedAt: iso(now - 23 * DAY), followUps: 1, value: 1200, createdAt: iso(now - 24 * DAY) }]),
  ];

  // Public contracts
  s.tenders = consumer ? [
    { id: 't1', tenderId: 'sample-1', title: 'Staff wellbeing partner offers framework', buyer: 'NHS trust (sample)', summary: 'Local businesses offering discounted health, beauty and wellbeing services to staff through the trust’s benefits platform.', value: null, deadline: iso(now + 24 * DAY), url: 'https://www.contractsfinder.service.gov.uk/', region: 'North West', sme: true, fit: 'possible', reason: 'No money changes hands with the trust; you offer a staff rate and are listed to several thousand local staff. Fits your goal of more enquiries in the quiet months.', status: 'new', foundAt: iso(now - 2 * DAY) },
  ] : [
    { id: 't1', tenderId: 'sample-1', title: 'Locally made gifts and homeware for visitor centre shops', buyer: 'Heritage trust (sample)', summary: 'Supply of gifts, ceramics and textiles made in the county for resale in three visitor centre shops, with seasonal reorders.', value: 18000, deadline: iso(now + 21 * DAY), url: 'https://www.contractsfinder.service.gov.uk/', region: 'South West', sme: true, fit: 'strong', reason: 'They want locally made homeware for resale, which is exactly what you sell. You would need a price list, product photos and public liability insurance.', status: 'new', foundAt: iso(now - DAY) },
  ];

  // Your clients: a clinic's regulars, with two bookings confirmed from rebook texts this month.
  const sc = consumer ? sampleClients(now) : { clients: [], visits: [], actions: [], outcomes: [] };
  s.clients = sc.clients; s.visits = sc.visits; s.clientActions = sc.actions; s.outcomes = sc.outcomes;

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
    { id: uid('a_'), text: `Follow up with ${s.leads[0].name} today`, agent: 'scout', done: false, createdAt: iso(now - 2 * 3_600_000) },
    { id: uid('a_'), text: 'Reply to Claire M.’s 3-star review', agent: 'watcher', done: false, createdAt: iso(now - 3 * 3_600_000) },
    { id: uid('a_'), text: 'Fix your contact page so enquiries reach you', agent: 'watcher', done: false, createdAt: iso(now - 3 * 3_600_000) },
    { id: uid('a_'), text: `Decide how to answer ${c1}’s Profhilo offer`, agent: 'watcher', done: false, createdAt: iso(now - 2 * DAY) },
    ...(consumer ? [{ id: uid('a_'), text: 'Reply to the 2 public posts asking for what you do (replies are drafted in The Scout)', agent: 'scout' as const, done: false, createdAt: iso(now - DAY) }] : []),
    ...b.actions.slice(0, 1).map((t) => ({ id: uid('a_'), text: t, agent: 'brief' as const, done: false, createdAt: iso(now - 6 * 3_600_000) })),
  ];
  s.alerts = [
    { id: uid('al_'), agent: 'watcher', level: 'urgent', title: 'New 3-star review', body: 'Claire M. loved the result but waited a week for a reply on Instagram. A calm reply is drafted for you.', at: iso(now - 2 * 3_600_000), read: false },
    { id: uid('al_'), agent: 'watcher', level: 'urgent', title: 'Your contact page needs attention', body: 'No form, email link or phone link was found on it.', at: iso(now - 3 * 3_600_000), read: false },
    { id: uid('al_'), agent: 'watcher', level: 'notice', title: `${c1} is advertising “20% off Profhilo for new clients this November”`, body: 'Their two sessions are £420 to your £390 before the discount. Details on the Competitors tab.', at: iso(now - 2 * DAY), read: false },
    { id: uid('al_'), agent: 'scout', level: 'good', title: consumer ? '4 public posts found' : 'Public contract that fits you', body: consumer ? 'People near Crewe asking for anti-wrinkle and lip filler recommendations. Replies are drafted.' : 'Locally made gifts for visitor centre shops, worth £18,000.', at: iso(now - DAY), read: true },
  ];

  // Value tracker: this month and last month
  const h = (n: number) => now - n * 3_600_000;
  const d = (n: number) => now - n * DAY;
  s.values = [
    ev('issue_found', 'watcher', 'Found: your contact page returned an error', h(3)),
    ev('issue_found', 'watcher', 'Found: security certificate renews in 23 days', h(3)),
    ev('issue_found', 'watcher', 'Found: 1 link leads to a missing page', d(2)),
    ev('review_alert', 'watcher', 'New review from Claire M. (3 stars)', h(2)),
    ev('review_alert', 'watcher', 'New review from Gemma T. (5 stars)', d(4)),
    ev('review_alert', 'watcher', 'New review from Rachel P. (5 stars)', d(6)),
    ev('reply_drafted', 'watcher', 'Drafted a reply to Gemma T.', d(4)),
    ev('competitor_change', 'watcher', `${c1} is advertising 20% off Profhilo`, d(2)),
    ev('competitor_change', 'watcher', `${c1} changed the price of lip filler, 1ml from £220 to £240`, d(9)),
    ev('price_check', 'watcher', 'Compared your prices with 5 competitors, treatment by treatment', d(0)),
    ...results.map((x) => ev(consumer ? 'opportunity_found' : 'lead_found', 'scout', `${consumer ? 'Opportunity' : 'Lead'} found: ${x.name.slice(0, 60)}${x.location ? `, ${x.location}` : ''}`, d(1))),
    ...s.leads.slice(0, 2).map((l) => ev('lead_found', 'scout', `Lead found: ${l.name}, ${l.location}`, d(3))),
    ev('draft_written', 'scout', `Drafted an introduction to ${s.leads[0].name}`, d(4)),
    ev('lead_contacted', 'you', `You contacted ${s.leads[0].name}`, d(4)),
    ...s.tenders.map((t) => ev('tender_found', 'scout', `Contract found: ${t.title.toLowerCase()}`, d(2), t.value ?? undefined)),
    ev('brief_written', 'brief', 'Weekly Brief written', h(6)),
    // Last month
    ev('lead_found', 'scout', `Lead found: ${s.leads[s.leads.length - 1].name}, ${town}`, d(24)),
    ev('draft_written', 'scout', `Drafted an introduction to ${s.leads[s.leads.length - 1].name}`, d(23)),
    ev('lead_won', 'you', `Won: ${s.leads[s.leads.length - 1].name}`, d(15), s.leads[s.leads.length - 1].value ?? undefined),
    ev('issue_found', 'watcher', 'Found: treatments page took 6 seconds to load', d(20)),
    ev('issue_fixed', 'you', 'Fixed: treatments page speed', d(18)),
    ev('brief_written', 'brief', 'Weekly Brief written', d(14)),
    ev('brief_written', 'brief', 'Weekly Brief written', d(21)),
  ];
  s.feedback = [];
  s.chat = [];
  s.seededAt = iso(now);
  s.seeded = true;
}

/** The Watcher's state as a new account sees it in its first minutes: the nearby search still running. */
function firstMinutesWatcher(w: WatcherState): WatcherState {
  const c = w.competitors;
  return { ...w, changes: [], competitors: c ? { ...c, foundAt: null, list: c.list.filter((x) => x.source === 'typed'), nearby: [], events: [], advice: undefined, comparison: null } : c };
}

function demoReply(text: string, s: DemoState): ChatMessage {
  const p = s.profile!;
  const t = text.toLowerCase();
  const comps = s.watcher?.competitors;
  const cmp = comps?.comparison;
  const c = s.watcher?.changes[0];
  const first = s.scout[0];
  const due = s.leads.find((l) => l.stage === 'contacted');
  let reply: string;
  let keys: string[] = ['profile'];
  if (/price|charge|cost|cheap|expensive|dear/.test(t) && cmp && cmp.rows.length) {
    keys = ['prices'];
    const rows = cmp.rows.filter((r) => r.yours && r.listedBy).slice(0, 3);
    const gap = cmp.theyOfferYouDont[0];
    const gbp = (v: number) => `£${Number.isInteger(v) ? v : v.toFixed(2)}`;
    const brand = (l: string) => (/^[A-Z][A-Z]|^(HydraFacial|HIFU|LED|IPL|BIAB|PRP|RF|Profhilo|Sculptra|Morpheus8)\b/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1));
    reply = `Like for like, against the ${cmp.competitors.length} businesses the Watcher reads around ${p.business.location.split(',')[0]}:\n\n${rows.map((r) => `${r.label}: you ${r.yours!.price}, local average ${gbp(r.localAvg!)} (${r.position}).`).join('\n')}${gap ? `\n\n${gap.by.length} of them price ${brand(gap.label)} (${gap.by.map((b) => `${b.name} ${b.price}`).join(', ')}) and your list doesn’t show it.` : ''}\n\nOne thing to do: where your prices are shown, say what each includes (the free two-week review, 45 minutes with a nurse prescriber). The Prices tab has every row with its source.`;
  } else if (/busiest|bigger|busy|size|team|followers|compare|vs|versus|them/.test(t) && comps?.list.length) {
    keys = ['competitors'];
    const glow = comps.list[0];
    reply = `On the public figures, ${glow.name} looks the biggest: ${glow.count} Google reviews to your ${s.watcher?.reviews?.count ?? '–'}, a team of ${glow.venue?.team ?? '–'} on Fresha and ${glow.social?.followers?.toLocaleString('en-GB') ?? '–'} Instagram followers to your ${comps.you?.instagram?.followers?.toLocaleString('en-GB') ?? '–'}. The Lip Lounge is the one gaining fastest: 8 new Google reviews in 30 days and 22 Instagram posts, on lips only.\n\nThose are signs of how busy they look, not their bookings. The You vs them tab lays every figure side by side.\n\nOne thing to do: ask your last ten happy clients for a Google review this week; you are at 6 new in 30 days to ${glow.name}’s ${reviewsSince(glow.history, 30) ?? '–'}.`;
  } else if (/review|rating|google/.test(t) && s.watcher?.reviews) {
    keys = ['reviews'];
    const rv = s.watcher.reviews;
    reply = `You’re on ${rv.rating} stars from ${rv.count} Google reviews, the highest rating of the clinics the Watcher follows, though with fewer reviews than ${rv.competitors[0]?.name ?? 'your main competitor'} (${rv.competitors[0]?.count ?? '–'}). Three new reviews came in this week.\n\nThe one to deal with today is Claire M.’s 3-star review: she loved the result but waited a week for a reply on Instagram. A calm public reply is drafted on the Reviews tab, and the fix behind it is a daily ten-minute slot for messages.`;
  } else if (/post|asking|recommend|thread|reddit|forum|scout|find customers|customers|enquir/.test(t) && first) {
    keys = ['scout'];
    const top = first.results.filter((r) => !r.dismissed).slice(0, 2);
    reply = `The Scout found ${first.results.length} public posts in the last month where people near ${p.business.location.split(',')[0]} are asking for what you do, and no local clinic has answered. Start with: ${top.map((r) => `“${r.name}” (${r.platform})`).join(' and ')}.\n\nEach has a reply drafted that says you run the clinic and helps first. Post them yourself today; threads like these get read for months.`;
  } else if (/follow|chase|lead|partner/.test(t) && due) {
    keys = ['leads'];
    reply = `${due.name} is due a follow-up today. You contacted them four days ago and haven’t heard back, which is normal. A short, friendly nudge usually gets a reply. The Scout has written it for you on the Leads tab.`;
  } else if (/competitor|rival|glow|offer|profhilo|changed/.test(t) && c) {
    keys = ['changes', 'competitors'];
    reply = `The biggest move this fortnight: ${c.summary} ${c.detail ?? ''}\n\nGiven that your edge is “${p.competitors.ourEdge.replace(/\.$/, '')}”, I wouldn’t race them on price.`;
  } else if (/number|week|brief|revenue|sales|orders/.test(t) && s.briefs[0]) {
    keys = ['brief', 'numbers'];
    const b = s.briefs[0];
    reply = `${b.headline}\n\n${b.paragraphs[0]}\n\nIf you only do one thing this week: ${lower1(b.actions[0])}.`;
  } else if (/website|site|slow|form|broken|link|speed|contact/.test(t) && s.watcher) {
    keys = ['site', 'speed'];
    reply = `Two things matter most on your website. Your contact page has no form, email or phone link, so people Google sends there have no way to reach you; fix that first. Then shrink your before-and-after photos: Google’s test says it could make your site about 1.4 seconds faster on phones, and you can do it yourself.`;
  } else if (/goal|target|plan|focus|priorit/.test(t)) {
    keys = ['profile', 'scout', 'competitors'];
    reply = `Your goal is ${lower1(p.goals.target)}; you’re at 12 a week. With ${p.goals.timePerWeek.toLowerCase()} a week, I’d spend it like this:\n\nReply to the two public posts the Scout found (ten minutes, drafts ready). Fix the contact page. Then ask your last ten happy clients for a Google review: on the public figures Glow looks busier than you, and reviews are where people choosing on Google see the difference.`;
  } else {
    keys = ['site', 'reviews', 'prices', 'scout'];
    reply = `Here’s where ${p.business.name} stands: one urgent website issue (the contact page), a 3-star review waiting for a calm reply, ${cmp ? `${cmp.rows.filter((r) => r.yours && r.listedBy).length} treatments compared like for like with the clinics nearby` : 'your prices compared with the clinics nearby'}, and ${first ? `${first.results.length} public posts` : 'posts'} from people nearby asking for what you do.\n\nAsk me about any of those, your competitors, your prices or who to contact next.`;
  }
  const cat = sourceCatalogue({ site: 'today', reviews: 'today', prices: 'today', brief: s.briefs[0] ? `week of ${new Date(s.briefs[0].weekOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '' });
  const sources = keys.map((k) => cat.find((c) => c.key === k)!).filter(Boolean).map(({ title, url }) => ({ title, url }));
  return { id: uid('m_'), role: 'agent', text: reply, at: new Date().toISOString(), sources };
}

export function createDemoApi(): Api {
  let s = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* demo works without storage */ } };
  const ensure = () => { if (s.profile?.completedAt && !s.seeded) { seed(s); save(); } };
  const firstMinutes = () => !!s.seededAt && Date.now() - new Date(s.seededAt).getTime() < DEMO_FIRST_MINUTES_MS;
  const clientsNow = () => (firstMinutes() ? { ready: true, clients: [], visits: [], actions: [], outcomes: [] } : { ready: true, clients: s.clients, visits: s.visits, actions: s.clientActions, outcomes: s.outcomes });
  const addValue = (kind: ValueKind, agent: ValueEvent['agent'], title: string, amount?: number) => { s.values = [ev(kind, agent, title, Date.now(), amount), ...s.values]; };

  return {
    mode: 'demo',
    async getUser() { await wait(120); return s.user; },
    async requestSignIn(email) { await wait(500); s.user = { id: 'demo', email }; save(); },
    async signInWithPassword(email) { await wait(400); s.user = { id: 'demo', email, hasPassword: true }; save(); },
    async setPassword() { await wait(400); if (s.user) { s.user = { ...s.user, hasPassword: true, passwordStep: undefined }; save(); } },
    async signOut() { s.user = null; save(); },

    async getProfile() { await wait(120); return s.profile; },
    async saveProfile(p) { await wait(250); s.profile = structuredClone(p); ensure(); save(); },
    async getPlan() { return { agents: ['watcher', 'scout', 'brief'], status: 'active', renewsOn: iso(Date.now() + 19 * DAY), capture: true }; },
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
        profile: p, agents: ['watcher', 'scout', 'brief'], watcher: firstMinutes() ? firstMinutesWatcher(s.watcher!) : s.watcher, leads: s.leads, tenders: s.tenders, searches: s.scout.length,
        changes: analyseWeeks(s.numbers, metrics), hasThisWeeksNumbers: s.numbers.some((w) => w.weekOf === thisWeek),
        clients: { ...clientsNow(), settings: p.clientSettings },
      });
      return {
        today,
        clients: clientsNow(),
        notes: [
          { agent: 'watcher', body: (() => { const low = s.watcher?.reviews?.reviews.find((r) => r.isNew && r.rating <= 3); return `${low ? `${low.author} left a ${low.rating}-star review; the reply is drafted. ` : ''}Your contact page has no form, email or phone link, so some enquiries may not be reaching you.${s.watcher?.changes[0] ? ` ${s.watcher.changes[0].competitor} ${s.watcher.changes[0].summary.replace(/^[^ ]+( [^ ]+)* (added|published|changed|posted)/, '$2')}` : ''}`; })() },
          { agent: 'scout', body: `${due.length ? `${due[0].name} is due a follow-up today. ` : ''}${s.tenders[0] ? `I also found a public contract, “${s.tenders[0].title.toLowerCase()}”, that fits you${s.tenders[0].value ? ` (published value £${s.tenders[0].value.toLocaleString('en-GB')})` : ''}` : 'I also looked for public contracts that fit you'}, and ${strong} strong leads.` },
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

    async getWatcher() { await wait(200); ensure(); return firstMinutes() ? firstMinutesWatcher(s.watcher!) : s.watcher!; },
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
        const town0 = s.profile!.business.location.split(',')[0].trim() || 'your town';
        const what0 = String(s.profile!.offer.bestSeller || 'what we offer').split(/[,.(]/)[0].trim().toLowerCase();
        if (kind === 'local') {
          found.results = localResults(town0);
          found.summary = 'Five local opportunities in the next few months. The first three suit you best. In the demo these are samples; in your account each comes with its source.';
          found.results.forEach((x) => addValue('opportunity_found', 'scout', `Opportunity found: ${x.name}`));
        } else if (kind === 'demand' || kind === 'communities' || kind === 'partners' || kind === 'corporate') {
          found.results = kind === 'demand' ? demandResults(town0, what0) : kind === 'communities' ? communityResults(town0) : kind === 'partners' ? partnerResults(town0) : corporateResults(town0);
          found.summary = kind === 'demand' ? 'Public posts from the last month where people nearby are asking for what you do. Each has a reply drafted; you post it yourself. In the demo these are samples; in your account each links to the real thread.'
            : kind === 'communities' ? 'Local groups where your customers talk to each other, each with an introduction to post once you have joined. In the demo these are samples.'
            : kind === 'partners' ? 'Nearby businesses whose customers are yours at the right moment, none of which offers what you do. In the demo these are samples with example links.'
            : 'Employers and venues nearby with staff perks or wellness programmes you could be part of. In the demo these are samples.';
          found.results.forEach((x) => addValue(kind === 'demand' || kind === 'communities' ? 'opportunity_found' : 'lead_found', 'scout', `${kind === 'demand' || kind === 'communities' ? 'Opportunity' : 'Lead'} found: ${x.name.slice(0, 60)}`));
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
    async getCaptureWeek() { await wait(200); return { from: iso(Date.now() - 7 * DAY), to: iso(Date.now()), enquiries: 14, afterHours: 5, booked: 6, bookedValue: 1140, valueIsMinimum: true }; },
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
      return reviewReplyDraft(rv, { clinic: p.business.name, owner: p.business.ownerName.split(' ')[0], style: p.preferences.style, edge: p.competitors.ourEdge });
    },
    async updateCompetitor(op, key, handle) {
      await wait(300);
      const w = s.watcher!; const c = w.competitors!;
      const now = new Date().toISOString();
      if (op === 'dismiss') {
        const x = c.list.find((t) => t.key === key) ?? c.nearby.find((t) => t.key === key);
        if (x) { c.list = c.list.filter((t) => t.key !== key); c.nearby = c.nearby.filter((t) => t.key !== key); c.events = c.events.filter((e) => e.key !== key); c.dismissed = [...c.dismissed, { key, name: x.name, at: now }]; if (c.advice) c.advice = { ...c.advice, lines: c.advice.lines.filter((l) => l.key !== key) }; }
      } else if (op === 'watch') {
        const n = c.nearby.find((t) => t.key === key);
        if (n) { c.nearby = c.nearby.filter((t) => t.key !== key); c.list = [...c.list, { key: n.key, name: n.name, source: 'found', url: n.url || '', placeId: n.placeId, address: n.address, mapsUrl: 'https://www.google.com/maps', distanceKm: n.distanceKm, rating: n.rating, count: n.count, history: [{ at: now, rating: n.rating, count: n.count }], services: [], offers: [], bookingPages: [], social: null, firstSeenAt: now }]; }
      } else if (op === 'restore') {
        c.dismissed = c.dismissed.filter((d) => d.key !== key);
      } else if (op === 'instagram') {
        const x = c.list.find((t) => t.key === key);
        if (x) { x.instagram = handle ? `https://www.instagram.com/${handle.replace(/^@/, '')}/` : undefined; x.instagramSetBy = 'owner'; x.social = null; }
      }
      save(); return w;
    },
    async findCompetitors() { await wait(600); return { started: false, message: 'In the demo the nearby list is a sample. In your account the Watcher searches Google around your location every month, and on request once a week.' }; },
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

    // Your clients
    async listClients() { await wait(150); ensure(); return clientsNow(); },
    async saveClient(c) {
      await wait(150);
      s.clients = s.clients.some((x) => x.id === c.id) ? s.clients.map((x) => (x.id === c.id ? c : x)) : [c, ...s.clients];
      save(); return c;
    },
    async deleteClient(id) {
      s.clients = s.clients.filter((c) => c.id !== id); s.visits = s.visits.filter((v) => v.clientId !== id);
      s.clientActions = s.clientActions.filter((a) => a.clientId !== id); s.outcomes = s.outcomes.filter((o) => o.clientId !== id); save();
    },
    async addVisit(v) {
      await wait(150);
      s.visits = [v, ...s.visits];
      const likely = likelyOutcomes(s.clientActions.filter((a) => a.clientId === v.clientId), [v], s.outcomes, uuid);
      s.outcomes = [...likely, ...s.outcomes]; save();
      return { visit: v, likely };
    },
    async deleteVisit(id) { s.visits = s.visits.filter((v) => v.id !== id); save(); },
    async importClients(clients, visits, optOutIds) {
      await wait(600);
      s.clients = [...clients, ...s.clients]; s.visits = [...visits, ...s.visits];
      s.clients = s.clients.map((c) => (optOutIds.includes(c.id) ? { ...c, consent: 'opted_out', consentAt: new Date().toISOString(), consentSource: 'import' } : c)); save();
    },
    async recordAction(a) {
      s.clientActions = [a, ...s.clientActions];
      if (a.kind === 'review_request' && a.clientId) s.clients = s.clients.map((c) => (c.id === a.clientId ? { ...c, lastReviewAskAt: a.sentAt } : c));
      save(); return a;
    },
    async saveOutcome(o) { s.outcomes = s.outcomes.some((x) => x.id === o.id) ? s.outcomes.map((x) => (x.id === o.id ? o : x)) : [o, ...s.outcomes]; save(); return o; },
    async deleteOutcome(id) { s.outcomes = s.outcomes.filter((o) => o.id !== id); save(); },
    async deleteAllClientData() { await wait(300); s.clients = []; s.visits = []; s.clientActions = []; s.outcomes = []; save(); },
    async sendSms() { await wait(300); return { sent: false, message: 'No text-message provider is connected in the demo. Use “Send from your phone”, which opens your messages app with the text ready.' }; },

    resetDemo() { s = fresh(); save(); },
    fillSample() {
      const p = structuredClone(SAMPLE_PROFILE);
      return { ...emptyProfile(), ...p };
    },
  };
}

export { hostOf };
