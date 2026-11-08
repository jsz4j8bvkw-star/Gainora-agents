import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { BASE } from '../app';
import { Button, Choices, Field, Icon, useToast } from '../components/ui';
import { DAYS, emptySettings, hoursText, lines, packFromSettings, TRADES } from '../../shared/capture';
import type { CaptureSettings, User } from '../lib/types';

/* ---------- The questions, shared by setup and Settings ---------- */

type Kind = 'text' | 'email' | 'url' | 'tel' | 'textarea' | 'select' | 'days' | 'hours' | 'choice' | 'number';
export interface Q {
  path: string; label: string; help?: string; kind: Kind; required?: boolean; wide?: boolean; placeholder?: string;
  options?: { value: any; label: string }[];
  showIf?: (s: CaptureSettings) => boolean;
}
export interface SetupSection { id: string; title: string; question: string; intro: string; fields: Q[] }

const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];

export const SETUP: SetupSection[] = [
  {
    id: 'business', title: 'Your business', question: 'Tell us about your business.',
    intro: 'Your receptionist answers in your business name, and these details go on every message Gainora drafts for you.',
    fields: [
      { path: 'business.name', label: 'Business name', kind: 'text', required: true, placeholder: 'Smith Plumbing & Heating' },
      { path: 'business.ownerName', label: 'Your first name', kind: 'text', required: true, help: 'Messages are signed with it.' },
      { path: 'business.trade', label: 'Your trade', kind: 'select', required: true, options: TRADES.map((t) => ({ value: t, label: t })) },
      { path: 'business.location', label: 'Where you’re based', kind: 'text', required: true, placeholder: 'Truro, Cornwall' },
      { path: 'business.phone', label: 'Your business phone number', kind: 'tel', required: true, help: 'The number customers ring now. You keep it: calls forward to the receptionist only when you can’t answer.' },
      { path: 'business.website', label: 'Website', kind: 'url', placeholder: 'https://', help: 'Optional.' },
      { path: 'business.alertEmail', label: 'Email for alerts', kind: 'email', required: true, help: 'Emergencies and your morning list of follow-ups go here.' },
      { path: 'business.alertMobile', label: 'Mobile for urgent calls', kind: 'tel', help: 'Optional. Your receptionist can pass emergencies to it.' },
    ],
  },
  {
    id: 'work', title: 'Your work', question: 'What do you do, and where?',
    intro: 'Your receptionist uses this to answer questions and to say no politely to work you don’t take on.',
    fields: [
      { path: 'work.services', label: 'Work you do', kind: 'textarea', required: true, wide: true, help: 'One per line.', placeholder: 'Boiler servicing and repairs\nBathroom fitting\nLeaks, taps and toilets' },
      { path: 'work.notDone', label: 'Work you don’t do', kind: 'textarea', wide: true, help: 'Optional. One per line.', placeholder: 'Drain unblocking' },
      { path: 'work.areas', label: 'Areas you cover', kind: 'text', required: true, wide: true, placeholder: 'Truro and 20 miles around' },
    ],
  },
  {
    id: 'calls', title: 'Your calls', question: 'How should calls be handled?',
    intro: 'Outside your hours, and whenever you can’t pick up, your receptionist takes the details. These answers shape what it says.',
    fields: [
      { path: 'calls.days', label: 'Days you work', kind: 'days', required: true, wide: true },
      { path: 'calls.hours', label: 'Your hours', kind: 'hours', wide: true, help: 'Enquiries outside these hours are marked “out of hours” so you can see what you’d otherwise have missed.' },
      { path: 'calls.emergencies', label: 'What counts as an emergency for you', kind: 'textarea', wide: true, help: 'One per line. Gas smells, floods and no heating for someone vulnerable are always flagged.', placeholder: 'Water leaking or a burst pipe\nNo heating or hot water for someone vulnerable' },
      { path: 'calls.transferTo', label: 'What to do with an emergency', kind: 'text', wide: true, placeholder: 'Text Dave on 07700 900111 and say it’s urgent' },
      { path: 'calls.quotePolicy', label: 'Can it talk about prices?', kind: 'choice', required: true, wide: true, options: [{ value: 'never', label: 'No, I quote every job myself' }, { value: 'ranges', label: 'Guide prices only' }, { value: 'fixed', label: 'Yes, I have fixed prices' }] },
      { path: 'calls.priceNotes', label: 'The prices it may give', kind: 'textarea', wide: true, required: true, placeholder: 'Boiler service from £85. Call-out and first hour £75.', showIf: (s) => s.calls.quotePolicy !== 'never' },
      { path: 'calls.booking', label: 'Booking', kind: 'choice', wide: true, options: [{ value: 'callback', label: 'Take details, I’ll call back to arrange' }, { value: 'calendar', label: 'Book straight into my calendar' }] },
      { path: 'calls.gasWork', label: 'Do you work on gas appliances?', kind: 'choice', options: YES_NO, help: 'If yes, gas smells get the National Gas Emergency script.' },
      { path: 'calls.recording', label: 'Record calls?', kind: 'choice', options: YES_NO, help: 'Callers are told at the start.' },
      { path: 'calls.notify', label: 'Email me about', kind: 'choice', wide: true, options: [{ value: 'urgent', label: 'Emergencies and urgent enquiries' }, { value: 'all', label: 'Every enquiry' }] },
    ],
  },
  {
    id: 'followUps', title: 'Follow-ups', question: 'How do you get paid and reviewed?',
    intro: 'Gainora drafts quote chasers, payment reminders and review requests. You read each one and send it yourself.',
    fields: [
      { path: 'followUps.paymentDays', label: 'Payment terms', kind: 'select', required: true, options: [{ value: 0, label: 'Due on completion' }, { value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }] },
      { path: 'followUps.payLink', label: 'Payment link', kind: 'url', placeholder: 'https://', help: 'Optional. From Stripe, SumUp, your accounts software or similar. Added to payment reminders.' },
      { path: 'followUps.reviewLink', label: 'Google review link', kind: 'url', wide: true, placeholder: 'https://g.page/r/…/review', help: 'Optional. In your Google Business Profile: “Ask for reviews”, then copy the link.' },
    ],
  },
];

export const getPath = (o: any, p: string) => p.split('.').reduce((a, k) => a?.[k], o);
export function setPath<T>(o: T, p: string, v: any): T {
  const copy: any = structuredClone(o);
  const ks = p.split('.'); let cur = copy;
  for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
  cur[ks[ks.length - 1]] = v;
  return copy;
}

export function sectionErrors(sec: SetupSection, s: CaptureSettings): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of sec.fields) {
    if (f.showIf && !f.showIf(s)) continue;
    const v = getPath(s, f.path);
    if (f.kind === 'days') { if (!s.calls.days.length) e[f.path] = 'Pick at least one day.'; continue; }
    if (f.kind === 'hours') { if (s.calls.open >= s.calls.close) e[f.path] = 'Closing time must be after opening time.'; continue; }
    const str = typeof v === 'string' ? v.trim() : v;
    if (f.required && (str === '' || str == null)) { e[f.path] = 'This is needed.'; continue; }
    if (str && f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) e[f.path] = 'Enter a full email address.';
    if (str && f.kind === 'url' && !/^https?:\/\/\S+\.\S+/.test(str)) e[f.path] = 'Enter the full address, starting https://';
    if (str && f.kind === 'tel' && String(str).replace(/\D/g, '').length < 10) e[f.path] = 'Enter the full number.';
  }
  return e;
}

export function QField({ f, s, onChange, error }: { f: Q; s: CaptureSettings; onChange: (path: string, v: any) => void; error?: string }) {
  if (f.showIf && !f.showIf(s)) return null;
  const v = getPath(s, f.path);
  const cls = f.wide ? 'wide' : '';
  if (f.kind === 'days') {
    return (
      <Field label={f.label} error={error} as="group" className={cls}>
        {(_, d) => <Choices name="days" multi options={DAYS} describedBy={d} value={s.calls.days.map((n) => DAYS[n - 1])}
          onChange={(arr: string[]) => onChange('calls.days', arr.map((x) => DAYS.indexOf(x) + 1).sort((a, b) => a - b))} />}
      </Field>
    );
  }
  if (f.kind === 'hours') {
    return (
      <Field label={f.label} help={f.help} error={error} as="group" className={cls}>
        {(id) => (
          <div className="row gap-12 wrap" style={{ alignItems: 'center' }}>
            <label className="sr-only" htmlFor={`${id}-o`}>Opening time</label>
            <input id={`${id}-o`} className="input time-input" type="time" value={s.calls.open} onChange={(e: any) => onChange('calls.open', e.target.value)} />
            <span className="muted">to</span>
            <label className="sr-only" htmlFor={`${id}-c`}>Closing time</label>
            <input id={`${id}-c`} className="input time-input" type="time" value={s.calls.close} onChange={(e: any) => onChange('calls.close', e.target.value)} />
            <span className="small faint">{hoursText(s.calls)}</span>
          </div>
        )}
      </Field>
    );
  }
  if (f.kind === 'choice') {
    const opts = f.options!;
    const cur = opts.find((o) => o.value === v)?.label ?? '';
    return (
      <Field label={f.label} help={f.help} error={error} as="group" className={cls}>
        {(_, d) => <Choices name={f.path} options={opts.map((o) => o.label)} value={cur} describedBy={d} onChange={(label: string) => onChange(f.path, opts.find((o) => o.label === label)!.value)} />}
      </Field>
    );
  }
  return (
    <Field label={f.label} help={f.help} error={error} className={cls}>
      {(id, d) => f.kind === 'textarea'
        ? <textarea id={id} className="textarea" value={v ?? ''} placeholder={f.placeholder} aria-describedby={d} aria-invalid={!!error} onChange={(e: any) => onChange(f.path, e.target.value)} />
        : f.kind === 'select'
          ? <select id={id} className="select" value={String(v ?? '')} aria-describedby={d} aria-invalid={!!error} onChange={(e: any) => { const o = f.options!.find((x) => String(x.value) === e.target.value); onChange(f.path, o ? o.value : e.target.value); }}>
              {typeof v === 'string' && !v && <option value="">Choose…</option>}
              {f.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
            </select>
          : <input id={id} className="input" type={f.kind === 'number' ? 'number' : f.kind} value={v ?? ''} placeholder={f.placeholder} aria-describedby={d} aria-invalid={!!error}
              autoComplete={f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : undefined} onChange={(e: any) => onChange(f.path, e.target.value)} />}
    </Field>
  );
}

export function display(f: Q, s: CaptureSettings): string {
  if (f.showIf && !f.showIf(s)) return '';
  if (f.kind === 'days' || f.kind === 'hours') return f.kind === 'hours' ? hoursText(s.calls) : s.calls.days.map((d) => DAYS[d - 1]).join(', ');
  const v = getPath(s, f.path);
  if (f.options) return f.options.find((o) => o.value === v)?.label ?? '–';
  if (f.kind === 'textarea') return lines(v).join(' · ') || '–';
  return String(v ?? '').trim() || '–';
}

/* ---------- The first-run setup ---------- */

export function Setup({ user, initial, onDone }: { user: User; initial: CaptureSettings | null; onDone: (s: CaptureSettings) => void }) {
  const [s, setS] = useState<CaptureSettings>(() => initial ?? emptySettings(user.email));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [finishing, setFinishing] = useState(false);
  const head = useRef<HTMLHeadingElement | null>(null);
  const timer = useRef<any>(null);
  const toast = useToast();
  const LAST = SETUP.length + 1;

  useEffect(() => { head.current?.focus(); window.scrollTo({ top: 0 }); }, [step]);
  const change = (path: string, v: any) => {
    const next = setPath(s, path, v);
    setS(next); setSaved('saving');
    if (errors[path]) setErrors((e) => { const x = { ...e }; delete x[path]; return x; });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api.saveSettings(next).then(() => setSaved('saved')).catch(() => setSaved('idle')), 700);
  };
  const next = () => {
    if (step >= 1 && step <= SETUP.length) {
      const e = sectionErrors(SETUP[step - 1], s);
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setStep(step + 1);
  };
  const finish = async () => {
    setFinishing(true);
    try {
      const done = { ...s, completedAt: new Date().toISOString() };
      await api.saveSettings(done);
      onDone(done);
    } catch (e: any) { toast(e?.message || 'We couldn’t save your answers. Try again.'); setFinishing(false); }
  };
  const sec = step >= 1 && step <= SETUP.length ? SETUP[step - 1] : null;

  if (step === 0) {
    return (
      <div className="welcome">
        <div className="welcome-top"><img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" /><span className="welcome-product">Capture &amp; Convert</span></div>
        <main className="welcome-main step-in">
          <div className="welcome-copy">
            <h1 className="display" tabIndex={-1} ref={head}>Let’s set up your receptionist.</h1>
            <p className="welcome-lede">Four short sections, about ten minutes. From your answers Gainora writes the script your AI receptionist follows, and sets up your enquiries inbox and follow-ups.</p>
            <ol className="welcome-steps">
              {SETUP.map((x, i) => <li key={x.id}><span className="num">{i + 1}</span><span><strong>{x.title}</strong><span className="small muted">{x.intro}</span></span></li>)}
            </ol>
            <div className="row gap-12 wrap mt-24">
              <Button onClick={() => setStep(1)}>Start</Button>
              <span className="small faint">Your answers save as you go.</span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ob">
      <aside className="ob-side">
        <img src={`${BASE}gainora-logo-reverse.svg`} alt="Gainora" />
        <ol className="ob-steps" aria-label="Setup steps">
          {SETUP.map((x, i) => {
            const n = i + 1;
            const done = step > n && !Object.keys(sectionErrors(x, s)).length;
            return (
              <li key={x.id} className={done ? 'done' : ''}>
                <button type="button" disabled={n > step && SETUP.slice(0, n - 1).some((y) => Object.keys(sectionErrors(y, s)).length)} aria-current={step === n ? 'step' : undefined} onClick={() => { setErrors({}); setStep(n); }}>
                  <span className="num">{done && <Icon name="check" />}</span>{x.title}
                </button>
              </li>
            );
          })}
          <li><button type="button" disabled={SETUP.some((y) => Object.keys(sectionErrors(y, s)).length)} aria-current={step === LAST ? 'step' : undefined} onClick={() => setStep(LAST)}><span className="num" />Your script</button></li>
        </ol>
        <p className="ob-note">Only you and the Gainora team setting up your receptionist can see these answers.</p>
      </aside>
      <div className="ob-progress" aria-hidden="true"><span style={{ width: `${Math.round((step / LAST) * 100)}%` }} /></div>
      <main className="ob-main">
        <div className="ob-inner step-in" key={step}>
          {sec && (
            <>
              <div className="ob-count">Step {step} of {SETUP.length}: {sec.title}</div>
              <h1 className="title ob-q" tabIndex={-1} ref={head}>{sec.question}</h1>
              <p className="ob-intro">{sec.intro}</p>
              {Object.keys(errors).length > 0 && <div className="err mt-24" role="alert">A few answers need attention before you continue.</div>}
              <div className="ob-fields">
                {sec.fields.map((f) => <QField key={f.path} f={f} s={s} onChange={change} error={errors[f.path]} />)}
              </div>
              <div className="ob-foot">
                <Button kind="secondary" icon="back" onClick={() => { setErrors({}); setStep(step - 1); }}>Back</Button>
                <span className="ob-saved" aria-live="polite">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'All changes saved' : ''}</span>
                <Button onClick={next}>{step === SETUP.length ? 'See your script' : 'Continue'}</Button>
              </div>
            </>
          )}
          {step === LAST && (
            <>
              <div className="ob-count">Last step</div>
              <h1 className="title ob-q" tabIndex={-1} ref={head}>Here’s how your receptionist will answer.</h1>
              <p className="ob-intro">This is written from your answers. You can change anything later in Settings, and we go through it together on your setup call.</p>
              <ScriptPreview s={s} />
              <div className="ob-foot">
                <Button kind="secondary" icon="back" onClick={() => setStep(SETUP.length)}>Back</Button>
                <Button busy={finishing} onClick={finish}>Finish setup</Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** The opening line and the first few rules, as the caller would hear them. */
export function ScriptPreview({ s, full = false }: { s: CaptureSettings; full?: boolean }) {
  const pack = packFromSettings(s);
  const sections = full ? pack.sections : pack.sections.filter((x) => ['What we do', 'Emergencies', 'Prices'].includes(x.title));
  return (
    <div className="script mt-24">
      <div className="script-greeting">
        <span className="label">Opening line</span>
        <p className="voice">“{pack.greeting}”</p>
      </div>
      <div className="script-body">
        {sections.filter((x) => x.title !== 'Opening line').map((x) => (
          <section key={x.title}>
            <h3 className="subhead">{x.title}</h3>
            <ul>{x.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}
