// The diary: the clinic's day at a glance, adding a booking in a few taps, their own booking page, and how the
// diary works. Built so a clinic can run its whole book here, or keep its own system and use Gainora alongside.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link, navigate } from '../lib/router';
import { Button, Choices, Field, Icon, Modal, Tabs, copyText, useToast } from '../components/ui';
import { Toggle } from '../components/features';
import { Connections } from '../components/connections';
import { ImportCard } from '../components/importer';
import { BookingPage, type PageApi } from '../book/BookingPage';
import '../book/book.css';
import { depositRule, GAINORA_DIARY, hoursText, isBeauty, normPhone } from '../../shared/capture';
import { dayLabel, findType, londonDate, londonTime, pageOf, publicPage, requestedTime, sayTime, teamOf, timeLabel, whoDoes, type BookingPage as PageSettings } from '../../shared/diary';
import type { CaptureSettings, EnquiryRecord } from '../lib/types';

type Tab = 'diary' | 'page' | 'setup';
const addDays = (date: string, n: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const mins = (hhmm: string) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minuteOfDay = (iso: string) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)); return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value); };
const HOUR_PX = 80;
const COLOURS = ['#C9B37E', '#8FA89A', '#B79AAE', '#9DB0C9', '#C9A08F', '#A3A3A3'];
const PAGE_BASE = 'https://capture.gainora.co.uk/book/';

export function DiaryPage() {
  const [tab, setTab] = useState<Tab>(() => (/connected=|connect_error=/.test(location.search) ? 'setup' : 'diary'));
  const { settings } = useApp();
  const gainora = settings.bookings.system === GAINORA_DIARY;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="title">Diary</h1>
          <p className="lede">{gainora ? 'Every booking in one place: from your booking page, your receptionist and you.' : 'Bookings made through Gainora: from your booking page, your receptionist and you.'}</p>
        </div>
      </div>
      <Tabs label="Diary sections" value={tab} onChange={setTab} tabs={[
        { id: 'diary', label: 'Diary' },
        { id: 'page', label: 'Booking page' },
        { id: 'setup', label: 'How it works' },
      ]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
        {tab === 'diary' && <Day />}
        {tab === 'page' && <PageSetup />}
        {tab === 'setup' && <DiarySetup />}
      </div>
    </div>
  );
}

/* ---------- The day ---------- */

interface Block { e: EnquiryRecord; start: string; minutes: number; who: string; kind: 'booked' | 'request' | 'space' }

function blocksFor(list: EnquiryRecord[], s: CaptureSettings, date: string): Block[] {
  const out: Block[] = [];
  for (const e of list) {
    if (e.isTest) continue;
    const len = (t: string) => findType(s, t)?.minutes || 60;
    if (e.status === 'booked' && e.bookedFor && londonDate(new Date(e.bookedFor)) === date) out.push({ e, start: e.bookedFor, minutes: len(e.bookedType || ''), who: e.bookedWith || '', kind: 'booked' });
    else if (e.status === 'lost' && e.bookedFor && londonDate(new Date(e.bookedFor)) === date && e.history.some((h) => /^Cancelled/.test(h.text)) && new Date(e.bookedFor).getTime() > Date.now()) out.push({ e, start: e.bookedFor, minutes: len(e.bookedType || ''), who: e.bookedWith || '', kind: 'space' });
    else { const r = requestedTime(e); if (r && londonDate(new Date(r.start)) === date) out.push({ e, start: r.start, minutes: len(r.type), who: r.who, kind: 'request' }); }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function Day() {
  const { settings, enquiries, putEnquiry } = useApp();
  const toast = useToast();
  const today = londonDate(new Date());
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState<{ start?: string; who?: string } | null>(null);
  const team = teamOf(settings);
  const cols = team.length ? team : [''];
  const open = mins(settings.calls.open), close = mins(settings.calls.close);
  const isOpen = settings.calls.days.includes(weekday(date));
  const blocks = useMemo(() => blocksFor(enquiries ?? [], settings, date), [enquiries, settings, date]);
  const weekStart = addDays(date, -(weekday(date) - 1));
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const countFor = (d: string) => (enquiries ?? []).filter((e) => !e.isTest && e.status === 'booked' && e.bookedFor && londonDate(new Date(e.bookedFor)) === d).length;
  const colour = (who: string) => COLOURS[Math.max(0, cols.indexOf(who)) % COLOURS.length];
  const booked = blocks.filter((b) => b.kind === 'booked');
  const value = booked.reduce((a, b) => a + (Number(String(findType(settings, b.e.bookedType || '')?.price || '').replace(/[^\d.]/g, '')) || 0), 0);

  const confirm = async (b: Block) => {
    try {
      const r = requestedTime(b.e)!;
      const next = await api.updateEnquiry(b.e.id, { status: 'booked', bookedFor: r.start, bookedType: r.type, bookedWith: r.who });
      putEnquiry(next); toast('Confirmed. The confirmation text goes to them now.');
    } catch (e: any) { toast(e?.message || 'That didn’t save.'); }
  };
  const clickColumn = (ev: any, who: string) => {
    if (ev.target !== ev.currentTarget) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const m = open + Math.floor(((ev.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15;
    setAdding({ start: londonTime(date, Math.min(m, close - 15)).toISOString(), who });
  };

  return (
    <div className="stack gap-16">
      <div className="diary-bar">
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <button className="btn btn-quiet btn-small" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><Icon name="back" /></button>
          <button className="btn btn-secondary btn-small" disabled={date === today} onClick={() => setDate(today)}>Today</button>
          <button className="btn btn-quiet btn-small" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><Icon name="chevron" /></button>
          <h2 className="subhead diary-date">{dayLabel(date)}</h2>
        </div>
        <Button icon="plus" onClick={() => setAdding({})}>Add a booking</Button>
      </div>

      <div className="week-strip" role="tablist" aria-label="This week">
        {week.map((d) => {
          const n = countFor(d);
          const closed = !settings.calls.days.includes(weekday(d));
          const dt = new Date(`${d}T12:00:00Z`);
          return (
            <button key={d} role="tab" aria-selected={d === date} className={`week-day ${d === date ? 'on' : ''} ${closed ? 'closed' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDate(d)}>
              <span className="xsmall">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
              <strong>{dt.getUTCDate()}</strong>
              <span className="xsmall">{closed ? 'Closed' : n ? `${n} booked` : 'Free'}</span>
            </button>
          );
        })}
      </div>

      {booked.length > 0 && <p className="small muted">{booked.length} {booked.length === 1 ? 'appointment' : 'appointments'}{value ? `, about £${Math.round(value).toLocaleString('en-GB')} at your prices` : ''}.</p>}

      {!isOpen && blocks.length === 0 ? (
        <div className="panel empty"><p className="muted">You’re closed on {dayLabel(date).split(' ')[0]}s. <Link to="/settings">Change your opening days</Link></p></div>
      ) : (
        <>
          {/* Wide screens: a column per person, on a timeline. */}
          <div className="panel diary-grid-wrap">
            <div className="diary-grid" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(140px, 1fr))` }}>
              <div />
              {cols.map((c) => <div key={c || 'all'} className="diary-col-head"><span className="dot" style={{ background: colour(c) }} />{c || settings.business.name}</div>)}
              <div className="diary-hours" style={{ height: ((close - open) / 60) * HOUR_PX }}>
                {Array.from({ length: Math.ceil((close - open) / 60) }, (_, i) => <span key={i} style={{ top: i * HOUR_PX }}>{timeLabel(londonTime(date, open + i * 60).toISOString())}</span>)}
              </div>
              {cols.map((c) => (
                <div key={c || 'all'} className="diary-col" style={{ height: ((close - open) / 60) * HOUR_PX }} onClick={(ev: any) => clickColumn(ev, c)} title="Click an empty time to add a booking">
                  {Array.from({ length: Math.ceil((close - open) / 60) }, (_, i) => <span key={i} className="diary-line" style={{ top: i * HOUR_PX }} />)}
                  {blocks.filter((b) => (cols.length === 1 ? true : b.who === c || (!b.who && c === cols[0]))).map((b) => {
                    const top = ((minuteOfDay(b.start) - open) / 60) * HOUR_PX;
                    const h = Math.max(34, (b.minutes / 60) * HOUR_PX - 3);
                    return (
                      <button key={b.e.id + b.kind} className={`diary-block ${b.kind} ${h < 50 ? 'compact' : ''}`} style={{ top, height: h, borderLeftColor: colour(b.who) }} onClick={() => navigate(`/enquiries/${b.e.id}`)}>
                        {h < 50
                          ? <span className="small"><strong>{timeLabel(b.start)}</strong> {b.kind === 'space' ? 'Space to fill' : b.e.name || 'Client'}{b.kind === 'request' ? ' (asked for)' : ''}</span>
                          : <>
                              <span className="xsmall">{timeLabel(b.start)}{b.kind === 'request' ? ' · asked for' : b.kind === 'space' ? ' · cancelled' : ''}</span>
                              <strong className="small">{b.kind === 'space' ? 'Space to fill' : b.e.name || 'Client'}</strong>
                              {h > 64 && <span className="xsmall">{b.e.bookedType || requestedTime(b.e)?.type || ''}</span>}
                            </>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Phones: the day as a list. */}
          <div className="panel rows diary-list">
            {blocks.length === 0 && <div className="empty"><p className="muted">Nothing booked yet. Tap “Add a booking”, or share your booking page.</p></div>}
            {blocks.map((b) => (
              <div key={b.e.id + b.kind} className={`diary-row ${b.kind}`}>
                <span className="diary-row-time"><strong>{timeLabel(b.start)}</strong><span className="xsmall faint">{b.minutes} min</span></span>
                <Link to={`/enquiries/${b.e.id}`} className="stack diary-row-link">
                  <span className="small" style={{ fontWeight: 600 }}>{b.kind === 'space' ? `Space to fill (${b.e.name} cancelled)` : b.e.name || 'Client'}</span>
                  <span className="xsmall faint">{b.e.bookedType || requestedTime(b.e)?.type || ''}{b.who ? ` · ${b.who}` : ''}</span>
                </Link>
                {b.kind === 'request' && <Button small onClick={() => confirm(b)}>Confirm</Button>}
                {b.kind === 'space' && <Button small kind="secondary" onClick={() => navigate(`/enquiries/${b.e.id}`)}>Fill it</Button>}
              </div>
            ))}
          </div>

          {blocks.some((b) => b.kind === 'request') && (
            <div className="panel rows">
              {blocks.filter((b) => b.kind === 'request').map((b) => (
                <div key={b.e.id} className="diary-row request">
                  <span className="diary-row-time"><strong>{timeLabel(b.start)}</strong></span>
                  <span className="stack" style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 600 }}>{b.e.name} asked for this time</span><span className="xsmall faint">{requestedTime(b.e)?.type}{b.who ? ` with ${b.who}` : ''}. Check it’s free in your own diary, then confirm.</span></span>
                  <Button small onClick={() => confirm(b)}>Confirm</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {adding && <AddBooking date={date} start={adding.start} who={adding.who} onClose={() => setAdding(null)} onDone={(e) => { putEnquiry(e); setAdding(null); setDate(londonDate(new Date(e.bookedFor!))); toast(`${e.name} is booked in.${settings.automations.booking?.on ? ' Their confirmation text is on its way.' : ''}`); }} />}
    </div>
  );
}

/* ---------- Adding a booking ---------- */

function AddBooking({ date, start, who, onClose, onDone }: { date: string; start?: string; who?: string; onClose: () => void; onDone: (e: EnquiryRecord) => void }) {
  const { settings, enquiries } = useApp();
  const types = settings.bookings.types.filter((t) => t.name.trim());
  const [type, setType] = useState(types[0]?.name ?? '');
  const [person, setPerson] = useState(who ?? '');
  const [day, setDay] = useState(start ? londonDate(new Date(start)) : date);
  const [slots, setSlots] = useState<{ id: string; start: string; who: string }[] | null>(null);
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [been, setBeen] = useState<'' | 'Yes' | 'No'>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const eligible = whoDoes(settings, findType(settings, type)).filter(Boolean);
  // Clients already in the inbox, to fill in their number with a tap.
  const known = useMemo(() => {
    const m = new Map<string, { name: string; phone: string; email: string }>();
    for (const e of enquiries ?? []) if (e.name && e.phone && !e.isTest && e.status !== 'spam') m.set(normPhone(e.phone), { name: e.name, phone: e.phone, email: e.email });
    return [...m.values()];
  }, [enquiries]);

  useEffect(() => {
    let live = true;
    setSlots(null);
    api.diaryTimes(type, person, day, 1).then((r) => {
      if (!live) return;
      const list = r.days[0]?.slots ?? [];
      setSlots(list);
      const want = start ? list.find((x) => x.start === new Date(start).toISOString() && (!who || x.who === who)) : null;
      setSlot(want ? want.id : '');
    }).catch(() => live && setSlots([]));
    return () => { live = false; };
  }, [type, person, day]);

  const pickName = (v: string) => {
    setName(v);
    const k = known.find((x) => x.name.toLowerCase() === v.toLowerCase());
    if (k) { setPhone(k.phone); setEmail(k.email); setBeen('Yes'); }
  };
  const submit = async () => {
    if (!slot) return setErr('Choose a time.');
    setBusy(true); setErr('');
    try { onDone(await api.diaryBook({ type, slot, name, phone, email, notes, newClient: been === '' ? undefined : been === 'No' })); }
    catch (e: any) { setErr(e?.message || 'That didn’t save.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Add a booking" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Book it</Button></>}>
      <div className="panel-pad stack gap-16">
        <div className="form-grid">
          <Field label="Treatment">{(id) => <select id={id} className="select" value={type} onChange={(e: any) => { setType(e.target.value); setPerson(''); }}>{types.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.minutes} min{t.price ? `, ${t.price}` : ''})</option>)}</select>}</Field>
          {eligible.length > 1 && <Field label="With">{(id) => <select id={id} className="select" value={person} onChange={(e: any) => setPerson(e.target.value)}><option value="">Whoever is free</option>{eligible.map((p) => <option key={p} value={p}>{p}</option>)}</select>}</Field>}
          <Field label="Day">{(id) => <input id={id} className="input" type="date" value={day} min={londonDate(new Date())} onChange={(e: any) => setDay(e.target.value)} />}</Field>
        </div>
        <Field label="Time" as="group">{() => (
          <div className="time-chips">
            {slots === null && <span className="small faint">Finding free times…</span>}
            {slots && slots.length === 0 && <span className="small faint">No free times that day for this. Try another day{eligible.length > 1 ? ' or person' : ''}.</span>}
            {slots?.map((x) => <button key={x.id} type="button" className={`chip-time ${slot === x.id ? 'on' : ''}`} aria-pressed={slot === x.id} onClick={() => setSlot(x.id)}>{timeLabel(x.start)}{x.who && !person && eligible.length > 1 ? ` · ${x.who}` : ''}</button>)}
          </div>
        )}</Field>
        <div className="form-grid">
          <Field label="Client’s name">{(id) => <><input id={id} className="input" list="known-clients" value={name} onChange={(e: any) => pickName(e.target.value)} autoComplete="off" /><datalist id="known-clients">{known.map((k) => <option key={k.phone} value={k.name} />)}</datalist></>}</Field>
          <Field label="Mobile">{(id) => <input id={id} className="input" type="tel" value={phone} onChange={(e: any) => setPhone(e.target.value)} />}</Field>
          <Field label="Email" optional>{(id) => <input id={id} className="input" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} />}</Field>
          <Field label="Been before?" as="group">{(_, d) => <Choices name="been" options={['Yes', 'No']} value={been} describedBy={d} onChange={setBeen} />}</Field>
          <Field label="Notes" optional className="wide">{(id) => <input id={id} className="input" value={notes} onChange={(e: any) => setNotes(e.target.value)} placeholder="Anything the team should know" />}</Field>
        </div>
        {err && <p className="field-error" role="alert">{err}</p>}
        <p className="xsmall faint">{settings.automations.booking?.on ? 'They get the booking confirmation text straight away, and the reminder before the day.' : 'Booking messages are switched off, so nothing is sent to them.'}</p>
      </div>
    </Modal>
  );
}

/* ---------- The booking page ---------- */

function PageSetup() {
  const { settings, setSettings, enquiries } = useApp();
  const toast = useToast();
  const saved = pageOf(settings);
  const [d, setD] = useState<PageSettings>(saved);
  const [busy, setBusy] = useState(false);
  const [slugNote, setSlugNote] = useState('');
  const [preview, setPreview] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const url = `${PAGE_BASE}${d.slug}`;
  const names = settings.bookings.types.map((t) => t.name).filter(Boolean);
  const notDiary = settings.bookings.system !== GAINORA_DIARY;

  const checkSlug = async (raw: string) => {
    const r = await api.slugFree(raw).catch(() => null);
    if (!r) return;
    setD((x) => ({ ...x, slug: r.slug }));
    setSlugNote(r.free ? '' : 'Another business already uses this address. Try adding your town.');
  };
  const save = async (next: PageSettings, message = 'Saved.') => {
    setBusy(true);
    try { const s = { ...settings, page: next }; await api.saveSettings(s); setSettings(s); toast(message); }
    catch (e: any) { toast(e?.message || 'That didn’t save.'); }
    finally { setBusy(false); }
  };
  const previewApi: PageApi = useMemo(() => {
    const s = { ...settings, page: d };
    const r = depositRule(s.bookings);
    return {
      preview: api.mode !== 'demo',
      info: async () => publicPage(s, r ? { what: r.what, forWho: r.forWho, types: r.types } : null),
      times: (type, who, from, days) => api.diaryTimes(type, who, from, days),
      book: async (b) => {
        if (api.mode !== 'demo' || !api.pageBook) return { ok: false, message: 'This is a preview. Bookings are made on your live page.' };
        try {
          const e = await api.pageBook(b);
          const owes = !!r && (!r.types.length || r.types.includes(e.bookedType || '')) && (r.forWho === 'all' || b.newClient === true);
          const [start, who = ''] = b.slot.split('|');
          return { ok: true, status: e.status === 'booked' ? 'booked' : 'requested', when: sayTime({ start, end: start, who }), type: b.type, deposit: owes ? { what: r!.what, link: r!.link } : null };
        } catch (err: any) { return { ok: false, message: err?.message || 'That didn’t go through.', reason: /gone/.test(err?.message) ? 'taken' : undefined }; }
      },
    };
  }, [settings, d, enquiries]);
  const button = `<a href="${url}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:${d.accent || '#111214'};color:#fff;font:600 16px/1 system-ui,sans-serif;text-decoration:none">Book now</a>`;

  return (
    <div className="stack gap-24">
      <section className={`panel wf-card ${saved.on ? 'is-on' : ''}`}>
        <div className="wf-head">
          <span className="wf-icon"><Icon name="calendar" /></span>
          <div className="stack gap-4" style={{ minWidth: 0 }}>
            <h2 className="subhead">Your booking page</h2>
            <p className="small muted">A page where clients book themselves: treatment, time, details, done. Put it on your website, your Instagram bio and your Google profile. Bookings land in your diary and inbox, and the confirmation text goes out on its own.</p>
            <p className="small"><a href={url} target="_blank" rel="noreferrer">{url.replace('https://', '')}</a></p>
          </div>
          <div className="wf-controls">
            <Toggle on={saved.on} label={`Booking page: ${saved.on ? 'on' : 'off'}`} onChange={(on) => { setD({ ...d, on }); save({ ...saved, on }, on ? 'Your booking page is live.' : 'Your booking page is off.'); }} />
          </div>
        </div>
        <div className="wf-body">
          <Button small icon="copy" kind="secondary" onClick={async () => toast((await copyText(url)) ? 'Link copied.' : 'Select it and copy.')}>Copy link</Button>
          <Button small icon="search" kind="secondary" onClick={() => setPreview(true)}>Preview</Button>
          {saved.on && api.mode !== 'demo' && <a className="btn btn-quiet btn-small" href={url} target="_blank" rel="noreferrer"><Icon name="external" />Open</a>}
        </div>
        {notDiary && saved.on && (
          <p className="small muted" style={{ padding: '0 22px 18px' }}><Icon name="info" className="inline-icon" />Your main diary is in {settings.bookings.system || 'another system'}. Times booked there aren’t seen here until you connect it, so “I confirm each one” is the safer choice. See How it works.</p>
        )}
      </section>

      <section className="panel panel-pad stack gap-16">
        <h2 className="subhead">How it looks and works</h2>
        <div className="form-grid">
          <Field label="Page address" help={slugNote || 'Letters, numbers and dashes.'} error={slugNote || undefined}>{(id, desc) => (
            <div className="slug-field"><span className="small faint">capture.gainora.co.uk/book/</span><input id={id} className="input" value={d.slug} aria-describedby={desc} onChange={(e: any) => setD({ ...d, slug: e.target.value.toLowerCase() })} onBlur={(e: any) => checkSlug(e.target.value)} /></div>
          )}</Field>
          <Field label="When a client books" as="group" className="wide">{(_, desc) => <Choices name="pg-mode" options={['Booked straight in', 'I confirm each one']} value={d.mode === 'request' ? 'I confirm each one' : 'Booked straight in'} describedBy={desc} onChange={(v: string) => setD({ ...d, mode: v === 'I confirm each one' ? 'request' : 'book' })} />}</Field>
          {names.length > 0 && <Field label="Treatments on the page" as="group" className="wide" help="Choose none to show them all.">{(_, desc) => <Choices name="pg-types" multi options={names} value={d.types} describedBy={desc} onChange={(v: string[]) => setD({ ...d, types: v })} />}</Field>}
          <Field label="Show prices" as="group">{(_, desc) => <Choices name="pg-price" options={['Yes', 'No']} value={d.showPrices ? 'Yes' : 'No'} describedBy={desc} onChange={(v: string) => setD({ ...d, showPrices: v === 'Yes' })} />}</Field>
          {teamOf(settings).length > 1 && <Field label="Clients choose who they see" as="group">{(_, desc) => <Choices name="pg-staff" options={['Yes', 'No']} value={d.chooseStaff ? 'Yes' : 'No'} describedBy={desc} onChange={(v: string) => setD({ ...d, chooseStaff: v === 'Yes' })} />}</Field>}
          <Field label="A welcome line" optional className="wide">{(id) => <textarea id={id} className="textarea" rows={2} value={d.intro} placeholder={isBeauty(settings.business) ? 'Book your treatment in under a minute. New to us? Choose a free consultation first.' : 'Book online in under a minute.'} onChange={(e: any) => setD({ ...d, intro: e.target.value })} />}</Field>
          <Field label="Your colour" as="group" className="wide" help="Buttons and highlights. Text on it switches between black and white to stay readable.">{() => (
            <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
              {['', '#1F3A33', '#6B4E3D', '#8C5A6B', '#2F4A6D', '#B08D57'].map((c) => (
                <button key={c || 'default'} type="button" className={`swatch ${d.accent === c ? 'on' : ''}`} style={{ background: c || '#111214' }} aria-label={c ? `Colour ${c}` : 'Gainora black'} aria-pressed={d.accent === c} onClick={() => setD({ ...d, accent: c })} />
              ))}
              <label className="small row gap-8" style={{ alignItems: 'center' }}>Your own<input type="color" value={d.accent || '#111214'} onChange={(e: any) => setD({ ...d, accent: e.target.value })} /></label>
            </div>
          )}</Field>
        </div>
        <div className="row gap-8 wrap" style={{ justifyContent: 'flex-end' }}>
          {dirty && <Button kind="secondary" small onClick={() => setD(saved)}>Undo changes</Button>}
          <Button small kind="secondary" icon="search" onClick={() => setPreview(true)}>Preview</Button>
          <Button small busy={busy} disabled={!dirty || !!slugNote} onClick={() => save(d)}>Save</Button>
        </div>
      </section>

      <section className="panel panel-pad stack gap-12">
        <h2 className="subhead">Put it where clients look</h2>
        <ul className="share-list small">
          <li><strong>Instagram:</strong> Edit profile, Links, Add external link, and paste your page address. Add a “Book” button with the same link.</li>
          <li><strong>Google:</strong> in your Business Profile, Bookings, add your page address as your booking link, so “Book” shows on Google search and Maps.</li>
          <li><strong>Your website:</strong> ask your web person to add this button, or paste it into your site builder’s HTML block.</li>
        </ul>
        <div className="secret"><code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{button}</code><Button small icon="copy" onClick={async () => toast((await copyText(button)) ? 'Button code copied.' : 'Select it and copy.')}>Copy</Button></div>
      </section>

      {preview && (
        <Modal title="Your booking page" onClose={() => setPreview(false)} footer={<Button onClick={() => setPreview(false)}>Done</Button>}>
          <div className="phone-frame"><BookingPage api={previewApi} /></div>
          {api.mode === 'demo' && <p className="xsmall faint panel-pad">In the demo, a booking made here lands in your diary and inbox, with the confirmation text.</p>}
        </Modal>
      )}
    </div>
  );
}

/* ---------- How the diary works ---------- */

function DiarySetup() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const gainora = settings.bookings.system === GAINORA_DIARY;
  const rules = { step: Number(settings.diary?.step) || 15, buffer: Number(settings.diary?.buffer) || 0 };
  const [busy, setBusy] = useState('');
  const save = async (next: CaptureSettings, message = 'Saved.', key = 'x') => {
    setBusy(key);
    try { await api.saveSettings(next); setSettings(next); toast(message); }
    catch (e: any) { toast(e?.message || 'That didn’t save.'); }
    finally { setBusy(''); }
  };
  return (
    <div className="stack gap-24">
      <section className="panel panel-pad stack gap-12">
        <h2 className="subhead">Where your diary lives</h2>
        {gainora ? (
          <p className="small muted">Gainora is your diary. Your booking page, your receptionist and you all book into it, so a time can’t be given out twice.</p>
        ) : (
          <>
            <p className="small muted">Your main diary is {settings.bookings.system ? <>in <strong>{settings.bookings.system}</strong></> : 'not set'}. Gainora keeps the bookings made through it here too. Until your diary is connected, times booked directly in {settings.bookings.system || 'it'} aren’t seen here, so your booking page should be set to “I confirm each one”.</p>
            <p className="small muted">Ready to switch? Run your diary in Gainora: one place for every booking, with the receptionist and your page booking straight in.</p>
            <div><Button small busy={busy === 'use'} onClick={() => save({ ...settings, bookings: { ...settings.bookings, system: GAINORA_DIARY, mode: settings.bookings.mode === 'callback' ? 'book' : settings.bookings.mode } }, 'Gainora is now your diary.', 'use')}>Run my diary in Gainora</Button></div>
          </>
        )}
      </section>

      <section className="panel panel-pad stack gap-16">
        <h2 className="subhead">Diary rules</h2>
        <div className="form-grid">
          <Field label="Start times every" help="How the day is split into times you can book.">{(id) => (
            <select id={id} className="select" value={rules.step} onChange={(e: any) => save({ ...settings, diary: { ...settings.diary, step: Number(e.target.value) } }, 'Saved.', 'step')}>
              {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          )}</Field>
          <Field label="Gap after each appointment" help="Time to clean down and get ready.">{(id) => (
            <select id={id} className="select" value={rules.buffer} onChange={(e: any) => save({ ...settings, diary: { ...settings.diary, buffer: Number(e.target.value) } }, 'Saved.', 'buffer')}>
              {[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m ? `${m} minutes` : 'No gap'}</option>)}
            </select>
          )}</Field>
          <Field label="Shortest notice">{(id) => (
            <select id={id} className="select" value={settings.bookings.noticeHours} onChange={(e: any) => save({ ...settings, bookings: { ...settings.bookings, noticeHours: Number(e.target.value) } }, 'Saved.', 'notice')}>
              {[0, 1, 2, 4, 24, 48].map((h) => <option key={h} value={h}>{h === 0 ? 'Any time' : h < 24 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h / 24} ${h === 24 ? 'day' : 'days'}`}</option>)}
            </select>
          )}</Field>
          <Field label="How far ahead">{(id) => (
            <select id={id} className="select" value={settings.bookings.aheadWeeks} onChange={(e: any) => save({ ...settings, bookings: { ...settings.bookings, aheadWeeks: Number(e.target.value) } }, 'Saved.', 'ahead')}>
              {[1, 2, 4, 6, 8, 12].map((w) => <option key={w} value={w}>{w} {w === 1 ? 'week' : 'weeks'}</option>)}
            </select>
          )}</Field>
        </div>
        <p className="small muted">Open {hoursText(settings.calls) || 'hours not set'}. Treatments, lengths, prices and who does what are in <Link to="/settings">Settings, Bookings</Link>.</p>
      </section>

      <ImportCard />

      <section className="stack gap-12" aria-labelledby="conn-h">
        <div><h2 className="subhead" id="conn-h">Connect your calendar or booking system</h2><p className="small muted">So nobody is ever booked twice, whichever way they book.</p></div>
        <Connections />
      </section>
    </div>
  );
}
