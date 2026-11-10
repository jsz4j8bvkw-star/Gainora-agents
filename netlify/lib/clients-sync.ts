// Capture & Convert → Command Centre's "Your clients" (same Gainora login, same database).
// When an appointment is marked attended (or past visits are imported), the client and the visit are added to
// the owner's client list, so Command Centre's due-back reminders and the receptionist's returning-caller lookup
// both know about them, without anyone typing them twice. Quietly does nothing if the client list isn't set up.
import { db, enc } from './core';
import { normPhone, typePrice, type CaptureSettings, type EnquiryRecord } from '../../shared/capture';

export interface VisitIn { name: string; phone: string; email: string; on: string; treatment: string; amount: number | null; who: string }

const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));

export function visitFrom(e: EnquiryRecord, s: CaptureSettings): VisitIn | null {
  if (e.status !== 'won' || e.isTest || s.business.kind !== 'appointments') return null;
  const at = [...e.history].reverse().find((h) => /^(Attended|Job done)/.test(h.text))?.at ?? e.bookedFor ?? e.receivedAt;
  const phone = normPhone(e.phone);
  if (!e.name.trim() || (!/^\+\d{10,15}$/.test(phone) && !e.email)) return null;
  return { name: e.name.trim().slice(0, 160), phone: /^\+\d{10,15}$/.test(phone) ? phone : '', email: e.email.toLowerCase(), on: day(at),
    treatment: (e.bookedType || 'Visit').slice(0, 120), amount: e.jobValue ?? typePrice(e.bookedType, s.bookings.types)?.amount ?? null, who: (e.bookedWith || '').slice(0, 80) };
}

/** Adds the visits to the owner's client list. Returns how many visits were new. */
export async function syncVisits(userId: string, visits: VisitIn[]): Promise<number> {
  if (!visits.length) return 0;
  try {
    let added = 0;
    const byKey = new Map<string, string>();   // phone or email → client id
    for (const v of visits) {
      const key = v.phone || v.email;
      let id = byKey.get(key);
      if (!id) {
        const [c] = await db<any[]>(`clients?select=id&user_id=eq.${userId}&${v.phone ? `phone=eq.${enc(v.phone)}` : `email=eq.${enc(v.email)}`}&limit=1`);
        id = c?.id;
        if (!id) {
          const [made] = await db<any[]>('clients', { method: 'POST', prefer: 'return=representation', body: { user_id: userId, name: v.name, phone: v.phone, email: v.email, source: 'import', imported_from: 'Capture & Convert' } });
          id = made?.id;
        }
        if (!id) continue;
        byKey.set(key, id);
      }
      const [seen] = await db<any[]>(`client_visits?select=id&user_id=eq.${userId}&client_id=eq.${id}&visited_on=eq.${v.on}&treatment=eq.${enc(v.treatment)}&limit=1`);
      if (seen) continue;
      await db('client_visits', { method: 'POST', body: { user_id: userId, client_id: id, visited_on: v.on, treatment: v.treatment, amount: v.amount, practitioner: v.who || null } });
      added++;
    }
    return added;
  } catch (e: any) {
    console.error('[capture] client list sync skipped', e?.message);   // not set up, or a hiccup: never blocks the owner
    return 0;
  }
}
