import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Icon, useToast } from './ui';
import { phone as fmtPhone, relative } from '../lib/format';
import { smsParts, stepDef, upcoming, type StepId, type WorkflowId } from '../../shared/automations';
import type { EnquiryRecord, MessageRecord } from '../lib/types';

export const stepTitle = (m: Pick<MessageRecord, 'workflow' | 'step'>) => {
  if (m.workflow === 'owner_alert') return 'Urgent alert to you';
  try { return m.workflow && m.step ? stepDef(m.workflow as WorkflowId, m.step as StepId).title : 'Automatic message'; } catch { return 'Automatic message'; }
};
const STATUS: Record<MessageRecord['status'], string> = { awaiting_approval: 'Waiting for your OK', sending: 'Sending', sent: 'Sent', failed: 'Not sent', skipped: 'Skipped', received: '' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Every text and email with this customer, and a box to reply. */
export function Thread({ e, autoDraft = false }: { e: EnquiryRecord; autoDraft?: boolean }) {
  const { messages, putMessage, putEnquiry, reloadMessages, settings } = useApp();
  const list = useMemo(() => messages.filter((m) => m.enquiryId === e.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [messages, e.id]);
  const next = useMemo(() => upcoming(e, settings, list.map((m) => ({ enquiryId: m.enquiryId, direction: m.direction, key: m.key, status: m.status, createdAt: m.createdAt, automatic: m.automatic }))), [e, settings, list]);
  const [channel, setChannel] = useState<'text' | 'email'>(e.phone ? 'text' : 'email');
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const toast = useToast();
  const unread = list.some((m) => m.direction === 'in' && !m.read);

  // Arrived from a "Reply" button: write the draft straight away and put the cursor in it.
  useEffect(() => {
    if (!autoDraft || !(e.phone || e.email)) return;
    draft().then(() => { box.current?.focus(); box.current?.scrollIntoView({ block: 'center' }); });
  }, []);

  useEffect(() => {
    if (!unread) return;
    api.markRead(e.id).then(() => { for (const m of list) if (m.direction === 'in' && !m.read) putMessage({ ...m, read: true }); }).catch(() => {});
  }, [e.id, unread]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy('send');
    try {
      const r = await api.reply(e.id, channel, text.trim(), channel === 'email' ? subject.trim() || undefined : undefined);
      putMessage(r.message); putEnquiry(r.enquiry); setText(''); setSubject('');
      toast(channel === 'text' ? 'Text sent.' : 'Email sent.');
      setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 50);
    } catch (err: any) { toast(err?.message || 'Not sent. Try again.'); }
    finally { setBusy(null); }
  };
  const draft = async () => {
    setBusy('draft');
    try { const t = await api.draftReply(e.id); const subj = t.match(/^Subject:\s*(.*)\n+/); if (subj) { setSubject(subj[1]); setText(t.slice(subj[0].length)); } else setText(t); }
    catch { toast('Couldn’t write one. Try again.'); }
    finally { setBusy(null); }
  };
  const approve = async (m: MessageRecord, body?: string) => {
    setBusy(m.id);
    try { await api.approveMessage(m.id, body); await reloadMessages(); toast('Sent.'); setEditing(null); }
    catch (err: any) { toast(err?.message || 'Not sent.'); }
    finally { setBusy(null); }
  };
  const skip = async (m: MessageRecord) => {
    setBusy(m.id);
    try { await api.skipMessage(m.id); putMessage({ ...m, status: 'skipped' }); }
    finally { setBusy(null); }
  };

  return (
    <section className="panel thread" aria-labelledby="thread-h">
      <div className="panel-head"><h2 className="subhead" id="thread-h">Messages</h2><span className="xsmall faint">{e.phone ? `Texts with ${fmtPhone(e.phone)}` : e.email ? `Emails with ${e.email}` : 'No phone or email'}</span></div>
      <div className="thread-body" aria-live="polite">
        {list.length === 0 && <p className="small muted thread-empty">No messages yet. Automatic messages and your replies appear here, and so do the {settings.business.kind === 'appointments' ? 'client' : 'customer'}’s replies.</p>}
        {list.map((m) => m.audience === 'owner' ? (
          <p className="thread-note" key={m.id}><Icon name="alert" className="inline-icon" />Urgent alert texted to you{m.status === 'failed' ? ' (not sent: texting isn’t switched on)' : ''} · {when(m.createdAt)}</p>
        ) : (
          <div className={`bubble-row ${m.direction}`} key={m.id}>
            <div className={`bubble ${m.direction} ${m.status}`}>
              {m.automatic && <span className="bubble-tag"><Icon name="bolt" />{stepTitle(m)}</span>}
              {m.channel === 'email' && m.subject && <strong className="bubble-subject">{m.subject}</strong>}
              {editing?.id === m.id
                ? <textarea className="textarea" aria-label="Edit message" value={editing.text} onChange={(ev: any) => setEditing({ id: m.id, text: ev.target.value })} />
                : <p>{m.body}</p>}
              <span className="bubble-meta">
                <Icon name={m.channel === 'email' ? 'mail' : 'message'} />
                {when(m.createdAt)}{m.direction === 'out' && STATUS[m.status] ? ` · ${STATUS[m.status]}` : ''}{m.error ? `: ${m.error}` : ''}
              </span>
              {m.status === 'awaiting_approval' && (
                <span className="bubble-actions">
                  <Button small busy={busy === m.id} onClick={() => approve(m, editing?.id === m.id ? editing.text : undefined)}>Send</Button>
                  {editing?.id !== m.id && <Button small kind="secondary" onClick={() => setEditing({ id: m.id, text: m.body })}>Edit</Button>}
                  <Button small kind="quiet" onClick={() => skip(m)}>Skip</Button>
                </span>
              )}
            </div>
          </div>
        ))}
        {next.length > 0 && (
          <div className="thread-next">
            {next.slice(0, 3).map((n) => <span key={n.workflow + n.step}><Icon name="clock" />{n.title} sends automatically {relative(n.sendAt)}</span>)}
          </div>
        )}
        <div ref={end} />
      </div>
      {(e.phone || e.email) && (
        <div className="composer-box">
          {e.phone && e.email && (
            <div className="seg" role="group" aria-label="Send as">
              <button className="seg-btn" aria-pressed={channel === 'text'} onClick={() => setChannel('text')}>Text</button>
              <button className="seg-btn" aria-pressed={channel === 'email'} onClick={() => setChannel('email')}>Email</button>
            </div>
          )}
          {channel === 'email' && <input className="input" aria-label="Email subject" placeholder={`Subject: Your enquiry with ${settings.business.name}`} value={subject} onChange={(ev: any) => setSubject(ev.target.value)} />}
          <label className="sr-only" htmlFor="reply">Your message</label>
          <textarea id="reply" ref={box} className="textarea" rows={Math.min(8, Math.max(3, Math.ceil(text.length / 42)))} placeholder={channel === 'text' ? `Text ${e.name.split(' ')[0] || (settings.business.kind === 'appointments' ? 'the client' : 'the customer')}…` : 'Write an email…'} value={text} onChange={(ev: any) => setText(ev.target.value)} />
          <div className="composer-foot">
            <Button kind="quiet" small icon="pencil" busy={busy === 'draft'} onClick={draft}>Write it for me</Button>
            <span className="xsmall faint">{channel === 'text' && text ? `${text.length} characters · ${smsParts(text)} ${smsParts(text) === 1 ? 'text' : 'texts'}` : ''}</span>
            <Button small icon="send" busy={busy === 'send'} disabled={!text.trim()} onClick={send}>Send {channel === 'text' ? 'text' : 'email'}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
