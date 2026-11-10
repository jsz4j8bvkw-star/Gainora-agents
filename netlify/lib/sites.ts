// Launch & Grow websites on the server: finding a site by its address, checking what the owner saves, and the
// cookieless visitor code. Pages are drawn by shared/site/render.ts, the same code as the editor's preview.
import { createHash } from 'node:crypto';
import { db, enc, env, HttpError, userFromRequest, type AuthedUser } from './core';
import { type Site, slug as slugify, withDefaults } from '../../shared/site/data';

export interface SiteRow { id: string; user_id: string; slug: string; domain: string | null; data: any; published: any; published_at: string | null; updated_at: string }

export const APP_ORIGIN = () => (env('APP_URL') || env('URL') || 'https://app.gainora.co.uk').replace(/\/$/, '');
export const previewBase = (slug: string) => `/site/${slug}/`;
export const liveOrigin = (row: Pick<SiteRow, 'slug' | 'domain'>) => (row.domain ? `https://${row.domain}` : `${APP_ORIGIN()}/site/${row.slug}`);

const COLS = 'id,user_id,slug,domain,data,published,published_at,updated_at';
export async function siteFor(userId: string): Promise<SiteRow | null> {
  return (await db<SiteRow[]>(`sites?select=${COLS}&user_id=eq.${userId}`))[0] ?? null;
}
export async function siteBySlug(slug: string): Promise<SiteRow | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  return (await db<SiteRow[]>(`sites?select=${COLS}&slug=eq.${slug}`))[0] ?? null;
}
export async function siteByDomain(host: string): Promise<SiteRow | null> {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]{3,253}$/.test(h)) return null;
  return (await db<SiteRow[]>(`sites?select=${COLS}&domain=eq.${enc(h)}`))[0] ?? null;
}
export async function siteById(id: string): Promise<SiteRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db<SiteRow[]>(`sites?select=${COLS}&id=eq.${id}`))[0] ?? null;
}

/** Signed in, with Launch & Grow (the website entitlement) on their plan. */
export async function requireWebsite(req: Request): Promise<AuthedUser> {
  const user = await userFromRequest(req);
  const rows = await db<any[]>(`entitlements?select=agent&agent=eq.website&status=in.(active,trialing)&or=(user_id.eq.${user.id},email.eq.${enc(user.email)})`);
  if (!rows.length) throw new HttpError(403, 'Your website comes with Launch & Grow. Email hello@gainora.co.uk to add it.');
  return user;
}

const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const url = (v: unknown) => { const s = str(v, 500).trim(); return !s || /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; };
const photo = (p: any) => (p && typeof p === 'object' && /^https:\/\//.test(String(p.url)) ? { id: str(p.id, 80), url: url(p.url), name: str(p.name, 120), alt: str(p.alt, 200) } : null);

/** Everything the owner saves goes through here: lengths capped, links checked, nothing unexpected kept. */
export function cleanSite(raw: any): Site {
  const s = withDefaults(raw);
  const b = s.business;
  const out: Site = {
    slug: str(s.slug, 60),
    business: {
      name: str(b.name, 120), industry: b.industry, trade: str(b.trade, 60), phone: str(b.phone, 30), email: str(b.email, 160),
      line1: str(b.line1, 120), line2: str(b.line2, 120), town: str(b.town, 60), postcode: str(b.postcode, 10).toUpperCase(),
      showAddress: !!b.showAddress, areas: b.areas.map((a) => str(a, 60)).filter(Boolean).slice(0, 25),
      hours: Object.fromEntries(Object.entries(b.hours).map(([k, v]) => [k, str(v, 20)])) as Site['business']['hours'],
      owner: str(b.owner, 80), founded: str(b.founded, 4), credentials: b.credentials.map((c) => str(c, 120)).filter(Boolean).slice(0, 8),
      differences: b.differences.map((c) => str(c, 160)).filter(Boolean).slice(0, 6),
      domain: str(b.domain, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''),
    },
    services: s.services.slice(0, 20).map((x) => ({ id: str(x.id, 40) || Math.random().toString(36).slice(2, 10), name: str(x.name, 80), price: str(x.price, 40), duration: str(x.duration, 40), summary: str(x.summary, 400), page: !!x.page })),
    reviews: s.reviews.slice(0, 12).map((r) => ({ id: str(r.id, 40), text: str(r.text, 600), name: str(r.name, 60), source: str(r.source, 60) })),
    reviewLink: url(s.reviewLink),
    booking: { url: url(s.booking.url), label: str(s.booking.label, 40) },
    captureFormUrl: /^https:\/\/capture\.gainora\.co\.uk\/api\/enquiry-in\/[A-Za-z0-9_-]{20,}$/.test(String(s.captureFormUrl || '').trim()) ? String(s.captureFormUrl).trim() : '',
    tracking: { ga4: str(s.tracking.ga4, 20).trim(), adsId: str(s.tracking.adsId, 20).trim(), adsLabel: str(s.tracking.adsLabel, 40).trim() },
    ads: { monthly: Math.max(0, Math.min(100_000, Number(s.ads.monthly) || 0)), radiusMiles: Math.max(1, Math.min(100, Number(s.ads.radiusMiles) || 10)) },
    look: {
      style: (['calm', 'bold', 'warm'] as const).includes(s.look.style) ? s.look.style : 'calm',
      accent: /^#[0-9a-f]{6}$/i.test(s.look.accent) ? s.look.accent : '#3D4F6B',
      logo: photo(s.look.logo), hero: photo(s.look.hero), about: photo(s.look.about),
      gallery: (s.look.gallery || []).map(photo).filter((p): p is NonNullable<ReturnType<typeof photo>> => !!p).slice(0, 12),
    },
    copy: Object.fromEntries(Object.entries(s.copy || {}).filter(([k, v]) => /^[\w.-]{1,60}$/.test(k) && typeof v === 'string').slice(0, 80).map(([k, v]) => [k, str(v, 2000)])),
    faqs: Array.isArray(s.faqs) ? s.faqs.slice(0, 12).map((f) => ({ q: str(f.q, 200), a: str(f.a, 1000) })) : null,
    plan: Object.fromEntries(Object.entries(s.plan || {}).filter(([k]) => /^[\w-]{1,30}$/.test(k)).slice(0, 80).map(([k, v]) => [k, !!v])),
    notes: str(s.notes, 4000),
  };
  if (JSON.stringify(out).length > 200_000) throw new HttpError(413, 'That’s more than a website needs. Shorten some of the text.');
  return out;
}

/** A free web address for the site: its name, then -2, -3… if taken. */
export async function freeSlug(name: string): Promise<string> {
  let base = slugify(name || 'my-business').slice(0, 50);
  if (base.length < 3) base = `${base}-site`;
  for (let i = 1; i < 50; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (!(await siteBySlug(s))) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** A code for "the same visitor today" that can't be traced back: IP and browser, hashed with a secret that changes daily. */
export function visitorCode(req: Request, siteId: string, now = new Date()): string {
  const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const ua = req.headers.get('user-agent') || '';
  return createHash('sha256').update(`${env('INTERNAL_SECRET', 'gainora')}|${now.toISOString().slice(0, 10)}|${siteId}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

export const isBot = (req: Request) => /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime/i.test(req.headers.get('user-agent') || '');
