// "Do these today": one ranked list built from everything the agents found, weighted by what is
// most likely to cost or earn the owner money. Pure and shared, so the demo and the live app agree.
//
// Weights are an ordering, not a prediction. Every "why" uses only figures the app really has:
// a contract's published value, a deal value the owner entered, a change the Watcher saw.

import type { Action, AgentId, BusinessProfile, Lead, Tender, WatcherState } from '../src/lib/types';
import type { MetricChange } from './metrics';
import { isDue } from './leads';
import { daysLeft } from './tenders';

export interface TodayItem {
  id: string;
  agent: AgentId;
  title: string;   // what to do, in the imperative
  why: string;     // one or two sentences on why it matters, with the real figure where there is one
  cta: string;     // the button: what happens when it is tapped
  link: string;    // in-app path, with ?tab= and the item to open
  weight: number;
}

export interface TodayInput {
  profile: BusinessProfile;
  agents: AgentId[];
  watcher?: WatcherState | null;
  leads?: Lead[];
  tenders?: Tender[];
  searches?: number;              // how many Scout searches exist
  changes?: MetricChange[];       // this week's Brief analysis
  hasThisWeeksNumbers?: boolean;
  googleConfigured?: boolean;     // whether the Watcher can read Google reviews at all
  now?: Date;
}

const DAY = 86_400_000;
const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const first = (s: string) => s.split(' ')[0];
const quote = (t: string, n = 90) => `“${t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t}”`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function planToday(input: TodayInput, limit = 3): TodayItem[] {
  const { profile, agents } = input;
  const now = input.now ?? new Date();
  const items: TodayItem[] = [];
  const w = input.watcher;
  const wholesale = /wholesale|b2b/i.test(profile.goals?.focus || '');

  if (agents.includes('watcher') && w) {
    if (!w.up) items.push({ id: 'site-down', agent: 'watcher', weight: 100, title: 'Get your website back online', why: 'The Watcher could not load your home page. Until it is back, visitors see an error and enquiries stop.', cta: 'See the check', link: '/watcher?tab=overview' });
    const contact = w.issues.find((i) => i.id === 'contact');
    if (contact) items.push({ id: 'contact', agent: 'watcher', weight: 92, title: 'Fix your contact page', why: `${contact.detail} Every enquiry that fails to arrive is a sale you never hear about.`, cta: contact.link ? 'Open the page' : 'See the details', link: '/watcher?tab=overview' });
    if (w.sslDaysLeft != null && w.sslDaysLeft < 30) {
      items.push({ id: 'ssl', agent: 'watcher', weight: w.sslDaysLeft < 10 ? 88 : 35, title: w.sslDaysLeft < 10 ? 'Renew your security certificate now' : 'Check your security certificate will renew', why: `It expires in ${plural(w.sslDaysLeft, 'day')}. If it lapses, browsers warn visitors that your site is not safe and most leave.`, cta: 'See the details', link: '/watcher?tab=overview' });
    }
    const rv = w.reviews;
    if (rv) {
      const low = rv.reviews.filter((r) => r.isNew && r.rating <= 3).sort((a, b) => a.rating - b.rating);
      for (const r of low.slice(0, 2)) {
        items.push({
          id: `review-${r.id}`, agent: 'watcher', weight: r.rating <= 2 ? 80 : 64,
          title: `Reply to ${r.author}’s ${r.rating}-star review`,
          why: `${first(r.author)} wrote ${r.when}${r.text ? `: ${quote(r.text)}` : ', with no comment'}. It sits at the top of your Google listing for everyone deciding whether to buy; a calm public reply is drafted for you.`,
          cta: 'Open the drafted reply', link: `/watcher?tab=reviews&review=${encodeURIComponent(r.id)}`,
        });
      }
    } else if (input.googleConfigured !== false) {
      items.push({ id: 'google', agent: 'watcher', weight: 50, title: 'Connect your Google listing', why: 'Once the Watcher knows your listing it reads new reviews every morning and drafts your replies, so a bad review never sits unanswered.', cta: 'Find my listing', link: '/watcher?tab=reviews' });
    }
    const recent = w.changes.filter((c) => now.getTime() - new Date(c.at).getTime() < 7 * DAY);
    const priceOrOffer = recent.find((c) => c.kind === 'price' || c.kind === 'offer');
    if (priceOrOffer) items.push({ id: `change-${priceOrOffer.id}`, agent: 'watcher', weight: 48, title: `Decide how to answer ${priceOrOffer.competitor}`, why: `${priceOrOffer.summary}${priceOrOffer.detail ? ` ${priceOrOffer.detail}` : ''}`, cta: 'See what changed', link: '/watcher?tab=competitors' });
    const fix = w.speed?.fixes.find((f) => !f.done && f.impact === 'High' && f.who === 'You');
    if (fix) items.push({ id: `fix-${fix.id}`, agent: 'watcher', weight: 42, title: fix.title, why: `${fix.why}${fix.saving ? ` Google’s test says this ${fix.saving}.` : ''} You can do it yourself.`, cta: 'See how', link: '/watcher?tab=speed' });
    if (w.brokenLinks.length) items.push({ id: 'links', agent: 'watcher', weight: 28, title: `Fix ${plural(w.brokenLinks.length, 'broken link')}`, why: 'Visitors who click them see an error page and many give up. The list shows where each one is.', cta: 'See the list', link: '/watcher?tab=overview' });
  }

  if (agents.includes('scout')) {
    const leads = input.leads ?? [];
    const due = leads.filter((l) => l.stage === 'contacted' && isDue(l.nextFollowUp, now))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (a.nextFollowUp ?? '').localeCompare(b.nextFollowUp ?? ''));
    for (const l of due.slice(0, 2)) {
      const days = l.contactedAt ? Math.max(1, Math.round((now.getTime() - new Date(l.contactedAt).getTime()) / DAY)) : null;
      items.push({
        id: `follow-${l.id}`, agent: 'scout', weight: 75 + (l.value ? 10 : 0),
        title: `Follow up with ${l.name}`,
        why: `${days ? `You got in touch ${plural(days, 'day')} ago and haven’t heard back, which is normal. ` : ''}${l.followUps >= 1 ? 'A last, gracious note is written for you.' : 'A short, friendly nudge is written for you.'}${l.value ? ` You put this deal at ${money(l.value)}.` : ''}`,
        cta: 'Open the follow-up', link: `/scout?tab=leads&lead=${encodeURIComponent(l.id)}`,
      });
    }
    const tenders = (input.tenders ?? []).filter((t) => t.status === 'new' || t.status === 'saved');
    const scored = tenders.map((t) => {
      const d = daysLeft(t.deadline, now);
      let weight = t.fit === 'strong' ? 60 : 36;
      if (d != null && d <= 14) weight += 18;
      if (d != null && d <= 3) weight -= 30; // too late to bid well
      return { t, d, weight };
    }).sort((a, b) => b.weight - a.weight || (b.t.value ?? 0) - (a.t.value ?? 0));
    const best = scored[0];
    if (best && best.weight > 30) {
      items.push({
        id: `tender-${best.t.id}`, agent: 'scout', weight: best.weight,
        title: `Read the “${best.t.title.length > 60 ? best.t.title.slice(0, 60).replace(/\s+\S*$/, '') + '…' : best.t.title}” contract`,
        why: `For ${best.t.buyer}${best.t.value ? `, with a published value of ${money(best.t.value)}` : ''}${best.d != null ? `, closing in ${plural(best.d, 'day')}` : ''}. ${best.t.reason}`,
        cta: 'See the contract', link: '/scout?tab=contracts',
      });
    }
    const toContact = leads.filter((l) => l.stage === 'to_contact');
    if (toContact.length) {
      const l = toContact[0];
      items.push({
        id: `intro-${l.id}`, agent: 'scout', weight: wholesale ? 66 : 58,
        title: `Introduce yourself to ${l.name}`,
        why: `${l.reason ? `${l.reason} ` : ''}${toContact.length > 1 ? `${plural(toContact.length - 1, 'more lead')} ${toContact.length - 1 === 1 ? 'is' : 'are'} waiting too. ` : ''}The introduction is drafted; you read it, make it yours and send it.`,
        cta: 'Open the introduction', link: `/scout?tab=leads&lead=${encodeURIComponent(l.id)}`,
      });
    }
    if (!leads.length && !(input.searches ?? 0)) {
      items.push({ id: 'first-search', agent: 'scout', weight: 45, title: 'Start your first search', why: `Tell the Scout who you want to sell to and it comes back with a sourced shortlist${wholesale ? ' of shops that could stock you' : ''}, each with a ready-to-edit introduction.`, cta: 'Start research', link: '/scout?tab=research' });
    }
  }

  if (agents.includes('brief')) {
    const dip = (input.changes ?? []).find((c) => (c.metric.id === 'orders' || c.metric.id === 'revenue') && c.direction === 'down' && (c.changePct ?? 0) <= -10);
    if (dip) items.push({ id: 'winback', agent: 'brief', weight: 55, title: 'Send a note to past customers', why: `${dip.metric.label} fell ${Math.abs(dip.changePct ?? 0)}% on last week. People who have bought before are the quickest sales to win back; the Brief writes the email, text and post for you.`, cta: 'Write my messages', link: '/brief?open=winback' });
    if (input.hasThisWeeksNumbers === false) {
      const hasAny = (input.changes ?? []).some((c) => c.previous != null || c.current != null);
      items.push({ id: 'numbers', agent: 'brief', weight: hasAny ? 40 : 46, title: 'Add this week’s numbers', why: hasAny ? 'Two minutes of rough figures and the Brief tells you what moved, why, and what to do about it this week.' : 'Your first Brief is one step away. Rough figures are fine; from the second week it compares every week with the last and with your goal.', cta: 'Add my numbers', link: '/brief' });
    }
  }

  return items.sort((a, b) => b.weight - a.weight).slice(0, limit);
}

/** Where a to-do item leads when tapped: worked out from what it says, since actions carry no link. */
export function actionLink(a: Pick<Action, 'text' | 'agent'>): string | null {
  const t = a.text.toLowerCase();
  if (a.agent === 'you') return null;
  if (/review/.test(t) && !/competitor|changed/.test(t)) return '/watcher?tab=reviews';
  if (/google listing/.test(t)) return '/watcher?tab=reviews';
  if (/contract|tender/.test(t)) return '/scout?tab=contracts';
  if (/follow up|follow-up|contacted|introduc|leads?\b|stockist/.test(t)) return '/scout?tab=leads';
  if (/competitor|deliver|price|changed|match /.test(t)) return '/watcher?tab=competitors';
  if (/photo|image|speed|load|lazy|description for google|alt text/.test(t)) return '/watcher?tab=speed';
  if (/contact page|broken link|site is down|host|certificate|website/.test(t)) return '/watcher?tab=overview';
  if (/numbers|brief|win-back|past customers/.test(t)) return '/brief';
  if (/search|research|strong-fit|opportunit/.test(t)) return '/scout?tab=research';
  return { watcher: '/watcher', scout: '/scout', brief: '/brief' }[a.agent] ?? null;
}
