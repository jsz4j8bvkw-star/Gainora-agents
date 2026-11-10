// Server side of the diary: who is already booked, free times, and making a booking. Used by the clinic's
// booking page (functions/book.ts) and by the receptionist's tools during a call (functions/diary-tool.ts),
// so a time can never be given out twice by the two of them.
import { db, enc, insert } from './core';
import { appUrl, toRecord, withDefaults } from './capture';
import { sendEmail } from './email';
import { runAutomations } from './messages';
import { externalBusy, pushBooking } from './connections';
import {
  depositRule, depositCovers, effectiveBookingMode, isAfterHours, NEW_CLIENT, normPhone, RETURNING_CLIENT,
  type CaptureSettings, type EnquiryRecord,
} from '../../shared/capture';
import { busyFromBookings, findType, freeTimes, londonDate, matchStaff, pageOf, sayTime, stillFree, tooMany, type Busy, type DayTimes } from '../../shared/diary';

const DAY = 86_400_000;
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Everything already booked between two times: Gainora's own bookings plus the clinic's connected calendar. */
export async function busyBetween(userId: string, s: CaptureSettings, from: Date, to: Date): Promise<Busy[]> {
  const rows = await db<any[]>(`enquiries?select=id,status,booked_for,booked_type,booked_with,is_test,received_at,phone,history&user_id=eq.${userId}&status=eq.booked&is_test=eq.false&booked_for=gte.${new Date(from.getTime() - DAY).toISOString()}&booked_for=lt.${new Date(to.getTime() + DAY).toISOString()}&limit=2000`);
  const mine = busyFromBookings(rows.map((r) => ({ ...toRecord({ ...r, name: '', summary: '' }), history: r.history ?? [] })), s, from);
  const theirs = await externalBusy(userId, s, from, to).catch((e) => { console.error('[capture] calendar busy', e?.message); return [] as Busy[]; });
  return [...mine, ...theirs];
}

/** Free times for a treatment, from a UK date, for a number of days. */
export async function timesFor(userId: string, s: CaptureSettings, q: { type: string; who?: string; from?: string; days?: number }, now = new Date()): Promise<DayTimes[]> {
  const days = Math.min(Math.max(1, q.days ?? 7), 21);
  const fromDate = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? new Date(`${q.from}T00:00:00Z`) : now;
  const busy = await busyBetween(userId, s, new Date(Math.max(now.getTime(), fromDate.getTime() - DAY)), new Date(fromDate.getTime() + (days + 1) * DAY));
  return freeTimes(s, { type: q.type, who: q.who, from: q.from || londonDate(now), days, busy, now });
}

export interface BookingInput {
  type: string; who?: string; start: string;
  name: string; phone: string; email?: string; notes?: string;
  /** What the client or caller said: true new, false been before, undefined unknown. */
  newClient?: boolean;
  source: 'page' | 'call' | 'owner';
  /** The phone platform's call id, so the call's summary joins this booking instead of making a second enquiry. */
  callId?: string;
}

export type BookingResult =
  | { ok: true; status: 'booked' | 'requested'; enquiry: EnquiryRecord; when: string; deposit: { what: string; link: string } | null }
  | { ok: false; reason: 'taken' | 'invalid' | 'too_many' | 'closed'; message: string; field?: string };

/**
 * Books a time (or, for a clinic that confirms each one, asks for it). Checks the time is still free, saves it
 * as an enquiry the owner sees in the inbox, puts it in their connected calendar, and lets the booking
 * confirmation (and deposit line, if it applies) go out. Never takes payments.
 */
export async function makeBooking(userId: string, s: CaptureSettings, input: BookingInput, now = new Date()): Promise<BookingResult> {
  const type = findType(s, input.type);
  if (!type) return { ok: false, reason: 'invalid', message: 'Choose a treatment.', field: 'type' };
  const name = clean(input.name, 120);
  if (name.length < 2) return { ok: false, reason: 'invalid', message: 'Add your name.', field: 'name' };
  const phone = normPhone(input.phone || '');
  if (!/^\+\d{10,15}$/.test(phone)) return { ok: false, reason: 'invalid', message: 'Add a phone number we can reach you on.', field: 'phone' };
  const email = clean(input.email, 200).toLowerCase();
  if (email && !EMAIL.test(email)) return { ok: false, reason: 'invalid', message: 'That email address doesn’t look right.', field: 'email' };
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: 'invalid', message: 'Choose a time.', field: 'start' };
  const who = matchStaff(s, input.who);

  const recent = await db<any[]>(`enquiries?select=phone,received_at&user_id=eq.${userId}&phone=eq.${enc(phone)}&received_at=gte.${new Date(now.getTime() - 3_600_000).toISOString()}&limit=5`);
  if (input.source === 'page' && tooMany(recent.map((r) => ({ phone: r.phone, receivedAt: r.received_at }) as any), phone, now)) {
    return { ok: false, reason: 'too_many', message: `You’ve asked for a few times already. Please call ${s.business.name} to book.` };
  }
  const busy = await busyBetween(userId, s, new Date(start.getTime() - DAY), new Date(start.getTime() + DAY));
  if (!stillFree(s, type.name, start.toISOString(), who, busy, now)) {
    return { ok: false, reason: 'taken', message: 'Sorry, that time has just gone. Please choose another.' };
  }
  // Who it's with: the person asked for, or the first free one at that time.
  const slot = freeTimes(s, { type: type.name, who, from: londonDate(start), days: 1, busy, now })
    .flatMap((d) => d.slots).find((x) => x.start === start.toISOString());
  const withWho = slot?.who ?? who;

  // New or returning: what they said, checked against anyone with an attended visit from the same number.
  const before = await db<any[]>(`enquiries?select=id&user_id=eq.${userId}&phone=eq.${enc(phone)}&status=eq.won&is_test=eq.false&limit=1`);
  const returning = before.length > 0 || input.newClient === false;
  const mode = input.source === 'owner' ? 'book' : input.source === 'page' ? pageOf(s).mode : effectiveBookingMode(s.bookings) === 'book' ? 'book' : 'request';
  const when = sayTime({ start: start.toISOString(), end: start.toISOString(), who: withWho });
  const at = now.toISOString();
  const history = [
    { at, text: input.source === 'owner' ? 'Logged by you' : input.source === 'page' ? (mode === 'book' ? 'Booked online by the client' : 'Asked online for a time') : (mode === 'book' ? 'Booked by your receptionist during the call' : 'Asked for a time on the call') },
    ...(input.newClient === true && !returning ? [{ at, text: NEW_CLIENT }] : returning ? [{ at, text: RETURNING_CLIENT }] : []),
    ...(mode === 'book' ? [{ at, text: `Booked in for ${start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })}: ${type.name}${withWho ? ` with ${withWho}` : ''}` }] : [{ at, text: `Requested: ${start.toISOString()}|${withWho}|${type.name}` }]),
  ];
  const notes = clean(input.notes, 600);
  const summary = `${mode === 'book' ? 'Booked' : 'Asked for'} ${type.name.toLowerCase()} ${mode === 'book' ? 'for' : 'on'} ${when}${input.source === 'page' ? ' online' : input.source === 'call' ? ' on the call' : ''}.${input.newClient === true && !returning ? ' New client.' : returning ? ' Returning client.' : ''}${notes ? ` Note: “${notes}”` : ''}`;

  const row = {
    user_id: userId, channel: input.source === 'page' ? 'form' : 'call', external_id: input.callId ? clean(input.callId, 120) : null,
    name, phone, email, postcode: '', summary, transcript: '', recording_url: '', urgency: 'normal', kind: 'booking', reasons: [],
    status: mode === 'book' ? 'booked' : 'new', after_hours: isAfterHours(at, s.calls), history, is_test: false, received_at: at,
    ...(mode === 'book' ? { booked_for: start.toISOString(), booked_type: type.name, booked_with: withWho, replied_at: at } : {}),
  };
  const [saved] = await insert('enquiries', row);
  const enquiry = toRecord(saved);

  if (mode === 'book') {
    await pushBooking(userId, s, { start: start.toISOString(), minutes: type.minutes, type: type.name, who: withWho, name, phone, email, notes, enquiryId: enquiry.id })
      .catch((e) => console.error('[capture] calendar push', e?.message));
  }
  // The booking confirmation (and deposit line) goes out now, if those messages are switched on.
  await runAutomations(userId, [enquiry.id]).catch((e) => console.error('[capture] automations', e?.message));
  if (input.source !== 'owner' && s.calls.notify === 'all' && s.business.alertEmail) {
    await sendEmail(s.business.alertEmail, `${mode === 'book' ? 'New booking' : 'Time requested'}: ${name}, ${when}`, [
      summary, `Phone: ${phone}${email ? `   Email: ${email}` : ''}`,
      mode === 'request' ? 'They’re waiting for you to confirm the time.' : 'The confirmation text has gone to them.',
    ], { label: 'Open it', url: `${appUrl()}/enquiries/${enquiry.id}` }).catch(() => {});
  }
  const rule = depositRule(s.bookings);
  const owes = !!rule && depositCovers(rule, type.name) && (rule.forWho === 'all' || (input.newClient === true && !returning));
  return { ok: true, status: mode === 'book' ? 'booked' : 'requested', enquiry, when, deposit: owes ? { what: rule!.what, link: rule!.link } : null };
}

/** The clinic behind a booking page address, if the page is switched on and their plan is active. */
export async function clinicBySlug(slug: string): Promise<{ userId: string; s: CaptureSettings } | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const rows = await db<any[]>(`capture_settings?select=user_id,data&data->page->>slug=eq.${enc(slug)}&limit=2`);
  const row = rows.find((r) => r.data?.page?.on === true);
  if (!row) return null;
  const ent = await db<any[]>(`entitlements?select=user_id&agent=eq.capture&status=in.(active,trialing)&user_id=eq.${row.user_id}&limit=1`);
  if (!ent.length) return null;
  return { userId: row.user_id, s: withDefaults(row.data) };
}
