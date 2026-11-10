import { loadState } from '../lib/admin';
import { sendEmail } from '../lib/email';
import { gainoraEmails } from '../lib/sites';
import { board, dueLabel, ukToday } from '../../shared/admin/board';

// Every morning at 7am UK time: what Gainora has to do today, what's late, what clients have asked for and who
// hasn't been started yet. Nothing to say, no email.
export default async () => {
  try {
    const s = await loadState();
    const today = ukToday();
    const open = s.tasks.filter((t) => t.status !== 'done' && t.who !== 'client');
    const b = board(open, today);
    const waiting = s.tasks.filter((t) => t.status !== 'done' && t.who === 'client' && t.due_on && t.due_on <= today);
    const notStarted = s.accounts.filter((a) => a.packages.length && a.status !== 'left' && !a.setupStarted);
    const line = (t: { client: string; title: string; due_on: string | null }) => `• ${t.client}: ${t.title} (${dueLabel(t.due_on, today)})`;
    const parts: string[] = [];
    if (b.overdue.length) parts.push(`Late (${b.overdue.length}):\n${b.overdue.slice(0, 15).map(line).join('\n')}`);
    if (b.today.length) parts.push(`Due today (${b.today.length}):\n${b.today.slice(0, 15).map(line).join('\n')}`);
    if (s.requests.length) parts.push(`Website changes clients asked for (${s.requests.length}):\n${s.requests.slice(0, 10).map((r) => `• ${r.client}: ${r.text.slice(0, 120)}`).join('\n')}`);
    if (waiting.length) parts.push(`Waiting on clients (${waiting.length}):\n${waiting.slice(0, 10).map(line).join('\n')}`);
    if (notStarted.length) parts.push(`New clients with no set-up started:\n${notStarted.map((a) => `• ${a.name} (${a.packages.join(', ')})`).join('\n')}`);
    if (!parts.length) return new Response('nothing due');
    const subject = `${b.overdue.length ? `${b.overdue.length} late, ` : ''}${b.today.length} due today${s.requests.length ? `, ${s.requests.length} change requests` : ''}`;
    await sendEmail(gainoraEmails()[0], `Gainora today: ${subject}`, parts, { label: 'Open Gainora admin', url: 'https://admin.gainora.co.uk/' });
    return new Response('sent');
  } catch (e: any) {
    console.error('[gainora] admin daily', e?.message);
    return new Response('failed', { status: 500 });
  }
};
// 07:00 UTC is 7am in winter and 8am in summer (UK time).
export const config = { schedule: '0 7 * * *' };
