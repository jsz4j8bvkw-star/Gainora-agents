// Competitor price comparison. The AI suggests which products are comparable;
// every price it reports must appear on the page it came from, or it is dropped.
import { extractPrices } from './pages';

export interface PriceCell { price: string; name?: string; url: string }
export interface PriceRow { item: string; yours: PriceCell | null; theirs: (PriceCell | null)[]; note?: string }
export interface PriceTable { checkedAt: string; competitors: string[]; rows: PriceRow[] }

/** Lines of page text that mention a price, which is all the AI needs to see. */
export function priceLines(text: string, max = 80): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l.length > 1 && l.length <= 200 && /£\s?\d/.test(l) && !out.includes(l)) out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

export const priceValue = (p: string): number | null => {
  const m = String(p).replace(/,/g, '').match(/\d+(\.\d{1,2})?/);
  return m ? Number(m[0]) : null;
};

const PRICE_PAGE = /shop|store|product|collection|categor|range|price|pricing|menu|service|treatment|package|rates|tariff|catalog|buy|gifts?\b|wholesale/i;
const SKIP_PAGE = /cart|basket|checkout|account|login|privacy|terms|cookie|blog\/|news\/|\.(pdf|jpe?g|png|webp|gif|zip)(\?|$)/i;

/** The pages most likely to list prices, from a site's own links (shop, menu, services, pricing...). */
export function pricePageCandidates(links: string[], max = 3): string[] {
  const scored = links
    .filter((l) => !SKIP_PAGE.test(l))
    .map((l) => { let path = ''; try { path = new URL(l).pathname; } catch { return null; } return { l, path }; })
    .filter((x): x is { l: string; path: string } => !!x && PRICE_PAGE.test(x.path))
    .map((x) => ({ l: x.l, depth: x.path.split('/').filter(Boolean).length }))
    .sort((a, b) => a.depth - b.depth);
  const out: string[] = [];
  for (const x of scored) if (!out.includes(x.l)) { out.push(x.l); if (out.length >= max) break; }
  return out;
}

const normUrl = (u: string) => String(u).replace(/#.*$/, '').replace(/\/+$/, '').replace(/^http:/, 'https:').replace('://www.', '://');

function onPage(cell: PriceCell | null, sources: Record<string, string>): PriceCell | null {
  if (!cell || !cell.url || typeof cell.price !== 'string') return null;
  const key = sources[cell.url] !== undefined ? cell.url : Object.keys(sources).find((k) => normUrl(k) === normUrl(cell.url));
  const text = key ? sources[key] : undefined;
  if (!text) return null;
  const v = priceValue(cell.price);
  if (v == null) return null;
  const found = extractPrices(text).map(priceValue);
  return found.some((x) => x != null && Math.abs(x - v) < 0.005)
    ? { price: `£${v % 1 ? v.toFixed(2) : v}`, ...(typeof cell.name === 'string' ? { name: cell.name.slice(0, 80) } : {}), url: key! }
    : null;
}

/** Keeps only prices that really appear on their source page, and rows with something to compare. */
export function validatePriceTable(t: PriceTable, sources: Record<string, string>): PriceTable {
  const rows: PriceRow[] = [];
  for (const r of Array.isArray(t?.rows) ? t.rows : []) {
    if (!r || typeof r.item !== 'string') continue;
    const yours = onPage(r.yours, sources);
    const theirs = (t.competitors || []).map((_, i) => onPage(r.theirs?.[i] ?? null, sources));
    const filled = (yours ? 1 : 0) + theirs.filter(Boolean).length;
    if (filled >= 2) rows.push({ item: r.item.slice(0, 80), yours, theirs, note: typeof r.note === 'string' ? r.note.slice(0, 200) : undefined });
  }
  return { checkedAt: t.checkedAt, competitors: t.competitors || [], rows: rows.slice(0, 12) };
}

export interface PriceMove { competitor: string; item: string; from: string; to: string }

export function diffPriceTables(prev: PriceTable | null | undefined, next: PriceTable): PriceMove[] {
  if (!prev) return [];
  const moves: PriceMove[] = [];
  for (const row of next.rows) {
    const old = prev.rows.find((r) => r.item.toLowerCase() === row.item.toLowerCase());
    if (!old) continue;
    next.competitors.forEach((c, i) => {
      const j = prev.competitors.indexOf(c);
      const a = j >= 0 ? old.theirs[j] : null; const b = row.theirs[i];
      if (a && b && priceValue(a.price) !== priceValue(b.price)) moves.push({ competitor: c, item: row.item, from: a.price, to: b.price });
    });
  }
  return moves;
}
