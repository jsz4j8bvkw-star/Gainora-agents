import { randomUUID } from 'node:crypto';
import { body, db, getProfile, handler, HttpError, insert, json } from '../lib/core';
import { cleanSite, freeSlug, liveOrigin, requireWebsite, siteBySlug, siteFor, type SiteRow, APP_ORIGIN } from '../lib/sites';
import { siteFromProfile, withDefaults } from '../../shared/site/data';
import { performance, type SiteEvent } from '../../shared/site/stats';

// The owner's website in Command Centre (Launch & Grow).
//   POST /api/site {op: get | save | publish | unpublish | slug | domain | stats | enquiries}
// Every write goes through here so the live site only ever holds checked content.
const view = (r: SiteRow) => ({
  id: r.id, slug: r.slug, domain: r.domain, data: withDefaults(r.data), publishedAt: r.published_at, updatedAt: r.updated_at,
  live: !!r.published, liveUrl: liveOrigin(r) + '/', previewUrl: `${APP_ORIGIN()}/site/${r.slug}/`,
  changed: !!r.published && JSON.stringify(r.published) !== JSON.stringify(r.data),
});

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const user = await requireWebsite(req);
  const b = await body<any>(req);
  let row = await siteFor(user.id);

  if (b.op === 'get') {
    if (!row) {
      // First visit: a draft from what they told Command Centre in onboarding, so nothing is typed twice.
      const draft = siteFromProfile(await getProfile(user.id));
      const slug = await freeSlug(draft.business.name);
      draft.slug = slug;
      [row] = await insert<SiteRow>('sites', { id: randomUUID(), user_id: user.id, slug, data: cleanSite(draft) });
    }
    return json({ site: view(row!) });
  }
  if (!row) throw new HttpError(404, 'Open the Website page first.');

  if (b.op === 'save') {
    const data = cleanSite({ ...b.data, slug: row.slug });
    const [r] = await db<SiteRow[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { data, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
    return json({ site: view(r) });
  }
  if (b.op === 'publish') {
    const data = cleanSite({ ...(b.data ?? row.data), slug: row.slug });
    if (!data.business.name.trim()) throw new HttpError(400, 'Add the business name before publishing.');
    if (!data.business.phone.trim() && !data.business.email.trim()) throw new HttpError(400, 'Add a phone number or email before publishing, so visitors can reach the business.');
    const at = new Date().toISOString();
    const [r] = await db<SiteRow[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { data, published: data, published_at: at, updated_at: at }, prefer: 'return=representation' });
    return json({ site: view(r) });
  }
  if (b.op === 'unpublish') {
    const [r] = await db<SiteRow[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { published: null, published_at: null }, prefer: 'return=representation' });
    return json({ site: view(r) });
  }
  if (b.op === 'slug') {
    const slug = String(b.slug || '').toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) throw new HttpError(400, 'Use 3 to 60 lower-case letters, numbers and hyphens.');
    const taken = await siteBySlug(slug);
    if (taken && taken.id !== row.id) throw new HttpError(409, 'That address is taken. Try another.');
    const [r] = await db<SiteRow[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { slug, data: { ...row.data, slug } }, prefer: 'return=representation' });
    return json({ site: view(r) });
  }
  if (b.op === 'domain') {
    const raw = String(b.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (raw && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) throw new HttpError(400, 'Enter a domain like yourbusiness.co.uk');
    if (/gainora\.co\.uk$|netlify\.app$/.test(raw)) throw new HttpError(400, 'Use the business’s own domain.');
    const clash = raw ? (await db<any[]>(`sites?select=id&domain=eq.${encodeURIComponent(raw)}`))[0] : null;
    if (clash && clash.id !== row.id) throw new HttpError(409, 'That domain is already connected to another Gainora site. Email hello@gainora.co.uk.');
    const [r] = await db<SiteRow[]>(`sites?id=eq.${row.id}`, { method: 'PATCH', body: { domain: raw || null, data: { ...row.data, business: { ...(row.data?.business ?? {}), domain: raw } } }, prefer: 'return=representation' });
    return json({ site: view(r) });
  }
  if (b.op === 'stats') {
    const days = [7, 28, 90].includes(Number(b.days)) ? Number(b.days) : 28;
    const since = new Date(Date.now() - 2 * days * 86_400_000).toISOString();
    const rows = await db<any[]>(`site_events?select=at,kind,path,source,device,visitor&site_id=eq.${row.id}&at=gte.${since}&order=at.asc&limit=50000`);
    return json({ performance: performance(rows as SiteEvent[], days) });
  }
  if (b.op === 'enquiries') {
    const rows = await db<any[]>(`site_enquiries?select=id,at,name,phone,email,service,postcode,message,page,source,forwarded&user_id=eq.${user.id}&order=at.desc&limit=100`);
    return json({ enquiries: rows });
  }
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/site', method: 'POST' };
