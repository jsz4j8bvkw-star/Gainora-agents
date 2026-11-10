import { body, db, enc, handler, HttpError, json, requireCapture, getSettings } from '../lib/core';
import { withDefaults } from '../lib/capture';
import { makeBooking, timesFor } from '../lib/diary';
import { slotId, slugify } from '../../shared/diary';

// The owner's diary actions, signed in.
//   times – free times for a treatment · book – put a booking in the diary · slug – is a booking page address free?
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
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/diary', method: 'POST' };
