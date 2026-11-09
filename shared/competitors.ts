// Competitor reach: who the client is up against, what those businesses publicly offer and
// charge, how their Google reviews move, and what changed. Pure logic, shared by the server,
// the demo and the tests. Nothing here talks to the network.
//
// Honesty rules baked in:
// - A service, price or offer is only kept if it appears verbatim on the page (or in the
//   Instagram caption) it is said to come from. Anything the AI paraphrased or invented is dropped.
// - Review counts come from Google listings; "new reviews" is a sign of how busy a business
//   looks, never a count of their bookings or sales.

import type { ReviewPoint } from './reviews';
import { extractPrices } from './pages';
import { priceValue } from './prices';
import { socialUrl } from './social';
import type { VenueStats } from './booking';
import type { Comparison } from './treatments';

const DAY = 86_400_000;

/* ---------- Types ---------- */
export type CompetitorSource = 'typed' | 'found';

export interface ServiceLine {
  name: string; price: string; url: string; seenAt: string;
  /** Where the line came from: the page text via the AI (default), a structured booking page, schema.org data, or the owner's own list. */
  via?: 'page' | 'fresha' | 'schema' | 'owner';
  duration?: string;
}
export interface OfferLine { text: string; url: string; seenAt: string; from: 'website' | 'instagram' }

export interface InstaPost { id: string; caption: string; at: string; likes: number | null; comments: number | null; url: string; type?: string }

/** What Instagram's Business Discovery endpoint tells us about a public professional account. */
export interface InstagramSnapshot {
  handle: string;
  url: string;
  checkedAt: string;
  followers: number | null;
  mediaCount: number | null;
  followersHistory: { at: string; n: number }[];
  postsLast30: number | null;
  posts: InstaPost[];
  /** Offers, prices and services found in captions; each checked verbatim against its caption. */
  findings: OfferLine[];
  /** Set when the account can't be read: personal/private accounts, or Instagram didn't answer. */
  error?: 'not-business' | 'unavailable' | null;
}

export interface TrackedCompetitor {
  key: string;
  name: string;
  source: CompetitorSource;
  url: string;                 // website, '' when none is known
  placeId?: string;
  address?: string;
  mapsUrl?: string;
  distanceKm?: number | null;
  rating: number | null;
  count: number | null;
  history: ReviewPoint[];
  ratingCheckedAt?: string;
  placeLookupAt?: string;      // when we last tried to match a typed competitor to a Google listing
  instagram?: string;          // clean page link
  facebook?: string;
  instagramSetBy?: 'owner' | 'website' | 'listing';
  /** Google's main type for the listing (beauty_salon, skin_care_clinic...). */
  primaryType?: string;
  /** How comparable the business looks: 2 = matched the search terms or core type, 1 = name suggests it, 0 = unsure. */
  relevance?: number;
  services: ServiceLine[];
  offers: OfferLine[];
  bookingPages: string[];
  pagesRead?: string[];
  sourceHashes?: Record<string, string>;
  sourcesCheckedAt?: string;
  social?: InstagramSnapshot | null;
  /** The public booking page (Fresha etc.) as a size signal: rating, reviews, team, number of treatments. */
  venue?: VenueStats | null;
  /** Booking pages that only render with JavaScript, so their prices could not be read. */
  unreadable?: string[];
  firstSeenAt: string;
}

export interface NearbyPlace { key: string; placeId: string; name: string; address: string; url?: string; instagram?: string; facebook?: string; booking?: string[]; rating: number | null; count: number | null; distanceKm: number | null; primaryType?: string; relevance?: number }

export type ReachKind = 'reviews' | 'service' | 'price' | 'offer' | 'post' | 'new-nearby' | 'followers';
export interface ReachEvent { id: string; at: string; key: string; competitor: string; kind: ReachKind; summary: string; detail?: string; url?: string }

export interface ReachAdvice { key?: string; text: string; action: string }

export interface CompetitorsState {
  checkedAt: string;
  foundAt?: string | null;
  searchTerms?: string[];
  /** The client's own side of the comparison: where they are, their own public services and their Instagram. */
  you?: {
    lat?: number; lng?: number;
    /** How the coordinates were worked out: the Google listing, the postcode, or the town centre. */
    locSource?: 'listing' | 'postcode' | 'town' | 'google-town';
    instagram?: InstagramSnapshot | null; services?: ServiceLine[]; offers?: OfferLine[]; sourceHashes?: Record<string, string>; sourcesCheckedAt?: string;
    venue?: VenueStats | null;
    unreadable?: string[];
  };
  /** How far the last nearby search reached (km) and what it was centred on, so the owner can see it and the app knows when to search again. */
  foundRadiusKm?: number | null;
  foundFrom?: 'listing' | 'postcode' | 'town' | 'google-town' | 'none';
  list: TrackedCompetitor[];
  nearby: NearbyPlace[];
  dismissed: { key: string; name: string; placeId?: string; at: string }[];
  events: ReachEvent[];
  placesCalls?: { month: string; n: number };
  advice?: { at: string; lines: ReachAdvice[] };
  /** The like-for-like price table (shared/treatments.ts) and the AI-resolved names it used. */
  comparison?: Comparison | null;
  treatmentMap?: Record<string, string | null>;
}

export const MAX_FOUND = 5;
export const MAX_TRACKED = 9;

export const emptyCompetitors = (at = new Date()): CompetitorsState => ({ checkedAt: at.toISOString(), list: [], nearby: [], dismissed: [], events: [] });

/* ---------- Keys and matching ---------- */
export const slug = (s: string) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const hostOf = (u?: string | null): string => { try { return new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
export const competitorKey = (c: { name: string; placeId?: string | null; url?: string | null }) => (c.placeId ? `p:${c.placeId}` : hostOf(c.url) ? `h:${hostOf(c.url)}` : `n:${slug(c.name)}`);

const nameWords = (s: string) => new Set(s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'ltd', 'limited', 'clinic', 'salon', 'studio', 'shop', 'co', 'uk'].includes(w)));

/** True when two business names or websites clearly mean the same business. */
export function sameBusiness(a: { name: string; url?: string; placeId?: string }, b: { name: string; url?: string; placeId?: string }): boolean {
  if (a.placeId && b.placeId) return a.placeId === b.placeId;
  const ha = hostOf(a.url); const hb = hostOf(b.url);
  if (ha && hb) return ha === hb;
  const wa = nameWords(a.name); const wb = nameWords(b.name);
  if (!wa.size || !wb.size) return slug(a.name) === slug(b.name);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.max(wa.size, wb.size) >= 0.6;
}

/* ---------- Geography ---------- */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371; const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export const distanceLabel = (km: number | null | undefined) => km == null ? '' : km < 1 ? `${Math.max(1, Math.round(km * 10)) * 100} m away` : `${km.toFixed(km < 10 ? 1 : 0)} km away`;

/* ---------- What to search Google for ---------- */
const TERMS: [RegExp, string][] = [
  [/aesthetic|botox|anti-?wrinkle|filler|skin clinic|dermal|laser|injectables?/i, 'aesthetics clinic'],
  [/\bbarber/i, 'barber'],
  [/\bnails?\b|manicure/i, 'nail salon'],
  [/\blash|brow/i, 'lash and brow studio'],
  [/\bhair(dress|\b)|salon|colourist|stylist/i, 'hair salon'],
  [/massage|spa\b|facial|waxing|beauty/i, 'beauty salon'],
  [/tattoo/i, 'tattoo studio'],
  [/physio/i, 'physiotherapist'],
  [/osteopath|chiropract/i, 'osteopath'],
  [/dentist|dental/i, 'dentist'],
  [/\bgym\b|personal train|pilates|yoga|fitness/i, 'gym'],
  [/\bvet\b|veterinar/i, 'vet'],
  [/\bdog groom|pet groom/i, 'dog groomer'],
  [/florist|flowers/i, 'florist'],
  [/bakery|bakes|cakes/i, 'bakery'],
  [/caf[eé]\b|coffee/i, 'café'],
  [/restaurant|bistro|dining/i, 'restaurant'],
  [/\bpub\b|bar\b/i, 'pub'],
  [/plumb/i, 'plumber'], [/electrician/i, 'electrician'], [/roof/i, 'roofer'], [/builder|building work|extension/i, 'builder'], [/garden|landscap/i, 'gardener'], [/clean(ing|er)/i, 'cleaning service'], [/decorat|paint/i, 'painter and decorator'],
  [/accountan|bookkeep/i, 'accountant'], [/solicitor|legal/i, 'solicitor'], [/estate agent|lettings/i, 'estate agent'], [/photograph/i, 'photographer'], [/wedding/i, 'wedding venue'],
  [/homeware|gift|ceramic|candle|interiors?/i, 'homeware and gift shop'], [/jewell/i, 'jewellery shop'], [/clothing|boutique|fashion/i, 'clothes boutique'], [/book\s?shop/i, 'bookshop'], [/bike|cycle/i, 'bike shop'],
];
const BY_INDUSTRY: Record<string, string> = {
  'Retail and e-commerce': 'independent shop', 'Food and drink': 'café', 'Hair, beauty and wellbeing': 'beauty salon', 'Trades and home services': 'tradesman',
  'Professional services': 'business services', 'Health and fitness': 'gym', 'Hospitality and events': 'venue', 'Creative and design': 'design studio',
  'Education and training': 'training provider', 'Manufacturing and wholesale': 'wholesaler', 'Property': 'estate agent',
};

/** One or two Google search phrases that describe businesses like this one, from what it sells. */
export function searchTerms(profile: any): string[] {
  // What the owner says they do comes first; what they sell only when that gives nothing; then the industry.
  for (const text of [profile?.business?.oneLiner, [profile?.offer?.bestSeller, profile?.offer?.products].filter(Boolean).join(' ')]) {
    const out: string[] = [];
    for (const [re, term] of TERMS) if (text && re.test(text) && !out.includes(term)) { out.push(term); if (out.length === 2) break; }
    if (out.length) return out;
  }
  const fallback = BY_INDUSTRY[String(profile?.business?.industry || '')];
  return fallback ? [fallback] : [];
}

/* ---------- The search plan: Google place types and niche phrases for this kind of business ---------- */
/**
 * Google Places (New) types that businesses like this one list under, plus a sense of which names
 * clearly are or are not comparable. The nearby search by type finds the businesses with no
 * website that a phrase search misses (a lash tech listed as beauty_salon, say); the phrase
 * searches find the niche ones (an aesthetics clinic listed as a spa).
 */
export interface SearchPlan { terms: string[]; types: string[]; core: RegExp; skip?: RegExp }
const PLANS: [RegExp, SearchPlan][] = [
  [/aesthetic|botox|anti-?wrinkle|filler|skin clinic|dermal|laser|injectables?|profhilo|polynucleotide|skin booster|microneedl|hifu|fat dissolv/i,
    { terms: ['aesthetics clinic', 'lip filler and anti-wrinkle injections', 'skin clinic'], types: ['beauty_salon', 'skin_care_clinic', 'spa'], core: /aesthetic|skin|clinic|botox|filler|laser|derm|face|facial|cosmetic|beauty|medi ?spa|injectab|glow|lash|brow|wellness|rejuven|anti.?wrinkle|contour/i, skip: /barber|tattoo|dentist|dental|optician|pharmacy|\bvet\b|\bhair\b|\bnails?\b/i }],
  [/\bbarber/i, { terms: ['barber'], types: ['barber_shop'], core: /barber|gents|grooming|cuts/i, skip: /nail|lash|beauty|dog|pet/i }],
  [/\bnails?\b|manicure/i, { terms: ['nail salon'], types: ['nail_salon'], core: /nail|manicure|pedicure|beauty/i, skip: /barber|dog|pet/i }],
  [/\blash|brow/i, { terms: ['lash and brow studio'], types: ['beauty_salon'], core: /lash|brow|beauty|aesthetic/i, skip: /barber|dog|pet/i }],
  [/\bhair(dress|\b)|salon|colourist|stylist/i, { terms: ['hair salon'], types: ['hair_salon'], core: /hair|salon|stylist|colour|blow/i, skip: /barber|dog|pet|removal/i }],
  [/massage|spa\b|facial|waxing|beauty/i, { terms: ['beauty salon'], types: ['beauty_salon', 'spa', 'massage'], core: /beauty|spa|massage|facial|wax|skin|lash|brow|nail/i, skip: /barber|dog|pet/i }],
  [/tattoo/i, { terms: ['tattoo studio'], types: ['body_art_service'], core: /tattoo|ink|piercing/i }],
  [/physio/i, { terms: ['physiotherapist'], types: ['physiotherapist'], core: /physio|sports (injury|therapy)|rehab|osteo|chiro/i }],
  [/osteopath|chiropract/i, { terms: ['osteopath'], types: ['chiropractor', 'physiotherapist'], core: /osteo|chiro|physio|back/i }],
  [/dentist|dental/i, { terms: ['dentist'], types: ['dentist', 'dental_clinic'], core: /dent|smile|orthodont/i }],
  [/\bgym\b|personal train|pilates|yoga|fitness/i, { terms: ['gym'], types: ['gym', 'fitness_center', 'yoga_studio'], core: /gym|fitness|pilates|yoga|crossfit|studio|training/i }],
  [/\bvet\b|veterinar/i, { terms: ['vet'], types: ['veterinary_care'], core: /vet|animal|pet/i }],
  [/\bdog groom|pet groom/i, { terms: ['dog groomer'], types: ['pet_store'], core: /groom|dog|pet|pooch|paw/i }],
  [/florist|flowers/i, { terms: ['florist'], types: ['florist'], core: /flor|flower|bloom|petal/i }],
  [/bakery|bakes|cakes/i, { terms: ['bakery'], types: ['bakery'], core: /bak|cake|bread|patisserie/i }],
  [/caf[eé]\b|coffee/i, { terms: ['café'], types: ['cafe', 'coffee_shop'], core: /caf|coffee|tea ?room|espresso|roast/i }],
  [/restaurant|bistro|dining/i, { terms: ['restaurant'], types: ['restaurant'], core: /restaurant|bistro|kitchen|grill|dining|eatery|trattoria|tapas/i }],
  [/\bpub\b|bar\b/i, { terms: ['pub'], types: ['pub', 'bar'], core: /pub|bar|inn|arms|tavern|tap/i }],
  [/plumb/i, { terms: ['plumber'], types: ['plumber'], core: /plumb|heating|gas|boiler/i }], [/electrician/i, { terms: ['electrician'], types: ['electrician'], core: /electric/i }],
  [/roof/i, { terms: ['roofer'], types: ['roofing_contractor'], core: /roof/i }], [/builder|building work|extension/i, { terms: ['builder'], types: ['general_contractor'], core: /build|construct|extension|renovat/i }],
  [/garden|landscap/i, { terms: ['gardener'], types: [], core: /garden|landscap|lawn|tree/i }], [/clean(ing|er)/i, { terms: ['cleaning service'], types: [], core: /clean/i }], [/decorat|paint/i, { terms: ['painter and decorator'], types: ['painter'], core: /paint|decorat/i }],
  [/accountan|bookkeep/i, { terms: ['accountant'], types: ['accounting'], core: /account|bookkeep|tax/i }], [/solicitor|legal/i, { terms: ['solicitor'], types: ['lawyer'], core: /solicitor|law|legal/i }], [/estate agent|lettings/i, { terms: ['estate agent'], types: ['real_estate_agency'], core: /estate|letting|propert|homes/i }], [/photograph/i, { terms: ['photographer'], types: [], core: /photo|studio|portrait|wedding/i }], [/wedding/i, { terms: ['wedding venue'], types: ['wedding_venue'], core: /wedding|venue|hall|manor|barn/i }],
  [/homeware|gift|ceramic|candle|interiors?/i, { terms: ['homeware and gift shop'], types: ['gift_shop', 'home_goods_store'], core: /home|gift|interior|living|candle|ceramic|design/i }], [/jewell/i, { terms: ['jewellery shop'], types: ['jewelry_store'], core: /jewel|gold|silver|gem/i }], [/clothing|boutique|fashion/i, { terms: ['clothes boutique'], types: ['clothing_store'], core: /boutique|fashion|cloth|wear|apparel/i }], [/book\s?shop/i, { terms: ['bookshop'], types: ['book_store'], core: /book/i }], [/bike|cycle/i, { terms: ['bike shop'], types: ['bicycle_store'], core: /bike|cycle/i }],
];
const PLAN_BY_INDUSTRY: Record<string, SearchPlan> = {
  'Retail and e-commerce': { terms: ['independent shop'], types: ['store'], core: /shop|store|boutique/i },
  'Food and drink': { terms: ['café'], types: ['cafe', 'restaurant'], core: /caf|food|kitchen|deli|restaurant/i },
  'Hair, beauty and wellbeing': { terms: ['beauty salon'], types: ['beauty_salon', 'hair_salon', 'spa'], core: /beauty|hair|spa|salon|skin|aesthetic|lash|brow|nail/i },
  'Trades and home services': { terms: ['tradesman'], types: [], core: /./ },
  'Professional services': { terms: ['business services'], types: [], core: /./ },
  'Health and fitness': { terms: ['gym'], types: ['gym', 'fitness_center'], core: /gym|fitness|health|clinic/i },
  'Hospitality and events': { terms: ['venue'], types: ['wedding_venue', 'event_venue'], core: /venue|hall|hotel|events?/i },
  'Creative and design': { terms: ['design studio'], types: [], core: /design|studio|creative/i },
  'Education and training': { terms: ['training provider'], types: [], core: /train|school|academy|tutor/i },
  'Manufacturing and wholesale': { terms: ['wholesaler'], types: [], core: /wholesale|supplies|manufactur/i },
  'Property': { terms: ['estate agent'], types: ['real_estate_agency'], core: /estate|letting|propert/i },
};

/** The plan for this business: phrases to search Google for, place types to list nearby, and what names look comparable. */
export function searchPlan(profile: any): SearchPlan {
  for (const text of [profile?.business?.oneLiner, [profile?.offer?.bestSeller, profile?.offer?.products].filter(Boolean).join(' ')]) {
    const hits: SearchPlan[] = [];
    for (const [re, plan] of PLANS) if (text && re.test(text) && !hits.includes(plan)) { hits.push(plan); if (hits.length === 2) break; }
    if (hits.length) {
      return {
        terms: [...new Set(hits.flatMap((h) => h.terms))].slice(0, 4),
        types: [...new Set(hits.flatMap((h) => h.types))].slice(0, 6),
        core: new RegExp(hits.map((h) => h.core.source).join('|'), 'i'),
        skip: hits.length === 1 ? hits[0].skip : undefined,
      };
    }
  }
  return PLAN_BY_INDUSTRY[String(profile?.business?.industry || '')] ?? { terms: [], types: [], core: /./ };
}

/** Google's websiteUri is often not a website at all: an Instagram or Facebook page, or a Fresha/Booksy/Treatwell booking page. Sort it. */
export function classifyWebsiteUri(uri: string | null | undefined): { url?: string; instagram?: string; facebook?: string; booking?: string } {
  const raw = String(uri || '').trim();
  if (!raw) return {};
  const ig = socialUrl('instagram', raw); if (ig) return { instagram: ig };
  const fb = socialUrl('facebook', raw); if (fb) return { facebook: fb };
  const h = hostOf(raw);
  if (h && BOOKING_HOSTS.some((b) => h === b || h.endsWith('.' + b))) return { booking: raw.replace(/#.*$/, '') };
  if (/linktr\.ee|linkin\.bio|beacons\.ai|bio\.site|taplink/i.test(h)) return {}; // a link page tells us nothing on its own
  return { url: raw };
}

/**
 * How comparable a found business looks: 2 when it came from a phrase search or lists under a core
 * type with a fitting name, 1 when only the name suggests it, 0 when the name says it is something
 * else (a barber in an aesthetics search). Zero means "do not watch automatically".
 */
export function relevanceOf(p: { name: string; primaryType?: string | null; fromTerm?: boolean }, plan: SearchPlan): number {
  const name = p.name || '';
  if (plan.skip && plan.skip.test(name) && !plan.core.test(name.replace(plan.skip, ''))) return 0;
  if (p.fromTerm) return 2;
  const typed = p.primaryType ? plan.types.includes(p.primaryType) : false;
  if (typed && plan.core.test(name)) return 2;
  if (typed || plan.core.test(name)) return 1;
  return 0;
}

/** Only businesses within the radius, with a known distance; the ones with none are never called "nearby". */
export function withinRadius<T extends { distanceKm: number | null }>(list: T[], km: number): T[] {
  return list.filter((f) => f.distanceKm != null && f.distanceKm <= km);
}

/* ---------- Review velocity: a sign of how busy a business looks ---------- */
/** New Google reviews in the last `days`, from the sampled history. Null until there is a sample old enough. */
export function reviewsSince(history: ReviewPoint[] | null | undefined, days: number, now = new Date()): number | null {
  const list = (history ?? []).filter((h) => h.count != null).sort((a, b) => a.at.localeCompare(b.at));
  if (list.length < 2) return null;
  const cutoff = now.getTime() - days * DAY;
  let base: ReviewPoint | null = null;
  for (const h of list) if (new Date(h.at).getTime() <= cutoff) base = h;
  if (!base) {
    // Not watching for that long yet: use the oldest sample if it is at least a week old.
    if (now.getTime() - new Date(list[0].at).getTime() < 6 * DAY) return null;
    base = list[0];
  }
  return Math.max(0, (list[list.length - 1].count ?? 0) - (base.count ?? 0));
}

/** Adds a rating sample, keeping one per day and the last 120. */
export function addSample(history: ReviewPoint[] | undefined, rating: number | null, count: number | null, now = new Date()): ReviewPoint[] {
  const day = now.toISOString().slice(0, 10);
  const kept = (history ?? []).filter((h) => h.at.slice(0, 10) !== day);
  return [...kept, { at: now.toISOString(), rating, count }].slice(-120);
}

/* ---------- Booking platforms ---------- */
/** Public booking sites a business's website often links to. Pages are read, never submitted. */
export const BOOKING_HOSTS = ['fresha.com', 'treatwell.co.uk', 'treatwell.com', 'booksy.com', 'phorest.me', 'phorest.com', 'gettimely.com', 'bookedin.com', 'setmore.com', 'squareup.com', 'square.site', 'vagaro.com', 'ovatu.com', 'mindbodyonline.com', 'acuityscheduling.com', 'simplybook.it', 'simplybook.me', 'salonized.com', 'booking.timify.com', 'nailsbyme.com', 'bookwhen.com', 'resurva.com'];

const bookingHost = (h: string) => BOOKING_HOSTS.some((b) => h === b || h.endsWith('.' + b));
const BOOKING_SKIP = /\/(login|signin|sign-in|account|cart|checkout)\b/i;

/** Links from a page to public booking pages (Fresha, Treatwell, Booksy...), absolute, de-duplicated. */
export function bookingLinks(html: string, pageUrl: string, max = 3): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    const raw = (m[2] ?? m[3] ?? '').replace(/&amp;/g, '&').trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    try {
      const u = new URL(raw, pageUrl);
      if (!bookingHost(u.hostname.replace(/^www\./, '').toLowerCase()) || BOOKING_SKIP.test(u.pathname)) continue;
      u.hash = '';
      const s = u.toString();
      if (!out.includes(s)) out.push(s);
      if (out.length >= max) break;
    } catch { /* ignore */ }
  }
  return out;
}

export const bookingPlatform = (url: string): string => {
  const h = hostOf(url);
  const names: Record<string, string> = { 'fresha.com': 'Fresha', 'treatwell.co.uk': 'Treatwell', 'treatwell.com': 'Treatwell', 'booksy.com': 'Booksy', 'phorest.me': 'Phorest', 'phorest.com': 'Phorest', 'gettimely.com': 'Timely', 'setmore.com': 'Setmore', 'squareup.com': 'Square', 'square.site': 'Square', 'vagaro.com': 'Vagaro', 'ovatu.com': 'Ovatu', 'mindbodyonline.com': 'Mindbody', 'acuityscheduling.com': 'Acuity', 'simplybook.it': 'SimplyBook', 'simplybook.me': 'SimplyBook', 'salonized.com': 'Salonized', 'bookwhen.com': 'Bookwhen' };
  const hit = Object.keys(names).find((k) => h === k || h.endsWith('.' + k));
  return hit ? names[hit] : h;
};

/* ---------- Verbatim checks ---------- */
export const norm = (s: string) => String(s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const normUrl = (u: string) => String(u).replace(/#.*$/, '').replace(/\/+$/, '').replace(/^http:/, 'https:').replace('://www.', '://');

function sourceFor(url: string, sources: Record<string, string>): string | null {
  if (sources[url] !== undefined) return url;
  return Object.keys(sources).find((k) => normUrl(k) === normUrl(url)) ?? null;
}

/**
 * Keeps only services whose name appears verbatim on the page they are said to come from and
 * whose price is one of the prices printed on that page. Everything else is dropped.
 */
export function validateServices(raw: any, sources: Record<string, string>, seenAt: string, max = 40): ServiceLine[] {
  const out: ServiceLine[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.name !== 'string' || typeof r.price !== 'string' || typeof r.url !== 'string') continue;
    const key = sourceFor(r.url, sources);
    if (!key) continue;
    const text = norm(sources[key]);
    const name = r.name.replace(/\s+/g, ' ').trim().slice(0, 90);
    if (name.length < 2 || !text.includes(norm(name))) continue;
    const v = priceValue(r.price);
    if (v == null) continue;
    if (!extractPrices(sources[key]).map(priceValue).some((x) => x != null && Math.abs(x - v) < 0.005)) continue;
    const from = /\bfrom\b/i.test(r.price) ? 'from ' : '';
    const id = `${norm(name)}|${v}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, price: `${from}£${v % 1 ? v.toFixed(2) : v}`, url: key, seenAt });
    if (out.length >= max) break;
  }
  return out;
}

/** Keeps only offers whose wording appears verbatim on the page they are said to come from. */
export function validateOffers(raw: any, sources: Record<string, string>, seenAt: string, from: OfferLine['from'] = 'website', max = 10): OfferLine[] {
  const out: OfferLine[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.text !== 'string' || typeof r.url !== 'string') continue;
    const key = sourceFor(r.url, sources);
    if (!key) continue;
    const text = r.text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (text.length < 6 || !norm(sources[key]).includes(norm(text))) continue;
    if (out.some((o) => norm(o.text) === norm(text))) continue;
    out.push({ text, url: key, seenAt, from });
    if (out.length >= max) break;
  }
  return out;
}

/** Instagram captions: a finding must be quoted verbatim from the caption of the post it names. */
export function validateCaptionFindings(raw: any, posts: InstaPost[], seenAt: string, max = 12): OfferLine[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const sources: Record<string, string> = {};
  for (const p of posts) sources[p.url] = p.caption;
  const mapped = (Array.isArray(raw) ? raw : []).map((r: any) => {
    const p = r && (byId.get(String(r.postId)) ?? posts.find((x) => x.url === r.url));
    return p ? { text: r.text, url: p.url } : null;
  }).filter(Boolean);
  return validateOffers(mapped, sources, seenAt, 'instagram', max);
}

/* ---------- Instagram helpers ---------- */
export const instagramHandle = (input?: string | null): string => {
  const url = socialUrl('instagram', input);
  return url ? url.replace('https://www.instagram.com/', '').replace(/\/$/, '') : '';
};

export function postsInLast(posts: InstaPost[], days: number, now = new Date()): number {
  const cutoff = now.getTime() - days * DAY;
  return posts.filter((p) => p.at && new Date(p.at).getTime() >= cutoff).length;
}

/* ---------- Merging the watched list ---------- */
export interface FoundPlace {
  placeId: string; name: string; address: string;
  url?: string;                 // a real website; Instagram, Facebook and booking links are split out below
  instagram?: string; facebook?: string; booking?: string[];
  rating: number | null; count: number | null; distanceKm: number | null; mapsUrl: string;
  primaryType?: string; relevance?: number;
}

/**
 * The watched list: what the owner typed (resolved to a Google listing where one matched),
 * plus the closest found businesses up to MAX_FOUND, minus anything the owner said is not a competitor.
 * History, services and social data carry over from the previous list by key.
 */
export function mergeTracked(
  prev: TrackedCompetitor[] | undefined,
  typed: { name: string; url?: string; placeId?: string; address?: string; rating?: number | null; count?: number | null; mapsUrl?: string; distanceKm?: number | null; instagram?: string; facebook?: string; bookingPages?: string[] }[],
  found: FoundPlace[],
  dismissed: { key: string; name: string; placeId?: string }[],
  now = new Date(),
): { list: TrackedCompetitor[]; nearby: NearbyPlace[] } {
  const stamp = now.toISOString();
  const old = new Map((prev ?? []).map((c) => [c.key, c]));
  const carry = (key: string, base: Omit<TrackedCompetitor, 'history' | 'services' | 'offers' | 'bookingPages' | 'firstSeenAt' | 'key'> & { bookingPages?: string[] }): TrackedCompetitor => {
    const p = old.get(key) ?? [...old.values()].find((c) => sameBusiness(c, base));
    return {
      key, ...base,
      url: base.url || p?.url || '',
      placeId: base.placeId ?? p?.placeId, address: base.address ?? p?.address, mapsUrl: base.mapsUrl ?? p?.mapsUrl, distanceKm: base.distanceKm ?? p?.distanceKm ?? null,
      rating: base.rating ?? p?.rating ?? null, count: base.count ?? p?.count ?? null,
      history: p?.history ?? [], ratingCheckedAt: p?.ratingCheckedAt, placeLookupAt: p?.placeLookupAt,
      instagram: p?.instagramSetBy === 'owner' ? p.instagram : (base.instagram || p?.instagram), facebook: base.facebook || p?.facebook,
      instagramSetBy: p?.instagramSetBy === 'owner' ? 'owner' : base.instagram && !p?.instagram ? 'listing' : p?.instagramSetBy,
      primaryType: base.primaryType ?? p?.primaryType, relevance: base.relevance ?? p?.relevance,
      services: p?.services ?? [], offers: p?.offers ?? [], bookingPages: [...new Set([...(p?.bookingPages ?? []), ...(base.bookingPages ?? [])])], pagesRead: p?.pagesRead, sourceHashes: p?.sourceHashes, sourcesCheckedAt: p?.sourcesCheckedAt,
      social: p?.social ?? null, venue: p?.venue ?? null, unreadable: p?.unreadable, firstSeenAt: p?.firstSeenAt ?? stamp,
    };
  };
  const isDismissed = (c: { name: string; url?: string; placeId?: string }) => dismissed.some((d) => d.key === competitorKey(c) || sameBusiness(d, c));

  const list: TrackedCompetitor[] = [];
  for (const t of typed.filter((t) => t.name?.trim()).slice(0, 5)) {
    const key = competitorKey(t);
    if (list.some((c) => c.key === key)) continue;
    list.push(carry(key, { name: t.name.trim(), source: 'typed', url: t.url || '', placeId: t.placeId, address: t.address, mapsUrl: t.mapsUrl, distanceKm: t.distanceKm ?? null, rating: t.rating ?? null, count: t.count ?? null, instagram: t.instagram, facebook: t.facebook, bookingPages: t.bookingPages }));
  }
  const nearby: NearbyPlace[] = [];
  let foundCount = 0;
  // Comparable first (matched the search or a core type), then closest.
  const sorted = [...found].sort((a, b) => ((b.relevance ?? 1) - (a.relevance ?? 1)) || ((a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)));
  for (const f of sorted) {
    if (list.some((c) => sameBusiness(c, { name: f.name, url: f.url, placeId: f.placeId }))) {
      // The owner typed this one: attach the listing so it gets ratings and a map link.
      const c = list.find((x) => sameBusiness(x, { name: f.name, url: f.url, placeId: f.placeId }))!;
      c.placeId ??= f.placeId; c.address ??= f.address; c.mapsUrl ??= f.mapsUrl; c.distanceKm ??= f.distanceKm; c.url ||= f.url || '';
      if (f.instagram && c.instagramSetBy !== 'owner' && !c.instagram) { c.instagram = f.instagram; c.instagramSetBy = 'listing'; }
      c.facebook ||= f.facebook; c.primaryType ??= f.primaryType;
      if (f.booking?.length) c.bookingPages = [...new Set([...c.bookingPages, ...f.booking])];
      if (c.rating == null) { c.rating = f.rating; c.count = f.count; }
      continue;
    }
    if (isDismissed({ name: f.name, url: f.url, placeId: f.placeId })) continue;
    const key = competitorKey({ name: f.name, placeId: f.placeId, url: f.url });
    const watched = old.get(key)?.source === 'found';
    if (foundCount < MAX_FOUND || watched) {
      foundCount++;
      list.push(carry(key, { name: f.name, source: 'found', url: f.url || '', placeId: f.placeId, address: f.address, mapsUrl: f.mapsUrl, distanceKm: f.distanceKm, rating: f.rating, count: f.count, instagram: f.instagram, facebook: f.facebook, bookingPages: f.booking ?? [], primaryType: f.primaryType, relevance: f.relevance }));
    } else {
      nearby.push({ key, placeId: f.placeId, name: f.name, address: f.address, url: f.url, instagram: f.instagram, facebook: f.facebook, booking: f.booking, rating: f.rating, count: f.count, distanceKm: f.distanceKm, primaryType: f.primaryType, relevance: f.relevance });
    }
  }
  // Found businesses that were watched before but didn't come back this month stay watched.
  for (const p of (prev ?? [])) if (p.source === 'found' && !list.some((c) => c.key === p.key) && !isDismissed(p) && list.length < MAX_TRACKED) list.push({ ...p });
  return { list: list.slice(0, MAX_TRACKED), nearby: nearby.slice(0, 10) };
}

/* ---------- What changed ---------- */
const eid = (kind: string, key: string, at: string, extra = '') => `${kind}:${key}:${at.slice(0, 10)}${extra ? ':' + slug(extra).slice(0, 30) : ''}`;
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Events worth telling the owner about, from one competitor's previous and current state. */
export function diffCompetitor(prev: TrackedCompetitor | undefined, next: TrackedCompetitor, you: { reviews30: number | null }, now = new Date()): ReachEvent[] {
  const at = now.toISOString();
  const out: ReachEvent[] = [];
  if (!prev) return out; // first sight: nothing to compare yet
  const base = { at, key: next.key, competitor: next.name };

  // Services and prices (website and booking pages).
  const oldByName = new Map(prev.services.map((s) => [norm(s.name), s]));
  const added = next.services.filter((s) => !oldByName.has(norm(s.name)));
  if (prev.services.length && added.length) {
    out.push({ ...base, id: eid('service', next.key, at), kind: 'service', url: added[0].url, summary: `${next.name} now lists ${added.length === 1 ? `“${added[0].name}” at ${added[0].price}` : `${added.length} services it didn’t before, including “${added[0].name}” (${added[0].price})`}.` });
  }
  const moves = next.services.map((s) => ({ s, o: oldByName.get(norm(s.name)) })).filter((x) => x.o && priceValue(x.o.price) !== priceValue(x.s.price) && !/^from/.test(x.s.price) === !/^from/.test(x.o!.price));
  for (const m of moves.slice(0, 3)) out.push({ ...base, id: eid('price', next.key, at, m.s.name), kind: 'price', url: m.s.url, summary: `${next.name} changed the price of ${lower1(m.s.name)} from ${m.o!.price} to ${m.s.price}.` });

  const oldOffers = new Set(prev.offers.map((o) => norm(o.text)));
  for (const o of next.offers.filter((o) => !oldOffers.has(norm(o.text))).slice(0, 2)) out.push({ ...base, id: eid('offer', next.key, at, o.text), kind: 'offer', url: o.url, summary: `${next.name} is advertising “${o.text}”.` });

  // Review velocity: a surge against the client's own pace.
  const mine = you.reviews30;
  const theirs = reviewsSince(next.history, 30, now);
  const before = reviewsSince(prev.history, 30, new Date(now.getTime() - 7 * DAY));
  if (theirs != null && theirs >= 5 && (mine == null || theirs >= 2 * Math.max(1, mine)) && (before == null || theirs > before)) {
    const lastPrev = prev.history[prev.history.length - 1]?.count; const lastNext = next.history[next.history.length - 1]?.count;
    const sinceLast = lastPrev != null && lastNext != null ? lastNext - lastPrev : 0;
    if (sinceLast > 0 || before == null) {
      out.push({ ...base, id: eid('reviews', next.key, at), kind: 'reviews', url: next.mapsUrl, summary: `${next.name} got ${theirs} new Google reviews in the last 30 days${mine != null ? `; you got ${mine}` : ''}.`, detail: 'New reviews are a sign of how busy a business looks, not a count of their bookings.' });
    }
  }

  // Instagram: new captioned offers and follower jumps.
  if (next.social && !next.social.error) {
    const oldF = new Set((prev.social?.findings ?? []).map((f) => norm(f.text)));
    for (const f of next.social.findings.filter((f) => !oldF.has(norm(f.text))).slice(0, 2)) out.push({ ...base, id: eid('post', next.key, at, f.text), kind: 'post', url: f.url, summary: `${next.name} posted on Instagram: “${f.text}”.` });
    const fh = next.social.followersHistory;
    const weekAgo = fh.filter((h) => new Date(h.at).getTime() <= now.getTime() - 6 * DAY).pop();
    if (weekAgo && next.social.followers != null && weekAgo.n > 0) {
      const pct = Math.round(((next.social.followers - weekAgo.n) / weekAgo.n) * 100);
      if (pct >= 10 && next.social.followers - weekAgo.n >= 50) out.push({ ...base, id: eid('followers', next.key, at), kind: 'followers', url: next.social.url, summary: `${next.name}’s Instagram grew from ${weekAgo.n.toLocaleString('en-GB')} to ${next.social.followers.toLocaleString('en-GB')} followers in a week.` });
    }
  }
  return out;
}

/** Merges new events into the stored list: newest first, no duplicate ids, capped. */
export function mergeEvents(prev: ReachEvent[] | undefined, fresh: ReachEvent[], max = 80): { events: ReachEvent[]; added: ReachEvent[] } {
  const have = new Set((prev ?? []).map((e) => e.id));
  const added = fresh.filter((e) => !have.has(e.id));
  return { events: [...added, ...(prev ?? [])].slice(0, max), added };
}

/* ---------- Plain-words advice (rule-based; used in the demo and when the AI is unavailable) ---------- */
export interface YouForAdvice { rating: number | null; count: number | null; reviews30: number | null; services: ServiceLine[]; instagram?: InstagramSnapshot | null; venue?: VenueStats | null }

/** Comparable service: same normalised name, or one name contains the other. */
export function comparable(a: string, b: string): boolean {
  const x = norm(a).replace(/[^a-z0-9 ]/g, ''); const y = norm(b).replace(/[^a-z0-9 ]/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const wa = x.split(' ').filter((w) => w.length > 2); const wb = y.split(' ').filter((w) => w.length > 2);
  if (!wa.length || !wb.length) return false;
  const shared = wa.filter((w) => wb.includes(w)).length;
  return shared >= Math.min(wa.length, wb.length) && shared >= 1 && Math.abs(wa.length - wb.length) <= 1;
}

export function adviseReach(list: TrackedCompetitor[], you: YouForAdvice, events: ReachEvent[], now = new Date(), comparison?: Comparison | null): ReachAdvice[] {
  const out: ReachAdvice[] = [];
  const recent = events.filter((e) => now.getTime() - new Date(e.at).getTime() < 8 * DAY);
  const money = (v: number) => `£${Number.isInteger(v) ? v : v.toFixed(2)}`;

  const surge = recent.find((e) => e.kind === 'reviews');
  if (surge) out.push({ key: surge.key, text: `${surge.summary} That is a sign of how busy they look to people choosing on Google, not a count of their bookings.`, action: 'Ask your last ten happy customers for a Google review this week; a short text with your review link is enough.' });

  const offer = recent.find((e) => e.kind === 'offer' || e.kind === 'post');
  if (offer) out.push({ key: offer.key, text: `${offer.summary}`, action: 'Decide whether to answer it. Matching a discount is rarely the only option: a bundle, a loyalty perk or simply saying what you include works too.' });

  // Like-for-like prices: the biggest gap against the local average, and the most common treatment nearby that the owner does not list.
  if (comparison) {
    const gap = comparison.rows.filter((r) => r.yours && r.listedBy >= 2 && r.localAvg != null).map((r) => ({ r, diff: r.yours!.value - r.localAvg! })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    if (gap && Math.abs(gap.diff) >= Math.max(10, gap.r.localAvg! * 0.12)) {
      const r = gap.r;
      out.push({ text: `${r.label}: you charge ${r.yours!.price}; the ${r.listedBy} nearby businesses that list it average ${money(r.localAvg!)} (from ${money(r.localMin!)} to ${money(r.localMax!)}). You are ${r.position}.`, action: gap.diff > 0 ? 'Make sure the page where that price is shown says what it includes (time, product, aftercare, your qualifications); a higher price with a clear reason holds. If there is no reason, decide whether the gap is deliberate.' : 'You are the cheaper option for this. Check the price still covers your time and product before you leave it; the gap is room to add value rather than a reason to cut further.' });
    }
    const missing = comparison.theyOfferYouDont.find((t) => t.by.length >= 2);
    if (missing) out.push({ text: `${missing.by.length} businesses nearby price ${missing.label.charAt(0).toLowerCase() + missing.label.slice(1)} (${missing.by.slice(0, 3).map((b) => `${b.name} ${b.price}`).join(', ')}) and your list doesn’t show it.`, action: 'If you offer it, add it to your price list or booking page with a price; if you don’t, it is a sign of what people around you are being sold.' });
  }

  for (const c of list) {
    if (comparison) break; // the comparison above already covers prices like for like
    for (const s of c.services) {
      const mine = you.services.find((m) => comparable(m.name, s.name));
      if (!mine) continue;
      const a = priceValue(mine.price); const b = priceValue(s.price);
      if (a == null || b == null || a === b) continue;
      const diff = Math.round(Math.abs(a - b));
      if (diff < Math.max(5, a * 0.1)) continue;
      out.push({ key: c.key, text: `${c.name} charges ${s.price} for ${lower1(s.name)}; you charge ${mine.price} for ${lower1(mine.name)}, ${b < a ? `£${diff} more` : `£${diff} less`}.`, action: b < a ? 'If yours includes more (time, aftercare, products), say so where the price is shown; if not, decide whether the gap is deliberate.' : 'You are the cheaper option here. Check that your price still covers your time and products before you leave it.' });
      break;
    }
    if (out.length >= 4) break;
  }

  const newNearby = recent.find((e) => e.kind === 'new-nearby');
  if (newNearby) out.push({ key: newNearby.key, text: newNearby.summary, action: 'Look at what they offer and what they charge (it is listed under their name below) and note what you do that they don’t.' });

  if (!out.length) {
    const best = [...list].filter((c) => c.count != null).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
    if (best && you.count != null && (best.count ?? 0) > you.count) out.push({ key: best.key, text: `${best.name} has ${best.count} Google reviews to your ${you.count}. More reviews usually means more clicks from people comparing on Google.`, action: 'Build a habit of asking for a review after every good visit; the Watcher drafts your replies when they arrive.' });
    else if (list.length) out.push({ text: `Nothing new to act on this week. The Watcher reads ${list.length} competitor${list.length === 1 ? '' : 's'} every day and will tell you when something changes.`, action: 'Keep going as you are.' });
  }
  return out.slice(0, 4);
}

/** The newest tracked competitors the owner has not seen before (for "new business nearby" alerts). */
export function newlyFound(prev: TrackedCompetitor[] | undefined, next: TrackedCompetitor[], now = new Date()): ReachEvent[] {
  if (!prev) return [];
  const had = new Set(prev.map((c) => c.key));
  return next.filter((c) => c.source === 'found' && !had.has(c.key)).map((c) => ({
    id: eid('new-nearby', c.key, now.toISOString()), at: now.toISOString(), key: c.key, competitor: c.name, kind: 'new-nearby' as const, url: c.mapsUrl || c.url || undefined,
    summary: `New on Google near you: ${c.name}${c.distanceKm != null ? `, ${distanceLabel(c.distanceKm)}` : ''}${c.count != null ? ` (${c.count} review${c.count === 1 ? '' : 's'})` : ''}.`,
    detail: c.count != null && c.count < 10 ? 'A listing with few reviews is often a recent opening.' : undefined,
  }));
}
