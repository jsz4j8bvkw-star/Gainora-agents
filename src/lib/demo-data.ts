// Sample data for the demo: a nurse-led aesthetics clinic in Crewe, the kind of business Gainora
// is built for, with the competition the Watcher would find around it: some with websites, some
// with only a Fresha page, one only on Instagram, one on a booking system that cannot be read.
// Figures are invented for the demo but shaped like the real ones the live app reads; the
// comparison itself is computed by the same shared code the live app uses.
import type { BusinessProfile, ScoutResult } from './types';
import { adviseReach, reviewsSince, type CompetitorsState, type TrackedCompetitor } from '../../shared/competitors';
import { parsePriceList } from '../../shared/booking';
import { comparePrices } from '../../shared/treatments';
import { uid } from './format';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

export const SAMPLE_PRICE_LIST = `Anti-wrinkle injections – 1 area £150
Anti-wrinkle injections – 2 areas £195
Anti-wrinkle injections – 3 areas £240
Lip filler 0.5ml £170
Lip filler 1ml £220
Cheek filler 1ml £260
Jawline filler 2ml £420
Tear trough filler £350
Filler dissolving £120
Profhilo (2 sessions) £390
Seventy Hyal skin booster £180
Microneedling £120
Dermaplaning £45
Consultation FREE`;

export const SAMPLE_PROFILE: BusinessProfile = {
  business: {
    ownerName: 'Hannah', name: 'Willow Aesthetics', website: 'https://example.com', instagram: '@willowaesthetics.crewe', facebook: 'facebook.com/willowaestheticscrewe',
    oneLiner: 'Nurse-led aesthetics clinic in Crewe: anti-wrinkle injections, lip and dermal filler, Profhilo, skin boosters and skin treatments, with unhurried 45-minute appointments.',
    industry: 'Hair, beauty and wellbeing', location: 'Crewe, Cheshire', postcode: 'CW1 2BD', tradingSince: '2021', teamSize: 'Just me', legalForm: 'Limited company',
  },
  offer: {
    products: 'Anti-wrinkle injections, lip filler, cheek and jawline filler, tear trough filler, Profhilo, skin boosters, microneedling and dermaplaning.',
    typicalPrice: '£150–£300 a visit', salesChannels: ['In person', 'Social media messages', 'Website'], bestSeller: 'Anti-wrinkle injections (2 areas)',
    bookingSystem: 'Fresha', bookingUrl: 'https://www.fresha.com/a/willow-aesthetics-crewe-sample', priceList: SAMPLE_PRICE_LIST,
  },
  customers: { ideal: 'Women aged 30 to 55 within 20 minutes of Crewe who want natural-looking results from a nurse prescriber rather than a high-street chain.', sources: ['Instagram', 'Word of mouth', 'Google Maps', 'Facebook'], areas: ['Local'], repeat: 'Most' },
  competitors: { list: [{ name: 'Glow Aesthetics Crewe', url: 'https://example.org' }], ourEdge: 'Nurse prescriber, 45-minute appointments, a free two-week review and no sales pressure.', theirEdge: 'A bigger team, Sunday opening and a busier Instagram.' },
  numbers: { revenueBand: '£5k–£20k', enquiriesPerWeek: '12', salesPerWeek: '18', averageOrder: '210', track: ['Revenue', 'Orders or sales', 'Enquiries', 'New reviews'] },
  goals: { focus: 'More enquiries', target: '25 enquiries a week by March', detail: 'January and February are quiet and I want the diary fuller before spring.', twelveMonth: 'A second treatment room and a part-time therapist for skin treatments.', obstacle: 'Time: I do the treatments, the admin and the Instagram myself.', timePerWeek: '2–5 hours' },
  preferences: { reportDay: 'Monday', reportTime: '7am', alerts: 'Urgent only', style: 'Short and direct', extraRecipient: '' },
};

/** The previous sample business, a homeware shop, kept for the tests and as a second example of a business that sells to businesses. */
export const SAMPLE_PROFILE_SHOP: BusinessProfile = {
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

/** The town from the profile, for sample addresses. */
const townOf = (p: BusinessProfile) => p.business.location.split(',')[0].trim() || 'Crewe';

/** The sample competition: who the Watcher would find around a Crewe clinic, with the detail the live app reads from public pages. */
export function sampleCompetitors(p: BusinessProfile, typed: { name: string; url: string }[], now: number): CompetitorsState {
  const d = (n: number) => iso(now - n * DAY);
  const samples = (start: number, perWeek: number, weeks = 7) => Array.from({ length: weeks }, (_, i) => ({ at: d((weeks - 1) * 7 - i * 7), rating: 4.8, count: start + i * perWeek }));
  const town = townOf(p);
  const typedName = typed[0]?.name || 'Glow Aesthetics Crewe'; const typedUrl = typed[0]?.url || 'https://example.org';
  const base = { services: [], offers: [], bookingPages: [], social: null, venue: null, history: [], rating: null, count: null };
  const svc = (url: string, at: string, via: 'fresha' | 'page' | 'schema', lines: string) => parsePriceList(lines).map((x) => ({ name: x.name, price: x.price, url, seenAt: at, via, ...(x.duration ? { duration: x.duration } : {}) }));
  const ig = (handle: string, followers: number, posts30: number, posts: { id: string; caption: string; daysAgo: number; likes: number; comments: number }[], findings: { text: string; postId: string; daysAgo: number }[]) => ({
    handle, url: `https://www.instagram.com/${handle}/`, checkedAt: d(0), followers, mediaCount: Math.round(followers / 6), postsLast30: posts30,
    followersHistory: Array.from({ length: 14 }, (_, i) => ({ at: d(13 - i), n: followers - (13 - i) * Math.max(1, Math.round(followers / 900)) })),
    posts: posts.map((x) => ({ id: x.id, caption: x.caption, at: d(x.daysAgo), likes: x.likes, comments: x.comments, url: `https://www.instagram.com/p/${x.id}/`, type: 'IMAGE' })),
    findings: findings.map((f) => ({ text: f.text, url: `https://www.instagram.com/p/${f.postId}/`, seenAt: d(f.daysAgo), from: 'instagram' as const })),
    error: null as null,
  });

  const glowFresha = 'https://www.fresha.com/a/glow-aesthetics-crewe-sample';
  const list: TrackedCompetitor[] = [
    { ...base, key: 'p:sample-glow', name: typedName, source: 'typed', url: typedUrl, placeId: 'sample-glow', address: `Nantwich Road, ${town}`, mapsUrl: 'https://www.google.com/maps', distanceKm: 2.1, primaryType: 'beauty_salon', relevance: 2,
      rating: 4.8, count: 212, history: samples(190, 3), ratingCheckedAt: d(0), firstSeenAt: d(40),
      instagram: 'https://www.instagram.com/glowaestheticscrewe/', instagramSetBy: 'website', facebook: 'https://www.facebook.com/glowaestheticscrewe',
      bookingPages: [glowFresha], pagesRead: [typedUrl, `${typedUrl}/prices`, glowFresha], sourcesCheckedAt: d(0),
      venue: { platform: 'Fresha', url: glowFresha, name: typedName, rating: 4.9, reviews: 318, team: 4, serviceCount: 42, priceRange: '£25 - £650', checkedAt: d(0), partial: true },
      services: svc(glowFresha, d(0), 'fresha', `Anti-Wrinkle Injections – 1 area £165 (30 mins)
Anti-Wrinkle Injections – 2 areas £220 (30 mins)
Anti-Wrinkle Injections – 3 areas £260 (30 mins)
Lip Filler 0.5ml £180 (45 mins)
Lip Filler 1ml £240 (45 mins)
Cheek Filler 1ml £280
Jawline Filler 2ml £450
Profhilo (2 sessions) £420
Polynucleotides (course of 3) £600
HydraFacial £95 (50 mins)
Dermaplaning £50 (45 mins)
Microneedling £130
LED light therapy £35`),
      offers: [{ text: '20% off Profhilo for new clients this November', url: `${typedUrl}/prices`, seenAt: d(2), from: 'website' }],
      social: ig('glowaestheticscrewe', 3860, 14, [
        { id: 'g1', caption: '20% off Profhilo for new clients this November. Two sessions four weeks apart, glow guaranteed by Christmas. DM to book.', daysAgo: 1, likes: 112, comments: 9 },
        { id: 'g2', caption: 'Sunday clinic is back! Book your anti-wrinkle top-ups for Sunday 23rd. Link in bio.', daysAgo: 4, likes: 88, comments: 6 },
        { id: 'g3', caption: 'Welcome to the team, Priya, our new aesthetic nurse. Priya is taking bookings from next week.', daysAgo: 9, likes: 203, comments: 31 },
      ], [{ text: '20% off Profhilo for new clients this November', postId: 'g1', daysAgo: 1 }, { text: 'Sunday clinic is back', postId: 'g2', daysAgo: 4 }]) },

    { ...base, key: 'p:sample-skintonic', name: 'Skin & Tonic Nantwich', source: 'found', url: '', placeId: 'sample-skintonic', address: 'Hospital Street, Nantwich', mapsUrl: 'https://www.google.com/maps', distanceKm: 6.4, primaryType: 'skin_care_clinic', relevance: 2,
      rating: 4.9, count: 96, history: samples(84, 2), ratingCheckedAt: d(0), firstSeenAt: d(30),
      bookingPages: ['https://www.fresha.com/a/skin-and-tonic-nantwich-sample'], pagesRead: ['https://www.fresha.com/a/skin-and-tonic-nantwich-sample'], sourcesCheckedAt: d(0),
      instagram: 'https://www.instagram.com/skinandtonic.nantwich/', instagramSetBy: 'listing',
      venue: { platform: 'Fresha', url: 'https://www.fresha.com/a/skin-and-tonic-nantwich-sample', name: 'Skin & Tonic', rating: 5, reviews: 141, team: 2, serviceCount: 24, priceRange: '£30 - £480', checkedAt: d(0) },
      services: svc('https://www.fresha.com/a/skin-and-tonic-nantwich-sample', d(0), 'fresha', `Anti-wrinkle 1 area £140 (30 mins)
Anti-wrinkle 2 areas £180 (30 mins)
Anti-wrinkle 3 areas £220 (30 mins)
Lip filler 1ml £200 (45 mins)
Cheek filler 1ml £240
Profhilo (2 sessions) £380
Seventy Hyal skin booster £160
Microneedling £110 (60 mins)
Chemical peel £70
Dermaplaning £40 (45 mins)`),
      social: ig('skinandtonic.nantwich', 1420, 6, [{ id: 's1', caption: 'Autumn skin reset: a peel now and microneedling in four weeks sets you up for party season.', daysAgo: 6, likes: 41, comments: 3 }], []) },

    { ...base, key: 'p:sample-liplounge', name: 'The Lip Lounge', source: 'found', url: '', placeId: 'sample-liplounge', address: `Market Street, ${town}`, mapsUrl: 'https://www.google.com/maps', distanceKm: 1.3, primaryType: 'beauty_salon', relevance: 2,
      rating: 5, count: 41, history: [{ at: d(28), rating: 5, count: 33 }, { at: d(21), rating: 5, count: 36 }, { at: d(14), rating: 5, count: 38 }, { at: d(7), rating: 5, count: 40 }, { at: d(0), rating: 5, count: 41 }], ratingCheckedAt: d(0), firstSeenAt: d(30),
      instagram: 'https://www.instagram.com/theliplounge.crewe/', instagramSetBy: 'listing',
      social: ig('theliplounge.crewe', 2910, 22, [
        { id: 'l1', caption: 'Lip filler 1ml £180 all of November. Russian technique available. Book through the link in bio.', daysAgo: 2, likes: 156, comments: 18 },
        { id: 'l2', caption: 'Before and after: 0.5ml, natural and hydrated. Model price £120 this week only.', daysAgo: 5, likes: 98, comments: 7 },
      ], [{ text: 'Lip filler 1ml £180 all of November', postId: 'l1', daysAgo: 2 }, { text: 'Model price £120 this week only', postId: 'l2', daysAgo: 5 }]) },

    { ...base, key: 'p:sample-sandbach', name: 'Sandbach Skin Clinic', source: 'found', url: 'https://example.net', placeId: 'sample-sandbach', address: 'High Street, Sandbach', mapsUrl: 'https://www.google.com/maps', distanceKm: 7.2, primaryType: 'skin_care_clinic', relevance: 2,
      rating: 4.7, count: 158, history: samples(146, 2), ratingCheckedAt: d(0), firstSeenAt: d(30),
      bookingPages: ['https://sandbachskin.pabau.com/'], unreadable: ['https://sandbachskin.pabau.com/'], pagesRead: ['https://example.net', 'https://example.net/treatments'], sourcesCheckedAt: d(0),
      instagram: 'https://www.instagram.com/sandbachskinclinic/', instagramSetBy: 'website', facebook: 'https://www.facebook.com/sandbachskinclinic',
      services: svc('https://example.net/treatments', d(0), 'page', `Anti-wrinkle injections from £160
Dermal filler 1ml from £250
Profhilo (2 sessions) £450
Morpheus8 full face £550
Polynucleotides (course of 3) £650
HydraFacial £110
Laser hair removal – upper lip £45`),
      offers: [],
      social: { handle: 'sandbachskinclinic', url: 'https://www.instagram.com/sandbachskinclinic/', checkedAt: d(0), followers: null, mediaCount: null, postsLast30: null, followersHistory: [], posts: [], findings: [], error: 'not-business' } },

    { ...base, key: 'p:sample-nrbeauty', name: 'Nantwich Road Beauty', source: 'found', url: '', placeId: 'sample-nrbeauty', address: `Nantwich Road, ${town}`, mapsUrl: 'https://www.google.com/maps', distanceKm: 0.9, primaryType: 'beauty_salon', relevance: 1,
      rating: 4.6, count: 23, history: samples(21, 0, 5), ratingCheckedAt: d(0), firstSeenAt: d(30),
      facebook: 'https://www.facebook.com/nantwichroadbeauty', sourcesCheckedAt: d(0) },
  ];

  const you = {
    lat: 53.0979, lng: -2.4406, locSource: 'listing' as const,
    services: parsePriceList(p.offer.priceList || SAMPLE_PRICE_LIST).map((x) => ({ name: x.name, price: x.price, url: p.offer.bookingUrl || p.business.website, seenAt: d(0), via: 'owner' as const })),
    sourcesCheckedAt: d(0),
    venue: { platform: 'Fresha', url: p.offer.bookingUrl || 'https://www.fresha.com/a/willow-aesthetics-crewe-sample', name: p.business.name, rating: 5, reviews: 48, team: 1, serviceCount: 18, priceRange: '£45 - £420', checkedAt: d(0) },
    instagram: ig('willowaesthetics.crewe', 1240, 5, [{ id: 'w1', caption: 'A quiet Tuesday in clinic. Two-week review for every new client, always free.', daysAgo: 3, likes: 54, comments: 4 }], []),
  };
  const comparison = comparePrices(you.services, list.map((c) => ({ key: c.key, name: c.name, services: c.services })), d(0));
  const events = [
    { id: 'post:p:sample-liplounge:l1', at: d(2), key: 'p:sample-liplounge', competitor: 'The Lip Lounge', kind: 'post' as const, url: 'https://www.instagram.com/p/l1/', summary: 'The Lip Lounge posted on Instagram: “Lip filler 1ml £180 all of November”.' },
    { id: 'offer:p:sample-glow', at: d(2), key: 'p:sample-glow', competitor: typedName, kind: 'offer' as const, url: `${typedUrl}/prices`, summary: `${typedName} is advertising “20% off Profhilo for new clients this November”.` },
    { id: 'price:p:sample-glow:lip-1', at: d(9), key: 'p:sample-glow', competitor: typedName, kind: 'price' as const, url: glowFresha, summary: `${typedName} changed the price of lip filler, 1ml from £220 to £240.` },
    { id: 'reviews:p:sample-glow', at: d(3), key: 'p:sample-glow', competitor: typedName, kind: 'reviews' as const, url: 'https://www.google.com/maps', summary: `${typedName} got ${reviewsSince(list[0].history, 30, new Date(now))} new Google reviews in the last 30 days; you got 6.`, detail: 'New reviews are a sign of how busy a business looks, not a count of their bookings.' },
    { id: 'new-nearby:p:sample-liplounge', at: d(12), key: 'p:sample-liplounge', competitor: 'The Lip Lounge', kind: 'new-nearby' as const, url: 'https://www.google.com/maps', summary: 'New on Google near you: The Lip Lounge, 1.3 km away (33 reviews).', detail: 'A listing with few reviews is often a recent opening.' },
  ];
  const adviceYou = { rating: 4.9, count: 61, reviews30: 6, services: you.services, instagram: you.instagram, venue: you.venue };
  return {
    checkedAt: d(0), foundAt: d(12), searchTerms: ['aesthetics clinic', 'lip filler and anti-wrinkle injections', 'skin clinic'], foundFrom: 'listing', foundRadiusKm: 10, list, events,
    you,
    nearby: [
      { key: 'p:sample-lashbar', placeId: 'sample-lashbar', name: 'Lash Bar Crewe', address: `Victoria Street, ${town}`, instagram: 'https://www.instagram.com/lashbarcrewe/', rating: 4.9, count: 67, distanceKm: 0.7, primaryType: 'beauty_salon', relevance: 1 },
      { key: 'p:sample-serenity', placeId: 'sample-serenity', name: 'Serenity Spa Wychwood', address: 'Wychwood Park, Weston', url: 'https://example.com/serenity', rating: 4.5, count: 311, distanceKm: 5.8, primaryType: 'spa', relevance: 1 },
    ],
    dismissed: [{ key: 'p:sample-nails', name: `${town} Nails & Beauty`, at: d(11) }],
    placesCalls: { month: iso(now).slice(0, 7), n: 14 },
    comparison,
    advice: { at: d(0), lines: adviseReach(list, adviceYou, events, new Date(now), comparison) },
  };
}

/* ---------- The Scout, consumer mode ---------- */
export function demandResults(town: string, what: string): ScoutResult[] {
  const items = [
    { name: `Anyone recommend somewhere for ${what} near ${town}? Want natural, not overdone.`, platform: `Reddit r/${town.replace(/\s/g, '')}`, location: town, when: '6 days ago', fit: 'strong', reason: 'Asking for exactly what you do, within a mile of your clinic, and the only two replies so far point to Chester. Nobody from Crewe has answered.', next: 'Reply on the thread today, as yourself, before it drops off the front page.', draft: `Hi, I run Willow Aesthetics on Nantwich Road, so I’m biased, but happy to help either way. For a natural result, ask whoever you see whether they are a prescriber, how long the appointment is and whether a review is included. I do 45-minute appointments and a free two-week check. If it’s useful, my price list is public on Fresha.`, url: 'https://www.reddit.com/r/Crewe/' },
    { name: 'Botox prices in Cheshire, what are people paying?', platform: 'Mumsnet, Talk', location: 'Cheshire', when: '2 weeks ago', fit: 'strong', reason: 'Twelve replies comparing prices between £150 and £260 for two areas; nobody has mentioned a nurse-led clinic in the Crewe area.', next: 'Reply with your two-area price and what it includes; say you run the clinic.', draft: `I run a nurse-led clinic in Crewe, so declaring that first. Locally two areas tends to be £180 to £220; mine is £195 and includes a free review at two weeks, which is worth asking about anywhere you go because a top-up can otherwise cost extra. Happy to answer questions here.`, url: 'https://www.mumsnet.com/talk' },
    { name: 'Lip filler gone wrong elsewhere, who do you trust locally for dissolving?', platform: 'Nextdoor, public page', location: `${town} and Nantwich`, when: '3 weeks ago', fit: 'possible', reason: 'A dissolving question with no good answer yet; you list dissolving at £120 and a free consultation.', next: 'Reply with a calm note about what dissolving involves and offer a free consultation.', draft: `Sorry you’ve had a bad experience. I’m a nurse prescriber at Willow Aesthetics in Crewe. Dissolving is straightforward when done carefully, usually one or two sessions, and I’d always start with a free consultation to look properly before suggesting anything. No pressure either way.`, url: 'https://nextdoor.co.uk/' },
    { name: `Wedding in May, when should I start skin treatments? (${town} area)`, platform: 'Hitched forum', location: town, when: '1 month ago', fit: 'possible', reason: 'A bride planning six months ahead, asking what to book and when; your Profhilo and skin booster courses fit the timeline exactly.', next: 'Reply with a simple timeline, no prices unless asked.', draft: `Congratulations! For May, most people start skin treatments in January so everything has settled: a Profhilo course is two sessions four weeks apart, and anything injectable is best finished a month before the day. I run a clinic in Crewe if you want a free chat about a plan.`, url: 'https://www.hitched.co.uk/' },
  ];
  return items.map((x) => ({ id: uid('r_'), name: x.name, location: x.location, website: '', fit: x.fit as 'strong' | 'possible', reason: x.reason, platform: x.platform, when: x.when, next: x.next, draft: x.draft, source: { title: `${x.platform} (sample)`, url: x.url }, saved: false }));
}

export function communityResults(town: string): ScoutResult[] {
  const items = [
    { name: `${town} Mums`, platform: 'Facebook group', location: town, fit: 'strong', reason: 'A local parents’ group with a weekly “recommend a business” thread; its public page says it is for parents in and around the town.', next: 'Join, read the pinned rules (businesses may post on Thursdays), then post the introduction below on the first Thursday.', draft: `Hello, I’m Hannah, a nurse prescriber, and I run Willow Aesthetics on Nantwich Road. I know aesthetics can feel daunting, so if anyone has a question about anti-wrinkle injections, filler or skin treatments, ask away here or message me and I’ll give you a straight answer, no pressure to book. Thanks for having me in the group.`, url: 'https://www.facebook.com/groups/' },
    { name: `${town} & Nantwich Women in Business`, platform: 'Networking group', location: `${town} and Nantwich`, fit: 'strong', reason: 'Monthly breakfast for women who run local businesses; many are also your ideal customer and all of them refer.', next: 'Book the next breakfast as a guest (£12) and introduce yourself in person; post the introduction in their members’ page afterwards.', draft: `Lovely to meet everyone this morning. I’m Hannah from Willow Aesthetics in Crewe: a nurse-led clinic for anti-wrinkle injections, filler and skin treatments, with unhurried appointments and a free review. If I can ever help with a question, I’m happy to.`, url: 'https://www.meetup.com/' },
    { name: 'Nantwich Community Forum', platform: 'Local forum', location: 'Nantwich', fit: 'possible', reason: 'A busy public forum where “where do you go for…” threads come up most weeks.', next: 'Register, then answer questions as they come up rather than posting an advert.', draft: `Hi all, I’m Hannah, a nurse prescriber running a small aesthetics clinic over in Crewe. I’ll mostly be reading, but if anyone has questions about treatments or what to look for in a practitioner, I’m glad to help.`, url: 'https://example.com/forum' },
  ];
  return items.map((x) => ({ id: uid('r_'), name: x.name, location: x.location, website: x.url, fit: x.fit as 'strong' | 'possible', reason: x.reason, platform: x.platform, next: x.next, draft: x.draft, source: { title: `${x.platform} (sample)`, url: x.url }, saved: false }));
}

export function partnerResults(town: string): ScoutResult[] {
  const items = [
    { name: 'Blush Bridal Boutique', location: 'Nantwich', fit: 'strong', reason: 'Independent bridal shop whose site lists a “little black book” of recommended suppliers; no aesthetics clinic on it yet.', next: 'Email the owner with the introduction and offer a bride’s skin-plan consultation for their customers.' },
    { name: 'The Hair Loft', location: town, fit: 'strong', reason: 'Busy salon with 8 stylists; their services page has no injectables or skin treatments, so you don’t compete.', next: 'Offer a referral card for their clients and a staff treatment at cost in return.' },
    { name: 'Crewe Lifestyle Centre', location: town, fit: 'possible', reason: 'Gym and spa with a members’ offers page that lists local partners.', next: 'Ask to be listed as a member partner with a first-visit consultation.' },
    { name: 'Lyla Rose Photography', location: 'Sandbach', fit: 'possible', reason: 'Wedding and portrait photographer who publishes a pre-shoot preparation guide; skin prep is mentioned but no clinic is named.', next: 'Offer to write a short skin-prep section for their guide, with your clinic credited.' },
  ];
  return items.map((x) => ({ id: uid('r_'), name: x.name, location: x.location, website: 'https://example.com', fit: x.fit as 'strong' | 'possible', reason: x.reason, next: x.next, source: { title: `${x.name} – website (sample)`, url: 'https://example.com' }, saved: false }));
}

export function corporateResults(town: string): ScoutResult[] {
  const items = [
    { name: 'Cheshire Rail Engineering (1,200 staff)', location: town, fit: 'possible', reason: 'The careers page describes a staff wellbeing programme with partner discounts; local clinics are not listed.', next: 'Write to the HR wellbeing team (by role, not name) proposing a staff discount day.' },
    { name: 'Wychwood Hall Hotel & Spa', location: 'Weston', fit: 'strong', reason: 'The spa page says it works with visiting practitioners for events and bridal parties.', next: 'Propose a quarterly “skin clinic day” for spa guests and bridal bookings.' },
    { name: 'Hospital trust staff wellbeing hub', location: town, fit: 'possible', reason: 'A public staff-benefits page with local discounts for NHS staff.', next: 'Offer an NHS staff rate through the hub.' },
  ];
  return items.map((x) => ({ id: uid('r_'), name: x.name, location: x.location, website: 'https://example.com', fit: x.fit as 'strong' | 'possible', reason: x.reason, next: x.next, source: { title: `${x.name} – wellbeing page (sample)`, url: 'https://example.com' }, saved: false }));
}

export function localResults(town: string): ScoutResult[] {
  const items = [
    { name: 'Cheshire Wedding Fair, Wychwood Hall', when: 'Sunday 25 January', how: 'Exhibitor stands from £180; book through the organiser’s page.', reason: 'Brides planning for summer book skin treatments in January, which is exactly your quiet month.' },
    { name: `${town} Christmas Market`, when: 'First weekend in December', how: 'Stall applications are open on the council page; pitches from £40.', reason: 'Footfall from your own town; gift vouchers for skin treatments sell well before Christmas.' },
    { name: 'Cheshire Beauty & Wellness Awards', when: 'Entries close end of January', how: 'Free to enter online. Finalists get regional press and a badge for Instagram.', reason: 'Credibility for a one-person clinic competing with bigger teams.' },
    { name: 'Nantwich Women’s Wellness Day', when: 'Saturday 7 March', how: 'Exhibitor tables £60 through the organiser; talks slots available.', reason: 'A room full of your ideal customer, three weeks before your target date.' },
    { name: `${town} Business Network breakfast`, when: 'Every second Wednesday, 7.30am', how: 'First visit free; book through their events page.', reason: 'Local owners who refer, and who buy treatments themselves.' },
  ];
  return items.map((x, i) => ({ id: uid('r_'), name: x.name, location: town, website: 'https://example.com', fit: i < 3 ? 'strong' : 'possible', reason: x.reason, when: x.when, how: x.how, source: { title: `${x.name} (sample)`, url: 'https://example.com' }, saved: false }));
}

/* ---------- Your clients (demo) ---------- */
import type { Client, Visit } from '../../shared/clients';
import type { ClientAction, Outcome } from '../../shared/money';
import { treatmentIdFor } from '../../shared/clients';

/**
 * A nurse-led clinic's regulars: anti-wrinkle clients on a 13-week cycle, a few lip and Profhilo
 * clients, some due now, some overdue, one who opted out, one lapsed and one who moved away.
 * With two bookings confirmed this month from rebook texts and one likely one waiting.
 */
export function sampleClients(now: number): { clients: Client[]; visits: Visit[]; actions: ClientAction[]; outcomes: Outcome[] } {
  const day = (n: number) => iso(now - n * DAY).slice(0, 10);
  const weeks = (n: number) => day(Math.round(n * 7));
  const clients: Client[] = []; const visits: Visit[] = [];
  let n = 0;
  const add = (name: string, phone: string, email: string, consent: Client['consent'], history: [number, string, number | null][], extra: Partial<Client> = {}) => {
    const id = `cl_${++n}`;
    clients.push({ id, name, phone, email, consent, consentAt: consent === 'opted_in' || consent === 'opted_out' ? iso(now - 120 * DAY) : null, consentSource: consent === 'opted_out' ? 'stop' : 'import', source: 'import', importedFrom: 'Fresha', createdAt: iso(now - 60 * DAY), ...extra });
    for (const [w, treatment, amount] of history) visits.push({ id: `v_${id}_${w}`, clientId: id, at: weeks(w), treatment, treatmentId: treatmentIdFor(treatment), amount, practitioner: 'Hannah', createdAt: iso(now - 60 * DAY) });
    return id;
  };
  // Due this week / overdue (anti-wrinkle on 13 weeks)
  add('Sarah Mitchell', '+447700900101', 'sarah.m@example.com', 'soft_opt_in', [[40, 'Anti-wrinkle injections – 2 areas', 185], [27, 'Anti-wrinkle injections – 2 areas', 195], [14, 'Anti-wrinkle injections – 2 areas', 195]]);
  add('Gemma Taylor', '+447700900102', '', 'opted_in', [[35, 'Lip filler 0.5ml', 170], [16, 'Anti-wrinkle injections – 3 areas', 240]]);
  add('Rachel Price', '+447700900103', 'rachel.p@example.com', 'soft_opt_in', [[52, 'Profhilo (2 sessions)', 390], [30, 'Profhilo (2 sessions)', 390]]);
  add('Claire Morgan', '+447700900104', '', 'soft_opt_in', [[28, 'Anti-wrinkle injections – 1 area', 150], [13.5, 'Anti-wrinkle injections – 1 area', 150]]);
  add('Nicola Shaw', '+447700900105', 'nicola@example.com', 'soft_opt_in', [[62, 'Lip filler 1ml', 220], [41, 'Lip filler 1ml', 220]]);
  // Upcoming
  add('Emma Hughes', '+447700900106', 'emma.h@example.com', 'opted_in', [[22, 'Anti-wrinkle injections – 2 areas', 195], [8, 'Anti-wrinkle injections – 2 areas', 195]]);
  add('Laura Bennett', '+447700900107', '', 'soft_opt_in', [[10, 'Microneedling', 120], [4, 'Microneedling', 120]]);
  add('Becky Owen', '+447700900108', 'becky@example.com', 'soft_opt_in', [[3, 'Dermaplaning', 45], [0.4, 'Dermaplaning', 45]]);
  add('Amy Jones', '+447700900109', '', 'soft_opt_in', [[6, 'Seventy Hyal skin booster', 180], [1, 'Seventy Hyal skin booster', 180]]);
  // Recently seen, good candidates for a review request
  add('Kate Roberts', '+447700900110', 'kate.r@example.com', 'opted_in', [[20, 'Anti-wrinkle injections – 2 areas', 195], [0.6, 'Anti-wrinkle injections – 2 areas', 195]]);
  add('Lucy Edwards', '+447700900111', '', 'soft_opt_in', [[1.1, 'Lip filler 0.5ml', 170]]);
  // Opted out, lapsed, moved away
  add('Jo Walker', '+447700900112', 'jo.w@example.com', 'opted_out', [[30, 'Anti-wrinkle injections – 2 areas', 195], [15, 'Anti-wrinkle injections – 2 areas', 195]]);
  add('Hannah Lewis', '', 'hannah.l@example.com', 'soft_opt_in', [[58, 'HydraFacial', 95], [50, 'HydraFacial', 95]], { phoneRaw: '01270 555123' });
  add('Sophie Lawson', '+447700900114', '', 'soft_opt_in', [[45, 'Anti-wrinkle injections – 2 areas', 195]], { notComingBack: true, notes: 'Moved to Manchester, March 2026.' });
  // Comes every 10 weeks by her own choice
  add('Priya Patel', '+447700900115', 'priya@example.com', 'opted_in', [[30, 'Anti-wrinkle injections – 2 areas', 195], [20, 'Anti-wrinkle injections – 2 areas', 195], [10.5, 'Anti-wrinkle injections – 2 areas', 195]], { intervalWeeks: 10 });

  // Messages sent earlier this month and the bookings they led to.
  const sent = (id: string, clientId: string, kind: ClientAction['kind'], daysAgo: number, treatmentId: string | null, amountHint: number | null, text: string): ClientAction => ({ id, clientId, kind, channel: 'sms_phone', text, sentAt: iso(now - daysAgo * DAY), treatmentId, amountHint });
  const actions: ClientAction[] = [
    sent('act_1', 'cl_10', 'rebook', 12, 'aw-2', 195, 'Hi Kate, it’s Hannah at Willow Aesthetics. It’s been about 3 months since your anti-wrinkle top-up, so you’re due about now. Book here: https://www.fresha.com/a/willow-aesthetics-crewe-sample Reply STOP to opt out.'),
    sent('act_2', 'cl_11', 'rebook', 15, 'lip-0.5', 170, 'Hi Lucy, it’s Hannah at Willow Aesthetics. It’s been about 7 months since your lip filler, so you’re due about now. Book here: https://www.fresha.com/a/willow-aesthetics-crewe-sample Reply STOP to opt out.'),
    sent('act_3', 'cl_9', 'rebook', 9, 'skin-booster-1', 180, 'Hi Amy, it’s Hannah at Willow Aesthetics. It’s been about a month since your skin booster, so you’re due about now. Book here: https://www.fresha.com/a/willow-aesthetics-crewe-sample Reply STOP to opt out.'),
    sent('act_4', 'cl_12', 'review_request', 20, 'aw-2', null, 'Hi Jo, it’s Hannah at Willow Aesthetics. Thank you for coming in for your anti-wrinkle top-up. If you were happy, would you leave us a Google review? https://search.google.com/local/writereview?placeid=sample-place Reply STOP to opt out.'),
  ];
  const outcomes: Outcome[] = [
    { id: 'out_1', actionId: 'act_1', clientId: 'cl_10', visitId: 'v_cl_10_0.6', amount: 195, status: 'confirmed', at: iso(now - 4 * DAY), title: 'Kate Roberts rebooked anti-wrinkle injections, 2 areas', createdAt: iso(now - 4 * DAY) },
    { id: 'out_2', actionId: 'act_2', clientId: 'cl_11', visitId: 'v_cl_11_1.1', amount: 170, status: 'confirmed', at: iso(now - 8 * DAY), title: 'Lucy Edwards rebooked lip filler, 0.5ml', createdAt: iso(now - 8 * DAY) },
    { id: 'out_3', actionId: 'act_3', clientId: 'cl_9', visitId: 'v_cl_9_1', amount: 180, status: 'likely', at: iso(now - 7 * DAY), title: 'Seventy Hyal skin booster after a rebook text', createdAt: iso(now - 7 * DAY) },
  ];
  // Jo replied STOP to the review request: recorded as an opt-out.
  const jo = clients.find((c) => c.id === 'cl_12')!; jo.consentAt = iso(now - 19 * DAY); jo.lastReviewAskAt = iso(now - 20 * DAY);
  return { clients, visits, actions, outcomes };
}
