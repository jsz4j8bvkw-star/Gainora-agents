import { randomUUID } from 'node:crypto';
import { db } from '../lib/core';
import { loadState } from '../lib/admin';
import { unpaidInvoices } from '../lib/business';
import { sendEmail } from '../lib/email';
import { gainoraEmails } from '../lib/sites';
import { board, dueLabel, ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import { dueFollowUps, type Prospect } from '../../shared/admin/sales';
import { dueSoon, type Deadline } from '../../shared/admin/books';
import { money } from '../../shared/admin/prices';

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

/** Clients 60+ days in and still with Gainora get a "ask for a testimonial and a referral" task, once. */
export async function careTasks(today = ukToday()): Promise<number> {
  const s = await loadState();
  const rows = [...s.records.values()]
    .filter((r) => r.status !== 'left' && r.started_on && r.started_on <= addDays(today, -60))
    .filter((r) => s.accounts.find((a) => a.email === r.email)?.packages.length)
    .map((r) => ({
      id: randomUUID(), email: r.email, project: 'other', template_key: 'care:testimonial', title: 'Ask for a testimonial and a referral',
      detail: 'They’ve been with Gainora 60 days. Send their results, ask for a Google review of Gainora or a short quote for the website, and whether they know another business owner who’d want the same.',
      who: 'gainora', due_on: today, status: 'todo', done_at: null, sort: 900, created_by: 'Gainora (automatic)', created_at: new Date().toISOString(),
    }));
  if (!rows.length) return 0;
  const made = await safe(db<any[]>('admin_tasks?on_conflict=email,template_key', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation' }), []);
  return made.length;
}

// Every morning at 7am UK time: what Gainora has to do today. Delivery (late and due steps, change requests, clients
// not started), sales (follow-ups to send, calls, proposals to chase) and the business (failed payments, deadlines).
// Nothing to say, no email.
export default async () => {
  try {
    const today = ukToday();
    await safe(careTasks(today), 0);
    const [s, prospects, proposals, deadlines, unpaid] = await Promise.all([
      loadState(),
      safe(db<Prospect[]>('prospects?select=*&limit=5000'), []),
      safe(db<any[]>('proposals?select=business_name,status,sent_at,viewed_at,expires_on&status=in.(sent,viewed)&limit=500'), []),
      safe(db<Deadline[]>('business_deadlines?select=*&done_at=is.null&limit=500'), []),
      unpaidInvoices(),
    ]);
    const open = s.tasks.filter((t) => t.status !== 'done' && t.who !== 'client');
    const b = board(open, today);
    const waiting = s.tasks.filter((t) => t.status !== 'done' && t.who === 'client' && t.due_on && t.due_on <= today);
    const notStarted = s.accounts.filter((a) => a.packages.length && a.status !== 'left' && !a.setupStarted);
    const followUps = dueFollowUps(prospects, today);
    const calls = prospects.filter((p) => p.call_at && p.call_at.slice(0, 10) === today).sort((x, y) => x.call_at!.localeCompare(y.call_at!));
    const chase = proposals.filter((p) => (p.viewed_at || p.sent_at) && String(p.viewed_at || p.sent_at).slice(0, 10) <= addDays(today, -3));
    const soon = dueSoon(deadlines, today, 7);
    const line = (t: { client: string; title: string; due_on: string | null }) => `• ${t.client}: ${t.title} (${dueLabel(t.due_on, today)})`;
    const parts: string[] = [];
    if (unpaid.length) parts.push(`Payments that failed (${unpaid.length}):\n${unpaid.slice(0, 10).map((u) => `• ${s.accounts.find((a) => a.email === u.email)?.name || u.email}: ${money(u.amount)}, ${u.attempts} attempt${u.attempts === 1 ? '' : 's'}`).join('\n')}`);
    if (b.overdue.length) parts.push(`Late (${b.overdue.length}):\n${b.overdue.slice(0, 15).map(line).join('\n')}`);
    if (b.today.length) parts.push(`Due today (${b.today.length}):\n${b.today.slice(0, 15).map(line).join('\n')}`);
    if (calls.length) parts.push(`Sales calls today:\n${calls.map((p) => `• ${time(p.call_at!)} ${p.business_name}${p.contact_name ? ` (${p.contact_name})` : ''}`).join('\n')}`);
    if (followUps.length) parts.push(`Outreach messages due (${followUps.length}):\n${followUps.slice(0, 10).map((p) => `• ${p.business_name}`).join('\n')}${followUps.length > 10 ? `\n…and ${followUps.length - 10} more` : ''}`);
    if (chase.length) parts.push(`Proposals with no answer for 3+ days:\n${chase.slice(0, 10).map((p) => `• ${p.business_name} (${p.status === 'viewed' ? 'opened' : 'not opened yet'})`).join('\n')}`);
    if (s.requests.length) parts.push(`Website changes clients asked for (${s.requests.length}):\n${s.requests.slice(0, 10).map((r) => `• ${r.client}: ${r.text.slice(0, 120)}`).join('\n')}`);
    if (waiting.length) parts.push(`Waiting on clients (${waiting.length}):\n${waiting.slice(0, 10).map(line).join('\n')}`);
    if (notStarted.length) parts.push(`New clients with no set-up started:\n${notStarted.map((a) => `• ${a.name} (${a.packages.join(', ')})`).join('\n')}`);
    if (soon.length) parts.push(`Business deadlines this week:\n${soon.map((d) => `• ${d.title} (${dueLabel(d.due_on, today)})`).join('\n')}`);
    if (!parts.length) return new Response('nothing due');
    const bits = [unpaid.length && `${unpaid.length} failed payment${unpaid.length === 1 ? '' : 's'}`, b.overdue.length && `${b.overdue.length} late`, `${b.today.length} due today`, calls.length && `${calls.length} call${calls.length === 1 ? '' : 's'}`, followUps.length && `${followUps.length} follow-up${followUps.length === 1 ? '' : 's'}`].filter(Boolean);
    await sendEmail(gainoraEmails()[0], `Gainora today: ${bits.join(', ')}`, parts, { label: 'Open Gainora admin', url: 'https://admin.gainora.co.uk/' });
    return new Response('sent');
  } catch (e: any) {
    console.error('[gainora] admin daily', e?.message);
    return new Response('failed', { status: 500 });
  }
};
// 07:00 UTC is 7am in winter and 8am in summer (UK time).
export const config = { schedule: '0 7 * * *' };
