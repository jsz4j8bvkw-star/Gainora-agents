// The standalone booking page at /book/<slug>. Small on purpose: no sign-in, no app code.
import { createRoot } from 'react-dom/client';
import './book.css';
import { BookingPage, type PageApi } from './BookingPage';

const slug = (location.pathname.split('/').filter(Boolean)[1] || '').toLowerCase();
const base = `/api/book/${encodeURIComponent(slug)}`;
const get = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'This booking page isn’t available.');
  return j;
};
const api: PageApi = {
  info: () => get(base),
  times: (type, who, from, days) => get(`${base}/times?type=${encodeURIComponent(type)}&who=${encodeURIComponent(who)}&from=${from}&days=${days}`),
  async book(body) {
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { ok: false, message: j.message || j.error || 'That didn’t go through. Please try again.', field: j.field, reason: j.reason };
  },
};
document.title = 'Book online';
// Inside a business's own website (an iframe): tell the page around us how tall we are and which step we're on,
// so it can size the frame to fit and bring it into view. Only the height and the step name are sent.
const framed = window.parent !== window;
let lastStep = 'type';
const height = () => Math.ceil((document.querySelector('.bk') as HTMLElement | null)?.getBoundingClientRect().height || document.body.scrollHeight);
const tell = () => { if (framed) window.parent.postMessage({ gainoraBookHeight: height(), gainoraBookStep: lastStep }, '*'); };
if (framed && 'ResizeObserver' in window) new ResizeObserver(tell).observe(document.body);
createRoot(document.getElementById('root')!).render(<BookingPage api={api} onStep={(s) => { lastStep = s; tell(); }} />);
