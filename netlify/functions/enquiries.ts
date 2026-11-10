import { syncVisits, visitFrom } from '../lib/clients-sync';
import { body, db, getSettings, handler, HttpError, insert, json, requireCapture } from '../lib/core';
import { appUrl, draftEnquiryReply, hashToken, intake, newToken, toRecord, toRow, UUID, withDefaults } from '../lib/capture';
import { alertOwner, applyStepPatch, deliver, runAutomations, sendText } from '../lib/messages';
import { applyPatch as applyEnquiryPatch, normPhone } from '../../shared/capture';
import { applyPatch, ENQUIRY_STATUSES, type EnquiryPatch } from '../../shared/capture';

// Everything the owner does to enquiries and messages. Ops:
//  link    – make a secret link for a source (shown once) · revoke – switch one off
//  add     – log an enquiry by hand (a call you took yourself)
//  update  – status, quote, booking, job value, invoice, paid, chasers and reminders sent, notes
//  draft   – a first reply to an enquiry
//  test    – a sample enquiry through the real intake, to check alerts and the inbox
//  delete  – remove an enquiry, its messages and recording link for good
//  reply   – the owner texts or emails the customer from the app
//  approve / skip – an automatic message waiting for the owner's OK
//  read    – mark a customer's replies as read · test-text – send a message preview to the owner's own mobile
// Gainora drafts; the owner sends. Nothing here contacts a customer.
const STATUS_IDS = new Set<string>(ENQUIRY_STATUSES.map((s) => s.id));
const KINDS = new Set(['quote', 'booking', 'callback', 'complaint', 'spam', 'other']);
const CHANNELS = new Set(['call', 'form', 'email', 'text']);
const LOST = new Set(['noshow', 'late_cancel', 'cancelled', 'other']);

const money = (v: unknown, label: string): number | null => {
  if (v === null || v === '') return null;
  const n = Number(String(v).replace(/[£,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, `Enter the ${label} in pounds.`);
  return Math.round(n * 100) / 100;
};
const isoOrNull = (v: unknown, label: string): string | null => {
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `That ${label} isn’t a date.`);
  return d.toISOString();
};

async function getRow(userId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, 'That enquiry no longer exists.');
  const [row] = await db<any[]>(`enquiries?select=*&id=eq.${id}&user_id=eq.${userId}`);
  if (!row) throw new HttpError(404, 'That enquiry no longer exists.');
  return row;
}

export default handler(async (req) => {
  const user = await requireCapture(req);
  const b = await body<any>(req);

  if (b.op === 'link') {
    const channel = CHANNELS.has(b.channel) ? b.channel : 'call';
    const token = newToken();
    const [src] = await insert('enquiry_sources', { user_id: user.id, label: String(b.label || 'AI receptionist').slice(0, 60), channel, token_hash: hashToken(token), active: true });
    // The full link is only ever shown here; afterwards only its hash exists.
    return json({ id: src.id, label: src.label, channel, active: true, createdAt: src.created_at, lastUsedAt: null, url: `${appUrl()}/api/enquiry-in/${token}`, ...(channel === 'call' ? { lookupUrl: `${appUrl()}/api/caller-in/${token}`, toolsUrl: `${appUrl()}/api/diary-tool/${token}` } : {}) });
  }
  if (b.op === 'revoke') {
    if (!UUID.test(String(b.id))) throw new HttpError(404, 'That link no longer exists.');
    await db(`enquiry_sources?id=eq.${b.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: { active: false } });
    return json({ ok: true });
  }

  if (b.op === 'add') {
    const e = b.enquiry ?? {};
    const channel = CHANNELS.has(e.channel) ? e.channel : 'call';
    const summary = String(e.summary || '').trim();
    if (!summary) throw new HttpError(400, 'Add a line about what they need.');
    const r = await intake(user.id, null, { name: e.name, phone: e.phone, email: e.email, summary, postcode: e.postcode, received_at: e.receivedAt }, channel, { ownerEmail: user.email });
    if (!('saved' in r)) throw new HttpError(400, 'Add a phone number, email or a line about what they need.');
    const rec = r.saved!;
    const history = [{ at: new Date().toISOString(), text: 'Logged by you' }, ...rec.history.slice(1)];
    await db(`enquiries?id=eq.${rec.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: { history } });
    await runAutomations(user.id, [rec.id]).catch(() => {});
    return json({ ...rec, history });
  }

  if (b.op === 'test') {
    const r = await intake(user.id, null, {
      name: 'Test caller', phone: '07700 900000', summary: 'This is a test enquiry from Gainora. A customer would like a quote for replacing a kitchen tap, ideally next week. Postcode TR1 2AB.',
    }, 'call', { test: true, ownerEmail: user.email });
    if ('saved' in r && r.saved) await alertOwner(user.id, withDefaults(await getSettings(user.id)), r.saved).catch(() => {});
    return json('saved' in r ? r.saved : { ok: true });
  }

  if (b.op === 'approve' || b.op === 'skip') {
    if (!UUID.test(String(b.messageId))) throw new HttpError(404, 'That message no longer exists.');
    const [m] = await db<any[]>(`messages?select=*&id=eq.${b.messageId}&user_id=eq.${user.id}&status=eq.awaiting_approval`);
    if (!m) throw new HttpError(404, 'That message has already been dealt with.');
    if (b.op === 'skip') {
      await db(`messages?id=eq.${m.id}`, { method: 'PATCH', body: { status: 'skipped' } });
      return json({ ...m, status: 'skipped' });
    }
    const s = withDefaults(await getSettings(user.id));
    const text = typeof b.text === 'string' && b.text.trim() ? b.text.trim().slice(0, 1600) : m.body;
    const r = await deliver(s, m.channel, m.to_addr, m.subject, text);
    const patch = r.ok ? { status: 'sent', body: text, sent_at: new Date().toISOString(), provider_id: r.id ?? null } : { status: 'failed', body: text, error: r.error };
    await db(`messages?id=eq.${m.id}`, { method: 'PATCH', body: patch });
    if (r.ok && m.enquiry_id) await applyStepPatch(user.id, m.enquiry_id, m.step, s);
    if (!r.ok) throw new HttpError(502, r.error || 'Not sent. Try again.');
    return json({ ...m, ...patch });
  }

  if (b.op === 'test-text') {
    const s = withDefaults(await getSettings(user.id));
    if (!s.business.alertMobile) throw new HttpError(400, 'Add your mobile number in Settings first.');
    const r = await sendText(s, s.business.alertMobile, `Preview from Gainora: ${String(b.text || '').slice(0, 600)}`);
    if (!r.ok) throw new HttpError(502, r.error || 'Not sent.');
    return json({ ok: true });
  }

  const row = await getRow(user.id, String(b.id || ''));

  if (b.op === 'update') {
    const p: EnquiryPatch = {};
    if (b.status !== undefined) { if (!STATUS_IDS.has(b.status)) throw new HttpError(400, 'That status is not valid.'); p.status = b.status; }
    if (b.kind !== undefined) { if (!KINDS.has(b.kind)) throw new HttpError(400, 'That type is not valid.'); p.kind = b.kind; }
    if (b.quoteAmount !== undefined) p.quoteAmount = money(b.quoteAmount, 'quote');
    if (b.jobValue !== undefined) p.jobValue = money(b.jobValue, 'job value');
    if (b.bookedFor !== undefined) p.bookedFor = isoOrNull(b.bookedFor, 'booking');
    if (b.invoiceDue !== undefined) { const d = isoOrNull(b.invoiceDue, 'due date'); p.invoiceDue = d ? d.slice(0, 10) : null; }
    for (const k of ['paid'] as const) if (typeof b[k] === 'boolean') p[k] = b[k];
    for (const k of ['chaserSent', 'paymentReminderSent', 'reviewAsked', 'replied'] as const) if (b[k] === true) p[k] = true;
    for (const k of ['notes', 'name', 'phone', 'email', 'postcode', 'bookedType', 'bookedWith'] as const) if (typeof b[k] === 'string') p[k] = b[k];
    if (b.lostReason !== undefined) { if (!LOST.has(b.lostReason)) throw new HttpError(400, 'That reason is not valid.'); p.lostReason = b.lostReason; }
    const before = toRecord(row);
    if (p.chaserSent && (p.status ?? before.status) !== 'quoted') throw new HttpError(400, 'Chasers are for quotes waiting on an answer.');
    if (p.paymentReminderSent && before.status !== 'won') throw new HttpError(400, 'Payment reminders are for finished jobs.');
    const settings = withDefaults(await getSettings(user.id));
    const after = applyPatch(before, p, settings);
    await db(`enquiries?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: toRow(after) });
    // Attended: the client and the visit go into Command Centre's client list too (same login).
    if (after.status === 'won' && before.status !== 'won') { const v = visitFrom(after, settings); if (v) await syncVisits(user.id, [v]); }
    // A booking or a finished job may start a message (confirmation, review request).
    await runAutomations(user.id, [row.id]).catch((e) => console.error('[capture] automations', e?.message));
    const [saved] = await db<any[]>(`enquiries?select=*&id=eq.${row.id}&user_id=eq.${user.id}`);
    return json(toRecord(saved));
  }

  if (b.op === 'draft') {
    const s = withDefaults(await getSettings(user.id));
    if (!s.business.name) throw new HttpError(400, 'Finish your setup first.');
    // The draft answers the client's latest text, if there is one.
    const [last] = await db<any[]>(`messages?select=body,created_at&enquiry_id=eq.${row.id}&user_id=eq.${user.id}&direction=eq.in&order=created_at.desc&limit=1`).catch(() => [] as any[]);
    return json({ text: await draftEnquiryReply(user.id, s, toRecord(row), last ? { body: String(last.body || ''), at: last.created_at } : null) });
  }

  if (b.op === 'reply') {
    const channel = b.channel === 'email' ? 'email' : 'text';
    const text = String(b.text || '').trim().slice(0, 1600);
    const subject = String(b.subject || '').trim().slice(0, 150);
    if (!text) throw new HttpError(400, 'Write a message first.');
    const to = channel === 'text' ? normPhone(row.phone) : row.email;
    if (!to) throw new HttpError(400, channel === 'text' ? 'There’s no mobile number for this customer.' : 'There’s no email address for this customer.');
    if (channel === 'text' && (await db<any[]>(`opt_outs?select=phone&user_id=eq.${user.id}&phone=eq.${encodeURIComponent(to)}`)).length) throw new HttpError(400, 'This customer replied STOP, so they can’t be texted. Call or email them instead.');
    const s = withDefaults(await getSettings(user.id));
    const r = await deliver(s, channel, to, subject || `Your enquiry with ${s.business.name}`, text);
    const [m] = await insert('messages', { user_id: user.id, enquiry_id: row.id, direction: 'out', channel, to_addr: to, subject, body: text, automatic: false, status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, provider_id: r.id ?? null, sent_at: r.ok ? new Date().toISOString() : null });
    if (!r.ok) throw new HttpError(502, r.error || 'Not sent. Try again.');
    const after = applyEnquiryPatch(toRecord(row), { replied: true }, s);
    await db(`enquiries?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: toRow(after) });
    return json({ message: m, enquiry: after });
  }

  if (b.op === 'read') {
    await db(`messages?enquiry_id=eq.${row.id}&user_id=eq.${user.id}&direction=eq.in&read=eq.false`, { method: 'PATCH', body: { read: true } });
    return json({ ok: true });
  }

  if (b.op === 'delete') {
    await db(`enquiries?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  throw new HttpError(400, 'Unknown request.');
});
export const config = { path: '/api/enquiries', method: 'POST' };
