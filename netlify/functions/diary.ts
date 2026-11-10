import { body, db, enc, handler, HttpError, json, requireCapture, getSettings } from '../lib/core';
import { normPhone } from '../../shared/capture';
import { withDefaults } from '../lib/capture';
import { makeBooking, timesFor } from '../lib/diary';
import { slotId, slugify } from '../../shared/diary';

// The owner's diary actions, signed in.
//   times – free times for a treatment · book – put a booking in the diary · slug – is a booking page address free?
//   import – appointments from the clinic's old system (upcoming ones into the diary, past ones as visit history)
export default handler(async (req) => {
  const user = await requireCapture(req);
  const b = await body<any>(req);
  const s = withDefaults(await getSettings(user.id));

  if (b.op === 'times') {
    const days = await timesFor(user.id, s, { type: String(b.type || ''), who: String(b.who || ''), from: b.from, days: Number(b.days) || 7 });
    return json({ days: days.map((d) => ({ date: d.date, label: d.label, slots: d.slots.map((x) => ({ id: slotId(x), start: x.start, who: x.who })) })) });
  }
  if (b.op === 'book') {
    const [start, who = ''] = String(b.slot || '').split('|');
    const r = await makeBooking(user.id, s, { type: String(b.type || ''), who, start, name: b.name, phone: b.phone, email: b.email, notes: b.notes, newClient: typeof b.newClient === 'boolean' ? b.newClient : undefined, source: 'owner' });
    if (!r.ok) throw new HttpError(r.reason === 'taken' ? 409 : 400, r.message);
    return json({ enquiry: r.enquiry });
  }
  if (b.op === 'slug') {
    const slug = slugify(String(b.slug || ''));
    const rows = await db<any[]>(`capture_settings?select=user_id&data->page->>slug=eq.${enc(slug)}&user_id=neq.${user.id}&limit=1`);
    return json({ slug, free: rows.length === 0 });
  }
  if (b.op === 'import') {
    const list = Array.isArray(b.bookings) ? b.bookings.slice(0, 5000) : [];
    const from = String(b.system || 'your old system').replace(/[^\w &().'-]/g, '').slice(0, 40) || 'your old system';
    const now = new Date().toISOString();
    const rows: any[] = [];
    for (const x of list) {
      const name = String(x?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const phone = normPhone(String(x?.phone || ''));
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x?.email || '')) ? String(x.email).toLowerCase().slice(0, 200) : '';
      const start = new Date(String(x?.start || ''));
      if (!name || Number.isNaN(start.getTime()) || (!/^\+\d{10,15}$/.test(phone) && !email)) continue;
      const past = start.getTime() < Date.now();
      const type = String(x?.type || '').slice(0, 80);
      const who = String(x?.who || '').slice(0, 40);
      const price = typeof x?.price === 'number' && x.price > 0 && x.price < 100000 ? x.price : null;
      const at = start.toISOString();
      rows.push({
        user_id: user.id, channel: 'call', external_id: `import:${phone || email}:${at}`.slice(0, 120), name, phone: /^\+\d{10,15}$/.test(phone) ? phone : '', email,
        postcode: '', summary: `${past ? 'Visit' : 'Booking'} imported from ${from}${type ? `: ${type}` : ''}.`, transcript: '', recording_url: '', urgency: 'normal', kind: 'booking', reasons: [],
        status: past ? 'won' : 'booked', booked_for: at, booked_type: type, booked_with: who, after_hours: false, is_test: false,
        received_at: past ? at : now, replied_at: past ? at : now,
        ...(past ? { job_value: price, paid_at: at, review_asked_at: at } : {}),
        history: [{ at: now, text: `Imported from ${from}` }, ...(past ? [{ at, text: 'Attended' }] : [{ at: now, text: `Booked in for ${start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })}${type ? `: ${type}` : ''}${who ? ` with ${who}` : ''}` }])],
      });
    }
    let added = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const saved = await db<any[]>('enquiries?on_conflict=user_id,external_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: rows.slice(i, i + 200) });
      added += saved?.length ?? 0;
    }
    return json({ added, already: rows.length - added, rejected: list.length - rows.length });
  }
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/diary', method: 'POST' };
