import { robots, renderPage, sitemap } from '../../shared/site/render';
import { withDefaults } from '../../shared/site/data';
import { APP_ORIGIN, siteByDomain, siteBySlug, type SiteRow } from '../lib/sites';

// Serves the published websites.
//   GET /site/<slug>/...          the site's Gainora address (works before it has a domain; not indexed by Google)
//   GET /api/site-host?h=&p=      the site on its own domain (the edge function in netlify/edge-functions/sites.ts
//                                 sends every request for a client's domain here)
const page = (html: string, status = 200, cache = 'public, max-age=60, stale-while-revalidate=600') =>
  new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache, 'X-Robots-Tag': 'all', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } });
const text = (body: string, type: string) => new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=300' } });

const NOT_FOUND = (home: string) => `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title><body style="font:17px/1.6 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 24px;color:#1B1C1E"><h1 style="font-weight:600">Page not found</h1><p>That page isn’t here. <a href="${home}">Go to the home page</a>.</p></body></html>`;
const NOT_LIVE = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Coming soon</title><body style="font:17px/1.6 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 24px;color:#1B1C1E"><h1 style="font-weight:600">Coming soon</h1><p>This website is being built. Check back shortly.</p></body></html>`;

function serve(row: SiteRow | null, path: string, base: string, origin: string, indexable: boolean): Response {
  if (!row?.published) return page(NOT_LIVE, 404, 'no-store');
  const s = withDefaults(row.published);
  if (path === 'sitemap.xml') return text(sitemap(s, origin), 'application/xml');
  if (path === 'robots.txt') return text(robots(origin, indexable), 'text/plain');
  const out = renderPage(s, path, { base, siteId: row.id, origin });
  if (!out) return page(NOT_FOUND(base), 404);
  let html = out.html;
  if (!indexable && !/name="robots"/.test(html)) html = html.replace('<meta name="description"', '<meta name="robots" content="noindex"><meta name="description"');
  return page(html);
}

export default async (req: Request) => {
  const url = new URL(req.url);
  try {
    if (url.pathname === '/api/site-host') {
      const host = (url.searchParams.get('h') || '').toLowerCase();
      const row = await siteByDomain(host);
      const path = (url.searchParams.get('p') || '/').replace(/^\/+/, '');
      return serve(row, path, '/', `https://${row?.domain ?? host}`, true);
    }
    const m = url.pathname.match(/^\/site\/([a-z0-9-]{3,60})(\/.*)?$/);
    if (!m) return page(NOT_FOUND('/'), 404);
    if (!m[2]) return Response.redirect(`${url.origin}/site/${m[1]}/`, 301);
    const row = await siteBySlug(m[1]);
    // Before the site has a domain this is its address; once it has one, Google is pointed there instead.
    const origin = row?.domain ? `https://${row.domain}` : `${APP_ORIGIN()}/site/${m[1]}`;
    return serve(row, m[2].replace(/^\/+/, ''), `/site/${m[1]}/`, origin, false);
  } catch (e: any) {
    console.error('[gainora] site serve', e?.message);
    return page('<!doctype html><meta charset="utf-8"><title>Back soon</title><p style="font:17px system-ui;margin:20vh auto;max-width:480px;padding:0 24px">This website is having a moment. Try again in a minute.</p>', 503, 'no-store');
  }
};
export const config = { path: ['/site/*', '/api/site-host'] };
