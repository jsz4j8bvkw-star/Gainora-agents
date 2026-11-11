// Minimal offline shell: cache the app files, always fetch data fresh.
const CACHE = 'gainora-shell-v4';
// The admin's pages, including its old addresses from before it moved under /admin: never Command Centre's shell.
const ADMIN_ONLY = /^\/(me|sales|delivery|requests|health|money|prices|paperwork|more)(\/|$)/;
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Clients' websites (/site/…), proposals (/p/…) and unsubscribe pages (/u/…) are their own pages, never the app shell.
  if (e.request.method !== 'GET' || url.origin !== location.origin || /^\/(api|site|p|u|q)\//.test(url.pathname) || /^\/admin(\.html)?(\/|$)/.test(url.pathname) || ADMIN_ONLY.test(url.pathname)) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok && r.type === 'basic' && !r.redirected) { const c = r.clone(); caches.open(CACHE).then((x) => x.put('/', c)); } return r; }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })));
  }
});
