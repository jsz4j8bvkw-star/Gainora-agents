// Capture & Convert server helpers: secret enquiry links, saving an enquiry, owner alerts and the reply drafter.
import { createHash, randomBytes } from 'node:crypto';
import { db, env } from './core';
import { ai, hasBanned, HOUSE_STYLE } from './ai';
import { sendEmail } from './email';
import {
  emptySettings, firstReply, isAfterHours, lines, normaliseEnquiry, triage,
  type CaptureSettings, type Channel, type EnquiryRecord,
} from '../../shared/capture';

export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** Tokens are 32 URL-safe characters; anything else is refused before touching the database. */
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const appUrl = () => env('APP_URL', 'https://capture.gainora.co.uk').replace(/\/$/, '');

/** Settings with every field present, whatever was saved. */
export function withDefaults(data: any): CaptureSettings {
  const d = emptySettings();
  return {
    business: { ...d.business, ...(data?.business ?? {}) },
    work: { ...d.work, ...(data?.work ?? {}) },
    calls: { ...d.calls, ...(data?.calls ?? {}) },
    followUps: { ...d.followUps, ...(data?.followUps ?? {}) },
    provider: { ...d.provider, ...(data?.provider ?? {}) },
    completedAt: data?.completedAt,
  };
}

export const toRecord = (r: any): EnquiryRecord => ({
  id: r.id, channel: r.channel, name: r.name ?? '', phone: r.phone ?? '', email: r.email ?? '', postcode: r.postcode ?? '',
  summary: r.summary ?? '', transcript: r.transcript ?? '', recordingUrl: r.recording_url ?? '',
  urgency: r.urgency, kind: r.kind, reasons: r.reasons ?? [], status: r.status, afterHours: !!r.after_hours,
  notes: r.notes ?? '', history: r.history ?? [], repliedAt: r.replied_at ?? null,
  quoteAmount: r.quote_amount != null ? Number(r.quote_amount) : null, quotedAt: r.quoted_at ?? null, chasersSent: Number(r.chasers_sent ?? 0),
  bookedFor: r.booked_for ?? null, jobValue: r.job_value != null ? Number(r.job_value) : null, invoiceDue: r.invoice_due ?? null,
  paidAt: r.paid_at ?? null, paymentRemindersSent: Number(r.payment_reminders_sent ?? 0), reviewAskedAt: r.review_asked_at ?? null,
  receivedAt: r.received_at, isTest: !!r.is_test,
});

/** The database columns a change touches. */
export const toRow = (e: EnquiryRecord) => ({
  name: e.name, phone: e.phone, email: e.email, postcode: e.postcode, kind: e.kind, status: e.status, notes: e.notes, history: e.history.slice(-100),
  replied_at: e.repliedAt, quote_amount: e.quoteAmount, quoted_at: e.quotedAt, chasers_sent: e.chasersSent, booked_for: e.bookedFor,
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
  const t = triage(`${e.summary}\n${e.transcript}`);
  const [settingsRow] = await db<any[]>(`capture_settings?select=data&user_id=eq.${userId}`);
  const s = withDefaults(settingsRow?.data);
  const afterHours = isAfterHours(e.receivedAt, s.calls);
  const history = [{ at: e.receivedAt, text: `${e.channel === 'call' ? 'Call answered by your receptionist' : e.channel === 'form' ? 'Website form received' : e.channel === 'email' ? 'Email received' : 'Text received'}${afterHours ? ' (out of hours)' : ''}` }];
  if (t.urgency !== 'normal') history.push({ at: e.receivedAt, text: `${t.urgency === 'emergency' ? 'Flagged as an emergency' : 'Flagged as urgent'}: ${t.reasons.join('; ')}` });

  const rows = await db<any[]>(e.externalId ? 'enquiries?on_conflict=user_id,external_id' : 'enquiries', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: {
      user_id: userId, source_id: sourceId, channel: e.channel, external_id: e.externalId, name: e.name, phone: e.phone, email: e.email,
      postcode: e.postcode, summary: e.summary, transcript: e.transcript, recording_url: e.recordingUrl,
      urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: t.kind === 'spam' ? 'spam' : 'new',
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

/** The owner's first reply to an enquiry. AI-written when available, a plain template otherwise. Never sent by Gainora. */
export async function draftEnquiryReply(userId: string, s: CaptureSettings, e: EnquiryRecord): Promise<string> {
  const channel: Channel = e.email && !e.phone ? 'email' : 'text';
  const ctx = { business: s.business.name, owner: s.business.ownerName || s.business.name, customer: e.name.split(' ')[0] || undefined };
  const fallback = firstReply(ctx, e.kind, channel);
  let text = fallback;
  try {
    const r = await ai({
      userId, agent: 'capture', maxTokens: 300, fast: true,
      system: `${HOUSE_STYLE}\nWrite the owner's first reply to a customer enquiry for a UK trade business. ${channel === 'email' ? 'An email under 90 words in the body; start with "Subject: ".' : 'A text message under 45 words.'} Thank them, show you understood the job in one short phrase, and say what happens next (a call back or a visit). Never give a price, a time slot or technical advice. No marketing, no offers. Sign with the owner's first name. Plain text only.`,
      messages: [{ role: 'user', content: `Business: ${s.business.name} (${s.business.trade || 'trade'}), ${s.business.location}. Owner: ${s.business.ownerName}.\nServices: ${lines(s.work.services).join(', ')}\n\nEnquiry (${e.channel}) from ${e.name || 'a customer'}${e.postcode ? `, ${e.postcode}` : ''}:\n${(e.summary || e.transcript).slice(0, 1500)}` }],
    });
    const out = r.text.trim();
    if (out && !hasBanned(out) && (channel !== 'email' || out.startsWith('Subject:'))) text = out;
  } catch { /* keep the template */ }
  return text;
}
