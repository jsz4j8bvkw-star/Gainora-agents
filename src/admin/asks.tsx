import { useState } from 'react';
import { Button, ErrorNote, Field, Loading, Modal, copyText, useLoad, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { relative } from '../lib/format';
import { dueLabel, ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import { ASK_STATUS_LABEL, ASK_TEMPLATES, HAS_OPTIONS, MAX_QUESTIONS, type Question, type QuestionType, progressOf, templateFor } from '../../shared/admin/asks';
import { biz, type AskRow } from './biz-api';

const TYPE_LABEL: Record<QuestionType, string> = { long: 'Written answer', text: 'Short answer', choice: 'Pick one', multi: 'Tick all that apply', yesno: 'Yes or no', links: 'Links', photos: 'Photos' };
const confirmed = (msg: string) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(msg) : true);

/** A client's page → Questions: what's been asked, what came back, and asking for more. */
export function QuestionsTab({ email, name, contact, onChange }: { email: string; name: string; contact: string; onChange: () => void }) {
  const { data, error, reload } = useLoad(() => biz.asks(email), [email]);
  const [editing, setEditing] = useState<Partial<AskRow> | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();
  const today = ukToday();
  const done = () => { reload(); onChange(); };
  if (error) return <ErrorNote message={/502|503|client_asks/i.test(error) ? 'The questions table isn’t set up yet. Run the latest database update in Supabase.' : error} retry={reload} />;
  if (!data) return <Loading label="Loading their questions" />;
  return (
    <div className="stack gap-24">
      <div className="row gap-8 wrap">
        <Button icon="plus" onClick={() => setEditing({ template: 'website' })}>Ask for details</Button>
        <Button kind="secondary" icon="send" onClick={() => setEmailing(true)}>Email {contact.split(' ')[0] || 'them'}</Button>
      </div>
      {data.length ? data.map((a) => {
        const p = progressOf(a);
        const isOpen = open === a.id || (open === null && a.status === 'answered' && a === data.find((x) => x.status === 'answered'));
        return (
          <section key={a.id} className="panel ask-card" aria-label={a.title}>
            <div className="ask-head">
              <div className="stack gap-4 grow">
                <span className="row gap-8 wrap"><strong>{a.title}</strong>{a.created_by === 'Claude' && <span className="who who-claude">Drafted by Claude</span>}</span>
                <span className="xsmall faint">
                  {a.questions.length} questions · {p.answered} answered{a.files.length ? ` · ${a.files.length} photo${a.files.length === 1 ? '' : 's'}` : ''}
                  {a.sent_at ? ` · sent ${relative(a.sent_at)} to ${a.sent_to}` : ''}{a.reminded_at ? ` · reminded ${relative(a.reminded_at)}` : ''}
                </span>
              </div>
              <span className="stack gap-2" style={{ justifyItems: 'end' }}>
                <span className={`tag ${a.status === 'answered' ? 'tag-forest' : a.status === 'draft' ? 'tag-plain' : a.due_on && a.due_on < today ? 'tag-danger' : 'tag-brass'}`}>{ASK_STATUS_LABEL[a.status]}</span>
                {a.status !== 'answered' && a.status !== 'draft' && a.due_on && <span className={`due ${a.due_on < today ? 'due-late' : ''}`}>{dueLabel(a.due_on, today)}</span>}
                {a.answered_at && <span className="xsmall faint">answered {relative(a.answered_at)}</span>}
              </span>
            </div>
            <div className="row gap-8 wrap">
              {a.status === 'draft' && <Button small icon="send" onClick={() => setEditing(a)}>Check and send</Button>}
              {(a.status === 'sent' || a.status === 'opened') && <Button small kind="secondary" onClick={async () => { try { await biz.remindAsk(a.id); toast('Reminder sent'); done(); } catch (e) { toast(humanThrown(e, 'The reminder didn’t send.')); } }}>Send a reminder</Button>}
              {a.status !== 'draft' && <Button small kind="secondary" icon="copy" onClick={async () => toast((await copyText(a.url)) ? 'Link copied' : 'Couldn’t copy')}>Copy their link</Button>}
              {(p.answered > 0 || a.files.length > 0) && <Button small kind="quiet" onClick={() => setOpen(isOpen ? '' : a.id)}>{isOpen ? 'Hide answers' : 'Show answers'}</Button>}
              {a.status !== 'answered' && <Button small kind="quiet" onClick={async () => { if (!confirmed('Cancel these questions? Their link stops working.')) return; await biz.cancelAsk(a.id); done(); }}>Cancel</Button>}
            </div>
            {isOpen && <Answers a={a} />}
          </section>
        );
      }) : (
        <div className="panel empty"><h2 className="heading">Nothing asked yet</h2><p className="muted">Ask for details sends {name} a short form they can fill in on their phone, with photos. You’ll see their answers here, and the next step lands on your checklist.</p></div>
      )}
      {editing && <AskEditor email={email} contact={contact} initial={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); done(); }} />}
      {emailing && <EmailClient email={email} contact={contact} onClose={() => setEmailing(false)} onDone={() => { setEmailing(false); onChange(); }} />}
    </div>
  );
}

function Answers({ a }: { a: AskRow }) {
  let group = '';
  return (
    <div className="answers">
      {a.questions.map((q) => {
        const head = q.group && q.group !== group ? (group = q.group, <h3 key={`g-${q.id}`} className="answers-group">{q.group}</h3>) : null;
        const files = a.files.filter((f) => f.question === q.id);
        const v = q.type === 'yesno' ? (a.answers[q.id] === 'yes' ? 'Yes' : a.answers[q.id] === 'no' ? 'No' : '') : q.type === 'multi' ? (a.answers[q.id] || '').split('\n').filter(Boolean).join(', ') : a.answers[q.id] || '';
        return [head, (
          <div key={q.id} className="answer">
            <span className="xsmall faint">{q.label}</span>
            {q.type === 'photos'
              ? (files.length ? <ul className="answer-photos">{files.map((f) => <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.name} loading="lazy" /></a></li>)}</ul> : <span className="small faint">No photos yet</span>)
              : v ? <p className="small answer-text">{v}</p> : <span className="small faint">Not answered</span>}
          </div>
        )];
      })}
    </div>
  );
}

function AskEditor({ email, contact, initial, onClose, onDone }: { email: string; contact: string; initial: Partial<AskRow>; onClose: () => void; onDone: () => void }) {
  const start = templateFor(initial.template || 'website');
  const [template, setTemplate] = useState(start.key);
  const [title, setTitle] = useState(initial.title ?? start.title);
  const [intro, setIntro] = useState(initial.intro ?? start.intro);
  const [questions, setQuestions] = useState<Question[]>(initial.questions ?? start.questions);
  const [due, setDue] = useState(initial.due_on ?? addDays(ukToday(), start.dueDays));
  const [to, setTo] = useState(initial.sent_to || email);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const pick = (key: string) => { const t = templateFor(key); setTemplate(key); setTitle(t.title); setIntro(t.intro); setQuestions(t.questions); setDue(addDays(ukToday(), t.dueDays)); };
  const setQ = (i: number, patch: Partial<Question>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const save = async () => biz.saveAsk({ id: initial.id, email, template, title, intro, questions, due_on: due });
  const go = async (send: boolean) => {
    setBusy(send ? 'send' : 'save'); setErr(null);
    try {
      const a = await save();
      if (send) { await biz.sendAsk(a.id, { email, to, message }); toast(`Sent to ${to}`); } else toast('Saved as a draft');
      onDone();
    } catch (e) { setErr(humanThrown(e, 'That didn’t work.')); } finally { setBusy(null); }
  };
  return (
    <Modal title={initial.id ? 'Check and send' : 'Ask for details'} onClose={onClose} footer={<>
      <Button kind="secondary" busy={busy === 'save'} onClick={() => go(false)}>Save draft</Button>
      <Button icon="send" busy={busy === 'send'} disabled={!questions.length || !to} onClick={() => go(true)}>Send</Button>
    </>}>
      <div className="stack gap-16">
        {!initial.id && <Field label="Start from">{(id) => <select id={id} className="select" value={template} onChange={(e: any) => pick(e.target.value)}>{ASK_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.key === 'website' ? 'Website questions' : t.key === 'receptionist' ? 'Receptionist questions' : 'My own questions'}</option>)}</select>}</Field>}
        <div className="form-grid">
          <Field label="Title (the email’s subject)">{(id) => <input id={id} className="input" value={title} onChange={(e: any) => setTitle(e.target.value)} />}</Field>
          <Field label="Answer by">{(id) => <input id={id} className="input" type="date" value={due ?? ''} onChange={(e: any) => setDue(e.target.value)} />}</Field>
        </div>
        <Field label="A line at the top of the form" optional>{(id) => <textarea id={id} className="textarea" rows={2} value={intro} onChange={(e: any) => setIntro(e.target.value)} />}</Field>
        <Field label={`Questions (${questions.length})`} as="group">{() => (
          <ol className="q-edit">{questions.map((q, i) => (
            <li key={`${q.id}-${i}`}>
              <textarea className="textarea" rows={2} aria-label={`Question ${i + 1}`} value={q.label} onChange={(e: any) => setQ(i, { label: e.target.value })} />
              <div className="row gap-8 wrap">
                <select className="select select-small" aria-label={`Answer type for question ${i + 1}`} value={q.type} onChange={(e: any) => setQ(i, { type: e.target.value })}>{(Object.entries(TYPE_LABEL) as [QuestionType, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {q.group && <span className="xsmall faint">{q.group}</span>}
                <button type="button" className="linklike xsmall" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>Remove</button>
              </div>
              {HAS_OPTIONS(q.type) && <textarea className="textarea" rows={Math.min(6, Math.max(2, (q.options ?? []).length))} aria-label={`Choices for question ${i + 1}, one per line`} placeholder="The choices, one per line" value={(q.options ?? []).join('\n')} onChange={(e: any) => setQ(i, { options: e.target.value.split('\n') })} />}
            </li>
          ))}</ol>
        )}</Field>
        <div><Button small kind="secondary" icon="plus" disabled={questions.length >= MAX_QUESTIONS} onClick={() => setQuestions([...questions, { id: `q${Date.now() % 100000}`, label: '', type: 'long' }])}>Add a question</Button></div>
        <hr className="rule" />
        <Field label="Send to">{(id) => <input id={id} className="input" type="email" value={to} onChange={(e: any) => setTo(e.target.value)} />}</Field>
        <Field label="Your message in the email" optional help={`Starts “Hi ${contact.split(' ')[0] || 'there'},”. The button to the form and the date are added underneath.`}>{(id, d) => <textarea id={id} className="textarea" rows={3} aria-describedby={d} value={message} placeholder="We need a few details from you to get things right. It’s a short form you can fill in on your phone, and your answers save as you go." onChange={(e: any) => setMessage(e.target.value)} />}</Field>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/** A one-off email to the client from Gainora. Replies come to Gainora’s inbox; a copy goes on their notes. */
export function EmailClient({ email, contact, onClose, onDone }: { email: string; contact: string; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(email);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState(`Hi ${contact.split(' ')[0] || 'there'},\n\n\n\nThanks,\nAdelin\nGainora`);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const send = async () => { setBusy(true); setErr(null); try { await biz.emailClient(email, subject, message, to); toast(`Email sent to ${to}`); onDone(); } catch (e) { setErr(humanThrown(e, 'The email didn’t send.')); } finally { setBusy(false); } };
  return (
    <Modal title="Email" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button icon="send" busy={busy} disabled={!subject.trim() || !message.trim()} onClick={send}>Send</Button></>}>
      <div className="stack gap-16">
        <Field label="To">{(id) => <input id={id} className="input" type="email" value={to} onChange={(e: any) => setTo(e.target.value)} />}</Field>
        <Field label="Subject">{(id) => <input id={id} className="input" value={subject} onChange={(e: any) => setSubject(e.target.value)} />}</Field>
        <Field label="Message" help="Sent from Gainora; their reply comes to hello@gainora.co.uk. A copy is kept in their notes.">{(id, d) => <textarea id={id} className="textarea" rows={10} aria-describedby={d} value={message} onChange={(e: any) => setMessage(e.target.value)} />}</Field>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

