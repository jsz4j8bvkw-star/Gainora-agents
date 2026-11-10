// Sample website numbers for the demo: eight weeks of visits, calls and enquiries that grow as the Google profile
// and ads get going. Seeded, so the demo looks the same every time it opens.
import type { SiteEvent } from '../../shared/site/stats';
import type { WebsiteEnquiry } from './types';

function rng(seed: number) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
const SOURCES: [string, number][] = [['Google search', 0.34], ['Google Business Profile', 0.26], ['Google Ads', 0.2], ['Direct', 0.1], ['Facebook and Instagram', 0.07], ['Other search engines', 0.03]];
const PATHS: [string, number][] = [['/', 0.42], ['/services/', 0.18], ['/services/lip-filler/', 0.12], ['/services/skin-boosters/', 0.08], ['/contact/', 0.1], ['/about/', 0.1]];
const pick = (r: () => number, list: [string, number][]) => { let v = r(); for (const [k, w] of list) { if ((v -= w) <= 0) return k; } return list[0][0]; };

export function demoEvents(now = new Date()): SiteEvent[] {
  const r = rng(42);
  const out: SiteEvent[] = [];
  for (let d = 55; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86_400_000);
    const weekday = day.getUTCDay();
    const growth = 1 + (55 - d) / 55;              // traffic roughly doubles over eight weeks
    const people = Math.round((14 + r() * 8) * growth * (weekday === 0 ? 0.6 : 1));
    for (let p = 0; p < people; p++) {
      const visitor = `v${d}-${p}`;
      const source = pick(r, SOURCES);
      const at = new Date(day.getTime() - Math.floor(r() * 10 * 3_600_000)).toISOString();
      const device = r() < 0.72 ? 'phone' : 'computer';
      const pages = 1 + Math.floor(r() * 3);
      for (let i = 0; i < pages; i++) out.push({ at, kind: 'view', path: i === 0 ? pick(r, PATHS) : pick(r, PATHS), source, device, visitor });
      const lift = source === 'Google Ads' ? 1.4 : source === 'Google Business Profile' ? 1.3 : 1;
      const x = r();
      if (x < 0.035 * lift) out.push({ at, kind: 'call', path: '/', source, device, visitor });
      else if (x < 0.06 * lift) out.push({ at, kind: 'book', path: '/services/', source, device, visitor });
      else if (x < 0.08 * lift) out.push({ at, kind: 'enquiry', path: '/contact/', source, device, visitor });
    }
  }
  return out;
}

export function demoEnquiries(now = new Date()): WebsiteEnquiry[] {
  const rows: [number, string, string, string, string][] = [
    [0.2, 'Hannah M.', 'Lip filler', 'Hi, I’d like to book a consultation for lip filler. I’m free most evenings after 6.', 'Google Ads'],
    [1.1, 'Priya S.', 'Skin boosters', 'Do you do a course of skin boosters, and is there a price for three?', 'Google Business Profile'],
    [2.4, 'Laura K.', '', 'Can I bring my sister to the consultation too?', 'Google search'],
    [4.8, 'Georgia T.', 'Chemical peel', 'Is a peel OK before a wedding in three weeks?', 'Facebook and Instagram'],
    [6.3, 'Sam R.', 'Microneedling', 'Looking for something for acne scarring. What would you suggest?', 'Google search'],
  ];
  return rows.map(([days, name, service, message, source], i) => ({
    id: `demo-enq-${i}`, at: new Date(now.getTime() - days * 86_400_000).toISOString(), name, phone: '07700 900' + String(100 + i * 37), email: '', service, postcode: '',
    message, page: service ? '/services/' : '/contact/', source, forwarded: true,
  }));
}
