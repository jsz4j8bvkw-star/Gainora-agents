import { db, handler, HttpError, json } from '../lib/core';
import { hashToken, intake, TOKEN } from '../lib/capture';
import type { Channel } from '../../shared/capture';

// Where the client's AI receptionist (or website form, or email forwarder) sends each enquiry.
// The secret link identifies the client. Nothing here ever contacts the customer.
// POST /api/enquiry-in/<token>  with JSON or a normal form post.
const MAX_BYTES = 256_000;

async function readBody(req: Request): Promise<any> {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, 'Too large.');
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Send JSON or a form post.'); }
}

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  if (!TOKEN.test(token)) throw new HttpError(404, 'Unknown link.');
  const [src] = await db<any[]>(`enquiry_sources?select=id,user_id,channel&token_hash=eq.${hashToken(token)}&active=eq.true`);
  if (!src) throw new HttpError(404, 'Unknown link.');

  const raw = await readBody(req);
  // Platforms also send "call started" and similar events; only finished calls carry what we need.
  if (typeof raw?.event === 'string' && /^call_(started|ended)$/.test(raw.event)) return json({ ok: true, skipped: raw.event });
  // A website form's hidden "website" field is a trap for spam bots.
  if (typeof raw?.website_url_confirm === 'string' && raw.website_url_confirm) return json({ ok: true });

  const r = await intake(src.user_id, src.id, raw, src.channel as Channel);
  await db(`enquiry_sources?id=eq.${src.id}`, { method: 'PATCH', body: { last_used_at: new Date().toISOString() } }).catch(() => {});

  // A form posted from a browser goes back to the business's own site, or a plain thank-you page.
  if ((req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded') && req.headers.get('accept')?.includes('text/html')) {
    const back = typeof raw.thanks_url === 'string' && /^https:\/\//.test(raw.thanks_url) ? raw.thanks_url : null;
    if (back) return Response.redirect(back, 303);
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><body style="font:17px/1.6 Georgia,serif;max-width:520px;margin:15vh auto;padding:0 24px;color:#1A1A1C"><h1 style="font-weight:500">Thank you</h1><p>Your message has been sent. We’ll be in touch soon.</p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return json({ ok: true, ...('saved' in r ? { id: r.saved!.id } : r) });
});
export const config = { path: '/api/enquiry-in/:token', method: 'POST' };
