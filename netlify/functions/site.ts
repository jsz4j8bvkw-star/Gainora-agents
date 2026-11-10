import { randomUUID } from 'node:crypto';
import { body, db, getProfile, handler, HttpError, insert, json } from '../lib/core';
import { cleanSite, freeSlug, gainoraEmails, liveOrigin, ownerEmail, requireWebsite, siteBySlug, siteFor, type SiteRow, APP_ORIGIN } from '../lib/sites';
import { sendEmail } from '../lib/email';
import { forClient, mergeClientEdit, siteFromProfile, withDefaults } from '../../shared/site/data';
import { performance, type SiteEvent } from '../../shared/site/stats';

// The website in Command Centre (Launch & Grow).
//   POST /api/site {op, as?}
//   Everyone with the website:  get | save | publish | stats | enquiries | request | requests
//   Gainora's team only:        list | slug | domain | unpublish | request-done, and `as: <slug>` to work on a client's site
// Clients change their own details (prices, services, hours, contact, reviews, booking link). The design, the
// wording and the pages are Gainora's: a client's save keeps only the fields they may change (mergeClientEdit).
const view = (r: SiteRow, gainora: boolean) => {
  const data = withDefaults(r.data);
  return {
    id: r.id, slug: r.slug, domain: r.domain, data: gainora ? data : forClient(data), publishedAt: r.published_at, updatedAt: r.updated_at,
    live: !!r.published, liveUrl: liveOrigin(r) + '/', previewUrl: `${APP_ORIGIN()}/site/${r.slug}/`,
    changed: !!r.published && JSON.stringify(r.published) !== JSON.stringify(r.data),
    role: gainora ? 'gainora' : 'owner',
  };
};
const gainoraOnly = (gainora: boolean) => { if (!gainora) throw new HttpError(403, 'Gainora makes this change for you. Use “Ask Gainora for a change”.'); };

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const user = await requireWebsite(req);
  const b = await body<any>(req);
  const g = user.gainora;

  if (b.op === 'list') {
    gainoraOnly(g);
    const rows = await db<SiteRow[]>('sites?select=id,user_id,slug,domain,data,published,published_at,updated_at&order=updated_at.desc&limit=500');
    const open = await db<any[]>('site_requests?select=site_id&status=eq.open&limit=5000').catch(() => []);
    return json({ sites: rows.map((r) => ({ slug: r.slug, name: r.data?.business?.name || r.slug, domain: r.domain, live: !!r.published, updatedAt: r.updated_at, openRequests: open.filter((x) => x.site_id === r.id).length })) });
  }

  // Gainora working on a client's site, or anyone on their own.
  let row: SiteRow | null;
  if (b.as) { gainoraOnly(g); row = await siteBySlug(String(b.as)); if (!row) throw new HttpError(404, 'No website with that address.'); }
  else row = await siteFor(user.id);
  const patch = async (body: Record<string, unknown>) => (await db<SiteRow[]>(`sites?id=eq.${row!.id}`, { method: 'PATCH', body, prefer: 'return=representation' }))[0];
  /** What this person's edit becomes: everything for Gainora, only the client's own fields for the client. */
  const incoming = (raw: any) => cleanSite({ ...(g ? raw : mergeClientEdit(withDefaults(row!.data), withDefaults(raw))), slug: row!.slug });

  if (b.op === 'get') {
    if (!row) {
      if (b.as) throw new HttpError(404, 'No website with that address.');
      // First visit: a draft from what they told Command Centre in onboarding, so nothing is typed twice.
      const draft = siteFromProfile(await getProfile(user.id));
      const slug = await freeSlug(draft.business.name);
      draft.slug = slug;
      [row] = await insert<SiteRow>('sites', { id: randomUUID(), user_id: user.id, slug, data: cleanSite(draft) });
    }
    return json({ site: view(row!, g) });
  }
  if (!row) throw new HttpError(404, 'Open the Website page first.');

  if (b.op === 'save') {
    const r = await patch({ data: incoming(b.data), updated_at: new Date().toISOString() });
    return json({ site: view(r, g) });
  }
  if (b.op === 'publish') {
    const data = incoming(b.data ?? row.data);
    if (!data.business.name.trim()) throw new HttpError(400, 'Add the business name before publishing.');
    if (!data.business.phone.trim() && !data.business.email.trim()) throw new HttpError(400, 'Add a phone number or email before publishing, so visitors can reach the business.');
    const at = new Date().toISOString();
    return json({ site: view(await patch({ data, published: data, published_at: at, updated_at: at }), g) });
  }
  if (b.op === 'unpublish') {
    gainoraOnly(g);
    return json({ site: view(await patch({ published: null, published_at: null }), g) });
  }
  if (b.op === 'slug') {
    gainoraOnly(g);
    const slug = String(b.slug || '').toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) throw new HttpError(400, 'Use 3 to 60 lower-case letters, numbers and hyphens.');
    const taken = await siteBySlug(slug);
    if (taken && taken.id !== row.id) throw new HttpError(409, 'That address is taken. Try another.');
    return json({ site: view(await patch({ slug, data: { ...row.data, slug } }), g) });
  }
  if (b.op === 'domain') {
    gainoraOnly(g);
    const raw = String(b.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (raw && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) throw new HttpError(400, 'Enter a domain like yourbusiness.co.uk');
    if (/gainora\.co\.uk$|netlify\.app$/.test(raw)) throw new HttpError(400, 'Use the business’s own domain.');
    const clash = raw ? (await db<any[]>(`sites?select=id&domain=eq.${encodeURIComponent(raw)}`))[0] : null;
    if (clash && clash.id !== row.id) throw new HttpError(409, 'That domain is already connected to another Gainora site.');
    return json({ site: view(await patch({ domain: raw || null, data: { ...row.data, business: { ...(row.data?.business ?? {}), domain: raw } } }), g) });
  }
  if (b.op === 'stats') {
    const days = [7, 28, 90].includes(Number(b.days)) ? Number(b.days) : 28;
    const since = new Date(Date.now() - 2 * days * 86_400_000).toISOString();
    const rows = await db<any[]>(`site_events?select=at,kind,path,source,device,visitor&site_id=eq.${row.id}&at=gte.${since}&order=at.asc&limit=50000`);
    return json({ performance: performance(rows as SiteEvent[], days) });
  }
  if (b.op === 'enquiries') {
    const rows = await db<any[]>(`site_enquiries?select=id,at,name,phone,email,service,postcode,message,page,source,forwarded&site_id=eq.${row.id}&order=at.desc&limit=100`);
    return json({ enquiries: rows });
  }
  if (b.op === 'requests') {
    const rows = await db<any[]>(`site_requests?select=id,at,page,text,status,done_at,reply&site_id=eq.${row.id}&order=at.desc&limit=100`);
    return json({ requests: rows });
  }
  if (b.op === 'request') {
    const text = String(b.text || '').trim().slice(0, 2000);
    if (!text) throw new HttpError(400, 'Say what you’d like changed.');
    const [saved] = await insert<any>('site_requests', { id: randomUUID(), site_id: row.id, at: new Date().toISOString(), page: String(b.page || '').slice(0, 80), text, status: 'open', done_at: null, reply: '' });
    const name = row.data?.business?.name || row.slug;
    await sendEmail(gainoraEmails()[0], `Website change for ${name}`, [`${name} asked for a change${saved.page ? ` on ${saved.page}` : ''}:`, `“${text}”`], { label: 'Open their website', url: `${APP_ORIGIN()}/website?site=${row.slug}` }).catch((e) => console.error('[gainora] request email', e?.message));
    return json({ request: saved });
  }
  if (b.op === 'request-done') {
    gainoraOnly(g);
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown request.');
    const reply = String(b.reply || '').trim().slice(0, 1000);
    const [done] = await db<any[]>(`site_requests?id=eq.${id}&site_id=eq.${row.id}`, { method: 'PATCH', body: { status: 'done', done_at: new Date().toISOString(), reply }, prefer: 'return=representation' });
    if (!done) throw new HttpError(404, 'Unknown request.');
    const to = await ownerEmail(row.user_id);
    if (to) await sendEmail(to, 'Your website change is done', [`Gainora has made the change you asked for: “${done.text}”.`, reply].filter(Boolean), { label: 'See your website', url: `${APP_ORIGIN()}/website` }).catch((e) => console.error('[gainora] done email', e?.message));
    return json({ request: done });
  }
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/site', method: 'POST' };
