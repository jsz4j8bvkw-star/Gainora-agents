import { db } from '../lib/core';
import { blockedSet, getSettings, outreachReady, sendOutreachEmail, sequences } from '../lib/business';
import { canEmail, dueFollowUps, type Prospect } from '../../shared/admin/sales';
import { ukToday } from '../../shared/admin/board';

// Weekday mornings: sends the outreach emails that are due, if automatic sending is on in the admin's settings.
// Only email steps; LinkedIn, Instagram, Facebook and WhatsApp messages wait in Follow-ups for Adelin to send.
// Every email passes the same checks as sending by hand (company type, consent, do-not-contact, unsubscribed).
export async function runOutreach(today = ukToday()): Promise<{ sent: number; skipped: string[] }> {
  const settings = await getSettings();
  if (!settings.outreach.autoSend || !outreachReady()) return { sent: 0, skipped: ['Automatic sending is off or outreach email isn’t set up.'] };
  const [list, seqs, blocked] = await Promise.all([db<Prospect[]>('prospects?select=*&next_on=not.is.null&limit=5000'), sequences(), blockedSet()]);
  const bySeq = new Map(seqs.map((s) => [s.id, s]));
  const skipped: string[] = [];
  let sent = 0;
  for (const p of dueFollowUps(list, today)) {
    if (sent >= settings.outreach.dailyLimit) break;
    const seq = bySeq.get(p.sequence_id ?? '');
    const step = seq?.steps[p.step];
    if (!seq || !seq.active || !step || step.channel !== 'email') continue;
    if (!canEmail(p, blocked).ok) continue;
    // Two failed tries at the same message: stop and leave it for a person to look at.
    const failed = await db<any[]>(`outreach_messages?select=id&prospect_id=eq.${p.id}&step=eq.${p.step}&status=eq.failed`).catch(() => []);
    if (failed.length >= 2) { skipped.push(`${p.business_name}: the email failed twice`); continue; }
    const r = await sendOutreachEmail(p, seq, 'Gainora (automatic)', settings);
    if (r.ok) sent++; else skipped.push(`${p.business_name}: ${r.why}`);
  }
  return { sent, skipped };
}

export default async () => {
  try {
    const r = await runOutreach();
    return new Response(`sent ${r.sent}`);
  } catch (e: any) {
    console.error('[gainora] outreach daily', e?.message);
    return new Response('failed', { status: 500 });
  }
};
// 09:30 UTC on weekdays: 9:30am in winter, 10:30am in summer (UK time).
export const config = { schedule: '30 9 * * 1-5' };
