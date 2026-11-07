// Pure helpers used by The Watcher to read web pages. No network code here, so they are easy to test.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML page, one block per line. */
export function visibleText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1)
    .join('\n');
}

export function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/** Same-site links found on a page, absolute, without fragments, de-duplicated. */
export function extractLinks(html: string, pageUrl: string, sameSiteOnly = true): string[] {
  const base = new URL(pageUrl);
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
    if (!raw || /^(mailto:|tel:|javascript:|#|data:|sms:|whatsapp:)/i.test(raw)) continue;
    try {
      const u = new URL(raw, base);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      if (sameSiteOnly && u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      out.add(u.toString());
    } catch { /* ignore bad hrefs */ }
  }
  return [...out];
}

/** Forms on a page, with where they submit to. */
export function extractForms(html: string, pageUrl: string): { action: string; method: string; fields: number }[] {
  const forms: { action: string; method: string; fields: number }[] = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const action = (attrs.match(/\baction\s*=\s*["']?([^"'\s>]*)/i)?.[1]) || pageUrl;
    const method = (attrs.match(/\bmethod\s*=\s*["']?(\w+)/i)?.[1] || 'get').toLowerCase();
    const fields = (m[2].match(/<(input|textarea|select)\b/gi) || []).length;
    let abs = pageUrl;
    try { abs = new URL(action, pageUrl).toString(); } catch { /* keep page url */ }
    forms.push({ action: abs, method, fields });
  }
  return forms;
}

/** Prices mentioned on a page, e.g. "£12.50", "£1,200", "from £99". */
export function extractPrices(text: string): string[] {
  const found = text.match(/£\s?\d{1,3}(,\d{3})*(\.\d{2})?|\d+(\.\d{2})?\s?GBP/gi) || [];
  return [...new Set(found.map((p) => p.replace(/\s+/g, '')))];
}

/** Lines that suggest an offer or promotion. */
export function extractOffers(text: string): string[] {
  const re = /(\d+%\s?off|free (delivery|shipping|consultation|quote|gift)|sale\b|discount|offer|code [A-Z0-9]{3,}|buy one|black friday|limited time|new in|now open)/i;
  return [...new Set(text.split('\n').filter((l) => l.length < 200 && re.test(l)))];
}

export function hashText(text: string): string {
  // FNV-1a 32-bit; enough to notice "something changed".
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface PageSnapshot {
  url: string;
  title: string;
  hash: string;
  prices: string[];
  offers: string[];
  lines: string[];     // trimmed visible text lines (capped)
}

export function snapshot(url: string, html: string): PageSnapshot {
  const text = visibleText(html);
  const lines = text.split('\n').slice(0, 400);
  return { url, title: pageTitle(html), hash: hashText(lines.join('\n')), prices: extractPrices(text), offers: extractOffers(text), lines };
}

export interface SnapshotDiff {
  changed: boolean;
  addedPrices: string[];
  removedPrices: string[];
  addedOffers: string[];
  removedOffers: string[];
  addedLines: string[];
  removedLines: string[];
}

/** Lines that only exist because of dates, counters or cookie banners create noise; ignore them. */
function noisy(line: string): boolean {
  return /cookie|©|copyright|\b\d{1,2}:\d{2}\b|basket \(\d+\)|cart \(\d+\)|items? in (your )?(basket|cart)/i.test(line) || line.length < 4;
}

export function diffSnapshots(before: PageSnapshot, after: PageSnapshot): SnapshotDiff {
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const bl = before.lines.filter((l) => !noisy(l));
  const al = after.lines.filter((l) => !noisy(l));
  const d: SnapshotDiff = {
    changed: false,
    addedPrices: minus(after.prices, before.prices),
    removedPrices: minus(before.prices, after.prices),
    addedOffers: minus(after.offers, before.offers),
    removedOffers: minus(before.offers, after.offers),
    addedLines: minus(al, bl).slice(0, 20),
    removedLines: minus(bl, al).slice(0, 20),
  };
  d.changed = d.addedPrices.length + d.removedPrices.length + d.addedOffers.length + d.removedOffers.length > 0 || d.addedLines.length + d.removedLines.length >= 3;
  return d;
}

/** Plain-English summary of a competitor change, used when AI is unavailable and as the AI's input. */
export function describeDiff(competitor: string, d: SnapshotDiff): { kind: 'price' | 'offer' | 'content'; summary: string } | null {
  if (!d.changed) return null;
  if (d.addedOffers.length) return { kind: 'offer', summary: `${competitor} added: “${d.addedOffers[0].slice(0, 120)}”` };
  if (d.addedPrices.length || d.removedPrices.length) {
    const parts: string[] = [];
    if (d.removedPrices.length) parts.push(`removed ${d.removedPrices.slice(0, 3).join(', ')}`);
    if (d.addedPrices.length) parts.push(`now shows ${d.addedPrices.slice(0, 3).join(', ')}`);
    return { kind: 'price', summary: `${competitor} changed prices: ${parts.join('; ')}.` };
  }
  if (d.removedOffers.length) return { kind: 'offer', summary: `${competitor} ended an offer: “${d.removedOffers[0].slice(0, 120)}”` };
  return { kind: 'content', summary: `${competitor} updated their page (${d.addedLines.length} new lines of text).` };
}
