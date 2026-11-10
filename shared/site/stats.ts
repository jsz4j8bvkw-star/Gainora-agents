// How the website is doing: visits, people, call taps, booking clicks and enquiries, where they came from and
// which pages they read. Worked out from the events the live site sends (no cookies; a visitor is counted once a
// day by a code that can't be traced back to them and changes every day).

export type EventKind = 'view' | 'call' | 'book' | 'enquiry';
export interface SiteEvent { at: string; kind: EventKind; path: string; source: string; device: string; visitor: string }

export interface SourceRow { source: string; people: number; actions: number }
export interface Performance {
  from: string; to: string; days: number;
  people: number; views: number; calls: number; bookings: number; enquiries: number;
  /** Calls + booking clicks + enquiries. */
  actions: number;
  /** actions ÷ people, 0–1, or null with no visitors. */
  rate: number | null;
  previous: { people: number; actions: number };
  daily: { date: string; people: number; actions: number }[];
  sources: SourceRow[];
  pages: { path: string; views: number }[];
  phoneShare: number | null;
}

const DAY = 86_400_000;
const dateOf = (iso: string) => iso.slice(0, 10);

function summarise(events: SiteEvent[]) {
  const people = new Set<string>();
  let views = 0, calls = 0, bookings = 0, enquiries = 0;
  for (const e of events) {
    if (e.kind === 'view') { views++; people.add(`${dateOf(e.at)}|${e.visitor}`); }
    else if (e.kind === 'call') calls++;
    else if (e.kind === 'book') bookings++;
    else if (e.kind === 'enquiry') enquiries++;
  }
  return { people: people.size, views, calls, bookings, enquiries, actions: calls + bookings + enquiries };
}

/** The last `days` days (to `now`) against the `days` before. */
export function performance(events: SiteEvent[], days = 28, now = new Date()): Performance {
  const end = now.getTime();
  const start = end - days * DAY;
  const prevStart = start - days * DAY;
  const cur = events.filter((e) => { const t = Date.parse(e.at); return t > start && t <= end; });
  const prev = events.filter((e) => { const t = Date.parse(e.at); return t > prevStart && t <= start; });
  const sum = summarise(cur);
  const ps = summarise(prev);

  const daily: Performance['daily'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end - i * DAY).toISOString().slice(0, 10);
    const s = summarise(cur.filter((e) => dateOf(e.at) === d));
    daily.push({ date: d, people: s.people, actions: s.actions });
  }

  // A visitor's source is where their first visit that day came from; their actions that day are credited to it.
  const firstSource = new Map<string, string>();
  for (const e of [...cur].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${dateOf(e.at)}|${e.visitor}`;
    if (e.kind === 'view' && !firstSource.has(key)) firstSource.set(key, e.source || 'Direct');
  }
  const bySource = new Map<string, SourceRow>();
  const row = (src: string) => { if (!bySource.has(src)) bySource.set(src, { source: src, people: 0, actions: 0 }); return bySource.get(src)!; };
  for (const src of firstSource.values()) row(src).people++;
  for (const e of cur) {
    if (e.kind === 'view') continue;
    const src = firstSource.get(`${dateOf(e.at)}|${e.visitor}`) || (e.source && e.source !== 'This website' ? e.source : 'Direct');
    row(src).actions++;
  }
  const pages = new Map<string, number>();
  for (const e of cur) if (e.kind === 'view') pages.set(e.path, (pages.get(e.path) ?? 0) + 1);
  const viewEvents = cur.filter((e) => e.kind === 'view');
  return {
    from: new Date(start).toISOString(), to: now.toISOString(), days,
    ...sum,
    rate: sum.people ? sum.actions / sum.people : null,
    previous: { people: ps.people, actions: ps.actions },
    daily,
    sources: [...bySource.values()].sort((a, b) => b.actions - a.actions || b.people - a.people),
    pages: [...pages.entries()].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views).slice(0, 8),
    phoneShare: viewEvents.length ? viewEvents.filter((e) => e.device === 'phone').length / viewEvents.length : null,
  };
}

/** Where a visit came from, as people say it. Used by the live site (in its script) and the server. */
export function sourceLabel(referrer: string, params: URLSearchParams, ownHost: string): string {
  let host = '';
  try { host = referrer ? new URL(referrer).hostname : ''; } catch { /* not a URL */ }
  if (params.get('gclid') || params.get('gbraid') || params.get('wbraid')) return 'Google Ads';
  const u = (params.get('utm_source') || '').toLowerCase();
  const m = (params.get('utm_medium') || '').toLowerCase();
  if (u) {
    if (/gbp|business|maps/.test(u + (params.get('utm_campaign') || '').toLowerCase())) return 'Google Business Profile';
    if (/cpc|paid|ppc/.test(m)) return /facebook|instagram|meta/.test(u) ? 'Facebook and Instagram ads' : 'Google Ads';
    return u.charAt(0).toUpperCase() + u.slice(1);
  }
  if (!host) return 'Direct';
  if (host === ownHost) return 'This website';
  if (/google\./.test(host)) return 'Google search';
  if (/bing\.|duckduckgo|yahoo|ecosia/.test(host)) return 'Other search engines';
  if (/facebook|instagram|fb\.|messenger/.test(host)) return 'Facebook and Instagram';
  return host.replace(/^www\./, '');
}

/** Short, safe values for an incoming event. Anything odd is dropped rather than stored. */
export function cleanEvent(raw: any): Omit<SiteEvent, 'at' | 'visitor'> & { site: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const site = String(raw.s || '');
  const kind = String(raw.k || '') as EventKind;
  if (!/^[0-9a-f-]{36}$/i.test(site)) return null;
  if (!['view', 'call', 'book'].includes(kind)) return null;   // enquiries are recorded by the form handler itself
  const path = String(raw.p || '/').slice(0, 200);
  if (!/^\/[\w\-./]*$/.test(path)) return null;
  const source = String(raw.src || 'Direct').replace(/[^\w .&'-]/g, '').slice(0, 60) || 'Direct';
  const device = raw.d === 'phone' ? 'phone' : 'computer';
  return { site, kind, path, source, device };
}
