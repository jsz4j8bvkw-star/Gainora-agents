import { db } from '../lib/core';
import { isBot, siteById, visitorCode } from '../lib/sites';
import { cleanEvent } from '../../shared/site/stats';

// Counts a visit, a call tap or a booking click on a live website. No cookies, no IP stored, nothing on the
// visitor's device. Always answers 204 so a page never waits on it.
const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export default async (req: Request) => {
  if (req.method !== 'POST' || isBot(req)) return done();
  try {
    const raw = await req.text();
    if (raw.length > 2000) return done();
    const e = cleanEvent(JSON.parse(raw));
    if (!e) return done();
    const site = await siteById(e.site);
    if (!site?.published) return done();
    await db('site_events', { method: 'POST', body: { site_id: site.id, at: new Date().toISOString(), kind: e.kind, path: e.path, source: e.source, device: e.device, visitor: visitorCode(req, site.id) } });
  } catch (err: any) { console.error('[gainora] site event', err?.message); }
  return done();
};
export const config = { path: '/api/site-event', method: 'POST' };
