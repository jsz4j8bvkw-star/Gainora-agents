import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate } from '../lib/router';
import { Button, ErrorNote, Icon, Loading, useToast } from '../components/ui';
import { Compose } from '../components/compose';
import { who } from '../components/enquiry';
import { money, relative, shortDate } from '../lib/format';
import { followUps, isBeauty, paymentReminder, quoteChaser, reviewRequest, words, type FollowItem } from '../../shared/capture';
import { rebookDue, rebookText, topicOf, type RebookItem } from '../../shared/insight';
import type { EnquiryPatch, EnquiryRecord } from '../lib/types';

const GROUPS: { kind: FollowItem['kind']; title: string; hint: string; icon: string }[] = [
  { kind: 'quote', title: 'Chase quotes', hint: 'A friendly nudge on day 3 and a last one on day 8.', icon: 'pound' },
  { kind: 'payment', title: 'Get paid', hint: 'Polite reminders on the due date, then after 7 and 14 days.', icon: 'check' },
  { kind: 'review', title: 'Ask for reviews', hint: 'The day after a job is done and paid.', icon: 'star' },
];

const whenLabel = (f: FollowItem) => {
  if (f.due) { const late = Math.floor((Date.now() - new Date(f.dueAt).getTime()) / 86_400_000); return late >= 1 ? `Due ${late === 1 ? 'yesterday' : `${late} days ago`}` : 'Due today'; }
  return `Due ${relative(f.dueAt)}`;
};

export function FollowUps() {
  const { enquiries, enquiriesError, reloadEnquiries, settings, putEnquiry, messages } = useApp();
  const [draft, setDraft] = useState<FollowItem | null>(null);
  const [back, setBack] = useState<RebookItem | null>(null);
  const [quiet, setQuiet] = useState<EnquiryRecord | null>(null);
  const toast = useToast();
  const appts = settings.business.kind === 'appointments';
  const beauty = isBeauty(settings.business);
  const items = useMemo(() => followUps(enquiries ?? []), [enquiries]);
  const dueBack = useMemo(() => rebookDue((enquiries ?? []), settings), [enquiries, settings]);
  // Went quiet: they asked (often about a price) and were replied to, but nothing was booked and nothing has happened for a few days.
  const wentQuiet = useMemo(() => {
    const now = Date.now();
    return (enquiries ?? []).filter((e) => !e.isTest && appts && (e.status === 'replied' || (e.status === 'new' && e.kind === 'quote')) && e.urgency !== 'emergency' && e.kind !== 'complaint' && now - new Date(e.repliedAt ?? e.receivedAt).getTime() > 3 * 86_400_000 && now - new Date(e.receivedAt).getTime() < 42 * 86_400_000)
      .filter((e) => !messages.some((m) => m.enquiryId === e.id && m.direction === 'in' && now - new Date(m.createdAt).getTime() < 3 * 86_400_000))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }, [enquiries, messages, appts]);
  const rebookSent = (b: RebookItem) => messages.find((m) => m.enquiryId === b.enquiry.id && m.direction === 'out' && m.workflow === 'rebook' && m.status === 'sent');
  const wfFor = (f: FollowItem) => (f.kind === 'quote' ? 'quote' : f.kind === 'payment' ? 'payment' : 'review') as 'quote' | 'payment' | 'review';
  const stepFor = (f: FollowItem) => (f.kind === 'quote' ? `chase${f.stage}` : f.kind === 'payment' ? `pay${f.stage}` : 'review') as 'chase1';
  const isAuto = (f: FollowItem) => { const w = settings.automations[wfFor(f)]; return !!w?.on && !!w.steps[stepFor(f)]?.on && new Date(w.since) <= new Date(f.enquiry.receivedAt); };
  const paused = (f: FollowItem) => messages.some((m) => m.enquiryId === f.enquiry.id && m.direction === 'in');

  if (enquiriesError && !enquiries) return <div className="page"><ErrorNote message={enquiriesError} retry={reloadEnquiries} /></div>;
  if (!enquiries) return <Loading />;

  const due = items.filter((f) => f.due);
  const later = items.filter((f) => !f.due);
  const backValue = dueBack.reduce((a, b) => a + (b.value?.amount ?? 0), 0);
  const backFrom = dueBack.some((b) => b.value?.from);
  const quietText = (e: EnquiryRecord) => {
    const topic = topicOf(e, settings);
    const first = e.name.split(' ')[0] || 'there';
    return `Hi ${first}, it's ${settings.business.ownerName} from ${settings.business.name}. You asked about ${topic || 'a treatment'} a few days ago and I didn't want you to feel forgotten. ${beauty ? 'If it would help to talk it through first, a free chat is always welcome.' : 'Happy to answer anything.'} Would you like me to find you a time? ${settings.business.ownerName}`;
  };
  const quoteValue = items.filter((f) => f.kind === 'quote').reduce((a, f) => a + (f.enquiry.quoteAmount ?? 0), 0);
  const owed = items.filter((f) => f.kind === 'payment').reduce((a, f) => a + (f.enquiry.jobValue ?? 0), 0);

  const update = async (id: string, patch: EnquiryPatch, msg: string) => {
    try { putEnquiry(await api.updateEnquiry(id, patch)); toast(msg); }
    catch (e: any) { toast(e?.message || 'That didn’t save. Try again.'); throw e; }
  };
  const ctx = (f: FollowItem) => ({
    business: settings.business.name, owner: settings.business.ownerName, customer: f.enquiry.name.split(' ')[0] || undefined,
    amount: f.kind === 'quote' ? (f.enquiry.quoteAmount ? money(f.enquiry.quoteAmount) : undefined) : (f.enquiry.jobValue ? money(f.enquiry.jobValue) : undefined),
    dueDate: f.enquiry.invoiceDue ? shortDate(f.enquiry.invoiceDue) : undefined,
    payLink: settings.followUps.payLink || undefined, reviewLink: settings.followUps.reviewLink || undefined,
  });
  const textFor = (f: FollowItem) => f.kind === 'quote' ? quoteChaser(ctx(f), f.stage === 1 ? 1 : 2) : f.kind === 'payment' ? paymentReminder(ctx(f), f.stage as 1 | 2 | 3) : reviewRequest(ctx(f));
  const sentPatch = (f: FollowItem): EnquiryPatch => f.kind === 'quote' ? { chaserSent: true } : f.kind === 'payment' ? { paymentReminderSent: true } : { reviewAsked: true };
  const detail = (f: FollowItem) => {
    const e = f.enquiry;
    if (f.kind === 'quote') return `Quoted ${e.quoteAmount ? money(e.quoteAmount) : ''} ${e.quotedAt ? relative(e.quotedAt) : ''}${e.chasersSent ? `, ${e.chasersSent} chaser sent` : ''}`.replace(/\s+/g, ' ').trim();
    if (f.kind === 'payment') return `${e.jobValue ? money(e.jobValue) : 'Balance'} due ${e.invoiceDue ? shortDate(e.invoiceDue) : ''}${e.paymentRemindersSent ? `, ${e.paymentRemindersSent} ${e.paymentRemindersSent === 1 ? 'reminder' : 'reminders'} sent` : ''}`;
    return `${words(settings.business.kind).won}${e.jobValue ? `, ${money(e.jobValue)}` : ''}${e.paidAt ? `, paid ${relative(e.paidAt)}` : ''}`;
  };

  const Row = ({ f }: { f: FollowItem }) => (
    <article className={`follow-row ${f.due ? '' : 'later'}`}>
      <div className="stack gap-4" style={{ minWidth: 0 }}>
        <div className="row gap-8 wrap"><Link to={`/enquiries/${f.enquiry.id}`} className="lead-name">{who(f.enquiry)}</Link>{isAuto(f) && !paused(f) && <span className="tag tag-forest"><Icon name="bolt" className="tag-ico" />Automatic</span>}{paused(f) && <span className="tag tag-plain">Paused: they replied</span>}<span className={`tag ${f.due ? (f.kind === 'payment' && f.stage > 1 ? 'tag-danger' : 'tag-brass') : 'tag-plain'}`}>{whenLabel(f)}</span></div>
        <span className="small">{f.label}</span>
        <span className="small muted">{detail(f)}</span>
      </div>
      <div className="lead-actions">
        {f.due && <Button small icon="send" onClick={() => setDraft(f)}>Draft message</Button>}
        {!f.due && <Button kind="secondary" small icon="send" onClick={() => setDraft(f)}>{isAuto(f) ? 'Send it myself' : 'Draft early'}</Button>}
        {f.kind === 'quote' && <Button kind="secondary" small onClick={() => navigate(`/enquiries/${f.enquiry.id}`)}>They said yes</Button>}
        {f.kind === 'payment' && <Button kind="secondary" small onClick={() => update(f.enquiry.id, { paid: true }, 'Marked as paid.').catch(() => {})}>Paid</Button>}
      </div>
    </article>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Follow-ups</h1>
          <p className="lede">{appts ? 'Clients due their next treatment, and enquiries that went quiet. Each message is written for you: read it, change a word, send it.' : 'The messages that win the job and get you paid. Each one is written for you. You read it, then send it from your own phone or email.'}</p>
        </div>
      </div>

      <section className="panel" aria-label="Follow-ups at a glance">
        <div className="stats stats-3">
          {appts ? <>
            <div className="stat"><span className="stat-label">Due back</span><span className="stat-value" style={{ color: dueBack.length ? 'var(--brass)' : undefined }}>{dueBack.length}</span><span className="stat-note">{dueBack.length ? `Worth ${backFrom ? 'at least ' : ''}${money(backValue)} by your prices` : 'Nobody due yet'}</span></div>
            <div className="stat"><span className="stat-label">Went quiet</span><span className="stat-value">{wentQuiet.length}</span><span className="stat-note">Asked, then nothing booked</span></div>
            <div className="stat"><span className="stat-label">Other follow-ups due</span><span className="stat-value">{due.length}</span><span className="stat-note">{owed ? `${money(owed)} waiting to be paid` : due.length ? 'Drafted and ready' : 'You’re up to date'}</span></div>
          </> : <>
            <div className="stat"><span className="stat-label">Due now</span><span className="stat-value" style={{ color: due.length ? 'var(--brass)' : undefined }}>{due.length}</span><span className="stat-note">{due.length ? 'Messages drafted and ready' : 'You’re up to date'}</span></div>
            <div className="stat"><span className="stat-label">Quotes waiting on an answer</span><span className="stat-value">{money(quoteValue)}</span><span className="stat-note">{items.filter((f) => f.kind === 'quote').length} quotes</span></div>
            <div className="stat"><span className="stat-label">Waiting to be paid</span><span className="stat-value">{money(owed)}</span><span className="stat-note">{items.filter((f) => f.kind === 'payment').length} jobs</span></div>
          </>}
        </div>
      </section>

      {appts && dueBack.length > 0 && (
        <section className="section" aria-labelledby="back-h">
          <div className="section-head"><h2 className="heading" id="back-h">Due back <span className="count">{dueBack.length}</span></h2><span className="small faint">By the interval you set for each treatment. Nobody who has been back in touch since.</span></div>
          <div className="panel rows">
            {dueBack.map((b) => {
              const sent = rebookSent(b);
              return (
                <article className="follow-row" key={b.enquiry.id}>
                  <div className="stack gap-4" style={{ minWidth: 0 }}>
                    <div className="row gap-8 wrap"><Link to={`/enquiries/${b.enquiry.id}`} className="lead-name">{who(b.enquiry)}</Link><span className={`tag ${b.overdueDays > 0 ? 'tag-brass' : 'tag-plain'}`}>{b.overdueDays > 0 ? `Due ${b.overdueDays === 1 ? 'yesterday' : `${b.overdueDays} days ago`}` : b.overdueDays === 0 ? 'Due today' : `Due in ${-b.overdueDays} days`}</span>{sent && <span className="tag tag-forest"><Icon name="bolt" className="tag-ico" />Invited {relative(sent.createdAt)}</span>}</div>
                    <span className="small">{b.type}{b.enquiry.bookedWith ? ` with ${b.enquiry.bookedWith}` : ''}, usually every {b.weeks} weeks</span>
                    <span className="small muted">Last visit {shortDate(b.enquiry.bookedFor ?? b.enquiry.receivedAt)}{b.value ? ` · ${b.value.from ? 'from ' : ''}${money(b.value.amount)}` : ''}</span>
                  </div>
                  <div className="lead-actions">
                    <Button small icon="send" kind={sent ? 'secondary' : 'primary'} onClick={() => setBack(b)}>{sent ? 'Text again' : 'Invite them back'}</Button>
                    {b.enquiry.phone && <a className="btn btn-secondary btn-small" href={`tel:${b.enquiry.phone}`}><Icon name="phone" />Call</a>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {appts && wentQuiet.length > 0 && (
        <section className="section" aria-labelledby="quiet-h">
          <div className="section-head"><h2 className="heading" id="quiet-h">Went quiet <span className="count">{wentQuiet.length}</span></h2><span className="small faint">They asked and heard back, but nothing was booked. One gentle nudge, then leave it.</span></div>
          <div className="panel rows">
            {wentQuiet.map((e) => (
              <article className="follow-row" key={e.id}>
                <div className="stack gap-4" style={{ minWidth: 0 }}>
                  <div className="row gap-8 wrap"><Link to={`/enquiries/${e.id}`} className="lead-name">{who(e)}</Link><span className="tag tag-plain">{relative(e.receivedAt)}</span></div>
                  <span className="small enq-summary">{e.summary}</span>
                </div>
                <div className="lead-actions">
                  <Button small icon="send" onClick={() => setQuiet(e)}>Draft a nudge</Button>
                  <Button kind="secondary" small onClick={() => navigate(`/enquiries/${e.id}`)}>Open</Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {items.length === 0 && !(appts && (dueBack.length || wentQuiet.length)) && (
        <div className="panel empty section">
          <h2 className="heading">Nothing to follow up</h2>
          <p className="muted mt-8">{appts
            ? 'Clients appear here when they’re due their next treatment (set the weeks for each treatment in Settings → Bookings), when an enquiry goes quiet, or when a payment is outstanding.'
            : `When you mark an enquiry as “Quote sent” or “${words(settings.business.kind).won}”, its chasers, payment reminders and review request appear here on the right day.`}</p>
        </div>
      )}

      {GROUPS.map((g) => {
        const list = due.filter((f) => f.kind === g.kind);
        if (!list.length) return null;
        return (
          <section className="section" key={g.kind} aria-labelledby={`fg-${g.kind}`}>
            <div className="section-head"><h2 className="heading" id={`fg-${g.kind}`}>{g.title} <span className="count">{list.length}</span></h2><span className="small faint">{g.hint}</span></div>
            <div className="panel rows">{list.map((f) => <Row key={f.enquiry.id + f.kind} f={f} />)}</div>
          </section>
        );
      })}

      {later.length > 0 && (
        <section className="section" aria-labelledby="later-h">
          <div className="section-head"><h2 className="heading" id="later-h">Coming up</h2><span className="small faint">You’ll get these in your morning email when they’re due.</span></div>
          <div className="panel rows">{later.map((f) => <Row key={f.enquiry.id + f.kind} f={f} />)}</div>
        </section>
      )}

      <p className="xsmall faint section"><Icon name="info" className="inline-icon" />{appts ? 'Rebook invitations and review requests are treated as marketing, so they always include an opt-out line, and nobody who replied STOP is texted. Payment reminders are about work the client asked for.' : 'Quote chasers and payment reminders are about work the customer asked you for. Review requests are treated as marketing, so they always include an opt-out line.'}</p>

      {back && (
        <Compose
          title={`Invite ${who(back.enquiry)} back`}
          load={() => rebookText(back, settings)}
          phone={back.enquiry.phone || undefined} email={back.enquiry.email || undefined}
          note="A rebook invitation counts as marketing, so the opt-out line stays in. Gainora never sends messages for you."
          onSent={async () => { toast('Noted. If they book, mark the new enquiry as booked.'); }}
          onClose={() => setBack(null)} />
      )}
      {quiet && (
        <Compose
          title={`A nudge for ${who(quiet)}`}
          load={() => quietText(quiet)}
          phone={quiet.phone || undefined} email={quiet.email || undefined}
          onSent={() => update(quiet.id, { replied: true }, 'Logged.')}
          onClose={() => setQuiet(null)} />
      )}

      {draft && (
        <Compose
          title={`${draft.label}: ${who(draft.enquiry)}`}
          load={() => textFor(draft)}
          phone={draft.enquiry.phone || undefined} email={draft.enquiry.email || undefined}
          note={draft.kind === 'review' ? 'We treat review requests as marketing, so the opt-out line stays in. Gainora never sends messages for you.' : undefined}
          onSent={() => update(draft.enquiry.id, sentPatch(draft), 'Logged. The next one is scheduled.')}
          onClose={() => setDraft(null)} />
      )}
    </div>
  );
}
