// Capture & Convert server helpers: secret enquiry links, saving an enquiry, owner alerts and the reply drafter.
import { createHash, randomBytes } from 'node:crypto';
import { db, env } from './core';
import { ai, hasBanned, HOUSE_STYLE } from './ai';
import { sendEmail } from './email';
import {
  isAfterHours, isBeauty, lines, normaliseEnquiry, triage, withDefaults,
  type CaptureSettings, type Channel, type EnquiryRecord,
} from '../../shared/capture';
import { suggestReply } from '../../shared/insight';

export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** Tokens are 32 URL-safe characters; anything else is refused before touching the database. */
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const appUrl = () => env('APP_URL', 'https://capture.gainora.co.uk').replace(/\/$/, '');

export { withDefaults };

export const toRecord = (r: any): EnquiryRecord => ({
  id: r.id, channel: r.channel, name: r.name ?? '', phone: r.phone ?? '', email: r.email ?? '', postcode: r.postcode ?? '',
  summary: r.summary ?? '', transcript: r.transcript ?? '', recordingUrl: r.recording_url ?? '',
  urgency: r.urgency, kind: r.kind, reasons: r.reasons ?? [], status: r.status, afterHours: !!r.after_hours,
  notes: r.notes ?? '', history: r.history ?? [], repliedAt: r.replied_at ?? null,
  quoteAmount: r.quote_amount != null ? Number(r.quote_amount) : null, quotedAt: r.quoted_at ?? null, chasersSent: Number(r.chasers_sent ?? 0),
  bookedFor: r.booked_for ?? null, bookedType: r.booked_type ?? '', bookedWith: r.booked_with ?? '', jobValue: r.job_value != null ? Number(r.job_value) : null, invoiceDue: r.invoice_due ?? null,
  paidAt: r.paid_at ?? null, paymentRemindersSent: Number(r.payment_reminders_sent ?? 0), reviewAskedAt: r.review_asked_at ?? null,
  receivedAt: r.received_at, isTest: !!r.is_test,
});

/** The database columns a change touches. */
export const toRow = (e: EnquiryRecord) => ({
  name: e.name, phone: e.phone, email: e.email, postcode: e.postcode, kind: e.kind, status: e.status, notes: e.notes, history: e.history.slice(-100),
  replied_at: e.repliedAt, quote_amount: e.quoteAmount, quoted_at: e.quotedAt, chasers_sent: e.chasersSent, booked_for: e.bookedFor, booked_type: e.bookedType ?? '', booked_with: e.bookedWith ?? '',
  job_value: e.jobValue, invoice_due: e.invoiceDue, paid_at: e.paidAt, payment_reminders_sent: e.paymentRemindersSent,
  review_asked_at: e.reviewAskedAt, updated_at: new Date().toISOString(),
});

/**
 * Saves one enquiry from any source. Works out urgency, kind and out-of-hours, ignores the platform's
 * retries, and emails the owner about emergencies (or every enquiry, if they chose that).
 * It never contacts the customer.
 */
export async function intake(userId: string, sourceId: string | null, raw: any, hint: Channel | undefined, opts: { test?: boolean; ownerEmail?: string } = {}) {
  const e = normaliseEnquiry(raw, hint);
  if (!e) return { skipped: 'empty' as const };
  const t = triage(`${e.summary}\n${e.transcript}`, { callType: e.facts.callType, booked: e.facts.booked });
  const [settingsRow] = await db<any[]>(`capture_settings?select=data&user_id=eq.${userId}`);
  const s = withDefaults(settingsRow?.data);
  const afterHours = isAfterHours(e.receivedAt, s.calls);
  const history = [{ at: e.receivedAt, text: `${e.channel === 'call' ? 'Call answered by your receptionist' : e.channel === 'form' ? 'Website form received' : e.channel === 'email' ? 'Email received' : 'Text received'}${afterHours ? ' (out of hours)' : ''}` }];
  if (t.urgency !== 'normal') history.push({ at: e.receivedAt, text: `${t.urgency === 'emergency' ? 'Flagged as an emergency' : 'Flagged as urgent'}: ${t.reasons.join('; ')}` });
  // Booked on the call, with a time the receptionist agreed: it lands as a booking, so the confirmation text
  // goes out (if that automation is on) and the owner has nothing to re-type. Only when the time is sane.
  const bookedOnCall = t.kind !== 'spam' && t.urgency !== 'emergency' && e.facts.booked && !!e.facts.bookedFor;
  if (bookedOnCall) history.push({ at: e.receivedAt, text: `Booked in on the call for ${new Date(e.facts.bookedFor!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })}${e.facts.appointmentType ? `: ${e.facts.appointmentType}` : ''}${e.facts.bookedWith ? ` with ${e.facts.bookedWith}` : ''}` });

  const rows = await db<any[]>(e.externalId ? 'enquiries?on_conflict=user_id,external_id' : 'enquiries', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: {
      user_id: userId, source_id: sourceId, channel: e.channel, external_id: e.externalId, name: e.name, phone: e.phone, email: e.email,
      postcode: e.postcode, summary: e.summary, transcript: e.transcript, recording_url: e.recordingUrl,
      urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: t.kind === 'spam' ? 'spam' : bookedOnCall ? 'booked' : 'new',
      ...(bookedOnCall ? { booked_for: e.facts.bookedFor, booked_type: e.facts.appointmentType.slice(0, 80), booked_with: e.facts.bookedWith.slice(0, 80), replied_at: e.receivedAt } : {}),
      after_hours: afterHours, history, is_test: !!opts.test, received_at: e.receivedAt,
    },
  });
  const saved = rows?.[0];
  if (!saved) return { duplicate: true as const };

  const to = s.business.alertEmail || opts.ownerEmail;
  const wantsEmail = t.kind !== 'spam' && (t.urgency !== 'normal' || s.calls.notify === 'all');
  if (to && wantsEmail) {
    const who = e.name || e.phone || 'A customer';
    const subject = t.urgency === 'emergency' ? `Emergency: ${who}${e.postcode ? `, ${e.postcode}` : ''}` : t.urgency === 'urgent' ? `Urgent enquiry: ${who}` : `New enquiry: ${who}`;
    await sendEmail(to, subject, [
      ...(t.gas ? ['The caller mentioned gas. Your receptionist told them to ring the National Gas Emergency line on 0800 111 999.'] : []),
      e.summary || 'No summary was sent with this enquiry.',
      [e.phone && `Phone: ${e.phone}`, e.email && `Email: ${e.email}`, e.postcode && `Postcode: ${e.postcode}`].filter(Boolean).join('   '),
      afterHours ? 'This came in out of hours.' : '',
    ].filter(Boolean), { label: 'Open the enquiry', url: `${appUrl()}/enquiries/${saved.id}` }).catch((err) => console.error('[capture] alert email', err?.message));
  }
  return { saved: toRecord(saved) };
}

/**
 * The owner's reply to an enquiry, drafted for them. Starts from the rule-based draft (shared/insight.ts), which
 * already reads the client's last message and the booking; the AI only polishes it when a key is set, with the
 * same facts and the same limits. Never sent by Gainora. Never medical, aftercare or technical advice.
 */
export async function draftEnquiryReply(userId: string, s: CaptureSettings, e: EnquiryRecord, lastReply: { body: string; at: string } | null = null): Promise<string> {
  const channel: Channel = e.email && !e.phone ? 'email' : 'text';
  const appts = s.business.kind === 'appointments';
  const beauty = isBeauty(s.business);
  const fallback = suggestReply(e, s, { unreadReply: lastReply, channel });
  let text = fallback;
  // Anything that reads as a health concern is answered by a person, never by a model.
  if (beauty && lastReply && /\b(pain|swell|swollen|rash|blister|bleed|infect|allerg|react|pregnan|breastfeed|medication|lump|bruis|numb|burn|fever|unwell)\b/i.test(lastReply.body)) return fallback;
  try {
    const kind = beauty ? 'a UK beauty and aesthetics clinic' : appts ? 'a UK clinic that takes appointments' : 'a UK trade business';
    const limits = beauty
      ? 'Never give medical, skincare or aftercare advice, never say whether a treatment is suitable or a symptom is normal, never promise a result. Prices only if they appear in the facts below, word for word.'
      : appts ? 'Never give medical advice or a diagnosis. Prices only if they appear in the facts below.' : 'Never give a price, a time slot or technical advice.';
    const r = await ai({
      userId, agent: 'capture', maxTokens: 300, fast: true,
      system: `${HOUSE_STYLE}\nYou are polishing the owner's reply to a ${appts ? 'client' : 'customer'} of ${kind}. ${channel === 'email' ? 'An email under 90 words in the body; start with "Subject: ".' : 'A text message under 45 words.'} Keep every fact, time, address and price from the draft exactly; make it warmer and more natural, and answer what the ${appts ? 'client' : 'customer'} actually asked if the facts allow. Never invent a time or a fact. ${limits} No marketing, no offers, no emojis. Sign with the owner's first name only. Plain text only.`,
      messages: [{ role: 'user', content: [
        `Business: ${s.business.name} (${s.business.trade || 'business'}), ${s.business.location}. Owner: ${s.business.ownerName}.`,
        `Services: ${lines(s.work.services).join(', ')}`,
        appts && s.bookings.types.length ? `Appointment types and prices: ${s.bookings.types.map((t) => `${t.name}${t.price ? ` (${t.price})` : ''}`).join('; ')}` : '',
        appts && s.bookings.address ? `Address: ${s.bookings.address}` : '', appts && s.bookings.arrival ? `What to tell people before they come: ${s.bookings.arrival}` : '',
        e.bookedFor ? `Booked: ${e.bookedType || 'appointment'} on ${new Date(e.bookedFor).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' })}${e.bookedWith ? ` with ${e.bookedWith}` : ''}` : `Stage: ${e.status}`,
        `\nEnquiry (${e.channel}) from ${e.name || (appts ? 'a client' : 'a customer')}${e.postcode ? `, ${e.postcode}` : ''}:\n${(e.summary || e.transcript).slice(0, 1200)}`,
        lastReply ? `\nTheir latest message: "${lastReply.body.slice(0, 400)}"` : '',
        `\nDraft to polish:\n${fallback}`,
      ].filter(Boolean).join('\n') }],
    });
    const out = r.text.trim();
    if (out && !hasBanned(out) && (channel !== 'email' || out.startsWith('Subject:'))) text = out;
  } catch { /* keep the draft */ }
  return text;
}
