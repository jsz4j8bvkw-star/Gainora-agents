// admin.gainora.co.uk serves Gainora's admin app. Clients' own domains point at Command Centre's Netlify site. This sends every request for one of those domains
// to the website server (netlify/functions/site-serve.ts) instead of the Command Centre app. Requests for Gainora's
// own addresses carry on untouched. Visit counting and the enquiry form pass straight through to their functions.
const OWN = /(^|\.)gainora\.co\.uk$|\.netlify\.app$|^localhost$|^127\.0\.0\.1$/;

export default async (req: Request) => {
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  // Gainora's admin: every page of admin.gainora.co.uk is the admin app (files like the logo are served as they are).
  if (host === 'admin.gainora.co.uk') return /\.[a-z0-9]{2,5}$/i.test(url.pathname) ? undefined : new URL('/admin.html', req.url);
  if (OWN.test(host)) return;
  if (url.pathname === '/api/site-event' || url.pathname.startsWith('/api/site-enquiry/')) return;
  const target = new URL('/api/site-host', req.url);
  target.searchParams.set('h', host);
  target.searchParams.set('p', url.pathname);
  return target;
};

export const config = { path: "/*", excludedPath: ["/assets/*", "/api/*"] };
