import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate } from '../lib/router';
import { Button, ErrorNote, Icon, Loading, useLoad, useToast } from '../components/ui';
import { EnquiryRow, who } from '../components/enquiry';
import { greeting, money, relative } from '../lib/format';
import { followUps, report, words } from '../../shared/capture';

export function Today() {
  const { settings, enquiries, enquiriesError, reloadEnquiries, putEnquiry } = useApp();
  const sources = useLoad(() => api.listSources());
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  const data = useMemo(() => {
    if (!enquiries) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const real = enquiries.filter((e) => !e.isTest);
    return {
      now: real.filter((e) => e.status === 'new' && e.urgency !== 'normal'),
      waiting: real.filter((e) => e.status === 'new' && e.urgency === 'normal'),
      week: report(real, weekAgo, new Date(now.getTime() + 60_000)),
      month: report(real, monthStart, new Date(now.getTime() + 60_000)),
      due: followUps(real, now).filter((f) => f.due),
      latest: enquiries.filter((e) => e.status !== 'spam').slice(0, 6),
      upcoming: real.filter((e) => e.status === 'booked' && e.bookedFor && new Date(e.bookedFor) >= new Date(now.toDateString())).sort((a, b) => a.bookedFor!.localeCompare(b.bookedFor!)).slice(0, 4),
    };
  }, [enquiries]);

  if (enquiriesError && !enquiries) return <div className="page"><ErrorNote message={enquiriesError} retry={reloadEnquiries} /></div>;
  if (!data) return <Loading />;

  const connected = (sources.data ?? []).some((x) => x.active);
  const anyReal = (enquiries ?? []).some((e) => !e.isTest);
  const test = async () => {
    setTesting(true);
    try { const e = await api.sendTest(); putEnquiry(e); toast('Test enquiry received. Open it to see what a real one looks like.'); }
    catch (e: any) { toast(e?.message || 'The test didn’t go through. Try again.'); }
    finally { setTesting(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">{greeting()}, {settings.business.ownerName}.</h1>
          <p className="lede">{data.now.length
            ? `${data.now.length === 1 ? 'One enquiry needs' : `${data.now.length} enquiries need`} you now.`
            : data.waiting.length
              ? `${data.waiting.length} ${data.waiting.length === 1 ? 'enquiry is' : 'enquiries are'} waiting for a reply.`
              : 'Every enquiry has been answered. Nice work.'}</p>
        </div>
        <Link to="/enquiries/new" className="btn btn-secondary"><Icon name="plus" />Log a call</Link>
      </div>

      {!anyReal && (
        <section className="panel start" aria-labelledby="start-h">
          <div className="panel-head"><div><h2 className="heading" id="start-h">Getting your line live</h2><p className="small faint">Four steps. We do the fiddly ones with you on your setup call.</p></div></div>
          <ol className="start-steps">
            <li className="done"><span className="num"><Icon name="check" /></span><span><strong>Answer the setup questions</strong><span className="small muted">Your receptionist script is written.</span></span></li>
            <li className={connected ? 'done' : ''}><span className="num">{connected ? <Icon name="check" /> : 2}</span><span><strong>Connect your receptionist</strong><span className="small muted">Make a secret link and paste it into your receptionist platform.</span></span><Link to="/receptionist" className="btn btn-secondary btn-small">Connect</Link></li>
            <li><span className="num">3</span><span><strong>Forward your calls</strong><span className="small muted">When you don’t answer, or you’re closed, calls go to your receptionist.</span></span><Link to="/receptionist" className="btn btn-quiet btn-small">How</Link></li>
            <li><span className="num">4</span><span><strong>Send a test enquiry</strong><span className="small muted">Check it lands here and the alert reaches you.</span></span><Button kind="secondary" small busy={testing} onClick={test}>Send a test</Button></li>
          </ol>
        </section>
      )}

      {data.now.length > 0 && (
        <section className="needs section-tight" aria-labelledby="now-h">
          <div className="section-head"><h2 className="heading" id="now-h">Needs you now</h2></div>
          <div className="panel rows needs-panel">
            {data.now.map((e) => (
              <div className="needs-row" key={e.id}>
                <span className={`needs-mark ${e.urgency}`} aria-hidden="true"><Icon name="alert" /></span>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <div className="row gap-8 wrap"><strong>{who(e)}</strong>{e.postcode && <span className="small faint">{e.postcode}</span>}<span className="small faint">{relative(e.receivedAt)}</span></div>
                  <p className="small">{e.summary}</p>
                  {e.reasons[0] && <p className="xsmall faint">{e.reasons.join('. ')}</p>}
                </div>
                <div className="needs-actions">
                  {e.phone && <a className="btn btn-primary btn-small" href={`tel:${e.phone}`}><Icon name="phone" />Call back</a>}
                  <Button kind="secondary" small onClick={() => navigate(`/enquiries/${e.id}`)}>Open</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={`panel ${data.now.length ? 'section' : ''}`} aria-label="The last 7 days">
        <div className="stats">
          <div className="stat"><span className="stat-label">Enquiries, last 7 days</span><span className="stat-value">{data.week.caught}</span><span className="stat-note">{data.week.byChannel.call} by phone</span></div>
          <div className="stat"><span className="stat-label">Caught out of hours</span><span className="stat-value">{data.week.afterHours}</span><span className="stat-note">Calls you’d have missed</span></div>
          <div className="stat"><span className="stat-label">Waiting for a reply</span><span className="stat-value" style={{ color: data.waiting.length + data.now.length ? 'var(--brass)' : undefined }}>{data.waiting.length + data.now.length}</span><span className="stat-note">{data.week.medianReplyMins != null ? `Typical reply in ${data.week.medianReplyMins < 60 ? `${data.week.medianReplyMins} min` : `${Math.round(data.week.medianReplyMins / 60)} h`}` : 'Reply fast to win the job'}</span></div>
          <div className="stat"><span className="stat-label">{settings.business.kind === 'appointments' ? 'Attended this month' : 'Won this month'}</span><span className="stat-value">{money(data.month.wonValue)}</span><span className="stat-note">{data.month.won} {data.month.won === 1 ? words(settings.business.kind).job : words(settings.business.kind).jobs}</span></div>
        </div>
      </section>

      <div className="grid-2 section">
        <section aria-labelledby="latest-h">
          <div className="section-head"><h2 className="heading" id="latest-h">Latest enquiries</h2><Link to="/enquiries" className="btn btn-quiet btn-small">See all<Icon name="chevron" /></Link></div>
          <div className="panel rows">
            {data.latest.length === 0 && <div className="empty"><p className="muted">No enquiries yet. They’ll appear here the moment your receptionist takes a call.</p></div>}
            {data.latest.map((e) => <EnquiryRow key={e.id} e={e} compact />)}
          </div>
        </section>

        <div className="stack gap-16">
          <Link to="/follow-ups" className="goal due-card">
            <span className="label">Follow-ups due</span>
            <span className="goal-figure tabular">{data.due.length}<small>{data.due.length === 1 ? 'message to send' : 'messages to send'}</small></span>
            <span className="due-list">
              {data.due.slice(0, 3).map((f) => <span key={f.enquiry.id + f.kind}>{f.label}: {who(f.enquiry)}</span>)}
              {data.due.length === 0 && <span>Nothing due today. Quote chasers, payment reminders and review requests appear here on the right day.</span>}
            </span>
            {data.due.length > 0 && <span className="due-cta">Drafted and ready<Icon name="chevron" /></span>}
          </Link>

          <section className="panel" aria-labelledby="booked-h">
            <div className="panel-head"><h2 className="subhead" id="booked-h">Coming up</h2><Icon name="calendar" className="faint-ico" /></div>
            <div className="rows">
              {data.upcoming.length === 0 && <p className="small muted panel-pad" style={{ padding: '16px 22px' }}>No visits booked from enquiries yet.</p>}
              {data.upcoming.map((e) => (
                <Link key={e.id} to={`/enquiries/${e.id}`} className="mini-row">
                  <span className="date-chip"><strong>{new Date(e.bookedFor!).toLocaleDateString('en-GB', { day: 'numeric' })}</strong>{new Date(e.bookedFor!).toLocaleDateString('en-GB', { month: 'short' })}</span>
                  <span className="stack" style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 600 }}>{who(e)}</span><span className="xsmall faint enq-summary">{e.summary}</span></span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
