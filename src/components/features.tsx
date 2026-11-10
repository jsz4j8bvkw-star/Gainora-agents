// The owner's switches for the features on top of the receptionist and inbox: deposits, Fill the space,
// returning callers and their own emails. Each card: a switch, a one-line summary, and an Edit panel with
// every choice and a live preview of the wording. Nothing changes until they press Save.
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Choices, Field, Icon } from './ui';
import { useToast } from './ui';
import {
  DAYS, DEPOSIT_WORDING_ALL, DEPOSIT_WORDING_NEW, depositRule, featuresOf, SPACE_DUEBACK_WORDING, SPACE_WORDING,
  type Bookings, type Features,
} from '../../shared/capture';
import { render, smsParts } from '../../shared/automations';
import type { CaptureSettings } from '../lib/types';

const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}><span /></button>;
}

function useSave() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  return async (next: CaptureSettings, message = 'Saved.') => {
    try { await api.saveSettings(next); setSettings(next); toast(message); }
    catch (e: any) { toast(e?.message || 'That didn’t save. Try again.'); throw e; }
    return settings;
  };
}

/** A card in the house style: icon, title, what it does, a summary of the current choices, the switch, and Edit. */
function Card(props: { id: string; icon: string; title: string; blurb: string; summary: string; on: boolean; onToggle: (on: boolean) => void; children: (close: () => void) => any }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`panel wf-card ${props.on ? 'is-on' : ''}`} aria-labelledby={`ft-${props.id}`}>
      <div className="wf-head">
        <span className="wf-icon"><Icon name={props.icon} /></span>
        <div className="stack gap-4" style={{ minWidth: 0 }}>
          <h2 className="subhead" id={`ft-${props.id}`}>{props.title}</h2>
          <p className="small muted">{props.blurb}</p>
          <p className="xsmall faint">{props.summary}</p>
        </div>
        <div className="wf-controls">
          <Toggle on={props.on} label={`${props.title}: ${props.on ? 'on' : 'off'}`} onChange={props.onToggle} />
          <button className="btn btn-quiet btn-small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>
        </div>
      </div>
      {open && <div className="wf-steps feature-body">{props.children(() => setOpen(false))}</div>}
    </section>
  );
}

/** Wording with insertable details and a phone-style preview. */
function Wording({ id, label, value, fields, preview, onChange, onReset, help }: { id: string; label: string; value: string; fields: string[]; preview: string; onChange: (v: string) => void; onReset: () => void; help?: string }) {
  const insert = (f: string) => onChange(`${value}${value.endsWith(' ') || !value ? '' : ' '}{${f}}`);
  return (
    <div className="step-edit-body feature-wording">
      <div className="stack gap-8" style={{ minWidth: 0 }}>
        <label className="field-label" htmlFor={id}>{label}</label>
        <textarea id={id} className="textarea" rows={4} value={value} onChange={(e: any) => onChange(e.target.value)} />
        <div className="chips field-chips" aria-label="Add a detail">{fields.map((f) => <button key={f} type="button" className="chip-btn" onClick={() => insert(f)}>{`{${f}}`}</button>)}</div>
        <p className="xsmall faint">{help ?? 'Words in [square brackets] are left out when a detail inside them is missing.'} <button className="link-btn" style={{ padding: 0 }} onClick={onReset}>Reset to our wording</button></p>
      </div>
      <div className="phone-preview" aria-label={`${label} preview`}>
        <span className="xsmall faint">Preview with sample details</span>
        <div className="sms">{preview}</div>
        <span className="xsmall faint">{preview.length} characters · {smsParts(preview)} {smsParts(preview) === 1 ? 'text' : 'texts'}</span>
      </div>
    </div>
  );
}

function SaveRow({ dirty, busy, onUndo, onSave }: { dirty: boolean; busy: boolean; onUndo: () => void; onSave: () => void }) {
  return (
    <div className="row gap-8 wrap" style={{ justifyContent: 'flex-end' }}>
      {dirty && <Button kind="secondary" small onClick={onUndo}>Undo changes</Button>}
      <Button small busy={busy} disabled={!dirty} onClick={onSave}>Save</Button>
    </div>
  );
}

/* ---------- Deposits ---------- */

type DepositDraft = Required<Pick<Bookings, 'deposit' | 'depositLink' | 'depositOn' | 'depositFor' | 'depositTypes' | 'depositWording'>>;
const depositDraft = (b: Bookings): DepositDraft => ({
  deposit: b.deposit ?? '', depositLink: b.depositLink ?? '', depositOn: b.depositOn ?? !!(b.deposit && b.depositLink),
  depositFor: b.depositFor ?? 'new', depositTypes: b.depositTypes ?? [], depositWording: b.depositWording ?? '',
});

export function DepositCard() {
  const { settings } = useApp();
  const save = useSave();
  const saved = depositDraft(settings.bookings);
  const [d, setD] = useState<DepositDraft>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const names = settings.bookings.types.map((t) => t.name).filter(Boolean);
  const linkOk = /^https:\/\/\S+\.\S+/.test(d.depositLink.trim());
  const wording = d.depositWording || (d.depositFor === 'all' ? DEPOSIT_WORDING_ALL : DEPOSIT_WORDING_NEW);
  const sampleType = (d.depositTypes[0] || names[0] || '').toLowerCase();
  const preview = render(wording, { 'first name': 'George', business: settings.business.name, appointment: sampleType, deposit: d.deposit || '£30', 'deposit link': d.depositLink || 'https://your-payment-link' });
  const live = depositRule({ ...settings.bookings, ...saved });
  const summary = live
    ? `${live.what} · ${live.forWho === 'new' ? 'new clients only' : 'every booking'} · ${live.types.length ? live.types.join(', ') : 'every treatment'}`
    : saved.depositOn && !(saved.deposit && /^https:\/\//.test(saved.depositLink)) ? 'Add the amount and your payment link to switch it on.' : 'Off. Nobody is asked for a deposit.';

  const persist = async (next: DepositDraft, message?: string) => {
    setBusy(true);
    try { await save({ ...settings, bookings: { ...settings.bookings, ...next } }, message); }
    catch { /* toast shown */ }
    finally { setBusy(false); }
  };
  const toggle = async (on: boolean) => {
    if (on && !(saved.deposit && /^https:\/\//.test(saved.depositLink))) { setD({ ...d, depositOn: true }); return; }
    setD({ ...d, depositOn: on });
    await persist({ ...saved, depositOn: on }, on ? 'Deposits on.' : 'Deposits off.');
  };

  return (
    <Card id="deposit" icon="pound" title="Deposits" on={!!live} onToggle={toggle} summary={summary}
      blurb="Ask for a deposit to secure a booking. Your receptionist mentions it when she books, and the confirmation text carries your payment link. Gainora never takes payments.">
      {() => (
        <div className="stack gap-16">
          <div className="form-grid">
            <Field label="Ask for a deposit" as="group" className="wide">{(_, desc) => <Choices name="dep-on" options={['Yes', 'No']} value={d.depositOn ? 'Yes' : 'No'} describedBy={desc} onChange={(v: string) => setD({ ...d, depositOn: v === 'Yes' })} />}</Field>
            <Field label="Amount, and how it works" help="In your words, for example “£30, taken off the treatment price”.">{(id, desc) => <input id={id} className="input" value={d.deposit} aria-describedby={desc} placeholder="£30, taken off the treatment price" onChange={(e: any) => setD({ ...d, deposit: e.target.value })} />}</Field>
            <Field label="Your payment link" help="From Stripe, SumUp, Fresha or similar." error={d.depositLink && !linkOk ? 'Use the secure link, starting https://' : undefined}>{(id, desc) => <input id={id} className="input" type="url" value={d.depositLink} aria-describedby={desc} placeholder="https://" onChange={(e: any) => setD({ ...d, depositLink: e.target.value })} />}</Field>
            <Field label="Who pays one" as="group" className="wide">{(_, desc) => <Choices name="dep-for" options={['New clients only', 'Every booking']} value={d.depositFor === 'all' ? 'Every booking' : 'New clients only'} describedBy={desc} onChange={(v: string) => setD({ ...d, depositFor: v === 'Every booking' ? 'all' : 'new' })} />}</Field>
            {names.length > 0 && <Field label="For which treatments" as="group" className="wide" help="Choose none for every treatment.">{(_, desc) => <Choices name="dep-types" multi options={names} value={d.depositTypes} describedBy={desc} onChange={(v: string[]) => setD({ ...d, depositTypes: v })} />}</Field>}
          </div>
          <Wording id="dep-wording" label="The line added to the booking confirmation" value={wording} preview={preview}
            fields={['first name', 'deposit', 'deposit link', 'appointment', 'business']}
            onChange={(v) => setD({ ...d, depositWording: v })} onReset={() => setD({ ...d, depositWording: '' })} />
          {d.depositOn && (!d.deposit.trim() || !linkOk) && <p className="small muted"><Icon name="info" className="inline-icon" />Deposits stay off until there’s an amount and a secure payment link.</p>}
          <SaveRow dirty={dirty} busy={busy} onUndo={() => setD(saved)} onSave={() => persist(d)} />
        </div>
      )}
    </Card>
  );
}

/* ---------- Fill the space ---------- */

export function SpaceCard() {
  const { settings } = useApp();
  const save = useSave();
  const saved = featuresOf(settings).spaces;
  const [d, setD] = useState<Features['spaces']>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const sample = useMemo(() => {
    const t = settings.bookings.types.find((x) => x.name);
    const who = (settings.bookings.staff.split('\n')[0] || '').trim().split(' ')[0];
    return { 'first name': 'Ellie', business: settings.business.name, owner: settings.business.ownerName.split(' ')[0], day: 'Thursday', date: '12 November', time: '2pm', who, treatment: (t?.name || 'appointment').toLowerCase() };
  }, [settings]);
  const persist = async (next: Features['spaces'], message?: string) => {
    setBusy(true);
    try { await save({ ...settings, features: { ...featuresOf(settings), spaces: next } }, message); }
    catch { /* toast shown */ }
    finally { setBusy(false); }
  };
  const FIELDS = ['first name', 'business', 'day', 'date', 'time', 'who', 'treatment', 'owner'];
  return (
    <Card id="spaces" icon="calendar" title="When an appointment is cancelled" on={saved.on}
      onToggle={(on) => { setD({ ...d, on }); persist({ ...saved, on }, on ? 'Fill the space: on.' : 'Fill the space: off.').catch(() => {}); }}
      summary={`Up to ${saved.aheadDays} days ahead · ${[saved.waiting && 'people waiting to book', saved.dueBack && 'clients due back'].filter(Boolean).join(' and ') || 'nobody chosen'} · you send each text`}
      blurb="A cancellation becomes a space you can fill. Gainora lists who could take it, each with a text ready. Nothing is sent until you send it.">
      {() => (
        <div className="stack gap-16">
          <div className="form-grid">
            <Field label="Who to offer it to" as="group" className="wide">{(_, desc) => <Choices name="sp-who" multi options={['People waiting to book', 'Clients due back']} value={[d.waiting && 'People waiting to book', d.dueBack && 'Clients due back'].filter(Boolean) as string[]} describedBy={desc} onChange={(v: string[]) => setD({ ...d, waiting: v.includes('People waiting to book'), dueBack: v.includes('Clients due back') })} />}</Field>
            <Field label="Show spaces up to" help="Cancellations further ahead usually fill themselves.">{(id, desc) => (
              <select id={id} className="select" value={d.aheadDays} aria-describedby={desc} onChange={(e: any) => setD({ ...d, aheadDays: Number(e.target.value) })}>
                {[3, 7, 14, 21, 28].map((n) => <option key={n} value={n}>{n} days ahead</option>)}
              </select>
            )}</Field>
          </div>
          {d.waiting && <Wording id="sp-w" label="Text to someone waiting to book" value={d.wording} fields={FIELDS} preview={render(d.wording, sample)} onChange={(v) => setD({ ...d, wording: v })} onReset={() => setD({ ...d, wording: SPACE_WORDING })} />}
          {d.dueBack && <Wording id="sp-d" label="Text to a client who is due back" value={d.dueBackWording} fields={FIELDS} preview={render(d.dueBackWording, sample, true)} onChange={(v) => setD({ ...d, dueBackWording: v })} onReset={() => setD({ ...d, dueBackWording: SPACE_DUEBACK_WORDING })} help="This one always ends with the opt-out line, because it goes to past clients. Words in [square brackets] are left out when a detail is missing." />}
          <SaveRow dirty={dirty} busy={busy} onUndo={() => setD(saved)} onSave={() => persist(d)} />
        </div>
      )}
    </Card>
  );
}

/* ---------- The owner's emails ---------- */

export function EmailsCard() {
  const { settings } = useApp();
  const save = useSave();
  const saved = featuresOf(settings).emails;
  const [d, setD] = useState<Features['emails']>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const any = saved.daily || saved.weekly || saved.monthly;
  const to = settings.business.alertEmail;
  const OPTS = ['Morning list', 'Weekly summary', 'Monthly report'];
  const persist = async (next: Features['emails'], message?: string) => {
    setBusy(true);
    try { await save({ ...settings, features: { ...featuresOf(settings), emails: next } }, message); }
    catch { /* toast shown */ }
    finally { setBusy(false); }
  };
  return (
    <Card id="emails" icon="mail" title="Emails to you" on={any}
      onToggle={(on) => { const next = { ...saved, daily: on, weekly: on, monthly: on }; setD(next); persist(next, on ? 'Your emails are on.' : 'Your emails are off.').catch(() => {}); }}
      summary={any ? [saved.daily && 'morning list when something needs you', saved.weekly && `weekly summary on ${DAYS_LONG[saved.weeklyDay - 1]}s`, saved.monthly && 'monthly report on the 1st'].filter(Boolean).join(' · ') : 'Off. Urgent alerts still reach you.'}
      blurb={`Sent to ${to || 'your alert email'}. The morning list only comes when something needs you. Urgent alerts are separate and always on.`}>
      {() => (
        <div className="stack gap-16">
          <div className="form-grid">
            <Field label="Which emails" as="group" className="wide">{(_, desc) => <Choices name="em" multi options={OPTS} value={[d.daily && OPTS[0], d.weekly && OPTS[1], d.monthly && OPTS[2]].filter(Boolean) as string[]} describedBy={desc} onChange={(v: string[]) => setD({ ...d, daily: v.includes(OPTS[0]), weekly: v.includes(OPTS[1]), monthly: v.includes(OPTS[2]) })} />}</Field>
            {d.weekly && <Field label="Weekly summary on" help="What the last seven days brought in at your prices, what’s still open, and the week ahead.">{(id, desc) => (
              <select id={id} className="select" value={d.weeklyDay} aria-describedby={desc} onChange={(e: any) => setD({ ...d, weeklyDay: Number(e.target.value) })}>
                {DAYS.map((x, i) => <option key={x} value={i + 1}>{DAYS_LONG[i]} morning</option>)}
              </select>
            )}</Field>}
          </div>
          <SaveRow dirty={dirty} busy={busy} onUndo={() => setD(saved)} onSave={() => persist(d)} />
        </div>
      )}
    </Card>
  );
}

/* ---------- Returning callers ---------- */

export function CallersCard() {
  const { settings } = useApp();
  const save = useSave();
  const saved = featuresOf(settings).callers;
  const [d, setD] = useState<Features['callers']>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const appts = settings.business.kind === 'appointments';
  const OPTS = [appts ? 'Their last visit and who did it' : 'Their last job', 'Their next booking', 'An enquiry still waiting for a reply'];
  const persist = async (next: Features['callers'], message?: string) => {
    setBusy(true);
    try { await save({ ...settings, features: { ...featuresOf(settings), callers: next } }, message); }
    catch { /* toast shown */ }
    finally { setBusy(false); }
  };
  return (
    <Card id="callers" icon="phone" title="Returning callers" on={saved.on}
      onToggle={(on) => { setD({ ...d, on }); persist({ ...saved, on }, on ? 'Returning callers: on.' : 'Returning callers: off.').catch(() => {}); }}
      summary={saved.on ? `She’s told their first name${[saved.lastVisit && (appts ? ', last visit' : ', last job'), saved.bookings && ', next booking', saved.waiting && ', any enquiry waiting'].filter(Boolean).join('')}` : 'Off. Every caller is treated as someone new.'}
      blurb={`When a number she knows rings, your receptionist is told who it might be, so ${appts ? 'regulars' : 'repeat customers'} don’t have to explain themselves. She keeps it to herself until the caller gives a name that matches. Never notes, prices or anything medical.`}>
      {() => (
        <div className="stack gap-16">
          <Field label="Besides their first name, she may use" as="group" className="wide">{(_, desc) => <Choices name="cl" multi options={OPTS} value={[d.lastVisit && OPTS[0], d.bookings && OPTS[1], d.waiting && OPTS[2]].filter(Boolean) as string[]} describedBy={desc} onChange={(v: string[]) => setD({ ...d, lastVisit: v.includes(OPTS[0]), bookings: v.includes(OPTS[1]), waiting: v.includes(OPTS[2]) })} />}</Field>
          <p className="xsmall faint">Changes apply to the next call. Gainora sets up the caller lookup on your phone line on your setup call.</p>
          <SaveRow dirty={dirty} busy={busy} onUndo={() => setD(saved)} onSave={() => persist(d)} />
        </div>
      )}
    </Card>
  );
}
