import { addActions, addAlert, callInternal, db, env, requireInternal } from '../lib/core';
import { sendEmail } from '../lib/email';
import { formatMinutes, summariseValue, valueSentence, type ValueEvent } from '../../shared/value';

// Background function (up to 15 minutes), started by the daily schedule:
// 1. starts each client's Watcher run,
// 2. sends the weekly summary email on each client's report day,
// 3. reminds clients about follow-ups that are due today,
// 4. on the 1st of the month, sends "Your month with Gainora".
const DAY = 86_400_000;
const NAMES: Record<string, string> = { watcher: 'The Watcher', scout: 'The Scout', brief: 'The Brief' };
const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const londonPart = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts }).format(d);

export default async (req: Request) => {
  try {
    requireInternal(req);
    const now = new Date();
    const ents = await db<any[]>('entitlements?select=user_id,email,agent&status=in.(active,trialing)&user_id=not.is.null');
    const byUser = new Map<string, { email: string; agents: Set<string> }>();
    for (const e of ents) {
      const u = byUser.get(e.user_id) ?? { email: e.email, agents: new Set<string>() };
      u.agents.add(e.agent); byUser.set(e.user_id, u);
    }
    const today = londonPart(now, { weekday: 'long' });
    const firstOfMonth = londonPart(now, { day: 'numeric' }) === '1';
    const app = env('APP_URL', 'https://app.gainora.co.uk');

    for (const [userId, u] of byUser) {
      try {
        if (u.agents.has('watcher')) await callInternal('watcher-background', { userId, quiet: false });
        const [p] = await db<any[]>(`profiles?select=data&user_id=eq.${userId}&completed_at=not.is.null`);
        if (!p) continue;
        const business = p.data?.business?.name || 'your business';
        const owner = p.data?.business?.ownerName || '';
        const to = [u.email, p.data?.preferences?.extraRecipient].filter(Boolean) as string[];

        // Weekly summary on the client's report day.
        if ((p.data?.preferences?.reportDay || 'Monday') === today) {
          const notes = await db<any[]>(`agent_notes?select=agent,body,created_at&user_id=eq.${userId}&created_at=gte.${new Date(now.getTime() - 7 * DAY).toISOString()}&order=created_at.desc`);
          const latest = new Map<string, string>();
          for (const n of notes) if (!latest.has(n.agent)) latest.set(n.agent, n.body);
          const lines = [...latest.entries()].map(([a, b]) => `${NAMES[a]}: ${b}`);
          if (u.agents.has('brief')) lines.push('The Brief: add this week’s numbers and you’ll get your three priorities for the week.');
          if (lines.length) {
            for (const addr of to) await sendEmail(addr, `Your week at ${business}`, [`Good morning${owner ? ` ${owner}` : ''}. Here’s what your agents found this week.`, ...lines], { label: 'Open Gainora', url: app }).catch((e) => console.error('[gainora] digest', e?.message));
          }
        }

        // Monthly results on the 1st.
        if (firstOfMonth) {
          const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const end = new Date(now.getFullYear(), now.getMonth(), 1);
          const rows = await db<any[]>(`value_events?select=id,agent,kind,title,amount,created_at&user_id=eq.${userId}&created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&limit=3000`);
          if (rows.length) {
            const events: ValueEvent[] = rows.map((r) => ({ id: r.id, agent: r.agent, kind: r.kind, title: r.title, amount: r.amount != null ? Number(r.amount) : null, at: r.created_at }));
            const v = summariseValue(events);
            const month = londonPart(new Date(start.getTime() + 15 * DAY), { month: 'long' });
            const lines = [
              `Good morning${owner ? ` ${owner}` : ''}. Here’s what your agents did for ${business} in ${month}.`,
              valueSentence(v, `in ${month}`),
              ...(v.minutesSaved >= 30 ? [`That’s about ${formatMinutes(v.minutesSaved)} of work you didn’t have to do yourself. It’s an estimate, based on typical times for each task.`] : []),
              ...(v.wonValue ? [`You recorded ${money(v.wonValue)} in won deals from your leads.`] : []),
              ...(v.tenderValue ? [`The public contracts the Scout found for you have a combined published value of ${money(v.tenderValue)}.`] : []),
            ];
            for (const addr of to) await sendEmail(addr, `Your ${month} with Gainora`, lines, { label: 'See your results', url: `${app}/results` }).catch((e) => console.error('[gainora] monthly', e?.message));
          }
        }
      } catch (e: any) { console.error('[gainora] daily user', userId, e?.message); }
    }

    // Follow-up reminders, once per follow-up that falls due today.
    const scout = new Set([...byUser.entries()].filter(([, u]) => u.agents.has('scout')).map(([id]) => id));
    const endOfDay = new Date(now); endOfDay.setUTCHours(23, 59, 59, 999);
    const due = await db<any[]>(`leads?select=id,user_id,name,contacted_at,follow_ups&stage=eq.contacted&last_reminded_at=is.null&next_follow_up_at=lte.${endOfDay.toISOString()}&limit=2000`);
    for (const l of due) {
      if (!scout.has(l.user_id)) continue;
      const days = l.contacted_at ? Math.max(1, Math.round((now.getTime() - new Date(l.contacted_at).getTime()) / DAY)) : null;
      const last = Number(l.follow_ups ?? 0) >= 1;
      await addAlert(l.user_id, 'scout', 'notice', `Follow up with ${l.name} today`,
        `${days ? `It’s been ${days} days since you got in touch. ` : ''}${last ? 'A last, friendly note closes the loop politely.' : 'A short, friendly nudge often gets the reply.'} The Scout has written it for you in Your leads.`);
      await addActions(l.user_id, 'scout', [`Follow up with ${l.name} (it’s written for you in Your leads)`]);
      await db(`leads?id=eq.${l.id}`, { method: 'PATCH', body: { last_reminded_at: now.toISOString() } });
    }
  } catch (e: any) { console.error('[gainora] daily-background', e?.message); }
  return new Response(null, { status: 202 });
};
