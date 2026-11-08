import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate } from '../lib/router';
import { Button, Choices, ErrorNote, Field, Icon, Loading, Modal, Tabs, copyText, useToast } from '../components/ui';
import { Compose } from '../components/compose';
import { CHANNEL_ICON, EnquiryRow, StatusTag, UrgencyTag, who } from '../components/enquiry';
import { csv, money, phone, relative, shortDate } from '../lib/format';
import {
  CHANNEL_LABEL, KIND_LABEL, paymentReminder, quoteChaser, QUOTE_CHASE_DAYS, reviewRequest, statusLabel, words,
} from '../../shared/capture';
import type { EnquiryPatch, EnquiryRecord, NewEnquiry } from '../lib/types';

type Filter = 'new' | 'progress' | 'won' | 'closed' | 'spam' | 'all';
const IN: Record<Filter, (e: EnquiryRecord) => boolean> = {
  new: (e) => e.status === 'new',
  progress: (e) => ['replied', 'quoted', 'booked'].includes(e.status),
  won: (e) => e.status === 'won',
  closed: (e) => e.status === 'lost',
  spam: (e) => e.status === 'spam',
  all: (e) => e.status !== 'spam',
};

const dayLabel = (iso: string) => {
  const d = new Date(iso); const today = new Date(); const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
};

/* ---------- The inbox ---------- */

export function Enquiries({ adding = false }: { adding?: boolean }) {
  const { enquiries, enquiriesError, reloadEnquiries, settings } = useApp();
  const W = words(settings.business.kind);
  const [filter, setFilter] = useState<Filter>(() => (enquiries ?? []).some((e) => e.status === 'new') ? 'new' : 'all');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(adding);
  const toast = useToast();

  const counts = useMemo(() => Object.fromEntries((Object.keys(IN) as Filter[]).map((f) => [f, (enquiries ?? []).filter(IN[f]).length])) as Record<Filter, number>, [enquiries]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (enquiries ?? []).filter(IN[filter]).filter((e) => !term || [e.name, e.phone, e.email, e.postcode, e.summary, e.notes].join(' ').toLowerCase().includes(term));
  }, [enquiries, filter, q]);
  const groups = useMemo(() => {
    const g: { day: string; items: EnquiryRecord[] }[] = [];
    for (const e of list) { const d = dayLabel(e.receivedAt); const last = g[g.length - 1]; if (last?.day === d) last.items.push(e); else g.push({ day: d, items: [e] }); }
    return g;
  }, [list]);

  if (enquiriesError && !enquiries) return <div className="page"><ErrorNote message={enquiriesError} retry={reloadEnquiries} /></div>;
  if (!enquiries) return <Loading />;

  const exportCsv = () => {
    if (api.mode === 'demo') { toast('In your app this downloads a file. Downloads are switched off in the demo.'); return; }
    const rows: (string | number)[][] = [['Received', 'Channel', 'Name', 'Phone', 'Email', 'Postcode', 'Type', 'Urgency', 'Out of hours', 'Status', 'Quote', 'Job value', 'Paid', 'Summary']];
    for (const e of enquiries) rows.push([new Date(e.receivedAt).toLocaleString('en-GB'), CHANNEL_LABEL[e.channel], e.name, e.phone, e.email, e.postcode, KIND_LABEL[e.kind], e.urgency, e.afterHours ? 'Yes' : 'No', statusLabel(e.status, settings.business.kind), e.quoteAmount ?? '', e.jobValue ?? '', e.paidAt ? 'Yes' : '', e.summary]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' })); a.download = 'enquiries.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Enquiries</h1>
          <p className="lede">Every call your receptionist answers, every website form and email, in one place. Emergencies come first.</p>
        </div>
        <div className="row gap-8 wrap">
          <Button kind="quiet" icon="download" onClick={exportCsv}>Export</Button>
          <Button icon="plus" onClick={() => setAdd(true)}>Log a call</Button>
        </div>
      </div>

      <div className="inbox-tools">
        <Tabs label="Show" value={filter} onChange={setFilter} tabs={[
          { id: 'new', label: 'Needs a reply', badge: counts.new || null },
          { id: 'progress', label: 'In progress', badge: counts.progress || null },
          { id: 'won', label: W.wonTab },
          { id: 'closed', label: 'Didn’t go ahead' },
          { id: 'spam', label: 'Spam', badge: counts.spam || null },
          { id: 'all', label: 'All' },
        ]} />
        <div className="search-field">
          <Icon name="search" />
          <label className="sr-only" htmlFor="enq-search">Search enquiries</label>
          <input id="enq-search" className="input" placeholder="Name, number, postcode…" value={q} onChange={(e: any) => setQ(e.target.value)} />
        </div>
      </div>

      <div role="tabpanel" id={`panel-${filter}`} aria-labelledby={`tab-${filter}`} className="tab-panel">
        {list.length === 0 && (
          <div className="panel empty">
            <h2 className="heading">{q ? 'Nothing matches that search' : filter === 'new' ? 'You’re all caught up' : 'Nothing here yet'}</h2>
            <p className="muted mt-8">{filter === 'new' ? 'New calls, forms and emails land here the moment they arrive. Emergencies are also emailed to you straight away.' : filter === 'spam' ? 'Sales calls and spam are filed here so they don’t clutter your inbox.' : 'Enquiries move here as you work through them.'}</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.day} className="day-group" aria-label={g.day}>
            <h2 className="day-label">{g.day}</h2>
            <div className="panel rows">{g.items.map((e) => <EnquiryRow key={e.id} e={e} />)}</div>
          </section>
        ))}
      </div>

      {add && <AddEnquiry onClose={() => { setAdd(false); if (adding) navigate('/enquiries', { replace: true }); }} />}
    </div>
  );
}

function AddEnquiry({ onClose }: { onClose: () => void }) {
  const { putEnquiry } = useApp();
  const [f, setF] = useState<NewEnquiry>({ channel: 'call', name: '', phone: '', email: '', postcode: '', summary: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: keyof NewEnquiry, v: string) => setF({ ...f, [k]: v });
  const CH: { v: NewEnquiry['channel']; l: string }[] = [{ v: 'call', l: 'Phone call' }, { v: 'text', l: 'Text' }, { v: 'email', l: 'Email' }, { v: 'form', l: 'Website form' }];
  const save = async () => {
    if (!f.summary.trim()) { setErr('Add a line about what they need.'); return; }
    if (!f.phone.trim() && !f.email.trim()) { setErr('Add a phone number or email so you can get back to them.'); return; }
    setBusy(true);
    try { const e = await api.addEnquiry(f); putEnquiry(e); toast('Logged.'); onClose(); navigate(`/enquiries/${e.id}`); }
    catch (e: any) { setErr(e?.message || 'That didn’t save. Try again.'); setBusy(false); }
  };
  return (
    <Modal title="Log an enquiry" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="panel-pad form-grid">
        <Field label="How they got in touch" as="group" className="wide">{(_, d) => <Choices name="ch" options={CH.map((c) => c.l)} value={CH.find((c) => c.v === f.channel)!.l} describedBy={d} onChange={(l: string) => set('channel', CH.find((c) => c.l === l)!.v)} />}</Field>
        <Field label="Name" optional>{(id) => <input id={id} className="input" value={f.name} onChange={(e: any) => set('name', e.target.value)} autoComplete="off" />}</Field>
        <Field label="Phone">{(id) => <input id={id} className="input" type="tel" value={f.phone} onChange={(e: any) => set('phone', e.target.value)} />}</Field>
        <Field label="Email" optional>{(id) => <input id={id} className="input" type="email" value={f.email} onChange={(e: any) => set('email', e.target.value)} />}</Field>
        <Field label="Postcode" optional>{(id) => <input id={id} className="input" value={f.postcode} onChange={(e: any) => set('postcode', e.target.value.toUpperCase())} />}</Field>
        <Field label="What they need" className="wide" error={err ?? undefined}>{(id, d) => <textarea id={id} className="textarea" value={f.summary} aria-describedby={d} onChange={(e: any) => set('summary', e.target.value)} placeholder="Boiler making a banging noise, wants someone this week." />}</Field>
      </div>
    </Modal>
  );
}

/* ---------- One enquiry ---------- */

type Ask = null | { kind: 'quote' | 'booked' | 'won' | 'invoice' };
type Draft = null | { title: string; load: () => Promise<string> | string; onSent?: () => Promise<void>; sentLabel?: string; note?: string };

export function EnquiryDetail({ id }: { id: string }) {
  const { enquiries, settings, putEnquiry, dropEnquiry } = useApp();
  const W = words(settings.business.kind);
  const appts = settings.business.kind === 'appointments';
  const [ask, setAsk] = useState<Ask>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  if (!enquiries) return <Loading />;
  const e = enquiries.find((x) => x.id === id);
  if (!e) {
    return <div className="page"><div className="panel empty"><h1 className="heading">That enquiry isn’t here</h1><p className="muted mt-8">It may have been deleted.</p><Link to="/enquiries" className="btn btn-secondary mt-16">Back to enquiries</Link></div></div>;
  }

  const update = async (patch: EnquiryPatch, message?: string, key = 'x') => {
    setBusy(key);
    try { const next = await api.updateEnquiry(e.id, patch); putEnquiry(next); if (message) toast(message); }
    catch (err: any) { toast(err?.message || 'That didn’t save. Try again.'); throw err; }
    finally { setBusy(null); }
  };
  const ctx = { business: settings.business.name, owner: settings.business.ownerName, customer: e.name.split(' ')[0] || undefined, payLink: settings.followUps.payLink || undefined, reviewLink: settings.followUps.reviewLink || undefined };
  const contact = { phone: e.phone || undefined, email: e.email || undefined };

  const openReply = () => setDraft({ title: `Reply to ${who(e)}`, load: () => api.draftReply(e.id), onSent: () => update({ replied: true }, 'Marked as replied.'), sentLabel: 'I’ve replied' });
  const openChaser = () => {
    const n = (e.chasersSent >= 1 ? 2 : 1) as 1 | 2;
    setDraft({ title: n === 1 ? 'Quote chaser' : 'Last quote chaser', load: () => quoteChaser({ ...ctx, amount: e.quoteAmount ? money(e.quoteAmount) : undefined, job: undefined }, n), onSent: () => update({ chaserSent: true }, 'Chaser logged.') });
  };
  const openPayment = () => {
    const stage = Math.min(3, e.paymentRemindersSent + 1) as 1 | 2 | 3;
    setDraft({ title: ['Payment reminder', 'Payment overdue', 'Final payment reminder'][stage - 1], load: () => paymentReminder({ ...ctx, amount: e.jobValue ? money(e.jobValue) : undefined, dueDate: e.invoiceDue ? shortDate(e.invoiceDue) : undefined }, stage), onSent: () => update({ paymentReminderSent: true }, 'Reminder logged.') });
  };
  const openReview = () => setDraft({ title: 'Ask for a review', load: () => reviewRequest(ctx), onSent: () => update({ reviewAsked: true }, 'Review request logged.'), note: 'We treat review requests as marketing, so the opt-out line stays in. Gainora never sends messages for you.' });

  const chaseDue = e.status === 'quoted' && e.quotedAt && QUOTE_CHASE_DAYS[e.chasersSent] != null;
  const overdue = e.status === 'won' && e.invoiceDue && !e.paidAt && new Date(e.invoiceDue) <= new Date();

  return (
    <div className="page">
      <Link to="/enquiries" className="back-link"><Icon name="back" />All enquiries</Link>
      <div className="page-head detail-head">
        <div>
          <div className="row gap-8 wrap"><UrgencyTag e={e} /><StatusTag e={e} />{e.afterHours && <span className="tag tag-plain"><Icon name="moon" className="tag-ico" />Out of hours</span>}{e.isTest && <span className="tag tag-plain">Test</span>}</div>
          <h1 className="title mt-8">{who(e)}</h1>
          <p className="lede"><Icon name={CHANNEL_ICON[e.channel]} className="inline-icon" />{CHANNEL_LABEL[e.channel]}, {new Date(e.receivedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} ({relative(e.receivedAt)})</p>
        </div>
        <div className="contact-bar">
          {e.phone && <a className="btn btn-primary" href={`tel:${e.phone}`}><Icon name="phone" />Call</a>}
          {e.phone && <a className="btn btn-secondary" href={`sms:${e.phone}`}><Icon name="message" />Text</a>}
          {e.email && <a className="btn btn-secondary" href={`mailto:${e.email}`}><Icon name="mail" />Email</a>}
        </div>
      </div>

      <div className="grid-2 detail-grid">
        <div className="stack gap-24">
          <section className="panel letter" aria-labelledby="need-h">
            <h2 className="label" id="need-h">What they need</h2>
            <p className="voice mt-8">{e.summary || 'No summary was sent with this enquiry.'}</p>
            {e.reasons.length > 0 && <p className="small reason-line mt-16"><Icon name="alert" className="inline-icon" />{e.reasons.join('. ')}.</p>}
            <dl className="facts">
              {e.phone && <><dt>Phone</dt><dd><a href={`tel:${e.phone}`}>{phone(e.phone)}</a> <button className="link-btn" onClick={async () => toast((await copyText(e.phone)) ? 'Number copied.' : 'Copy it manually.')}>Copy</button></dd></>}
              {e.email && <><dt>Email</dt><dd><a href={`mailto:${e.email}`}>{e.email}</a></dd></>}
              {e.postcode && <><dt>Postcode</dt><dd>{e.postcode} <a className="link-btn" href={`https://www.google.com/maps/search/${encodeURIComponent(e.postcode)}`} target="_blank" rel="noreferrer">Map</a></dd></>}
              <dt>Type</dt>
              <dd>
                <label className="sr-only" htmlFor="kind">Type of enquiry</label>
                <select id="kind" className="select select-inline" value={e.kind} onChange={(ev: any) => update({ kind: ev.target.value }, 'Updated.').catch(() => {})}>
                  {(['quote', 'booking', 'callback', 'complaint', 'other'] as const).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </dd>
            </dl>
          </section>

          {(e.transcript || e.recordingUrl) && (
            <details className="panel transcript">
              <summary><span className="subhead">Call transcript</span><span className="small faint">{e.transcript ? `${e.transcript.split('\n').length} lines` : ''}</span></summary>
              {e.recordingUrl && <p className="small" style={{ padding: '0 24px 12px' }}><a href={e.recordingUrl} target="_blank" rel="noreferrer"><Icon name="play" className="inline-icon" />Listen to the recording</a></p>}
              {e.transcript && <div className="transcript-body">{e.transcript.split('\n').map((l, i) => {
                const m = l.match(/^([^:]{1,24}):\s*(.*)$/);
                const agent = m && /agent|receptionist|assistant|ai/i.test(m[1]);
                return <p key={i} className={agent ? 'line-agent' : 'line-caller'}>{m ? <><span className="speaker">{agent ? 'Receptionist' : 'Caller'}</span>{m[2]}</> : l}</p>;
              })}</div>}
            </details>
          )}

          <section className="panel" aria-labelledby="notes-h">
            <div className="panel-head"><h2 className="subhead" id="notes-h">Your notes</h2>{notes != null && notes !== e.notes && <Button small busy={busy === 'notes'} onClick={() => update({ notes }, 'Notes saved.', 'notes').then(() => setNotes(null)).catch(() => {})}>Save notes</Button>}</div>
            <div style={{ padding: '16px 22px 20px' }}>
              <label className="sr-only" htmlFor="notes">Notes</label>
              <textarea id="notes" className="textarea" placeholder={appts ? 'Anything the team should know before the appointment…' : 'Access, parking, what you found, parts to order…'} value={notes ?? e.notes} onChange={(ev: any) => setNotes(ev.target.value)} />
            </div>
          </section>

          <section aria-labelledby="hist-h">
            <h2 className="subhead" id="hist-h" style={{ marginBottom: 12 }}>What’s happened</h2>
            <ol className="history">
              {[...e.history].reverse().map((h, i) => <li key={i}><span className="small">{h.text}</span><span className="xsmall faint">{new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></li>)}
            </ol>
          </section>
          <button className="btn btn-quiet btn-small danger-link" onClick={() => setConfirmDelete(true)}><Icon name="trash" />Delete this enquiry</button>
        </div>

        <aside className="stack gap-16">
          <section className="next-step" aria-labelledby="next-h">
            <h2 className="label" id="next-h">Next step</h2>
            {e.status === 'new' && <>
              <p className="next-line">{e.urgency === 'emergency' ? 'Call them back now.' : 'Reply while it’s fresh. The first trade to get back usually gets the job.'}</p>
              <div className="next-actions">
                <Button icon="send" onClick={openReply}>Draft a reply</Button>
                <Button kind="secondary" busy={busy === 'rep'} onClick={() => update({ replied: true }, 'Marked as replied.', 'rep').catch(() => {})}>I’ve called them back</Button>
              </div>
            </>}
            {e.status === 'replied' && <p className="next-line">You’ve been in touch. What happened next?</p>}
            {e.status === 'quoted' && <>
              <p className="next-line">Quote sent{e.quoteAmount ? ` for ${money(e.quoteAmount)}` : ''}{e.quotedAt ? ` ${relative(e.quotedAt)}` : ''}. {e.chasersSent ? `${e.chasersSent} ${e.chasersSent === 1 ? 'chaser' : 'chasers'} sent.` : ''}</p>
              {chaseDue && <div className="next-actions"><Button icon="send" onClick={openChaser}>{e.chasersSent ? 'Draft the last chaser' : 'Draft a chaser'}</Button></div>}
            </>}
            {e.status === 'booked' && <p className="next-line">{e.bookedFor ? `Booked for ${new Date(e.bookedFor).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}.` : 'Booked in.'}</p>}
            {e.status === 'won' && <>
              <p className="next-line">{W.won}{e.jobValue ? `, ${money(e.jobValue)}` : ''}. {e.paidAt ? `Paid ${relative(e.paidAt)}.` : e.invoiceDue ? `Payment ${overdue ? 'was due' : 'due'} ${shortDate(e.invoiceDue)}.` : ''}</p>
              <div className="next-actions">
                {!e.paidAt && <Button icon="check" busy={busy === 'paid'} onClick={() => update({ paid: true }, 'Marked as paid.', 'paid').catch(() => {})}>Mark as paid</Button>}
                {!e.paidAt && e.invoiceDue && e.paymentRemindersSent < 3 && <Button kind={overdue ? 'primary' : 'secondary'} icon="send" onClick={openPayment}>Draft a payment reminder</Button>}
                {!e.reviewAskedAt && <Button kind={e.paidAt ? 'primary' : 'secondary'} icon="star" onClick={openReview}>Ask for a review</Button>}
                {e.reviewAskedAt && <span className="small faint">Review requested {relative(e.reviewAskedAt)}.</span>}
                <Button kind="quiet" small onClick={() => setAsk({ kind: 'invoice' })}>Change value or due date</Button>
              </div>
            </>}
            {(e.status === 'lost' || e.status === 'spam') && <>
              <p className="next-line">{e.status === 'spam' ? 'Filed as spam.' : 'Didn’t go ahead.'}</p>
              <div className="next-actions"><Button kind="secondary" onClick={() => update({ status: e.repliedAt ? 'replied' : 'new' }, 'Moved back.').catch(() => {})}>Move back</Button></div>
            </>}
            {!['won', 'lost', 'spam'].includes(e.status) && (
              <div className="stage-grid">
                {e.status !== 'quoted' && !appts && <button className="stage-btn" onClick={() => setAsk({ kind: 'quote' })}><Icon name="pound" />Quote sent</button>}
                {e.status !== 'booked' && <button className="stage-btn" onClick={() => setAsk({ kind: 'booked' })}><Icon name="calendar" />Booked in</button>}
                {e.status === 'booked' && <button className="stage-btn" onClick={() => setAsk({ kind: 'booked' })}><Icon name="calendar" />Change date</button>}
                <button className="stage-btn" onClick={() => setAsk({ kind: 'won' })}><Icon name="check" />{W.won}</button>
                <button className="stage-btn quiet" onClick={() => update({ status: 'lost' }, 'Marked as didn’t go ahead.').catch(() => {})}><Icon name="x" />Didn’t go ahead</button>
                {e.status === 'new' && <button className="stage-btn quiet" onClick={() => update({ status: 'spam' }, 'Filed as spam.').catch(() => {})}><Icon name="trash" />Spam</button>}
              </div>
            )}
          </section>

          {(e.quoteAmount || e.jobValue) && (
            <section className="panel money-panel">
              {e.quoteAmount != null && <div><span className="small faint">Quoted</span><strong className="tabular">{money(e.quoteAmount)}</strong></div>}
              {e.jobValue != null && <div><span className="small faint">{W.value}</span><strong className="tabular">{money(e.jobValue)}</strong></div>}
              {e.status === 'won' && <div><span className="small faint">Paid</span><strong>{e.paidAt ? 'Yes' : 'Not yet'}</strong></div>}
            </section>
          )}

        </aside>
      </div>

      {draft && <Compose title={draft.title} load={draft.load} {...contact} onSent={draft.onSent} sentLabel={draft.sentLabel} note={draft.note} onClose={() => setDraft(null)} />}
      {ask && <StageModal e={e} kind={ask.kind} words={W} paymentDays={settings.followUps.paymentDays} onClose={() => setAsk(null)} onSave={(p, msg) => update(p, msg).then(() => setAsk(null))} />}
      {confirmDelete && (
        <Modal title="Delete this enquiry?" onClose={() => setConfirmDelete(false)} footer={<><Button kind="secondary" onClick={() => setConfirmDelete(false)}>Keep it</Button><Button onClick={async () => { await api.deleteEnquiry(e.id); dropEnquiry(e.id); toast('Deleted.'); navigate('/enquiries'); }}>Delete for good</Button></>}>
          <p className="panel-pad muted">This removes {who(e)}’s details, the transcript and your notes. It can’t be undone. Use this when a customer asks you to delete their information.</p>
        </Modal>
      )}
    </div>
  );
}

function StageModal({ e, kind, words: W, paymentDays, onClose, onSave }: { e: EnquiryRecord; kind: 'quote' | 'booked' | 'won' | 'invoice'; words: ReturnType<typeof words>; paymentDays: number; onClose: () => void; onSave: (p: EnquiryPatch, msg: string) => Promise<void> }) {
  const tomorrow = new Date(Date.now() + 86_400_000); tomorrow.setHours(9, 0, 0, 0);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [amount, setAmount] = useState(String((kind === 'quote' ? e.quoteAmount : e.jobValue ?? e.quoteAmount) ?? ''));
  const [when, setWhen] = useState(e.bookedFor ? local(new Date(e.bookedFor)) : local(tomorrow));
  const [due, setDue] = useState(e.invoiceDue ?? new Date(Date.now() + paymentDays * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = () => { const v = Number(amount.replace(/[£,\s]/g, '')); return amount.trim() && Number.isFinite(v) && v >= 0 ? v : null; };
  const save = async () => {
    setErr(null);
    if (amount.trim() && n() == null) { setErr('Enter an amount in pounds, like 640.'); return; }
    setBusy(true);
    try {
      if (kind === 'quote') await onSave({ status: 'quoted', quoteAmount: n() }, 'Quote logged. Chasers are set for day 3 and day 8.');
      if (kind === 'booked') await onSave({ status: 'booked', bookedFor: new Date(when).toISOString() }, 'Booked in.');
      if (kind === 'won') await onSave({ status: 'won', jobValue: n(), invoiceDue: n() ? due : null }, n() ? `${W.won}. Payment reminders are set.` : `${W.won}.`);
      if (kind === 'invoice') await onSave({ jobValue: n(), invoiceDue: due }, 'Updated.');
    } catch { setBusy(false); }
  };
  const title = { quote: 'Quote sent', booked: 'Booked in', won: W.won, invoice: `${W.value} and payment` }[kind];
  return (
    <Modal title={title} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="panel-pad stack gap-16">
        {kind === 'quote' && <p className="muted small">Gainora reminds you to chase on day 3 and day 8, with the message written for you.</p>}
        {kind === 'won' && <p className="muted small">Add the value and Gainora tracks the payment, drafts reminders if it’s late, and reminds you to ask for a review. Only you see these figures.</p>}
        {kind !== 'booked' && (
          <Field label={kind === 'quote' ? 'Quote amount' : W.value} optional error={err ?? undefined}>
            {(id, d) => <div className="prefix-input"><span aria-hidden="true">£</span><input id={id} className="input tabular" inputMode="decimal" value={amount} aria-describedby={d} onChange={(ev: any) => setAmount(ev.target.value)} placeholder="640" /></div>}
          </Field>
        )}
        {kind === 'booked' && <Field label="Date and time">{(id) => <input id={id} className="input" type="datetime-local" value={when} onChange={(ev: any) => setWhen(ev.target.value)} />}</Field>}
        {(kind === 'won' || kind === 'invoice') && <Field label="Payment due" help={`Your usual terms: ${paymentDays ? `${paymentDays} days` : 'on completion'}.`}>{(id, d) => <input id={id} className="input" type="date" value={due} aria-describedby={d} onChange={(ev: any) => setDue(ev.target.value)} />}</Field>}
      </div>
    </Modal>
  );
}
