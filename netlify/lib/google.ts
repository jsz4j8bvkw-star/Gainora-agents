// Google APIs used by The Watcher: Places API (New) for the client's public listing and reviews,
// nearby competitors and their ratings, and PageSpeed Insights for the weekly speed test.
// One key (GOOGLE_API_KEY) covers both. Every Places call asks for the smallest field mask that
// does the job, because Google bills by the fields requested.
import { env, HttpError, requireEnv } from './core';
import { parsePlace, parseSearch, type PlaceSummary, type ReviewItem } from '../../shared/reviews';
import { parsePageSpeed, type SpeedState } from '../../shared/speed';
import { rectangleAround, type LatLng } from '../../shared/geo';

const PLACES = 'https://places.googleapis.com/v1';
const PAGESPEED = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

export const googleConfigured = () => Boolean(env('GOOGLE_API_KEY'));

async function places(path: string, fields: string, body?: unknown): Promise<any> {
  requireEnv('GOOGLE_API_KEY');
  const res = await fetch(`${PLACES}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Goog-Api-Key': env('GOOGLE_API_KEY'), 'X-Goog-FieldMask': fields, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error('[gainora] places', res.status, path.split('?')[0], (await res.text().catch(() => '')).slice(0, 300));
    if (res.status === 404 || res.status === 400) throw new HttpError(404, 'Google couldn’t find that listing. Search again and pick it from the list.');
    throw new HttpError(502, 'Google didn’t answer. Try again in a minute.');
  }
  return res.json();
}

export interface SearchOpts {
  pageSize?: number;
  withWebsite?: boolean;
  withLocation?: boolean;
  /** Prefer results near a point (a circle in metres). A preference only: far results can still come back. */
  near?: { lat: number; lng: number; radiusM: number };
  /** Only results inside this area (Text Search restricts by rectangle, so a circle becomes its bounding box), closest first. */
  within?: { center: LatLng; radiusKm: number };
  /** Also ask for Google's main type and whether the place is still open (for the competitor search). */
  withType?: boolean;
}

const SEARCH_FIELDS = (opts: SearchOpts) => ['places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount',
  ...(opts.withWebsite ? ['places.websiteUri'] : []), ...(opts.withLocation ? ['places.location'] : []), ...(opts.withType ? ['places.primaryType', 'places.businessStatus'] : [])].join(',');

/** Text Search: listings that match a query, with rating and review count (and website, coordinates on request). */
export async function searchPlaces(query: string, opts: SearchOpts = {}): Promise<PlaceSummary[]> {
  const size = Math.min(20, opts.pageSize ?? 5);
  const body: any = { textQuery: query.slice(0, 200), regionCode: 'GB', languageCode: 'en-GB', pageSize: size };
  if (opts.within) {
    const r = rectangleAround(opts.within.center, opts.within.radiusKm);
    body.locationRestriction = { rectangle: { low: { latitude: r.low.lat, longitude: r.low.lng }, high: { latitude: r.high.lat, longitude: r.high.lng } } };
    body.rankPreference = 'DISTANCE';
  } else if (opts.near) body.locationBias = { circle: { center: { latitude: opts.near.lat, longitude: opts.near.lng }, radius: Math.min(50_000, Math.max(500, opts.near.radiusM)) } };
  const json = await places('places:searchText', SEARCH_FIELDS(opts), body);
  return parseSearch(json, size);
}

/**
 * Nearby Search (New): every listing of the given types inside a circle, closest first. This is
 * how businesses with no website are found: nearly every salon and clinic has a Google listing.
 * One request, up to 20 results, smallest useful field mask.
 */
export async function searchNearby(center: LatLng, radiusKm: number, includedTypes: string[], max = 20): Promise<PlaceSummary[]> {
  const body = {
    includedTypes: includedTypes.slice(0, 50), maxResultCount: Math.min(20, Math.max(1, max)), rankPreference: 'DISTANCE', languageCode: 'en-GB', regionCode: 'GB',
    locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50_000, Math.max(500, Math.round(radiusKm * 1000))) } },
  };
  const json = await places('places:searchNearby', SEARCH_FIELDS({ withWebsite: true, withLocation: true, withType: true }), body);
  return parseSearch(json, 20);
}

/** Place Details: rating, review count and the (up to five) reviews Google shares. */
export async function placeDetails(id: string, withReviews = true): Promise<{ name: string; rating: number | null; count: number | null; reviews: ReviewItem[] }> {
  if (!/^[\w-]{10,300}$/.test(id)) throw new HttpError(400, 'That Google listing is not valid.');
  const fields = withReviews ? 'id,displayName,rating,userRatingCount,reviews' : 'id,displayName,rating,userRatingCount';
  const json = await places(`places/${id}?languageCode=en-GB&regionCode=GB`, fields);
  return { name: String(json?.displayName?.text || ''), ...parsePlace(json) };
}

/** Place Details with the smallest mask for a competitor: just the rating and review count. */
export async function placeRating(id: string): Promise<{ rating: number | null; count: number | null }> {
  if (!/^[\w-]{10,300}$/.test(id)) throw new HttpError(400, 'That Google listing is not valid.');
  const json = await places(`places/${id}`, 'id,rating,userRatingCount');
  const { rating, count } = parsePlace(json);
  return { rating, count };
}

/** Where a listing is, for finding businesses around it. */
export async function placeLocation(id: string): Promise<{ lat: number; lng: number } | null> {
  if (!/^[\w-]{10,300}$/.test(id)) throw new HttpError(400, 'That Google listing is not valid.');
  const json = await places(`places/${id}`, 'id,location');
  const lat = json?.location?.latitude; const lng = json?.location?.longitude;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

/** Google's own speed and quality test, as a phone visitor would see the page. */
export async function pageSpeed(url: string): Promise<SpeedState> {
  const q = new URLSearchParams({ url, strategy: 'MOBILE', locale: 'en-GB' });
  for (const c of ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO']) q.append('category', c);
  if (env('GOOGLE_API_KEY')) q.set('key', env('GOOGLE_API_KEY'));
  const res = await fetch(`${PAGESPEED}?${q}`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    console.error('[gainora] pagespeed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    throw new Error(`PageSpeed ${res.status}`);
  }
  return parsePageSpeed(await res.json());
}
