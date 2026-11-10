import { HttpError, json } from '../lib/core';
import { clinicBySlug, makeBooking, timesFor } from '../lib/diary';
import { depositRule } from '../../shared/capture';
import { publicPage, slotId } from '../../shared/diary';
import { fromNumber, textingReady } from '../lib/messages';

// The clinic's public booking page talks to this. No sign-in: the page address (slug) picks the clinic, and
// only clinics that switched their page on, on an active plan, answer.
//   GET  /api/book/<slug>                 the clinic's name, treatments, team and rules
//   GET  /api/book/<slug>/times?type=…    free times, day by day
//   POST /api/book/<slug>                 book (or ask for) a time
const MAX = 8_000;

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const [, , , slug = '', sub = ''] = url.pathname.split('/');
    const clinic = await clinicBySlug(slug.toLowerCase());
    if (!clinic) return json({ error: 'This booking page isn’t available.' }, 404);
    const { userId, s } = clinic;

    if (req.method === 'GET' && !sub) {
      const r = depositRule(s.bookings);
      return json(publicPage(s, r ? { what: r.what, forWho: r.forWho, types: r.types } : null, { texts: textingReady() && !!fromNumber(s) }));
    }
    if (req.method === 'GET' && sub === 'times') {
      const type = String(url.searchParams.get('type') || '');
      const days = await timesFor(userId, s, { type, who: url.searchParams.get('who') || '', from: url.searchParams.get('from') || undefined, days: Number(url.searchParams.get('days')) || 7 });
      return json({ days: days.map((d) => ({ date: d.date, label: d.label, slots: d.slots.map((x) => ({ id: slotId(x), start: x.start, who: x.who })) })) });
    }
    if (req.method === 'POST' && !sub) {
      const raw = await req.text();
      if (raw.length > MAX) throw new HttpError(413, 'Too large.');
      let b: any; try { b = JSON.parse(raw); } catch { throw new HttpError(400, 'Something went wrong. Please try again.'); }
      if (typeof b.website_url_confirm === 'string' && b.website_url_confirm) return json({ ok: true, status: 'booked' });   // bots fill the hidden field
      const [start, who = ''] = String(b.slot || '').split('|');
      const r = await makeBooking(userId, s, { type: String(b.type || ''), who, start, name: b.name, phone: b.phone, email: b.email, notes: b.notes, newClient: typeof b.newClient === 'boolean' ? b.newClient : undefined, source: 'page' });
      if (!r.ok) return json({ ok: false, reason: r.reason, message: r.message, field: r.field }, r.reason === 'taken' ? 409 : r.reason === 'too_many' ? 429 : 400);
      return json({ ok: true, status: r.status, when: r.when, type: r.enquiry.bookedType || String(b.type), deposit: r.deposit });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e: any) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[capture] book', e?.message);
    return json({ error: 'Something went wrong on our side. Please try again, or call the clinic.' }, 500);
  }
};
export const config = { path: ['/api/book/:slug', '/api/book/:slug/:sub'] };
