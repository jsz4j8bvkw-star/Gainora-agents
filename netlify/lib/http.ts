// Reading public web pages for The Watcher. GET only, never a form submission, capped size and time.
export const UA = 'Mozilla/5.0 (compatible; GainoraWatcher/1.0; +https://gainora.co.uk/watcher)';
const MAX_BYTES = 2_000_000;

export interface Fetched { url: string; finalUrl: string; status: number; ms: number; html: string; contentType: string }

export async function fetchPage(url: string, timeoutMs = 15_000): Promise<Fetched> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.5', 'Accept-Language': 'en-GB,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const ct = res.headers.get('content-type') || '';
    let html = '';
    if (/html|xml|text|json/i.test(ct)) {
      const buf = await res.arrayBuffer();
      html = new TextDecoder().decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    } else { await res.body?.cancel().catch(() => {}); }
    return { url, finalUrl: res.url || url, status: res.status, ms: Date.now() - t0, html, contentType: ct };
  } catch {
    return { url, finalUrl: url, status: 0, ms: Date.now() - t0, html: '', contentType: '' };
  }
}

export async function linkStatus(url: string): Promise<number> {
  const opts = { headers: { 'User-Agent': UA }, redirect: 'follow' as const, signal: AbortSignal.timeout(10_000) };
  try {
    let r = await fetch(url, { ...opts, method: 'HEAD' });
    if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(url, { ...opts, method: 'GET', signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel().catch(() => {});
    return r.status;
  } catch { return 0; }
}

/** Runs `fn` over `items` with at most `size` in flight. */
export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export const okPage = (p: Fetched | undefined | null): boolean => !!p && !!p.html && p.status > 0 && p.status < 400;
