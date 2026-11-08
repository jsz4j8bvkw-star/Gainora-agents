// The Watcher's longer reach: finds the competition around the client from Google, reads what
// every competitor (typed or found) publicly offers and charges on their website and the public
// booking pages it links to, follows their Google review counts, reads public Instagram
// professional accounts through Meta's Business Discovery, and turns it all into plain events
// and advice. Everything reported is on a public page or a Google listing, with the link and
// the date it was seen.
//
// Cost rules: Google Places calls are counted per client per month (PLACES_MONTHLY_CAP, default 90);
// the nearby search runs monthly (up to 8 calls: one Nearby Search by type and one to three phrase
// searches per radius rung); ratings weekly with the smallest field mask. Coordinates come from the
// listing or, free of charge, from postcodes.io. The AI runs on
// the fast model and only when a page's text actually changed (hashes are kept per URL).
import { ai, aiConfigured, extractJson, hasBanned, HOUSE_STYLE, profileContext } from './ai';
import { env } from './core';
import { googleConfigured, placeLocation, placeRating, searchNearby, searchPlaces } from './google';
import { geocodeClient } from './geo';
import { nextRadius, RADII_KM, type LatLng } from '../../shared/geo';
import { discover, metaConfigured, refreshTokenIfDue } from './meta';
import { fetchPage, okPage, pool, type Fetched } from './http';
import {
  addSample, adviseReach, classifyWebsiteUri, competitorKey, diffCompetitor, distanceKm as distanceKm_, emptyCompetitors, hostOf, instagramHandle, mergeEvents, mergeTracked, newlyFound, postsInLast,
  relevanceOf, reviewsSince, sameBusiness, searchPlan, validateCaptionFindings, validateOffers, validateServices, bookingLinks, withinRadius,
  type CompetitorsState, type FoundPlace, type InstagramSnapshot, type OfferLine, type ReachAdvice, type ReachEvent, type SearchPlan, type ServiceLine, type TrackedCompetitor,
} from '../../shared/competitors';
import { extractLinks, extractOffers, hashText, visibleText } from '../../shared/pages';
import { priceLines, pricePageCandidates } from '../../shared/prices';
import { mapsUrl, pickCompetitorPlace, type PlaceSummary, type ReviewPoint } from '../../shared/reviews';
import { socialUrl } from '../../shared/social';
import { findUnsupportedNumbers } from '../../shared/metrics';
import type { Learned } from '../../shared/learning';

const DAY = 86_400_000;
const WEEK = 6.5 * DAY;
const MONTH = 28 * DAY;
const town = (p: any) => String(p?.business?.location || '').split(',')[0].trim();
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/* ---------- Places budget ---------- */
class PlacesBudget {
  constructor(private state: CompetitorsState, private now: Date) {
    const m = monthKey(now);
    if (!state.placesCalls || state.placesCalls.month !== m) state.placesCalls = { month: m, n: 0 };
  }
  get cap() { return Number(env('PLACES_MONTHLY_CAP', '90')); }
  can(n = 1) { return googleConfigured() && this.state.placesCalls!.n + n <= this.cap; }
  spend(n = 1) { this.state.placesCalls!.n += n; }
}

/* ---------- Finding the competition around the client ---------- */
/**
 * Businesses like the client's within a tight radius, widened only when too few are found and
 * never beyond MAX_NEARBY_KM. One Nearby Search by type (finds the ones with no website) plus
 * phrase searches restricted to the same area (finds the niche ones). Every result carries its
 * distance; anything outside the radius, closed, or clearly a different trade is dropped.
 */
export async function findNearby(here: LatLng, plan: SearchPlan, budget: { can(n?: number): boolean; spend(n?: number): void }, isSelf: (p: { id: string; name: string; website?: string }) => boolean): Promise<{ found: FoundPlace[]; radiusKm: number; searched: boolean }> {
  const seen = new Map<string, FoundPlace>();
  let radius: number | null = null; let used = RADII_KM[0]; let calls = 0;
  const comparable = (km: number) => [...seen.values()].filter((f) => (f.relevance ?? 0) >= 1 && f.distanceKm != null && f.distanceKm <= km).length;
  const add = (res: PlaceSummary[], km: number, fromTerm: boolean) => {
    for (const p of res) {
      if (p.closed || isSelf(p)) continue;
      const distanceKm = p.lat != null && p.lng != null ? distanceKm_(here, { lat: p.lat, lng: p.lng }) : null;
      if (distanceKm == null || distanceKm > km) continue; // a rectangle's corners reach past the circle
      const links = classifyWebsiteUri(p.website);
      const relevance = relevanceOf({ name: p.name, primaryType: p.primaryType, fromTerm }, plan);
      const prev = seen.get(p.id);
      seen.set(p.id, {
        placeId: p.id, name: p.name, address: p.address, url: links.url ?? prev?.url, instagram: links.instagram ?? prev?.instagram, facebook: links.facebook ?? prev?.facebook,
        booking: links.booking ? [...new Set([...(prev?.booking ?? []), links.booking])] : prev?.booking,
        rating: p.rating, count: p.count, mapsUrl: mapsUrl(p.id), distanceKm, primaryType: p.primaryType ?? prev?.primaryType, relevance: Math.max(relevance, prev?.relevance ?? 0),
      });
    }
  };
  while ((radius = nextRadius(radius, comparable(used))) != null) {
    used = radius;
    const terms = radius === RADII_KM[0] ? plan.terms.slice(0, 3) : plan.terms.slice(0, 1);
    if (!budget.can((plan.types.length ? 1 : 0) + terms.length)) break;
    if (plan.types.length) {
      try { budget.spend(); calls++; add(await searchNearby(here, radius, plan.types, 20), radius, false); }
      catch (e: any) { console.error('[gainora] reach nearby', e?.message); }
    }
    for (const term of terms) {
      try { budget.spend(); calls++; add(await searchPlaces(term, { pageSize: 10, withWebsite: true, withLocation: true, withType: true, within: { center: here, radiusKm: radius } }), radius, true); }
      catch (e: any) { console.error('[gainora] reach find', e?.message); }
    }
  }
  const found = withinRadius([...seen.values()].filter((f) => (f.relevance ?? 0) >= 1), used).sort((a, b) => ((b.relevance ?? 0) - (a.relevance ?? 0)) || ((a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)));
  return { found, radiusKm: used, searched: calls > 0 };
}

/* ---------- Reading a business's public pages ---------- */
export interface PageLines { url: string; lines: string[]; booking?: boolean }
export interface SiteRead { home: Fetched | null; pages: PageLines[]; hashes: Record<string, string>; bookingPages: string[]; socialLinks: string[]; htmls: string[] }

const SOCIAL_HREF = /href\s*=\s*["']([^"']*(?:instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me)[^"']*)["']/gi;
export function socialLinksIn(htmls: string[]): string[] {
  const out = new Set<string>();
  for (const h of htmls) for (const m of (h || '').matchAll(SOCIAL_HREF)) out.add(m[1].replace(/&amp;/g, '&'));
  return [...out].slice(0, 40);
}

/** Price-bearing lines plus offer-looking lines from a page, which is all the AI needs to see. */
function usefulLines(text: string): string[] {
  const prices = priceLines(text, 60);
  const offers = extractOffers(text).filter((l) => !prices.includes(l)).slice(0, 15);
  return [...prices, ...offers];
}

/**
 * Reads a website's home page, up to three pages likely to list prices, and up to three public
 * booking pages it links to. Fills `sources` (url → visible text) for the verbatim checks.
 */
export async function readSite(site: string, sources: Record<string, string>, home?: Fetched): Promise<SiteRead> {
  const h: Fetched = home ?? await fetchPage(site, 12_000);
  if (!okPage(h)) return { home: h.status ? h : null, pages: [], hashes: {}, bookingPages: [], socialLinks: [], htmls: [] };
  const links = extractLinks(h.html, h.finalUrl);
  const priceUrls = pricePageCandidates(links, 3).filter((u) => u !== h.finalUrl);
  const extra = await pool(priceUrls, 3, (u) => fetchPage(u, 10_000));
  const htmls = [h, ...extra.filter(okPage)];
  const booking = [...new Set(htmls.flatMap((p) => bookingLinks(p.html, p.finalUrl, 3)))].slice(0, 3);
  const bookingPages = await pool(booking, 3, (u) => fetchPage(u, 12_000));
  const pages: PageLines[] = []; const hashes: Record<string, string> = {};
  const take = (p: Fetched, isBooking: boolean) => {
    const text = visibleText(p.html);
    if (!text) return;
    hashes[p.finalUrl] = hashText(text);
    const lines = usefulLines(text);
    if (!lines.length) return;
    sources[p.finalUrl] = text;
    pages.push({ url: p.finalUrl, lines, ...(isBooking ? { booking: true } : {}) });
  };
  for (const p of htmls) take(p, false);
  for (const p of bookingPages.filter(okPage)) take(p, true);
  return { home: h, pages, hashes, bookingPages: bookingPages.filter(okPage).map((p) => p.finalUrl), socialLinks: socialLinksIn(htmls.map((p) => p.html)), htmls: htmls.map((p) => p.html) };
}

const changed = (prev: Record<string, string> | undefined, next: Record<string, string>) => {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  for (const k of keys) if ((prev ?? {})[k] !== next[k]) return true;
  return false;
};

/* ---------- AI extraction: services, prices and offers from page text ---------- */
async function extractServices(userId: string, who: string, pages: PageLines[], sources: Record<string, string>, seenAt: string): Promise<{ services: ServiceLine[]; offers: OfferLine[] } | null> {
  if (!pages.length) return { services: [], offers: [] };
  if (!aiConfigured()) return null; // keep whatever was read before; nothing is invented
  const fmt = pages.map((p) => `Page: ${p.url}${p.booking ? ' (public booking page)' : ''}\n${p.lines.join('\n')}`).join('\n\n');
  try {
    const r = await ai({
      userId, agent: 'watcher', maxTokens: 2500, fast: true,
      system: `${HOUSE_STYLE}\nYou read lines of text copied from a business's public web pages and list the services or products with their prices, and any offers or promotions. Copy names and offer wording EXACTLY as written in the lines (same words, same order; you may trim surrounding punctuation). Copy the price exactly as printed; if the page says "from £45", give "from £45". Give the exact page URL each item came from. Skip anything that is not a priced service/product (delivery charges, deposits, gift vouchers of a round amount, minimum spends). An offer is a discount, deal, bundle, free add-on, seasonal promotion or "new" announcement, quoted verbatim. Return JSON only: {"services": [{"name": "", "price": "£45", "url": ""}], "offers": [{"text": "verbatim line", "url": ""}]}. At most 40 services and 8 offers.`,
      messages: [{ role: 'user', content: `BUSINESS: ${who}\n\n${fmt.slice(0, 24_000)}` }],
    });
    const j = extractJson<any>(r.text);
    return { services: validateServices(j?.services, sources, seenAt), offers: validateOffers(j?.offers, sources, seenAt, 'website') };
  } catch (e: any) { console.error('[gainora] reach extract', who, e?.message); return null; }
}

async function extractCaptions(userId: string, who: string, posts: { id: string; caption: string; url: string }[], seenAt: string): Promise<OfferLine[] | null> {
  const withText = posts.filter((p) => p.caption.trim().length > 15);
  if (!withText.length) return [];
  if (!aiConfigured()) return null;
  try {
    const r = await ai({
      userId, agent: 'watcher', maxTokens: 1200, fast: true,
      system: `${HOUSE_STYLE}\nYou read recent Instagram captions from a business. Pull out anything a competitor would want to know: an offer or promotion, a price, or a new service/treatment/product being announced. Quote each one VERBATIM from the caption (a contiguous phrase of at most 160 characters, exactly as written, including the price if there is one). Skip hashtags, greetings and anything that isn't an offer, price or new service. Return JSON only: {"findings": [{"postId": "", "text": "verbatim phrase"}]}. At most 8.`,
      messages: [{ role: 'user', content: `BUSINESS: ${who}\n\n${withText.map((p) => `Post ${p.id} (${p.url}):\n${p.caption.slice(0, 1500)}`).join('\n\n').slice(0, 20_000)}` }],
    });
    const j = extractJson<any>(r.text);
    return validateCaptionFindings(j?.findings, posts as any, seenAt);
  } catch (e: any) { console.error('[gainora] reach captions', who, e?.message); return null; }
}

/* ---------- Instagram snapshot ---------- */
async function instagramSnapshot(userId: string, who: string, pageUrl: string, prev: InstagramSnapshot | null | undefined, now: Date, budget: { left: number }): Promise<InstagramSnapshot | null> {
  const handle = instagramHandle(pageUrl);
  if (!handle) return null;
  const same = prev && prev.handle.toLowerCase() === handle.toLowerCase() ? prev : null;
  if (same && now.getTime() - new Date(same.checkedAt).getTime() < 20 * 3_600_000) return same; // once a day
  if (budget.left <= 0) return same ?? null;
  budget.left--;
  const r = await discover(handle, 12, now);
  const at = now.toISOString();
  if (!r.ok) {
    if (r.error === 'not-business') return { handle, url: pageUrl, checkedAt: at, followers: null, mediaCount: null, followersHistory: [], postsLast30: null, posts: [], findings: [], error: 'not-business' };
    // Temporary trouble: keep what we had, note the problem.
    return same ? { ...same, error: 'unavailable' } : { handle, url: pageUrl, checkedAt: at, followers: null, mediaCount: null, followersHistory: [], postsLast30: null, posts: [], findings: [], error: 'unavailable' };
  }
  const day = at.slice(0, 10);
  const followersHistory = [...(same?.followersHistory ?? []).filter((h) => h.at.slice(0, 10) !== day), ...(r.followers != null ? [{ at, n: r.followers }] : [])].slice(-90);
  const known = new Set((same?.posts ?? []).map((p) => p.id));
  const fresh = r.posts.filter((p) => !known.has(p.id));
  let findings = same?.findings ?? [];
  if (fresh.length) {
    const found = await extractCaptions(userId, who, fresh, at);
    if (found) {
      const have = new Set(findings.map((f) => f.url + '|' + f.text.toLowerCase()));
      findings = [...found.filter((f) => !have.has(f.url + '|' + f.text.toLowerCase())), ...findings].slice(0, 20);
    }
  }
  const postUrls = new Set(r.posts.map((p) => p.url));
  return { handle: r.handle, url: pageUrl, checkedAt: at, followers: r.followers, mediaCount: r.mediaCount, followersHistory, postsLast30: postsInLast(r.posts, 30, now), posts: r.posts.slice(0, 12), findings: findings.filter((f) => postUrls.has(f.url) || now.getTime() - new Date(f.seenAt).getTime() < 60 * DAY), error: null };
}

/* ---------- Advice ---------- */
async function writeAdvice(userId: string, profile: any, list: TrackedCompetitor[], you: { rating: number | null; count: number | null; reviews30: number | null; services: ServiceLine[] }, events: ReachEvent[], now: Date): Promise<ReachAdvice[]> {
  const fallback = adviseReach(list, you, events, now);
  const recent = events.filter((e) => now.getTime() - new Date(e.at).getTime() < 8 * DAY).slice(0, 8);
  if (!list.length || !aiConfigured()) return fallback;
  const facts = [
    `YOU: Google ${you.rating ?? '–'} stars from ${you.count ?? '–'} reviews; ${you.reviews30 != null ? `${you.reviews30} new reviews in the last 30 days` : 'review pace not known yet'}. Your listed services: ${you.services.slice(0, 15).map((s) => `${s.name} ${s.price}`).join('; ') || 'none read yet'}.`,
    ...list.map((c) => `${c.name} (${c.source === 'typed' ? 'named by you' : 'found nearby'}${c.distanceKm != null ? `, ${c.distanceKm} km away` : ''}): Google ${c.rating ?? '–'} stars from ${c.count ?? '–'} reviews${reviewsSince(c.history, 30, now) != null ? `, ${reviewsSince(c.history, 30, now)} new in 30 days` : ''}. Services: ${c.services.slice(0, 12).map((s) => `${s.name} ${s.price}`).join('; ') || 'none found'}. Offers: ${c.offers.map((o) => o.text).join(' | ') || 'none'}.${c.social && !c.social.error ? ` Instagram: ${c.social.followers ?? '–'} followers, ${c.social.postsLast30 ?? '–'} posts in 30 days.` : ''}`),
    recent.length ? `WHAT CHANGED THIS WEEK:\n${recent.map((e) => `- ${e.summary}`).join('\n')}` : 'Nothing changed this week.',
  ].join('\n');
  const allowed = [...facts.matchAll(/£?\d[\d,]*(\.\d+)?/g)].map((m) => Number(m[0].replace(/[£,]/g, ''))).filter((n) => !Number.isNaN(n));
  try {
    const r = await ai({
      userId, agent: 'watcher', maxTokens: 900, fast: true,
      system: `${HOUSE_STYLE}\nYou are The Watcher explaining the competition to a business owner, like a sharp adviser who has read all the facts below. Write at most 3 short observations, most important first, each with ONE concrete action the owner can take this week. Use only the facts given; every number you mention must appear in them. New Google reviews are "a sign of how busy they look", never bookings or revenue. Never suggest contacting a competitor, copying their wording, or automatic price matching as the only option. Compare like with like only. Return JSON only: {"lines": [{"key": "the competitor key or null", "text": "one or two sentences on what the facts say", "action": "one specific thing to do this week"}]}.`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nCOMPETITOR KEYS: ${list.map((c) => `${c.name}=${c.key}`).join(', ')}\n\nFACTS (${now.toISOString().slice(0, 10)}):\n${facts}` }],
    });
    const j = extractJson<any>(r.text);
    const keys = new Set(list.map((c) => c.key));
    const lines: ReachAdvice[] = (Array.isArray(j?.lines) ? j.lines : []).filter((l: any) => l && typeof l.text === 'string' && typeof l.action === 'string')
      .filter((l: any) => !hasBanned(l.text + ' ' + l.action) && findUnsupportedNumbers(`${l.text} ${l.action}`, allowed).length === 0 && !/book(ed|ings?)\b.*\b(they|their)|their (revenue|turnover|sales)/i.test(l.text))
      .map((l: any) => ({ ...(keys.has(l.key) ? { key: l.key } : {}), text: l.text.slice(0, 400), action: l.action.slice(0, 300) })).slice(0, 3);
    return lines.length ? lines : fallback;
  } catch (e: any) { console.error('[gainora] reach advice', e?.message); return fallback; }
}

/* ---------- The daily reach check ---------- */
export interface ReachInput {
  userId: string; profile: any; prev: CompetitorsState | null | undefined;
  placeId: string | null;                 // the client's own Google listing, when chosen
  you: { rating: number | null; count: number | null; history: ReviewPoint[] };
  now?: Date; manual?: boolean; learned?: Learned | null;
  /** Force the nearby search (owner pressed "Find competitors nearby"); still capped. */
  findNow?: boolean;
}
export interface Gathered { sources: Record<string, string>; mine: PageLines[]; theirs: Record<string, PageLines[]>; homes: Record<string, Fetched> }
export interface ReachOutput { state: CompetitorsState; added: ReachEvent[]; gathered: Gathered }

export async function checkReach(input: ReachInput): Promise<ReachOutput> {
  const { userId, profile } = input;
  const now = input.now ?? new Date();
  const at = now.toISOString();
  // Deep copies: today's list is changed in place below, and yesterday's must stay as it was for the comparison.
  const state: CompetitorsState = structuredClone({ ...emptyCompetitors(now), ...(input.prev ?? {}), list: input.prev?.list ?? [], nearby: input.prev?.nearby ?? [], dismissed: input.prev?.dismissed ?? [], events: input.prev?.events ?? [] });
  const prevList: TrackedCompetitor[] = structuredClone(input.prev?.list ?? []);
  const budget = new PlacesBudget(state, now);
  const gathered: Gathered = { sources: {}, mine: [], theirs: {}, homes: {} };
  const ownSite: string = profile?.business?.website || '';
  const ownHost = hostOf(ownSite);
  const ownName = String(profile?.business?.name || '');

  // 1. Where the client is. The Google listing is the most accurate; without one, the postcode or the
  //    town centre from postcodes.io (free). A listing chosen later upgrades the coordinates.
  const you0 = state.you ?? {};
  let locSource: NonNullable<CompetitorsState['you']>['locSource'] | undefined = you0.locSource ?? (you0.lat != null ? 'listing' : undefined);
  if (input.placeId && locSource !== 'listing' && budget.can()) {
    try { budget.spend(); const loc = await placeLocation(input.placeId); if (loc) { you0.lat = loc.lat; you0.lng = loc.lng; locSource = 'listing'; } }
    catch (e: any) { console.error('[gainora] reach location', e?.message); }
  }
  if (you0.lat == null || you0.lng == null) {
    const g = await geocodeClient(String(profile?.business?.location || ''), profile?.business?.postcode);
    if (g) { you0.lat = g.lat; you0.lng = g.lng; locSource = g.source; }
  }
  if (locSource) you0.locSource = locSource;
  state.you = you0;
  const here = state.you.lat != null && state.you.lng != null ? { lat: state.you.lat, lng: state.you.lng } : null;

  // 2. Find the competition nearby: monthly, on request, when coordinates are known for the first time,
  //    or when a better location (the listing) replaces a rougher one (the town centre).
  let found: FoundPlace[] = [];
  const plan = searchPlan(profile);
  const age = state.foundAt ? now.getTime() - new Date(state.foundAt).getTime() : Infinity;
  const neverWithCoordinates = !!here && (!state.foundFrom || state.foundFrom === 'none');
  const betterLocation = !!here && !!state.foundFrom && state.foundFrom !== 'none' && state.foundFrom !== 'listing' && locSource === 'listing';
  const findDue = input.findNow || !state.foundAt || age > MONTH || neverWithCoordinates || betterLocation;
  const isSelf = (p: { id: string; name: string; website?: string }) =>
    p.id === input.placeId || (!!ownHost && !!p.website && hostOf(p.website) === ownHost) || (!!ownName && sameBusiness({ name: ownName, url: ownSite }, { name: p.name, url: p.website }));
  if (findDue && here && (plan.terms.length || plan.types.length)) {
    const r = await findNearby(here, plan, budget, isSelf);
    found = r.found;
    if (r.searched) { state.foundAt = at; state.searchTerms = plan.terms; state.foundFrom = locSource ?? 'none'; state.foundRadiusKm = r.radiusKm; }
  } else if (findDue && !here) {
    // No coordinates at all: an honest "not searched yet" rather than a search centred nowhere.
    state.foundFrom = 'none'; state.foundRadiusKm = null;
  }

  // 3. The owner's typed competitors, matched to a Google listing once (monthly retry).
  const typedRaw: { name: string; url: string }[] = (profile?.competitors?.list || []).filter((c: any) => c?.name?.trim()).slice(0, 5);
  const typed: Parameters<typeof mergeTracked>[1] = [];
  for (const t of typedRaw) {
    const prevT = prevList.find((c) => c.key === competitorKey(t)) ?? prevList.find((c) => c.source === 'typed' && sameBusiness(c, t));
    let placeId = prevT?.placeId; let extra: any = {};
    const retry = !prevT?.placeLookupAt || now.getTime() - new Date(prevT.placeLookupAt).getTime() > MONTH;
    if (!placeId && retry && town(profile) && budget.can()) {
      try {
        budget.spend();
        const res = await searchPlaces(`${t.name} ${town(profile)}`, { pageSize: 3, withWebsite: true, withLocation: true, ...(here ? { near: { ...here, radiusM: 15_000 } } : {}) });
        const pick = pickCompetitorPlace(res, t);
        if (pick) {
          const links = classifyWebsiteUri(pick.website);
          placeId = pick.id;
          extra = { address: pick.address, mapsUrl: mapsUrl(pick.id), rating: pick.rating, count: pick.count, url: t.url || links.url || '', instagram: links.instagram, facebook: links.facebook, bookingPages: links.booking ? [links.booking] : undefined, distanceKm: here && pick.lat != null && pick.lng != null ? distanceKm_(here, { lat: pick.lat, lng: pick.lng }) : null };
        }
      } catch (e: any) { console.error('[gainora] reach typed', e?.message); }
      extra.placeLookupAt = at;
    }
    typed.push({ name: t.name.trim(), url: t.url || '', placeId, ...extra });
  }
  const merged = mergeTracked(prevList, typed, found, state.dismissed, now);
  state.list = structuredClone(merged.list); // never share objects with yesterday's list
  for (const t of typed) {
    const c = state.list.find((x) => x.key === competitorKey(t));
    if (!c || !(t as any).placeLookupAt) continue;
    c.placeLookupAt = (t as any).placeLookupAt;
    // The lookup that matched the listing already returned today's rating: no second call needed.
    if (t.placeId && t.rating !== undefined) { c.history = addSample(c.history, t.rating ?? null, t.count ?? null, now); c.ratingCheckedAt = at; }
  }
  if (found.length) state.nearby = merged.nearby;
  else state.nearby = state.nearby.filter((n) => !state.list.some((c) => c.key === n.key) && !state.dismissed.some((d) => d.key === n.key));

  // 4. Google ratings, weekly, smallest field mask.
  for (const c of state.list) {
    if (!c.placeId) continue;
    const age = c.ratingCheckedAt ? now.getTime() - new Date(c.ratingCheckedAt).getTime() : Infinity;
    const fresh = found.find((f) => f.placeId === c.placeId);
    if (fresh) { c.rating = fresh.rating; c.count = fresh.count; c.history = addSample(c.history, fresh.rating, fresh.count, now); c.ratingCheckedAt = at; continue; }
    if (age < (input.manual ? DAY : WEEK) || !budget.can()) continue;
    try { budget.spend(); const r = await placeRating(c.placeId); c.rating = r.rating; c.count = r.count; c.history = addSample(c.history, r.rating, r.count, now); c.ratingCheckedAt = at; }
    catch (e: any) { console.error('[gainora] reach rating', c.name, e?.message); }
  }

  // 5. Websites and public booking pages: services, prices, offers, social links.
  if (ownSite) {
    try {
      const read = await readSite(ownSite, gathered.sources);
      if (read.home) gathered.homes.you = read.home;
      gathered.mine = read.pages;
      const you = state.you ?? {};
      if (read.pages.length && (changed(you.sourceHashes, read.hashes) || !you.services)) {
        const got = await extractServices(userId, `${ownName} (the owner's own business)`, read.pages, gathered.sources, at);
        if (got) { you.services = got.services; you.offers = got.offers; you.sourceHashes = read.hashes; you.sourcesCheckedAt = at; }
      } else if (!read.pages.length) { you.services = you.services ?? []; }
      state.you = you;
    } catch (e: any) { console.error('[gainora] reach own site', e?.message); }
  }
  for (const c of state.list) {
    if (!c.url) continue;
    try {
      const read = await readSite(c.url, gathered.sources);
      if (read.home) gathered.homes[c.key] = read.home;
      gathered.theirs[c.key] = read.pages;
      if (read.socialLinks.length) {
        const ig = read.socialLinks.map((l) => socialUrl('instagram', l)).find(Boolean);
        const fb = read.socialLinks.map((l) => socialUrl('facebook', l)).find(Boolean);
        if (ig && c.instagramSetBy !== 'owner') { c.instagram = ig; c.instagramSetBy = 'website'; }
        if (fb) c.facebook = fb;
      }
      c.bookingPages = read.bookingPages;
      c.pagesRead = Object.keys(read.hashes);
      if (read.pages.length && (changed(c.sourceHashes, read.hashes) || !c.sourcesCheckedAt)) {
        const got = await extractServices(userId, c.name, read.pages, gathered.sources, at);
        if (got) { c.services = got.services; c.offers = got.offers; c.sourceHashes = read.hashes; c.sourcesCheckedAt = at; }
      } else if (!read.pages.length && read.home) { c.services = []; c.offers = []; c.sourceHashes = read.hashes; c.sourcesCheckedAt = at; }
    } catch (e: any) { console.error('[gainora] reach site', c.name, e?.message); }
  }

  // 6. Instagram (public professional accounts only), through Gainora's own connection.
  if (metaConfigured()) {
    await refreshTokenIfDue(now);
    const igBudget = { left: Number(env('META_PER_CLIENT_CAP', '10')) };
    const ownIg = socialUrl('instagram', profile?.business?.instagram);
    if (ownIg) {
      const snap = await instagramSnapshot(userId, ownName, ownIg, state.you?.instagram, now, igBudget);
      state.you = { ...(state.you ?? {}), instagram: snap };
    } else if (state.you?.instagram) state.you.instagram = null;
    for (const c of state.list) {
      if (!c.instagram) { c.social = null; continue; }
      c.social = await instagramSnapshot(userId, c.name, c.instagram, c.social, now, igBudget);
    }
  }

  // 7. What changed, and what it means.
  const reviews30 = reviewsSince(input.you.history, 30, now);
  const fresh: ReachEvent[] = [...newlyFound(input.prev ? prevList : undefined, state.list, now)];
  for (const c of state.list) fresh.push(...diffCompetitor(prevList.find((p) => p.key === c.key), c, { reviews30 }, now));
  const muted = new Set(input.learned?.mutedChangeKinds ?? []);
  const kept = fresh.filter((e) => !(muted.has('price') && e.kind === 'price') && !(muted.has('offer') && (e.kind === 'offer' || e.kind === 'post')));
  const { events, added } = mergeEvents(state.events, kept);
  state.events = events;

  const you = { rating: input.you.rating, count: input.you.count, reviews30, services: state.you?.services ?? [] };
  const adviceAge = state.advice ? now.getTime() - new Date(state.advice.at).getTime() : Infinity;
  if (state.list.length && (added.length || adviceAge > WEEK || !state.advice)) {
    state.advice = { at, lines: await writeAdvice(userId, profile, state.list, you, state.events, now) };
  }
  state.checkedAt = at;
  return { state, added, gathered };
}

/** The tracked list as the Reviews tab shows it (name, rating, count). */
export const ratingsFor = (state: CompetitorsState | null | undefined) => (state?.list ?? []).filter((c) => c.rating != null || c.source === 'typed').map((c) => ({ name: c.name, rating: c.rating, count: c.count }));
