import { addValue, body, db, getProfile, handler, HttpError, insert, json, requireAgent } from '../lib/core';
import { draftEnquiryReply, hashToken, newToken } from '../lib/capture';
import {
  ENQUIRY_STATUSES, paymentReminder, quoteChaser, receptionistPack, reviewRequest, type EnquiryStatus, type ReceptionistSetup,
} from '../../shared/capture';

// Capture & Convert for the signed-in owner. Ops:
//  link    – make a new secret link for a source (shown once), or { revoke: id }
//  pack    – the receptionist script, written from the profile plus the onboarding answers
//  update  – status (replied, quoted, booked, won…), job value, chaser sent
//  draft   – a first reply to an enquiry
//  message – quote chaser, payment reminder or review request text
// Gainora drafts; the owner sends. Nothing here contacts a customer.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_IDS = new Set<string>(ENQUIRY_STATUSES.map((s) => s.id));
const CHANNELS = new Set(['call', 'form', 'email', 'text']);

async function getEnquiry(userId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, 'That enquiry no longer exists.');
  const [row] = await db<any[]>(`enquiries?select=*&id=eq.${id}&user_id=eq.${userId}`);
  if (!row) throw new HttpError(404, 'That enquiry no longer exists.');
  return row;
}

export default handler(async (req) => {
  const user = await requireAgent(req, 'capture');
  const b = await body<any>(req);
  const profile = await getProfile(user.id);

  if (b.op === 'link') {
    if (typeof b.revoke === 'string') {
      if (!UUID.test(b.revoke)) throw new HttpError(404, 'That link no longer exists.');
      await db(`enquiry_sources?id=eq.${b.revoke}&user_id=eq.${user.id}`, { method: 'PATCH', body: { active: false } });
      return json({ ok: true });
    }
    const channel = CHANNELS.has(b.channel) ? b.channel : 'call';
    const token = newToken();
    const [src] = await insert('enquiry_sources', { user_id: user.id, label: String(b.label || 'AI receptionist').slice(0, 60), channel, token_hash: hashToken(token), active: true });
    const base = (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');
    // The full link is only ever shown here; afterwards only its hash exists.
    return json({ id: src.id, label: src.label, channel, url: `${base}/api/enquiry-in/${token}` });
  }

  if (b.op === 'pack') {
    if (!profile?.business?.name) throw new HttpError(400, 'Finish your business profile first.');
    return json(receptionistPack(profile, (b.setup ?? {}) as ReceptionistSetup));
  }

  if (b.op === 'update') {
    const row = await getEnquiry(user.id, String(b.id || ''));
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.status !== undefined && b.status !== row.status) {
      if (!STATUS_IDS.has(b.status)) throw new HttpError(400, 'That status is not valid.');
      patch.status = b.status as EnquiryStatus;
      if (b.status === 'quoted' && !row.quoted_at) { patch.quoted_at = new Date().toISOString(); patch.chasers_sent = 0; }
    }
    if (b.chaserSent) {
      if ((patch.status ?? row.status) !== 'quoted') throw new HttpError(400, 'Chasers are for quotes waiting on an answer.');
      patch.chasers_sent = Number(row.chasers_sent ?? 0) + 1;
    }
    if (b.value !== undefined) {
      const n = b.value === null ? null : Number(b.value);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10_000_000)) throw new HttpError(400, 'Enter the job value in pounds.');
      patch.value_gbp = n;
    }
    const [saved] = await db<any[]>(`enquiries?id=eq.${row.id}&user_id=eq.${user.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    // One "won" result per enquiry, carrying the value the owner entered; removed if it's moved back.
    const status = saved.status;
    const [ev] = await db<any[]>(`value_events?select=id&user_id=eq.${user.id}&kind=eq.enquiry_won&ref=eq.${row.id}`);
    if (status === 'won') {
      const amount = saved.value_gbp == null ? null : Number(saved.value_gbp);
      const title = `Job won: ${row.name || row.phone || 'enquiry'}`;
      if (!ev) await addValue(user.id, 'you', 'enquiry_won', title, amount, row.id);
      else await db(`value_events?id=eq.${ev.id}`, { method: 'PATCH', body: { amount: amount && amount > 0 ? amount : null } });
    } else if (ev) {
      await db(`value_events?id=eq.${ev.id}`, { method: 'DELETE' });
    }
    return json(saved);
  }

  if (b.op === 'draft') {
    if (!profile?.business?.name) throw new HttpError(400, 'Finish your business profile first.');
    const row = await getEnquiry(user.id, String(b.id || ''));
    return json({ text: await draftEnquiryReply(user.id, profile, row) });
  }

  if (b.op === 'message') {
    if (!profile?.business?.name) throw new HttpError(400, 'Finish your business profile first.');
    const row = UUID.test(String(b.id || '')) ? await getEnquiry(user.id, b.id) : null;
    const s = (v: unknown, n = 120) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    const httpsOnly = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v.slice(0, 300) : undefined);
    const ctx = {
      business: profile.business.name, owner: profile.business.ownerName || profile.business.name,
      customer: s(b.customer, 40) ?? (row?.name ? String(row.name).split(' ')[0] : undefined),
      job: s(b.job), amount: s(b.amount, 20), dueDate: s(b.dueDate, 40), invoiceRef: s(b.invoiceRef, 40),
      payLink: httpsOnly(b.payLink), reviewLink: httpsOnly(b.reviewLink),
    };
    let text: string;
    if (b.kind === 'quote') text = quoteChaser(ctx, b.n === 2 ? 2 : (Number(row?.chasers_sent ?? 0) >= 1 ? 2 : 1));
    else if (b.kind === 'payment') text = paymentReminder(ctx, [1, 2, 3].includes(b.stage) ? b.stage : 1);
    else if (b.kind === 'review') text = reviewRequest(ctx);
    else throw new HttpError(400, 'Choose a quote chaser, payment reminder or review request.');
    return json({ text });
  }

  throw new HttpError(400, 'Unknown request.');
});
export const config = { path: '/api/enquiries', method: 'POST' };
