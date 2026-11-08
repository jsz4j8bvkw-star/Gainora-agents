// Sending and receiving: texts through Twilio, emails through Resend, and the automation runner.
// Customers only ever get messages the owner switched on (or approved, or wrote themselves).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, enc, env, insert } from './core';
import { toRecord, toRow, withDefaults } from './capture';
import { afterSend, dueNow, ownerAlert, patchForStep, type Draft, type MessageLite } from '../../shared/automations';
import { applyPatch, normPhone, type CaptureSettings, type EnquiryRecord } from '../../shared/capture';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const textingReady = () => !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN'));
export const fromNumber = (s: CaptureSettings) => (s.texting.status === 'on' && s.texting.number ? normPhone(s.texting.number) : normPhone(env('TWILIO_FROM')));

export async function sendText(s: CaptureSettings, to: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!textingReady()) return { ok: false, error: 'Texting isn’t switched on yet.' };
  const from = fromNumber(s);
  if (!from) return { ok: false, error: 'No texting number is set up for this business yet.' };
  const sid = env('TWILIO_ACCOUNT_SID');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: normPhone(to), From: from, Body: body }).toString(),
  }).catch((e) => ({ ok: false, json: async () => ({ message: e?.message }) } as any));
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.message ? `Not sent: ${String(data.message).slice(0, 160)}` : 'Not sent. Try again.' };
  return { ok: true, id: data.sid };
}

/** An email to a customer: plain, in the business's name, replies go to the business. */
export async function sendCustomerEmail(s: CaptureSettings, to: string, subject: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = env('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'Email isn’t switched on yet.' };
  const address = (env('EMAIL_FROM', 'Gainora <hello@gainora.co.uk>').match(/<([^>]+)>/)?.[1]) || env('EMAIL_FROM') || 'hello@gainora.co.uk';
  const html = `<!doctype html><html><body style="margin:0;background:#F4F4F2"><div style="max-width:560px;margin:0 auto;padding:28px 22px"><div style="background:#fff;border:1px solid #E4E3DF;border-radius:10px;padding:26px 28px"><p style="margin:0 0 18px;font:600 17px Georgia,serif;color:#1A1A1C">${esc(s.business.name)}</p>${body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font:16px/1.6 Georgia,serif;color:#1A1A1C">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div><p style="font:12px/1.5 Arial,sans-serif;color:#6F6C66;margin-top:14px">${esc(s.business.name)}${s.business.phone ? ` · ${esc(s.business.phone)}` : ''}. Reply to this email to get in touch.</p></div></body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${s.business.name.replace(/[<>"]/g, '')} <${address}>`, to: [to], reply_to: s.business.alertEmail || undefined, subject, html, text: body }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, error: 'Email not sent. Try again.' };
  const data: any = await res.json().catch(() => ({}));
  return { ok: true, id: data.id };
}

export async function deliver(s: CaptureSettings, channel: 'text' | 'email', to: string, subject: string, body: string) {
  return channel === 'text' ? sendText(s, to, body) : sendCustomerEmail(s, to, subject, body);
}


export const toLite = (m: any): MessageLite => ({ enquiryId: m.enquiry_id, direction: m.direction, key: m.key, status: m.status, createdAt: m.created_at, automatic: !!m.automatic });

/**
 * Creates and sends what's due for one client: all their open enquiries, or just the ones named.
 * Safe to run twice at once: each automatic message has a unique key, so a second insert is ignored.
 */
export async function runAutomations(userId: string, only?: string[], now = new Date()): Promise<number> {
  const [srow] = await db<any[]>(`capture_settings?select=data,completed_at&user_id=eq.${userId}`);
  const s = withDefaults({ ...(srow?.data ?? {}), completedAt: srow?.completed_at ?? srow?.data?.completedAt });
  if (!s.completedAt) return 0;
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const filter = only?.length ? `id=in.(${only.join(',')})` : `status=in.(new,replied,booked,quoted,won)&received_at=gte.${since}`;
  const rows = await db<any[]>(`enquiries?select=*&user_id=eq.${userId}&is_test=eq.false&${filter}&limit=500`);
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const msgs = (await db<any[]>(`messages?select=enquiry_id,direction,key,status,created_at,automatic&user_id=eq.${userId}&enquiry_id=in.(${ids.join(',')})`)).map(toLite);
  const optOuts = new Set((await db<any[]>(`opt_outs?select=phone&user_id=eq.${userId}`)).map((o) => o.phone));
  let count = 0;
  for (const row of rows) {
    let e: EnquiryRecord = toRecord(row);
    const drafts = dueNow(e, s, msgs, optOuts.has(normPhone(e.phone)), now);
    let changed = false;
    for (const d of drafts) {
      const made = await queue(userId, s, d);
      if (!made) continue;
      count++;
      msgs.push({ enquiryId: e.id, direction: 'out', key: d.key, status: made.status, createdAt: now.toISOString(), automatic: true });
      if (made.status === 'sent' && d.patch) { e = afterSend(e, d, s, now); changed = true; }
    }
    if (changed) await db(`enquiries?id=eq.${e.id}&user_id=eq.${userId}`, { method: 'PATCH', body: toRow(e) });
  }
  return count;
}

async function queue(userId: string, s: CaptureSettings, d: Draft): Promise<{ id: string; status: string } | null> {
  const rows = await db<any[]>('messages?on_conflict=enquiry_id,key,channel', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { user_id: userId, enquiry_id: d.enquiryId, direction: 'out', audience: 'customer', channel: d.channel, to_addr: d.to, subject: d.subject, body: d.body, automatic: true, workflow: d.workflow, step: d.step, key: d.key, status: d.ask ? 'awaiting_approval' : 'sending' },
  });
  const m = rows?.[0];
  if (!m) return null;                       // already made by another run
  if (d.ask) return { id: m.id, status: 'awaiting_approval' };
  const r = await deliver(s, d.channel, d.to, d.subject, d.body);
  await db(`messages?id=eq.${m.id}`, { method: 'PATCH', body: r.ok ? { status: 'sent', sent_at: new Date().toISOString(), provider_id: r.id ?? null } : { status: 'failed', error: r.error } });
  return { id: m.id, status: r.ok ? 'sent' : 'failed' };
}

/** Texts the owner's own mobile about an urgent call, if they asked for that. Not subject to quiet hours. */
export async function alertOwner(userId: string, s: CaptureSettings, e: EnquiryRecord) {
  const want = s.calls.alertText;
  if (!s.business.alertMobile || want === 'off' || e.status === 'spam' || e.urgency === 'normal' || (want === 'emergencies' && e.urgency !== 'emergency')) return;
  const body = ownerAlert(e, s);
  const r = await sendText(s, s.business.alertMobile, body);
  await insert('messages', {
    user_id: userId, enquiry_id: e.id, direction: 'out', audience: 'owner', channel: 'text', to_addr: normPhone(s.business.alertMobile), body,
    automatic: true, workflow: 'owner_alert', key: 'owner-alert', status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, provider_id: r.id ?? null, sent_at: r.ok ? new Date().toISOString() : null,
  }).catch((err) => console.error('[capture] owner alert', err?.message));
}

/** Applies the enquiry change for an approved automatic message. */
export async function applyStepPatch(userId: string, enquiryId: string, step: string | null, s: CaptureSettings) {
  const p = patchForStep(step);
  if (!p) return;
  const [row] = await db<any[]>(`enquiries?select=*&id=eq.${enquiryId}&user_id=eq.${userId}`);
  if (!row) return;
  const e = applyPatch(toRecord(row), p, s);
  await db(`enquiries?id=eq.${enquiryId}&user_id=eq.${userId}`, { method: 'PATCH', body: toRow(e) });
}

/** Twilio signs every webhook: HMAC-SHA1 of the full URL plus the sorted form fields, keyed by the auth token. */
export function twilioSignatureOk(url: string, params: Record<string, string>, signature: string | null, token = env('TWILIO_AUTH_TOKEN')): boolean {
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', token).update(data).digest('base64');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const findClientByNumber = async (to: string) =>
  (await db<any[]>(`capture_settings?select=user_id,data&data->texting->>number=eq.${enc(normPhone(to))}`))[0] ?? null;
