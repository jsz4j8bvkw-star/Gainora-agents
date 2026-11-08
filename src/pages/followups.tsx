import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate } from '../lib/router';
import { Button, ErrorNote, Icon, Loading, useToast } from '../components/ui';
import { Compose } from '../components/compose';
import { who } from '../components/enquiry';
import { money, relative, shortDate } from '../lib/format';
import { followUps, paymentReminder, quoteChaser, reviewRequest, words, type FollowItem } from '../../shared/capture';
import type { EnquiryPatch } from '../lib/types';

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
  const toast = useToast();
  const items = useMemo(() => followUps(enquiries ?? []), [enquiries]);
  const wfFor = (f: FollowItem) => (f.kind === 'quote' ? 'quote' : f.kind === 'payment' ? 'payment' : 'review') as 'quote' | 'payment' | 'review';
  const stepFor = (f: FollowItem) => (f.kind === 'quote' ? `chase${f.stage}` : f.kind === 'payment' ? `pay${f.stage}` : 'review') as 'chase1';
  const isAuto = (f: FollowItem) => { const w = settings.automations[wfFor(f)]; return !!w?.on && !!w.steps[stepFor(f)]?.on && new Date(w.since) <= new Date(f.enquiry.receivedAt); };
  const paused = (f: FollowItem) => messages.some((m) => m.enquiryId === f.enquiry.id && m.direction === 'in');

  if (enquiriesError && !enquiries) return <div className="page"><ErrorNote message={enquiriesError} retry={reloadEnquiries} /></div>;
  if (!enquiries) return <Loading />;

  const due = items.filter((f) => f.due);
  const later = items.filter((f) => !f.due);
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
          <p className="lede">The messages that win the job and get you paid. Each one is written for you. You read it, then send it from your own phone or email.</p>
        </div>
      </div>

      <section className="panel" aria-label="Follow-ups at a glance">
        <div className="stats stats-3">
          <div className="stat"><span className="stat-label">Due now</span><span className="stat-value" style={{ color: due.length ? 'var(--brass)' : undefined }}>{due.length}</span><span className="stat-note">{due.length ? 'Messages drafted and ready' : 'You’re up to date'}</span></div>
          <div className="stat"><span className="stat-label">Quotes waiting on an answer</span><span className="stat-value">{money(quoteValue)}</span><span className="stat-note">{items.filter((f) => f.kind === 'quote').length} quotes</span></div>
          <div className="stat"><span className="stat-label">Waiting to be paid</span><span className="stat-value">{money(owed)}</span><span className="stat-note">{items.filter((f) => f.kind === 'payment').length} jobs</span></div>
        </div>
      </section>

      {items.length === 0 && (
        <div className="panel empty section">
          <h2 className="heading">Nothing to follow up</h2>
          <p className="muted mt-8">When you mark an enquiry as “Quote sent” or “{words(settings.business.kind).won}”, its chasers, payment reminders and review request appear here on the right day.</p>
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

      <p className="xsmall faint section"><Icon name="info" className="inline-icon" />Quote chasers and payment reminders are about work the customer asked you for. Review requests are treated as marketing, so they always include an opt-out line.</p>

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
