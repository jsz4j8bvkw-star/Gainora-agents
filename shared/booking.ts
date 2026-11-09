// Reading public booking pages without a browser or a login. Pure parsing; the fetch lives in
// netlify/lib. Three readers, in order of how much they give:
//
// 1. Fresha venue pages (fresha.com/a/<slug>, also /en-GB/a/...) are server-rendered Next.js and
//    carry a <script id="__NEXT_DATA__"> with the venue: every service with its exact price and
//    duration, the team (employeeProfiles), rating and review count. A page shows about a dozen
//    services per category, so when serviceCount is higher the read is marked partial.
//    /lvp/ pages are unclaimed listings with no prices.
// 2. schema.org JSON-LD: many booking pages and websites publish an OfferCatalog of Offers and an
//    aggregateRating. Read generically.
// 3. Detection of pages that only render with JavaScript (Phorest, Pabau and friends): a plain
//    fetch gets an empty shell, so the app says so and asks the owner to paste their prices
//    rather than pretending it read nothing.
//
// Everything a reader returns is literally in the page source, so the verbatim rule holds.

import { decodeEntities, visibleText } from './pages';
import { priceValue } from './prices';
import { hostOf } from './competitors';

export interface BookingService { name: string; price: string; duration?: string; category?: string }
export interface VenueStats {
  platform: string;           // "Fresha", "Treatwell", "Booksy", "schema.org"...
  url: string;
  name?: string;
  rating: number | null;
  reviews: number | null;
  team: number | null;        // staff profiles shown on the page
  serviceCount: number | null;
  priceRange?: string;
  address?: string;
  phone?: string;
  checkedAt: string;
  partial?: boolean;          // more services exist than the public page lists
  unclaimed?: boolean;        // a listing the business has not claimed (no prices)
}
export interface BookingRead { services: BookingService[]; venue: VenueStats | null; text: string; jsRendered: boolean; platform: string }

const PLATFORM_HOSTS: [RegExp, string][] = [
  [/fresha\.com$/, 'Fresha'], [/treatwell\./, 'Treatwell'], [/booksy\.com$/, 'Booksy'], [/phorest\.(me|com)$/, 'Phorest'], [/pabau\.(com|me)$/, 'Pabau'],
  [/gettimely\.com$/, 'Timely'], [/setmore\.com$/, 'Setmore'], [/square(up\.com|\.site)$/, 'Square'], [/vagaro\.com$/, 'Vagaro'], [/ovatu\.com$/, 'Ovatu'],
  [/mindbodyonline\.com$/, 'Mindbody'], [/acuityscheduling\.com$/, 'Acuity'], [/simplybook\.(it|me)$/, 'SimplyBook'], [/salonized\.com$/, 'Salonized'], [/bookwhen\.com$/, 'Bookwhen'],
];
/** Booking systems whose public pages are JavaScript apps: the HTML holds no prices. */
export const JS_ONLY_PLATFORMS = new Set(['Phorest', 'Pabau', 'Timely', 'Mindbody', 'Vagaro', 'Setmore', 'Acuity']);

export const platformOf = (url: string): string => {
  const h = hostOf(url);
  const hit = PLATFORM_HOSTS.find(([re]) => re.test(h));
  return hit ? hit[1] : '';
};

/** Booking systems the owner can pick from, with how the Watcher can read each one. */
export const BOOKING_SYSTEMS: { id: string; label: string; readable: 'yes' | 'partly' | 'no'; note: string }[] = [
  { id: 'Fresha', label: 'Fresha', readable: 'yes', note: 'Your public Fresha page lists every treatment and price, so the Watcher can read them all.' },
  { id: 'Treatwell', label: 'Treatwell', readable: 'partly', note: 'The Watcher reads the prices shown on your public Treatwell page.' },
  { id: 'Booksy', label: 'Booksy', readable: 'partly', note: 'The Watcher reads the prices shown on your public Booksy page.' },
  { id: 'Phorest', label: 'Phorest', readable: 'no', note: 'Phorest’s online booking only shows prices once a browser runs it, so the Watcher can’t read it. Paste your price list below instead.' },
  { id: 'Pabau', label: 'Pabau', readable: 'no', note: 'Pabau’s booking pages only show prices once a browser runs them, so the Watcher can’t read them. Paste your price list below instead.' },
  { id: 'Timely', label: 'Timely', readable: 'no', note: 'Timely’s booking page needs a browser to show prices. Paste your price list below instead.' },
  { id: 'Other', label: 'Another system', readable: 'partly', note: 'The Watcher tries the link you give; if the page needs a browser to show prices, paste them below.' },
  { id: 'None', label: 'None, or by phone and messages', readable: 'partly', note: 'No problem. Paste or type your price list below and the Watcher compares it with the clinics nearby.' },
];

/* ---------- Fresha: __NEXT_DATA__ ---------- */
function nextData(html: string): any | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Finds the venue object anywhere in the Next.js props: the first object with a services array and a name. */
function findVenue(root: any, depth = 0): any | null {
  if (!root || typeof root !== 'object' || depth > 8) return null;
  if (Array.isArray(root.services) && typeof root.name === 'string' && (root.employeeProfiles !== undefined || root.serviceCount !== undefined || root.rating !== undefined || root.reviewsCount !== undefined || root.services.length)) return root;
  for (const k of Object.keys(root)) {
    const v = root[k];
    if (v && typeof v === 'object') { const hit = findVenue(v, depth + 1); if (hit) return hit; }
  }
  return null;
}

const num = (v: any): number | null => { const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : Number(v); return Number.isFinite(n) ? n : null; };

function freshaPrice(item: any): string | null {
  const formatted = typeof item?.formattedRetailPrice === 'string' ? item.formattedRetailPrice.trim() : '';
  const raw = num(item?.retailPrice);
  if (/free/i.test(formatted) || (raw != null && raw <= 0 && !/£\s?\d/.test(formatted))) return null;
  let text = formatted && /£\s?\d/.test(formatted) ? formatted : raw != null && raw > 0 ? `£${raw % 1 ? raw.toFixed(2) : raw}` : '';
  if (!text) return null;
  text = text.replace(/\s+/g, ' ');
  const from = /from/i.test(formatted) || /from|starting|variable/i.test(String(item?.priceType || ''));
  if (from && !/^from/i.test(text)) text = `from ${text.replace(/^from\s*/i, '')}`;
  return text;
}

/** Fresha's venue page as structured data: services, team size, rating, reviews. Null when the page is not a Fresha venue page. */
export function parseFresha(html: string, url: string, at = new Date()): { services: BookingService[]; venue: VenueStats } | null {
  const data = nextData(html);
  if (!data) return null;
  const v = findVenue(data?.props?.pageProps) ?? findVenue(data);
  if (!v) return null;
  const services: BookingService[] = [];
  const seen = new Set<string>();
  const push = (name: string, price: string | null, duration?: string, category?: string) => {
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!n || !price) return;
    const id = `${n.toLowerCase()}|${price}`;
    if (seen.has(id)) return; seen.add(id);
    services.push({ name: n, price, ...(duration ? { duration: String(duration).slice(0, 40) } : {}), ...(category ? { category: String(category).slice(0, 60) } : {}) });
  };
  let shown = 0;
  for (const cat of v.services) {
    const items: any[] = Array.isArray(cat?.items) ? cat.items : Array.isArray(cat?.services) ? cat.services : [];
    for (const item of items) {
      shown++;
      const variants: any[] = Array.isArray(item?.variants) ? item.variants.filter((x: any) => x && (x.formattedRetailPrice || x.retailPrice != null)) : [];
      if (variants.length > 1 || (variants.length === 1 && variants[0].name && variants[0].name !== item.name)) {
        for (const va of variants) push(`${item.name}${va.name ? ` – ${va.name}` : ''}`, freshaPrice(va), va.caption || va.duration, cat?.name);
      } else push(item.name, freshaPrice(variants[0] ?? item), item.caption || item.duration, cat?.name);
    }
  }
  const total = num(v.serviceCount);
  const team = Array.isArray(v.employeeProfiles) ? v.employeeProfiles.length : Array.isArray(v.employees) ? v.employees.length : num(v.employeeCount);
  const venue: VenueStats = {
    platform: 'Fresha', url, name: String(v.name || '').slice(0, 120), rating: num(v.rating), reviews: num(v.reviewsCount ?? v.reviewsTotal ?? v.reviewCount),
    team: team ?? null, serviceCount: total ?? (shown || null), checkedAt: at.toISOString(),
    ...(typeof v.servicePriceRange === 'string' ? { priceRange: v.servicePriceRange } : {}),
    ...(v.address ? { address: String(typeof v.address === 'string' ? v.address : v.address.formatted || v.address.line1 || '').slice(0, 160) } : {}),
    ...(v.contactNumber ? { phone: String(v.contactNumber).slice(0, 30) } : {}),
    ...(total != null && shown < total ? { partial: true } : {}),
    ...(/\/lvp\//.test(url) && !services.length ? { unclaimed: true } : {}),
  };
  return { services, venue };
}

/* ---------- schema.org JSON-LD ---------- */
function jsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { const j = JSON.parse(decodeEntities(m[1]).trim()); out.push(...(Array.isArray(j) ? j : j?.['@graph'] ? j['@graph'] : [j])); } catch { /* skip broken blocks */ }
  }
  return out;
}
const BUSINESS_TYPES = /business|salon|clinic|spa|store|organization|dentist|physician|medical|beauty|hair|nail|service/i;

/** Offers and ratings a page publishes as schema.org data. Works for Fresha and any site that marks up its price list. */
export function parseJsonLd(html: string, url: string, at = new Date()): { services: BookingService[]; venue: VenueStats | null } {
  const nodes = jsonLdBlocks(html);
  const services: BookingService[] = []; const seen = new Set<string>();
  let venue: VenueStats | null = null;
  const addOffer = (o: any) => {
    const name = String(o?.itemOffered?.name || o?.name || '').replace(/\s+/g, ' ').trim();
    const p = o?.price ?? o?.priceSpecification?.price ?? o?.priceSpecification?.minPrice;
    const cur = String(o?.priceCurrency || o?.priceSpecification?.priceCurrency || 'GBP');
    const v = num(p);
    if (!name || v == null || v <= 0 || !/GBP|£/i.test(cur)) return;
    const from = o?.priceSpecification?.minPrice != null && o?.priceSpecification?.price == null;
    const price = `${from ? 'from ' : ''}£${v % 1 ? v.toFixed(2) : v}`;
    const id = `${name.toLowerCase()}|${price}`;
    if (seen.has(id)) return; seen.add(id);
    services.push({ name: name.slice(0, 100), price });
  };
  const walkCatalog = (c: any, depth = 0) => {
    if (!c || depth > 4) return;
    const items: any[] = Array.isArray(c.itemListElement) ? c.itemListElement : Array.isArray(c) ? c : [];
    for (const it of items) {
      const t = String(it?.['@type'] || '');
      if (/OfferCatalog/i.test(t)) walkCatalog(it, depth + 1);
      else if (/Offer/i.test(t) || it?.price != null || it?.priceSpecification) addOffer(it);
      else if (it?.item) addOffer(it.item);
    }
  };
  for (const n of nodes) {
    const t = Array.isArray(n?.['@type']) ? n['@type'].join(' ') : String(n?.['@type'] || '');
    if (n?.hasOfferCatalog) walkCatalog(n.hasOfferCatalog);
    if (Array.isArray(n?.makesOffer)) for (const o of n.makesOffer) addOffer(o);
    if (/^Offer$/i.test(t)) addOffer(n);
    if (BUSINESS_TYPES.test(t) && (n.aggregateRating || n.name) && !venue) {
      const ar = n.aggregateRating;
      venue = { platform: platformOf(url) || 'schema.org', url, name: String(n.name || '').slice(0, 120), rating: num(ar?.ratingValue), reviews: num(ar?.reviewCount ?? ar?.ratingCount), team: Array.isArray(n.employee) ? n.employee.length : null, serviceCount: null, checkedAt: at.toISOString(), ...(typeof n.priceRange === 'string' ? { priceRange: n.priceRange } : {}), ...(typeof n.telephone === 'string' ? { phone: n.telephone.slice(0, 30) } : {}) };
    }
  }
  if (venue && !(venue as VenueStats).serviceCount && services.length) (venue as VenueStats).serviceCount = services.length;
  return { services, venue };
}

/* ---------- JavaScript-only pages ---------- */
/** True when the page is an app shell: the booking platform is known to need a browser, or there is almost no visible text and no price. */
export function looksJsRendered(html: string, url: string): boolean {
  const platform = platformOf(url);
  if (JS_ONLY_PLATFORMS.has(platform)) return true;
  const text = visibleText(html);
  return text.replace(/\s+/g, ' ').length < 240 && !/£\s?\d/.test(text) && /<script/i.test(html);
}

/* ---------- One call for any booking page ---------- */
/** Reads a public booking page with the best reader available, and says plainly when it can’t. */
export function readBookingPage(html: string, url: string, at = new Date()): BookingRead {
  const platform = platformOf(url);
  const fresha = /fresha\.com$/.test(hostOf(url)) ? parseFresha(html, url, at) : null;
  if (fresha) return { services: fresha.services, venue: fresha.venue, text: asText(fresha.services), jsRendered: false, platform: 'Fresha' };
  const ld = parseJsonLd(html, url, at);
  if (ld.services.length) return { services: ld.services, venue: ld.venue, text: asText(ld.services), jsRendered: false, platform: platform || 'schema.org' };
  if (looksJsRendered(html, url)) return { services: [], venue: ld.venue, text: '', jsRendered: true, platform };
  return { services: [], venue: ld.venue, text: visibleText(html), jsRendered: false, platform };
}

/** The structured services as page text, one per line, so the verbatim checks see exactly what was read. */
export function asText(services: BookingService[]): string {
  return services.map((s) => `${s.name}${s.duration ? ` (${s.duration})` : ''} ${s.price}`).join('\n');
}

/* ---------- The owner's own price list, typed or pasted ---------- */
/**
 * "Lip filler 1ml £220", "Anti-wrinkle – 2 areas: from £200", "Dermaplaning 45 mins ... £45",
 * one per line, in any of the ways people write them. Lines without a price are skipped.
 */
export function parsePriceList(text: string): BookingService[] {
  const out: BookingService[] = []; const seen = new Set<string>();
  for (const raw of String(text || '').split(/\r?\n|;/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const m = line.match(/(from\s*)?£\s?(\d{1,4}(?:[.,]\d{1,2})?)(?!\d)/i);
    if (!m || m.index == null) continue;
    const at = m.index;
    const v = priceValue(m[2].replace(',', '.'));
    if (v == null || v <= 0) continue;
    const from = !!m[1] || /\bfrom\b/i.test(line.slice(0, at));
    let name = (line.slice(0, at) + ' ' + line.slice(at + m[0].length)).replace(/\bfrom\b\s*$/i, '').replace(/[\s:–—\-·|,.]+$/g, '').replace(/^[\s:–—\-·|,.]+/g, '').replace(/\s+/g, ' ').trim();
    const dur = name.match(/\(?\b(\d{1,3})\s?(mins?|minutes?|hrs?|hours?)\b\)?/i);
    const duration = dur ? dur[0].replace(/[()]/g, '') : undefined;
    if (dur) name = name.replace(dur[0], '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').replace(/[\s:–—\-·|,]+$/g, '').trim();
    if (!name) continue;
    const price = `${from ? 'from ' : ''}£${v % 1 ? v.toFixed(2) : v}`;
    const id = `${name.toLowerCase()}|${price}`;
    if (seen.has(id)) continue; seen.add(id);
    out.push({ name: name.slice(0, 100), price, ...(duration ? { duration } : {}) });
    if (out.length >= 120) break;
  }
  return out;
}
