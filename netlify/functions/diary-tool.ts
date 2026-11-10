import { db, enc, json } from '../lib/core';
import { hashToken, toRecord, TOKEN, withDefaults } from '../lib/capture';
import { makeBooking, timesFor } from '../lib/diary';
import { findType, offerTimes, sayTime, slotId } from '../../shared/diary';
import { effectiveBookingMode } from '../../shared/capture';

// The receptionist's booking tools during a live call (Retell custom functions).
//   POST /api/diary-tool/<token>/times  { args: { treatment, team_member?, date?, part_of_day? } }
//   POST /api/diary-tool/<token>/book   { args: { slot, treatment, name, phone?, email?, new_client?, notes? } }
// Same secret token as the enquiry link. Answers are short and speakable; she reads them, never the slot ids.
// Always 200: a problem becomes something she can say ("let me take your details and the team will call you").
const say = (o: Record<string, unknown>) => json(o);
const sorry = (why: string) => say({ ok: false, note: `${why} Take their details and say the team will call back to book.` });

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const [, , , token = '', action = ''] = new URL(req.url).pathname.split('/');
    if (!TOKEN.test(token)) return sorry('The diary isn’t connected.');
    const [src] = await db<any[]>(`enquiry_sources?select=user_id&token_hash=eq.${hashToken(token)}&active=eq.true`);
    if (!src) return sorry('The diary isn’t connected.');
    const raw = await req.text();
    let b: any = {}; try { b = JSON.parse(raw || '{}'); } catch { /* empty */ }
    const a = b.args ?? b;
    const call = b.call ?? {};
    const [srow] = await db<any[]>(`capture_settings?select=data&user_id=eq.${src.user_id}`);
    const s = withDefaults(srow?.data);
    if (effectiveBookingMode(s.bookings) === 'callback') return sorry('Booking on the phone is switched off.');

    const type = findType(s, String(a.treatment || ''));
    if (!type) return say({ ok: false, note: `I don’t recognise that treatment. These can be booked: ${s.bookings.types.map((t) => t.name).filter(Boolean).join(', ')}. Ask which one they mean.` });

    if (action === 'times') {
      const days = await timesFor(src.user_id, s, { type: type.name, who: String(a.team_member || ''), from: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : undefined, days: 14 });
      const part = ['morning', 'afternoon', 'evening'].includes(a.part_of_day) ? a.part_of_day : '';
      const options = offerTimes(days, { part, count: 3 });
      if (!options.length) return say({ ok: true, options: [], note: `No free ${type.name.toLowerCase()} times${part ? ` in the ${part}` : ''} in the next two weeks${a.date ? ' from that day' : ''}. Offer another day or part of the day, or take details for a call back.` });
      return say({ ok: true, treatment: type.name, minutes: type.minutes, options: options.map((x) => ({ say: sayTime(x), slot: slotId(x) })), note: 'Offer two of these. When they choose, call book_appointment with that option’s slot exactly.' });
    }

    if (action === 'book') {
      const callId = String(call.call_id || '').slice(0, 120) || undefined;
      // Booked already on this call (a repeat of the same request): say what was booked, don't book twice.
      if (callId) {
        const [done] = await db<any[]>(`enquiries?select=*&user_id=eq.${src.user_id}&external_id=eq.${enc(callId)}&limit=1`);
        if (done) { const e = toRecord(done); return say({ ok: true, booked: e.status === 'booked', say: e.bookedFor ? sayTime({ start: e.bookedFor, end: e.bookedFor, who: e.bookedWith || '' }) : '', note: 'This call already has a booking. Confirm it with them; don’t book again.' }); }
      }
      const [start, who = ''] = String(a.slot || '').split('|');
      const r = await makeBooking(src.user_id, s, {
        type: type.name, who, start, name: String(a.name || ''), phone: String(a.phone || call.from_number || ''), email: a.email ? String(a.email) : '',
        notes: a.notes ? String(a.notes) : '', newClient: a.new_client === true ? true : a.new_client === false ? false : undefined, source: 'call', callId,
      });
      if (!r.ok) {
        if (r.reason === 'taken') {
          const days = await timesFor(src.user_id, s, { type: type.name, who, days: 14 });
          return say({ ok: false, booked: false, note: 'That time has just been taken. Apologise and offer one of these instead.', options: offerTimes(days, { count: 2 }).map((x) => ({ say: sayTime(x), slot: slotId(x) })) });
        }
        return say({ ok: false, booked: false, note: `${r.message} Ask for it, then try again.` });
      }
      return say({
        ok: true, booked: r.status === 'booked', say: r.when,
        note: r.status === 'booked'
          ? `Booked. Read back the day, date, time${r.enquiry.bookedWith ? ' and who it’s with' : ''}, and say a confirmation text is on its way.${r.deposit ? ` They need to pay a deposit (${r.deposit.what}): the link comes in that text.` : ''}`
          : 'Noted as a request. Say the team will confirm the time by text shortly.',
      });
    }
    return sorry('Something went wrong with the diary.');
  } catch (e: any) {
    console.error('[capture] diary-tool', e?.message);
    return sorry('The diary didn’t answer.');
  }
};
export const config = { path: '/api/diary-tool/:token/:action', method: 'POST' };
