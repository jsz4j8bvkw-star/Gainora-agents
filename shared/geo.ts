// Where a business is, and what counts as "nearby". Pure helpers shared by the server and the tests.
//
// Coordinates come, in order of accuracy, from the client's Google listing, their postcode
// (postcodes.io, free and keyless), or the centre of their town (postcodes.io places). Without
// coordinates there is no honest way to say a competitor is "near", so the nearby search waits
// until there are some.

export interface LatLng { lat: number; lng: number }
export type LocationSource = 'listing' | 'postcode' | 'town' | 'google-town';

/** The radius ladder for the nearby search, in km: start tight, widen only when too few are found, never beyond the last. */
export const RADII_KM = [5, 10, 15];
/** Fewer comparable businesses than this at a radius means "widen". */
export const ENOUGH_NEARBY = 5;
/** The hard limit: nothing further than this is ever called a competitor "nearby". */
export const MAX_NEARBY_KM = RADII_KM[RADII_KM.length - 1];

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const OUTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\b/i;

/** A full UK postcode found in free text, normalised ("CW1 2AB"), or ''. */
export function extractPostcode(text: string | null | undefined): string {
  const m = String(text || '').toUpperCase().match(POSTCODE);
  return m ? `${m[1]} ${m[2]}` : '';
}

/** The outward part of a UK postcode ("CW1") found in free text, when there is no full postcode. */
export function extractOutcode(text: string | null | undefined): string {
  const full = extractPostcode(text);
  if (full) return full.split(' ')[0];
  const parts = String(text || '').toUpperCase().split(/[,\s]+/);
  const hit = parts.find((p) => OUTCODE.test(p) && /\d/.test(p) && p.length <= 4 && !/^\d+$/.test(p));
  return hit ?? '';
}

/** The town from a "Town, County" location string, with any postcode removed. */
export function townOf(location: string | null | undefined): string {
  const pc = extractPostcode(location);
  const cleaned = String(location || '').replace(pc, '').replace(/\s*,\s*,/g, ',');
  return cleaned.split(',')[0].replace(/\b[A-Z]{1,2}\d[A-Z\d]?\b\s*$/i, '').trim();
}

/** postcodes.io /postcodes/{pc} and /outcodes/{code}: { status: 200, result: { latitude, longitude, ... } }. */
export function parsePostcodeResult(json: any): LatLng | null {
  const r = json?.result;
  const lat = Number(r?.latitude); const lng = Number(r?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : null;
}

/**
 * postcodes.io /places?q=: { result: [{ name_1, county_unitary, region, country, latitude, longitude, type, local_type }] }.
 * Picks the populated place whose name matches best; a town beats a hamlet of the same name.
 */
export function parsePlacesResult(json: any, town: string): (LatLng & { name: string; county?: string }) | null {
  const list: any[] = Array.isArray(json?.result) ? json.result : [];
  const want = town.trim().toLowerCase();
  const rank = (p: any) => {
    const name = String(p.name_1 || '').toLowerCase();
    let s = 0;
    if (name === want) s += 10; else if (name.startsWith(want)) s += 5; else if (name.includes(want)) s += 2;
    const lt = String(p.local_type || '').toLowerCase();
    if (/city/.test(lt)) s += 4; else if (/town/.test(lt)) s += 3; else if (/suburban|village/.test(lt)) s += 1;
    if (/england|scotland|wales|northern ireland/i.test(String(p.country || ''))) s += 1;
    return s;
  };
  const best = list.filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))).sort((a, b) => rank(b) - rank(a))[0];
  if (!best || rank(best) < 2) return null;
  return { lat: Number(best.latitude), lng: Number(best.longitude), name: String(best.name_1), county: best.county_unitary || best.region || undefined };
}

/** A bounding rectangle around a point, for APIs that restrict by rectangle rather than circle (Places Text Search). */
export function rectangleAround(center: LatLng, radiusKm: number): { low: LatLng; high: LatLng } {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180) || 1);
  return { low: { lat: center.lat - dLat, lng: center.lng - dLng }, high: { lat: center.lat + dLat, lng: center.lng + dLng } };
}

/** Which rung of the ladder to try next, given how many comparable businesses the last rung found. */
export function nextRadius(currentKm: number | null, foundSoFar: number): number | null {
  if (currentKm == null) return RADII_KM[0];
  if (foundSoFar >= ENOUGH_NEARBY) return null;
  const i = RADII_KM.indexOf(currentKm);
  return i >= 0 && i + 1 < RADII_KM.length ? RADII_KM[i + 1] : null;
}

/** Plain words for how the location was worked out, for the Competitors tab. */
export function locationSourceLabel(s: LocationSource | null | undefined): string {
  switch (s) {
    case 'listing': return 'your Google listing';
    case 'postcode': return 'your postcode';
    case 'town': return 'the centre of your town';
    case 'google-town': return 'the centre of your town';
    default: return 'your location';
  }
}
