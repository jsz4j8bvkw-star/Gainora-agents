import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { BASE } from '../app';
import { Button, Choices, Field, Icon, useToast } from '../components/ui';
import { bookingSystemsFor, CLINICS, DAYS, DEFAULT_BEAUTY_SAFETY, DEFAULT_SAFETY, emptySettings, greetingFor, hoursText, isBeauty, lines, packFromSettings, TRADES } from '../../shared/capture';
import type { CaptureSettings, User } from '../lib/types';
import type { AppointmentType } from '../../shared/capture';
import { defaultAutomations } from '../../shared/automations';

/* ---------- The questions, shared by setup and Settings ---------- */

type Kind = 'text' | 'email' | 'url' | 'tel' | 'textarea' | 'select' | 'days' | 'hours' | 'choice' | 'number' | 'types' | 'greeting';
export interface Q {
  path: string; label: string; help?: string; kind: Kind; required?: boolean; wide?: boolean; placeholder?: string;
  options?: { value: any; label: string }[];
  /** Options that depend on earlier answers, e.g. booking systems for the business type. */
  optionsFor?: (s: CaptureSettings) => { value: any; label: string }[];
  showIf?: (s: CaptureSettings) => boolean;
}
export interface SetupSection { id: string; title: string; question: string; intro: string; fields: Q[] }

const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];
const isAppts = (s: CaptureSettings) => s.business.kind === 'appointments';
const isTrade = (s: CaptureSettings) => !isAppts(s);
const isBeautyS = (s: CaptureSettings) => isBeauty(s.business);
const isMedical = (s: CaptureSettings) => isAppts(s) && !isBeautyS(s);

export const SETUP: SetupSection[] = [
  {
    id: 'business', title: 'Your business', question: 'Tell us about your business.',
    intro: 'Your receptionist answers in your business name, and these details go on every message sent for you.',
    fields: [
      { path: 'business.kind', label: 'What kind of business is it?', kind: 'choice', required: true, wide: true, options: [{ value: 'trade', label: 'A trade or home service: we quote and visit' }, { value: 'appointments', label: 'Appointments: a clinic, salon or studio, including beauty and aesthetics' }] },
      { path: 'business.name', label: 'Business name', kind: 'text', required: true, placeholder: 'Lemon Street Physio' },
      { path: 'business.ownerName', label: 'Your first name', kind: 'text', required: true, help: 'Messages are signed with it.' },
      { path: 'business.trade', label: 'Your trade', kind: 'select', required: true, options: TRADES.map((t) => ({ value: t, label: t })), showIf: isTrade },
      { path: 'business.trade', label: 'Your type of business', kind: 'select', required: true, options: CLINICS.map((t) => ({ value: t, label: t })), showIf: isAppts },
      { path: 'business.location', label: 'Town or area', kind: 'text', required: true, placeholder: 'Truro, Cornwall' },
      { path: 'business.phone', label: 'Your business phone number', kind: 'tel', required: true, help: 'The number customers ring now. You keep it.' },
      { path: 'business.website', label: 'Website', kind: 'url', placeholder: 'https://', help: 'Optional.' },
      { path: 'business.alertEmail', label: 'Email for alerts', kind: 'email', required: true, help: 'Urgent calls and your morning list go here.' },
      { path: 'business.alertMobile', label: 'Mobile for urgent calls', kind: 'tel', help: 'Optional. Urgent calls can be passed to it.' },
    ],
  },
  {
    id: 'work', title: 'Your work', question: 'What do you offer?',
    intro: 'Your receptionist uses this to answer questions, and to say no politely to things you don’t do.',
    fields: [
      { path: 'work.services', label: 'What you do', kind: 'textarea', required: true, wide: true, help: 'One per line.', placeholder: 'Back and neck pain\nSports injuries\nSports massage' },
      { path: 'work.notDone', label: 'What you don’t do', kind: 'textarea', wide: true, help: 'Optional. One per line.', placeholder: 'Home visits' },
      { path: 'work.areas', label: 'Areas you cover', kind: 'text', required: true, wide: true, placeholder: 'Truro and 20 miles around', showIf: isTrade },
    ],
  },
  {
    id: 'bookings', title: 'Bookings', question: 'How do you take bookings?',
    intro: 'Tell us where your diary lives and what people can book. We connect it with you on your setup call, so your receptionist books into the same diary you already use.',
    fields: [
      { path: 'bookings.system', label: 'Your booking system or calendar', kind: 'select', required: true, wide: true, help: 'The one you use today. If it isn’t listed, choose “Something else” and tell us its name.', optionsFor: (s) => bookingSystemsFor(s.business).map((x) => ({ value: x, label: x })) },
      { path: 'bookings.systemOther', label: 'Which one?', kind: 'text', required: true, showIf: (s) => s.bookings.system === 'Something else' },
      { path: 'bookings.account', label: 'The account or calendar to book into', kind: 'text', wide: true, placeholder: 'bookings@lemonstreetphysio.co.uk', help: 'Optional. For example the Google account’s email, or your business name in Fresha, Phorest or Cliniko.', showIf: (s) => !!s.bookings.system && !/paper/i.test(s.bookings.system) },
      { path: 'bookings.mode', label: 'When someone wants to book, your receptionist should', kind: 'choice', required: true, wide: true, options: [{ value: 'book', label: 'Book them straight in' }, { value: 'offer', label: 'Offer times, I confirm' }, { value: 'callback', label: 'Take details, I call back' }] },
      { path: 'bookings.types', label: 'What people can book', kind: 'types', wide: true, help: 'Name, length, price and who does it. Leave the price blank to keep it private. “Due back” is how many weeks until a client usually needs this again: it times the rebook reminder and your “due back” list.' },
      { path: 'bookings.staff', label: 'Who takes bookings', kind: 'textarea', wide: true, help: 'Optional. One name per line.', placeholder: 'Sarah Bennett\nJames Hooper' },
      { path: 'bookings.address', label: 'Where appointments happen', kind: 'text', required: true, wide: true, placeholder: '12 Lemon Street, Truro TR1 2LS', showIf: isAppts },
      { path: 'bookings.arrival', label: 'What to tell people when they book', kind: 'textarea', wide: true, placeholder: 'Please wear loose clothing and arrive 5 minutes early. Free parking behind the clinic.', showIf: isAppts },
      { path: 'bookings.noticeHours', label: 'Shortest notice for a booking', kind: 'select', options: [0, 1, 2, 4, 24, 48].map((h) => ({ value: h, label: h === 0 ? 'Any time' : h < 24 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h / 24} ${h === 24 ? 'day' : 'days'}` })), showIf: (s) => s.bookings.mode !== 'callback' },
      { path: 'bookings.aheadWeeks', label: 'How far ahead people can book', kind: 'select', options: [1, 2, 4, 6, 8, 12].map((w) => ({ value: w, label: `${w} ${w === 1 ? 'week' : 'weeks'}` })), showIf: (s) => s.bookings.mode !== 'callback' },
      { path: 'bookings.cancellation', label: 'Cancellation policy', kind: 'text', wide: true, placeholder: 'Please give 24 hours’ notice to cancel or move an appointment.', help: 'Optional. Mentioned when booking and in the confirmation text.' },
    ],
  },
  {
    id: 'calls', title: 'Your calls', question: 'How should calls be answered?',
    intro: 'Your receptionist sounds like an experienced member of your team. These answers shape what it says.',
    fields: [
      { path: 'calls.greeting', label: 'How it answers the phone', kind: 'greeting', wide: true, help: '{greeting} becomes good morning, afternoon or evening. {business} is your business name.' },
      { path: 'calls.announceAi', label: 'Say it’s an AI assistant in the greeting?', kind: 'choice', options: [{ value: false, label: 'No' }, { value: true, label: 'Yes' }], help: 'Either way it never claims to be a person, and tells the truth if someone asks.' },
      { path: 'calls.recording', label: 'Record calls?', kind: 'choice', options: YES_NO, help: 'If yes, the greeting says so.' },
      { path: 'calls.days', label: 'Days you’re open', kind: 'days', required: true, wide: true },
      { path: 'calls.hours', label: 'Your hours', kind: 'hours', wide: true, help: 'Enquiries outside these hours are marked “out of hours”, so you can see what you’d otherwise have missed.' },
      { path: 'calls.safety', label: 'When it must not book, and should send people for urgent help', kind: 'textarea', wide: true, help: 'One per line. Agree this with your lead clinician. Callers are told to call 999, go to A&E or call NHS 111.', showIf: isMedical },
      { path: 'calls.safety', label: 'Concerns after a treatment that must come straight to the clinic', kind: 'textarea', wide: true, help: 'One per line. Your receptionist won’t book; it gives the caller your emergency line or puts them through, and texts you at once. It never sends callers to 999 or any other service.', showIf: isBeautyS },
      { path: 'calls.emergencyLine', label: 'Your clinic’s emergency line', kind: 'tel', required: true, help: 'The number for a reaction or urgent concern after a treatment. Callers are given it, or put through to it.', showIf: isBeautyS },
      { path: 'calls.transferEmergency', label: 'Put those calls straight through to it?', kind: 'choice', options: YES_NO, help: 'If the line isn’t answered, the caller is given the number and you get an urgent text.', showIf: isBeautyS },
      { path: 'calls.emergencies', label: 'What counts as an emergency for you', kind: 'textarea', wide: true, help: 'One per line. Gas smells, floods and no heating for someone vulnerable are always flagged.', placeholder: 'Water leaking or a burst pipe\nNo heating or hot water for someone vulnerable', showIf: isTrade },
      { path: 'calls.transferTo', label: 'What to do with something urgent', kind: 'text', wide: true, placeholder: 'Text Sarah on 07700 900111 and say it’s urgent' },
      { path: 'calls.quotePolicy', label: 'Can it talk about prices?', kind: 'choice', required: true, wide: true, options: [{ value: 'never', label: 'No, I quote every job myself' }, { value: 'ranges', label: 'Guide prices only' }, { value: 'fixed', label: 'Yes, I have fixed prices' }], showIf: isTrade },
      { path: 'calls.quotePolicy', label: 'Can it tell callers your prices?', kind: 'choice', required: true, wide: true, options: [{ value: 'fixed', label: 'Yes, the prices of each appointment' }, { value: 'never', label: 'No' }], showIf: isAppts },
      { path: 'calls.priceNotes', label: 'The prices it may give', kind: 'textarea', wide: true, required: true, placeholder: 'Boiler service from £85. Call-out and first hour £75.', showIf: (s) => isTrade(s) && s.calls.quotePolicy !== 'never' },
      { path: 'calls.gasWork', label: 'Do you work on gas appliances?', kind: 'choice', options: YES_NO, help: 'If yes, gas smells get the National Gas Emergency script.', showIf: isTrade },
      { path: 'calls.notify', label: 'Email me about', kind: 'choice', wide: true, options: [{ value: 'urgent', label: 'Urgent calls only' }, { value: 'all', label: 'Every enquiry and booking' }] },
    ],
  },
  {
    id: 'followUps', title: 'Follow-ups', question: 'How do you get paid and reviewed?',
    intro: 'Confirmations, reminders and review requests use these details.',
    fields: [
      { path: 'followUps.paymentDays', label: 'Payment terms', kind: 'select', required: true, options: [{ value: 0, label: 'Paid on the day' }, { value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }] },
      { path: 'followUps.payLink', label: 'Payment link', kind: 'url', placeholder: 'https://', help: 'Optional. From Stripe, SumUp, your booking system or similar.' },
      { path: 'followUps.reviewLink', label: 'Google review link', kind: 'url', wide: true, placeholder: 'https://g.page/r/…/review', help: 'Optional. In your Google Business Profile: “Ask for reviews”, then copy the link.' },
    ],
  },
];

const CLINIC_TYPES: AppointmentType[] = [{ name: 'Initial consultation', minutes: 45, price: '', who: '' }, { name: 'Follow-up', minutes: 30, price: '', who: '' }];
const BEAUTY_TYPES: AppointmentType[] = [{ name: 'Consultation', minutes: 30, price: '', who: '' }, { name: 'Treatment', minutes: 60, price: '', who: '' }];
const sameTypes = (a: AppointmentType[], b: AppointmentType[]) => a.length === b.length && a.every((t, i) => t.name === b[i].name && t.minutes === b[i].minutes && !t.price && !t.who);

/** Applies one answer, and refreshes the starting answers that depend on it (only ones the owner hasn't changed). */
export function applyAnswer(s: CaptureSettings, path: string, v: any): CaptureSettings {
  const next = setPath(s, path, v);
  if (path === 'business.kind') return withKindDefaults(next);
  if (path === 'business.trade' && next.business.kind === 'appointments') {
    const beauty = isBeauty(next.business);
    const untouchedSafety = !next.calls.safety || next.calls.safety === DEFAULT_SAFETY || next.calls.safety === DEFAULT_BEAUTY_SAFETY;
    const untouchedTypes = !next.bookings.types.length || sameTypes(next.bookings.types, CLINIC_TYPES) || sameTypes(next.bookings.types, BEAUTY_TYPES);
    const systems = bookingSystemsFor(next.business);
    return {
      ...next,
      calls: { ...next.calls, safety: untouchedSafety ? (beauty ? DEFAULT_BEAUTY_SAFETY : DEFAULT_SAFETY) : next.calls.safety },
      bookings: { ...next.bookings, types: untouchedTypes ? (beauty ? BEAUTY_TYPES : CLINIC_TYPES) : next.bookings.types, system: next.bookings.system && !systems.includes(next.bookings.system) ? '' : next.bookings.system },
    };
  }
  return next;
}

/** Sensible starting answers when the business type changes. */
export function withKindDefaults(s: CaptureSettings): CaptureSettings {
  // Message wording follows the business type ("your appointment" or "your visit").
  const automations = defaultAutomations(s.business.kind, new Date().toISOString());
  if (s.business.kind !== 'appointments') return { ...s, automations };
  return {
    ...s,
    automations,
    calls: { ...s.calls, safety: s.calls.safety || (isBeauty(s.business) ? DEFAULT_BEAUTY_SAFETY : DEFAULT_SAFETY), quotePolicy: s.calls.quotePolicy === 'ranges' ? 'fixed' : s.calls.quotePolicy, gasWork: false },
    bookings: { ...s.bookings, mode: s.bookings.mode === 'callback' && !s.bookings.types.length ? 'book' : s.bookings.mode, types: s.bookings.types.length ? s.bookings.types : (isBeauty(s.business) ? BEAUTY_TYPES : CLINIC_TYPES) },
    followUps: { ...s.followUps, paymentDays: s.followUps.paymentDays === 14 ? 0 : s.followUps.paymentDays },
  };
}

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
    if (f.kind === 'types') { if (s.business.kind === 'appointments' && !s.bookings.types.some((t) => t.name.trim())) e[f.path] = 'Add at least one thing people can book.'; continue; }
    if (f.kind === 'greeting') continue;
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
  if (f.kind === 'types') return <TypesField f={f} s={s} onChange={onChange} error={error} />;
  if (f.kind === 'greeting') {
    return (
      <Field label={f.label} help={f.help} error={error} className={cls}>
        {(id, d) => (
          <div className="stack gap-8">
            <input id={id} className="input" value={s.calls.greeting} aria-describedby={d} onChange={(e: any) => onChange('calls.greeting', e.target.value)} />
            <p className="greeting-preview"><Icon name="phone" />“{greetingFor(s)}”</p>
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
          ? <select id={id} className="select" value={String(v ?? '')} aria-describedby={d} aria-invalid={!!error} onChange={(e: any) => { const o = optsOf(f, s).find((x) => String(x.value) === e.target.value); onChange(f.path, o ? o.value : e.target.value); }}>
              {typeof v === 'string' && !v && <option value="">Choose…</option>}
              {optsOf(f, s).map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
            </select>
          : <input id={id} className="input" type={f.kind === 'number' ? 'number' : f.kind} value={v ?? ''} placeholder={f.placeholder} aria-describedby={d} aria-invalid={!!error}
              autoComplete={f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : undefined} onChange={(e: any) => onChange(f.path, e.target.value)} />}
    </Field>
  );
}

const optsOf = (f: Q, s: CaptureSettings) => (f.optionsFor ? f.optionsFor(s) : f.options ?? []);

export function display(f: Q, s: CaptureSettings): string {
  if (f.showIf && !f.showIf(s)) return '';
  if (f.kind === 'types') return s.bookings.types.filter((t) => t.name.trim()).map((t) => `${t.name} (${t.minutes} min${t.price ? `, ${t.price}` : ''}${t.rebookWeeks ? `, due back ${t.rebookWeeks} wks` : ''})`).join(' · ') || '–';
  if (f.kind === 'greeting') return `“${greetingFor(s)}”`;
  if (f.kind === 'days' || f.kind === 'hours') return f.kind === 'hours' ? hoursText(s.calls) : s.calls.days.map((d) => DAYS[d - 1]).join(', ');
  const v = getPath(s, f.path);
  if (f.options || f.optionsFor) return optsOf(f, s).find((o) => o.value === v)?.label ?? (String(v ?? '').trim() || '–');
  if (f.kind === 'textarea') return lines(v).join(' · ') || '–';
  return String(v ?? '').trim() || '–';
}

function TypesField({ f, s, onChange, error }: { f: Q; s: CaptureSettings; onChange: (path: string, v: any) => void; error?: string }) {
  const rows = s.bookings.types;
  const set = (i: number, k: keyof AppointmentType, v: any) => onChange('bookings.types', rows.map((r, j) => (j === i ? { ...r, [k]: k === 'minutes' ? Number(v) : v } : r)));
  return (
    <Field label={f.label} help={f.help} error={error} as="group" className="wide">
      {() => (
        <div className="types">
          {rows.length > 0 && <div className="types-head xsmall faint" aria-hidden="true"><span>What</span><span>Length</span><span>Price</span><span>Who</span><span>Due back</span><span /></div>}
          {rows.map((r, i) => (
            <div className="types-row" key={i}>
              <input className="input" aria-label={`Name of booking type ${i + 1}`} value={r.name} placeholder="Initial consultation" onChange={(e: any) => set(i, 'name', e.target.value)} />
              <select className="select" aria-label={`Length of ${r.name || 'this booking'}`} value={r.minutes} onChange={(e: any) => set(i, 'minutes', e.target.value)}>
                {[15, 20, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
              <input className="input" aria-label={`Price of ${r.name || 'this booking'}`} value={r.price} placeholder="£65" onChange={(e: any) => set(i, 'price', e.target.value)} />
              <input className="input" aria-label={`Who does ${r.name || 'this booking'}`} value={r.who} placeholder="Any physio" onChange={(e: any) => set(i, 'who', e.target.value)} />
              <select className="select" aria-label={`Weeks until ${r.name || 'this booking'} is due again`} value={r.rebookWeeks ?? 0} onChange={(e: any) => onChange('bookings.types', rows.map((x, j) => (j === i ? { ...x, rebookWeeks: Number(e.target.value) || undefined } : x)))}>
                <option value={0}>Not set</option>
                {[2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 26, 52].map((w) => <option key={w} value={w}>{w} wks</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={`Remove ${r.name || 'this row'}`} onClick={() => onChange('bookings.types', rows.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <Button kind="secondary" small icon="plus" onClick={() => onChange('bookings.types', [...rows, { name: '', minutes: 30, price: '', who: '' }])}>Add {rows.length ? 'another' : 'something people can book'}</Button>
        </div>
      )}
    </Field>
  );
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
    const next = applyAnswer(s, path, v);
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
            <p className="welcome-lede">Five short sections, about ten minutes. From your answers Gainora writes the script your AI receptionist follows, and sets up your enquiries inbox and follow-ups.</p>
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
  const sections = full ? pack.sections : pack.sections.filter((x) => ['What we do', 'What we offer', 'Booking', 'Emergencies', 'Safety'].includes(x.title));
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
