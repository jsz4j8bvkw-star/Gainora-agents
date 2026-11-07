import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { AGENTS, ErrorNote, Icon, Loading, Tabs, useLoad } from '../components/ui';
import { formatMinutes, groupDay, startOfMonth, summariseValue, valueSentence, VALUE_BASIS } from '../../shared/value';
import { money, shortDate } from '../lib/format';
import type { ValueEvent } from '../lib/types';

const WHO: Record<ValueEvent['agent'], string> = { watcher: 'The Watcher', scout: 'The Scout', brief: 'The Brief', you: 'You' };

export function Results() {
  const { profile } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.listValue());
  const [period, setPeriod] = useState<'month' | 'all'>('month');

  if (loading && !data) return <Loading />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'Your results could not load.'} retry={reload} /></div>;

  const since = period === 'month' ? startOfMonth() : undefined;
  const v = summariseValue(data, since);
  const c = v.counts;
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long' });

  // Group the timeline by day.
  const days = new Map<string, ValueEvent[]>();
  for (const e of v.events.slice(0, 200)) {
    const k = e.at.slice(0, 10);
    days.set(k, [...(days.get(k) ?? []), e]);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Your results</h1>
          <p className="lede">What your agents have found and done for {profile.business.name}. Everything here is counted from real work, and money is only shown where it comes from a real figure.</p>
        </div>
        <Tabs label="Period" value={period} onChange={setPeriod} tabs={[{ id: 'month', label: `This month` }, { id: 'all', label: 'All time' }]} />
      </div>

      <p className="results-sentence">{valueSentence(v, period === 'month' ? `in ${monthName}` : 'so far')}</p>

      <section className="results-grid" aria-label="Summary">
        <div className="result-tile result-feature">
          <span className="result-label"><Icon name="clock" />Time saved</span>
          <span className="result-figure">{formatMinutes(v.minutesSaved)}</span>
          <span className="result-note">An estimate. <details className="inline-details"><summary>How we work it out</summary><span>{VALUE_BASIS}</span></details></span>
        </div>
        <div className="result-tile">
          <span className="result-label"><Icon name="scout" />Potential customers</span>
          <span className="result-figure">{c.lead_found}</span>
          <span className="result-note">{c.lead_contacted} contacted, {c.lead_won} won{v.wonValue ? `, worth ${money(v.wonValue)}` : ''}</span>
        </div>
        <div className="result-tile">
          <span className="result-label"><Icon name="contract" />Public contracts</span>
          <span className="result-figure">{c.tender_found}</span>
          <span className="result-note">{v.tenderValue ? `${money(v.tenderValue)} in combined published value` : 'Matched to what you sell'}</span>
        </div>
        <div className="result-tile">
          <span className="result-label"><Icon name="watcher" />Website issues</span>
          <span className="result-figure">{c.issue_found}</span>
          <span className="result-note">{c.issue_fixed} marked as fixed</span>
        </div>
        <div className="result-tile">
          <span className="result-label"><Icon name="star" />Reviews</span>
          <span className="result-figure">{c.review_alert}</span>
          <span className="result-note">new, with {c.reply_drafted} {c.reply_drafted === 1 ? 'reply' : 'replies'} drafted</span>
        </div>
        <div className="result-tile">
          <span className="result-label"><Icon name="send" />Messages written for you</span>
          <span className="result-figure">{c.draft_written + c.reply_drafted}</span>
          <span className="result-note">Introductions, follow-ups and win-back messages</span>
        </div>
      </section>

      <section className="section" aria-labelledby="timeline-h">
        <div className="section-head"><h2 className="heading" id="timeline-h">What happened</h2><span className="small faint">{v.events.length} {v.events.length === 1 ? 'item' : 'items'}</span></div>
        {v.events.length === 0 ? (
          <div className="panel empty"><p className="muted">Nothing yet {period === 'month' ? 'this month' : ''}. As your agents work, every finding and draft is recorded here.</p></div>
        ) : (
          <div className="panel rows">
            {[...days.entries()].map(([day, list]) => (
              <div className="timeline-day" key={day}>
                <div className="timeline-date"><time dateTime={day}>{shortDate(day)}</time></div>
                <ul className="timeline-list">
                  {groupDay(list).map((e) => (
                    <li key={e.id}>
                      <span className="timeline-who">{WHO[e.agent]}</span>
                      <span>{e.title}{e.amount ? <span className="faint"> ({money(e.amount)})</span> : null}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="xsmall faint mt-16">Contract values are the values the buyer published, not money earned. Won deal values are the amounts you entered. {AGENTS.watcher.name}, {AGENTS.scout.name} and {AGENTS.brief.name} add to this page automatically.</p>
    </div>
  );
}
