import { useEffect, useMemo, useRef, useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, Choices, ErrorNote, Field, Icon, Loading, Modal, Stars, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { Link, navigate, queryParam } from '../lib/router';
import { money, relative, shortDate, uuid } from '../lib/format';
import {
  CONSENT_LABEL, DEFAULT_SETTINGS, REVIEW_ASK_GAP_DAYS, canMessage, dueFor, dueGroups, exportClient, filterClients, firstNameOf, normaliseEmail, normalisePhone, optOut, snoozeUntil, suggestAmount, summarise, treatmentIdFor,
  type Client, type ClientFilter, type ClientSettings, type Consent, type DueInfo, type MessageKind, type Visit,
} from '../../shared/clients';
import { CATALOGUE, matchTreatment, treatmentById } from '../../shared/treatments';
import { parsePriceList } from '../../shared/booking';
import { priceValue } from '../../shared/prices';
import { forSms, hasIncentive, mentionsHealth, rebookText, reviewLink, reviewReplyDraft, reviewRequestText, safeReply, smsLink, smsSegments, type Voice } from '../../shared/drafts';
import { ACTION_LABEL, coverLine, moneySentence, moneySummary, type ClientAction, type Outcome } from '../../shared/money';
import { buildImport, detectColumns, FIELD_LABEL, guessSystem, MAX_FILE_BYTES, MAX_ROWS, parseCsv, readFile, toRecords, type ImportField, type ImportResult, type Mapping } from '../../shared/import';
import { startOfMonth } from '../../shared/value';
import type { BusinessProfile, ClientsData, ReviewItem, WatcherState } from '../lib/types';

type Tab = 'clients' | 'due' | 'reviews' | 'bookings' | 'import';
const TABS: Tab[] = ['clients', 'due', 'reviews', 'bookings', 'import'];
const initialTab = (): Tab => { const t = queryParam('tab') as Tab | null; return t && TABS.includes(t) ? t : 'clients'; };
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Shared bits ---------- */
const voiceOf = (p: BusinessProfile): Voice => ({ clinic: p.business.name, owner: firstNameOf(p.business.ownerName), style: p.preferences?.style, bookingUrl: p.offer?.bookingUrl || undefined });
const settingsOf = (p: BusinessProfile): ClientSettings => p.clientSettings ?? {};
/** The owner's own list prices by catalogue id, for pre-filling a visit's amount. */
function ownerPrices(p: BusinessProfile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of parsePriceList(p.offer?.priceList || '')) { const m = matchTreatment(r.name); const v = priceValue(r.price); if (m && v && !out[m.id]) out[m.id] = v; }
  return out;
}
const DUE_TAG: Record<DueInfo['status'], { label: (d: DueInfo) => string; cls: string }> = {
  overdue: { label: (d) => `Overdue by ${d.weeksOverdue} week${d.weeksOverdue === 1 ? '' : 's'}`, cls: 'tag-danger' },
  due: { label: () => 'Due this week', cls: 'tag-brass' },
  upcoming: { label: (d) => `Due ${shortDate(d.dueAt!)}`, cls: 'tag-plain' },
  snoozed: { label: () => 'Reminder snoozed', cls: 'tag-plain' },
  not_coming_back: { label: () => 'Not coming back', cls: 'tag-plain' },
  lapsed: { label: (d) => `Lapsed, last seen ${d.lastVisitAt ? shortDate(d.lastVisitAt) : 'a while ago'}`, cls: 'tag-plain' },
  none: { label: () => 'No due date yet', cls: 'tag-plain' },
};
const CONSENT_SHORT: Record<Consent, { label: string; cls: string }> = {
  opted_in: { label: 'Opted in', cls: 'tag-forest' }, soft_opt_in: { label: 'Existing client', cls: 'tag-plain' }, opted_out: { label: 'Opted out', cls: 'tag-danger' }, unknown: { label: 'No consent', cls: 'tag-brass' },
};

interface Ctx {
  data: ClientsData; setData: (d: ClientsData) => void;
  profile: BusinessProfile; settings: ClientSettings; voice: Voice; prices: Record<string, number>;
  watcher: WatcherState | null;
  toast: (m: string) => void;
}

/** Records a message the owner approved and sent, keeps the list in step, and respects the review-ask date. */
async function recordSent(ctx: Ctx, a: ClientAction): Promise<void> {
  const saved = await api.recordAction(a);
  const clients = a.kind === 'review_request' && a.clientId ? ctx.data.clients.map((c) => (c.id === a.clientId ? { ...c, lastReviewAskAt: a.sentAt } : c)) : ctx.data.clients;
  ctx.setData({ ...ctx.data, actions: [saved, ...ctx.data.actions], clients });
}

export function Clients() {
  const { profile } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.listClients());
  const { data: watcher } = useLoad(() => api.getWatcher().catch(() => null));
  const [tab, setTab] = useState<Tab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(() => queryParam('client'));
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  if (loading && !data) return <Loading label="Loading your clients" />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'Your clients could not load.'} retry={reload} /></div>;

  const ctx: Ctx = { data, setData, profile, settings: settingsOf(profile), voice: voiceOf(profile), prices: ownerPrices(profile), watcher: watcher ?? null, toast };
  const dueN = dueGroups(data.clients, data.visits, ctx.settings).reduce((a, g) => a + g.items.length, 0);
  const askable = reviewCandidates(ctx).length;
  const likelyN = data.outcomes.filter((o) => o.status === 'likely').length;
  const open = openId ? data.clients.find((c) => c.id === openId) : null;

  if (!data.ready) return <div className="page"><PageHead ctx={ctx} onAdd={() => {}} disabled /><NotReady /></div>;
  if (open) return <div className="page"><ClientDetail ctx={ctx} client={open} onBack={() => { setOpenId(null); navigate('/clients'); }} /></div>;

  return (
    <div className="page">
      <PageHead ctx={ctx} onAdd={() => setAdding(true)} onImport={() => setTab('import')} />
      {data.clients.length === 0 && tab === 'clients' ? <EmptyStart ctx={ctx} onAdd={() => setAdding(true)} onImport={() => setTab('import')} /> : (
        <>
          <Tabs label="Your clients sections" value={tab} onChange={setTab} tabs={[
            { id: 'clients', label: 'Clients', badge: data.clients.length || null },
            { id: 'due', label: 'Due back', badge: dueN || null },
            { id: 'reviews', label: 'Reviews', badge: askable || null },
            { id: 'bookings', label: 'Bookings', badge: likelyN ? `${likelyN} to confirm` : null },
            { id: 'import', label: 'Import' },
          ]} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" key={tab}>
            {tab === 'clients' && <ClientList ctx={ctx} onOpen={(id) => { setOpenId(id); }} />}
            {tab === 'due' && <DueBack ctx={ctx} onOpen={setOpenId} />}
            {tab === 'reviews' && <ReviewsTab ctx={ctx} />}
            {tab === 'bookings' && <Bookings ctx={ctx} />}
            {tab === 'import' && <ImportTab ctx={ctx} onDone={() => setTab('due')} />}
          </div>
        </>
      )}
      {adding && <AddClientModal ctx={ctx} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setOpenId(id); }} />}
    </div>
  );
}

function PageHead({ ctx, onAdd, onImport, disabled }: { ctx: Ctx; onAdd: () => void; onImport?: () => void; disabled?: boolean }) {
  const n = ctx.data.clients.length;
  return (
    <div className="page-head">
      <div>
        <h1 className="title">Your clients</h1>
        <p className="lede">{n ? `${n} client${n === 1 ? '' : 's'} and ${ctx.data.visits.length} visit${ctx.data.visits.length === 1 ? '' : 's'}. ` : ''}Who is due back, who to ask for a review, and the bookings that came from it. Every message is yours to approve and send.</p>
      </div>
      {!disabled && (
        <div className="row gap-8 wrap">
          {onImport && <Button kind="secondary" icon="download" onClick={onImport}>Import</Button>}
          <Button icon="plus" onClick={onAdd}>Add client</Button>
        </div>
      )}
    </div>
  );
}

function NotReady() {
  return (
    <section className="panel panel-pad" style={{ maxWidth: 720 }} aria-label="Your clients is being set up">
      <div className="agent-icon" style={{ marginBottom: 18 }}><Icon name="clock" /></div>
      <h2 className="heading">Your clients is being set up</h2>
      <p className="muted mt-8" style={{ fontSize: 'var(--t-md)' }}>This part of Gainora needs a small addition to your account’s database, which Gainora is adding. Nothing else is affected: your agents keep running as usual. Check back shortly, or email <a href="mailto:hello@gainora.co.uk">hello@gainora.co.uk</a> if this is still here tomorrow.</p>
      <p className="small faint mt-16">Once it is ready you can add clients by hand or import a file from Fresha, Phorest, Pabau, Booksy, Timely or Treatwell, and Gainora will tell you who is due back.</p>
    </section>
  );
}

function EmptyStart({ ctx, onAdd, onImport }: { ctx: Ctx; onAdd: () => void; onImport: () => void }) {
  const system = ctx.profile.offer?.bookingSystem && ctx.profile.offer.bookingSystem !== 'None' && ctx.profile.offer.bookingSystem !== 'Other' ? ctx.profile.offer.bookingSystem : null;
  return (
    <div className="start-grid">
      <section className="panel panel-pad start-card" aria-labelledby="imp-h">
        <span className="biz-kicker" style={{ color: 'var(--gold)' }}>Fastest</span>
        <h2 className="heading mt-8" id="imp-h">Import your clients{system ? ` from ${system}` : ''}</h2>
        <p className="muted mt-8">{system ? `Export your clients or sales from ${system} as a CSV or Excel file and drop it here.` : 'Export your clients from your booking system, or any spreadsheet with names, mobiles and visit dates, and drop it here.'} Gainora reads it on your phone or computer, matches the columns, and shows you who is due back before anything is saved.</p>
        <div className="mt-24"><Button icon="download" onClick={onImport}>Import a file</Button></div>
      </section>
      <section className="panel panel-pad start-card" aria-labelledby="add-h">
        <span className="biz-kicker" style={{ color: 'var(--gold)' }}>By hand</span>
        <h2 className="heading mt-8" id="add-h">Add a client</h2>
        <p className="muted mt-8">Name, mobile and their last visit is enough. Gainora works out when they are due from the treatment, and you can set your own gap for anyone who comes more or less often.</p>
        <div className="mt-24"><Button kind="secondary" icon="plus" onClick={onAdd}>Add a client</Button></div>
      </section>
      <section className="panel panel-pad start-card start-wide" aria-labelledby="what-h">
        <h2 className="subhead" id="what-h">What you get once your clients are in</h2>
        <ul className="start-list">
          <li><strong>Due back.</strong> Who is due or overdue, grouped by treatment, with what their last visit was worth, and a short personal text drafted for each. You approve and send from your phone.</li>
          <li><strong>Reviews.</strong> After a visit, a text asking for a Google review with your review link, never more than once every {REVIEW_ASK_GAP_DAYS} days per client, never with an incentive.</li>
          <li><strong>The money number.</strong> Mark “this got a booking” and Home shows what Gainora helped bring in this month, with the list behind it.</li>
          <li><strong>Their rights.</strong> Consent recorded per client, STOP honoured everywhere, export and delete for any client, delete everything in one go.</li>
        </ul>
      </section>
    </div>
  );
}

/* ---------- The list ---------- */
const FILTERS: { id: ClientFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'due', label: 'Due back' }, { id: 'lapsed', label: 'Lapsed' }, { id: 'top', label: 'Top spenders' }, { id: 'no_consent', label: 'No consent' }, { id: 'opted_out', label: 'Opted out' }];

function ClientList({ ctx, onOpen }: { ctx: Ctx; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [treatmentId, setTreatmentId] = useState('');
  const [visitFor, setVisitFor] = useState<Client | null>(null);
  const treatments = useMemo(() => { const ids = new Set(ctx.data.visits.map((v) => v.treatmentId).filter(Boolean) as string[]); return [...ids].map((id) => treatmentById(id)!).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label)); }, [ctx.data.visits]);
  const list = filterClients(ctx.data.clients, ctx.data.visits, ctx.settings, { q, filter, treatmentId: treatmentId || null });
  return (
    <>
      <div className="client-tools">
        <label className="client-search">
          <Icon name="search" />
          <input className="input" placeholder="Search by name, mobile or treatment" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Search clients" />
        </label>
        <div className="row gap-8 wrap">
          <div className="seg" role="group" aria-label="Show">
            {FILTERS.map((f) => <button key={f.id} type="button" className="seg-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
          </div>
          {treatments.length > 0 && (
            <select className="select" style={{ minHeight: 42, width: 'auto', padding: '6px 34px 6px 12px' }} value={treatmentId} onChange={(e: any) => setTreatmentId(e.target.value)} aria-label="Treatment">
              <option value="">Any treatment</option>
              {treatments.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="panel rows">
        {list.length === 0 && <div className="empty"><p className="muted">No clients match. Try another filter or search.</p></div>}
        {list.slice(0, 200).map((c) => <ClientRow key={c.id} ctx={ctx} c={c} onOpen={() => onOpen(c.id)} onVisit={() => setVisitFor(c)} />)}
        {list.length > 200 && <p className="empty small faint">Showing the first 200. Search to narrow it down.</p>}
      </div>
      {visitFor && <AddVisitModal ctx={ctx} client={visitFor} onClose={() => setVisitFor(null)} />}
    </>
  );
}

function ClientRow({ ctx, c, onOpen, onVisit }: { ctx: Ctx; c: Client; onOpen: () => void; onVisit: () => void }) {
  const s = summarise(ctx.data.visits.filter((v) => v.clientId === c.id));
  const d = dueFor(c, ctx.data.visits, ctx.settings);
  const tag = DUE_TAG[d.status];
  return (
    <div className="client-row">
      <button type="button" className="client-main" onClick={onOpen}>
        <span className="client-name">{c.name}</span>
        <span className="small muted client-sub">{s.lastVisitAt ? `${s.lastTreatment}, ${shortDate(s.lastVisitAt)}` : 'No visits yet'}{s.totalSpent ? ` · ${money(s.totalSpent)} over ${s.visits} visit${s.visits === 1 ? '' : 's'}` : ''}</span>
        <span className="row gap-6 wrap client-tags">
          {d.status !== 'upcoming' && d.status !== 'none' && <span className={`tag ${tag.cls}`}>{tag.label(d)}</span>}
          <span className={`tag ${CONSENT_SHORT[c.consent].cls}`}>{CONSENT_SHORT[c.consent].label}</span>
        </span>
      </button>
      <div className="client-actions">
        <Button kind="secondary" small icon="plus" onClick={onVisit} aria-label={`Add a visit for ${c.name}`}>Visit</Button>
        <button type="button" className="todo-go" onClick={onOpen} aria-label={`Open ${c.name}`}><Icon name="chevron" /></button>
      </div>
    </div>
  );
}

/* ---------- Add a client ---------- */
function AddClientModal({ ctx, onClose, onSaved }: { ctx: Ctx; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [consent, setConsent] = useState<'Existing client' | 'Opted in' | 'Not asked yet'>('Existing client');
  const [withVisit, setWithVisit] = useState(true);
  const [at, setAt] = useState(today()); const [treatment, setTreatment] = useState(''); const [amount, setAmount] = useState(''); const [practitioner, setPractitioner] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const tid = treatmentIdFor(treatment);
  useEffect(() => { if (tid && !amount && ctx.prices[tid]) setAmount(String(ctx.prices[tid])); }, [tid]);
  const save = async () => {
    const nm = name.trim(); if (!nm) { setErr('Add their name.'); return; }
    const ph = normalisePhone(phone); if (phone.trim() && !ph) { setErr('That doesn’t look like a UK mobile (texts need a mobile). Leave it blank if you only have a landline.'); return; }
    if (email.trim() && !normaliseEmail(email)) { setErr('That email doesn’t look right.'); return; }
    if (withVisit && !/^\d{4}-\d{2}-\d{2}$/.test(at)) { setErr('Pick the visit date.'); return; }
    if (withVisit && amount && !/^\d+(\.\d{1,2})?$/.test(amount.replace(/[£,\s]/g, ''))) { setErr('The amount needs to be a number.'); return; }
    const dup = ctx.data.clients.find((c) => (ph && c.phone === ph) || (normaliseEmail(email) && c.email === normaliseEmail(email)));
    if (dup) { setErr(`${dup.name} already has that ${ph && dup.phone === ph ? 'mobile' : 'email'}. Open them and add the visit there.`); return; }
    setErr(null); setBusy(true);
    try {
      const now = new Date().toISOString();
      const c: Client = { id: uuid(), name: nm, phone: ph ?? '', phoneRaw: !ph && phone.trim() ? phone.trim() : undefined, email: normaliseEmail(email), consent: consent === 'Opted in' ? 'opted_in' : consent === 'Existing client' ? 'soft_opt_in' : 'unknown', consentAt: consent === 'Opted in' ? now : null, consentSource: 'owner', source: 'manual', createdAt: now };
      const saved = await api.saveClient(c);
      let visits = ctx.data.visits;
      if (withVisit) {
        const v: Visit = { id: uuid(), clientId: saved.id, at, treatment: treatment.trim() || 'Visit', treatmentId: tid, amount: amount ? Number(amount.replace(/[£,\s]/g, '')) : null, practitioner: practitioner.trim() || null, createdAt: now };
        const r = await api.addVisit(v); visits = [r.visit, ...visits];
      }
      ctx.setData({ ...ctx.data, clients: [saved, ...ctx.data.clients], visits });
      ctx.toast(`${firstNameOf(nm)} added.`); onSaved(saved.id);
    } catch (e: any) { setErr(humanThrown(e, 'That didn’t save. Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add a client" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save client</Button></>}>
      <div className="modal-form">
        <Field label="Name">{(id) => <input id={id} className="input" value={name} onChange={(e: any) => setName(e.target.value)} autoFocus />}</Field>
        <div className="two">
          <Field label="Mobile" optional help="UK mobile, for texts.">{(id, d) => <input id={id} aria-describedby={d} className="input" inputMode="tel" placeholder="07700 900123" value={phone} onChange={(e: any) => setPhone(e.target.value)} />}</Field>
          <Field label="Email" optional>{(id) => <input id={id} className="input" inputMode="email" value={email} onChange={(e: any) => setEmail(e.target.value)} />}</Field>
        </div>
        <Field label="Marketing texts" as="group" help="Existing clients can be texted about similar treatments as long as every text offers an opt-out (the soft opt-in). “Opted in” means they said yes explicitly.">
          {(_, d) => <Choices name="consent" options={['Existing client', 'Opted in', 'Not asked yet']} value={consent} onChange={setConsent} describedBy={d} />}
        </Field>
        <label className="row gap-8 small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={withVisit} onChange={(e: any) => setWithVisit(e.target.checked)} /> Add their last visit now</label>
        {withVisit && <VisitFields at={at} setAt={setAt} treatment={treatment} setTreatment={setTreatment} amount={amount} setAmount={setAmount} practitioner={practitioner} setPractitioner={setPractitioner} recent={[]} />}
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function VisitFields(p: { at: string; setAt: (v: string) => void; treatment: string; setTreatment: (v: string) => void; amount: string; setAmount: (v: string) => void; practitioner: string; setPractitioner: (v: string) => void; recent: string[] }) {
  const tid = treatmentIdFor(p.treatment);
  return (
    <>
      {p.recent.length > 0 && (
        <div className="stack gap-8">
          <span className="field-label">Treatment</span>
          <div className="choices">{p.recent.map((t) => <button type="button" key={t} className={`choice ${p.treatment === t ? 'on' : ''}`} onClick={() => p.setTreatment(t)}>{t}</button>)}</div>
        </div>
      )}
      <Field label={p.recent.length ? 'Or another treatment' : 'Treatment'} help={tid ? `Matched to ${treatmentById(tid)!.label}, so the due date and prices line up.` : p.treatment ? 'Not in the catalogue; set a gap per client for a due date.' : 'Start typing; pick from the list or write your own.'}>
        {(id, d) => <><input id={id} aria-describedby={d} className="input" list="treatment-list" value={p.treatment} onChange={(e: any) => p.setTreatment(e.target.value)} placeholder="Anti-wrinkle injections – 2 areas" />
          <datalist id="treatment-list">{CATALOGUE.map((t) => <option key={t.id} value={t.label} />)}</datalist></>}
      </Field>
      <div className="two">
        <Field label="Date">{(id) => <input id={id} type="date" className="input" value={p.at} max={today()} onChange={(e: any) => p.setAt(e.target.value)} />}</Field>
        <Field label="Amount paid" optional>{(id) => <div className="prefix-input"><span>£</span><input id={id} className="input" inputMode="decimal" value={p.amount} onChange={(e: any) => p.setAmount(e.target.value)} /></div>}</Field>
      </div>
      <Field label="Practitioner" optional>{(id) => <input id={id} className="input" value={p.practitioner} onChange={(e: any) => p.setPractitioner(e.target.value)} />}</Field>
    </>
  );
}

/* ---------- Add a visit: the most common action, so the defaults do the work ---------- */
function AddVisitModal({ ctx, client, onClose }: { ctx: Ctx; client: Client; onClose: () => void }) {
  const mine = ctx.data.visits.filter((v) => v.clientId === client.id);
  const s = summarise(mine);
  const recent = [...new Set(mine.sort((a, b) => b.at.localeCompare(a.at)).map((v) => v.treatment))].slice(0, 4);
  const [treatment, setTreatment] = useState(s.lastTreatment ?? '');
  const tid = treatmentIdFor(treatment);
  const [at, setAt] = useState(today());
  const [amount, setAmount] = useState(() => { const a = suggestAmount(treatmentIdFor(s.lastTreatment ?? ''), s, ctx.prices); return a != null ? String(a) : ''; });
  const [practitioner, setPractitioner] = useState(mine[0]?.practitioner ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ likely: Outcome[] } | null>(null);
  useEffect(() => { const a = suggestAmount(tid, s, ctx.prices); if (a != null) setAmount(String(a)); }, [tid]);
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) { setErr('Pick the date.'); return; }
    const amt = amount.replace(/[£,\s]/g, '');
    if (amt && !/^\d+(\.\d{1,2})?$/.test(amt)) { setErr('The amount needs to be a number.'); return; }
    setBusy(true); setErr(null);
    try {
      const v: Visit = { id: uuid(), clientId: client.id, at, treatment: treatment.trim() || 'Visit', treatmentId: tid, amount: amt ? Number(amt) : null, practitioner: practitioner.trim() || null, createdAt: new Date().toISOString() };
      const r = await api.addVisit(v);
      ctx.setData({ ...ctx.data, visits: [r.visit, ...ctx.data.visits], outcomes: [...r.likely, ...ctx.data.outcomes] });
      setDone({ likely: r.likely });
    } catch (e: any) { setErr(humanThrown(e, 'That didn’t save. Try again.')); }
    finally { setBusy(false); }
  };
  const canAsk = ctx.watcher?.reviews?.placeId && canMessage(client, 'review_request', { visits: mine.length + 1, sent: ctx.data.actions, settings: ctx.settings }).ok;
  if (done) {
    return (
      <Modal title={`Visit added for ${firstNameOf(client.name)}`} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Done</Button>{canAsk && <Link to="/clients?tab=reviews" className="btn btn-primary" onClick={onClose}>Ask for a review</Link>}</>}>
        <div className="modal-form">
          {done.likely.length > 0 && <p className="booking-note"><Icon name="info" /><span>This visit came within {21} days of a text Gainora drafted for {firstNameOf(client.name)}. It is listed under Bookings as <strong>likely</strong>; confirm it there if the text brought them in, and it counts towards this month’s number.</span></p>}
          {canAsk ? <p className="muted">If {firstNameOf(client.name)} was happy today, now is the moment to ask for a Google review. The text is drafted with your review link under Reviews.</p> : <p className="muted">Saved. {firstNameOf(client.name)}’s due date has moved on.</p>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Add a visit for ${firstNameOf(client.name)}`} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save visit</Button></>}>
      <div className="modal-form">
        <VisitFields at={at} setAt={setAt} treatment={treatment} setTreatment={setTreatment} amount={amount} setAmount={setAmount} practitioner={practitioner} setPractitioner={setPractitioner} recent={recent} />
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/* ---------- One client ---------- */
function ClientDetail({ ctx, client, onBack }: { ctx: Ctx; client: Client; onBack: () => void }) {
  const mine = ctx.data.visits.filter((v) => v.clientId === client.id).sort((a, b) => b.at.localeCompare(a.at));
  const s = summarise(mine);
  const d = dueFor(client, ctx.data.visits, ctx.settings);
  const sent = ctx.data.actions.filter((a) => a.clientId === client.id);
  const outcomes = ctx.data.outcomes.filter((o) => o.clientId === client.id);
  const [visiting, setVisiting] = useState(false);
  const [interval, setInterval_] = useState(client.intervalWeeks ? String(client.intervalWeeks) : '');
  const [notes, setNotes] = useState(client.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [booking, setBooking] = useState<ClientAction | null | 'manual'>(null);
  const [draft, setDraft] = useState<{ kind: MessageKind; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const update = async (patch: Partial<Client>, msg?: string) => {
    setBusy(true);
    try { const saved = await api.saveClient({ ...client, ...patch }); ctx.setData({ ...ctx.data, clients: ctx.data.clients.map((c) => (c.id === client.id ? saved : c)) }); if (msg) ctx.toast(msg); }
    catch (e: any) { ctx.toast(humanThrown(e, 'That didn’t save. Try again.')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.deleteClient(client.id); ctx.setData({ ...ctx.data, clients: ctx.data.clients.filter((c) => c.id !== client.id), visits: ctx.data.visits.filter((v) => v.clientId !== client.id), actions: ctx.data.actions.filter((a) => a.clientId !== client.id), outcomes: ctx.data.outcomes.filter((o) => o.clientId !== client.id) }); ctx.toast(`${client.name} and everything about them has been deleted.`); onBack(); }
    catch (e: any) { ctx.toast(humanThrown(e, 'Could not delete. Try again.')); setBusy(false); }
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportClient(client, ctx.data.visits, sent), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${client.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-gainora.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const deleteVisit = async (v: Visit) => {
    try { await api.deleteVisit(v.id); ctx.setData({ ...ctx.data, visits: ctx.data.visits.filter((x) => x.id !== v.id) }); } catch (e: any) { ctx.toast(humanThrown(e, 'Could not delete that visit.')); }
  };
  const perm = canMessage(client, 'rebook', { visits: mine.length, sent: ctx.data.actions, settings: ctx.settings });
  const tag = DUE_TAG[d.status];
  const intervalLine = d.intervalWeeks ? `${d.intervalWeeks} weeks (${d.intervalSource === 'client' ? 'your gap for this client' : d.intervalSource === 'setting' ? 'your setting for this treatment' : 'the typical gap'})` : 'no gap known for this treatment';
  return (
    <>
      <button className="btn btn-quiet btn-small" onClick={onBack} style={{ marginBottom: 14, marginLeft: -10 }}><Icon name="back" />All clients</button>
      <div className="client-hero">
        <div className="client-hero-top">
          <div className="stack gap-8" style={{ minWidth: 0 }}>
            <h1 className="title">{client.name}</h1>
            <div className="row gap-12 wrap small">
              {client.phone ? <a href={`tel:${client.phone}`} className="client-link">{client.phone.replace('+44', '0')}</a> : client.phoneRaw ? <span className="faint">{client.phoneRaw} (not a mobile)</span> : <span className="faint">No mobile</span>}
              {client.email && <a href={`mailto:${client.email}`} className="client-link">{client.email}</a>}
              <span className={`tag ${CONSENT_SHORT[client.consent].cls}`}>{CONSENT_SHORT[client.consent].label}</span>
            </div>
          </div>
          <div className="row gap-8 wrap">
            <Button icon="plus" onClick={() => setVisiting(true)}>Add visit</Button>
            {perm.ok && <Button kind="secondary" icon="send" onClick={() => setDraft({ kind: 'rebook', text: rebookText(ctx.voice, { name: client.name, treatment: d.treatment ?? s.lastTreatment, treatmentId: d.treatmentId ?? s.lastTreatmentId, lastVisitAt: s.lastVisitAt }) })}>Text to rebook</Button>}
            <Button kind="secondary" icon="tag" onClick={() => setBooking('manual')}>This got a booking</Button>
          </div>
        </div>
        <div className="client-figures">
          <div><span className="biz-figure-label">Visits</span><span className="client-figure">{s.visits}</span></div>
          <div><span className="biz-figure-label">Spent</span><span className="client-figure">{money(s.totalSpent)}</span></div>
          <div><span className="biz-figure-label">Last visit</span><span className="client-figure small-figure">{s.lastVisitAt ? shortDate(s.lastVisitAt) : '–'}</span><span className="xsmall faint">{s.lastTreatment ?? ''}</span></div>
          <div><span className="biz-figure-label">Due back</span><span className="client-figure small-figure">{d.dueAt ? shortDate(d.dueAt) : '–'}</span><span className={`tag ${tag.cls}`} style={{ alignSelf: 'flex-start', marginTop: 4 }}>{tag.label(d)}</span></div>
        </div>
      </div>

      <div className="grid-2 section">
        <section className="panel" aria-labelledby="visits-h">
          <div className="panel-head"><h2 className="heading" id="visits-h">Visits</h2><span className="small faint">{mine.length}</span></div>
          <div className="rows">
            {mine.length === 0 && <div className="empty"><p className="muted">No visits yet. Add the last one and the due date appears.</p></div>}
            {mine.map((v) => (
              <div className="visit-row" key={v.id}>
                <span className="small faint tabular">{shortDate(v.at)}</span>
                <span className="stack gap-4" style={{ minWidth: 0 }}><span>{v.treatment}</span>{v.practitioner && <span className="xsmall faint">with {v.practitioner}</span>}</span>
                <span className="tabular" style={{ fontWeight: 600 }}>{v.amount != null ? money(v.amount) : '–'}</span>
                <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label={`Delete the visit on ${shortDate(v.at)}`} onClick={() => deleteVisit(v)}><Icon name="x" /></button>
              </div>
            ))}
          </div>
        </section>

        <div className="stack gap-16">
          <section className="panel panel-pad" aria-labelledby="remind-h">
            <h2 className="heading" id="remind-h">Reminders</h2>
            <p className="small muted mt-8">{d.dueAt ? `Due ${shortDate(d.dueAt)} for ${d.treatment}: ${intervalLine}.` : s.lastVisitAt ? `No due date: ${intervalLine}. Set a gap below.` : 'Add a visit first.'}</p>
            <div className="row gap-8 wrap mt-16" style={{ alignItems: 'flex-end' }}>
              <Field label="Comes back every" help="Weeks, for this client only">{(id) => <input id={id} className="input" style={{ width: 110 }} inputMode="numeric" placeholder={d.intervalWeeks ? String(d.intervalWeeks) : '12'} value={interval} onChange={(e: any) => setInterval_(e.target.value.replace(/\D/g, ''))} />}</Field>
              <Button kind="secondary" small busy={busy} onClick={() => update({ intervalWeeks: interval ? Number(interval) : null }, interval ? `${firstNameOf(client.name)} comes every ${interval} weeks.` : 'Back to the usual gap.')}>Save</Button>
            </div>
            <div className="row gap-8 wrap mt-16">
              <Button kind="secondary" small onClick={() => update({ snoozedUntil: snoozeUntil(2) }, 'Reminder snoozed for 2 weeks.')}>Remind me in 2 weeks</Button>
              <Button kind="secondary" small onClick={() => update({ snoozedUntil: snoozeUntil(6) }, 'Reminder snoozed for 6 weeks.')}>In 6 weeks</Button>
              {client.snoozedUntil && new Date(client.snoozedUntil).getTime() > Date.now() && <Button kind="quiet" small onClick={() => update({ snoozedUntil: null }, 'Snooze removed.')}>Un-snooze</Button>}
              <Button kind={client.notComingBack ? 'secondary' : 'quiet'} small onClick={() => update({ notComingBack: !client.notComingBack }, client.notComingBack ? 'Reminders are back on.' : 'No more reminders for this client.')}>{client.notComingBack ? 'Coming back after all' : 'Not coming back'}</Button>
            </div>
          </section>

          <section className="panel panel-pad" aria-labelledby="consent-h">
            <h2 className="heading" id="consent-h">Consent</h2>
            <p className="small muted mt-8">{CONSENT_LABEL[client.consent]}{client.consentAt ? `, recorded ${shortDate(client.consentAt)}${client.consentSource === 'stop' ? ' (replied STOP)' : client.consentSource === 'import' ? ' (from your import)' : ''}` : ''}.</p>
            <div className="row gap-8 wrap mt-16">
              {client.consent !== 'opted_in' && <Button kind="secondary" small onClick={() => update({ consent: 'opted_in', consentAt: new Date().toISOString(), consentSource: 'owner' }, 'Recorded: opted in.')}>They opted in</Button>}
              {client.consent !== 'soft_opt_in' && client.consent !== 'opted_in' && <Button kind="secondary" small onClick={() => update({ consent: 'soft_opt_in', consentAt: new Date().toISOString(), consentSource: 'owner' }, 'Recorded as an existing client.')}>Existing client</Button>}
              {client.consent !== 'opted_out' && <Button kind="secondary" small onClick={() => update(optOut(client, new Date(), 'stop'), 'Opted out. No more messages to this client.')}>Replied STOP / opted out</Button>}
            </div>
            {!perm.ok && <p className="xsmall faint mt-16">Cannot be texted right now: {perm.reason}.</p>}
          </section>
        </div>
      </div>

      <div className="grid-2 section">
        <section className="panel" aria-labelledby="sent-h">
          <div className="panel-head"><h2 className="heading" id="sent-h">Messages and bookings</h2></div>
          <div className="rows">
            {sent.length === 0 && outcomes.length === 0 && <div className="empty"><p className="muted">Nothing sent yet. Texts you approve and send appear here, and you can mark the booking they led to.</p></div>}
            {sent.map((a) => {
              const o = outcomes.find((x) => x.actionId === a.id);
              return (
                <div className="sent-row" key={a.id}>
                  <div className="stack gap-4" style={{ minWidth: 0 }}>
                    <span className="row gap-8 wrap"><span className="tag tag-plain">{ACTION_LABEL[a.kind]}</span><span className="xsmall faint">{relative(a.sentAt)}, {a.channel === 'sms_phone' ? 'from your phone' : a.channel === 'sms_twilio' ? 'sent by Gainora' : 'copied'}</span></span>
                    <span className="small muted sent-text">{a.text}</span>
                    {o && <span className={`tag ${o.status === 'confirmed' ? 'tag-forest' : o.status === 'likely' ? 'tag-brass' : 'tag-plain'}`} style={{ alignSelf: 'flex-start' }}>{o.status === 'confirmed' ? `Booked, ${money(o.amount)}` : o.status === 'likely' ? `Likely booking${o.amount ? `, ${money(o.amount)}` : ''}: confirm under Bookings` : 'Not from this message'}</span>}
                  </div>
                  {!o && <Button kind="secondary" small onClick={() => setBooking(a)}>This got a booking</Button>}
                </div>
              );
            })}
            {outcomes.filter((o) => !o.actionId).map((o) => <div className="sent-row" key={o.id}><span className="small">{o.title}</span><span className="tag tag-forest">Booked, {money(o.amount)}</span></div>)}
          </div>
        </section>

        <div className="stack gap-16">
          <section className="panel panel-pad" aria-labelledby="notes-h">
            <h2 className="heading" id="notes-h">Notes</h2>
            <p className="xsmall faint mt-8">Private to you. Never sent anywhere, never shown to the AI, never used in a draft.</p>
            <textarea className="textarea mt-16" rows={3} value={notes} onChange={(e: any) => setNotes(e.target.value)} aria-label="Private notes" />
            <div className="mt-8"><Button kind="secondary" small busy={busy} onClick={() => update({ notes: notes.trim() || undefined }, 'Notes saved.')} disabled={(notes.trim() || undefined) === client.notes}>Save notes</Button></div>
          </section>
          <section className="panel panel-pad" aria-labelledby="rights-h">
            <h2 className="heading" id="rights-h">Their data</h2>
            <p className="small muted mt-8">Everything Gainora holds about {firstNameOf(client.name)} is here. Export it as a file, or delete it all.</p>
            <div className="row gap-8 wrap mt-16">
              <Button kind="secondary" small icon="download" onClick={exportJson}>Export</Button>
              {!confirmDelete ? <Button kind="quiet" small onClick={() => setConfirmDelete(true)}>Delete this client</Button> : <><Button kind="secondary" small busy={busy} onClick={remove} className="btn-danger">Yes, delete everything about them</Button><Button kind="quiet" small onClick={() => setConfirmDelete(false)}>Keep</Button></>}
            </div>
          </section>
        </div>
      </div>

      {visiting && <AddVisitModal ctx={ctx} client={client} onClose={() => setVisiting(false)} />}
      {booking && <BookingModal ctx={ctx} client={client} action={booking === 'manual' ? null : booking} onClose={() => setBooking(null)} />}
      {draft && <SendModal ctx={ctx} items={[{ client, kind: draft.kind, text: draft.text, treatmentId: d.treatmentId ?? s.lastTreatmentId, amountHint: d.lastPrice ?? s.lastAmount }]} onClose={() => setDraft(null)} />}
    </>
  );
}

/* ---------- "This got a booking" ---------- */
function BookingModal({ ctx, client, action, onClose }: { ctx: Ctx; client: Client | null; action: ClientAction | null; onClose: () => void }) {
  const s = client ? summarise(ctx.data.visits.filter((v) => v.clientId === client.id)) : null;
  const hint = action?.amountHint ?? (s && action?.treatmentId ? s.lastPriceByTreatment[action.treatmentId] : null) ?? s?.lastAmount ?? null;
  const [amount, setAmount] = useState(hint != null ? String(hint) : '');
  const [at, setAt] = useState(today());
  const [clientId, setClientId] = useState(client?.id ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const amt = amount.replace(/[£,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(amt) || Number(amt) <= 0) { setErr('Add the amount of the booking.'); return; }
    const who = ctx.data.clients.find((c) => c.id === clientId);
    setBusy(true);
    try {
      const o: Outcome = { id: uuid(), actionId: action?.id ?? null, clientId: who?.id ?? null, amount: Number(amt), status: 'confirmed', at: new Date(at).toISOString(), title: `${who ? who.name : 'A client'} booked${action?.treatmentId ? ` ${treatmentById(action.treatmentId)?.label.toLowerCase() ?? ''}` : ''}${action ? ` after a ${ACTION_LABEL[action.kind].toLowerCase()}` : ''}`, createdAt: new Date().toISOString() };
      const saved = await api.saveOutcome(o);
      ctx.setData({ ...ctx.data, outcomes: [saved, ...ctx.data.outcomes] });
      ctx.toast(`Counted: ${money(saved.amount)} towards this month.`); onClose();
    } catch (e: any) { setErr(humanThrown(e, 'That didn’t save. Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="This got a booking" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Count it</Button></>}>
      <div className="modal-form">
        <p className="muted small">Only bookings you confirm count towards “Gainora helped bring in”. {hint != null ? `Pre-filled from ${client ? firstNameOf(client.name) : 'their'}’s last price for this treatment; change it if they paid something else.` : 'Enter what they paid or booked.'}</p>
        {!client && <Field label="Client" optional>{(id) => <select id={id} className="select" value={clientId} onChange={(e: any) => setClientId(e.target.value)}><option value="">Not one of your listed clients</option>{ctx.data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>}
        <div className="two">
          <Field label="Amount">{(id) => <div className="prefix-input"><span>£</span><input id={id} className="input" inputMode="decimal" value={amount} onChange={(e: any) => setAmount(e.target.value)} autoFocus /></div>}</Field>
          <Field label="Booking date">{(id) => <input id={id} type="date" className="input" value={at} onChange={(e: any) => setAt(e.target.value)} />}</Field>
        </div>
        {action && <p className="xsmall faint">Linked to the {ACTION_LABEL[action.kind].toLowerCase()} sent {relative(action.sentAt)}.</p>}
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/* ---------- Drafts and sending ---------- */
interface DraftItem { client: Client; kind: MessageKind; text: string; treatmentId: string | null; amountHint: number | null; ref?: string | null }

/**
 * Approves and sends one or more drafts, one at a time. "Send from your phone" opens the phone's
 * messages app with the text ready; the owner presses send there, then marks it sent here. When a
 * provider is connected (Twilio, env-gated), the same approval sends it directly.
 */
function SendModal({ ctx, items, onClose }: { ctx: Ctx; items: DraftItem[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [texts, setTexts] = useState(() => items.map((x) => x.text));
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const mode = ctx.settings.sendMode ?? DEFAULT_SETTINGS.sendMode;
  const it = items[i]; const text = texts[i] ?? '';
  const seg = smsSegments(forSms(text));
  const warn = it?.kind === 'review_request' && hasIncentive(text) ? 'This now reads like an offer in return for a review, which Google does not allow. Take the offer out.' : mentionsHealth(text) ? 'This mentions something that reads as a health detail. Texts can be seen by others; keep it out.' : !/STOP/i.test(text) && it?.kind !== 'review_request' ? 'Every marketing text needs the opt-out line (“Reply STOP to opt out.”).' : null;
  const done = async (channel: ClientAction['channel']) => {
    setBusy(true);
    try {
      await recordSent(ctx, { id: uuid(), clientId: it.client.id, kind: it.kind, channel, text: forSms(text), sentAt: new Date().toISOString(), treatmentId: it.treatmentId, amountHint: it.amountHint, ref: it.ref ?? null });
      if (i + 1 < items.length) { setI(i + 1); setOpened(false); } else { ctx.toast(items.length > 1 ? `${items.length} texts marked as sent.` : 'Marked as sent.'); onClose(); }
    } catch (e: any) { ctx.toast(humanThrown(e, 'Could not record that. Try again.')); }
    finally { setBusy(false); }
  };
  const viaProvider = async () => {
    setBusy(true);
    try {
      const a: ClientAction = { id: uuid(), clientId: it.client.id, kind: it.kind, channel: 'sms_twilio', text: forSms(text), sentAt: new Date().toISOString(), treatmentId: it.treatmentId, amountHint: it.amountHint, ref: it.ref ?? null };
      const r = await api.sendSms(a, it.client.phone);
      if (!r.sent) { ctx.toast(r.message || 'Not sent.'); return; }
      await recordSent(ctx, a);
      if (i + 1 < items.length) setI(i + 1); else { ctx.toast('Sent.'); onClose(); }
    } catch (e: any) { ctx.toast(humanThrown(e, 'Could not send. Try “Send from your phone”.')); }
    finally { setBusy(false); }
  };
  if (!it) return null;
  return (
    <Modal title={items.length > 1 ? `Text ${i + 1} of ${items.length}: ${it.client.name}` : `Text ${it.client.name}`} onClose={onClose}
      footer={<>
        <Button kind="secondary" icon="copy" onClick={async () => { if (await copyText(forSms(text))) { ctx.toast('Copied.'); } }}>Copy</Button>
        {mode === 'twilio' ? <Button busy={busy} icon="send" disabled={!!warn} onClick={viaProvider}>Send now</Button> : (
          !opened ? <a className={`btn btn-primary ${warn ? 'is-disabled' : ''}`} href={warn ? undefined : smsLink(it.client.phone, forSms(text))} onClick={() => { if (!warn) setOpened(true); }}><Icon name="send" />Send from my phone</a>
            : <Button busy={busy} icon="check" onClick={() => done('sms_phone')}>{i + 1 < items.length ? 'Sent, next' : 'I sent it'}</Button>
        )}
        {!opened && mode !== 'twilio' && <Button kind="quiet" busy={busy} onClick={() => done('copy')}>Mark as sent anyway</Button>}
      </>}>
      <div className="modal-form">
        <textarea className="textarea draft-edit" rows={5} value={text} onChange={(e: any) => setTexts(texts.map((t, k) => (k === i ? e.target.value : t)))} aria-label="Message text" />
        <div className="split xsmall faint"><span>To {it.client.phone.replace('+44', '0')} · {seg.chars} characters, {seg.segments} text{seg.segments === 1 ? '' : 's'}</span><span>{ACTION_LABEL[it.kind]}</span></div>
        {warn && <p className="field-error" role="alert">{warn}</p>}
        {opened && <p className="booking-note"><Icon name="info" /><span>Your messages app should have opened with the text ready. Press send there, then come back and tap “I sent it”. If nothing opened, copy the text and send it by hand.</span></p>}
        {!opened && mode !== 'twilio' && <p className="xsmall faint">Gainora does not send texts itself. “Send from my phone” opens your own messages app with this text; you press send. It is recorded here as sent so caps and the money number work.</p>}
      </div>
    </Modal>
  );
}

/* ---------- Due back ---------- */
function DueBack({ ctx, onOpen }: { ctx: Ctx; onOpen: (id: string) => void }) {
  const groups = dueGroups(ctx.data.clients, ctx.data.visits, ctx.settings);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<DraftItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const all = groups.flatMap((g) => g.items);
  const total = all.reduce((a, x) => a + (x.due.lastPrice ?? 0), 0);
  const visitsOf = (id: string) => ctx.data.visits.filter((v) => v.clientId === id).length;
  const perm = (c: Client) => canMessage(c, 'rebook', { visits: visitsOf(c.id), sent: ctx.data.actions, settings: ctx.settings });
  const draftFor = (c: Client, d: DueInfo) => texts[c.id] ?? rebookText(ctx.voice, { name: c.name, treatment: d.treatment, treatmentId: d.treatmentId, lastVisitAt: d.lastVisitAt });
  const item = (c: Client, d: DueInfo): DraftItem => ({ client: c, kind: 'rebook', text: draftFor(c, d), treatmentId: d.treatmentId, amountHint: d.lastPrice });
  const sendable = all.filter((x) => perm(x.client).ok);
  const quiet = canMessage({ ...all[0]?.client, consent: 'opted_in', phone: '+447700900000' } as Client, 'rebook', { visits: 1, sent: [], settings: ctx.settings });
  const patch = async (c: Client, p: Partial<Client>, msg: string) => {
    setBusy(c.id);
    try { const saved = await api.saveClient({ ...c, ...p }); ctx.setData({ ...ctx.data, clients: ctx.data.clients.map((x) => (x.id === c.id ? saved : x)) }); ctx.toast(msg); }
    catch (e: any) { ctx.toast(humanThrown(e, 'That didn’t save.')); }
    finally { setBusy(null); }
  };
  if (!all.length) return (
    <section className="panel empty" aria-label="Due back">
      <h2 className="heading">Nobody is due back this week</h2>
      <p className="muted mt-8">Gainora checks every client’s last visit against the gap for their treatment{Object.keys(ctx.settings.intervals ?? {}).length ? ' (with your own settings)' : ''}. As soon as someone is due, their draft text appears here, and Home shows the week’s total.</p>
      <p className="small faint mt-16">Change the gaps per treatment under <Link to="/settings">Plan and settings</Link>, or per client on their page.</p>
    </section>
  );
  return (
    <>
      <section className="panel panel-pad due-intro" aria-label="Summary">
        <div className="split" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 className="heading">{all.length} client{all.length === 1 ? '' : 's'} due back{total ? `, worth ${money(total)} at their last prices` : ''}</h2>
            <p className="small muted mt-8">{sendable.length} can be texted now{sendable.length < all.length ? `; ${all.length - sendable.length} cannot (opted out, no mobile, already messaged this week, or quiet hours)` : ''}. Read each draft, change anything you like, approve, then send from your phone one at a time.{!quiet.ok && quiet.reason?.startsWith('Quiet') ? ` It is quiet hours now (${quiet.reason.toLowerCase()}); drafts can be approved and sent in the morning.` : ''}</p>
          </div>
          {sendable.length > 0 && <Button icon="send" onClick={() => setSending(sendable.filter((x) => approved.size === 0 || approved.has(x.client.id)).map((x) => item(x.client, x.due)))}>{approved.size ? `Send ${approved.size} approved` : `Send all ${sendable.length}`}</Button>}
        </div>
      </section>
      {groups.map((g) => (
        <section className="section" key={g.label} aria-labelledby={`g-${g.label}`}>
          <div className="section-head"><h2 className="heading" id={`g-${g.label}`}>{g.label}</h2><span className="small faint">{g.items.length} client{g.items.length === 1 ? '' : 's'}{g.value ? `, ${money(g.value)} at their last prices` : ''}</span></div>
          <div className="panel rows">
            {g.items.map(({ client: c, due: d }) => {
              const p = perm(c); const t = draftFor(c, d); const seg = smsSegments(forSms(t));
              return (
                <article className="draft-card" key={c.id}>
                  <div className="draft-head">
                    <button type="button" className="link-btn" style={{ fontWeight: 600, fontSize: 'var(--t-md)' }} onClick={() => onOpen(c.id)}>{c.name}</button>
                    <span className={`tag ${DUE_TAG[d.status].cls}`}>{DUE_TAG[d.status].label(d)}</span>
                    {d.lastPrice != null && <span className="small faint">last paid {money(d.lastPrice)}{d.lastVisitAt ? `, ${shortDate(d.lastVisitAt)}` : ''}</span>}
                  </div>
                  {p.ok ? (
                    <>
                      <textarea className="textarea draft-edit" rows={3} value={t} onChange={(e: any) => setTexts({ ...texts, [c.id]: e.target.value })} aria-label={`Text to ${c.name}`} />
                      <div className="draft-foot">
                        <span className="xsmall faint">{seg.chars} characters, {seg.segments} text{seg.segments === 1 ? '' : 's'}</span>
                        <div className="row gap-8 wrap">
                          <label className={`choice ${approved.has(c.id) ? 'on' : ''}`} style={{ minHeight: 36 }}><input type="checkbox" checked={approved.has(c.id)} onChange={(e: any) => { const n = new Set(approved); e.target.checked ? n.add(c.id) : n.delete(c.id); setApproved(n); }} /><svg className="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Approve</label>
                          <Button small icon="send" onClick={() => setSending([item(c, d)])}>Send</Button>
                        </div>
                      </div>
                    </>
                  ) : <p className="small muted"><Icon name="info" className="inline-icon" />{p.reason}. {c.consent === 'opted_out' ? 'You can still ring them.' : c.phone ? '' : 'Add a mobile on their page to text them.'}</p>}
                  <div className="row gap-8 wrap xsmall">
                    <button type="button" className="link-btn xsmall" disabled={busy === c.id} onClick={() => patch(c, { snoozedUntil: snoozeUntil(2) }, 'Snoozed for 2 weeks.')}>Remind me in 2 weeks</button>
                    <button type="button" className="link-btn xsmall" disabled={busy === c.id} onClick={() => patch(c, { snoozedUntil: snoozeUntil(6) }, 'Snoozed for 6 weeks.')}>6 weeks</button>
                    <button type="button" className="link-btn xsmall" disabled={busy === c.id} onClick={() => patch(c, { notComingBack: true }, 'No more reminders for this client.')}>Not coming back</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <p className="xsmall faint mt-16">Texts go only to clients who opted in or are existing clients (the soft opt-in), never to anyone who opted out, never in quiet hours ({ctx.settings.quietStart ?? DEFAULT_SETTINGS.quietStart}:00 to {ctx.settings.quietEnd ?? DEFAULT_SETTINGS.quietEnd}:00), and at most {ctx.settings.weeklyCap ?? DEFAULT_SETTINGS.weeklyCap} a week to any one client. Every text ends with “Reply STOP to opt out”; record a STOP on the client’s page and they are never messaged again.</p>
      {sending && <SendModal ctx={ctx} items={sending} onClose={() => { setSending(null); setApproved(new Set()); }} />}
    </>
  );
}

/* ---------- Reviews: ask after a visit; reply to what Google shows ---------- */
function reviewCandidates(ctx: Ctx): { client: Client; visit: Visit }[] {
  const now = Date.now();
  const out: { client: Client; visit: Visit }[] = [];
  for (const c of ctx.data.clients) {
    const recent = ctx.data.visits.filter((v) => v.clientId === c.id && now - new Date(v.at).getTime() < 14 * DAY).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!recent) continue;
    if (!canMessage(c, 'review_request', { visits: 1, sent: ctx.data.actions, settings: ctx.settings }).ok) continue;
    out.push({ client: c, visit: recent });
  }
  return out.sort((a, b) => b.visit.at.localeCompare(a.visit.at));
}

function ReviewsTab({ ctx }: { ctx: Ctx }) {
  const rv = ctx.watcher?.reviews ?? null;
  const link = rv?.placeId ? reviewLink(rv.placeId) : null;
  const candidates = reviewCandidates(ctx);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<DraftItem[] | null>(null);
  const [aiText, setAiText] = useState<Record<string, string | 'loading'>>({});
  const draftFor = (c: Client, v: Visit) => texts[c.id] ?? reviewRequestText(ctx.voice, { name: c.name, treatment: v.treatment, treatmentId: v.treatmentId }, link ?? '[your Google review link]');
  const item = (c: Client, v: Visit): DraftItem => ({ client: c, kind: 'review_request', text: draftFor(c, v), treatmentId: v.treatmentId, amountHint: null });
  const edge = ctx.profile.competitors?.ourEdge;
  const reviews = rv?.reviews ?? [];
  const writeAi = async (r: ReviewItem) => {
    setAiText({ ...aiText, [r.id]: 'loading' });
    try { const t = safeReply(await api.draftReviewReply(r.id)); setAiText((s) => ({ ...s, [r.id]: t })); }
    catch (e: any) { ctx.toast(humanThrown(e, 'Couldn’t write that. The draft below still works.')); setAiText((s) => { const n = { ...s }; delete n[r.id]; return n; }); }
  };
  return (
    <>
      <section className="section" style={{ marginTop: 0 }} aria-labelledby="ask-h">
        <div className="section-head"><h2 className="heading" id="ask-h">Ask for a Google review</h2><span className="small faint">Clients seen in the last 14 days, not asked in {REVIEW_ASK_GAP_DAYS} days</span></div>
        {!link && (
          <p className="booking-note is-warn" style={{ marginBottom: 14 }}><Icon name="alert" /><span>Connect your Google listing on <Link to="/watcher?tab=reviews">the Watcher’s Reviews tab</Link> and these texts carry your real review link. Until then the link is a placeholder.</span></p>
        )}
        <div className="panel rows">
          {candidates.length === 0 && <div className="empty"><p className="muted">Nobody to ask right now. When you log a visit, the client appears here for two weeks (if they can be texted and were not asked in the last {REVIEW_ASK_GAP_DAYS} days).</p></div>}
          {candidates.map(({ client: c, visit: v }) => {
            const t = draftFor(c, v);
            return (
              <article className="draft-card" key={c.id}>
                <div className="draft-head"><span className="subhead">{c.name}</span><span className="small faint">{v.treatment}, {shortDate(v.at)}</span></div>
                <textarea className="textarea draft-edit" rows={3} value={t} onChange={(e: any) => setTexts({ ...texts, [c.id]: e.target.value })} aria-label={`Review request to ${c.name}`} />
                <div className="draft-foot">
                  <span className="xsmall faint">{hasIncentive(t) ? <span className="field-error">Take out the offer: Google does not allow incentives for reviews.</span> : 'No offer, no incentive: just the ask.'}</span>
                  <Button small icon="send" disabled={!link || hasIncentive(t)} onClick={() => setSending([item(c, v)])}>Send</Button>
                </div>
              </article>
            );
          })}
        </div>
        {candidates.length > 1 && link && <div className="mt-16"><Button kind="secondary" icon="send" onClick={() => setSending(candidates.filter((x) => !hasIncentive(draftFor(x.client, x.visit))).map((x) => item(x.client, x.visit)))}>Send all {candidates.length}, one at a time</Button></div>}
      </section>

      <section className="section" aria-labelledby="reply-h">
        <div className="section-head"><h2 className="heading" id="reply-h">Replies to your Google reviews</h2>{rv && <span className="small faint">Google shares up to 5 recent reviews</span>}</div>
        {!rv ? <div className="panel empty"><p className="muted">Once your Google listing is connected, every new review the Watcher sees gets a reply drafted here in your voice, to copy and paste on Google.</p></div> : (
          <div className="panel rows">
            {reviews.length === 0 && <div className="empty"><p className="muted">Google hasn’t shared any reviews for this listing yet.</p></div>}
            {reviews.map((r) => {
              const text = aiText[r.id] && aiText[r.id] !== 'loading' ? (aiText[r.id] as string) : reviewReplyDraft(r, { ...ctx.voice, edge });
              return (
                <article className="draft-card" key={r.id}>
                  <div className="draft-head"><span className="subhead">{r.author}</span><Stars value={r.rating} /><span className="small faint">{r.when}</span>{r.isNew && <span className={`tag ${r.rating <= 2 ? 'tag-danger' : 'tag-forest'}`}>New</span>}</div>
                  {r.text && <p className="small muted review-text">“{r.text}”</p>}
                  <pre className="draft-text" style={{ fontSize: '1.0625rem', maxHeight: 'none' }}>{aiText[r.id] === 'loading' ? 'Writing…' : text}</pre>
                  <div className="draft-foot">
                    <span className="xsmall faint">{r.rating <= 3 ? 'Calm, takes it offline, no arguing, nothing offered.' : 'Thanks them for the specific thing they praised.'} No health details, ever.</span>
                    <div className="row gap-8 wrap">
                      {api.mode === 'live' && !aiText[r.id] && <Button kind="quiet" small onClick={() => writeAi(r)}>Write it with AI</Button>}
                      <Button kind="secondary" small icon="copy" onClick={async () => ctx.toast((await copyText(text)) ? 'Copied. Paste it as your reply on Google.' : 'Select the text and copy it.')}>Copy reply</Button>
                      <a className="btn btn-secondary btn-small" href={rv.mapsUrl} target="_blank" rel="noreferrer">Open Google</a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {sending && <SendModal ctx={ctx} items={sending} onClose={() => setSending(null)} />}
    </>
  );
}

/* ---------- Bookings: the money number and the list behind it ---------- */
function Bookings({ ctx }: { ctx: Ctx }) {
  const s = moneySummary(ctx.data.outcomes, ctx.data.actions, startOfMonth());
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const name = (id: string | null) => ctx.data.clients.find((c) => c.id === id)?.name ?? 'A client';
  const decide = async (o: Outcome, status: Outcome['status']) => {
    const amt = Number((amounts[o.id] ?? (o.amount != null ? String(o.amount) : '')).replace(/[£,\s]/g, ''));
    if (status === 'confirmed' && !(amt > 0)) { ctx.toast('Add the amount first.'); return; }
    setBusy(o.id);
    try { const saved = await api.saveOutcome({ ...o, status, amount: status === 'confirmed' ? amt : o.amount }); ctx.setData({ ...ctx.data, outcomes: ctx.data.outcomes.map((x) => (x.id === o.id ? saved : x)) }); ctx.toast(status === 'confirmed' ? `Counted ${money(amt)}.` : 'Not counted.'); }
    catch (e: any) { ctx.toast(humanThrown(e, 'That didn’t save.')); }
    finally { setBusy(null); }
  };
  const cover = coverLine(s);
  return (
    <>
      <section className="money-hero" aria-label="This month">
        <span className="biz-kicker">{month} with Gainora</span>
        <p className="money-figure">{money(s.confirmed)}<small>from {s.bookings} booking{s.bookings === 1 ? '' : 's'} you confirmed</small></p>
        <p className="money-line">{moneySentence(s, 'this month')}{cover ? ` ${cover}` : ''}</p>
        {s.likely.length > 0 && <p className="money-likely">{s.likely.length} likely booking{s.likely.length === 1 ? '' : 's'}{s.likelyValue ? ` (${money(s.likelyValue)})` : ''} waiting for you below. They are not counted until you confirm them.</p>}
        <div className="row gap-8 wrap mt-16"><Button kind="secondary" small icon="plus" onClick={() => setAdding(true)} className="on-dark-btn">Add a booking</Button></div>
      </section>

      {s.likely.length > 0 && (
        <section className="section" aria-labelledby="likely-h">
          <div className="section-head"><h2 className="heading" id="likely-h">Likely from Gainora: confirm or not</h2><span className="small faint">A visit within 21 days of a text</span></div>
          <div className="panel rows">
            {s.likely.map((o) => {
              const a = ctx.data.actions.find((x) => x.id === o.actionId);
              return (
                <div className="likely-row" key={o.id}>
                  <div className="stack gap-4" style={{ minWidth: 0 }}>
                    <span className="subhead">{name(o.clientId)}: {o.title}</span>
                    <span className="small muted">Visit on {shortDate(o.at)}{a ? `, ${ACTION_LABEL[a.kind].toLowerCase()} sent ${shortDate(a.sentAt)}` : ''}. Did the text bring them in?</span>
                  </div>
                  <div className="row gap-8 wrap">
                    <div className="prefix-input" style={{ width: 120 }}><span>£</span><input className="input" inputMode="decimal" aria-label="Amount" value={amounts[o.id] ?? (o.amount != null ? String(o.amount) : '')} onChange={(e: any) => setAmounts({ ...amounts, [o.id]: e.target.value })} /></div>
                    <Button small busy={busy === o.id} onClick={() => decide(o, 'confirmed')}>Yes, count it</Button>
                    <Button kind="quiet" small busy={busy === o.id} onClick={() => decide(o, 'dismissed')}>No</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="conf-h">
        <div className="section-head"><h2 className="heading" id="conf-h">Confirmed this month</h2><span className="small faint">{s.bookings} booking{s.bookings === 1 ? '' : 's'}</span></div>
        <div className="panel rows">
          {s.list.length === 0 && <div className="empty"><p className="muted">Nothing confirmed yet this month. When a client books after a text, mark it on their page or under Messages, and it appears here and on Home.</p></div>}
          {s.list.map((o) => {
            const a = ctx.data.actions.find((x) => x.id === o.actionId);
            return (
              <div className="likely-row" key={o.id}>
                <div className="stack gap-4" style={{ minWidth: 0 }}><span>{o.title}</span><span className="xsmall faint">{shortDate(o.at)}{a ? ` · ${ACTION_LABEL[a.kind]} sent ${shortDate(a.sentAt)}` : ' · marked by you'}</span></div>
                <div className="row gap-12"><span className="tabular" style={{ fontWeight: 700 }}>{money(o.amount)}</span><button type="button" className="link-btn xsmall" onClick={() => decide(o, 'dismissed')}>Remove</button></div>
              </div>
            );
          })}
        </div>
        <p className="xsmall faint mt-16">Every figure here is one you entered or confirmed. Gainora never estimates a booking or adds revenue on its own; the monthly email and the Brief use the same list.</p>
      </section>
      {adding && <BookingModal ctx={ctx} client={null} action={null} onClose={() => setAdding(false)} />}
    </>
  );
}

/* ---------- Import ---------- */
const MAPPABLE: ImportField[] = ['name', 'firstName', 'lastName', 'phone', 'email', 'date', 'treatment', 'amount', 'practitioner', 'consent', 'notes'];

function ImportTab({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<{ clients: number; visits: number; existing: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const system = guessSystem(rows?.[0] ?? []) ?? (ctx.profile.offer?.bookingSystem && !['None', 'Other'].includes(ctx.profile.offer.bookingSystem) ? ctx.profile.offer.bookingSystem : null);

  const load = async (file: File) => {
    setErr(null); setResult(null);
    try {
      const r = await readFile(file);
      if (r.length < 1) { setErr('That file is empty.'); return; }
      setRows(r); setFileName(file.name); setMapping(detectColumns(r[0])); setHasHeader(true);
    } catch (e: any) { setErr(e?.message || 'Could not read that file.'); }
  };
  const loadPaste = () => {
    const r = parseCsv(paste);
    if (r.length < 1) { setErr('Nothing to read in the pasted text.'); return; }
    setErr(null); setRows(r); setFileName('pasted text'); setMapping(detectColumns(r[0]));
  };
  const built: ImportResult | null = useMemo(() => (rows ? buildImport(rows, mapping, ctx.data.clients.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email })), { hasHeader, source: system ?? 'file' }) : null), [rows, mapping, hasHeader, ctx.data.clients.length]);
  const headers = rows ? (hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`)) : [];
  const nameOk = mapping.name != null || mapping.firstName != null;
  const save = async () => {
    if (!built) return;
    setBusy(true); setErr(null);
    try {
      const rec = toRecords(built, uuid, new Date(), system ?? 'file');
      await api.importClients(rec.clients, rec.visits, rec.optOutIds);
      const fresh = await api.listClients();
      ctx.setData(fresh);
      setResult({ clients: rec.clients.length, visits: rec.visits.length, existing: built.summary.existing });
      ctx.toast(`Imported ${rec.clients.length} client${rec.clients.length === 1 ? '' : 's'} and ${rec.visits.length} visit${rec.visits.length === 1 ? '' : 's'}.`);
    } catch (e: any) { setErr(humanThrown(e, 'The import didn’t finish. Nothing was lost; try again.')); }
    finally { setBusy(false); }
  };

  if (result) return (
    <section className="panel panel-pad" style={{ maxWidth: 720 }}>
      <h2 className="heading">Imported</h2>
      <p className="muted mt-8">{result.clients} new client{result.clients === 1 ? '' : 's'}{result.existing ? `, ${result.existing} existing client${result.existing === 1 ? '' : 's'} updated` : ''}, {result.visits} visit{result.visits === 1 ? '' : 's'}. Gainora has worked out who is due back.</p>
      <div className="row gap-8 wrap mt-24"><Button onClick={onDone}>See who is due back</Button><Button kind="secondary" onClick={() => { setRows(null); setResult(null); setPaste(''); }}>Import another file</Button></div>
    </section>
  );

  if (!rows) return (
    <div className="start-grid">
      <section className="panel panel-pad start-card" aria-labelledby="file-h">
        <h2 className="heading" id="file-h">Choose your export</h2>
        <p className="muted mt-8">A CSV or Excel (.xlsx) file from {system ?? 'Fresha, Phorest, Pabau, Booksy, Timely, Treatwell'} or any spreadsheet with a name and mobile per row. Visit dates and treatments let Gainora work out who is due; prices give the value. Up to {MAX_ROWS.toLocaleString('en-GB')} rows or {MAX_FILE_BYTES / 1024 / 1024} MB; it is read on this device.</p>
        <label className="dropzone mt-24" onDragOver={(e: any) => e.preventDefault()} onDrop={(e: any) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) load(f); }}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e: any) => { const f = e.target.files?.[0]; if (f) load(f); }} />
          <Icon name="download" /><span><strong>Choose a file</strong> or drop it here</span>
        </label>
        {err && <p className="field-error mt-16" role="alert">{err}</p>}
        <details className="mt-24 small"><summary className="muted" style={{ cursor: 'pointer' }}>How to export from your booking system</summary>
          <ul className="start-list mt-8">
            <li><strong>Fresha:</strong> Clients → Options → Export (clients), or Sales → Appointments → Export for visits with services and prices.</li>
            <li><strong>Phorest:</strong> Manager → Reports → Client list, or Client export, as CSV.</li>
            <li><strong>Pabau:</strong> Contacts → Export, or Reports → Appointments → Export.</li>
            <li><strong>Booksy / Timely / Treatwell:</strong> Customers (or Clients) → Export CSV; appointment reports add the dates.</li>
          </ul>
        </details>
      </section>
      <section className="panel panel-pad start-card" aria-labelledby="paste-h">
        <h2 className="heading" id="paste-h">Or paste a list</h2>
        <p className="muted mt-8">One client per line, with a header row: for example <code>Name, Mobile, Last visit, Treatment, Paid</code>.</p>
        <textarea className="textarea mt-16" rows={6} value={paste} onChange={(e: any) => setPaste(e.target.value)} placeholder={'Name, Mobile, Last visit, Treatment, Paid\nSarah Mitchell, 07700 900123, 12/08/2026, Anti-wrinkle 2 areas, 195'} aria-label="Pasted client list" />
        <div className="mt-16"><Button kind="secondary" onClick={loadPaste} disabled={!paste.trim()}>Read the list</Button></div>
      </section>
    </div>
  );

  const preview = (hasHeader ? rows.slice(1) : rows).slice(0, 5);
  return (
    <>
      <section className="panel panel-pad" aria-labelledby="map-h">
        <div className="split"><h2 className="heading" id="map-h">Match the columns</h2><span className="small faint">{fileName}{system ? ` · looks like ${system}` : ''} · {rows.length.toLocaleString('en-GB')} rows</span></div>
        <p className="small muted mt-8">Gainora guessed from the headings. Check each one; “Client name” or “First name” is the only one that must be set.</p>
        <label className="row gap-8 small mt-16" style={{ cursor: 'pointer' }}><input type="checkbox" checked={hasHeader} onChange={(e: any) => { setHasHeader(e.target.checked); }} /> The first row is headings</label>
        <div className="import-map mt-16">
          {MAPPABLE.map((f) => (
            <label key={f} className="import-field">
              <span className="field-label">{FIELD_LABEL[f]}{f === 'name' || f === 'firstName' ? '' : <span className="opt">Optional</span>}</span>
              <select className="select" value={mapping[f] ?? ''} onChange={(e: any) => { const v = e.target.value; const m = { ...mapping }; if (v === '') delete m[f]; else m[f] = Number(v); setMapping(m); }}>
                <option value="">Not in this file</option>
                {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="prev-h">
        <div className="section-head"><h2 className="heading" id="prev-h">What will be saved</h2></div>
        {built && (
          <div className="panel">
            <div className="stats import-stats">
              <div className="stat"><span className="stat-label">Clients</span><span className="stat-value tabular">{built.summary.clients}</span><span className="stat-note">{built.summary.newClients} new, {built.summary.existing} already in your list</span></div>
              <div className="stat"><span className="stat-label">Visits</span><span className="stat-value tabular">{built.summary.visits}</span><span className="stat-note">{built.summary.noDate ? `${built.summary.noDate} rows had no date` : 'with dates'}</span></div>
              <div className="stat"><span className="stat-label">With a mobile</span><span className="stat-value tabular">{built.summary.withMobile}</span><span className="stat-note">Only these can be texted</span></div>
              <div className="stat"><span className="stat-label">Opted out</span><span className="stat-value tabular">{built.summary.optedOut}</span><span className="stat-note">From your file; honoured</span></div>
            </div>
            <div className="table-wrap" style={{ borderTop: '1px solid var(--line)' }}>
              <table>
                <caption className="sr-only">Preview of the first rows</caption>
                <thead><tr><th>Name</th><th>Mobile</th><th>Last visit</th><th>Treatment</th><th>Paid</th><th>Consent</th></tr></thead>
                <tbody>
                  {built.clients.slice(0, 6).map((c) => { const v = c.visits[c.visits.length - 1]; return <tr key={c.key}><td>{c.name}{c.existingId ? <span className="xsmall faint"> (existing{c.nameOnlyMatch ? ', matched by name only' : ''})</span> : null}</td><td className="tabular">{c.phone ? c.phone.replace('+44', '0') : c.phoneRaw ? <span className="faint">{c.phoneRaw} (not a mobile)</span> : '–'}</td><td>{v ? shortDate(v.at) : '–'}{c.visits.length > 1 ? <span className="xsmall faint"> +{c.visits.length - 1}</span> : null}</td><td>{v?.treatment ?? '–'}{v?.treatmentId ? null : v ? <span className="xsmall faint"> (no gap known)</span> : null}</td><td className="tabular">{v?.amount != null ? money(v.amount) : '–'}</td><td><span className={`tag ${CONSENT_SHORT[c.consent].cls}`}>{CONSENT_SHORT[c.consent].label}</span></td></tr>; })}
                </tbody>
              </table>
            </div>
            {(built.skipped.length > 0 || built.summary.truncated) && (
              <details className="done-list" style={{ margin: 16 }}><summary>{built.skipped.length} row{built.skipped.length === 1 ? '' : 's'} skipped{built.summary.truncated ? `; only the first ${MAX_ROWS.toLocaleString('en-GB')} rows are read` : ''}</summary>
                <ul>{built.skipped.slice(0, 50).map((x) => <li key={x.row}><span>Row {x.row}</span><span>{x.reason}</span></li>)}</ul></details>
            )}
            {!nameOk && <p className="field-error" style={{ padding: '0 24px 16px' }}>Set which column holds the client’s name (or first name).</p>}
            <div className="panel-pad row gap-12 wrap" style={{ borderTop: '1px solid var(--line)', justifyContent: 'space-between' }}>
              <p className="xsmall faint" style={{ maxWidth: '60ch' }}>Nothing is saved until you press Import. Clients imported from a booking system are treated as existing clients (soft opt-in) unless your file says otherwise; anyone marked opted out stays opted out.{preview.length ? '' : ''}</p>
              <div className="row gap-8"><Button kind="secondary" onClick={() => setRows(null)}>Choose another file</Button><Button busy={busy} disabled={!nameOk || !built.clients.length} onClick={save}>Import {built.summary.clients} client{built.summary.clients === 1 ? '' : 's'}</Button></div>
            </div>
            {err && <p className="field-error" style={{ padding: '0 24px 16px' }} role="alert">{err}</p>}
          </div>
        )}
      </section>
    </>
  );
}

export { reviewCandidates };
