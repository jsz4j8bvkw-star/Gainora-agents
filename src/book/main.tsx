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
createRoot(document.getElementById('root')!).render(<BookingPage api={api} />);
