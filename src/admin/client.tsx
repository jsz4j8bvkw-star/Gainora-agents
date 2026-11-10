import { useEffect, useState } from 'react';
import { Link, queryParam } from '../lib/router';
import { Button, ErrorNote, Field, Loading, Tabs, useLoad, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { relative, shortDate } from '../lib/format';
import { Website } from '../pages/website';
import { gbp, monthStart } from '../../shared/admin/money';
import { ACCOUNT_STATUS_LABEL, type AccountRecord, type AccountStatus, PACKAGES, PROJECT_LABEL, type Project, type TaskWho, WHO_LABEL } from '../../shared/admin/model';
import { ukToday } from '../../shared/admin/board';
import { admin, type AccountDetail, type ClientTask } from './api';
import { PackageChips, StartSetup, StatusChip, TaskRow } from './bits';

type Section = 'overview' | 'delivery' | 'website' | 'enquiries' | 'costs' | 'notes';
const SECTIONS: Section[] = ['overview', 'delivery', 'website', 'enquiries', 'costs', 'notes'];

export function ClientPage({ email }: { email: string }) {
  const { data: d, error, reload } = useLoad<AccountDetail>(() => admin.account(email), [email]);
  const [section, setSection] = useState<Section>(() => { const s = queryParam('section') as Section | null; return s && SECTIONS.includes(s) ? s : 'overview'; });
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!d) return <Loading label="Loading the client" />;
  const a = d.account;
  const today = ukToday();
  const open = d.tasks.filter((t) => t.status !== 'done');
  const started = [...new Set(d.tasks.map((t) => t.project))].filter((p): p is 'launch' | 'capture' | 'command' => p !== 'other');
  return (
    <div className="page">
      <p className="small"><Link to="/clients">← Clients</Link></p>
      <div className="page-head">
        <div>
          <h1 className="title">{a.name}</h1>
          <p className="lede row gap-8 wrap"><PackageChips packages={a.packages} /><StatusChip status={a.status} /><span className="small muted">{a.email}{a.phone ? ` · ${a.phone}` : ''}</span></p>
        </div>
        <StartSetup email={a.email} packages={a.packages} started={started} onDone={reload} />
      </div>
      <Tabs<Section> label="Client" value={section} onChange={setSection} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'delivery', label: 'Delivery', badge: a.overdue ? `${a.overdue} late` : open.length || null },
        { id: 'website', label: 'Website', badge: d.requests.length || null },
        { id: 'enquiries', label: 'Enquiries' },
        { id: 'costs', label: 'Costs' },
        { id: 'notes', label: 'Notes', badge: d.log.length || null },
      ]} />
      {section === 'overview' && <OverviewTab d={d} today={today} reload={reload} go={setSection} />}
      {section === 'delivery' && <DeliveryTab d={d} today={today} reload={reload} />}
      {section === 'website' && (d.site
        ? <Website embedded={{ slug: d.site.slug, hasCapture: a.packages.includes('capture') }} />
        : <div className="panel empty"><h2 className="heading">No website yet</h2><p className="muted">{a.packages.includes('launch') ? 'It’s created the first time they open Your website in Command Centre, from their onboarding answers.' : 'Websites come with Launch & Grow.'}</p></div>)}
      {section === 'enquiries' && <EnquiriesTab d={d} />}
      {section === 'costs' && <CostsTab d={d} reload={reload} />}
      {section === 'notes' && <NotesTab d={d} reload={reload} />}
    </div>
  );
}

/* ---------- Overview ---------- */

function OverviewTab({ d, today, reload, go }: { d: AccountDetail; today: string; reload: () => void; go: (s: Section) => void }) {
  const a = d.account;
  const [rec, setRec] = useState<Partial<AccountRecord>>(d.record ?? {});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setRec(d.record ?? {}), [d.record]);
  const save = async () => { setBusy(true); try { await admin.saveAccount(a.email, rec); toast('Saved'); reload(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  const next = d.tasks.filter((t) => t.status !== 'done').sort((x, y) => (x.due_on ?? '9999').localeCompare(y.due_on ?? '9999')).slice(0, 6);
  const cost = d.costs[0];
  return (
    <div className="grid-2">
      <div className="stack gap-24">
        <section className="panel panel-pad stack gap-16" aria-labelledby="who-h">
          <h2 className="heading" id="who-h">Client details</h2>
          <div className="form-grid">
            <Field label="Business name">{(id) => <input id={id} className="input" value={rec.business_name ?? ''} placeholder={a.name} onChange={(e: any) => setRec({ ...rec, business_name: e.target.value })} />}</Field>
            <Field label="Contact">{(id) => <input id={id} className="input" value={rec.contact_name ?? ''} onChange={(e: any) => setRec({ ...rec, contact_name: e.target.value })} />}</Field>
            <Field label="Phone">{(id) => <input id={id} className="input" type="tel" value={rec.phone ?? ''} onChange={(e: any) => setRec({ ...rec, phone: e.target.value })} />}</Field>
            <Field label="Status">{(id) => <select id={id} className="select" value={rec.status ?? a.status} onChange={(e: any) => setRec({ ...rec, status: e.target.value as AccountStatus })}>{(Object.entries(ACCOUNT_STATUS_LABEL) as [AccountStatus, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
            <Field label="Started">{(id) => <input id={id} className="input" type="date" value={rec.started_on ?? ''} onChange={(e: any) => setRec({ ...rec, started_on: e.target.value || null })} />}</Field>
            <Field label="Set-up fee (£)" optional>{(id) => <input id={id} className="input" type="number" min={0} value={rec.setup_fee ?? ''} onChange={(e: any) => setRec({ ...rec, setup_fee: e.target.value === '' ? null : Number(e.target.value) })} />}</Field>
          </div>
          <label className="check-row"><input type="checkbox" checked={!!rec.setup_paid} onChange={(e: any) => setRec({ ...rec, setup_paid: e.target.checked })} /> Set-up fee paid</label>
          <Field label="What to remember about them" optional>{(id) => <textarea id={id} className="textarea" rows={4} value={rec.notes ?? ''} placeholder="How they like to be contacted, what matters to them, anything agreed." onChange={(e: any) => setRec({ ...rec, notes: e.target.value })} />}</Field>
          <div><Button busy={busy} onClick={save}>Save</Button></div>
        </section>
        <section className="panel" aria-labelledby="next-h">
          <div className="panel-head"><h2 className="heading" id="next-h">Next steps</h2><button className="linklike small" onClick={() => go('delivery')}>All {d.tasks.length}</button></div>
          {next.length ? <ul className="task-list">{next.map((t) => <TaskRow key={t.id} task={t} today={today} onChange={reload} />)}</ul> : <p className="panel-pad muted">{d.tasks.length ? 'All done.' : 'No set-up started yet.'}</p>}
        </section>
      </div>
      <div className="stack gap-24">
        <section className="panel panel-pad stack gap-12" aria-labelledby="bill-h">
          <h2 className="heading" id="bill-h">Billing</h2>
          <dl className="facts-list">
            <div><dt>Pays a month</dt><dd>{gbp(a.monthly)}</dd></div>
            <div><dt>Subscription</dt><dd>{a.billing === 'past_due' ? 'Payment failed' : a.billing === 'trialing' ? 'Free trial' : a.billing === 'active' ? 'Active' : a.billing === 'canceled' ? 'Cancelled' : 'None'}</dd></div>
            <div><dt>Renews</dt><dd>{a.renewsOn ? shortDate(a.renewsOn) : '–'}</dd></div>
            <div><dt>Set-up fee</dt><dd>{d.record?.setup_fee ? `${gbp(d.record.setup_fee, true)} ${d.record.setup_paid ? '(paid)' : '(not paid)'}` : '–'}</dd></div>
            <div><dt>Costs this month</dt><dd>{gbp(cost?.total ?? 0)}</dd></div>
            <div><dt>Margin this month</dt><dd>{gbp(cost?.margin ?? null)}</dd></div>
          </dl>
        </section>
        <section className="panel panel-pad stack gap-12" aria-labelledby="apps-h">
          <h2 className="heading" id="apps-h">Their apps</h2>
          <ul className="plain-list compact">
            <li><strong>Command Centre</strong> <span className="small muted">{a.packages.includes('command') ? (d.tasks.find((t) => t.template_key === 'cmd:onboarding')?.status === 'done' ? 'Onboarding done' : 'Onboarding not finished') : 'Not on their plan'}</span></li>
            <li><strong>Capture &amp; Convert</strong> <span className="small muted">{d.capture ? `${d.capture.completed ? 'Questionnaire done' : 'Questionnaire not finished'}${d.capture.booking ? ` · ${d.capture.booking}` : ''}` : a.packages.includes('capture') ? 'Not opened yet' : 'Not on their plan'}</span></li>
            <li><strong>Website</strong> <span className="small muted">{d.site ? `${d.site.live ? 'Live' : 'Not live'}${d.site.domain ? ` on ${d.site.domain}` : ` at /site/${d.site.slug}/`}${d.site.fixes ? ` · ${d.site.fixes} to fix` : ''}` : a.packages.includes('launch') ? 'Not created yet' : 'Not on their plan'}</span>{d.site && <button className="linklike small" style={{ marginLeft: 8 }} onClick={() => go('website')}>Open</button>}</li>
          </ul>
        </section>
        <section className="panel" aria-labelledby="recent-h">
          <div className="panel-head"><h2 className="heading" id="recent-h">Recent notes</h2><button className="linklike small" onClick={() => go('notes')}>Add a note</button></div>
          {d.log.length ? <ul className="plain-list">{d.log.slice(0, 4).map((l) => <li key={l.id}><p className="small">{l.text}</p><span className="xsmall faint">{l.author} · {relative(l.at)}</span></li>)}</ul> : <p className="panel-pad muted">No notes yet.</p>}
        </section>
      </div>
    </div>
  );
}

/* ---------- Delivery ---------- */

function DeliveryTab({ d, today, reload }: { d: AccountDetail; today: string; reload: () => void }) {
  const [title, setTitle] = useState(''); const [due, setDue] = useState(''); const [who, setWho] = useState<TaskWho>('gainora'); const [project, setProject] = useState<Project>('other');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const toast = useToast();
  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { await admin.saveTask({ email: d.account.email, title, due_on: due || null, who, project }); setTitle(''); setDue(''); reload(); }
    catch (e) { toast(humanThrown(e, 'The task wasn’t added.')); } finally { setBusy(false); }
  };
  const groups = (['launch', 'capture', 'command', 'other'] as Project[]).map((p) => ({ p, list: d.tasks.filter((t) => t.project === p && (showDone || t.status !== 'done')) })).filter((g) => g.list.length || (g.p === 'other' && false));
  const total = (p: Project) => d.tasks.filter((t) => t.project === p);
  return (
    <div className="stack gap-24">
      <section className="panel panel-pad stack gap-12" aria-label="Add a task">
        <div className="row gap-12 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Add a task" className="grow">{(id) => <input id={id} className="input" value={title} placeholder="For example: send Amy the photo checklist" onChange={(e: any) => setTitle(e.target.value)} onKeyDown={(e: any) => e.key === 'Enter' && add()} />}</Field>
          <Field label="Due">{(id) => <input id={id} className="input" type="date" value={due} onChange={(e: any) => setDue(e.target.value)} />}</Field>
          <Field label="Who">{(id) => <select id={id} className="select" value={who} onChange={(e: any) => setWho(e.target.value)}>{(Object.entries(WHO_LABEL) as [TaskWho, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Package">{(id) => <select id={id} className="select" value={project} onChange={(e: any) => setProject(e.target.value)}>{(Object.entries(PROJECT_LABEL) as [Project, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Button busy={busy} onClick={add} icon="plus">Add</Button>
        </div>
        <p className="xsmall faint">Give a task to Claude and ask Claude to do it in any chat with the Gainora admin connector switched on.</p>
      </section>
      <label className="check-row"><input type="checkbox" checked={showDone} onChange={(e: any) => setShowDone(e.target.checked)} /> Show done steps</label>
      {groups.map(({ p, list }) => (
        <section key={p} className="panel" aria-label={PROJECT_LABEL[p]}>
          <div className="panel-head"><h2 className="heading">{PROJECT_LABEL[p]}</h2><span className="small faint">{total(p).filter((t) => t.status === 'done').length} of {total(p).length} done</span></div>
          {list.length ? <ul className="task-list">{list.map((t) => <EditableTask key={t.id} task={t} today={today} onChange={reload} />)}</ul> : <p className="panel-pad muted">All done.</p>}
        </section>
      ))}
      {!d.tasks.length && <div className="panel empty"><p className="muted">No set-up started. Use the Start set-up buttons at the top.</p></div>}
    </div>
  );
}

function EditableTask({ task, today, onChange }: { task: ClientTask; today: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const set = async (patch: Partial<ClientTask>) => { try { await admin.saveTask({ id: task.id, ...patch }); onChange(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } };
  const editor = open ? (
    <>
      <Field label="Status">{(id) => <select id={id} className="select" value={task.status} onChange={(e: any) => set({ status: e.target.value })}><option value="todo">To do</option><option value="doing">Doing</option><option value="waiting">Waiting</option><option value="done">Done</option></select>}</Field>
      <Field label="Due">{(id) => <input id={id} className="input" type="date" value={task.due_on ?? ''} onChange={(e: any) => set({ due_on: e.target.value || null })} />}</Field>
      <Field label="Who">{(id) => <select id={id} className="select" value={task.who} onChange={(e: any) => set({ who: e.target.value })}>{(Object.entries(WHO_LABEL) as [TaskWho, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
      {!task.template_key && <Button small kind="quiet" icon="x" onClick={async () => { await admin.deleteTask(task.id); onChange(); }}>Delete</Button>}
    </>
  ) : null;
  return <TaskRow task={task} today={today} onChange={onChange} onEdit={() => setOpen(!open)} editor={editor} />;
}

/* ---------- Enquiries ---------- */

function EnquiriesTab({ d }: { d: AccountDetail }) {
  return (
    <div className="grid-2">
      <section className="panel" aria-labelledby="cc-enq">
        <div className="panel-head"><h2 className="heading" id="cc-enq">Capture &amp; Convert</h2><span className="small faint">latest {d.enquiries.length}</span></div>
        {d.enquiries.length ? <ul className="plain-list">{d.enquiries.map((e) => (
          <li key={e.id}><span className="row gap-8 wrap"><strong>{e.name || 'Unknown caller'}</strong><span className="tag tag-plain">{e.channel === 'call' ? 'Call' : e.channel === 'form' ? 'Form' : e.channel === 'text' ? 'Text' : 'Email'}</span><span className="xsmall muted">{e.status}</span>{e.urgency !== 'normal' && <span className="tag tag-danger">{e.urgency}</span>}</span><p className="small">{e.summary}</p><span className="xsmall faint">{relative(e.created_at)}</span></li>
        ))}</ul> : <p className="panel-pad muted">No enquiries yet.</p>}
      </section>
      <section className="panel" aria-labelledby="site-enq">
        <div className="panel-head"><h2 className="heading" id="site-enq">Website form</h2><span className="small faint">latest {d.siteEnquiries.length}</span></div>
        {d.siteEnquiries.length ? <ul className="plain-list">{d.siteEnquiries.map((e) => <li key={e.id}><strong>{e.name}</strong>{e.service && <span className="small muted"> · {e.service}</span>}<div className="xsmall faint">{e.source} · {relative(e.at)}</div></li>)}</ul> : <p className="panel-pad muted">None yet.</p>}
      </section>
    </div>
  );
}

/* ---------- Costs ---------- */

function CostsTab({ d, reload }: { d: AccountDetail; reload: () => void }) {
  const [item, setItem] = useState(''); const [amount, setAmount] = useState(''); const [month, setMonth] = useState(monthStart().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const add = async () => {
    setBusy(true);
    try { await admin.addCost(d.account.email, month, item, Number(amount)); setItem(''); setAmount(''); reload(); toast('Cost added'); }
    catch (e) { toast(humanThrown(e, 'The cost wasn’t added.')); } finally { setBusy(false); }
  };
  const label = (m: string) => new Date(`${m}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="stack gap-24">
      <div className="grid-2">
        {d.costs.map((c) => (
          <section key={c.month} className="panel" aria-label={label(c.month)}>
            <div className="panel-head"><h2 className="heading">{label(c.month)}</h2><span className="small">{gbp(c.revenue)} in · {gbp(c.total)} out</span></div>
            <ul className="cost-list">
              {c.lines.map((l, i) => {
                const manual = c.manual.find((m) => m.item === l.item && Number(m.amount) === l.amount);
                return <li key={i}><span>{l.item}{l.estimated && <span className="xsmall faint"> estimate</span>}</span><span className="row gap-8"><span className="num">{gbp(l.amount)}</span>{manual && <button className="linklike xsmall" onClick={async () => { await admin.deleteCost(manual.id); reload(); }}>Remove</button>}</span></li>;
              })}
              <li className="cost-total"><span>Margin</span><span className="num">{gbp(c.margin)}</span></li>
            </ul>
          </section>
        ))}
      </div>
      <section className="panel panel-pad stack gap-12" aria-label="Add a cost">
        <h2 className="heading">Add a cost</h2>
        <p className="small muted">Ad spend you pay for them, their domain, a photographer: anything not counted automatically.</p>
        <div className="row gap-12 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="What for" className="grow">{(id) => <input id={id} className="input" value={item} onChange={(e: any) => setItem(e.target.value)} />}</Field>
          <Field label="Amount (£)">{(id) => <input id={id} className="input" type="number" min={0} step="0.01" value={amount} onChange={(e: any) => setAmount(e.target.value)} />}</Field>
          <Field label="Month">{(id) => <input id={id} className="input" type="month" value={month} onChange={(e: any) => setMonth(e.target.value)} />}</Field>
          <Button busy={busy} disabled={!item.trim() || amount === ''} onClick={add}>Add cost</Button>
        </div>
      </section>
    </div>
  );
}

/* ---------- Notes ---------- */

function NotesTab({ d, reload }: { d: AccountDetail; reload: () => void }) {
  const [text, setText] = useState(''); const [kind, setKind] = useState<'note' | 'call' | 'email' | 'work'>('note');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const add = async () => { setBusy(true); try { await admin.addLog(d.account.email, kind, text); setText(''); reload(); } catch (e) { toast(humanThrown(e, 'The note wasn’t saved.')); } finally { setBusy(false); } };
  const KIND = { note: 'Note', call: 'Call', email: 'Email', work: 'Work done', system: 'Update' } as const;
  return (
    <div className="stack gap-24">
      <section className="panel panel-pad stack gap-12" aria-label="Add a note">
        <Field label="Add a note">{(id) => <textarea id={id} className="textarea" rows={3} value={text} placeholder="What was said, decided or done." onChange={(e: any) => setText(e.target.value)} />}</Field>
        <div className="row gap-12 wrap">
          <div className="seg" role="group" aria-label="Kind">{(['note', 'call', 'email', 'work'] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND[k]}</button>)}</div>
          <Button busy={busy} disabled={!text.trim()} onClick={add}>Save note</Button>
        </div>
      </section>
      <section className="panel">
        {d.log.length ? <ul className="plain-list timeline">{d.log.map((l) => (
          <li key={l.id}><span className="row gap-8"><span className={`tag ${l.author === 'Claude' ? 'tag-brass' : 'tag-plain'}`}>{KIND[l.kind]}</span><span className="xsmall faint">{l.author} · {relative(l.at)}</span></span><p className="small">{l.text}</p></li>
        ))}</ul> : <p className="panel-pad muted">No notes yet. Calls, decisions and work done (by you or Claude) build up here.</p>}
      </section>
    </div>
  );
}

export { PACKAGES };
