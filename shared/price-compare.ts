// The price comparison: the owner's prices against each competitor's, treatment by treatment and
// like for like (same treatment, same amount), with the local average, range and where the owner
// sits. Also the treatments only competitors offer, the ones only the owner prices, and price
// changes per treatment over time. Pure logic, shared by the server (advice, events), the app
// (the Prices view) and the tests. Every price carries the page it was read from and when.

import { priceValue } from './prices';
import { classifyService, GROUP_ORDER, type TreatmentGroup, type TreatmentMatch } from './treatments';
import type { ReachEvent, ServiceLine, TrackedCompetitor } from './competitors';

/** One row of the owner's own price list, as confirmed in the questionnaire or settings. */
export interface OwnPrice { name: string; price: string; source?: 'typed' | 'pasted' | 'booking' | 'website'; url?: string }
export interface BookingProfile { system: string; url: string; prices: OwnPrice[]; pricesAt?: string }

export interface PricePoint {
  who: string;          // business name
  key: string;          // 'you' or the competitor key
  name: string;         // the service name as the business wrote it
  price: string;        // "£180" or "from £180"
  value: number;
  from: boolean;
  url: string;          // where it was read ('' for the owner's own typed list)
  seenAt: string | null;
  source: string;       // "Fresha", "their website", "your price list"
}

export interface CompareRow {
  key: string; label: string; group: TreatmentGroup;
  you: PricePoint;
  theirs: (PricePoint | null)[];   // one per competitor, in `competitors` order
  avg: number; min: number; max: number; count: number; // over competitors' prices
  diff: number;                    // you − average, rounded
  position: string;                // "£30 above the local average"
  rank: string;                    // "cheapest of 6"
  hasFrom: boolean;
}
export interface GapRow { key: string; label: string; group: TreatmentGroup; prices: PricePoint[] }
export interface Comparison {
  competitors: { key: string; name: string }[];
  rows: CompareRow[];
  theyOnly: GapRow[];
  youOnly: GapRow[];
  /** Read and matched to a treatment, but the amount (areas, ml, body area) isn't stated, so not compared. */
  notCompared: { who: string; name: string; price: string; label: string; url: string }[];
  /** How many of the owner's prices came from where. */
  yourSources: Record<string, number>;
}

const isFromPrice = (p: string) => /^\s*from\b/i.test(p);
const money = (v: number) => `£${v % 1 ? v.toFixed(2) : v.toLocaleString('en-GB')}`;
const sourceOf = (s: ServiceLine) => s.platform || (s.via === 'booking' ? 'their booking page' : 'their website');

export interface Priced { point: PricePoint; match: TreatmentMatch | null }

/** Matches a list of services to the catalogue, dropping ignored items (consultations, top-ups) and £0 prices. */
export function classifyAll(items: { name: string; price: string; category?: string; url: string; seenAt: string | null; source: string }[], who: string, key: string, learned?: Record<string, string> | null): Priced[] {
  const out: Priced[] = [];
  for (const it of items) {
    const value = priceValue(it.price);
    if (value == null || value <= 0) continue;
    const c = classifyService(it.name, it.category, learned);
    if (c.kind === 'ignored') continue;
    out.push({ point: { who, key, name: it.name, price: it.price, value, from: isFromPrice(it.price), url: it.url, seenAt: it.seenAt, source: it.source }, match: c.kind === 'match' ? c.match : null });
  }
  return out;
}

/**
 * The owner's own prices: their confirmed list wins; then what the Watcher read from their booking
 * page; then their website. Each treatment (catalogue key) comes from one place only.
 */
export function ownPrices(booking: Partial<BookingProfile> | null | undefined, read: { services?: ServiceLine[] } | null | undefined, who: string, learned?: Record<string, string> | null): Priced[] {
  const typed = classifyAll((booking?.prices ?? []).filter((p) => p?.name?.trim() && p?.price).map((p) => ({ name: p.name.trim(), price: p.price, url: '', seenAt: booking?.pricesAt ?? null, source: 'your price list' })), who, 'you', learned);
  const services = read?.services ?? [];
  const fromBooking = classifyAll(services.filter((s) => s.via === 'booking').map((s) => ({ name: s.name, price: s.price, category: s.category, url: s.url, seenAt: s.seenAt, source: `your ${s.platform || 'booking'} page` })), who, 'you', learned);
  const fromSite = classifyAll(services.filter((s) => s.via !== 'booking').map((s) => ({ name: s.name, price: s.price, category: s.category, url: s.url, seenAt: s.seenAt, source: 'your website' })), who, 'you', learned);
  const keys = new Set<string>(); const names = new Set<string>();
  const out: Priced[] = [];
  for (const layer of [typed, fromBooking, fromSite]) {
    const layerKeys = new Set<string>();
    for (const p of layer) {
      const k = p.match?.key;
      const n = p.point.name.toLowerCase().replace(/\s+/g, ' ');
      if (k ? keys.has(k) : names.has(n)) continue;
      out.push(p); names.add(n);
      if (k) layerKeys.add(k);
    }
    for (const k of layerKeys) keys.add(k);
  }
  return out;
}

export function competitorPrices(c: Pick<TrackedCompetitor, 'key' | 'name' | 'services'>, learned?: Record<string, string> | null): Priced[] {
  return classifyAll(c.services.map((s) => ({ name: s.name, price: s.price, category: s.category, url: s.url, seenAt: s.seenAt, source: sourceOf(s) })), c.name, c.key, learned);
}

/** Lowest price per comparable treatment for one business. */
function byKey(list: Priced[]): Map<string, { point: PricePoint; match: TreatmentMatch }> {
  const m = new Map<string, { point: PricePoint; match: TreatmentMatch }>();
  for (const p of list) {
    if (!p.match?.key) continue;
    const have = m.get(p.match.key);
    if (!have || p.point.value < have.point.value) m.set(p.match.key, { point: p.point, match: p.match });
  }
  return m;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function positionText(you: number, avg: number): string {
  const d = Math.round(you - avg);
  if (Math.abs(d) < Math.max(2, avg * 0.02)) return 'about the local average';
  return `${money(Math.abs(d))} ${d > 0 ? 'above' : 'below'} the local average`;
}

export function rankText(you: number, others: number[]): string {
  const all = [you, ...others].sort((a, b) => a - b);
  const total = all.length;
  const below = others.filter((v) => v < you).length; const same = others.filter((v) => v === you).length;
  if (below === 0) return same ? `joint cheapest of ${total}` : `cheapest of ${total}`;
  if (others.every((v) => v <= you)) return same ? `joint dearest of ${total}` : `dearest of ${total}`;
  return `${ordinal(below + 1)} cheapest of ${total}`;
}

export function comparePrices(you: Priced[], competitors: { key: string; name: string; prices: Priced[] }[]): Comparison {
  const mine = byKey(you);
  const theirs = competitors.map((c) => byKey(c.prices));
  const rows: CompareRow[] = []; const theyOnly: GapRow[] = []; const youOnly: GapRow[] = [];
  const allKeys = new Set<string>([...mine.keys(), ...theirs.flatMap((t) => [...t.keys()])]);
  for (const key of allKeys) {
    const y = mine.get(key);
    const cells = theirs.map((t) => t.get(key)?.point ?? null);
    const prices = cells.filter((x): x is PricePoint => !!x);
    const match = y?.match ?? theirs.map((t) => t.get(key)?.match).find(Boolean)!;
    if (y && prices.length) {
      const values = prices.map((p) => p.value);
      const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
      rows.push({
        key, label: match.label, group: match.group, you: y.point, theirs: cells, avg, min: Math.min(...values), max: Math.max(...values), count: values.length,
        diff: Math.round(y.point.value - avg), position: positionText(y.point.value, avg), rank: rankText(y.point.value, values),
        hasFrom: y.point.from || prices.some((p) => p.from),
      });
    } else if (y) youOnly.push({ key, label: match.label, group: match.group, prices: [y.point] });
    else if (prices.length) theyOnly.push({ key, label: match.label, group: match.group, prices: prices.sort((a, b) => a.value - b.value) });
  }
  // "They offer, you don't" is about the treatment itself: if the owner lists it in any amount
  // (even "anti-wrinkle from £150" with no areas stated), it isn't a gap.
  const ownBases = new Set(you.map((p) => p.match?.id).filter(Boolean));
  const gaps = theyOnly.filter((g) => !ownBases.has(g.key.split('|')[0]));
  // Competitors' treatments listed without an amount, for treatments the owner doesn't offer at all.
  const unkeyed = new Map<string, GapRow>();
  for (const c of competitors) for (const p of c.prices) {
    if (!p.match || p.match.key || ownBases.has(p.match.id) || gaps.some((g) => g.key.startsWith(p.match!.id + '|'))) continue;
    const g = unkeyed.get(p.match.id) ?? { key: `${p.match.id}|?`, label: p.match.base, group: p.match.group, prices: [] };
    if (!g.prices.some((x) => x.key === p.point.key)) g.prices.push(p.point);
    unkeyed.set(p.match.id, g);
  }
  const sortRows = <T extends { group: TreatmentGroup; label: string }>(list: T[]) => list.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label, 'en-GB', { numeric: true }));
  const notCompared = [...you, ...competitors.flatMap((c) => c.prices)].filter((p) => p.match && !p.match.key)
    .map((p) => ({ who: p.point.key === 'you' ? 'You' : p.point.who, name: p.point.name, price: p.point.price, label: p.match!.base, url: p.point.url })).slice(0, 40);
  const yourSources: Record<string, number> = {};
  for (const p of you) yourSources[p.point.source] = (yourSources[p.point.source] ?? 0) + 1;
  return {
    competitors: competitors.map((c) => ({ key: c.key, name: c.name })),
    rows: sortRows(rows), youOnly: sortRows(youOnly),
    theyOnly: sortRows([...gaps, ...unkeyed.values()].map((g) => ({ ...g, prices: g.prices.sort((a, b) => a.value - b.value) }))),
    notCompared, yourSources,
  };
}

/** The whole comparison from stored state: the owner's list and reads, and each watched competitor. */
export function comparisonFrom(input: { booking?: Partial<BookingProfile> | null; you?: { services?: ServiceLine[] } | null; list: TrackedCompetitor[]; learned?: Record<string, string> | null; ownName?: string }): Comparison {
  const mine = ownPrices(input.booking, input.you, input.ownName || 'You', input.learned);
  return comparePrices(mine, input.list.map((c) => ({ key: c.key, name: c.name, prices: competitorPrices(c, input.learned) })));
}

/* ---------- Price changes per treatment ---------- */
/**
 * Price moves per catalogue treatment between yesterday's and today's services of one competitor.
 * Moves the name-based diff already reports (same service name) are returned with `sameName`, so
 * the caller can attach the treatment to that event instead of reporting twice.
 */
export function treatmentMoves(prev: ServiceLine[], next: ServiceLine[], learned?: Record<string, string> | null): { key: string; label: string; before: PricePoint; after: PricePoint; sameName: boolean }[] {
  const tag = (list: ServiceLine[]) => byKey(classifyAll(list.map((s) => ({ name: s.name, price: s.price, category: s.category, url: s.url, seenAt: s.seenAt, source: sourceOf(s) })), '', '', learned));
  const a = tag(prev); const b = tag(next);
  const out: { key: string; label: string; before: PricePoint; after: PricePoint; sameName: boolean }[] = [];
  for (const [key, x] of b) {
    const y = a.get(key);
    if (!y || y.point.value === x.point.value || y.point.from !== x.point.from) continue;
    out.push({ key, label: x.match.label, before: y.point, after: x.point, sameName: y.point.name.toLowerCase().trim() === x.point.name.toLowerCase().trim() });
  }
  return out;
}

export const moveSummary = (who: string, label: string, before: string, after: string) => `${who} ${(priceValue(after) ?? 0) > (priceValue(before) ?? 0) ? 'raised' : 'lowered'} ${label} from ${before} to ${after}.`;

/** Price events, newest first, for the Prices view. */
export const priceEvents = (events: ReachEvent[] | undefined) => (events ?? []).filter((e) => e.kind === 'price');

/* ---------- Facts for the advice ---------- */
/** One line per compared treatment, for the AI's facts (every number here may be used). */
export function comparisonFacts(c: Comparison, max = 12): string[] {
  const lines = c.rows.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, max).map((r) => {
    const others = r.theirs.map((p, i) => (p ? `${c.competitors[i].name} ${p.price}` : null)).filter(Boolean).join(', ');
    return `${r.label}: you ${r.you.price}; ${others}; local average ${money(Math.round(r.avg))} across ${r.count} business${r.count === 1 ? '' : 'es'} (range ${money(r.min)} to ${money(r.max)}); you are ${r.position}, ${r.rank}${r.hasFrom ? '; some are "from" prices, the lowest they charge' : ''}.`;
  });
  if (c.theyOnly.length) lines.push(`Treatments competitors list that you don't: ${c.theyOnly.slice(0, 8).map((g) => `${g.label} (${g.prices.map((p) => `${p.who} ${p.price}`).join(', ')})`).join('; ')}.`);
  if (c.youOnly.length) lines.push(`Treatments you price that nobody nearby lists a price for: ${c.youOnly.slice(0, 8).map((g) => `${g.label} ${g.prices[0].price}`).join('; ')}.`);
  return lines;
}
