import { db, env, insert } from '../lib/core';
import { intake, toRecord, withDefaults } from '../lib/capture';
import { findClientByNumber, runAutomations, twilioSignatureOk } from '../lib/messages';
import { keyword } from '../../shared/automations';
import { normPhone } from '../../shared/capture';

// Texts customers send back. Twilio posts each one here (set as the number's "A message comes in" webhook).
// Replies land on the customer's latest enquiry, pause that enquiry's chasers, and show as unread in the app.
// STOP and START are handled here. A text from someone new starts a new enquiry.
const twiml = (reply?: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${reply.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</Message>` : ''}</Response>`, { headers: { 'Content-Type': 'text/xml' } });

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = env('TWILIO_WEBHOOK_URL') || req.url;   // the exact address Twilio was given
  if (!twilioSignatureOk(url, params, req.headers.get('x-twilio-signature'))) return new Response('Forbidden', { status: 403 });
  try {
    const from = normPhone(params.From || ''); const to = normPhone(params.To || ''); const body = String(params.Body || '').slice(0, 1600);
    if (!from || !body) return twiml();
    const client = await findClientByNumber(to);
    if (!client) return twiml();
    const userId = client.user_id;
    const s = withDefaults(client.data);

    const kw = keyword(body);
    if (kw === 'stop') {
      await db('opt_outs?on_conflict=user_id,phone', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { user_id: userId, phone: from } });
    }
    if (kw === 'start') await db(`opt_outs?user_id=eq.${userId}&phone=eq.${encodeURIComponent(from)}`, { method: 'DELETE' });

    // The customer's latest enquiry from the last 60 days, or a new one.
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    let [row] = await db<any[]>(`enquiries?select=*&user_id=eq.${userId}&phone=eq.${encodeURIComponent(from)}&received_at=gte.${since}&order=received_at.desc&limit=1`);
    if (!row && !kw) {
      const r = await intake(userId, null, { phone: from, summary: body, message_id: params.MessageSid }, 'text', { ownerEmail: s.business.alertEmail });
      if ('saved' in r && r.saved) [row] = await db<any[]>(`enquiries?select=*&id=eq.${r.saved.id}`);
    }
    await insert('messages', {
      user_id: userId, enquiry_id: row?.id ?? null, direction: 'in', audience: 'customer', channel: 'text', from_addr: from, to_addr: to,
      body, status: 'received', read: false, provider_id: params.MessageSid ?? null, sent_at: new Date().toISOString(),
    });
    if (row) {
      const e = toRecord(row);
      const history = [...e.history, { at: new Date().toISOString(), text: kw === 'stop' ? 'Replied STOP: no more texts' : kw === 'start' ? 'Replied START: texts back on' : 'Text received' }].slice(-100);
      await db(`enquiries?id=eq.${e.id}`, { method: 'PATCH', body: { history, updated_at: new Date().toISOString() } });
      if (!kw && e.status === 'new' && e.history.length <= 2) await runAutomations(userId, [e.id]);   // a brand-new texter gets the thank-you
    }
    if (kw === 'stop') return twiml(`You won’t get any more texts from ${s.business.name}. Reply START to turn them back on.`);
    if (kw === 'start') return twiml(`Texts from ${s.business.name} are back on. Reply STOP at any time to stop them.`);
    return twiml();
  } catch (e: any) {
    console.error('[capture] sms-in', e?.message);
    return twiml();   // never make Twilio retry into a loop
  }
};
export const config = { path: '/api/sms-in', method: 'POST' };
