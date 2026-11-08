import { useMemo, useState } from 'react';
import { useApp } from '../app';
import { api } from '../lib/api';
import { Button, ErrorNote, Loading } from '../components/ui';
import { money } from '../lib/format';
import { CHANNEL_LABEL, replyTime, report, words } from '../../shared/capture';
import type { Channel } from '../lib/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ReportPage() {
  const { enquiries, enquiriesError, reloadEnquiries, settings } = useApp();
  const W = words(settings.business.kind);
  // Early in the month, open on last month: that's the one worth reading.
  const [back, setBack] = useState(() => (new Date().getDate() <= 10 ? 1 : 0));   // 0 = this month, 1 = last month…
  const range = useMemo(() => {
    const n = new Date();
    const from = new Date(n.getFullYear(), n.getMonth() - back, 1);
    const to = new Date(n.getFullYear(), n.getMonth() - back + 1, 1);
    return { from, to, name: from.toLocaleDateString('en-GB', { month: 'long', year: from.getFullYear() === n.getFullYear() ? undefined : 'numeric' }) };
  }, [back]);
  const r = useMemo(() => (enquiries ? report(enquiries, range.from, range.to) : null), [enquiries, range]);
  const outOfHoursWins = useMemo(() => (enquiries ?? []).filter((e) => !e.isTest && e.afterHours && e.status === 'won' && new Date(e.receivedAt) >= range.from && new Date(e.receivedAt) < range.to), [enquiries, range]);

  if (enquiriesError && !enquiries) return <div className="page"><ErrorNote message={enquiriesError} retry={reloadEnquiries} /></div>;
  if (!r) return <Loading />;

  const ohValue = outOfHoursWins.reduce((a, e) => a + (e.jobValue ?? 0), 0);
  const maxWeek = Math.max(1, ...r.byWeek.map((w) => w.inHours + w.afterHours));
  const funnel = [
    { label: 'Enquiries caught', n: r.caught },
    { label: 'Replied to', n: r.replied },
    { label: 'Quoted or booked', n: (enquiries ?? []).filter((e) => !e.isTest && e.status !== 'spam' && new Date(e.receivedAt) >= range.from && new Date(e.receivedAt) < range.to && (e.quotedAt || e.bookedFor || e.status === 'won')).length },
    { label: settings.business.kind === 'appointments' ? 'Attended' : 'Jobs won', n: r.won },
  ];
  const channels = (Object.keys(r.byChannel) as Channel[]).filter((c) => r.byChannel[c] > 0);

  return (
    <div className="page report-page">
      <div className="page-head">
        <div>
          <span className="label print-only">{settings.business.name} · Gainora Capture &amp; Convert</span>
          <h1 className="title">{range.name}</h1>
          <p className="lede">What your receptionist and inbox caught, and what it turned into. We go through this together on your monthly call.</p>
        </div>
        <div className="row gap-8 wrap no-print">
          <div className="seg" role="group" aria-label="Month">
            {[0, 1, 2].map((b) => <button key={b} className="seg-btn" aria-pressed={back === b} onClick={() => setBack(b)}>{b === 0 ? 'This month' : new Date(new Date().getFullYear(), new Date().getMonth() - b, 1).toLocaleDateString('en-GB', { month: 'short' })}</button>)}
          </div>
          {api.mode === 'live' && <Button kind="secondary" icon="printer" onClick={() => window.print()}>Print or save PDF</Button>}
        </div>
      </div>

      <section className="panel letter report-letter">
        <p className="voice">{r.caught === 0
          ? `No enquiries ${back === 0 ? 'yet this month' : `in ${range.name}`}. Once your line is live, every call, form and email is counted here.`
          : `${back === 0 ? 'So far this month' : `In ${range.name}`} your receptionist and inbox caught ${plural(r.caught, 'enquiry', 'enquiries')}${r.afterHours ? `, ${r.afterHours} of them while you were closed` : ''}. ${r.won ? `${settings.business.kind === 'appointments' ? `${plural(r.won, 'appointment was', 'appointments were')} attended` : `You won ${plural(r.won, 'job', 'jobs')}`}${r.wonValue ? ` worth ${money(r.wonValue)}` : ''}${outOfHoursWins.length ? `, including ${plural(outOfHoursWins.length, W.job, W.jobs)}${ohValue ? ` (${money(ohValue)})` : ''} that came in out of hours` : ''}.` : `No ${W.jobs} marked as ${settings.business.kind === 'appointments' ? 'attended' : 'won'} yet.`}`}</p>
      </section>

      <section className="panel section" aria-label="Enquiries">
        <div className="stats">
          <div className="stat"><span className="stat-label">Enquiries caught</span><span className="stat-value">{r.caught}</span><span className="stat-note">{r.spam ? `${plural(r.spam, 'spam call', 'spam calls')} filtered out` : 'Spam is left out'}</span></div>
          <div className="stat"><span className="stat-label">Out of hours</span><span className="stat-value">{r.afterHours}</span><span className="stat-note">{r.caught ? `${Math.round((r.afterHours / r.caught) * 100)}% of all enquiries` : '–'}</span></div>
          <div className="stat"><span className="stat-label">Emergencies flagged</span><span className="stat-value">{r.emergencies}</span><span className="stat-note">Sent to you straight away</span></div>
          <div className="stat"><span className="stat-label">Typical reply time</span><span className="stat-value">{replyTime(r.medianReplyMins)}</span><span className="stat-note">{r.replied ? `${Math.round((r.within1h / r.replied) * 100)}% within an hour` : 'Not enough replies yet'}</span></div>
        </div>
        <div className="stats" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="stat"><span className="stat-label">Quotes sent</span><span className="stat-value">{r.quotes}</span><span className="stat-note">{r.quotedValue ? `Worth ${money(r.quotedValue)}` : '–'}</span></div>
          <div className="stat"><span className="stat-label">{settings.business.kind === 'appointments' ? 'Appointments attended' : 'Jobs won'}</span><span className="stat-value">{money(r.wonValue)}</span><span className="stat-note">{plural(r.won, W.job, W.jobs)}{r.caught ? `, ${Math.round((r.won / r.caught) * 100)}% of enquiries` : ''}</span></div>
          <div className="stat"><span className="stat-label">Paid</span><span className="stat-value">{money(r.paidValue)}</span><span className="stat-note">From jobs won this month</span></div>
          <div className="stat"><span className="stat-label">Still owed</span><span className="stat-value" style={{ color: r.outstanding ? 'var(--brass)' : undefined }}>{money(r.outstanding)}</span><span className="stat-note">Reminders drafted in Follow-ups</span></div>
        </div>
      </section>

      <div className="grid-2 section">
        <section className="panel panel-pad" aria-labelledby="weeks-h">
          <div className="split"><h2 className="subhead" id="weeks-h">Enquiries by week</h2>
            <span className="legend xsmall"><span><i className="sw in" />In hours</span><span><i className="sw out" />Out of hours</span></span></div>
          <div className="bars" role="img" aria-label={`Enquiries by week: ${r.byWeek.map((w) => `week of ${new Date(w.weekOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${w.inHours} in hours and ${w.afterHours} out of hours`).join('; ')}`}>
            {r.byWeek.map((w) => (
              <div className="bar-col" key={w.weekOf}>
                <span className="bar-n tabular">{w.inHours + w.afterHours || ''}</span>
                <div className="bar-stack" style={{ height: `${((w.inHours + w.afterHours) / maxWeek) * 100}%` }}>
                  <span className="bar-out" style={{ flexGrow: w.afterHours }} />
                  <span className="bar-in" style={{ flexGrow: w.inHours }} />
                </div>
                <span className="bar-label">{new Date(w.weekOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel panel-pad" aria-labelledby="funnel-h">
          <h2 className="subhead" id="funnel-h">From enquiry to job</h2>
          <div className="funnel mt-16">
            {funnel.map((f) => (
              <div className="funnel-row" key={f.label}>
                <span className="small">{f.label}</span>
                <span className="funnel-track"><span style={{ width: `${funnel[0].n ? (f.n / funnel[0].n) * 100 : 0}%` }} /></span>
                <strong className="tabular">{f.n}</strong>
              </div>
            ))}
          </div>
          {channels.length > 0 && <>
            <h3 className="small mt-24" style={{ fontWeight: 600 }}>Where they came from</h3>
            <div className="chips mt-8">{channels.map((c) => <span className="tag tag-plain" key={c}>{CHANNEL_LABEL[c]}: {r.byChannel[c]}</span>)}</div>
          </>}
        </section>
      </div>

      <p className="xsmall faint section">Counts come from your inbox. Values and payments are the figures you entered. Test enquiries and spam are left out.</p>
    </div>
  );
}
