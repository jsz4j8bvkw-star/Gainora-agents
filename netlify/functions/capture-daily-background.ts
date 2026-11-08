import { db, requireInternal } from '../lib/core';
import { appUrl, toRecord, withDefaults } from '../lib/capture';
import { sendEmail } from '../lib/email';
import { followUps, report, words } from '../../shared/capture';
import { advice, rebookDue } from '../../shared/insight';

// Background function (up to 15 minutes), started by the morning schedule. For each client:
// 1. a short morning email when something needs them: enquiries not replied to, quote chasers,
//    payment reminders and review requests due today (nothing is sent to their customers),
// 2. on the 1st of the month, last month's report.
const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async (req: Request) => {
  try {
    requireInternal(req);
    const now = new Date();
    const firstOfMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric' }).format(now) === '1';
    const ents = await db<any[]>('entitlements?select=user_id,email&agent=eq.capture&status=in.(active,trialing)&user_id=not.is.null');
    for (const ent of ents) {
      try {
        const [srow] = await db<any[]>(`capture_settings?select=data&user_id=eq.${ent.user_id}`);
        const s = withDefaults(srow?.data);
        if (!s.completedAt) continue;
        const to = s.business.alertEmail || ent.email;
        const since = new Date(now.getTime() - 70 * 86_400_000).toISOString();
        const list = (await db<any[]>(`enquiries?select=*&user_id=eq.${ent.user_id}&is_test=eq.false&or=(received_at.gte.${since},status.in.(quoted,won))&order=received_at.desc&limit=1000`)).map(toRecord);

        const appts = s.business.kind === 'appointments';
        const W = words(s.business.kind);
        const unreplied = list.filter((e) => e.status === 'new' && now.getTime() - new Date(e.receivedAt).getTime() > 2 * 3600_000);
        const due = followUps(list, now).filter((f) => f.due);
        const quotes = due.filter((f) => f.kind === 'quote').length;
        const pays = due.filter((f) => f.kind === 'payment');
        const reviews = due.filter((f) => f.kind === 'review').length;
        // Clients who became due back today (not the whole list every morning).
        const back = rebookDue(list, s, now, 0).filter((b) => b.overdueDays === 0);
        const parts = [
          unreplied.length && plural(unreplied.length, 'enquiry is waiting for a reply', 'enquiries are waiting for a reply'),
          back.length && `${plural(back.length, 'client is', 'clients are')} due back for their next treatment (${back.slice(0, 3).map((b) => `${b.enquiry.name.split(' ')[0] || 'a client'}${b.type ? `: ${b.type}` : ''}`).join(', ')}${back.length > 3 ? '…' : ''})`,
          quotes && plural(quotes, 'quote is ready to chase', 'quotes are ready to chase'),
          pays.length && `${plural(pays.length, 'payment reminder is', 'payment reminders are')} due (${money(pays.reduce((a, f) => a + (f.enquiry.jobValue ?? 0), 0))} outstanding)`,
          reviews && plural(reviews, `happy ${W.customer} could leave a review`, `happy ${W.customer}s could leave a review`),
        ].filter(Boolean) as string[];
        if (parts.length) {
          await sendEmail(to, `Today: ${parts.length === 1 ? parts[0] : `${parts.length} things to follow up`}`, [
            `Good morning ${s.business.ownerName || ''}`.trim() + '.',
            ...parts.map((p) => `• ${p[0].toUpperCase()}${p.slice(1)}.`),
            appts ? 'Each one has a message drafted for you, and the automatic ones go out on their own if they’re switched on.' : 'Each one has a message drafted for you. Nothing is sent until you send it.',
          ], { label: 'Open your follow-ups', url: `${appUrl()}/follow-ups` });
        }

        if (firstOfMonth) {
          const end = new Date(now.getFullYear(), now.getMonth(), 1);
          const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const r = report(list, start, end, s, now);
          if (r.caught) {
            const month = start.toLocaleDateString('en-GB', { month: 'long' });
            const tips = advice(r, list, s, { from: start, to: end }, now);
            await sendEmail(to, `${month}: ${plural(r.caught, 'enquiry', 'enquiries')} caught`, [
              `Here’s ${month} for ${s.business.name}.`,
              `Your receptionist and inbox caught ${plural(r.caught, 'enquiry', 'enquiries')}, ${r.afterHours} of them while you were closed${r.emergencies ? `, and flagged ${plural(r.emergencies, 'emergency', 'emergencies')} straight to you` : ''}.`,
              appts
                ? `${plural(r.booked, 'appointment was', 'appointments were')} booked${r.bookedValue ? `, worth ${r.bookedValueFrom ? 'at least ' : ''}${money(r.bookedValue)} by your own prices` : ''}${r.noShows ? `. ${plural(r.noShows, 'client', 'clients')} didn’t turn up or cancelled late` : ''}.`
                : `${plural(r.quotes, 'quote', 'quotes')} went out and ${plural(r.won, 'job was', 'jobs were')} won${r.wonValue ? `, worth ${money(r.wonValue)}` : ''}.`,
              r.outstanding ? `${money(r.outstanding)} is still waiting to be paid.` : '',
              ...(tips.length ? ['What to change next month:', ...tips.map((t) => `• ${t.title}. ${t.detail}`)] : []),
            ].filter(Boolean), { label: 'See the full report', url: `${appUrl()}/report` });
          }
        }
      } catch (e: any) { console.error('[capture] daily for client failed', e?.message); }
    }
  } catch (e: any) { console.error('[capture] daily failed', e?.message); }
  return new Response('ok');
};
