import { db, insert } from '../lib/core';
import { sendEmail } from '../lib/email';
import { APP_ORIGIN, isBot, ownerEmail, siteById, visitorCode } from '../lib/sites';

// A message sent through a live website's form.
//   POST /api/site-enquiry/<site id>   (a normal form post)
// Saved for the owner (Command Centre → Website → Enquiries), emailed to them, passed to Capture & Convert when
// they have it, then the visitor lands on the site's thank-you page.
const MAX = 20_000;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

export default async (req: Request) => {
  const url = new URL(req.url);
  const id = url.pathname.split('/').filter(Boolean).pop() || '';
  const site = await siteById(id).catch(() => null);
  const onApp = url.hostname === new URL(APP_ORIGIN()).hostname || /netlify\.app$|localhost|127\.0\.0\.1/.test(url.hostname);
  const external = String(site?.published?.external?.url || '');
  const base = external ? `${external}/` : site ? (onApp ? `/site/${site.slug}/` : '/') : '/';
  const back = (path: string) => new Response(null, { status: 303, headers: { Location: `${base}${path}`, 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST' || !site?.published) return back('');
  try {
    const raw = await req.text();
    if (raw.length > MAX) return back('contact/');
    const f = Object.fromEntries(new URLSearchParams(raw));
    if (f.website_url_confirm || isBot(req)) return back('thanks/');   // the hidden field only bots fill in
    const name = clip(f.name, 120); const phone = clip(f.phone, 40); const email = clip(f.email, 160).toLowerCase();
    if (!name || (!phone && !email)) return back('contact/#enquire');
    const visitor = visitorCode(req, site.id);
    // More than five messages an hour from the same visitor is someone testing or a bot: thank them, keep nothing.
    const recent = await db<any[]>(`site_events?select=id&site_id=eq.${site.id}&kind=eq.enquiry&visitor=eq.${visitor}&at=gte.${new Date(Date.now() - 3_600_000).toISOString()}`);
    if (recent.length >= 5) return back('thanks/');
    const source = clip(f.source, 60) || 'Direct';
    const row = { site_id: site.id, user_id: site.user_id, at: new Date().toISOString(), name, phone, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', service: clip(f.service, 80), postcode: clip(f.postcode, 10).toUpperCase(), message: clip(f.message, 2000), page: clip(f.page, 200), source };
    const [saved] = await insert<any>('site_enquiries', row);
    await db('site_events', { method: 'POST', body: { site_id: site.id, at: new Date().toISOString(), kind: 'enquiry', path: row.page.startsWith('/') ? row.page : '/', source, device: /mobile|iphone|android/i.test(req.headers.get('user-agent') || '') ? 'phone' : 'computer', visitor } });

    // Capture & Convert: the enquiry also lands in their inbox there, with its follow-ups.
    const cc = String(site.published?.captureFormUrl || '');
    if (/^https:\/\/capture\.gainora\.co\.uk\/api\/enquiry-in\//.test(cc)) {
      const message = [row.service && `Interested in: ${row.service}`, row.message, `Sent from the website (${source})`].filter(Boolean).join('\n');
      const ok = await fetch(cc, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name, phone, email: row.email, postcode: row.postcode, message }).toString(), signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false);
      if (ok && saved?.id) await db(`site_enquiries?id=eq.${saved.id}`, { method: 'PATCH', body: { forwarded: true } }).catch(() => {});
    }
    // Email the owner.
    const to = await ownerEmail(site.user_id);
    if (to) {
      await sendEmail(to, `New website enquiry from ${name}`, [
        `${name} sent a message through your website${row.service ? ` about ${row.service.toLowerCase()}` : ''}.`,
        [phone && `Phone: ${phone}`, row.email && `Email: ${row.email}`, row.postcode && `Postcode: ${row.postcode}`].filter(Boolean).join('\n'),
        row.message ? `“${row.message}”` : '',
        `They found you through: ${source}.`,
      ].filter(Boolean), { label: 'See it in Command Centre', url: `${APP_ORIGIN()}/website` }).catch((e) => console.error('[gainora] enquiry email', e?.message));
    }
  } catch (e: any) {
    console.error('[gainora] site enquiry', e?.message);
  }
  return back('thanks/');
};
export const config = { path: '/api/site-enquiry/*', method: 'POST' };
