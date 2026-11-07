// Google APIs used by The Watcher: Places API (New) for the client's public listing and reviews,
// and PageSpeed Insights for the weekly speed test. One key (GOOGLE_API_KEY) covers both.
import { env, HttpError, requireEnv } from './core';
import { parsePlace, parseSearch, type PlaceSummary, type ReviewItem } from '../../shared/reviews';
import { parsePageSpeed, type SpeedState } from '../../shared/speed';

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

/** Text Search: listings that match a name and town, with rating and review count. */
export async function searchPlaces(query: string, opts: { pageSize?: number; withWebsite?: boolean } = {}): Promise<PlaceSummary[]> {
  const fields = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount', ...(opts.withWebsite ? ['places.websiteUri'] : [])].join(',');
  const json = await places('places:searchText', fields, { textQuery: query.slice(0, 200), regionCode: 'GB', languageCode: 'en-GB', pageSize: opts.pageSize ?? 5 });
  return parseSearch(json);
}

/** Place Details: rating, review count and the (up to five) reviews Google shares. */
export async function placeDetails(id: string, withReviews = true): Promise<{ name: string; rating: number | null; count: number | null; reviews: ReviewItem[] }> {
  if (!/^[\w-]{10,300}$/.test(id)) throw new HttpError(400, 'That Google listing is not valid.');
  const fields = withReviews ? 'id,displayName,rating,userRatingCount,reviews' : 'id,displayName,rating,userRatingCount';
  const json = await places(`places/${id}?languageCode=en-GB&regionCode=GB`, fields);
  return { name: String(json?.displayName?.text || ''), ...parsePlace(json) };
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
