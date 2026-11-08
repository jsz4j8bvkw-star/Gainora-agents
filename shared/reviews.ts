// Google reviews, read from the business's public Google listing (Places API).

const DAY = 86_400_000;

export interface ReviewItem {
  id: string;
  author: string;
  rating: number;
  text: string;
  when: string;          // "2 weeks ago", as Google describes it
  publishedAt?: string;
  isNew?: boolean;
  seenAt?: string;       // when the Watcher first saw it
}

export interface PlaceSummary { id: string; name: string; address: string; rating: number | null; count: number | null; website?: string; lat?: number; lng?: number }

export interface ReviewPoint { at: string; rating: number | null; count: number | null }

export interface ReviewsState {
  placeId: string;
  placeName: string;
  mapsUrl: string;
  rating: number | null;
  count: number | null;
  previousCount: number | null;
  reviews: ReviewItem[];
  competitors: { name: string; rating: number | null; count: number | null }[];
  checkedAt: string;
  competitorsCheckedAt?: string;
  history?: ReviewPoint[];
}

export const mapsUrl = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

export function parsePlace(json: any): { rating: number | null; count: number | null; reviews: ReviewItem[] } {
  const reviews: ReviewItem[] = (json?.reviews || []).map((r: any, i: number) => ({
    id: String(r.name || `${r.authorAttribution?.displayName || 'review'}-${r.publishTime || i}`),
    author: String(r.authorAttribution?.displayName || 'A Google user'),
    rating: Number(r.rating) || 0,
    text: String(r.originalText?.text || r.text?.text || '').trim(),
    when: String(r.relativePublishTimeDescription || ''),
    publishedAt: r.publishTime || undefined,
  }));
  return {
    rating: typeof json?.rating === 'number' ? json.rating : null,
    count: typeof json?.userRatingCount === 'number' ? json.userRatingCount : null,
    reviews,
  };
}

export function parseSearch(json: any, max = 5): PlaceSummary[] {
  return (json?.places || []).slice(0, max).map((p: any) => ({
    id: String(p.id),
    name: String(p.displayName?.text || p.displayName || 'Unnamed place'),
    address: String(p.formattedAddress || ''),
    rating: typeof p.rating === 'number' ? p.rating : null,
    count: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    ...(p.websiteUri ? { website: String(p.websiteUri) } : {}),
    ...(typeof p.location?.latitude === 'number' && typeof p.location?.longitude === 'number' ? { lat: p.location.latitude, lng: p.location.longitude } : {}),
  }));
}

/**
 * Marks reviews that weren't there last time. On the first check nothing is "new".
 * A review stays new for a week after it was first seen, and an old review that Google
 * starts showing (published more than 30 days ago) is never treated as new.
 */
export function markNew(prev: ReviewItem[] | null | undefined, now: ReviewItem[], at = new Date()): ReviewItem[] {
  const stamp = at.toISOString();
  if (!prev) return now.map((r) => ({ ...r, isNew: false, seenAt: stamp }));
  const old = new Map(prev.map((r) => [r.id, r]));
  return now.map((r) => {
    const p = old.get(r.id);
    if (!p) {
      const recent = !r.publishedAt || at.getTime() - new Date(r.publishedAt).getTime() < 30 * DAY;
      return { ...r, isNew: recent, seenAt: stamp };
    }
    const seenAt = p.seenAt ?? stamp;
    return { ...r, isNew: !!p.isNew && at.getTime() - new Date(seenAt).getTime() < 7 * DAY, seenAt };
  });
}


/** The review count about a week ago, for "N new since last week". */
export function countWeekAgo(history: ReviewPoint[] | null | undefined, now = new Date()): number | null {
  const list = (history ?? []).filter((h) => h.count != null).sort((a, b) => a.at.localeCompare(b.at));
  if (!list.length) return null;
  const cutoff = now.getTime() - 7 * DAY;
  let best: ReviewPoint | null = null;
  for (const h of list) if (new Date(h.at).getTime() <= cutoff) best = h;
  return (best ?? list[0]).count;
}

const words = (s: string) => new Set(s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'ltd', 'limited', 'shop', 'co', 'uk'].includes(w)));
const hostOf = (u?: string) => { try { return new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/**
 * Picks the Google listing that really is this competitor: the same website if Google has one,
 * otherwise a clear name match. Returns null rather than guess.
 */
export function pickCompetitorPlace(results: PlaceSummary[], comp: { name: string; url?: string }): PlaceSummary | null {
  const h = hostOf(comp.url);
  if (h) {
    const bySite = results.find((r) => r.website && hostOf(r.website) === h);
    if (bySite) return bySite;
  }
  const want = words(comp.name);
  if (!want.size) return null;
  for (const r of results) {
    const got = words(r.name);
    const shared = [...want].filter((w) => got.has(w)).length;
    if (shared / want.size >= 0.6 && !(h && r.website && hostOf(r.website) !== h)) return r;
  }
  return null;
}

/** A careful reply used when AI is unavailable. Never offers incentives or argues. */
export function fallbackReply(r: ReviewItem, business: string, owner: string): string {
  const first = r.author.split(' ')[0];
  if (r.rating >= 4) {
    return `Thank you so much, ${first}. We’re really glad you enjoyed your experience with ${business}, and it means a lot that you took the time to say so. We hope to see you again soon.\n\n${owner}`;
  }
  if (r.rating === 3) {
    return `Thank you for your feedback, ${first}. We’re glad some things went well, and we’d like to do better on the rest. If you’re happy to, please get in touch so we can hear more.\n\n${owner}, ${business}`;
  }
  return `${first}, thank you for letting us know, and I’m sorry this wasn’t the experience we want for every customer. I’d like to put it right. Please contact me directly and I’ll look into it straight away.\n\n${owner}, ${business}`;
}
