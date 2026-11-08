// Where the client is. postcodes.io is a free, keyless, public API for UK postcodes and place
// names (https://postcodes.io). One or two small GET requests, once per client, cached in the
// Watcher's state. No Google call is spent unless the client has a listing (placeLocation) or
// postcodes.io knows nothing about the place.
import { extractOutcode, extractPostcode, parsePlacesResult, parsePostcodeResult, townOf, type LatLng, type LocationSource } from '../../shared/geo';

const BASE = 'https://api.postcodes.io';

async function getJson(url: string, timeoutMs = 8_000): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export interface Geocoded extends LatLng { source: LocationSource; label: string }

/**
 * Coordinates for a client from their postcode (best), the outward code, or the centre of their
 * town. `location` is the free-text "Where you're based" answer; `postcode` the optional postcode
 * answer. Returns null when nothing matched, and never throws.
 */
export async function geocodeClient(location: string, postcode?: string | null): Promise<Geocoded | null> {
  try {
    const pc = extractPostcode(postcode) || extractPostcode(location);
    if (pc) {
      const hit = parsePostcodeResult(await getJson(`${BASE}/postcodes/${encodeURIComponent(pc)}`));
      if (hit) return { ...hit, source: 'postcode', label: pc };
    }
    const outcode = extractOutcode(postcode) || extractOutcode(location);
    if (outcode && /\d/.test(outcode)) {
      const hit = parsePostcodeResult(await getJson(`${BASE}/outcodes/${encodeURIComponent(outcode)}`));
      if (hit) return { ...hit, source: 'postcode', label: outcode };
    }
    const town = townOf(location);
    if (town.length >= 2) {
      const hit = parsePlacesResult(await getJson(`${BASE}/places?q=${encodeURIComponent(town)}&limit=8`), town);
      if (hit) return { lat: hit.lat, lng: hit.lng, source: 'town', label: hit.county ? `${hit.name}, ${hit.county}` : hit.name };
    }
  } catch (e: any) { console.error('[gainora] geocode', e?.message); }
  return null;
}
