import { body, db, enc, handler, HttpError, json } from '../lib/core';
import { findAccount, loadState, requireGainora } from '../lib/admin';
import { askUrl, cancelAsk, emailClient, remindAsk, saveAsk, sendAsk } from '../lib/asks';
import { normEmail } from '../../shared/admin/model';
import type { Ask } from '../../shared/admin/asks';

// Gainora admin → asking clients for details, and emailing them. Gainora's team only.
//   POST /api/admin-asks {op: list | save | send | remind | cancel | email}
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());
const first = (name: string) => (name || '').trim().split(/\s+/)[0] || '';

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const me = await requireGainora(req);
  const by = who(me.email);
  const b = await body<any>(req);
  const withUrl = (a: Ask) => ({ ...a, url: askUrl(a.token) });
  const contactFirst = async (email: string) => first((await db<any[]>(`admin_accounts?select=contact_name&email=eq.${enc(normEmail(email))}`).catch(() => []))[0]?.contact_name ?? '');

  if (b.op === 'list') {
    const filter = b.email ? `&email=eq.${enc(normEmail(b.email))}` : '&status=in.(sent,opened,answered)';
    const rows = await db<Ask[]>(`client_asks?select=*${filter}&order=created_at.desc&limit=200`);
    return json({ asks: rows.map(withUrl) });
  }
  if (b.op === 'save') {
    const s = await loadState();
    const acc = findAccount(s, b.ask?.email);
    return json({ ask: withUrl(await saveAsk({ ...b.ask, email: acc.email }, by)) });
  }
  if (b.op === 'send') {
    const a = await sendAsk(String(b.id), by, { to: b.to, message: b.message, firstName: first(b.firstName || '') || (await contactFirst(String(b.email || ''))) });
    return json({ ask: withUrl(a) });
  }
  if (b.op === 'remind') {
    const a = (await db<Ask[]>(`client_asks?select=email&id=eq.${String(b.id).replace(/[^0-9a-f-]/gi, '')}`))[0];
    await remindAsk(String(b.id), by, a ? await contactFirst(a.email) : '');
    return json({ ok: true });
  }
  if (b.op === 'cancel') { await cancelAsk(String(b.id), by); return json({ ok: true }); }
  if (b.op === 'email') {
    const s = await loadState();
    const acc = findAccount(s, b.email);
    await emailClient(acc.email, String(b.to || ''), String(b.subject || ''), String(b.message || ''), by);
    return json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/admin-asks' };
