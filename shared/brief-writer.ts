import type { BusinessProfile } from '../src/lib/types';
import { isGood, type MetricChange } from './metrics';

function fmt(c: MetricChange, v: number | null): string {
  if (v == null) return '–';
  if (c.metric.unit === 'money') return '£' + Math.round(v).toLocaleString('en-GB');
  if (c.metric.unit === 'percent') return `${v}%`;
  return Math.round(v).toLocaleString('en-GB');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A careful, rule-based brief. Used directly in the demo and as the fallback when AI is unavailable. */
export function writeBrief(changes: MetricChange[], profile: BusinessProfile): { headline: string; paragraphs: string[]; actions: string[] } {
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
    const avg = c.average4 != null && c.vsAveragePct != null
      ? `, ${Math.abs(c.vsAveragePct)}% ${c.vsAveragePct >= 0 ? 'above' : 'below'} your four-week average`
      : '';
    return `${c.metric.label} ${verb} from ${fmt(c, c.previous)} to ${fmt(c, c.current)}${avg}.`;
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

  const goal = profile.goals.target ? `your goal of ${lower(profile.goals.target)}` : 'your 90-day goal';
  paragraphs.push(bad.length
    ? `Measured against ${goal}, the priority this week is to stop the drop in ${lower(bad[0].metric.label)} before adding anything new.`
    : `Measured against ${goal}, you’re moving the right way. Protect the time that produced this week’s result.`);

  const actions: string[] = [];
  if (bad.some((c) => c.metric.id === 'orders' || c.metric.id === 'conversion')) actions.push('Reply to every open enquiry from the last 7 days today');
  if (bad.some((c) => c.metric.id === 'enquiries' || c.metric.id === 'visitors')) actions.push('Repeat the post or campaign that brought your best week of enquiries');
  if (bad.some((c) => c.metric.id === 'revenue')) actions.push('Contact your 10 best past customers with something new');
  if (good.length) actions.push(`Write down what drove the rise in ${lower(good[0].metric.label)} so you can repeat it`);
  if (actions.length < 3) actions.push('Block one hour this week for the task you’ve been putting off');
  return { headline, paragraphs, actions: actions.slice(0, 3) };
}
