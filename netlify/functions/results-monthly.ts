import { db, enc } from '../lib/core';
import { loadState, log } from '../lib/admin';
import { getSettings, lastMonth, monthResults } from '../lib/business';
import { sendEmail } from '../lib/email';
import { ownerEmail } from '../lib/sites';
import { resultsEmail } from '../../shared/admin/care';
import { ukToday } from '../../shared/admin/board';

// On the 1st of each month, if switched on in the admin: each active client gets a short email of what Gainora did
// for them last month. Only facts from their own numbers; nothing to report, no email.
export async function runResults(today = ukToday()): Promise<{ sent: number }> {
  if (!(await getSettings()).care.resultsEmails) return { sent: 0 };
  const s = await loadState();
  const month = lastMonth(today);
  const thisMonth = `${today.slice(0, 7)}-01`;
  let sent = 0;
  for (const acc of s.accounts) {
    if (!acc.packages.length || acc.status === 'left' || acc.billing === 'canceled') continue;
    // Already sent this month (by hand from the admin, or a retry).
    const done = await db<any[]>(`admin_log?select=id&email=eq.${enc(acc.email)}&kind=eq.email&at=gte.${thisMonth}&text=like.*results%20email*`).catch(() => []);
    if (done.length) continue;
    const site = s.sitesByEmail.get(acc.email);
    const r = await monthResults(acc.userId, site?.published ? site.id : null, month, { capture: acc.packages.includes('capture'), command: acc.packages.includes('command') });
    const first = (s.records.get(acc.email)?.contact_name || '').split(' ')[0] || acc.name;
    const mail = resultsEmail(first, r);
    if (!mail) continue;
    const to = (acc.userId && (await ownerEmail(acc.userId))) || acc.email;
    try {
      await sendEmail(to, mail.subject, mail.paragraphs);
      await log(acc.email, 'Gainora (automatic)', `Sent the ${mail.subject.replace('Your ', '').replace(' with Gainora', '')} results email.`, 'email');
      sent++;
    } catch (e: any) { console.error('[gainora] results email', acc.email, e?.message); }
  }
  return { sent };
}

export default async () => {
  try { return new Response(`sent ${(await runResults()).sent}`); }
  catch (e: any) { console.error('[gainora] results monthly', e?.message); return new Response('failed', { status: 500 }); }
};
// 09:00 UTC on the 1st of each month.
export const config = { schedule: '0 9 1 * *' };
