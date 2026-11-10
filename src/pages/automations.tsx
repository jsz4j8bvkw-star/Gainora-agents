import { Fragment, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link } from '../lib/router';
import { Button, Choices, Icon, Tabs, useToast } from '../components/ui';
import { stepTitle } from '../components/thread';
import { phone as fmtPhone, relative } from '../lib/format';
import {
  fieldsFor, render, smsParts, WEEKLY_CAP, WORKFLOWS,
  type MsgChannel, type StepDef, type StepSetting, type WorkflowDef, type WorkflowSetting,
} from '../../shared/automations';
import { depositRule } from '../../shared/capture';
import { DepositCard, EmailsCard, SpaceCard } from '../components/features';
import type { CaptureSettings, EnquiryRecord, MessageRecord } from '../lib/types';

type Tab = 'messages' | 'waiting' | 'sent';

export function AutomationsPage() {
  const { messages } = useApp();
  const waiting = messages.filter((m) => m.status === 'awaiting_approval');
  const [tab, setTab] = useState<Tab>(waiting.length ? 'waiting' : 'messages');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Automations</h1>
          <p className="lede">Messages that go out on their own at the right moment. Switch each one on or off, change the wording and timing, and choose which ones wait for your OK.</p>
        </div>
      </div>
      <Tabs label="Automations" value={tab} onChange={setTab} tabs={[
        { id: 'messages', label: 'Messages' },
        { id: 'waiting', label: 'Waiting for you', badge: waiting.length || null },
        { id: 'sent', label: 'Sent and received' },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
        {tab === 'messages' && <Messages />}
        {tab === 'waiting' && <Waiting list={waiting} />}
        {tab === 'sent' && <Log />}
      </div>
    </div>
  );
}

/* ---------- The workflows ---------- */

function sampleEnquiry(s: CaptureSettings): EnquiryRecord {
  const appts = s.business.kind === 'appointments';
  const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(10, 0, 0, 0);
  const type = s.bookings.types.find((t) => t.name);
  const price = Number(String(type?.price || '').replace(/[^\d.]/g, '')) || (appts ? 65 : 240);
  return {
    id: 'sample', channel: 'call', name: appts ? 'George Hammond' : 'Jane Price', phone: '+447700900000', email: '', postcode: '', summary: '', transcript: '', recordingUrl: '',
    urgency: 'normal', kind: 'booking', reasons: [], status: 'booked', afterHours: false, notes: '', history: [], repliedAt: null,
    quoteAmount: appts ? null : 640, quotedAt: null, chasersSent: 0, bookedFor: d.toISOString(), bookedType: type?.name || '', bookedWith: (s.bookings.staff.split('\n')[0] || '').split(' ')[0],
    jobValue: price, invoiceDue: new Date().toISOString().slice(0, 10), paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: new Date().toISOString(), isTest: false,
  };
}

function Messages() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const save = async (next: CaptureSettings, message = 'Saved.') => {
    try { await api.saveSettings(next); setSettings(next); toast(message); }
    catch (e: any) { toast(e?.message || 'That didn’t save. Try again.'); throw e; }
  };
  const texting = settings.texting;
  return (
    <div className="stack gap-24">
      <section className="panel auto-status">
        <div className="auto-status-main">
          <span className={`status-dot ${texting.status === 'on' ? 'on' : ''}`} aria-hidden="true" />
          <div className="stack gap-4">
            <strong>{texting.status === 'on' ? `Texts send from ${fmtPhone(texting.number)}` : 'Texting isn’t switched on yet'}</strong>
            <span className="small muted">{texting.status === 'on'
              ? `${settings.business.kind === 'appointments' ? 'Clients' : 'Customers'} can reply to any text. Replies land on their enquiry and pause any chasers.`
              : 'Gainora sets up your texting number on your setup call. Until then, messages go by email where the customer gave one.'}</span>
          </div>
        </div>
        <details className="rules">
          <summary className="small">Rules that always apply</summary>
          <ul className="small muted">
            <li>Nothing between 8pm and 8am, except an instant reply to something the customer has just done.</li>
            <li>Chasers, payment reminders, review requests and rebook reminders stop as soon as the {settings.business.kind === 'appointments' ? 'client' : 'customer'} replies.</li>
            <li>Anyone who replies STOP gets no more texts.</li>
            <li>No more than {WEEKLY_CAP} automatic messages to one {settings.business.kind === 'appointments' ? 'client' : 'customer'} in a week, not counting booking confirmations and reminders.</li>
            <li>Review requests and rebook reminders always end with an opt-out line.</li>
            <li>Turning a message on doesn’t send it to people from before: it starts from now.</li>
          </ul>
        </details>
      </section>

      <OwnerAlerts save={save} />
      <EmailsCard />

      {WORKFLOWS.filter((w) => !w.only || w.only === settings.business.kind).map((w) => (
        <Fragment key={w.id}>
          <WorkflowCard def={w} save={save} />
          {w.id === 'booking' && settings.business.kind === 'appointments' && <><DepositCard /><SpaceCard /></>}
        </Fragment>
      ))}
    </div>
  );
}

function OwnerAlerts({ save }: { save: (s: CaptureSettings, m?: string) => Promise<void> }) {
  const { settings } = useApp();
  const [testing, setTesting] = useState(false);
  const toast = useToast();
  const OPTS = [{ v: 'emergencies', l: 'Emergencies only' }, { v: 'urgent', l: 'Emergencies and urgent calls' }, { v: 'off', l: 'Don’t text me' }] as const;
  const cur = OPTS.find((o) => o.v === settings.calls.alertText)!;
  return (
    <section className="panel wf-card">
      <div className="wf-head">
        <span className="wf-icon owner"><Icon name="alert" /></span>
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h2 className="subhead">Text me about urgent calls</h2>
          <p className="small muted">{settings.business.alertMobile ? `Sent to your mobile, ${fmtPhone(settings.business.alertMobile)}, the moment the call ends. Day or night.` : <>Add your mobile in <Link to="/settings">Settings</Link> to get these.</>}</p>
        </div>
      </div>
      <div className="wf-body">
        <Choices name="alerts" options={OPTS.map((o) => o.l)} value={cur.l} onChange={(l: string) => save({ ...settings, calls: { ...settings.calls, alertText: OPTS.find((o) => o.l === l)!.v } }).catch(() => {})} />
        {settings.business.alertMobile && settings.calls.alertText !== 'off' && (
          <Button kind="quiet" small icon="phone" busy={testing} onClick={async () => {
            setTesting(true);
            try { await api.testText(`EMERGENCY for ${settings.business.name}: this is a test alert.`); toast(api.mode === 'demo' ? 'In your app this texts your mobile.' : 'Test sent to your mobile.'); }
            catch (e: any) { toast(e?.message || 'Not sent.'); }
            finally { setTesting(false); }
          }}>Send me a test</Button>
        )}
      </div>
    </section>
  );
}

function Switch({ on, onChange, label, small }: { on: boolean; onChange: (v: boolean) => void; label: string; small?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${small ? 'small' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function WorkflowCard({ def, save }: { def: WorkflowDef; save: (s: CaptureSettings, m?: string) => Promise<void> }) {
  const { settings } = useApp();
  const kind = settings.business.kind;
  const saved = settings.automations[def.id]!;
  const [draft, setDraft] = useState<WorkflowSetting>(saved);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft.steps) !== JSON.stringify(saved.steps);
  const sample = useMemo(() => sampleEnquiry(settings), [settings]);

  const toggle = async (on: boolean) => {
    const next: WorkflowSetting = { ...saved, on, since: on ? new Date().toISOString() : saved.since };
    setDraft({ ...draft, on, since: next.since });
    await save({ ...settings, automations: { ...settings.automations, [def.id]: next } }, on ? `${def.title(kind)}: on from now.` : `${def.title(kind)}: off.`).catch(() => setDraft(draft));
  };
  const setStep = (id: string, patch: Partial<StepSetting>) => setDraft({ ...draft, steps: { ...draft.steps, [id]: { ...draft.steps[id as keyof typeof draft.steps]!, ...patch } } });
  const commit = async () => {
    setBusy(true);
    try { await save({ ...settings, automations: { ...settings.automations, [def.id]: { ...saved, steps: draft.steps } } }); }
    catch { /* toast shown */ }
    finally { setBusy(false); }
  };

  return (
    <section className={`panel wf-card ${saved.on ? 'is-on' : ''}`} aria-labelledby={`wf-${def.id}`}>
      <div className="wf-head">
        <span className="wf-icon"><Icon name={def.id === 'booking' ? 'calendar' : def.id === 'quote' ? 'pound' : def.id === 'payment' ? 'check' : def.id === 'review' ? 'star' : 'message'} /></span>
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h2 className="subhead" id={`wf-${def.id}`}>{def.title(kind)}</h2>
          <p className="small muted">{def.blurb(kind)}</p>
          <p className="xsmall faint">{def.steps.map((st) => `${st.title}${st.waits.length > 1 ? `: ${st.waits.find((w) => w.value === saved.steps[st.id]?.wait)?.label.toLowerCase() ?? ''}` : ''}${saved.steps[st.id]?.ask ? ' (asks you first)' : ''}`).join(' · ')}</p>
        </div>
        <div className="wf-controls">
          <Switch on={saved.on} label={`${def.title(kind)}: ${saved.on ? 'on' : 'off'}`} onChange={toggle} />
          <button className="btn btn-quiet btn-small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>
        </div>
      </div>
      {open && (
        <div className="wf-steps">
          {def.steps.map((st) => <StepEditor key={st.id} def={st} kind={kind} value={draft.steps[st.id]!} sample={sample} settings={settings} onChange={(p) => setStep(st.id, p)} />)}
          <div className="row gap-8 wrap" style={{ justifyContent: 'flex-end' }}>
            {dirty && <Button kind="secondary" small onClick={() => setDraft(saved)}>Undo changes</Button>}
            <Button small busy={busy} disabled={!dirty} onClick={commit}>Save</Button>
          </div>
        </div>
      )}
    </section>
  );
}

const FIELD_CHIPS: { f: string; trade: boolean; appts: boolean }[] = [
  { f: 'first name', trade: true, appts: true }, { f: 'business', trade: true, appts: true }, { f: 'owner', trade: true, appts: true },
  { f: 'day', trade: true, appts: true }, { f: 'date', trade: true, appts: true }, { f: 'time', trade: true, appts: true }, { f: 'when', trade: true, appts: true },
  { f: 'appointment', trade: false, appts: true }, { f: 'who', trade: false, appts: true }, { f: 'address', trade: false, appts: true },
  { f: 'arrival', trade: false, appts: true }, { f: 'cancellation', trade: false, appts: true },
  { f: 'amount', trade: true, appts: true }, { f: 'due', trade: true, appts: true }, { f: 'pay link', trade: true, appts: true }, { f: 'review link', trade: true, appts: true }, { f: 'phone', trade: true, appts: true },
];

function StepEditor({ def, kind, value, sample, settings, onChange }: { def: StepDef; kind: CaptureSettings['business']['kind']; value: StepSetting; sample: EnquiryRecord; settings: CaptureSettings; onChange: (p: Partial<StepSetting>) => void }) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const preview = render(value.text, fieldsFor(sample, settings), !!def.marketing);
  const insert = (f: string) => {
    const el = area.current; const tag = `{${f}}`;
    if (!el) return onChange({ text: `${value.text} ${tag}` });
    const a = el.selectionStart ?? value.text.length; const b = el.selectionEnd ?? a;
    onChange({ text: value.text.slice(0, a) + tag + value.text.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const CH: { v: MsgChannel; l: string }[] = [{ v: 'text', l: 'Text' }, { v: 'email', l: 'Email' }, { v: 'both', l: 'Both' }];
  return (
    <div className={`step-edit ${value.on ? '' : 'off'}`}>
      <div className="step-edit-head">
        <Switch small on={value.on} label={`${def.title}: ${value.on ? 'on' : 'off'}`} onChange={(on) => onChange({ on })} />
        <strong>{def.title}</strong>
        {def.waits.length > 1
          ? <label className="step-when"><span className="sr-only">When</span><select className="select select-inline" value={value.wait} onChange={(e: any) => onChange({ wait: Number(e.target.value) })}>{def.waits.map((w) => <option key={w.value} value={w.value}>{w.label}{def.id.startsWith('chase') ? ' after the quote' : def.id.startsWith('pay') ? (w.value === 0 ? '' : ' after it’s due') : def.id === 'review' ? ' after' : ''}</option>)}</select></label>
          : <span className="small faint">{def.waits[0].label}</span>}
      </div>
      <div className="step-edit-body">
        <div className="stack gap-8" style={{ minWidth: 0 }}>
          <div className="row gap-8 wrap">
            <div className="seg" role="group" aria-label="Send by">{CH.map((c) => <button key={c.v} className="seg-btn" aria-pressed={value.channel === c.v} onClick={() => onChange({ channel: c.v })}>{c.l}</button>)}</div>
            <label className="check-label"><input type="checkbox" checked={value.ask} onChange={(e: any) => onChange({ ask: e.target.checked })} />Ask me first</label>
          </div>
          {value.channel !== 'text' && <input className="input" aria-label={`${def.title} email subject`} value={value.subject} onChange={(e: any) => onChange({ subject: e.target.value })} />}
          <label className="sr-only" htmlFor={`t-${def.id}`}>{def.title} wording</label>
          <textarea id={`t-${def.id}`} ref={area} className="textarea" rows={4} value={value.text} onChange={(e: any) => onChange({ text: e.target.value })} />
          <div className="chips field-chips" aria-label="Add a detail">
            {FIELD_CHIPS.filter((c) => (kind === 'appointments' ? c.appts : c.trade)).map((c) => <button key={c.f} type="button" className="chip-btn" onClick={() => insert(c.f)}>{`{${c.f}}`}</button>)}
          </div>
          <p className="xsmall faint">Words in [square brackets] are left out when a detail inside them is missing.{' '}
            <button className="link-btn" style={{ padding: 0 }} onClick={() => onChange({ text: def.text(kind), subject: def.subject(kind) })}>Reset to our wording</button></p>
        </div>
        <div className="phone-preview" aria-label={`${def.title} preview`}>
          <span className="xsmall faint">Preview with sample details</span>
          <div className="sms">{preview}</div>
          <span className="xsmall faint">{preview.length} characters · {smsParts(preview)} {smsParts(preview) === 1 ? 'text' : 'texts'}</span>
          {def.id === 'confirm' && kind === 'appointments' && depositRule(settings.bookings) && (
            <span className="xsmall faint">{depositRule(settings.bookings)!.forWho === 'new' ? 'New clients' : 'Everyone'}{depositRule(settings.bookings)!.types.length ? ` booking ${depositRule(settings.bookings)!.types.join(', ')}` : ''} also get your deposit line with the payment link. Change it under Deposits, below.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Waiting for approval ---------- */

function Waiting({ list }: { list: MessageRecord[] }) {
  const { enquiries, reloadMessages, putMessage } = useApp();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (!list.length) return <div className="panel empty"><h2 className="heading">Nothing waiting</h2><p className="muted mt-8">Messages you’ve marked “Ask me first” wait here until you send or skip them.</p></div>;
  return (
    <div className="panel rows">
      {list.map((m) => {
        const e = enquiries?.find((x) => x.id === m.enquiryId);
        return (
          <article className="waiting-row" key={m.id}>
            <div className="split">
              <div className="stack gap-4"><strong>{stepTitle(m)}{e ? <>: <Link to={`/enquiries/${e.id}`}>{e.name || fmtPhone(e.phone)}</Link></> : ''}</strong><span className="xsmall faint">{m.channel === 'text' ? `Text to ${fmtPhone(m.to)}` : `Email to ${m.to}`} · ready {relative(m.createdAt)}</span></div>
            </div>
            <label className="sr-only" htmlFor={`w-${m.id}`}>Message</label>
            <textarea id={`w-${m.id}`} className="textarea" rows={3} value={edits[m.id] ?? m.body} onChange={(ev: any) => setEdits({ ...edits, [m.id]: ev.target.value })} />
            <div className="row gap-8">
              <Button small icon="send" busy={busy === m.id} onClick={async () => { setBusy(m.id); try { await api.approveMessage(m.id, edits[m.id]); await reloadMessages(); toast('Sent.'); } catch (err: any) { toast(err?.message || 'Not sent.'); } finally { setBusy(null); } }}>Send</Button>
              <Button small kind="quiet" onClick={async () => { await api.skipMessage(m.id); putMessage({ ...m, status: 'skipped' }); toast('Skipped.'); }}>Skip</Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ---------- Everything sent and received ---------- */

function Log() {
  const { messages, enquiries } = useApp();
  const [show, setShow] = useState<'all' | 'auto' | 'in' | 'failed'>('all');
  const list = messages.filter((m) => show === 'all' || (show === 'auto' ? m.automatic : show === 'in' ? m.direction === 'in' : m.status === 'failed')).slice(0, 150);
  const name = (m: MessageRecord) => { const e = enquiries?.find((x) => x.id === m.enquiryId); return m.audience === 'owner' ? 'You' : e?.name || fmtPhone(m.direction === 'in' ? m.from : m.to) || m.to; };
  return (
    <>
      <div className="seg mb-16" role="group" aria-label="Show">
        {([['all', 'Everything'], ['auto', 'Automatic'], ['in', 'Replies in'], ['failed', 'Not sent']] as const).map(([v, l]) => <button key={v} className="seg-btn" aria-pressed={show === v} onClick={() => setShow(v)}>{l}</button>)}
      </div>
      <div className="panel rows">
        {list.length === 0 && <div className="empty"><p className="muted">Nothing here yet.</p></div>}
        {list.map((m) => (
          <Link key={m.id} to={m.enquiryId ? `/enquiries/${m.enquiryId}` : '/automations'} className="log-row">
            <span className={`log-dir ${m.direction}`}><Icon name={m.direction === 'in' ? 'back' : m.channel === 'email' ? 'mail' : 'message'} /></span>
            <span className="stack" style={{ minWidth: 0 }}>
              <span className="small"><strong>{m.direction === 'in' ? `${name(m)} replied` : `${m.automatic ? stepTitle(m) : 'Your message'} to ${name(m)}`}</strong></span>
              <span className="xsmall muted enq-summary">{m.body}</span>
            </span>
            <span className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span className="xsmall faint" style={{ whiteSpace: 'nowrap' }}>{relative(m.createdAt)}</span>
              {m.direction === 'out' && <span className={`tag ${m.status === 'sent' ? 'tag-plain' : m.status === 'failed' ? 'tag-danger' : 'tag-brass'}`}>{m.status === 'sent' ? 'Sent' : m.status === 'failed' ? 'Not sent' : m.status === 'awaiting_approval' ? 'Waiting' : m.status === 'skipped' ? 'Skipped' : 'Sending'}</span>}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

