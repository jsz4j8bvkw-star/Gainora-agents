import { useEffect, useMemo, useState } from 'react';
import { Link, navigate, queryParam } from '../lib/router';
import { Button, ErrorNote, Field, Icon, Loading, Modal, Tabs, copyText, useLoad, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { relative, shortDate } from '../lib/format';
import { dueLabel } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import {
  CHANNEL_LABEL, COMPANY_LABEL, STAGE_LABEL, STAGES, type Channel, type CompanyType, type Prospect, type Sequence, type SequenceStep, type Stage,
} from '../../shared/admin/sales';
import { fromPriceItem, money, type PriceItem, proposalTotals, type ProposalItem } from '../../shared/admin/prices';
import { biz, type DueProspect, type ProposalRow, type SalesOverview } from './biz-api';

type Tab = 'followups' | 'prospects' | 'proposals' | 'sequences' | 'results';
const TABS: Tab[] = ['followups', 'prospects', 'proposals', 'sequences', 'results'];
export const prospectPath = (id: string) => `/sales/${id}`;
const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const callTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

export function StageChip({ stage }: { stage: Stage }) {
  const tone = stage === 'won' ? 'tag-forest' : stage === 'lost' ? 'tag-plain' : stage === 'new' ? 'tag-plain' : stage === 'proposal' || stage === 'call' ? 'tag-brass' : 'stage-mid';
  return <span className={`tag ${tone}`}>{STAGE_LABEL[stage]}</span>;
}

/* ---------- Sales ---------- */

export function Sales() {
  const { data: o, error, reload } = useLoad<SalesOverview>(() => biz.sales());
  const [tab, setTab] = useState<Tab>(() => { const t = queryParam('tab') as Tab | null; return t && TABS.includes(t) ? t : 'followups'; });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [proposal, setProposal] = useState<Partial<ProposalRow> | null>(null);
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!o) return <Loading label="Loading sales" />;
  const openProposals = o.proposals.filter((p) => p.status === 'sent' || p.status === 'viewed' || p.status === 'draft').length;
  const callsWeek = o.calls.filter((p) => p.call_at!.slice(0, 10) <= addDays(o.today, 7)).length;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="title">Sales</h1><p className="lede">{o.due.length ? `${o.due.length} message${o.due.length === 1 ? '' : 's'} to send` : 'No messages due'}{callsWeek ? ` · ${callsWeek} call${callsWeek === 1 ? '' : 's'} this week` : ''}{openProposals ? ` · ${openProposals} open proposal${openProposals === 1 ? '' : 's'}` : ''}</p></div>
        <div className="row gap-8 wrap"><Button kind="secondary" icon="download" onClick={() => setImporting(true)}>Import a list</Button><Button icon="plus" onClick={() => setAdding(true)}>Add a prospect</Button></div>
      </div>
      <Tabs<Tab> label="Sales" value={tab} onChange={setTab} tabs={[
        { id: 'followups', label: 'Follow-ups', badge: o.due.length || null },
        { id: 'prospects', label: 'Prospects', badge: o.prospects.length || null },
        { id: 'proposals', label: 'Proposals', badge: openProposals || null },
        { id: 'sequences', label: 'Messages' },
        { id: 'results', label: 'Results' },
      ]} />
      {tab === 'followups' && <FollowUps o={o} reload={reload} />}
      {tab === 'prospects' && <Prospects o={o} reload={reload} />}
      {tab === 'proposals' && <Proposals o={o} reload={reload} onNew={() => setProposal({})} onEdit={(p) => setProposal(p)} />}
      {tab === 'sequences' && <Sequences o={o} reload={reload} />}
      {tab === 'results' && <Results o={o} reload={reload} />}
      {adding && <AddProspect onClose={() => setAdding(false)} onDone={(p) => navigate(prospectPath(p.id))} />}
      {importing && <ImportList onClose={() => { setImporting(false); reload(); }} />}
      {proposal && <ProposalEditor initial={proposal} onClose={() => setProposal(null)} onDone={() => { setProposal(null); reload(); }} />}
    </div>
  );
}

/* ---------- Follow-ups: the messages due today ---------- */

function FollowUps({ o, reload }: { o: SalesOverview; reload: () => void }) {
  const auto = o.outreach.autoSend && o.outreach.ready;
  return (
    <div className="stack gap-24">
      <p className={`small ${auto ? 'muted' : 'notice-box'}`}>
        {auto ? `Emails that are allowed go automatically at 9:30am on weekdays (up to ${o.outreach.dailyLimit} a day). The rest are here for you to send.`
          : o.outreach.ready ? 'Automatic sending is off, so every message waits here for you. Switch it on under Results.'
            : 'Outreach email isn’t connected yet, so copy each email and send it from your own inbox, then mark it sent. LinkedIn, Instagram, Facebook and WhatsApp messages are always sent by you.'}
      </p>
      {o.calls.length > 0 && (
        <section className="panel" aria-labelledby="calls-h">
          <div className="panel-head"><h2 className="heading" id="calls-h">Calls booked</h2></div>
          <ul className="plain-list">{o.calls.map((p) => <li key={p.id} className="row gap-12 wrap"><strong className="small">{callTime(p.call_at!)}</strong><Link to={prospectPath(p.id)}>{p.business_name}</Link>{p.contact_name && <span className="small muted">{p.contact_name}</span>}</li>)}</ul>
        </section>
      )}
      {o.due.length ? (
        <div className="stack gap-16">{o.due.map((p) => <DueCard key={p.id} p={p} o={o} onDone={reload} />)}</div>
      ) : <div className="panel empty"><h2 className="heading">Nothing due</h2><p className="muted">Put prospects on a sequence from the Prospects tab and their messages show up here on the right days.</p></div>}
    </div>
  );
}

function DueCard({ p, o, onDone }: { p: DueProspect; o: SalesOverview; onDone: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState(p.draft?.body ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const seq = o.sequences.find((s) => s.id === p.sequence_id);
  const d = p.draft;
  const act = async (what: string, fn: () => Promise<void>, ok: string) => { setBusy(what); try { await fn(); toast(ok); onDone(); } catch (e) { toast(humanThrown(e, 'That didn’t work.')); } finally { setBusy(null); } };
  if (!d) return null;
  const canSend = d.channel === 'email' && p.email_ok.ok && o.outreach.ready;
  const openUrl = d.channel === 'linkedin' ? p.linkedin : d.channel === 'instagram' ? p.instagram : d.channel === 'whatsapp' && p.phone ? `https://wa.me/${p.phone.replace(/\D/g, '').replace(/^0/, '44')}` : d.channel === 'email' && p.email ? `mailto:${p.email}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}` : '';
  return (
    <section className="panel fu-card" aria-label={p.business_name}>
      <div className="fu-card-head">
        <div className="stack gap-2"><Link to={prospectPath(p.id)}><strong>{p.business_name}</strong></Link><span className="xsmall faint">{[p.contact_name, p.town, COMPANY_LABEL[p.company_type]].filter(Boolean).join(' · ')}</span></div>
        <span className="row gap-8 wrap"><span className={`chan chan-${d.channel}`}>{CHANNEL_LABEL[d.channel]}</span><span className="xsmall muted">Message {d.step + 1} of {seq?.steps.length ?? '?'}</span><span className={`due ${p.next_on! < o.today ? 'due-late' : 'due-today'}`}>{dueLabel(p.next_on, o.today)}</span></span>
      </div>
      {d.channel === 'email' && !p.email_ok.ok && <p className="small gate-note"><Icon name="info" />{p.email_ok.why}</p>}
      {d.subject && <p className="small"><span className="faint">{d.channel === 'email' ? 'Subject: ' : 'Step: '}</span>{d.subject}</p>}
      <textarea className="textarea draft-body" rows={Math.min(14, body.split('\n').length + 1)} value={body} aria-label={`Message to ${p.business_name}`} onChange={(e: any) => setBody(e.target.value)} />
      {!p.personal_line && d.step === 0 && <p className="xsmall faint">No personal line for them yet, so it’s left out. Add one on their page if you spot something real about their business.</p>}
      <div className="row gap-8 wrap">
        {canSend && <Button small icon="send" busy={busy === 'send'} onClick={() => act('send', () => biz.send(p.id, body !== d.body ? body : undefined), 'Email sent')}>Send email</Button>}
        <Button small kind="secondary" icon="copy" onClick={async () => toast((await copyText(d.subject ? `${d.subject}\n\n${body}` : body)) ? 'Copied' : 'Select the text and copy it')}>Copy</Button>
        {openUrl && <a className="btn btn-secondary btn-small" href={openUrl} target="_blank" rel="noreferrer"><Icon name="external" />Open {d.channel === 'email' ? 'in your email' : CHANNEL_LABEL[d.channel]}</a>}
        <Button small kind="secondary" icon="check" busy={busy === 'mark'} onClick={() => act('mark', () => biz.markSent(p.id, body), 'Marked as sent')}>I’ve sent it</Button>
        <Button small kind="quiet" busy={busy === 'skip'} onClick={() => act('skip', () => biz.skip(p.id), 'Skipped')}>Skip</Button>
        <Button small kind="quiet" onClick={() => setReply('')}>They replied</Button>
      </div>
      {reply !== null && (
        <div className="row gap-8 wrap reply-row">
          <input className="input grow" placeholder="What did they say? (optional)" aria-label="What they said" value={reply} onChange={(e: any) => setReply(e.target.value)} />
          <Button small busy={busy === 'reply'} onClick={() => act('reply', () => biz.replied(p.id, reply), 'Moved to Replied. No more automatic messages.')}>Save</Button>
        </div>
      )}
    </section>
  );
}

/* ---------- Prospects ---------- */

function Prospects({ o, reload }: { o: SalesOverview; reload: () => void }) {
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [seq, setSeq] = useState(o.sequences.find((s) => s.active)?.id ?? '');
  const [start, setStart] = useState(o.today);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const list = useMemo(() => o.prospects.filter((p) => (stage === 'all' || p.stage === stage) && (!q || `${p.business_name} ${p.contact_name} ${p.town} ${p.email}`.toLowerCase().includes(q.toLowerCase()))), [o, stage, q]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const go = async () => {
    setBusy(true);
    try { const n = await biz.startSequence([...picked], seq, start); toast(`${n} put on “${o.sequences.find((s) => s.id === seq)?.name}”. Their first message is due ${start === o.today ? 'today' : shortDate(start)}.`); setPicked(new Set()); reload(); }
    catch (e) { toast(humanThrown(e, 'That didn’t start.')); } finally { setBusy(false); }
  };
  return (
    <div className="stack gap-16">
      <div className="row gap-12 wrap">
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search business, town or email" aria-label="Search prospects" value={q} onChange={(e: any) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Stage">
          <button type="button" aria-pressed={stage === 'all'} onClick={() => setStage('all')}>All {o.prospects.length}</button>
          {STAGES.map((s) => <button key={s.id} type="button" aria-pressed={stage === s.id} onClick={() => setStage(s.id)}>{s.label} {o.funnel.by[s.id]}</button>)}
        </div>
      </div>
      {picked.size > 0 && (
        <div className="panel panel-pad row gap-12 wrap pick-bar" role="region" aria-label="Selected prospects">
          <strong className="small">{picked.size} selected</strong>
          <Field label="Messages">{(id) => <select id={id} className="select" value={seq} onChange={(e: any) => setSeq(e.target.value)}>{o.sequences.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
          <Field label="First message on">{(id) => <input id={id} className="input" type="date" value={start} min={o.today} onChange={(e: any) => setStart(e.target.value || o.today)} />}</Field>
          <Button busy={busy} disabled={!seq} onClick={go}>Start messages</Button>
          <Button kind="quiet" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}
      <section className="panel">
        <div className="table-wrap"><table className="clients-table">
          <thead><tr><th className="pick-col"><span className="sr-only">Select</span></th><th>Business</th><th>Stage</th><th>Company type</th><th>Next message</th><th>Source</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id}>
              <td className="pick-col"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.business_name}`} disabled={!!p.unsubscribed_at || p.stage === 'won'} /></td>
              <td><Link to={prospectPath(p.id)}><strong>{p.business_name}</strong></Link><div className="xsmall faint">{[p.contact_name, p.town].filter(Boolean).join(' · ') || p.email}</div></td>
              <td><StageChip stage={p.stage} />{p.unsubscribed_at && <div className="xsmall faint">Don’t contact</div>}</td>
              <td className="small">{COMPANY_LABEL[p.company_type]}{p.consent && <div className="xsmall faint">Said yes</div>}</td>
              <td className="small">{p.next_on ? <span className={`due ${p.next_on < o.today ? 'due-late' : p.next_on === o.today ? 'due-today' : ''}`}>{dueLabel(p.next_on, o.today)}</span> : p.call_at ? `Call ${callTime(p.call_at)}` : <span className="faint">–</span>}</td>
              <td className="xsmall faint">{p.source}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!list.length && <p className="panel-pad muted">{o.prospects.length ? 'No prospects match.' : 'No prospects yet. Import your outreach list or add one.'}</p>}
      </section>
      <p className="xsmall faint">Limited companies and LLPs can be emailed with an easy way to stop. Sole traders and partnerships need to say yes first, so contact them another way. Check the company type on Companies House.</p>
    </div>
  );
}

function AddProspect({ onClose, onDone }: { onClose: () => void; onDone: (p: Prospect) => void }) {
  const [p, setP] = useState<Partial<Prospect>>({ company_type: 'unknown' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Prospect) => (e: any) => setP({ ...p, [k]: e.target.value });
  const save = async () => { setBusy(true); setErr(null); try { onDone(await biz.saveProspect(p)); } catch (e) { setErr(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <Modal title="Add a prospect" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Add</Button></>}>
      <div className="form-grid">
        <Field label="Business name" error={err ?? undefined}>{(id, d) => <input id={id} className="input" aria-describedby={d} value={p.business_name ?? ''} onChange={set('business_name')} />}</Field>
        <Field label="Contact name" optional>{(id) => <input id={id} className="input" value={p.contact_name ?? ''} onChange={set('contact_name')} />}</Field>
        <Field label="Email" optional>{(id) => <input id={id} className="input" type="email" value={p.email ?? ''} onChange={set('email')} />}</Field>
        <Field label="Phone" optional>{(id) => <input id={id} className="input" type="tel" value={p.phone ?? ''} onChange={set('phone')} />}</Field>
        <Field label="Website" optional>{(id) => <input id={id} className="input" value={p.website ?? ''} onChange={set('website')} />}</Field>
        <Field label="Town" optional>{(id) => <input id={id} className="input" value={p.town ?? ''} onChange={set('town')} />}</Field>
        <Field label="Company type" help="From Companies House">{(id, d) => <select id={id} className="select" aria-describedby={d} value={p.company_type} onChange={set('company_type')}>{(Object.entries(COMPANY_LABEL) as [CompanyType, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
        <Field label="Where you found them" optional>{(id) => <input id={id} className="input" value={p.source ?? ''} placeholder="Their website, a referral…" onChange={set('source')} />}</Field>
      </div>
    </Modal>
  );
}

function ImportList({ onClose }: { onClose: () => void }) {
  const [csv, setCsv] = useState(''); const [source, setSource] = useState('Clinic outreach list');
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const file = async (e: any) => { const f: File | undefined = e.target.files?.[0]; if (f) setCsv(await f.text()); };
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await biz.importCsv(csv, source); setRes(`${r.added} added.${r.duplicates ? ` ${r.duplicates} already on your list.` : ''}${r.blocked ? ` ${r.blocked} asked not to be contacted.` : ''}${r.skipped ? ` ${r.skipped} rows had no business name.` : ''}`); }
    catch (e) { setErr(humanThrown(e, 'That didn’t import.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Import a list" onClose={onClose} footer={res ? <Button onClick={onClose}>Done</Button> : <><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!csv.trim()} onClick={go}>Import</Button></>}>
      {res ? <p>{res}</p> : (
        <div className="stack gap-16">
          <p className="small muted">A spreadsheet saved as CSV, with a header row. Columns are matched by name: Business, Contact, Email, Phone, Website, Town, Company type, Instagram, LinkedIn, Personal line, Notes. Duplicates are skipped.</p>
          <Field label="CSV file">{(id) => <input id={id} type="file" accept=".csv,text/csv" onChange={file} />}</Field>
          <Field label="Or paste it" error={err ?? undefined}>{(id, d) => <textarea id={id} className="textarea" rows={6} aria-describedby={d} value={csv} onChange={(e: any) => setCsv(e.target.value)} placeholder={'Business,Contact,Email,Town,Company type\nExample Clinic Ltd,Sam,sam@example.co.uk,Crewe,Limited'} />}</Field>
          <Field label="Where the list came from">{(id) => <input id={id} className="input" value={source} onChange={(e: any) => setSource(e.target.value)} />}</Field>
        </div>
      )}
    </Modal>
  );
}

/* ---------- One prospect ---------- */

export function ProspectPage({ id }: { id: string }) {
  const { data: d, error, reload } = useLoad(() => biz.prospect(id), [id]);
  const [p, setP] = useState<Partial<Prospect>>({});
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Partial<ProposalRow> | null>(null);
  const toast = useToast();
  useEffect(() => { if (d) setP(d.prospect); }, [d]);
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!d) return <Loading label="Loading the prospect" />;
  const x = d.prospect;
  const set = (k: keyof Prospect) => (e: any) => setP({ ...p, [k]: e.target.value });
  const save = async (extra: Partial<Prospect> = {}) => { setBusy(true); try { await biz.saveProspect({ ...p, ...extra, id: x.id }); toast('Saved'); reload(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  const stop = async () => { if (!confirmed('They won’t get any more messages, and their email goes on the do-not-contact list.')) return; await biz.doNotContact(x.id); toast('They won’t be contacted again'); reload(); };
  return (
    <div className="page">
      <p className="small"><Link to="/sales?tab=prospects">← Prospects</Link></p>
      <div className="page-head">
        <div><h1 className="title">{x.business_name}</h1><p className="lede row gap-8 wrap"><StageChip stage={x.stage} /><span className="small muted">{[x.contact_name, x.town, COMPANY_LABEL[x.company_type]].filter(Boolean).join(' · ')}</span></p></div>
        <div className="row gap-8 wrap">
          {x.stage !== 'won' && <Button icon="contract" onClick={() => setProposal({ business_name: x.business_name, contact_name: x.contact_name, email: x.email, prospect_id: x.id })}>Make a proposal</Button>}
          {x.client_email && <Link className="btn btn-secondary" to={`/clients/${encodeURIComponent(x.client_email)}`}>Open client</Link>}
        </div>
      </div>
      <div className="grid-2">
        <div className="stack gap-24">
          {d.draft && x.next_on && (
            <section className="panel panel-pad stack gap-12" aria-labelledby="next-h">
              <h2 className="heading" id="next-h">Next message: {CHANNEL_LABEL[d.draft.channel]}, {dueLabel(x.next_on, new Date().toISOString().slice(0, 10)).toLowerCase()}</h2>
              {d.draft.channel === 'email' && <p className="small muted">{d.email_ok.why}</p>}
              {d.draft.subject && <p className="small"><span className="faint">{d.draft.channel === 'email' ? 'Subject: ' : 'Step: '}</span>{d.draft.subject}</p>}
              <pre className="draft-pre">{d.draft.body}</pre>
              <p className="xsmall faint">It’s in Follow-ups on the day it’s due.</p>
            </section>
          )}
          <section className="panel panel-pad stack gap-16" aria-labelledby="pd-h">
            <h2 className="heading" id="pd-h">Details</h2>
            <div className="form-grid">
              <Field label="Stage">{(id) => <select id={id} className="select" value={p.stage ?? x.stage} onChange={set('stage')}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}</Field>
              {(p.stage ?? x.stage) === 'call' && <Field label="Call booked for">{(id) => <input id={id} className="input" type="datetime-local" value={p.call_at ? toLocal(p.call_at) : ''} onChange={(e: any) => setP({ ...p, call_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />}</Field>}
              {(p.stage ?? x.stage) === 'lost' && <Field label="Why not now" optional>{(id) => <input id={id} className="input" value={p.lost_reason ?? ''} onChange={set('lost_reason')} />}</Field>}
              <Field label="Business name">{(id) => <input id={id} className="input" value={p.business_name ?? ''} onChange={set('business_name')} />}</Field>
              <Field label="Contact name">{(id) => <input id={id} className="input" value={p.contact_name ?? ''} onChange={set('contact_name')} />}</Field>
              <Field label="Their role" optional>{(id) => <input id={id} className="input" value={p.role ?? ''} onChange={set('role')} />}</Field>
              <Field label="Email">{(id) => <input id={id} className="input" type="email" value={p.email ?? ''} onChange={set('email')} />}</Field>
              <Field label="Phone">{(id) => <input id={id} className="input" type="tel" value={p.phone ?? ''} onChange={set('phone')} />}</Field>
              <Field label="Website">{(id) => <input id={id} className="input" value={p.website ?? ''} onChange={set('website')} />}</Field>
              <Field label="Instagram">{(id) => <input id={id} className="input" value={p.instagram ?? ''} onChange={set('instagram')} />}</Field>
              <Field label="LinkedIn">{(id) => <input id={id} className="input" value={p.linkedin ?? ''} onChange={set('linkedin')} />}</Field>
              <Field label="Town">{(id) => <input id={id} className="input" value={p.town ?? ''} onChange={set('town')} />}</Field>
              <Field label="Company type" help="Check on Companies House">{(id, dd) => <select id={id} className="select" aria-describedby={dd} value={p.company_type ?? 'unknown'} onChange={set('company_type')}>{(Object.entries(COMPANY_LABEL) as [CompanyType, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
            </div>
            <label className="check-row"><input type="checkbox" checked={!!p.consent} onChange={(e: any) => setP({ ...p, consent: e.target.checked })} /> They said yes to hearing from Gainora by email</label>
            {p.consent && <Field label="How and when they said yes">{(id) => <input id={id} className="input" value={p.consent_note ?? ''} placeholder="e.g. On the phone, 12 Nov" onChange={set('consent_note')} />}</Field>}
            <Field label="Personal line for the first message" optional help="One true, specific sentence about their business. Left out of the message when empty; never made up.">{(id, dd) => <textarea id={id} className="textarea" rows={2} aria-describedby={dd} value={p.personal_line ?? ''} onChange={set('personal_line')} />}</Field>
            <Field label="Notes" optional>{(id) => <textarea id={id} className="textarea" rows={4} value={p.note ?? ''} onChange={set('note')} />}</Field>
            <div className="row gap-8 wrap"><Button busy={busy} onClick={() => save()}>Save</Button>{!x.unsubscribed_at && <Button kind="quiet" onClick={stop}>Don’t contact again</Button>}</div>
          </section>
        </div>
        <div className="stack gap-24">
          <section className="panel" aria-labelledby="hist-h">
            <div className="panel-head"><h2 className="heading" id="hist-h">Messages</h2></div>
            {d.messages.length ? <ul className="plain-list timeline">{d.messages.map((m) => (
              <li key={m.id}><span className="row gap-8 wrap"><span className={`chan chan-${m.channel}`}>{CHANNEL_LABEL[m.channel]}</span><span className="xsmall faint">Message {(m.step ?? 0) + 1} · {m.status === 'sent' ? 'Sent' : m.status === 'skipped' ? 'Skipped' : 'Didn’t send'} {relative(m.sent_at)} by {m.by}</span></span>{m.subject && <strong className="small">{m.subject}</strong>}{m.error && <span className="xsmall due-late">{m.error}</span>}</li>
            ))}</ul> : <p className="panel-pad muted">No messages yet.</p>}
          </section>
          <section className="panel" aria-labelledby="props-h">
            <div className="panel-head"><h2 className="heading" id="props-h">Proposals</h2></div>
            {d.proposals.length ? <ul className="plain-list">{d.proposals.map((r) => <li key={r.id} className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}><span className="stack gap-2"><span className="small">{r.items.map((i) => i.name).join(', ')}</span><span className="xsmall faint">{proposalSummary(r)}</span></span><ProposalStatus p={r} /></li>)}</ul> : <p className="panel-pad muted">None yet.</p>}
          </section>
          <p className="xsmall faint">Added {relative(x.created_at)} from {x.source || 'unknown'}.{' '}<button type="button" className="linklike" onClick={async () => { if (!confirmed('Delete this prospect and their message history?')) return; await biz.deleteProspect(x.id); navigate('/sales?tab=prospects'); }}>Delete prospect</button></p>
        </div>
      </div>
      {proposal && <ProposalEditor initial={proposal} onClose={() => setProposal(null)} onDone={() => { setProposal(null); reload(); }} />}
    </div>
  );
}
const toLocal = (iso: string) => { const d = new Date(iso); const z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const confirmed = (msg: string) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(msg) : true);

/* ---------- Proposals ---------- */

const proposalSummary = (p: Pick<ProposalRow, 'items'>) => { const t = proposalTotals(p.items); return [t.today ? `${money(t.today)} to start` : '', t.monthly ? `${money(t.monthly)} a month` : ''].filter(Boolean).join(', then '); };
function ProposalStatus({ p }: { p: ProposalRow }) {
  const label = { draft: 'Draft', sent: 'Sent, not opened', viewed: 'Opened', paid: 'Paid', cancelled: 'Cancelled' }[p.status];
  const tone = p.status === 'paid' ? 'tag-forest' : p.status === 'viewed' ? 'tag-brass' : 'tag-plain';
  const when = p.status === 'paid' ? p.paid_at : p.status === 'viewed' ? p.viewed_at : p.status === 'sent' ? p.sent_at : null;
  return <span className="stack gap-2" style={{ justifyItems: 'end' }}><span className={`tag ${tone}`}>{label}</span>{when && <span className="xsmall faint">{relative(when)}</span>}</span>;
}

function Proposals({ o, reload, onNew, onEdit }: { o: SalesOverview; reload: () => void; onNew: () => void; onEdit: (p: ProposalRow) => void }) {
  const toast = useToast();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const list = o.proposals.filter((p) => show === 'all' || p.status === 'draft' || p.status === 'sent' || p.status === 'viewed');
  return (
    <div className="stack gap-16">
      <div className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
        <div className="seg" role="group" aria-label="Show">{(['open', 'all'] as const).map((s) => <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>{s === 'open' ? 'Open' : 'All'}</button>)}</div>
        <Button icon="plus" onClick={onNew}>New proposal</Button>
      </div>
      <section className="panel">
        {list.length ? <ul className="plain-list">{list.map((p) => (
          <li key={p.id} className="row gap-16 wrap proposal-row">
            <div className="stack gap-4 grow">
              <span className="row gap-8 wrap"><strong>{p.business_name}</strong>{p.created_by === 'Claude' && <span className="who who-claude">Drafted by Claude</span>}</span>
              <span className="small">{p.items.map((i) => i.name).join(', ')}</span>
              <span className="xsmall faint">{proposalSummary(p)}{p.trial_days ? ` · ${p.trial_days}-day free trial` : ''}{p.expires_on && p.status !== 'paid' ? ` · link works until ${shortDate(p.expires_on)}` : ''}</span>
            </div>
            <ProposalStatus p={p} />
            <div className="row gap-8 wrap">
              <Button small kind="secondary" icon="copy" onClick={async () => toast((await copyText(p.url)) ? 'Link copied' : 'Couldn’t copy')}>Link</Button>
              <a className="btn btn-secondary btn-small" href={p.url} target="_blank" rel="noreferrer"><Icon name="external" />View</a>
              {p.status !== 'paid' && p.status !== 'cancelled' && <Button small kind="secondary" icon="pencil" onClick={() => onEdit(p)}>{p.status === 'draft' ? 'Edit and send' : 'Edit or resend'}</Button>}
              {p.status !== 'paid' && p.status !== 'cancelled' && <Button small kind="quiet" onClick={async () => { if (!confirmed('Cancel this proposal? Its link stops working.')) return; await biz.cancelProposal(p.id); reload(); }}>Cancel</Button>}
            </div>
          </li>
        ))}</ul> : <div className="panel-pad"><p className="muted">No {show === 'open' ? 'open ' : ''}proposals. Make one from the price book; when they pay, they become a client and their set-up starts.</p></div>}
      </section>
    </div>
  );
}

export function ProposalEditor({ initial, onClose, onDone }: { initial: Partial<ProposalRow>; onClose: () => void; onDone: () => void }) {
  const { data: book } = useLoad(() => biz.prices());
  const [p, setP] = useState<Partial<ProposalRow>>({ items: [], trial_days: 0, note: '', expires_on: addDays(new Date().toISOString().slice(0, 10), 14), ...initial });
  const [saved, setSaved] = useState<ProposalRow | null>(initial.id ? (initial as ProposalRow) : null);
  const [message, setMessage] = useState('Thank you for your time on our call. Here’s the proposal we talked about, with everything included and the prices.');
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const items = p.items ?? [];
  const active = (book?.prices ?? []).filter((x) => x.active);
  const has = (k: string) => items.some((i) => i.key === k);
  const toggle = (x: PriceItem) => setP({ ...p, items: has(x.key) ? items.filter((i) => i.key !== x.key) : [...items, fromPriceItem(x)] });
  const setItem = (k: string, patch: Partial<ProposalItem>) => setP({ ...p, items: items.map((i) => (i.key === k ? { ...i, ...patch } : i)) });
  const t = proposalTotals(items);
  const save = async (): Promise<ProposalRow | null> => {
    setBusy('save'); setErr(null);
    try { const r = await biz.saveProposal({ ...p, id: saved?.id ?? p.id }); setSaved(r); setP(r); return r; }
    catch (e) { setErr(humanThrown(e, 'That didn’t save.')); return null; } finally { setBusy(null); }
  };
  const send = async () => {
    const r = await save(); if (!r) return;
    setBusy('send');
    try { await biz.sendProposal(r.id, message); toast(`Proposal sent to ${r.email}`); onDone(); }
    catch (e) { setErr(humanThrown(e, 'That didn’t send.')); } finally { setBusy(null); }
  };
  return (
    <Modal title={saved ? `Proposal for ${saved.business_name}` : 'New proposal'} onClose={() => (saved ? onDone() : onClose())} footer={<>
      <Button kind="secondary" busy={busy === 'save'} onClick={async () => { if (await save()) toast('Draft saved'); }}>Save draft</Button>
      <Button icon="send" busy={busy === 'send'} disabled={!items.length || !p.email} onClick={send}>{saved?.sent_at ? 'Save and resend' : 'Save and send'}</Button>
    </>}>
      <div className="stack gap-16">
        <div className="form-grid">
          <Field label="Business">{(id) => <input id={id} className="input" value={p.business_name ?? ''} onChange={(e: any) => setP({ ...p, business_name: e.target.value })} />}</Field>
          <Field label="Contact name">{(id) => <input id={id} className="input" value={p.contact_name ?? ''} onChange={(e: any) => setP({ ...p, contact_name: e.target.value })} />}</Field>
          <Field label="Email to send it to">{(id) => <input id={id} className="input" type="email" value={p.email ?? ''} onChange={(e: any) => setP({ ...p, email: e.target.value })} />}</Field>
          <Field label="Link works until">{(id) => <input id={id} className="input" type="date" value={p.expires_on ?? ''} onChange={(e: any) => setP({ ...p, expires_on: e.target.value })} />}</Field>
        </div>
        <Field label="Packages" as="group">{() => !book ? <Loading label="Loading prices" /> : (
          <ul className="pick-list">{active.map((x) => (
            <li key={x.key}>
              <label className="check-row"><input type="checkbox" checked={has(x.key)} onChange={() => toggle(x)} /><span><strong className="small">{x.name}</strong><span className="xsmall faint"> {[x.setup && `${money(x.setup)} set-up`, x.monthly && `${money(x.monthly)}/month`, x.one_off && money(x.one_off)].filter(Boolean).join(' · ')}</span></span></label>
              {has(x.key) && (() => { const i = items.find((y) => y.key === x.key)!; return (
                <div className="row gap-8 wrap item-prices">
                  {(x.setup > 0 || i.setup > 0) && <Field label="Set-up £">{(id) => <input id={id} className="input input-num" type="number" min={0} value={i.setup} onChange={(e: any) => setItem(x.key, { setup: Number(e.target.value) })} />}</Field>}
                  {(x.monthly > 0 || i.monthly > 0) && <Field label="Monthly £">{(id) => <input id={id} className="input input-num" type="number" min={0} value={i.monthly} onChange={(e: any) => setItem(x.key, { monthly: Number(e.target.value) })} />}</Field>}
                  {(x.one_off > 0 || i.one_off > 0) && <Field label="One-off £">{(id) => <input id={id} className="input input-num" type="number" min={0} value={i.one_off} onChange={(e: any) => setItem(x.key, { one_off: Number(e.target.value) })} />}</Field>}
                </div>
              ); })()}
            </li>
          ))}</ul>
        )}</Field>
        {items.length > 0 && <p className="small totals-line"><strong>{t.today ? `${money(t.today)} today` : 'Nothing today'}{t.monthly ? `, then ${money(t.monthly)} a month` : ''}</strong> <span className="faint">excluding VAT{t.minimum ? ` · ${t.minimum}-month minimum` : ''}</span></p>}
        <Field label="Free trial on the monthly price (days)" optional>{(id) => <input id={id} className="input input-num" type="number" min={0} max={90} value={p.trial_days ?? 0} onChange={(e: any) => setP({ ...p, trial_days: Number(e.target.value) })} />}</Field>
        <Field label="A note at the top" optional help="Shown on the proposal page.">{(id, d) => <textarea id={id} className="textarea" rows={3} aria-describedby={d} value={p.note ?? ''} onChange={(e: any) => setP({ ...p, note: e.target.value })} />}</Field>
        <Field label="The email that goes with it" help="The proposal’s link, the price and the date it works until are added underneath.">{(id, d) => <textarea id={id} className="textarea" rows={3} aria-describedby={d} value={message} onChange={(e: any) => setMessage(e.target.value)} />}</Field>
        {saved && <p className="xsmall faint">Link: <a href={saved.url} target="_blank" rel="noreferrer">{saved.url}</a></p>}
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/* ---------- Sequences: the messages and when they go ---------- */

function Sequences({ o, reload }: { o: SalesOverview; reload: () => void }) {
  const [list, setList] = useState<Sequence[]>(o.sequences);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const setSeq = (i: number, patch: Partial<Sequence>) => setList(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setStep = (i: number, k: number, patch: Partial<SequenceStep>) => setSeq(i, { steps: list[i].steps.map((st, j) => (j === k ? { ...st, ...patch } : st)) });
  const save = async () => { setBusy(true); try { setList(await biz.saveSequences(list)); toast('Messages saved'); reload(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <div className="stack gap-24">
      <p className="small muted">Each set of messages goes out on the days shown, counted from the first message. They stop as soon as someone replies or asks to stop. You can use {'{first_name}'}, {'{business}'}, {'{town}'}, {'{personal_line}'}, {'{booking_link}'} and {'{my_name}'}. Emails get your name and an unsubscribe link added at the bottom.</p>
      {list.map((s, i) => (
        <section key={s.id || i} className="panel panel-pad stack gap-16" aria-label={s.name}>
          <div className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
            <Field label="Name">{(id) => <input id={id} className="input" value={s.name} onChange={(e: any) => setSeq(i, { name: e.target.value })} />}</Field>
            <label className="check-row"><input type="checkbox" checked={s.active} onChange={(e: any) => setSeq(i, { active: e.target.checked })} /> In use</label>
          </div>
          {s.steps.map((st, k) => (
            <div key={k} className="seq-step stack gap-12">
              <div className="row gap-12 wrap">
                <strong className="small">Message {k + 1}</strong>
                <Field label="Day">{(id) => <input id={id} className="input input-num" type="number" min={0} max={90} value={st.day} onChange={(e: any) => setStep(i, k, { day: Number(e.target.value) })} />}</Field>
                <Field label="How">{(id) => <select id={id} className="select" value={st.channel} onChange={(e: any) => setStep(i, k, { channel: e.target.value as Channel })}>{(Object.entries(CHANNEL_LABEL) as [Channel, string][]).map(([c, l]) => <option key={c} value={c}>{l}{c === 'email' ? '' : ' (you send it)'}</option>)}</select>}</Field>
                {s.steps.length > 1 && <Button small kind="quiet" onClick={() => setSeq(i, { steps: s.steps.filter((_, j) => j !== k) })}>Remove</Button>}
              </div>
              {st.channel === 'email' && <Field label="Subject">{(id) => <input id={id} className="input" value={st.subject} onChange={(e: any) => setStep(i, k, { subject: e.target.value })} />}</Field>}
              <Field label="Message">{(id) => <textarea id={id} className="textarea" rows={Math.min(14, st.body.split('\n').length + 1)} value={st.body} onChange={(e: any) => setStep(i, k, { body: e.target.value })} />}</Field>
            </div>
          ))}
          {s.steps.length < 10 && <div><Button small kind="secondary" icon="plus" onClick={() => setSeq(i, { steps: [...s.steps, { day: (s.steps[s.steps.length - 1]?.day ?? 0) + 4, channel: 'email', subject: '', body: 'Hi {first_name},\n\n' }] })}>Add a message</Button></div>}
        </section>
      ))}
      <div className="row gap-8 wrap"><Button busy={busy} onClick={save}>Save messages</Button><Button kind="secondary" icon="plus" onClick={() => setList([...list, { id: '', name: 'New messages', active: true, steps: [{ day: 0, channel: 'email', subject: '', body: 'Hi {first_name},\n\n' }] }])}>New set of messages</Button></div>
    </div>
  );
}

/* ---------- Results and outreach settings ---------- */

function Results({ o, reload }: { o: SalesOverview; reload: () => void }) {
  const f = o.funnel;
  const [s, setS] = useState(o.outreach);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => { setBusy(true); try { setS(await biz.saveOutreach(s)); toast('Saved'); reload(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  const max = Math.max(1, ...STAGES.map((x) => f.by[x.id]));
  return (
    <div className="stack gap-24">
      <section className="panel stats" aria-label="Outreach results">
        <div className="stat"><span className="stat-label">Contacted</span><span className="stat-value">{f.reached}</span><span className="stat-note">of {f.total} prospects · {f.sentThisWeek} messages this week</span></div>
        <div className="stat"><span className="stat-label">Reply rate</span><span className="stat-value">{pct(f.replyRate)}</span><span className="stat-note">Of everyone contacted</span></div>
        <div className="stat"><span className="stat-label">Call rate</span><span className="stat-value">{pct(f.callRate)}</span><span className="stat-note">Booked a call</span></div>
        <div className="stat"><span className="stat-label">Win rate</span><span className="stat-value">{pct(f.winRate)}</span><span className="stat-note">Of calls and proposals</span></div>
      </section>
      <div className="grid-2">
        <section className="panel panel-pad stack gap-12" aria-labelledby="stages-h">
          <h2 className="heading" id="stages-h">Where everyone is</h2>
          <ul className="bars">{STAGES.map((x) => <li key={x.id}><span className="small">{x.label}</span><span className="bar"><span style={{ width: `${(f.by[x.id] / max) * 100}%` }} /></span><span className="small num">{f.by[x.id]}</span></li>)}</ul>
        </section>
        <section className="panel panel-pad stack gap-16" aria-labelledby="out-h">
          <h2 className="heading" id="out-h">Sending</h2>
          {!o.outreach.ready && <p className="small notice-box">To send from the admin, Outreach email needs a sending address on its own domain, verified with Resend, set as OUTREACH_FROM in Netlify. Until then, copy each message and send it yourself.</p>}
          <label className="check-row"><input type="checkbox" checked={s.autoSend} disabled={!o.outreach.ready} onChange={(e: any) => setS({ ...s, autoSend: e.target.checked })} /> Send due emails automatically at 9:30am on weekdays</label>
          <div className="form-grid">
            <Field label="Most emails a day" help="Start low on a new domain: 10 to 20.">{(id, d) => <input id={id} className="input input-num" type="number" min={1} max={100} aria-describedby={d} value={s.dailyLimit} onChange={(e: any) => setS({ ...s, dailyLimit: Number(e.target.value) })} />}</Field>
            <Field label="Your name in messages">{(id) => <input id={id} className="input" value={s.myName} onChange={(e: any) => setS({ ...s, myName: e.target.value })} />}</Field>
            <Field label="Booking link">{(id) => <input id={id} className="input" value={s.bookingLink} onChange={(e: any) => setS({ ...s, bookingLink: e.target.value })} />}</Field>
          </div>
          <div><Button busy={busy} onClick={save}>Save</Button></div>
        </section>
      </div>
    </div>
  );
}
