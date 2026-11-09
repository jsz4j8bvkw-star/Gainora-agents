import { body, db, enc, handler, HttpError, json, userFromRequest } from '../lib/core';
import { isUkMobile, smsProvider } from '../lib/sms';
import { canMessage } from '../../shared/clients';
import { OPT_OUT_LINE } from '../../shared/drafts';

// Sends one text the owner approved in the app, through the connected provider (Twilio), if any.
// Checks again on the server that the client may be messaged (consent, STOP, quiet hours, the
// weekly cap) and that the text carries the opt-out line. Off unless SMS_PROVIDER is set:
// then the app's "Send from your phone" is the only way, and this says so.
export default handler(async (req) => {
  const user = await userFromRequest(req);
  const provider = smsProvider();
  if (!provider) return json({ sent: false, message: 'No text-message provider is connected to your account yet. Use “Send from your phone”.' });
  const b = await body<{ actionId?: string; to: string; text: string; kind?: string }>(req);
  const kind = (['rebook', 'review_request', 'quiet_day', 'competitor_response'] as const).find((k) => k === b.kind) ?? 'rebook';
  const to = String(b.to || '').trim(); const text = String(b.text || '').trim();
  if (!isUkMobile(to)) throw new HttpError(400, 'Texts can only go to a UK mobile number.');
  if (!text || text.length > 640) throw new HttpError(400, 'The text is empty or too long.');
  if (!/STOP/i.test(text)) throw new HttpError(400, `Every text needs the opt-out line: “${OPT_OUT_LINE}”`);

  // The client must still be messageable right now, by the same rules the app applies.
  const [row] = await db<any[]>(`clients?select=*&user_id=eq.${user.id}&phone=eq.${enc(to)}&limit=1`).catch(() => [] as any[]);
  if (!row) throw new HttpError(404, 'That number is not one of your clients.');
  const [visits, sent, prof] = await Promise.all([
    db<any[]>(`client_visits?select=id&client_id=eq.${row.id}&limit=1`).catch(() => []),
    db<any[]>(`client_actions?select=client_id,kind,sent_at&user_id=eq.${user.id}&client_id=eq.${row.id}&order=sent_at.desc&limit=20`).catch(() => []),
    db<any[]>(`profiles?select=data&user_id=eq.${user.id}`).catch(() => []),
  ]);
  const client = { id: row.id, name: row.name, phone: row.phone, email: row.email ?? '', consent: row.consent, consentAt: row.consent_at, notComingBack: !!row.not_coming_back, lastReviewAskAt: row.last_review_ask_at, source: row.source, createdAt: row.created_at } as any;
  const perm = canMessage(client, kind, { visits: visits.length, sent: sent.map((s) => ({ clientId: s.client_id, kind: s.kind, sentAt: s.sent_at })), settings: prof[0]?.data?.clientSettings ?? {} });
  if (!perm.ok) throw new HttpError(400, `Not sent: ${perm.reason}.`);

  const r = await provider.send(to, text);
  return json({ sent: true, id: r.id, provider: provider.name });
});
export const config = { path: '/api/sms-send', method: 'POST' };
