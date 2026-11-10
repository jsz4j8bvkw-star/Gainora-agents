// The clinic's own booking page: treatment, time, details, done. Phone first, three taps to a booking,
// prices and the clinic's name up front, no account. Used standalone at /book/<slug> and as a preview in the app.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicPage, PublicType } from '../../shared/diary';

export interface PageTimes { days: { date: string; label: string; slots: { id: string; start: string; who: string }[] }[] }
export type BookResult =
  | { ok: true; status: 'booked' | 'requested'; when: string; type: string; deposit: { what: string; link: string } | null }
  | { ok: false; message: string; field?: string; reason?: string };
export interface PageApi {
  info(): Promise<PublicPage>;
  times(type: string, who: string, from: string, days: number): Promise<PageTimes>;
  book(body: { type: string; slot: string; name: string; phone: string; email: string; notes: string; newClient?: boolean; website_url_confirm?: string }): Promise<BookResult>;
  /** In the app's preview, bookings are shown but not made. */
  preview?: boolean;
}

export type Step = 'type' | 'time' | 'details' | 'done';
const TZ = 'Europe/London';
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));
const time12 = (iso: string) => fmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(' ', '');
const hourOf = (iso: string) => Number(fmt(iso, { hour: '2-digit', hourCycle: 'h23' }));
const todayUk = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export function BookingPage({ api, onStep }: { api: PageApi; onStep?: (step: Step) => void }) {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [failed, setFailed] = useState('');
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<PublicType | null>(null);
  const [who, setWho] = useState('');
  const [times, setTimes] = useState<PageTimes | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState<{ id: string; start: string; who: string } | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Extract<BookResult, { ok: true }> | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    api.info().then((p) => {
      setPage(p);
      // Only one thing to book: skip straight to the times.
      if (p.types.length === 1) { setType(p.types[0]); setStep('time'); loadTimes(p.types[0], ''); }
    }).catch((e) => setFailed(e?.message || 'This booking page isn’t available.'));
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); onStep?.(step); }, [step]);

  const loadTimes = async (t: PublicType, w: string) => {
    setLoadingTimes(true); setTimes(null);
    try {
      const r = await api.times(t.name, w, todayUk(), 21);
      setTimes(r);
      setDay((d) => (r.days.some((x) => x.date === d) ? d : r.days[0]?.date ?? ''));
    } catch { setTimes({ days: [] }); }
    finally { setLoadingTimes(false); }
  };

  if (failed) return <Shell accent=""><div className="bk-card bk-center"><h1 className="bk-title">Booking isn’t available</h1><p className="bk-muted">{failed}</p></div></Shell>;
  if (!page) return <Shell accent=""><div className="bk-loading" aria-live="polite"><span className="bk-spinner" />Loading…</div></Shell>;

  const eligible = type ? page.team.filter((t) => !type.who.length || type.who.includes(t)) : [];
  const choose = (t: PublicType) => { setType(t); setWho(''); setSlot(null); setNote(''); setStep('time'); loadTimes(t, ''); };
  const words = page.words ?? { item: 'Treatment', returning: 'Have you been to us before?', yes: 'Yes', no: 'No, it’s my first visit' };
  const depositFor = (t: PublicType | null) => !!(page.deposit && t && (!page.deposit.types.length || page.deposit.types.some((x) => x.toLowerCase() === t.name.toLowerCase())));

  return (
    <Shell accent={page.accent}>
      <header className="bk-head">
        <p className="bk-eyebrow">{page.mode === 'request' ? 'Request an appointment' : 'Book online'}</p>
        <h1 className="bk-clinic">{page.name}</h1>
        {(page.location || page.address) && <p className="bk-muted bk-where">{page.address || page.location}</p>}
        {page.intro && (step === 'type' || (step === 'time' && page.types.length === 1)) && <p className="bk-intro">{page.intro}</p>}
      </header>

      {step !== 'done' && (
        <ol className="bk-steps" aria-label="Steps">
          {(['type', 'time', 'details'] as const).map((s, i) => {
            const at = ['type', 'time', 'details'].indexOf(step);
            return <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}><span>{i + 1}</span>{[words.item, 'Time', 'Your details'][i]}</li>;
          })}
        </ol>
      )}

      {step === 'type' && (
        <section aria-labelledby="bk-h">
          <h2 className="bk-h" id="bk-h" tabIndex={-1} ref={heading}>What would you like to book?</h2>
          {page.types.length === 0 && <p className="bk-muted">Nothing can be booked online at the moment. {page.phone ? <>Please call <a href={`tel:${page.phone.replace(/\s/g, '')}`}>{page.phone}</a>.</> : ''}</p>}
          <div className="bk-list">
            {page.types.map((t) => (
              <button key={t.name} className="bk-type" onClick={() => choose(t)}>
                <span className="bk-type-main">
                  <span className="bk-type-name">{t.name}</span>
                  <span className="bk-type-meta">{mins(t.minutes)}{t.who.length && t.who.length < page.team.length ? ` · with ${t.who.join(' or ')}` : ''}</span>
                </span>
                {t.price && <span className="bk-price">{t.price}</span>}
                <Chevron />
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'time' && type && (
        <section aria-labelledby="bk-h">
          <Picked label={type.name} meta={`${mins(type.minutes)}${type.price ? ` · ${type.price}` : ''}`} onChange={() => setStep('type')} />
          <h2 className="bk-h" id="bk-h" tabIndex={-1} ref={heading}>Choose a time</h2>
          {page.chooseStaff && eligible.length > 1 && (
            <div className="bk-who" role="radiogroup" aria-label="Who with">
              {['', ...eligible].map((w) => (
                <button key={w || 'any'} role="radio" aria-checked={who === w} className={`bk-chip ${who === w ? 'on' : ''}`} onClick={() => { setWho(w); loadTimes(type, w); }}>{w || 'Anyone'}</button>
              ))}
            </div>
          )}
          {loadingTimes && <div className="bk-loading" aria-live="polite"><span className="bk-spinner" />Finding free times…</div>}
          {times && !loadingTimes && times.days.length === 0 && (
            <div className="bk-card bk-center"><p><strong>No free times in the next few weeks.</strong></p><p className="bk-muted">{page.phone ? <>Call <a href={`tel:${page.phone.replace(/\s/g, '')}`}>{page.phone}</a> and we’ll find you something.</> : 'Please get in touch and we’ll find you something.'}</p></div>
          )}
          {times && !loadingTimes && times.days.length > 0 && (
            <>
              <div className="bk-days" role="tablist" aria-label="Days">
                {times.days.map((d) => {
                  const dt = new Date(`${d.date}T12:00:00Z`);
                  return (
                    <button key={d.date} role="tab" aria-selected={day === d.date} className={`bk-day ${day === d.date ? 'on' : ''}`} onClick={() => setDay(d.date)}>
                      <span className="bk-day-w">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <span className="bk-day-n">{dt.getUTCDate()}</span>
                      <span className="bk-day-m">{dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                    </button>
                  );
                })}
              </div>
              {times.days.filter((d) => d.date === day).map((d) => (
                <div key={d.date} className="bk-times" role="tabpanel" aria-label={d.label}>
                  <p className="bk-dayname">{d.label}</p>
                  {(['Morning', 'Afternoon', 'Evening'] as const).map((part) => {
                    const list = d.slots.filter((x) => (part === 'Morning' ? hourOf(x.start) < 12 : part === 'Afternoon' ? hourOf(x.start) < 17 && hourOf(x.start) >= 12 : hourOf(x.start) >= 17));
                    if (!list.length) return null;
                    return (
                      <div key={part} className="bk-part">
                        <p className="bk-part-name">{part}</p>
                        <div className="bk-grid">
                          {list.map((x) => <button key={x.id} className="bk-time" onClick={() => { setSlot(x); setStep('details'); }}>{time12(x.start)}</button>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
          {note && <p className="bk-alert" role="alert">{note}</p>}
        </section>
      )}

      {step === 'details' && type && slot && (
        <Details page={page} type={type} slot={slot} api={api} heading={heading} deposit={depositFor(type)}
          onBack={() => setStep('time')}
          onTaken={(m) => { setNote(m); setSlot(null); setStep('time'); loadTimes(type, who); }}
          onDone={(r) => { setResult(r); setStep('done'); }} />
      )}

      {step === 'done' && result && type && slot && <Done page={page} type={type} slot={slot} result={result} heading={heading} onAgain={() => { setStep('type'); setType(null); setSlot(null); setResult(null); }} />}

      <footer className="bk-foot">{api.preview ? 'Preview: bookings are not made from here.' : <>Online booking by <a href="https://gainora.co.uk" target="_blank" rel="noreferrer">Gainora</a></>}</footer>
    </Shell>
  );
}

/** Text on the clinic's colour: dark on a light colour, white on a dark one. */
function onAccent(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111214' : '#FFFFFF';
}

function Shell({ accent, children }: { accent: string; children: any }) {
  return <div className="bk" style={accent ? ({ '--bk-accent': accent, '--bk-on-accent': onAccent(accent) } as any) : undefined}><main className="bk-main">{children}</main></div>;
}

function Chevron() {
  return <svg className="bk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
}

function Picked({ label, meta, onChange }: { label: string; meta: string; onChange: () => void }) {
  return (
    <div className="bk-picked">
      <span><strong>{label}</strong><span className="bk-muted"> · {meta}</span></span>
      <button className="bk-link" onClick={onChange}>Change</button>
    </div>
  );
}

function Details({ page, type, slot, api, heading, deposit, onBack, onTaken, onDone }: {
  page: PublicPage; type: PublicType; slot: { id: string; start: string; who: string }; api: PageApi; heading: any; deposit: boolean;
  onBack: () => void; onTaken: (m: string) => void; onDone: (r: Extract<BookResult, { ok: true }>) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [been, setBeen] = useState<'' | 'yes' | 'no'>('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const when = useMemo(() => `${fmt(slot.start, { weekday: 'long', day: 'numeric', month: 'long' })} at ${time12(slot.start)}`, [slot]);
  const request = page.mode === 'request';
  const owes = deposit && (page.deposit?.forWho === 'all' || been === 'no');

  const submit = async (ev: any) => {
    ev.preventDefault();
    if (name.trim().length < 2) return setErr({ field: 'name', message: 'Add your name.' });
    if (phone.replace(/\D/g, '').length < 10) return setErr({ field: 'phone', message: 'Add a mobile number so we can text your confirmation.' });
    setErr(null); setBusy(true);
    try {
      const r = await api.book({ type: type.name, slot: slot.id, name, phone, email, notes, newClient: been === '' ? undefined : been === 'no', website_url_confirm: trap });
      if (r.ok) onDone(r);
      else if (r.reason === 'taken') onTaken(r.message);
      else setErr({ field: r.field, message: r.message });
    } catch { setErr({ message: 'That didn’t go through. Please try again.' }); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="bk-h">
      <div className="bk-summary">
        <div>
          <p className="bk-summary-what">{type.name}</p>
          <p className="bk-summary-when">{when}</p>
          <p className="bk-muted">{mins(type.minutes)}{slot.who ? ` · with ${slot.who}` : ''}{type.price ? ` · ${type.price}` : ''}</p>
        </div>
        <button className="bk-link" onClick={onBack}>Change</button>
      </div>
      <h2 className="bk-h" id="bk-h" tabIndex={-1} ref={heading}>Your details</h2>
      <form className="bk-form" onSubmit={submit} noValidate>
        <label className="bk-field"><span>Full name</span>
          <input autoComplete="name" value={name} onChange={(e: any) => setName(e.target.value)} aria-invalid={err?.field === 'name'} />
        </label>
        <label className="bk-field"><span>Mobile number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e: any) => setPhone(e.target.value)} aria-invalid={err?.field === 'phone'} placeholder="07…" />
          <small>{page.texts === false ? 'So we can reach you about your booking.' : 'We’ll text your confirmation here.'}</small>
        </label>
        <label className="bk-field"><span>Email <em>optional</em></span>
          <input type="email" autoComplete="email" value={email} onChange={(e: any) => setEmail(e.target.value)} aria-invalid={err?.field === 'email'} />
        </label>
        <fieldset className="bk-field bk-fieldset">
          <legend>{page.words?.returning ?? 'Have you been to us before?'}</legend>
          <div className="bk-who">
            <button type="button" className={`bk-chip ${been === 'yes' ? 'on' : ''}`} aria-pressed={been === 'yes'} onClick={() => setBeen('yes')}>{page.words?.yes ?? 'Yes'}</button>
            <button type="button" className={`bk-chip ${been === 'no' ? 'on' : ''}`} aria-pressed={been === 'no'} onClick={() => setBeen('no')}>{page.words?.no ?? 'No, it’s my first visit'}</button>
          </div>
        </fieldset>
        <label className="bk-field"><span>Anything we should know? <em>optional</em></span>
          <textarea rows={3} value={notes} onChange={(e: any) => setNotes(e.target.value)} />
        </label>
        <input className="bk-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e: any) => setTrap(e.target.value)} name="website_url_confirm" />
        {owes && page.deposit && <p className="bk-note"><strong>Deposit:</strong> {page.deposit.what}. We’ll text you a secure link to pay it, to hold your booking.</p>}
        {page.cancellation && <p className="bk-small bk-muted">{page.cancellation}</p>}
        {err && <p className="bk-alert" role="alert">{err.message}</p>}
        <button className="bk-primary" type="submit" disabled={busy}>{busy ? 'One moment…' : request ? 'Request this time' : 'Confirm booking'}</button>
        <p className="bk-small bk-muted">Your details go only to {page.name}, to manage your appointment.</p>
      </form>
    </section>
  );
}

function Done({ page, type, slot, result, heading, onAgain }: { page: PublicPage; type: PublicType; slot: { start: string; who: string }; result: Extract<BookResult, { ok: true }>; heading: any; onAgain: () => void }) {
  const booked = result.status === 'booked';
  const ics = () => {
    const start = new Date(slot.start); const end = new Date(start.getTime() + type.minutes * 60_000);
    const z = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gainora//Booking//EN', 'BEGIN:VEVENT', `UID:${z(start)}-${Math.random().toString(36).slice(2)}@gainora`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(start)}`, `DTEND:${z(end)}`,
      `SUMMARY:${type.name} ${page.remote ? 'with' : 'at'} ${page.name}`.replace(/[,;]/g, ' '), `LOCATION:${(page.address || page.location).replace(/[,;]/g, ' ')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
    a.download = 'appointment.ics'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section aria-labelledby="bk-h" className="bk-done">
      <span className="bk-tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
      <h2 className="bk-h" id="bk-h" tabIndex={-1} ref={heading}>{booked ? 'You’re booked in' : 'Request sent'}</h2>
      <p className="bk-done-when">{type.name}<br />{result.when}</p>
      <p className="bk-muted">{booked ? (page.texts === false ? `${page.name} has your booking and will be in touch if anything changes.` : 'A confirmation text is on its way, and a reminder the day before.') : page.texts === false ? `${page.name} will be in touch to confirm your time.` : `${page.name} will confirm your time by text shortly.`}</p>
      {result.deposit && <a className="bk-primary" href={result.deposit.link} target="_blank" rel="noreferrer">Pay your deposit ({result.deposit.what})</a>}
      {booked && <button className="bk-secondary" onClick={ics}>Add to my calendar</button>}
      {(page.address || page.arrival) && (
        <div className="bk-card bk-left">
          {page.address && (page.remote
            ? <p><strong>How</strong><br />{page.address}</p>
            : <p><strong>Where</strong><br />{page.address} · <a href={`https://www.google.com/maps/search/${encodeURIComponent(page.address)}`} target="_blank" rel="noreferrer">Map</a></p>)}
          {page.arrival && <p><strong>{page.remote ? 'Before the call' : 'Before you come'}</strong><br />{page.arrival}</p>}
          {page.cancellation && <p className="bk-small bk-muted">{page.cancellation}</p>}
        </div>
      )}
      <button className="bk-link" onClick={onAgain}>{page.types.length > 1 ? 'Book something else' : 'Book another time'}</button>
    </section>
  );
}
