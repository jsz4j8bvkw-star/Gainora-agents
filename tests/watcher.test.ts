import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkSite } from '../netlify/lib/watcher';

const PAGES: Record<string, [number, string]> = {
  '/': [200, '<title>Home</title><a href="/about">About</a><a href="/contact">Contact</a><a href="/shop">Shop</a>'],
  '/about': [200, '<p>About us</p><a href="/gone">Old page</a><a href="/">Home</a>'],
  '/contact': [200, '<form action="/send" method="post"><input name="email"><textarea name="m"></textarea></form>'],
  '/shop': [200, '<a href="/products/mug">Mug</a><a href="/products/old-set">Old set</a>'],
  '/products/mug': [200, 'Mug £18'],
};

test('checkSite crawls a site, finds broken links and a healthy contact page', async () => {
  const server = createServer((req, res) => {
    const p = PAGES[req.url!.split('?')[0]];
    res.writeHead(p ? p[0] : 404, { 'Content-Type': 'text/html' });
    res.end(p ? p[1] : 'Not found');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const prevProxy = { a: process.env.HTTPS_PROXY, b: process.env.HTTP_PROXY };
  try {
    const r = await checkSite(`http://127.0.0.1:${port}/`);
    assert.equal(r.up, true);
    assert.equal(r.contactProblem, null);
    assert.ok(r.pagesChecked >= 4);
    const broken = r.brokenLinks.map((b) => new URL(b.url).pathname).sort();
    assert.deepEqual(broken, ['/gone', '/products/old-set']);
    assert.equal(r.brokenLinks.find((b) => b.url.endsWith('/gone'))!.foundOn, `http://127.0.0.1:${port}/about`);
  } finally { server.close(); Object.assign(process.env, { HTTPS_PROXY: prevProxy.a }); }
});

test('checkSite reports a site that is down', async () => {
  const r = await checkSite('http://127.0.0.1:9/');
  assert.equal(r.up, false);
});

test('a contact page with no way to get in touch is flagged', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/' ? '<a href="/contact-us">Contact</a>' : '<p>Call in to the shop.</p>');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  try {
    const r = await checkSite(`http://127.0.0.1:${port}/`);
    assert.match(r.contactProblem || '', /no form, email link or phone link/);
  } finally { server.close(); }
});
