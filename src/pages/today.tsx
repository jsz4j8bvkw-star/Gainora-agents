import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate, setIntent } from '../lib/router';
import { Button, ErrorNote, Icon, Loading, useLoad, useToast } from '../components/ui';
import { EnquiryRow, who } from '../components/enquiry';
import { useOpenSpaces } from '../components/space';
import { greeting, money, time12 } from '../lib/format';
import { followUps, isBeauty, report, words } from '../../shared/capture';
import { priority, rebookDue, type Priority } from '../../shared/insight';
import type { EnquiryRecord } from '../lib/types';

export function Today() {
  const { settings, enquiries, enquiriesError, reloadEnquiries, putEnquiry, messages } = useApp();
  const sources = useLoad(() => api.listSources());
  const spaces = useOpenSpaces();
  const [testing, setTesting] = useState(false);
  const toast = useToast();
  const appts = settings.business.kind === 'appointments';
  const beauty = isBeauty(settings.business);
  const W = words(settings.business.kind);

  const data = useMemo(() => {
    if (!enquiries) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const real = enquiries.filter((e) => !e.isTest);
    const unread = new Map<string, { body: string; at: string }>();
    for (const m of [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (m.direction === 'in' && !m.read && m.enquiryId) unread.set(m.enquiryId, { body: m.body, at: m.createdAt });
    const waitingOk = messages.filter((m) => m.status === 'awaiting_approval');
    const okFor = (id: string) => waitingOk.filter((m) => m.enquiryId === id).length;
    const ranked: { e: EnquiryRecord; p: Priority }[] = real
      .filter((e) => e.status !== 'spam' && e.status !== 'lost')
      .map((e) => ({ e, p: priority(e, settings, { now, unreadReply: unread.get(e.id) ?? null, awaitingOk: okFor(e.id) }) }))
      .filter((x) => x.p.score >= 200 || (x.p.score > 0 && x.p.step.action !== 'none' && x.p.step.action !== 'open'))
      .sort((a, b) => b.p.score - a.p.score);
    return {
      ranked, unread, waitingOk,
      week: report(real, weekAgo, new Date(now.getTime() + 60_000), settings, now),
      month: report(real, monthStart, new Date(now.getTime() + 60_000), settings, now),
      due: followUps(real, now).filter((f) => f.due),
      back: rebookDue(real, settings, now),
      latest: enquiries.filter((e) => e.status !== 'spam').slice(0, 5),
      upcoming: real.filter((e) => e.status === 'booked' && e.bookedFor && new Date(e.bookedFor) >= new Date(now.toDateString())).sort((a, b) => a.bookedFor!.localeCompare(b.bookedFor!)).slice(0, 5),
    };
  }, [enquiries, messages, settings]);

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
  const now = data.ranked.slice(0, 6);
  const nNow = data.ranked.length + (data.waitingOk.length ? 1 : 0);
  const emergencies = data.ranked.filter((x) => x.e.urgency === 'emergency' && x.e.status === 'new').length;
  const lede = emergencies
    ? `${emergencies === 1 ? 'One emergency needs' : `${emergencies} emergencies need`} you now.`
    : nNow ? `${nNow === 1 ? 'One thing needs' : `${nNow} things need`} you. ${data.week.afterHours ? `Your receptionist caught ${data.week.afterHours} ${data.week.afterHours === 1 ? 'enquiry' : 'enquiries'} while you were closed this week.` : ''}`.trim()
    : `Everything’s answered. ${data.week.afterHours ? `Your receptionist caught ${data.week.afterHours} ${data.week.afterHours === 1 ? 'enquiry' : 'enquiries'} while you were closed this week.` : 'Nice work.'}`;
  const reply = (e: EnquiryRecord) => { setIntent('reply'); navigate(`/enquiries/${e.id}`); };
  const caughtNote = data.week.afterHoursValue > 0
    ? `${data.week.bookedValueFrom ? 'At least ' : ''}${money(data.week.afterHoursValue)} booked, by your own figures`
    : data.week.afterHoursBooked ? `${data.week.afterHoursBooked} booked` : 'Calls you’d have missed';

  return (
    <div className="page">
      <div className="page-head today-head">
        <div>
          <h1 className="display">{greeting()}, {settings.business.ownerName}.</h1>
          <p className="lede">{lede}</p>
        </div>
        <Link to="/enquiries/new" className="btn btn-secondary btn-small"><Icon name="plus" />Log a call</Link>
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

      {(now.length > 0 || data.waitingOk.length > 0) && (
        <section className="section-tight" aria-labelledby="now-h">
          <div className="section-head"><h2 className="heading" id="now-h">Needs you now</h2>{data.ranked.length > 6 && <Link to="/enquiries" className="btn btn-quiet btn-small">All {data.ranked.length}<Icon name="chevron" /></Link>}</div>
          <div className={`panel rows needs-panel ${emergencies ? 'hot' : ''}`}>
            {now.map(({ e, p }) => {
              const act = p.step.action;
              return (
                <div className={`needs-row urg-${e.urgency}`} key={e.id}>
                  <span className={`needs-mark ${e.urgency === 'emergency' ? 'emergency' : e.urgency === 'urgent' ? 'urgent' : data.unread.has(e.id) ? 'reply' : 'plain'}`} aria-hidden="true"><Icon name={e.urgency !== 'normal' ? 'alert' : data.unread.has(e.id) ? 'message' : e.channel === 'call' ? 'phone' : e.channel === 'form' ? 'form' : 'mail'} /></span>
                  <div className="stack gap-4" style={{ minWidth: 0 }}>
                    <div className="row gap-8 wrap"><Link to={`/enquiries/${e.id}`} className="needs-name">{who(e)}</Link><span className="small faint">{p.why}</span></div>
                    <p className="needs-step">{p.step.title}</p>
                    <p className="small muted enq-summary">{data.unread.get(e.id) ? `“${data.unread.get(e.id)!.body}”` : e.summary}</p>
                  </div>
                  <div className="needs-actions">
                    {act === 'call' && e.phone && <a className="btn btn-primary btn-small" href={`tel:${e.phone}`}><Icon name="phone" />Call back</a>}
                    {(act === 'reply' || act === 'book') && (e.phone || e.email) && <Button small onClick={() => reply(e)} icon="send">{act === 'book' ? 'Reply and book' : 'Reply'}</Button>}
                    {act === 'attended' && <Button small kind="secondary" onClick={() => navigate(`/enquiries/${e.id}`)} icon="check">{appts ? 'Attended?' : 'Done?'}</Button>}
                    {act === 'pay' && <Button small kind="secondary" onClick={() => navigate(`/enquiries/${e.id}`)} icon="pound">Payment</Button>}
                    {act === 'review' && <Button small kind="secondary" onClick={() => navigate(`/enquiries/${e.id}`)} icon="star">Ask for a review</Button>}
                    {act !== 'call' && e.phone && <a className="btn btn-quiet btn-small" href={`tel:${e.phone}`}><Icon name="phone" /><span className="sr-only">Call {who(e)}</span></a>}
                    <Button kind="quiet" small onClick={() => navigate(`/enquiries/${e.id}`)}>Open</Button>
                  </div>
                </div>
              );
            })}
            {data.waitingOk.length > 0 && (
              <Link to="/automations" className="mini-row reply-row">
                <span className="enq-ico"><Icon name="bolt" /></span>
                <span className="stack"><span className="small"><strong>{data.waitingOk.length} {data.waitingOk.length === 1 ? 'message is' : 'messages are'} waiting for your OK</strong></span><span className="small muted">Read them, then send or skip. Nothing goes until you say.</span></span>
              </Link>
            )}
          </div>
        </section>
      )}

      {appts && spaces.length > 0 && (
        <section className={now.length || data.waitingOk.length ? 'section' : 'section-tight'} aria-labelledby="space-h">
          <div className="section-head"><h2 className="heading" id="space-h">{spaces.length === 1 ? 'A space came up' : `${spaces.length} spaces came up`}</h2></div>
          <div className="panel rows">
            {spaces.slice(0, 3).map(({ space, count }) => (
              <Link key={space.enquiry.id} to={`/enquiries/${space.enquiry.id}`} className="mini-row with-cta">
                <span className="date-chip"><strong>{new Date(space.at).toLocaleDateString('en-GB', { day: 'numeric' })}</strong>{new Date(space.at).toLocaleDateString('en-GB', { month: 'short' })}</span>
                <span className="stack" style={{ minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 600 }}>{time12(space.at)}{space.who ? ` with ${space.who}` : ''}{space.type ? ` · ${space.type}` : ''}{space.value ? ` · ${space.value.from ? 'from ' : ''}${money(space.value.amount)}` : ''}</span>
                  <span className="xsmall faint">{who(space.enquiry)} cancelled. {count ? `${count} ${count === 1 ? 'person' : 'people'} could take it, with a text ready for each.` : 'Nobody waiting yet: your receptionist can offer it.'}</span>
                </span>
                <span className="btn btn-secondary btn-small">Fill it</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={`panel ${now.length || data.waitingOk.length || (appts && spaces.length) ? 'section' : ''}`} aria-label="The last 7 days">
        <div className="stats">
          <div className="stat"><span className="stat-label">Enquiries, last 7 days</span><span className="stat-value">{data.week.caught}</span><span className="stat-note">{data.week.byChannel.call} by phone{data.week.spam ? `, ${data.week.spam} spam kept out` : ''}</span></div>
          <div className="stat"><span className="stat-label">Caught while you were closed</span><span className="stat-value">{data.week.afterHours}</span><span className="stat-note">{caughtNote}</span></div>
          <div className="stat"><span className="stat-label">Waiting for a reply</span><span className="stat-value" style={{ color: data.ranked.length ? 'var(--brass)' : undefined }}>{data.ranked.filter((x) => x.e.status === 'new' || data.unread.has(x.e.id)).length}</span><span className="stat-note">{data.week.medianReplyMins != null ? `Typical reply in ${data.week.medianReplyMins < 60 ? `${data.week.medianReplyMins} min` : `${Math.round(data.week.medianReplyMins / 60)} h`}` : appts ? 'A quick text holds the booking' : 'Reply fast to win the job'}</span></div>
          <div className="stat"><span className="stat-label">{appts ? 'Booked this month' : 'Won this month'}</span><span className="stat-value">{money(appts ? data.month.bookedValue : data.month.wonValue)}</span><span className="stat-note">{appts ? `${data.month.booked} ${data.month.booked === 1 ? 'appointment' : 'appointments'}${data.month.bookedValueFrom ? ', at least' : ''}, by your own figures` : `${data.month.won} ${data.month.won === 1 ? W.job : W.jobs}`}</span></div>
        </div>
      </section>

      <div className="grid-2 section">
        <section className="panel" aria-labelledby="booked-h">
          <div className="panel-head"><h2 className="subhead" id="booked-h">Coming up</h2><Icon name="calendar" className="faint-ico" /></div>
          <div className="rows">
            {data.upcoming.length === 0 && <p className="small muted" style={{ padding: '16px 22px' }}>{appts ? 'No appointments booked from enquiries yet. Mark an enquiry “Booked in” and it appears here, and the client gets a confirmation text.' : 'No visits booked from enquiries yet.'}</p>}
            {data.upcoming.map((e) => (
              <Link key={e.id} to={`/enquiries/${e.id}`} className="mini-row">
                <span className="date-chip"><strong>{new Date(e.bookedFor!).toLocaleDateString('en-GB', { day: 'numeric' })}</strong>{new Date(e.bookedFor!).toLocaleDateString('en-GB', { month: 'short' })}</span>
                <span className="stack" style={{ minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 600 }}>{who(e)}{data.unread.has(e.id) && <span className="tag tag-brass" style={{ marginLeft: 8 }}><Icon name="message" className="tag-ico" />Replied</span>}</span>
                  <span className="xsmall faint enq-summary">{time12(e.bookedFor!)}{e.bookedType ? ` · ${e.bookedType}` : ''}{e.bookedWith ? ` with ${e.bookedWith}` : ''}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {appts ? (
          <Link to="/follow-ups" className="goal due-card">
            <span className="label">Due back</span>
            <span className="goal-figure tabular">{data.back.length}<small>{data.back.length === 1 ? 'client to invite back' : 'clients to invite back'}</small></span>
            <span className="due-list">
              {data.back.slice(0, 3).map((b) => <span key={b.enquiry.id}>{who(b.enquiry)}: {b.type || 'next appointment'}, {b.overdueDays > 0 ? `due ${b.overdueDays === 1 ? 'yesterday' : `${b.overdueDays} days ago`}` : b.overdueDays === 0 ? 'due today' : `due in ${-b.overdueDays} days`}</span>)}
              {data.back.length === 0 && <span>{beauty ? 'Nobody’s due yet. Set how many weeks each treatment lasts in Settings → Bookings, and clients appear here when it’s time.' : 'Nobody’s due yet. Set how many weeks between appointments in Settings → Bookings, and clients appear here when it’s time.'}</span>}
              {data.due.length > 0 && <span>{data.due.length} other {data.due.length === 1 ? 'follow-up' : 'follow-ups'} due</span>}
            </span>
            <span className="due-cta">{data.back.length ? 'Texts drafted and ready' : 'See follow-ups'}<Icon name="chevron" /></span>
          </Link>
        ) : (
          <Link to="/follow-ups" className="goal due-card">
            <span className="label">Follow-ups due</span>
            <span className="goal-figure tabular">{data.due.length}<small>{data.due.length === 1 ? 'message to send' : 'messages to send'}</small></span>
            <span className="due-list">
              {data.due.slice(0, 3).map((f) => <span key={f.enquiry.id + f.kind}>{f.label}: {who(f.enquiry)}</span>)}
              {data.due.length === 0 && <span>Nothing due today. Quote chasers, payment reminders and review requests appear here on the right day.</span>}
            </span>
            {data.due.length > 0 && <span className="due-cta">Drafted and ready<Icon name="chevron" /></span>}
          </Link>
        )}
      </div>

      {now.length < 3 && (
        <section className="section" aria-labelledby="latest-h">
          <div className="section-head"><h2 className="heading" id="latest-h">Latest enquiries</h2><Link to="/enquiries" className="btn btn-quiet btn-small">See all<Icon name="chevron" /></Link></div>
          <div className="panel rows">
            {data.latest.length === 0 && <div className="empty"><p className="muted">No enquiries yet. They’ll appear here the moment your receptionist takes a call.</p></div>}
            {data.latest.map((e) => <EnquiryRow key={e.id} e={e} compact />)}
          </div>
        </section>
      )}
    </div>
  );
}
