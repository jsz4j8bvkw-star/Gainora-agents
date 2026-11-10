// Reading services and prices from public booking pages without the AI, where the page carries
// them as structured data:
// - Fresha venue pages (fresha.com/a/<slug>, /en-GB/a/..., and /lvp/... listings the business
//   hasn't claimed) are server-rendered; the data sits in <script id="__NEXT_DATA__"> under
//   props.pageProps.data.location, and a JSON-LD @graph carries the rating and an offer catalogue.
// - Any other page with schema.org JSON-LD (Offer, OfferCatalog, Service, priceSpecification).
// Everything else goes to the AI extraction with its word-for-word checks. Pages whose prices only
// appear inside a JavaScript booking app (Phorest, Pabau and others) are detected and the owner is
// told plainly. Parsing is defensive: either source may be missing or shaped differently, and every
// list is capped. Pure logic, no network.

import { hostOf } from './competitors';

export interface ReadService { name: string; price: string; category?: string; duration?: string }
export interface BookingRead {
  url: string;
  platform: string;
  via: 'fresha' | 'schema';
  name: string | null;
  rating: number | null;
  reviews: number | null;
  services: ReadService[];
  /** How many services the page says the business has (Fresha shows only part of the list publicly). */
  serviceCount: number | null;
  partial: boolean;
  /** A Fresha listing the business hasn't claimed: no prices. */
  unclaimed?: boolean;
}

const MAX_SERVICES = 300;
const MAX_JSON = 3_000_000;

const num = (v: any): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
const str = (v: any, max = 120): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

/** "£40", "from £40", "£1,250.00" → a clean display price, or null when it isn't a pound price. */
export function cleanPrice(raw: any, from = false): string | null {
  const s = typeof raw === 'number' ? `£${raw}` : str(raw, 40);
  const m = s.replace(/,/g, '').match(/£\s?(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v < 0 || v > 20_000) return null;
  const isFrom = from || /\bfrom\b/i.test(s);
  return `${isFrom ? 'from ' : ''}£${v % 1 ? v.toFixed(2) : v}`;
}

/* ---------- Platforms ---------- */
export const isFresha = (url: string) => /(^|\.)fresha\.com$/.test(hostOf(url));
export const freshaUnclaimed = (url: string) => isFresha(url) && /\/lvp\//.test((() => { try { return new URL(url).pathname; } catch { return ''; } })());

/** Booking apps whose public pages show prices only once their JavaScript runs, so a plain read gets none. */
const APP_ONLY: Record<string, string> = {
  'phorest.com': 'Phorest', 'phorest.me': 'Phorest', 'pabau.com': 'Pabau', 'pabau.me': 'Pabau', 'gettimely.com': 'Timely', 'setmore.com': 'Setmore',
  'squareup.com': 'Square', 'square.site': 'Square', 'mindbodyonline.com': 'Mindbody', 'acuityscheduling.com': 'Acuity', 'simplybook.it': 'SimplyBook', 'simplybook.me': 'SimplyBook',
  'vagaro.com': 'Vagaro', 'salonized.com': 'Salonized', 'ovatu.com': 'Ovatu', 'bookedin.com': 'Bookedin', 'timify.com': 'Timify', 'janeapp.com': 'Jane', 'cliniko.com': 'Cliniko', 'zenoti.com': 'Zenoti',
};
export function appOnlyPlatform(url: string): string | null {
  const h = hostOf(url);
  const hit = Object.keys(APP_ONLY).find((k) => h === k || h.endsWith('.' + k));
  return hit ? APP_ONLY[hit] : null;
}

/** What to tell the owner when a booking page gave no prices. Plain words, never a silent failure. */
export function noPricesNote(url: string, platform?: string | null): string {
  if (freshaUnclaimed(url)) return 'This Fresha listing hasn’t been set up by the business, so it shows no prices.';
  const app = appOnlyPlatform(url);
  if (app) return `${app} pages only show prices inside the booking app, so the Watcher can’t read them from the public page. Paste the price list instead.`;
  return `No prices could be read from this ${platform && platform !== hostOf(url) ? `${platform} ` : ''}page. If it shows prices only after you click through, paste the price list instead.`;
}

/* ---------- JSON helpers ---------- */
function nextData(html: string): any | null {
  const m = String(html || '').match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m || m[1].length > MAX_JSON) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function jsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null; let n = 0;
  while ((m = re.exec(String(html || ''))) && n++ < 12) {
    if (m[1].length > 600_000) continue;
    try { const j = JSON.parse(m[1].trim()); out.push(...(Array.isArray(j) ? j : [j])); } catch { /* skip broken blocks */ }
  }
  // Flatten @graph containers.
  return out.flatMap((j) => (j && Array.isArray(j['@graph']) ? j['@graph'] : [j])).filter((j) => j && typeof j === 'object');
}

const types = (n: any): string[] => (Array.isArray(n?.['@type']) ? n['@type'] : [n?.['@type']]).filter((t: any) => typeof t === 'string');
const BUSINESS = /Business|Salon|Spa|Clinic|Store|Organization|Place|Physician|Dentist|HealthClub|DaySpa|BeautySalon|NailSalon|HairSalon|MedicalBusiness/;

/** Finds the Fresha location object even if it moves a level or two. */
function freshaLocation(data: any): any | null {
  const direct = data?.props?.pageProps?.data?.location ?? data?.props?.pageProps?.location;
  if (direct && typeof direct === 'object') return direct;
  let found: any = null;
  const walk = (o: any, depth: number) => {
    if (found || !o || typeof o !== 'object' || depth > 7) return;
    if (Array.isArray(o.services) && o.services.some((c: any) => Array.isArray(c?.items))) { found = o; return; }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(data?.props ?? data, 0);
  return found;
}

/* ---------- Fresha ---------- */
export function readFresha(html: string, url: string): BookingRead | null {
  if (!isFresha(url)) return null;
  const loc = freshaLocation(nextData(html));
  const ld = readSchemaOrg(html, url);
  const unclaimed = freshaUnclaimed(url) || loc?.isClaimed === false;
  const services: ReadService[] = [];
  let items = 0;
  for (const cat of Array.isArray(loc?.services) ? loc.services.slice(0, 60) : []) {
    const category = str(cat?.name, 80);
    for (const it of Array.isArray(cat?.items) ? cat.items.slice(0, 80) : []) {
      const name = str(it?.name, 100);
      if (!name) continue;
      items++;
      const fromType = /from/i.test(String(it?.priceType ?? ''));
      const variants = Array.isArray(it?.variants) ? it.variants.slice(0, 12) : [];
      const priced = variants.map((v: any) => ({ v, price: cleanPrice(v?.formattedRetailPrice, /from/i.test(String(v?.priceType ?? ''))) })).filter((x: any) => x.price && str(x.v?.name));
      if (priced.length > 1 || (priced.length === 1 && str(priced[0].v.name).toLowerCase() !== name.toLowerCase())) {
        for (const { v, price } of priced) services.push({ name: `${name} – ${str(v.name, 60)}`, price: price!, ...(category ? { category } : {}), ...(str(v?.caption) ? { duration: str(v.caption, 60) } : {}) });
      } else {
        const price = cleanPrice(it?.formattedRetailPrice, fromType) ?? (priced[0]?.price ?? null);
        if (price) services.push({ name, price, ...(category ? { category } : {}), ...(str(it?.caption) ? { duration: str(it.caption, 60) } : {}) });
      }
      if (services.length >= MAX_SERVICES) break;
    }
    if (services.length >= MAX_SERVICES) break;
  }
  // Fall back to the JSON-LD offer catalogue when the page data is missing.
  const list = services.length ? services : ld?.services ?? [];
  const serviceCount = num(loc?.serviceCount) ?? (services.length ? items : null);
  const rating = num(loc?.rating) ?? num(loc?.ratingV2?.rating) ?? num(loc?.ratingV2?.value) ?? num(loc?.ratingV2?.average) ?? ld?.rating ?? null;
  const reviews = num(loc?.reviewsCount) ?? num(loc?.reviewsTotal) ?? num(loc?.ratingV2?.count) ?? num(loc?.ratingV2?.reviewsCount) ?? ld?.reviews ?? null;
  if (!loc && !ld) return unclaimed ? { url, platform: 'Fresha', via: 'fresha', name: null, rating: null, reviews: null, services: [], serviceCount: null, partial: false, unclaimed: true } : null;
  const read = services.length ? items : list.length;
  return {
    url, platform: 'Fresha', via: 'fresha', name: str(loc?.name) || ld?.name || null,
    rating: rating != null && rating >= 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    reviews: reviews != null && reviews >= 0 ? Math.round(reviews) : null,
    services: list, serviceCount, partial: serviceCount != null && serviceCount > read, ...(unclaimed ? { unclaimed: true } : {}),
  };
}

/* ---------- Any page with schema.org data ---------- */
export function readSchemaOrg(html: string, url: string): BookingRead | null {
  const nodes = jsonLd(html);
  if (!nodes.length) return null;
  const services: ReadService[] = [];
  let rating: number | null = null; let reviews: number | null = null; let name: string | null = null;
  const seen = new Set<string>();
  const add = (n: string, offer: any, category?: string) => {
    if (!n || services.length >= MAX_SERVICES) return;
    const spec = Array.isArray(offer?.priceSpecification) ? offer.priceSpecification[0] : offer?.priceSpecification;
    const cur = String(offer?.priceCurrency ?? spec?.priceCurrency ?? 'GBP').toUpperCase();
    if (cur !== 'GBP') return;
    const exact = num(offer?.price) ?? num(spec?.price);
    const low = num(offer?.lowPrice) ?? num(spec?.minPrice);
    const price = exact != null ? cleanPrice(exact) : low != null ? cleanPrice(low, true) : null;
    if (!price) return;
    const id = `${n.toLowerCase()}|${price}`;
    if (seen.has(id)) return;
    seen.add(id);
    services.push({ name: n, price, ...(category ? { category } : {}) });
  };
  const walk = (o: any, depth: number, category?: string) => {
    if (!o || typeof o !== 'object' || depth > 8 || services.length >= MAX_SERVICES) return;
    if (Array.isArray(o)) { for (const x of o.slice(0, 400)) walk(x, depth + 1, category); return; }
    const t = types(o);
    if (t.some((x) => BUSINESS.test(x)) && o.aggregateRating) {
      rating ??= num(o.aggregateRating.ratingValue);
      reviews ??= num(o.aggregateRating.reviewCount) ?? num(o.aggregateRating.ratingCount);
      name ??= str(o.name) || null;
    }
    if (t.includes('Offer') || t.includes('AggregateOffer')) {
      const item = o.itemOffered ?? {};
      add(decode(str(item.name) || str(o.name)), o, category);
      return;
    }
    if ((t.includes('Service') || t.includes('Product')) && o.offers) {
      const offers = Array.isArray(o.offers) ? o.offers : [o.offers];
      for (const of of offers.slice(0, 10)) add(decode(str(o.name)), of, category);
      return;
    }
    const cat = t.includes('OfferCatalog') ? decode(str(o.name)) || category : category;
    for (const k of ['hasOfferCatalog', 'itemListElement', 'makesOffer', 'offers', 'mainEntity', 'item', 'hasPart']) if (o[k]) walk(o[k], depth + 1, cat);
  };
  for (const n of nodes) walk(n, 0);
  if (!services.length && rating == null) return null;
  return {
    url, platform: platformName(url), via: 'schema', name,
    rating: rating != null && rating >= 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    reviews: reviews != null && reviews >= 0 ? Math.round(reviews) : null,
    services, serviceCount: null, partial: false,
  };
}

const NAMES: Record<string, string> = { 'fresha.com': 'Fresha', 'treatwell.co.uk': 'Treatwell', 'treatwell.com': 'Treatwell', 'booksy.com': 'Booksy' };
const platformName = (url: string) => {
  const h = hostOf(url);
  const k = Object.keys(NAMES).find((x) => h === x || h.endsWith('.' + x));
  return k ? NAMES[k] : appOnlyPlatform(url) ?? h;
};

/** Structured reading of one page: Fresha's own data first, then schema.org. Null when neither has anything. */
export function readStructured(html: string, url: string): BookingRead | null {
  return readFresha(html, url) ?? readSchemaOrg(html, url);
}

/** Booking systems the owner can pick in the questionnaire. */
export const BOOKING_SYSTEMS = ['Fresha', 'Phorest', 'Pabau', 'Booksy', 'Treatwell', 'Timely', 'Other', 'None / phone only'];

/** What the questionnaire says about each system: whether the Watcher can read prices from its public page. */
export function systemHelp(system: string): string {
  switch (system) {
    case 'Fresha': return 'Fresha pages are public, so the Watcher can read your treatments and prices from your link (it looks like fresha.com/a/your-clinic). Fresha only shows part of a long menu publicly, so check the list below.';
    case 'Booksy': case 'Treatwell': return `${system} pages usually show prices publicly, so the Watcher reads them from your link. Check the list below.`;
    case 'Phorest': case 'Pabau': case 'Timely': return `${system} pages only show prices inside the booking app, so the Watcher can’t read them. Paste your price list below instead; it takes a minute.`;
    case 'None / phone only': return 'No problem. Add your main treatments and prices below, or paste your price list, so the Watcher can compare them.';
    case 'Other': return 'Add the link if customers can book online. If the page doesn’t show prices, paste your price list below.';
    default: return '';
  }
}
