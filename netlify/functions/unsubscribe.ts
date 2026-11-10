import { db } from '../lib/core';
import { blockContact } from '../lib/business';
import { esc, page } from '../lib/page';

// Stopping Gainora's outreach emails. Every outreach email links here and carries a one-click unsubscribe header.
//   GET  /u/<token>   asks to confirm (so link checkers in mail systems can't unsubscribe people by accident)
//   POST /u/<token>   unsubscribes (also the one-click request mail apps send)
export default async (req: Request) => {
  const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  const p = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? (await db<any[]>(`prospects?select=id,email,business_name,unsubscribed_at&unsub_token=eq.${token}`).catch(() => []))[0] : null;
  if (!p) return page('Unsubscribe', '<h1>Link not recognised</h1><p class="muted">Email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a> with “stop” and we’ll remove you straight away.</p>', 404);
  if (req.method === 'POST') {
    if (!p.unsubscribed_at) {
      await db(`prospects?id=eq.${p.id}`, { method: 'PATCH', body: { unsubscribed_at: new Date().toISOString(), stage: 'lost', lost_reason: 'Unsubscribed', next_on: null } });
      if (p.email) await blockContact(p.email, 'email', 'Unsubscribed');
    }
    return page('Unsubscribed', `<h1>You won’t hear from us again</h1><p class="muted">${esc(p.email || 'This address')} is off Gainora’s list. Sorry for the interruption.</p>`);
  }
  if (p.unsubscribed_at) return page('Unsubscribed', '<h1>You’re already unsubscribed</h1><p class="muted">You won’t get any more emails from Gainora.</p>');
  return page('Unsubscribe', `<h1>Stop emails from Gainora?</h1><div class="card"><p class="muted">${esc(p.email)} won’t get any more emails from us.</p><form method="post"><button class="btn" type="submit">Unsubscribe</button></form></div>`);
};
export const config = { path: '/u/*' };
