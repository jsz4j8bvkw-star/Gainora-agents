import { Fragment, useMemo, useState } from 'react';
import { Link, navigate } from '../lib/router';
import { Button, ErrorNote, Field, Loading, Modal, copyText, useLoad, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { relative } from '../lib/format';
import { BUCKETS, type Bucket } from '../../shared/admin/board';
import { gbp, monthStart, RATE_LABELS, type RateCard } from '../../shared/admin/money';
import { ACCOUNT_STATUS_LABEL, type AccountStatus, normEmail, PACKAGES, type Package, type TaskWho } from '../../shared/admin/model';
import { admin, type Overview } from './api';
import { clientPath, Due, PackageChips, Progress, StartSetup, StatusChip, TaskRow } from './bits';
import { TodayBusiness } from './business';

const useOverview = () => useLoad<Overview>(() => admin.overview());

/* ---------- Today ---------- */

export function Today() {
  const { data: o, error, reload } = useOverview();
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!o) return <Loading label="Loading today" />;
  const now = [...o.board.overdue, ...o.board.today];
  const week = o.board.week;
  const notStarted = o.accounts.filter((a) => a.packages.length && a.status !== 'left' && !a.setupStarted);
  const hour = new Date().getHours();
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</h1><p className="lede">{now.length ? `${now.length} thing${now.length === 1 ? '' : 's'} to do today${o.board.overdue.length ? `, ${o.board.overdue.length} of them late` : ''}.` : 'Nothing late or due today.'}</p></div></div>
      <section className="panel stats" aria-label="Summary">
        <div className="stat"><span className="stat-label">Clients</span><span className="stat-value">{o.totals.clients}</span><span className="stat-note">With a live package</span></div>
        <div className="stat"><span className="stat-label">Monthly revenue</span><span className="stat-value">{gbp(o.totals.monthly, true)}</span><span className="stat-note">From Stripe subscriptions</span></div>
        <div className="stat"><span className="stat-label">Late steps</span><span className={`stat-value${o.totals.overdue ? ' down' : ''}`}>{o.totals.overdue}</span><span className="stat-note">Past their deadline</span></div>
        <div className="stat"><span className="stat-label">Set-up fees unpaid</span><span className="stat-value">{gbp(o.totals.unpaidSetup, true)}</span><span className="stat-note">Marked unpaid on clients</span></div>
      </section>
      <div className="grid-2 mt-24">
        <section className="panel" aria-labelledby="now-h">
          <div className="panel-head"><h2 className="heading" id="now-h">Late and due today</h2><Link to="/delivery" className="small">All deadlines</Link></div>
          {now.length ? <ul className="task-list">{now.map((t) => <TaskRow key={t.id} task={t} today={o.today} showClient onChange={reload} />)}</ul> : <p className="panel-pad muted">You’re on top of it.</p>}
        </section>
        <div className="stack gap-24">
          <TodayBusiness />
          {notStarted.length > 0 && (
            <section className="panel" aria-labelledby="new-h">
              <div className="panel-head"><h2 className="heading" id="new-h">New clients to start</h2></div>
              <ul className="plain-list">{notStarted.map((a) => (
                <li key={a.email} className="stack gap-8"><span className="row gap-8 wrap"><Link to={clientPath(a.email)}><strong>{a.name}</strong></Link><PackageChips packages={a.packages} /></span><StartSetup email={a.email} packages={a.packages} started={[]} onDone={reload} /></li>
              ))}</ul>
            </section>
          )}
          <section className="panel" aria-labelledby="req-h">
            <div className="panel-head"><h2 className="heading" id="req-h">Website changes asked for</h2><Link to="/requests" className="small">All</Link></div>
            {o.requests.length ? <ul className="plain-list">{o.requests.slice(0, 5).map((r) => <li key={r.id}><Link to={`${clientPath(r.email)}?section=website`}><strong>{r.client}</strong></Link><p className="small">{r.text}</p><span className="xsmall faint">{r.page} · {relative(r.at)}</span></li>)}</ul> : <p className="panel-pad muted">None waiting.</p>}
          </section>
        </div>
      </div>
      <section className="panel mt-24" aria-labelledby="week-h">
        <div className="panel-head"><h2 className="heading" id="week-h">Later this week</h2><span className="small faint">{week.length}</span></div>
        {week.length ? <ul className="task-list">{week.map((t) => <TaskRow key={t.id} task={t} today={o.today} showClient onChange={reload} />)}</ul> : <p className="panel-pad muted">Nothing else due this week.</p>}
      </section>
    </div>
  );
}

/* ---------- Clients ---------- */

export function Clients() {
  const { data: o, error, reload } = useOverview();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'current' | 'all'>('current');
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => (o?.accounts ?? []).filter((a) => (show === 'all' || a.status !== 'left') && (!q || `${a.name} ${a.email} ${a.contact}`.toLowerCase().includes(q.toLowerCase()))), [o, q, show]);
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!o) return <Loading label="Loading clients" />;
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Clients</h1><p className="lede">{o.totals.clients} with a live package · {gbp(o.totals.monthly, true)} a month</p></div><Button icon="plus" onClick={() => setAdding(true)}>Add a client</Button></div>
      <div className="row gap-12 wrap mb-16">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search name or email" aria-label="Search clients" value={q} onChange={(e: any) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Show">{(['current', 'all'] as const).map((s) => <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>{s === 'current' ? 'Current' : 'Everyone'}</button>)}</div>
      </div>
      <section className="panel">
        <div className="table-wrap"><table className="clients-table">
          <thead><tr><th>Client</th><th>Packages</th><th>Status</th><th className="num">Monthly</th><th>Set-up</th><th>Next deadline</th><th className="num">Requests</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.email} className="row-link" onClick={() => navigate(clientPath(a.email))}>
              <td><Link to={clientPath(a.email)}><strong>{a.name}</strong></Link><div className="xsmall faint">{a.contact ? `${a.contact} · ` : ''}{a.email}</div></td>
              <td><PackageChips packages={a.packages} /></td>
              <td><StatusChip status={a.status} />{a.billing === 'past_due' && <span className="tag tag-danger" style={{ marginLeft: 6 }}>Payment failed</span>}</td>
              <td className="num">{gbp(a.monthly, true)}</td>
              <td><Progress {...a.progress} /></td>
              <td>{a.nextDue ? <span className="stack gap-2"><span className="small clip">{a.nextDue.title}</span><Due due={a.nextDue.due_on} today={o.today} /></span> : <span className="xsmall faint">–</span>}</td>
              <td className="num">{a.openRequests || ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!list.length && <p className="panel-pad muted">No clients match.</p>}
      </section>
      {adding && <AddClient onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddClient({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await admin.saveAccount(normEmail(email), { business_name: name, contact_name: contact, status: 'onboarding' }); navigate(clientPath(normEmail(email))); }
    catch (e) { setErr(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a client" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Add client</Button></>}>
      <div className="stack gap-16">
        <p className="small muted">Clients who pay through the website appear here on their own. Add one by hand for someone paying another way, or to start their record before they pay. Use the email they’ll sign in with.</p>
        <Field label="Email" error={err ?? undefined}>{(id, d) => <input id={id} className="input" type="email" value={email} aria-describedby={d} onChange={(e: any) => setEmail(e.target.value)} />}</Field>
        <Field label="Business name">{(id) => <input id={id} className="input" value={name} onChange={(e: any) => setName(e.target.value)} />}</Field>
        <Field label="Contact name" optional>{(id) => <input id={id} className="input" value={contact} onChange={(e: any) => setContact(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

/* ---------- Delivery ---------- */

export function Delivery() {
  const { data: o, error, reload } = useOverview();
  const [who, setWho] = useState<TaskWho | 'all'>('all');
  const [pkg, setPkg] = useState<Package | 'all'>('all');
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!o) return <Loading label="Loading deadlines" />;
  const keep = (t: Overview['tasks'][number]) => (who === 'all' || t.who === who) && (pkg === 'all' || t.project === pkg);
  const cols = BUCKETS.filter((b) => b.id !== 'undated' || o.board.undated.some(keep));
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Delivery</h1><p className="lede">Every open step for every client, by deadline.</p></div></div>
      <div className="row gap-12 wrap mb-16">
        <div className="seg" role="group" aria-label="Who">{(['all', 'gainora', 'client', 'claude'] as const).map((w) => <button key={w} type="button" aria-pressed={who === w} onClick={() => setWho(w)}>{w === 'all' ? 'Everyone' : w === 'gainora' ? 'Gainora' : w === 'client' ? 'Waiting on clients' : 'Claude'}</button>)}</div>
        <div className="seg" role="group" aria-label="Package">{(['all', 'launch', 'capture', 'command'] as const).map((p) => <button key={p} type="button" aria-pressed={pkg === p} onClick={() => setPkg(p)}>{p === 'all' ? 'All packages' : PACKAGES[p].short}</button>)}</div>
      </div>
      <div className="board">
        {cols.map((b) => {
          const list = o.board[b.id as Bucket].filter(keep);
          return (
            <section key={b.id} className={`board-col col-${b.id}`} aria-label={b.label}>
              <h2 className="board-head"><span>{b.label}</span><span className="xsmall faint">{list.length}</span></h2>
              {list.length ? <BoardList list={list} today={o.today} onChange={reload} /> : <p className="xsmall faint board-empty">Nothing here.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Long columns show the soonest dozen first. */
function BoardList({ list, today, onChange }: { list: Overview['tasks']; today: string; onChange: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 12);
  return (
    <>
      <ul className="task-list">{shown.map((t) => <TaskRow key={t.id} task={t} today={today} showClient onChange={onChange} />)}</ul>
      {list.length > shown.length && <button type="button" className="linklike small board-more" onClick={() => setAll(true)}>Show {list.length - shown.length} more</button>}
    </>
  );
}

/* ---------- Requests ---------- */

export function Requests() {
  const { data: o, error, reload } = useOverview();
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!o) return <Loading label="Loading requests" />;
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Requests</h1><p className="lede">Website changes clients have asked for. Open the client’s website to make the change and mark it done; they’re emailed when you do.</p></div></div>
      {o.requests.length ? (
        <section className="panel"><ul className="plain-list">{o.requests.map((r) => (
          <li key={r.id} className="row gap-16 wrap" style={{ justifyContent: 'space-between' }}>
            <div className="stack gap-4" style={{ minWidth: 0, flex: 1 }}><span className="row gap-8"><strong>{r.client}</strong><span className="xsmall faint">{r.page} · {relative(r.at)}</span></span><p>{r.text}</p></div>
            <Link to={`${clientPath(r.email)}?section=website`} className="btn btn-secondary btn-small">Open their website</Link>
          </li>
        ))}</ul></section>
      ) : <div className="panel empty"><p className="muted">No changes waiting. Clients ask from Your website → Ask Gainora for a change.</p></div>}
    </div>
  );
}

/* ---------- Money ---------- */

/** What each client pays against what they cost to run (Money → By client). */
export function ClientMoney({ embedded }: { embedded?: boolean }) {
  const months = useMemo(() => { const out: string[] = []; const d = new Date(`${monthStart()}T00:00:00Z`); for (let i = 0; i < 6; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() - 1); } return out; }, []);
  const [month, setMonth] = useState(months[0]);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload, loading } = useLoad(() => admin.money(month), [month]);
  const label = (m: string) => new Date(`${m}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className={embedded ? 'stack' : 'page'}>
      <div className="page-head">{embedded ? <p className="small muted">What each client pays against what they cost to run.</p> : <div><h1 className="title">Money</h1><p className="lede">What each client pays against what they cost to run.</p></div>}
        <Field label="Month">{(id) => <select id={id} className="select" value={month} onChange={(e: any) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>}</Field>
      </div>
      {error ? <ErrorNote message={error} retry={reload} /> : !data || loading ? <Loading label="Working out the numbers" /> : (
        <>
          <section className="panel stats" aria-label="Totals">
            <div className="stat"><span className="stat-label">Revenue</span><span className="stat-value">{gbp(data.totals.revenue, true)}</span><span className="stat-note">Monthly subscriptions</span></div>
            <div className="stat"><span className="stat-label">Running costs</span><span className="stat-value">{gbp(data.totals.costs, true)}</span><span className="stat-note">AI, calls, texts, hosting, extras</span></div>
            <div className="stat"><span className="stat-label">Margin</span><span className="stat-value">{gbp(data.totals.margin, true)}</span><span className="stat-note">{data.totals.revenue ? `${Math.round((data.totals.margin / data.totals.revenue) * 100)}% of revenue` : '–'}</span></div>
          </section>
          <section className="panel mt-24">
            <div className="table-wrap"><table>
              <thead><tr><th>Client</th><th>Packages</th><th className="num">Pays</th><th className="num">Costs</th><th className="num">Margin</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <Fragment key={r.email}>
                  <tr className="row-link" onClick={() => setOpen(open === r.email ? null : r.email)} aria-expanded={open === r.email}>
                    <td><strong>{r.name}</strong></td><td><PackageChips packages={r.packages} /></td>
                    <td className="num">{gbp(r.revenue)}</td><td className="num">{gbp(r.costs)}</td>
                    <td className={`num${r.margin != null && r.revenue ? (r.margin / r.revenue < 0.6 ? ' down' : '') : ''}`}>{gbp(r.margin)}</td>
                  </tr>
                  {open === r.email && (
                    <tr className="cost-lines"><td colSpan={5}>
                      <ul>{r.lines.map((l, i) => <li key={i}><span>{l.item}{l.estimated && <span className="xsmall faint"> estimate</span>}</span><span className="num">{gbp(l.amount)}</span></li>)}</ul>
                      <Link to={`${clientPath(r.email)}?section=costs`} className="small">Add a cost for {r.name}</Link>
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table></div>
          </section>
          <p className="xsmall faint mt-16">AI costs are exact (recorded by the apps). Calls, texts, emails and hosting are estimates from the rate card in Settings; put your real prices there. Ad spend and one-off costs are added on each client’s Costs tab.</p>
        </>
      )}
    </div>
  );
}

/* ---------- Settings ---------- */

export function Settings() {
  const { data, error, reload } = useLoad(() => admin.settings());
  const keys = useLoad(() => admin.keys());
  const [rates, setRates] = useState<RateCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const toast = useToast();
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!data) return <Loading label="Loading settings" />;
  const r = rates ?? data.rates;
  const save = async () => { setBusy(true); try { setRates(await admin.saveSettings(r)); toast('Rates saved'); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  const create = async () => { try { const k = await admin.createKey('Claude'); setMade(k.url); keys.reload(); } catch (e) { toast(humanThrown(e, 'The link wasn’t made.')); } };
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Settings</h1></div></div>
      <div className="grid-2">
        <section className="panel panel-pad stack gap-16" aria-labelledby="claude-h">
          <h2 className="heading" id="claude-h">Claude connector</h2>
          <p className="small muted">Lets Claude work in this admin from any chat: look up clients, work through deadlines, build and edit websites, and leave notes. Everything Claude does is recorded on the client. Claude never sees your clients’ customers.</p>
          {made ? (
            <div className="stack gap-12 notice-box">
              <strong className="small">Your connector link (shown once)</strong>
              <code className="key-url">{made}</code>
              <div><Button small icon="copy" onClick={async () => toast((await copyText(made)) ? 'Copied' : 'Select the link and copy it')}>Copy link</Button></div>
              <ol className="small steps-list">
                <li>In Claude, open Settings → Connectors.</li>
                <li>Choose Add custom connector. Name it Gainora admin and paste the link.</li>
                <li>In a chat, switch Gainora admin on and ask, for example: “What’s late this week?” or “Build Willow’s website from their details.”</li>
              </ol>
              <p className="xsmall faint">Keep the link private: anyone with it can work in the admin. Switch it off below if it’s ever shared by mistake.</p>
            </div>
          ) : <div><Button icon="plus" onClick={create}>Make a connector link</Button></div>}
          {keys.data && keys.data.length > 0 && (
            <ul className="plain-list compact">{keys.data.map((k) => (
              <li key={k.id} className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
                <span className="small">{k.label} · made {relative(k.created_at)}{k.last_used_at ? ` · last used ${relative(k.last_used_at)}` : ' · not used yet'}</span>
                {k.revoked_at ? <span className="tag tag-plain">Switched off</span> : <Button small kind="secondary" onClick={async () => { await admin.revokeKey(k.id); keys.reload(); }}>Switch off</Button>}
              </li>
            ))}</ul>
          )}
        </section>
        <section className="panel panel-pad stack gap-16" aria-labelledby="rates-h">
          <h2 className="heading" id="rates-h">Cost rates</h2>
          <p className="small muted">Used to estimate each client’s running costs on Money. Put in what you actually pay.</p>
          <div className="form-grid">
            {(Object.keys(RATE_LABELS) as (keyof RateCard)[]).map((k) => (
              <Field key={k} label={RATE_LABELS[k].label} help={RATE_LABELS[k].unit === '£' ? `£, default ${data.defaults[k]}` : `${RATE_LABELS[k].unit}, default ${data.defaults[k]}`}>
                {(id, d) => <input id={id} className="input" type="number" min={0} step="0.001" value={r[k]} aria-describedby={d} onChange={(e: any) => setRates({ ...r, [k]: Number(e.target.value) })} />}
              </Field>
            ))}
          </div>
          <div><Button busy={busy} onClick={save}>Save rates</Button></div>
        </section>
      </div>
      <section className="panel panel-pad stack gap-8 mt-24">
        <h2 className="heading">Gainora’s team</h2>
        <p className="small muted">These logins can open the admin and every client’s website: {data.team.join(', ')}. To change the list, set GAINORA_ADMIN_EMAILS in Netlify (comma separated).</p>
      </section>
    </div>
  );
}

export const STATUS_OPTIONS = Object.entries(ACCOUNT_STATUS_LABEL) as [AccountStatus, string][];
