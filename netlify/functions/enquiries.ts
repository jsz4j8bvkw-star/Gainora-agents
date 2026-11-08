import { body, db, getSettings, handler, HttpError, insert, json, requireCapture } from '../lib/core';
import { appUrl, draftEnquiryReply, hashToken, intake, newToken, toRecord, toRow, UUID, withDefaults } from '../lib/capture';
import { applyPatch, ENQUIRY_STATUSES, type EnquiryPatch } from '../../shared/capture';

// Everything the owner does to enquiries. Ops:
//  link    – make a secret link for a source (shown once) · revoke – switch one off
//  add     – log an enquiry by hand (a call you took yourself)
//  update  – status, quote, booking, job value, invoice, paid, chasers and reminders sent, notes
//  draft   – a first reply to an enquiry
//  test    – a sample enquiry through the real intake, to check alerts and the inbox
//  delete  – remove an enquiry and its recording link for good
// Gainora drafts; the owner sends. Nothing here contacts a customer.
const STATUS_IDS = new Set<string>(ENQUIRY_STATUSES.map((s) => s.id));
const KINDS = new Set(['quote', 'booking', 'callback', 'complaint', 'spam', 'other']);
const CHANNELS = new Set(['call', 'form', 'email', 'text']);

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
    return json({ id: src.id, label: src.label, channel, active: true, createdAt: src.created_at, lastUsedAt: null, url: `${appUrl()}/api/enquiry-in/${token}` });
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
    return json({ ...rec, history });
  }

  if (b.op === 'test') {
    const r = await intake(user.id, null, {
      name: 'Test caller', phone: '07700 900000', summary: 'This is a test enquiry from Gainora. A customer would like a quote for replacing a kitchen tap, ideally next week. Postcode TR1 2AB.',
    }, 'call', { test: true, ownerEmail: user.email });
    return json('saved' in r ? r.saved : { ok: true });
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
    for (const k of ['notes', 'name', 'phone', 'email', 'postcode'] as const) if (typeof b[k] === 'string') p[k] = b[k];
    const before = toRecord(row);
    if (p.chaserSent && (p.status ?? before.status) !== 'quoted') throw new HttpError(400, 'Chasers are for quotes waiting on an answer.');
    if (p.paymentReminderSent && before.status !== 'won') throw new HttpError(400, 'Payment reminders are for finished jobs.');
    const settings = withDefaults(await getSettings(user.id));
    const after = applyPatch(before, p, settings);
    const [saved] = await db<any[]>(`enquiries?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: toRow(after), prefer: 'return=representation' });
    return json(toRecord(saved));
  }

  if (b.op === 'draft') {
    const s = withDefaults(await getSettings(user.id));
    if (!s.business.name) throw new HttpError(400, 'Finish your setup first.');
    return json({ text: await draftEnquiryReply(user.id, s, toRecord(row)) });
  }

  if (b.op === 'delete') {
    await db(`enquiries?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  throw new HttpError(400, 'Unknown request.');
});
export const config = { path: '/api/enquiries', method: 'POST' };
