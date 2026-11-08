// The Watcher: website health, Google reviews, Google's speed test, competitor changes and prices,
// and (netlify/lib/reach.ts) the competition found nearby, their services, prices, offers and Instagram.
import { linksTo, socialLabel, socialUrl } from '../../shared/social';
import { connect } from 'node:tls';
import { addActions, addAlert, addNote, addValue, db, enc, insert, learnedFor, upsert } from './core';
import { ai, HOUSE_STYLE, extractJson, hasBanned, profileContext } from './ai';
import { googleConfigured, pageSpeed, placeDetails, searchPlaces } from './google';
import { fetchPage, linkStatus, okPage, pool, type Fetched } from './http';
import { checkReach, ratingsFor, socialLinksIn, type Gathered, type PageLines } from './reach';
import { reviewsSince, type CompetitorsState, type ReachEvent, type TrackedCompetitor } from '../../shared/competitors';
import { describeDiff, diffSnapshots, extractForms, extractLinks, snapshot, visibleText, type PageSnapshot } from '../../shared/pages';
import { countWeekAgo, mapsUrl, markNew, pickCompetitorPlace, type ReviewItem, type ReviewsState } from '../../shared/reviews';
import { carryDone, type SpeedState } from '../../shared/speed';
import { diffPriceTables, priceLines, pricePageCandidates, validatePriceTable, type PriceMove, type PriceTable } from '../../shared/prices';
import type { Learned } from '../../shared/learning';

export { fetchPage, linkStatus, socialLinksIn };
export type { Fetched };

export function sslDaysLeft(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!cert?.valid_to) return resolve(null);
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000));
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

export interface SiteCheck {
  up: boolean; responseMs: number; sslDaysLeft: number | null; pagesChecked: number;
  brokenLinks: { url: string; foundOn: string; status: number }[];
  contactProblem: string | null;
  /** Instagram and Facebook links found on the pages checked. */
  socialLinks: string[];
}

/** Notices about the owner's social pages that a website check can prove: the site should link to them. */
export function socialIssues(profile: any, site: string, check: Pick<SiteCheck, 'up' | 'socialLinks'>) {
  const out: { id: string; title: string; detail: string; level: 'notice'; link?: string }[] = [];
  if (!site || !check.up) return out;
  for (const [kind, name] of [['instagram', 'Instagram'], ['facebook', 'Facebook page']] as const) {
    const url = socialUrl(kind, profile?.business?.[kind]);
    if (!url || linksTo(kind, url, check.socialLinks)) continue;
    out.push({ id: `social-${kind}`, level: 'notice', title: `Your website doesn’t link to your ${name}`, detail: `We couldn’t find a link to ${socialLabel(kind, url)} on your website. Add one (usually in the footer or on the contact page) so visitors can find you there.`, link: url });
  }
  return out;
}

/** Crawls up to `maxPages` pages of the client's own site and checks every internal link on them. */
export async function checkSite(site: string, maxPages = 25, maxLinks = 150): Promise<SiteCheck> {
  const home = await fetchPage(site);
  const host = (() => { try { return new URL(home.finalUrl || site).hostname; } catch { return ''; } })();
  const ssl = host && site.startsWith('https') ? await sslDaysLeft(host) : null;
  if (home.status === 0 || home.status >= 500) {
    return { up: false, responseMs: home.ms, sslDaysLeft: ssl, pagesChecked: 1, brokenLinks: [], contactProblem: null, socialLinks: [] };
  }
  const homeLinks = extractLinks(home.html, home.finalUrl);
  const pages = [home.finalUrl, ...homeLinks.filter((l) => !/\.(pdf|jpe?g|png|gif|webp|zip|mp4)(\?|$)/i.test(l))].slice(0, maxPages);
  const fetched = await pool(pages.slice(1), 4, (u) => fetchPage(u, 12_000));
  const all: Fetched[] = [home, ...fetched];

  const linkFrom = new Map<string, string>();
  for (const p of all) for (const l of extractLinks(p.html, p.finalUrl)) if (!linkFrom.has(l)) linkFrom.set(l, p.finalUrl);
  const known = new Map(all.map((p) => [p.url, p.status]));
  const toCheck = [...linkFrom.keys()].filter((l) => !known.has(l)).slice(0, maxLinks);
  const statuses = await pool(toCheck, 6, linkStatus);
  toCheck.forEach((l, i) => known.set(l, statuses[i]));

  const brokenLinks = [...linkFrom.entries()]
    .filter(([l]) => { const s = known.get(l); return s !== undefined && (s === 404 || s === 410 || s >= 500); })
    .map(([url, foundOn]) => ({ url, foundOn, status: known.get(url)! }))
    .slice(0, 50);

  // Contact page: it should load and offer a way to get in touch. We never submit forms.
  let contactProblem: string | null = null;
  const contact = all.find((p) => /contact|get-in-touch|enquir/i.test(p.url));
  if (contact) {
    const hasWay = extractForms(contact.html, contact.finalUrl).length > 0 || /mailto:|tel:/i.test(contact.html);
    if (contact.status >= 400 || contact.status === 0) contactProblem = `Your contact page (${new URL(contact.url).pathname}) returned an error when we loaded it, so visitors may not be able to reach you.`;
    else if (!hasWay) contactProblem = 'Your contact page has no form, email link or phone link that we could find. Visitors need an obvious way to reach you.';
  }
  return { up: true, responseMs: home.ms, sslDaysLeft: ssl, pagesChecked: all.length, brokenLinks, contactProblem, socialLinks: socialLinksIn(all.map((p) => p.html)) };
}

interface StoredSnap { page: PageSnapshot; links: string[] }

/**
 * Compares each competitor's home page with yesterday's copy and records what changed. Skips kinds
 * the owner muted. `comps` defaults to the competitors the owner typed; the daily run passes the
 * whole watched list (typed and found) with the home pages it has already fetched.
 */
export async function checkCompetitors(userId: string, profile: any, learned?: Learned | null, comps?: { name: string; url: string; page?: Fetched }[]) {
  const muted = new Set(learned?.mutedChangeKinds ?? []);
  const list: { name: string; url: string; page?: Fetched }[] = (comps ?? (profile?.competitors?.list || [])).filter((c: any) => c.url).slice(0, 9);
  const found: { competitor: string; url: string; kind: 'price' | 'offer' | 'content' | 'new-page'; summary: string; raw: any }[] = [];
  for (const c of list) {
    const page = c.page && okPage(c.page) ? c.page : await fetchPage(c.url);
    if (!page.html) continue;
    const now: StoredSnap = { page: snapshot(page.finalUrl, page.html), links: extractLinks(page.html, page.finalUrl) };
    const prevRows = await db<any[]>(`page_snapshots?select=snapshot&user_id=eq.${userId}&url=eq.${enc(c.url)}`);
    const prev: StoredSnap | undefined = prevRows[0]?.snapshot;
    await upsert('page_snapshots', { user_id: userId, url: c.url, snapshot: now, updated_at: new Date().toISOString() }, 'user_id,url');
    if (!prev) continue; // first visit: nothing to compare yet
    const d = diffSnapshots(prev.page, now.page);
    const desc = describeDiff(c.name, d);
    if (desc && !muted.has(desc.kind)) found.push({ competitor: c.name, url: c.url, kind: desc.kind, summary: desc.summary, raw: d });
    if (!muted.has('new-page')) {
      const newPages = now.links.filter((l) => !prev.links.includes(l) && /gift|sale|offer|new|christmas|black-friday|price|service|collection/i.test(l)).slice(0, 2);
      for (const l of newPages) found.push({ competitor: c.name, url: l, kind: 'new-page', summary: `${c.name} added a new page: ${new URL(l).pathname}`, raw: { url: l } });
    }
  }
  if (!found.length) return [];

  // Ask the AI why each change matters for this client. Falls back to the plain description.
  let details: { summary: string; detail: string }[] = [];
  try {
    const r = await ai({
      userId, agent: 'watcher', maxTokens: 900, fast: true,
      system: `${HOUSE_STYLE}\nYou explain competitor website changes to a business owner. Only use the facts given; never guess at prices, dates or reasons that are not in them. Return JSON only.`,
      messages: [{ role: 'user', content: `${profileContext(profile)}\n\nChanges spotted today (facts only):\n${found.map((f, i) => `${i + 1}. ${f.summary}\nDetail: ${JSON.stringify(f.raw).slice(0, 800)}`).join('\n\n')}\n\nReturn a JSON array with one object per change, same order: {"summary": "one plain sentence of what changed, naming the competitor", "detail": "What this means for this owner in one sentence (compare with the owner's own prices, offer or edge where the profile gives them), then one concrete thing to consider, starting 'Worth considering:'. If it changes nothing for them, say so plainly."}.` }],
    });
    details = extractJson(r.text);
  } catch (e: any) { console.error('[gainora] watcher ai', e?.message); }

  const rows = found.map((f, i) => {
    const d = Array.isArray(details) ? details[i] : undefined;
    const ok = d && typeof d.summary === 'string' && !hasBanned(d.summary + (d.detail || ''));
    return { user_id: userId, competitor: f.competitor, url: f.url, kind: f.kind, summary: ok ? d!.summary.slice(0, 300) : f.summary, detail: ok ? String(d!.detail || '').slice(0, 600) : null };
  });
  const saved = await insert('competitor_changes', rows);
  for (const r of saved) await addValue(userId, 'watcher', 'competitor_change', r.summary);
  return saved;
}

/* ---------- Google reviews ---------- */
const DAY = 86_400_000;
const WEEK = 6.5 * DAY;
const town = (p: any) => String(p?.business?.location || '').split(',')[0].trim();
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const compNames = (p: any) => (p?.competitors?.list || []).filter((c: any) => c.name).slice(0, 4).map((c: any) => c.name as string);

async function competitorRatings(profile: any): Promise<ReviewsState['competitors']> {
  const comps = (profile?.competitors?.list || []).filter((c: any) => c.name).slice(0, 4);
  return Promise.all(comps.map(async (c: any) => {
    try {
      const found = await searchPlaces(`${c.name} ${town(profile)}`.trim(), { pageSize: 3, withWebsite: true });
      const pick = pickCompetitorPlace(found, c);
      return { name: c.name, rating: pick?.rating ?? null, count: pick?.count ?? null };
    } catch { return { name: c.name, rating: null, count: null }; }
  }));
}

/** Reads the client's public Google listing, and how competitors' ratings compare (weekly). */
export async function checkReviews(placeId: string, placeName: string | null, profile: any, prev: ReviewsState | null | undefined, now = new Date(), refreshCompetitors = true) {
  const d = await placeDetails(placeId, true);
  const same = !!prev && prev.placeId === placeId;
  const reviews = markNew(same ? prev!.reviews : null, d.reviews, now);
  const history = [...(same ? prev!.history ?? [] : []), { at: now.toISOString(), rating: d.rating, count: d.count }].slice(-60);
  // When the reach check owns competitor ratings (the daily run), this weekly text search is skipped.
  const compsDue = refreshCompetitors && (!same || !prev!.competitorsCheckedAt || now.getTime() - new Date(prev!.competitorsCheckedAt).getTime() > WEEK
    || prev!.competitors.map((c) => c.name).join('|') !== compNames(profile).join('|'));
  const competitors = compsDue ? await competitorRatings(profile) : (prev?.competitors ?? []);
  const state: ReviewsState = {
    placeId, placeName: d.name || placeName || profile?.business?.name || 'Your business', mapsUrl: mapsUrl(placeId),
    rating: d.rating, count: d.count, previousCount: countWeekAgo(history, now), reviews, competitors,
    checkedAt: now.toISOString(), competitorsCheckedAt: compsDue ? now.toISOString() : prev?.competitorsCheckedAt, history,
  };
  const fresh = same ? reviews.filter((r) => r.isNew && !prev!.reviews.some((p) => p.id === r.id)) : [];
  const unseen = same && prev!.count != null && d.count != null ? Math.max(0, d.count - prev!.count - fresh.length) : 0;
  return { state, fresh, unseen };
}

async function reviewAlerts(userId: string, rv: ReviewsState, fresh: ReviewItem[], unseen: number) {
  const quote = (t: string) => `“${t.slice(0, 140)}${t.length > 140 ? '…' : ''}”`;
  for (const r of fresh.slice(0, 5)) await addValue(userId, 'watcher', 'review_alert', `New review from ${r.author} (${r.rating} star${r.rating === 1 ? '' : 's'})`);
  for (let i = 0; i < Math.min(unseen, 10); i++) await addValue(userId, 'watcher', 'review_alert', 'New review on Google');
  const low = fresh.filter((r) => r.rating <= 3).slice(0, 3);
  for (const r of low) {
    await addAlert(userId, 'watcher', 'urgent', `New ${r.rating}-star review`, `${r.author} ${r.text ? `wrote: ${quote(r.text)}` : 'left a rating without a comment'}. The Watcher can draft a calm reply for you on the Reviews tab.`, rv.mapsUrl);
  }
  if (low.length) await addActions(userId, 'watcher', low.map((r) => `Reply to ${r.author}’s ${r.rating}-star review`));
  const good = fresh.filter((r) => r.rating >= 4);
  if (good.length === 1) await addAlert(userId, 'watcher', 'good', `New ${good[0].rating}-star review from ${good[0].author}`, `${good[0].text ? `${quote(good[0].text)} ` : ''}A short public thank-you shows future customers you care.`, rv.mapsUrl);
  else if (good.length > 1) await addAlert(userId, 'watcher', 'good', `${good.length} new good reviews`, `From ${good.map((r) => r.author).join(', ')}. A short thank-you to each shows future customers you care.`, rv.mapsUrl);
  if (unseen > 0) await addAlert(userId, 'watcher', 'notice', `${unseen} new review${unseen > 1 ? 's' : ''} on Google`, 'Google hasn’t shared the text with us yet. Open your listing to read and reply.', rv.mapsUrl);
}

/* ---------- Google's speed test (weekly) ---------- */
async function checkSpeed(site: string, prev: SpeedState | null | undefined, manual: boolean): Promise<{ state: SpeedState | null; ran: boolean }> {
  const age = prev ? Date.now() - new Date(prev.checkedAt).getTime() : Infinity;
  if (age < (manual ? DAY : WEEK)) return { state: prev ?? null, ran: false };
  try { return { state: carryDone(prev, await pageSpeed(site)), ran: true }; }
  catch (e: any) { console.error('[gainora] speed', e?.message); return { state: prev ?? null, ran: false }; }
}

/** Uses the latest "done" marks, in case the owner ticked a fix while this check was running. */
function syncDone(latest: SpeedState | null | undefined, next: SpeedState | null): SpeedState | null {
  if (!next || !latest) return next;
  const marks = new Map(latest.fixes.map((f) => [f.title, !!f.done]));
  return { ...next, fixes: next.fixes.map((f) => (marks.has(f.title) ? { ...f, done: marks.get(f.title) } : f)) };
}

/* ---------- Price comparison (weekly) ---------- */
async function sitePrices(site: string, sources: Record<string, string>): Promise<PageLines[]> {
  const home = await fetchPage(site);
  if (!home.html || home.status >= 400) return [];
  const extra = pricePageCandidates(extractLinks(home.html, home.finalUrl), 3);
  const pages = [home, ...(await pool(extra, 3, (u) => fetchPage(u, 12_000)))];
  const out: PageLines[] = [];
  for (const p of pages) {
    if (!p.html || p.status >= 400 || p.status === 0) continue;
    const text = visibleText(p.html);
    const lines = priceLines(text, 25);
    if (!lines.length) continue;
    sources[p.finalUrl] = text;
    out.push({ url: p.finalUrl, lines });
  }
  return out;
}

/**
 * Builds a like-for-like price table. The AI only pairs up comparable items; every price it
 * reports is checked against the page it came from (validatePriceTable), or it is dropped.
 * `gathered` is what the reach check already read today (own site, competitors' sites and their
 * public booking pages), so nothing is fetched twice; without it the pages are read here.
 */
export async function buildPriceTable(userId: string, profile: any, now = new Date(), gathered?: Gathered, tracked?: TrackedCompetitor[]): Promise<PriceTable | null> {
  const comps: { name: string; url: string; key?: string }[] = tracked
    ? tracked.filter((c) => c.url && c.name).slice(0, 5).map((c) => ({ name: c.name, url: c.url, key: c.key }))
    : (profile?.competitors?.list || []).filter((c: any) => c.url && c.name).slice(0, 4);
  const site = profile?.business?.website;
  if (!site || !comps.length) return null;
  const sources: Record<string, string> = gathered?.sources ?? {};
  const mine = gathered ? gathered.mine : await sitePrices(site, sources);
  const theirs: PageLines[][] = [];
  for (const c of comps) theirs.push(gathered && c.key ? gathered.theirs[c.key] ?? [] : await sitePrices(c.url, sources));
  const empty: PriceTable = { checkedAt: now.toISOString(), competitors: comps.map((c) => c.name), rows: [] };
  if ((mine.length ? 1 : 0) + theirs.filter((t) => t.length).length < 2) return empty;
  const fmt = (pages: PageLines[]) => pages.map((p) => `Page: ${p.url}${p.booking ? ' (public booking page)' : ''}\n${p.lines.join('\n')}`).join('\n\n') || '(no prices found)';
  const r = await ai({
    userId, agent: 'watcher', maxTokens: 2000, fast: true,
    system: `${HOUSE_STYLE}\nYou build a like-for-like price comparison for a business. You get lines of text containing prices from the owner's website and from competitors' websites and public booking pages, each with the page it came from. Pair up products or services a customer would genuinely compare (same kind of item or treatment, similar size, scope or duration). Use only prices that appear in the lines, copied exactly, with the exact page URL they came from. Use null when a business has no comparable item. Return JSON only: {"rows": [{"item": "short generic name, e.g. Large serving bowl or Lip filler 1ml", "yours": {"price": "£48", "name": "the owner's product name", "url": "page url"} or null, "theirs": [one entry per competitor, in the order given, same shape or null], "note": "optional, under 15 words"}]}. At most 10 rows, the most useful comparisons first.`,
    messages: [{ role: 'user', content: `${profileContext(profile)}\n\nTHE OWNER'S WEBSITE\n${fmt(mine)}\n\n${comps.map((c, i) => `COMPETITOR ${i + 1}: ${c.name}\n${fmt(theirs[i])}`).join('\n\n')}`.slice(0, 60_000) }],
  });
  const raw = extractJson<any>(r.text);
  return validatePriceTable({ ...empty, rows: Array.isArray(raw?.rows) ? raw.rows : [] }, sources);
}

/* ---------- The daily run ---------- */
const FIXED_TITLE: Record<string, string> = {
  down: 'Fixed: website back online', contact: 'Fixed: contact page working again', ssl: 'Fixed: security certificate renewed',
  links: 'Fixed: broken links', slow: 'Fixed: home page speed',
  'social-instagram': 'Fixed: website now links to your Instagram', 'social-facebook': 'Fixed: website now links to your Facebook page',
};

export const baseState = (site: string) => ({
  site, up: true, responseMs: 0, uptime30d: 100, sslDaysLeft: null, pagesChecked: 0, brokenLinks: [], issues: [], history: [], changes: [],
});

/** Alerts, to-dos and value entries for what the reach check found today. Only the new events. */
async function reachAlerts(userId: string, added: ReachEvent[], comps: CompetitorsState) {
  const important = added.filter((e) => e.kind !== 'followers').slice(0, 3);
  for (const e of important) {
    await addValue(userId, 'watcher', 'competitor_change', e.summary.slice(0, 200));
    const advice = comps.advice?.lines.find((l) => l.key === e.key);
    await addAlert(userId, 'watcher', e.kind === 'new-nearby' ? 'notice' : 'notice', e.summary.slice(0, 160), `${e.detail ? `${e.detail} ` : ''}${advice ? advice.action : 'Details are on the Competitors tab.'}`.slice(0, 500), e.url);
  }
  const actions: string[] = [];
  const surge = added.find((e) => e.kind === 'reviews');
  if (surge) actions.push(`Ask your recent customers for a Google review (${surge.competitor} is getting more than you)`);
  const offer = added.find((e) => e.kind === 'offer' || e.kind === 'post');
  if (offer) actions.push(`Decide how to answer ${offer.competitor}’s new offer`);
  const nearby = added.find((e) => e.kind === 'new-nearby');
  if (nearby) actions.push(`Look at ${nearby.competitor}, newly listed near you`);
  await addActions(userId, 'watcher', actions);
}

/** The daily reach check, with the pieces the rest of the run needs. Never fails the run. */
async function reachStep(userId: string, profile: any, prev: any, row: any, reviews: ReviewsState | null, opts: { manual?: boolean; findNow?: boolean }, learned: Learned | null, now: Date) {
  try {
    const r = await checkReach({
      userId, profile, prev: prev?.competitors ?? null, placeId: row?.place_id ?? null, now, manual: !!opts.manual, findNow: !!opts.findNow, learned,
      you: { rating: reviews?.rating ?? null, count: reviews?.count ?? null, history: reviews?.history ?? [] },
    });
    return r;
  } catch (e: any) { console.error('[gainora] reach', e?.message); return null; }
}

/**
 * One client's Watcher run: site checks and competitor changes daily, Google reviews daily
 * (once a listing is chosen), the competition's listings, pages and Instagram daily (reach),
 * Google's speed test and the price comparison weekly.
 * `only: 'reviews'` refreshes just the Google listing (used straight after the owner picks it).
 */
export async function runWatcher(userId: string, profile: any, opts: { quiet?: boolean; only?: 'reviews'; manual?: boolean; findNow?: boolean } = {}) {
  const site: string = profile?.business?.website || '';
  const now = new Date();
  const [row] = await db<any[]>(`watcher_state?select=state,place_id,place_name&user_id=eq.${userId}`);
  const prev = row?.state && Object.keys(row.state).length ? row.state : null;

  let reviews: ReviewsState | null = prev?.reviews ?? null;
  let fresh: ReviewItem[] = []; let unseen = 0;
  if (row?.place_id && googleConfigured()) {
    try { const r = await checkReviews(row.place_id, row.place_name, profile, prev?.reviews, now, opts.only === 'reviews'); reviews = r.state; fresh = r.fresh; unseen = r.unseen; }
    catch (e: any) { console.error('[gainora] reviews', e?.message); if (opts.only === 'reviews') throw e; }
  }

  const social = { instagram: socialUrl('instagram', profile?.business?.instagram), facebook: socialUrl('facebook', profile?.business?.facebook) };

  if (opts.only === 'reviews') {
    const state = { ...baseState(site), ...(prev ?? {}), reviews, social };
    // updated_at is left alone: it means "last full check" (used to limit manual checks).
    await upsert('watcher_state', { user_id: userId, state }, 'user_id');
    if (reviews) await reviewAlerts(userId, reviews, fresh, unseen);
    return state;
  }

  const learned = await learnedFor(userId);
  // The competition: who is nearby, their listings, pages, booking pages and Instagram.
  const reach = await reachStep(userId, profile, prev, row, reviews, opts, learned, now);
  const competitors: CompetitorsState | null = reach?.state ?? prev?.competitors ?? null;
  if (reviews && competitors) reviews = { ...reviews, competitors: ratingsFor(competitors), competitorsCheckedAt: competitors.checkedAt };
  const tracked = (competitors?.list ?? []).filter((c) => c.url).map((c) => ({ name: c.name, url: c.url, page: reach?.gathered.homes[c.key] }));
  const compsForDiff = tracked.length ? tracked : undefined;
  const changes: any[] = await checkCompetitors(userId, profile, learned, compsForDiff).catch((e) => { console.error('[gainora] competitors', e?.message); return []; });

  // No website: the reviews and competitor checks still run every day.
  if (!site) {
    const state = { ...baseState(''), ...(prev ?? {}), site: '', up: true, issues: [], brokenLinks: [], reviews, social, competitors, lastCheck: now.toISOString(), nextCheck: new Date(now.getTime() + DAY).toISOString() };
    await upsert('watcher_state', { user_id: userId, state, updated_at: new Date().toISOString() }, 'user_id');
    for (const c of changes.slice(0, 3)) await addAlert(userId, 'watcher', 'notice', c.summary, c.detail || `Spotted on ${c.competitor}’s website.`, c.url || undefined);
    if (reviews) await reviewAlerts(userId, reviews, fresh, unseen);
    if (reach && competitors) await reachAlerts(userId, reach.added, competitors);
    const actions: string[] = [];
    if (changes.length) actions.push(`Review what ${changes[0].competitor} changed and decide whether to respond`);
    if (!prev && !row?.place_id && googleConfigured()) actions.push('Find your Google listing so the Watcher can track your reviews');
    await addActions(userId, 'watcher', actions);
    if (!opts.quiet) {
      const newCount = fresh.length + unseen;
      const parts = [
        newCount ? `You have ${newCount} new Google review${newCount > 1 ? 's' : ''}${fresh.some((r) => r.rating <= 3) ? ', including one that needs a reply' : ''}.` : '',
        reach?.added.length ? `On the competitor side: ${reach.added[0].summary}` : changes.length ? `On the competitor side: ${changes[0].summary}` : `No competitor changes since the last check${competitors?.list.length ? ` (${competitors.list.length} watched)` : ''}.`,
      ];
      await addNote(userId, 'watcher', parts.filter(Boolean).join(' '));
    }
    return state;
  }

  const check = await checkSite(site);
  const sp = await checkSpeed(site, prev?.speed, !!opts.manual);

  // Prices: weekly, and only when there are competitors with websites.
  let prices: PriceTable | null = prev?.prices ?? null;
  let moves: PriceMove[] = [];
  if (!prices || now.getTime() - new Date(prices.checkedAt).getTime() > WEEK) {
    try {
      const table = await buildPriceTable(userId, profile, now, reach?.gathered, competitors?.list);
      if (table) {
        moves = learned.mutedChangeKinds.includes('price') ? [] : diffPriceTables(prices, table);
        prices = table;
        if (table.rows.length) await addValue(userId, 'watcher', 'price_check', 'Compared your prices with competitors');
      }
    } catch (e: any) { console.error('[gainora] prices', e?.message); }
  }
  const priceRows = moves
    .filter((m) => !changes.some((c) => c.competitor === m.competitor && c.kind === 'price' && String(c.summary).includes(m.to)))
    .filter((m) => !(reach?.added ?? []).some((e) => e.kind === 'price' && e.competitor === m.competitor && e.summary.includes(m.to)))
    .slice(0, 5)
    .map((m) => {
      const cell = prices!.rows.find((r) => r.item === m.item)?.theirs[prices!.competitors.indexOf(m.competitor)];
      return { user_id: userId, competitor: m.competitor, url: cell?.url ?? '', kind: 'price' as const, summary: `${m.competitor} changed the price of ${lower1(m.item)} from ${m.from} to ${m.to}.`, detail: null };
    });
  if (priceRows.length) {
    const saved = await insert('competitor_changes', priceRows);
    for (const r of saved) await addValue(userId, 'watcher', 'competitor_change', r.summary);
    changes.push(...saved);
  }

  const history = [...(prev?.history || []), { at: now.toISOString(), ms: check.responseMs, up: check.up }].slice(-30);
  const upCount = history.filter((h: any) => h.up).length;
  const avg = history.filter((h: any) => h.up).reduce((a: number, h: any) => a + h.ms, 0) / Math.max(1, upCount);

  const issues: { id: string; title: string; detail: string; level: 'urgent' | 'notice'; link?: string }[] = [];
  if (!check.up) issues.push({ id: 'down', level: 'urgent', title: 'Your website is not responding', detail: 'We could not load your home page. Visitors may be seeing an error. Check with your website host.', link: site });
  if (check.contactProblem) issues.push({ id: 'contact', level: 'urgent', title: 'Your contact page needs attention', detail: check.contactProblem });
  if (check.sslDaysLeft != null && check.sslDaysLeft < 30) issues.push({ id: 'ssl', level: check.sslDaysLeft < 10 ? 'urgent' : 'notice', title: `Your security certificate expires in ${check.sslDaysLeft} days`, detail: 'If it isn’t renewed, browsers will warn visitors that your site is not secure. Most hosts renew automatically; check yours is set to.' });
  if (check.brokenLinks.length) issues.push({ id: 'links', level: check.brokenLinks.length > 10 ? 'urgent' : 'notice', title: `${check.brokenLinks.length} link${check.brokenLinks.length > 1 ? 's lead' : ' leads'} to a missing page`, detail: 'Visitors who click these see an error. Update or remove them; the list is below.' });
  issues.push(...socialIssues(profile, site, check));
  if (check.up && avg > 2500) issues.push({ id: 'slow', level: 'notice', title: 'Your home page is slow to load', detail: `It took about ${(avg / 1000).toFixed(1)} seconds on average this month. Under 2 seconds is a good target; large images are the usual cause.` });

  // Keep any "done" ticks the owner made while this run was working.
  const [latest] = await db<any[]>(`watcher_state?select=state&user_id=eq.${userId}`).catch(() => []);
  const speed = syncDone(latest?.state?.speed, sp.state);

  const state = {
    site, lastCheck: now.toISOString(), nextCheck: new Date(now.getTime() + DAY).toISOString(),
    up: check.up, responseMs: check.responseMs, uptime30d: Math.round((upCount / history.length) * 1000) / 10,
    sslDaysLeft: check.sslDaysLeft, pagesChecked: check.pagesChecked, brokenLinks: check.brokenLinks, issues, history, changes: [],
    reviews, speed, prices, social, competitors,
  };
  await upsert('watcher_state', { user_id: userId, state, updated_at: new Date().toISOString() }, 'user_id');

  // Value tracker and alerts: only for what is new, so clients aren't nagged daily about the same thing.
  const prevIds = new Set<string>((prev?.issues || []).map((i: any) => i.id));
  const nowIds = new Set(issues.map((i) => i.id));
  for (const i of issues.filter((x) => !prevIds.has(x.id))) {
    await addValue(userId, 'watcher', 'issue_found', `Found: ${lower1(i.title)}`);
    await addAlert(userId, 'watcher', i.level, i.title, i.detail, i.link);
  }
  if (prev) for (const id of [...prevIds].filter((x) => !nowIds.has(x))) if (FIXED_TITLE[id]) await addValue(userId, 'you', 'issue_fixed', FIXED_TITLE[id]);
  for (const c of changes.slice(0, 3)) await addAlert(userId, 'watcher', 'notice', c.summary, c.detail || `Spotted on ${c.competitor}’s website.`, c.url || undefined);
  if (reviews) await reviewAlerts(userId, reviews, fresh, unseen);
  if (reach && competitors) await reachAlerts(userId, reach.added, competitors);

  let newFixes: SpeedState['fixes'] = [];
  if (sp.ran && speed) {
    const before = new Set<string>((prev?.speed?.fixes ?? []).map((f: any) => f.title));
    newFixes = speed.fixes.filter((f) => !before.has(f.title) && !f.done && f.impact !== 'Low');
    for (const f of newFixes) await addValue(userId, 'watcher', 'issue_found', `Speed fix: ${lower1(f.title)}`);
    const p0 = prev?.speed?.scores?.performance; const p1 = speed.scores.performance;
    if (!prev?.speed && speed.fixes.length) {
      await addAlert(userId, 'watcher', 'notice', `Google’s speed test: ${p1 ?? '–'}/100 on phones`, `${speed.fixes.length} thing${speed.fixes.length > 1 ? 's' : ''} to improve, most important first. Start with: ${lower1(speed.fixes[0].title)}.`);
    } else if (p0 != null && p1 != null && p0 - p1 >= 10) {
      await addAlert(userId, 'watcher', 'notice', `Your speed score dropped from ${p0} to ${p1}`, 'Something on your home page has made it slower on phones this week. The Speed and Google tab shows what to fix first.');
    }
  }

  const actions: string[] = [];
  if (!check.up) actions.push('Contact your website host: your site is down');
  if (check.contactProblem) actions.push('Fix your contact page so enquiries reach you');
  if (check.brokenLinks.length) actions.push(`Fix the ${check.brokenLinks.length} broken link${check.brokenLinks.length > 1 ? 's' : ''} the Watcher found`);
  if (changes.length) actions.push(`Review what ${changes[0].competitor} changed and decide whether to respond`);
  const topFix = newFixes.find((f) => f.impact === 'High');
  if (topFix) actions.push(`${topFix.title} (${topFix.who === 'You' ? 'you can do this yourself' : 'ask your web person'})`);
  if (!prev && !row?.place_id && googleConfigured()) actions.push('Find your Google listing so the Watcher can track your reviews');
  await addActions(userId, 'watcher', actions);

  if (!opts.quiet) {
    const urgent = issues.filter((i) => i.level === 'urgent');
    const parts: string[] = [];
    parts.push(urgent.length ? `${urgent[0].title}. ${urgent[0].detail}` : check.up ? `Your website is online and loaded in ${(check.responseMs / 1000).toFixed(1)} seconds today.` : '');
    if (check.brokenLinks.length && !urgent.some((u) => u.id === 'links')) parts.push(`There ${check.brokenLinks.length === 1 ? 'is 1 broken link' : `are ${check.brokenLinks.length} broken links`} to tidy up.`);
    const newCount = fresh.length + unseen;
    if (newCount) parts.push(`You have ${newCount} new Google review${newCount > 1 ? 's' : ''}${fresh.some((r) => r.rating <= 3) ? ', including one that needs a reply' : ''}.`);
    if (sp.ran && speed && newFixes.length) parts.push(`Google’s speed test scored your home page ${speed.scores.performance ?? '–'}/100 on phones; the biggest fix is to ${lower1(newFixes[0].title)}.`);
    const reviews30 = reviewsSince(reviews?.history, 30, now);
    const busiest = (competitors?.list ?? []).map((c) => ({ c, n: reviewsSince(c.history, 30, now) })).filter((x) => x.n != null && x.n > 0).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0];
    if (reach?.added.length) parts.push(`On the competitor side: ${reach.added[0].summary}`);
    else if (changes.length) parts.push(`On the competitor side: ${changes[0].summary}`);
    else if (busiest && reviews30 != null) parts.push(`On the competitor side, nothing new; ${busiest.c.name} picked up ${busiest.n} Google review${busiest.n === 1 ? '' : 's'} in the last 30 days to your ${reviews30}.`);
    else parts.push(`No competitor changes since the last check${competitors?.list.length ? ` (${competitors.list.length} watched)` : ''}.`);
    await addNote(userId, 'watcher', parts.filter(Boolean).join(' '));
  }
  return state;
}

export { insert };
