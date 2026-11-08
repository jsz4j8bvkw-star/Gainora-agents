import { addAlert, addValue, db, handler, HttpError, json } from '../lib/core';
import { hashToken, TOKEN } from '../lib/capture';
import { normaliseEnquiry, triage, type Channel } from '../../shared/capture';

// Where the client's AI receptionist (or web form, or email forwarder) sends each enquiry.
// The secret link identifies the client; nothing here ever contacts the customer.
// POST /api/enquiry-in/<token>  with JSON or a normal form post.
const MAX_BYTES = 256_000;

async function readBody(req: Request): Promise<any> {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, 'Too large.');
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Send JSON or a form post.'); }
}

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  if (!TOKEN.test(token)) throw new HttpError(404, 'Unknown link.');
  const [src] = await db<any[]>(`enquiry_sources?select=id,user_id,channel&token_hash=eq.${hashToken(token)}&active=eq.true`);
  if (!src) throw new HttpError(404, 'Unknown link.');

  const raw = await readBody(req);
  // Platforms also send "call started" and similar events; only finished calls carry what we need.
  if (typeof raw?.event === 'string' && /^call_(started|ended)$/.test(raw.event)) return json({ ok: true, skipped: raw.event });
  const e = normaliseEnquiry(raw, src.channel as Channel);
  if (!e) return json({ ok: true, skipped: 'empty' });
  const t = triage(`${e.summary}\n${e.transcript}`);

  const rows = await db<any[]>(e.externalId ? 'enquiries?on_conflict=user_id,external_id' : 'enquiries', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: {
      user_id: src.user_id, source_id: src.id, channel: e.channel, external_id: e.externalId, name: e.name, phone: e.phone, email: e.email,
      postcode: e.postcode, summary: e.summary, transcript: e.transcript, recording_url: e.recordingUrl,
      urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: t.kind === 'spam' ? 'spam' : 'new', received_at: e.receivedAt,
    },
  });
  await db(`enquiry_sources?id=eq.${src.id}`, { method: 'PATCH', body: { last_used_at: new Date().toISOString() } }).catch(() => {});
  const saved = rows?.[0];
  if (!saved) return json({ ok: true, duplicate: true });   // the platform retried a call we already have

  if (t.kind !== 'spam') {
    await addValue(src.user_id, 'capture', 'enquiry_caught', `Enquiry: ${e.name || e.phone || e.email || 'new caller'}`, null, saved.id);
    if (t.urgency !== 'normal') {
      const who = e.name || e.phone || 'A caller';
      await addAlert(src.user_id, 'capture', t.urgency === 'emergency' ? 'urgent' : 'notice',
        `${t.urgency === 'emergency' ? 'Emergency' : 'Urgent'}: ${who}${e.postcode ? `, ${e.postcode}` : ''}`,
        `${t.reasons.join('. ')}. ${e.summary || ''}`.trim(), '/enquiries');
    }
  }
  return json({ ok: true, id: saved.id });
});
export const config = { path: '/api/enquiry-in/:token', method: 'POST' };
