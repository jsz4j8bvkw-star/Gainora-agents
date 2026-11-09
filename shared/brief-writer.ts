import type { BusinessProfile } from '../src/lib/types';
import { isGood, type MetricChange } from './metrics';

function fmt(c: MetricChange, v: number | null): string {
  if (v == null) return '–';
  if (c.metric.unit === 'money') return '£' + Math.round(v).toLocaleString('en-GB');
  if (c.metric.unit === 'percent') return `${v}%`;
  return Math.round(v).toLocaleString('en-GB');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * What the other agents found this week, so the Brief's priorities are about this business's
 * real leads, contracts and website, not generic advice. Everything optional: the Brief still
 * works on numbers alone.
 */
export interface BriefContext {
  dueFollowUps?: string[];                 // lead names with a follow-up due
  leadsToContact?: string[];               // lead names not yet contacted
  strongLeads?: number;                    // strong-fit research results not yet in the pipeline
  wonLeads?: number;
  inConversation?: number;
  tenders?: { title: string; value: number | null; daysLeft: number | null }[];   // new or saved, best first
  urgentIssue?: string | null;             // e.g. "Your contact page needs attention"
  lowReview?: { author: string; rating: number } | null;
  topFix?: { title: string; who: 'You' | 'Your web person' } | null;
  weeksLeft?: number | null;
  /** The most important competitor event this week (The Watcher's reach), with its suggested action. */
  competitor?: { summary: string; action: string } | null;
  /** Clients due back this week (Your clients): how many, their names, the value at their last prices. */
  dueBack?: { count: number; names: string[]; value: number } | null;
  /** Bookings the owner confirmed came from Gainora this month. */
  brought?: { amount: number; bookings: number } | null;
}

/** The goal line: where the 90-day target stands, using only figures the app has. */
export function goalLine(changes: MetricChange[], profile: BusinessProfile, ctx: BriefContext = {}): string | null {
  const target = profile.goals?.target?.trim();
  if (!target) return null;
  const left = ctx.weeksLeft != null ? `${plural(ctx.weeksLeft, 'week')} left` : null;
  const wholesale = /wholesale|b2b/i.test(profile.goals?.focus || '');
  if (wholesale && (ctx.wonLeads != null || ctx.inConversation != null)) {
    const won = ctx.wonLeads ?? 0; const conv = ctx.inConversation ?? 0;
    const state = won || conv ? `you have ${plural(won, 'stockist')} won${conv ? ` and ${conv} in conversation` : ''}` : 'no stockists are in conversation yet';
    return `Against your goal of ${lower(target)}${left ? ` (${left})` : ''}, ${state}.`;
  }
  const focus = profile.goals?.focus || '';
  const id = /enquir/i.test(focus) ? 'enquiries' : /order value|revenue/i.test(focus) ? 'revenue' : /convert/i.test(focus) ? 'conversion' : 'orders';
  const c = changes.find((x) => x.metric.id === id && x.current != null);
  const n = target.replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (c && n) return `Against your goal of ${lower(target)}${left ? ` (${left})` : ''}, this week’s ${lower(c.metric.label)} came in at ${fmt(c, c.current)}.`;
  return `Against your goal of ${lower(target)}${left ? `, with ${left}` : ''}, this week’s numbers are the measure.`;
}

/** A careful, rule-based brief. Used directly in the demo and as the fallback when AI is unavailable. */
export function writeBrief(changes: MetricChange[], profile: BusinessProfile, ctx: BriefContext = {}): { headline: string; paragraphs: string[]; actions: string[] } {
  const known = changes.filter((c) => c.current != null);
  if (!known.length) {
    return {
      headline: 'Add this week’s numbers to get your Brief.',
      paragraphs: ['Your Brief compares each week with the ones before it. Once you’ve added two weeks of numbers, it will start pointing out what changed and why it matters.'],
      actions: ['Add this week’s numbers'],
    };
  }
  const moving = known.filter((c) => c.direction === 'up' || c.direction === 'down')
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  const good = moving.filter((c) => isGood(c) === true);
  const bad = moving.filter((c) => isGood(c) === false);

  let headline: string;
  if (good.length && bad.length) headline = `${good[0].metric.label} ${good[0].direction}, ${lower(bad[0].metric.label)} ${bad[0].direction}. Here’s where to look.`;
  else if (bad.length) headline = `${bad[0].metric.label} dropped this week. Worth a closer look before it becomes a trend.`;
  else if (good.length) headline = `A good week: ${lower(good[0].metric.label)} ${good[0].direction === 'up' ? 'rose' : 'fell'} ${Math.abs(good[0].changePct ?? 0)}%.`;
  else headline = 'A steady week. Nothing moved much, which makes it a good week to try something new.';

  const paragraphs: string[] = [];
  const lines = moving.slice(0, 3).map((c) => {
    const verb = c.direction === 'up' ? 'rose' : 'fell';
    const wow = c.changePct != null ? `${c.changePct > 0 ? 'up' : 'down'} ${Math.abs(c.changePct)}% on last week` : '';
    // The four-week average only adds something once it differs from last week (from the third week on).
    const avg = c.average4 != null && c.vsAveragePct != null && c.average4 !== c.previous ? `${Math.abs(c.vsAveragePct)}% ${c.vsAveragePct >= 0 ? 'above' : 'below'} your four-week average` : '';
    const brackets = [wow, avg].filter(Boolean).join(', and ');
    return `${c.metric.label} ${verb} from ${fmt(c, c.previous)} to ${fmt(c, c.current)}${brackets ? ` (${brackets})` : ''}.`;
  });
  if (lines.length) paragraphs.push(lines.join(' '));

  const enq = known.find((c) => c.metric.id === 'enquiries');
  const ord = known.find((c) => c.metric.id === 'orders');
  if (enq && ord && enq.current && ord.current != null && enq.previous && ord.previous != null && ord.current <= enq.current && ord.previous <= enq.previous) {
    const rateNow = Math.round((ord.current / enq.current) * 100);
    const ratePrev = Math.round((ord.previous / enq.previous) * 100);
    if (rateNow !== ratePrev) {
      paragraphs.push(rateNow < ratePrev
        ? `For every 100 enquiries you made about ${rateNow} sales, down from ${ratePrev} last week. More people are asking, but fewer are buying, so the gap is in follow-up rather than marketing.`
        : `For every 100 enquiries you made about ${rateNow} sales, up from ${ratePrev} last week. Whatever changed in how you followed up is working; keep it.`);
    }
  }

  const goal = goalLine(changes, profile, ctx);
  if (ctx.brought?.bookings) paragraphs.push(`Gainora’s messages brought in ${money(ctx.brought.amount)} from ${plural(ctx.brought.bookings, 'booking')} you confirmed this month${ctx.dueBack?.count ? `, and ${plural(ctx.dueBack.count, 'client')} ${ctx.dueBack.count === 1 ? 'is' : 'are'} due back this week` : ''}.`);
  else if (ctx.dueBack?.count) paragraphs.push(`${plural(ctx.dueBack.count, 'client')} ${ctx.dueBack.count === 1 ? 'is' : 'are'} due back this week${ctx.dueBack.value ? `, worth ${money(ctx.dueBack.value)} at their last prices` : ''}: the quickest bookings there are, and the texts are drafted.`);
  const steer = bad.length
    ? `The priority this week is to stop the drop in ${lower(bad[0].metric.label)} before adding anything new.`
    : 'You’re moving the right way. Protect the time that produced this week’s result.';
  paragraphs.push(goal ? `${goal} ${steer}` : steer);

  // Priorities: the owner's goal first, then what the other agents found, then the numbers.
  const focus = profile.goals?.focus || '';
  const wholesale = /wholesale|b2b/i.test(focus);
  const actions: string[] = [];
  const push = (a: string) => { if (actions.length < 3 && !actions.includes(a)) actions.push(a); };

  if (ctx.urgentIssue) push(`${ctx.urgentIssue.replace(/\.$/, '')}, so fix that before anything else (enquiries and orders depend on it)`);
  if (ctx.dueBack?.count) push(`Text the ${ctx.dueBack.count} client${ctx.dueBack.count === 1 ? '' : 's'} due back this week${ctx.dueBack.names.length ? ` (${ctx.dueBack.names.slice(0, 2).join(', ')}${ctx.dueBack.count > 2 ? ' and others' : ''})` : ''}${ctx.dueBack.value ? `, worth ${money(ctx.dueBack.value)} at their last prices` : ''}; the drafts are under Your clients`);
  if (ctx.dueFollowUps?.length) push(`Follow up with ${ctx.dueFollowUps.slice(0, 2).join(' and ')}${ctx.dueFollowUps.length > 2 ? ` and ${ctx.dueFollowUps.length - 2} more` : ''} (the notes are written for you in The Scout)`);
  if (wholesale) {
    if (ctx.leadsToContact?.length) push(`Send your introduction to ${ctx.leadsToContact.slice(0, 2).join(' and ')}${ctx.leadsToContact.length > 2 ? ` and ${ctx.leadsToContact.length - 2} more` : ''} this week`);
    else if (ctx.strongLeads) push(`Add the ${plural(ctx.strongLeads, 'strong-fit shop')} the Scout found to your leads and send the first two introductions`);
  }
  if (ctx.lowReview) push(`Reply to ${ctx.lowReview.author}’s ${ctx.lowReview.rating}-star review today (the reply is drafted in The Watcher)`);
  if (ctx.competitor) push(`${ctx.competitor.action.replace(/\.$/, '')} (${lower(ctx.competitor.summary).replace(/\.$/, '')})`);
  const t = ctx.tenders?.[0];
  if (t && (t.daysLeft == null || t.daysLeft > 3)) push(`Decide whether to bid for “${t.title.length > 70 ? t.title.slice(0, 70).replace(/\s+\S*$/, '') + '…' : t.title}”${t.value ? ` (published value ${money(t.value)})` : ''}${t.daysLeft != null ? `, which closes in ${plural(t.daysLeft, 'day')}` : ''}`);

  const dip = bad.some((c) => c.metric.id === 'orders' || c.metric.id === 'revenue');
  if (dip && (/win back/i.test(focus) || !wholesale)) push('Send the win-back note to past customers (the email, text and post are written for you in The Brief)');
  if (bad.some((c) => c.metric.id === 'orders' || c.metric.id === 'conversion')) push('Reply to every open enquiry from the last 7 days today');
  if (bad.some((c) => c.metric.id === 'enquiries' || c.metric.id === 'visitors')) {
    if (ctx.topFix?.who === 'You') push(`${ctx.topFix.title} on your website; Google’s test says it is the biggest thing slowing you down on phones`);
    push('Repeat the post or campaign that brought your best week of enquiries');
  }
  if (dip && wholesale) push('Send the win-back note to past customers (the email, text and post are written for you in The Brief)');
  if (good.length) push(`Write down what drove the rise in ${lower(good[0].metric.label)} so you can repeat it`);
  if (!wholesale && ctx.leadsToContact?.length) push(`Send your introduction to ${ctx.leadsToContact[0]} (drafted in The Scout)`);
  if (ctx.topFix) push(`${ctx.topFix.title} (${ctx.topFix.who === 'You' ? 'you can do this yourself' : 'ask your web person'})`);
  push('Block one hour this week for the task you’ve been putting off');
  return { headline, paragraphs, actions: actions.slice(0, 3) };
}
