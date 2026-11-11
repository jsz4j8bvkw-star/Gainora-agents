import { useEffect, useMemo, useState } from 'react';
import { Link, queryParam } from '../lib/router';
import { Button, ErrorNote, Field, Icon, Loading, Modal, Tabs, useLoad, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { relative, shortDate } from '../lib/format';
import { dueLabel, ukToday } from '../../shared/admin/board';
import { gbp, monthStart } from '../../shared/admin/money';
import { type Deadline, EXPENSE_CATEGORIES, type Expense, type Repeat } from '../../shared/admin/books';
import { GRANT_LABEL, money, type PriceItem, toWebsitePrices } from '../../shared/admin/prices';
import { biz, type Agreement, type Books, type HealthRow, type TodayBiz } from './biz-api';
import { clientPath, PackageChips } from './bits';
import { ClientMoney } from './pages';
import { prospectPath } from './sales';

const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lastMonths = (n: number) => { const out: string[] = []; const d = new Date(`${monthStart()}T00:00:00Z`); for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() - 1); } return out; };
const REPEAT_LABEL: Record<Repeat, string> = { none: 'Once', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };
const confirmed = (msg: string) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(msg) : true);

/* ---------- Today: what sales and the business need ---------- */

export function TodayBusiness() {
  const { data: t, error } = useLoad<TodayBiz>(() => biz.today());
  if (error) return null;
  if (!t) return <section className="panel panel-pad"><Loading label="Loading sales and money" /></section>;
  const today = ukToday();
  const nothing = !t.followUps && !t.calls.length && !t.proposals.length && !t.unpaid.length && !t.deadlines.length;
  return (
    <section className="panel" aria-labelledby="biz-h">
      <div className="panel-head"><h2 className="heading" id="biz-h">Sales and the business</h2></div>
      {nothing ? <p className="panel-pad muted">No follow-ups, calls, open proposals, failed payments or deadlines coming up.</p> : (
        <ul className="plain-list">
          {t.unpaid.length > 0 && <li><Link to="/money?tab=payments"><strong className="due-late">{t.unpaid.length} payment{t.unpaid.length === 1 ? '' : 's'} failed</strong></Link><span className="small muted">{t.unpaid.map((u) => `${u.client ?? u.email} ${money(u.amount)}`).join(' · ')}</span></li>}
          {t.followUps > 0 && <li><Link to="/sales"><strong>{t.followUps} outreach message{t.followUps === 1 ? '' : 's'} to send</strong></Link><span className="small muted">In Sales → Follow-ups</span></li>}
          {t.calls.map((c) => <li key={c.id}><Link to={prospectPath(c.id)}><strong>Call: {c.business_name}</strong></Link><span className="small muted">{new Date(c.call_at!).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}{c.contact_name ? ` with ${c.contact_name}` : ''}</span></li>)}
          {t.proposals.filter((p) => p.waitingDays >= 3).map((p) => <li key={p.id}><Link to="/sales?tab=proposals"><strong>Chase {p.business_name}’s proposal</strong></Link><span className="small muted">{p.status === 'viewed' ? 'Opened' : 'Sent'} {p.waitingDays} days ago, not paid yet</span></li>)}
          {t.deadlines.map((d) => <li key={d.id}><Link to="/paperwork"><strong>{d.title}</strong></Link><span className={`due ${d.due_on < today ? 'due-late' : d.due_on === today ? 'due-today' : ''}`}>{dueLabel(d.due_on, today)}</span></li>)}
        </ul>
      )}
    </section>
  );
}

/* ---------- Health: who might leave, and the monthly results emails ---------- */

const LEVEL = { risk: { label: 'At risk', tone: 'tag-danger' }, watch: { label: 'Keep an eye on', tone: 'tag-brass' }, good: { label: 'Doing well', tone: 'tag-forest' } } as const;

export function Health() {
  const { data, error, reload } = useLoad(() => biz.health());
  const [results, setResults] = useState<HealthRow | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!data) return <Loading label="Checking on clients" />;
  const groups = (['risk', 'watch', 'good'] as const).map((l) => ({ level: l, list: data.clients.filter((c) => c.level === l) }));
  const toggle = async () => { setBusy(true); try { await biz.careSettings(!data.settings.resultsEmails); toast(data.settings.resultsEmails ? 'Monthly results emails off' : 'Monthly results emails on'); reload(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Client health</h1><p className="lede">{groups[0].list.length ? `${groups[0].list.length} at risk, ${groups[1].list.length} to keep an eye on.` : groups[1].list.length ? `${groups[1].list.length} to keep an eye on.` : 'Everyone looks fine.'} Each reason is a fact from the apps or Stripe.</p></div></div>
      <section className="panel panel-pad stack gap-12 mb-16" aria-labelledby="res-h">
        <h2 className="heading" id="res-h">Monthly results emails</h2>
        <p className="small muted">On the 1st of each month, each client gets a short email of what Gainora did for them last month: enquiries caught, calls answered, website visitors, briefs and new leads. Only their own numbers, and nothing is sent if there’s nothing to report. Preview anyone’s below.</p>
        <label className="check-row"><input type="checkbox" checked={data.settings.resultsEmails} disabled={busy} onChange={toggle} /> Send monthly results emails automatically</label>
      </section>
      {groups.filter((g) => g.list.length).map((g) => (
        <section key={g.level} className="panel mb-16" aria-label={LEVEL[g.level].label}>
          <div className="panel-head"><h2 className={`heading health-head health-${g.level}`}>{LEVEL[g.level].label}</h2><span className="small faint">{g.list.length}</span></div>
          <ul className="plain-list">{g.list.map((c) => (
            <li key={c.email} className="row gap-16 wrap" style={{ justifyContent: 'space-between' }}>
              <div className="stack gap-4 grow">
                <span className="row gap-8 wrap"><Link to={clientPath(c.email)}><strong>{c.name}</strong></Link><PackageChips packages={c.packages} /></span>
                {c.reasons.length > 0 && <ul className="reasons">{c.reasons.map((r) => <li key={r} className="small">{r}</li>)}</ul>}
                <span className="xsmall faint">{c.lastSignIn ? `Last signed in ${relative(c.lastSignIn)}` : 'Hasn’t signed in yet'}{c.monthly ? ` · ${gbp(c.monthly, true)} a month` : ''}{c.renewsOn ? ` · renews ${shortDate(c.renewsOn)}` : ''}</span>
              </div>
              <Button small kind="secondary" icon="send" onClick={() => setResults(c)}>Results email</Button>
            </li>
          ))}</ul>
        </section>
      ))}
      {results && <ResultsModal email={results.email} name={results.name} onClose={() => setResults(null)} />}
    </div>
  );
}

export function ResultsModal({ email, name, onClose }: { email: string; name: string; onClose: () => void }) {
  const months = lastMonths(4).slice(1);
  const [month, setMonth] = useState(months[0]);
  const { data, error, loading } = useLoad(() => biz.results(email, month), [month]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async () => { setBusy(true); try { await biz.sendResults(email, month); toast(`Sent to ${name}`); onClose(); } catch (e) { toast(humanThrown(e, 'That didn’t send.')); } finally { setBusy(false); } };
  return (
    <Modal title={`${name}: results email`} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Close</Button><Button icon="send" busy={busy} disabled={!data?.email} onClick={send}>Send it now</Button></>}>
      <div className="stack gap-16">
        <Field label="Month">{(id) => <select id={id} className="select" value={month} onChange={(e: any) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>}</Field>
        {error ? <ErrorNote message={error} /> : !data || loading ? <Loading label="Working out their results" /> : data.email ? (
          <div className="email-preview"><p className="small"><span className="faint">Subject: </span><strong>{data.email.subject}</strong></p>{data.email.paragraphs.map((p, i) => <p key={i} className="small">{p}</p>)}</div>
        ) : <p className="muted">Nothing to report for {monthLabel(month)} yet, so no email would be sent.</p>}
      </div>
    </Modal>
  );
}

/* ---------- Money: by client, profit, expenses, failed payments, VAT ---------- */

type MoneyTab = 'clients' | 'profit' | 'expenses' | 'payments' | 'vat';
const MONEY_TABS: MoneyTab[] = ['clients', 'profit', 'expenses', 'payments', 'vat'];

export function Money() {
  const [tab, setTab] = useState<MoneyTab>(() => { const t = queryParam('tab') as MoneyTab | null; return t && MONEY_TABS.includes(t) ? t : 'profit'; });
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const books = useLoad<Books>(() => biz.books(month), [month]);
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Money</h1><p className="lede">What Gainora makes, spends and keeps. Gainora isn’t VAT-registered.</p></div>
        {tab !== 'vat' && tab !== 'payments' && tab !== 'clients' && <Field label="Month">{(id) => <select id={id} className="select" value={month} onChange={(e: any) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>}</Field>}
      </div>
      <Tabs<MoneyTab> label="Money" value={tab} onChange={setTab} tabs={[
        { id: 'profit', label: 'Profit' }, { id: 'clients', label: 'By client' }, { id: 'expenses', label: 'Expenses' },
        { id: 'payments', label: 'Failed payments', badge: books.data?.unpaid.length || null }, { id: 'vat', label: 'VAT' },
      ]} />
      {tab === 'clients' ? <ClientMoney embedded /> : books.error ? <ErrorNote message={books.error} retry={books.reload} /> : !books.data || books.loading ? <Loading label="Working out the numbers" /> : (
        <>
          {tab === 'profit' && <Profit b={books.data} />}
          {tab === 'expenses' && <Expenses b={books.data} reload={books.reload} />}
          {tab === 'payments' && <Payments b={books.data} />}
          {tab === 'vat' && <Vat b={books.data} />}
        </>
      )}
    </div>
  );
}

function Profit({ b }: { b: Books }) {
  const max = Math.max(1, ...b.months.map((m) => Math.max(m.revenue, m.expenses)));
  return (
    <div className="stack gap-24">
      <section className="panel stats" aria-label={`${monthLabel(b.month)} totals`}>
        <div className="stat"><span className="stat-label">Money in</span><span className="stat-value">{gbp(b.revenue, true)}</span><span className="stat-note">{b.revenueFrom === 'invoices' ? 'Paid Stripe invoices' : 'Monthly subscriptions (Stripe not connected)'}</span></div>
        <div className="stat"><span className="stat-label">Expenses</span><span className="stat-value">{gbp(b.expenseTotal, true)}</span><span className="stat-note">{b.expenses.length} item{b.expenses.length === 1 ? '' : 's'}</span></div>
        <div className="stat"><span className="stat-label">Profit</span><span className={`stat-value${b.profit < 0 ? ' down' : ''}`}>{gbp(b.profit, true)}</span><span className="stat-note">Before tax</span></div>
      </section>
      <section className="panel panel-pad stack gap-12" aria-labelledby="six-h">
        <h2 className="heading" id="six-h">Last six months</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Month</th><th>In and out</th><th className="num">In</th><th className="num">Out</th><th className="num">Profit</th></tr></thead>
          <tbody>{b.months.map((m) => (
            <tr key={m.month}>
              <td>{monthLabel(m.month)}</td>
              <td className="bars-cell" aria-hidden="true"><span className="bar bar-in" style={{ width: `${(m.revenue / max) * 100}%` }} /><span className="bar bar-out" style={{ width: `${(m.expenses / max) * 100}%` }} /></td>
              <td className="num">{gbp(m.revenue, true)}</td><td className="num">{gbp(m.expenses, true)}</td><td className={`num${m.profit < 0 ? ' down' : ''}`}><strong>{gbp(m.profit, true)}</strong></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="xsmall faint">Money in is what Stripe collected that month, set-up fees included. Expenses are what you’ve entered on the Expenses tab. For tax, your accountant’s figures are the ones that count.</p>
      </section>
    </div>
  );
}

function Expenses({ b, reload }: { b: Books; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Expense> | null>(null);
  const toast = useToast();
  const running = b.all.filter((e) => e.recurring && (!e.ends_on || e.ends_on >= ukToday()));
  return (
    <div className="stack gap-24">
      <div className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
        <p className="small muted">{running.length} regular costs, {gbp(running.reduce((a, e) => a + Number(e.amount), 0))} a month.</p>
        <Button icon="plus" onClick={() => setEdit({ recurring: true, category: 'Hosting and software', starts_on: ukToday() })}>Add an expense</Button>
      </div>
      <section className="panel" aria-labelledby="exp-h">
        <div className="panel-head"><h2 className="heading" id="exp-h">{monthLabel(b.month)}</h2><span className="small"><strong>{gbp(b.expenseTotal)}</strong></span></div>
        {b.expenses.length ? <ul className="plain-list">{b.expenses.map((e) => (
          <li key={e.id} className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
            <span className="stack gap-2"><strong className="small">{e.supplier}</strong><span className="xsmall faint">{e.category} · {e.recurring ? 'every month' : `once, ${shortDate(e.starts_on)}`}{e.note ? ` · ${e.note}` : ''}</span></span>
            <span className="row gap-8"><span className="num small">{gbp(Number(e.amount))}</span><Button small kind="quiet" onClick={() => setEdit(e)}>Edit</Button></span>
          </li>
        ))}</ul> : <p className="panel-pad muted">No expenses this month. Add what Gainora pays for: phone and AI services, hosting, insurance, your accountant.</p>}
      </section>
      {edit && <ExpenseEditor e={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} onDelete={edit.id ? async () => { if (!confirmed('Delete this expense?')) return; await biz.deleteExpense(edit.id!); toast('Deleted'); setEdit(null); reload(); } : undefined} />}
    </div>
  );
}

function ExpenseEditor({ e: initial, onClose, onDone, onDelete }: { e: Partial<Expense>; onClose: () => void; onDone: () => void; onDelete?: () => void }) {
  const [e, setE] = useState(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => { setBusy(true); setErr(null); try { await biz.saveExpense(e); onDone(); } catch (x) { setErr(humanThrown(x, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <Modal title={initial.id ? 'Edit expense' : 'Add an expense'} onClose={onClose} footer={<>{onDelete && <Button kind="quiet" onClick={onDelete}>Delete</Button>}<Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Paid to" error={err ?? undefined}>{(id, d) => <input id={id} className="input" aria-describedby={d} value={e.supplier ?? ''} onChange={(x: any) => setE({ ...e, supplier: x.target.value })} />}</Field>
        <Field label="Amount (£)">{(id) => <input id={id} className="input" type="number" min={0} step="0.01" value={e.amount ?? ''} onChange={(x: any) => setE({ ...e, amount: Number(x.target.value) })} />}</Field>
        <Field label="Category">{(id) => <select id={id} className="select" value={e.category ?? 'Other'} onChange={(x: any) => setE({ ...e, category: x.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label="How often">{(id) => <select id={id} className="select" value={e.recurring ? 'monthly' : 'once'} onChange={(x: any) => setE({ ...e, recurring: x.target.value === 'monthly' })}><option value="monthly">Every month</option><option value="once">Once</option></select>}</Field>
        <Field label={e.recurring ? 'From' : 'Date'}>{(id) => <input id={id} className="input" type="date" value={e.starts_on ?? ''} onChange={(x: any) => setE({ ...e, starts_on: x.target.value })} />}</Field>
        {e.recurring && <Field label="Until" optional help="When you cancelled it">{(id, d) => <input id={id} className="input" type="date" aria-describedby={d} value={e.ends_on ?? ''} onChange={(x: any) => setE({ ...e, ends_on: x.target.value || null })} />}</Field>}
        <Field label="Note" optional>{(id) => <input id={id} className="input" value={e.note ?? ''} onChange={(x: any) => setE({ ...e, note: x.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

function Payments({ b }: { b: Books }) {
  if (!b.stripe) return <div className="panel empty"><p className="muted">Stripe isn’t connected, so failed payments can’t be checked.</p></div>;
  return (
    <section className="panel">
      {b.unpaid.length ? <ul className="plain-list">{b.unpaid.map((u) => (
        <li key={u.id} className="row gap-16 wrap" style={{ justifyContent: 'space-between' }}>
          <span className="stack gap-2"><strong>{u.client ?? u.email}</strong><span className="xsmall faint">{u.attempts} attempt{u.attempts === 1 ? '' : 's'}{u.due ? ` · due ${shortDate(u.due)}` : ''}. Stripe retries and emails them; a call usually sorts it faster.</span></span>
          <span className="row gap-8"><strong className="num due-late">{gbp(u.amount)}</strong>{u.link && <a className="btn btn-secondary btn-small" href={u.link} target="_blank" rel="noreferrer"><Icon name="external" />Invoice</a>}</span>
        </li>
      ))}</ul> : <p className="panel-pad muted">No failed payments.</p>}
    </section>
  );
}

function Vat({ b }: { b: Books }) {
  const share = Math.min(1, b.vat.share);
  return (
    <section className="panel panel-pad stack gap-16" aria-labelledby="vat-h">
      <h2 className="heading" id="vat-h">VAT registration threshold</h2>
      <p className="lede">{gbp(b.vat.rolling, true)} <span className="small muted">taken over the last 12 months, of {gbp(b.vat.threshold, true)}</span></p>
      <div className={`meter meter-${b.vat.level}`} role="img" aria-label={`${Math.round(b.vat.share * 100)}% of the VAT threshold`}><span style={{ width: `${share * 100}%` }} /></div>
      <p className={b.vat.level === 'fine' ? 'small muted' : 'small notice-box'}>{b.vat.note}</p>
      <p className="xsmall faint">Counted from paid Stripe invoices over any rolling 12 months, which is how HMRC measures it. Income outside Stripe isn’t included. The threshold is {gbp(b.vat.threshold, true)} from 1 April 2024; check gov.uk if it changes.</p>
    </section>
  );
}

/* ---------- Prices: one book for proposals, Stripe and the website ---------- */

export function Prices() {
  const { data, error, reload } = useLoad(() => biz.prices());
  const [items, setItems] = useState<PriceItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (data) setItems(data.prices); }, [data]);
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!data || !items) return <Loading label="Loading prices" />;
  const set = (k: string, patch: Partial<PriceItem>) => setItems(items.map((i) => (i.key === k ? { ...i, ...patch } : i)));
  const changed = JSON.stringify(items) !== JSON.stringify(data.prices);
  const site = toWebsitePrices(items);
  const save = async (publish: boolean) => {
    setBusy(publish ? 'publish' : 'save');
    try { const r = await biz.savePrices(items, publish); setItems(r.prices); toast(publish ? (r.rebuilt ? 'Saved. gainora.co.uk is updating (about 2 minutes).' : 'Saved, but the website couldn’t be rebuilt. Check WEBSITE_BUILD_HOOK.') : 'Prices saved'); reload(); }
    catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(null); }
  };
  const num = (k: string, f: 'setup' | 'monthly' | 'one_off' | 'minimum_months', v: number, label: string) => <input className="input input-num" type="number" min={0} value={v} aria-label={label} onChange={(e: any) => set(k, { [f]: Number(e.target.value) } as any)} />;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="title">Prices</h1><p className="lede">One price list for proposals, Stripe and gainora.co.uk. Full prices: Gainora isn’t VAT-registered, so no VAT is added. Existing clients keep what they pay now.</p></div>
        <div className="row gap-8 wrap"><Button kind="secondary" busy={busy === 'save'} disabled={!changed} onClick={() => save(false)}>Save</Button><Button icon="globe" busy={busy === 'publish'} disabled={!data.website} onClick={() => save(true)}>Save and update the website</Button></div>
      </div>
      {!data.website && <p className="small notice-box mb-16">To update gainora.co.uk from here, add a build hook for the website in Netlify and set it as WEBSITE_BUILD_HOOK on the Command Centre site.</p>}
      <section className="panel">
        <div className="table-wrap"><table className="prices-table">
          <thead><tr><th>Package</th><th className="num">Set-up £</th><th className="num">Monthly £</th><th className="num">One-off £</th><th className="num">Minimum<br />months</th><th>Offered</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.key} className={i.active ? '' : 'is-off'}>
              <td><input className="input" value={i.name} aria-label={`Name of ${i.key}`} onChange={(e: any) => set(i.key, { name: e.target.value })} />{i.description && <div className="xsmall faint mt-4">{i.description}</div>}<div className="xsmall muted mt-4">{[i.included && `${i.included} minutes included`, i.grants.length ? `Switches on ${[...new Set(i.grants.map((g) => (g === 'watcher' || g === 'scout' || g === 'brief' ? 'Command Centre' : GRANT_LABEL[g])))].join(', ')}` : 'Nothing to switch on in the apps'].filter(Boolean).join(' · ')}</div></td>
              <td className="num">{num(i.key, 'setup', i.setup, `${i.name} set-up`)}</td>
              <td className="num">{num(i.key, 'monthly', i.monthly, `${i.name} monthly`)}</td>
              <td className="num">{num(i.key, 'one_off', i.one_off, `${i.name} one-off`)}</td>
              <td className="num">{num(i.key, 'minimum_months', i.minimum_months, `${i.name} minimum months`)}</td>
              <td><input type="checkbox" checked={i.active} aria-label={`Offer ${i.name}`} onChange={(e: any) => set(i.key, { active: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="panel panel-pad stack gap-8 mt-24" aria-labelledby="site-h">
        <h2 className="heading" id="site-h">What gainora.co.uk will show</h2>
        <p className="small">Capture & Convert {site.cc.setup} then {site.cc.monthly}/month · Launch & Grow {site.launchGrow.setup} then {site.launchGrow.monthly}/month (founding {site.launchGrow.foundingSetup}) · Both {site.bundle.setup} then {site.bundle.monthly}/month · Command Centre included in every package · Business Audit {site.audit} · Partner from {site.partner.focused}</p>
        <p className="xsmall faint">Saving also updates each package’s product in Stripe, so new proposals charge these prices.{data.stripe ? '' : ' Stripe isn’t connected yet, so only proposals and the website use them for now.'}</p>
      </section>
    </div>
  );
}

/* ---------- Paperwork: business deadlines and client agreements ---------- */

export function Paperwork() {
  const { data, error, reload } = useLoad(() => biz.paperwork());
  const [edit, setEdit] = useState<Partial<Deadline> | null>(null);
  const toast = useToast();
  if (error) return <div className="page"><ErrorNote message={error} retry={reload} /></div>;
  if (!data) return <Loading label="Loading paperwork" />;
  const have = new Set(data.deadlines.map((d) => d.title));
  const done = async (d: Deadline) => { const next = await biz.deadlineDone(d.id); toast(next ? `Done. Next one: ${shortDate(next)}` : 'Done'); reload(); };
  const missing = data.agreements.filter((a) => !a.terms || !a.dpa).length;
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="title">Paperwork</h1><p className="lede">The dates the business can’t miss, and what each client has agreed to.</p></div><Button icon="plus" onClick={() => setEdit({ repeat: 'yearly', category: 'Tax' })}>Add a date</Button></div>
      <div className="grid-2">
        <section className="panel" aria-labelledby="dl-h">
          <div className="panel-head"><h2 className="heading" id="dl-h">Deadlines</h2></div>
          {data.deadlines.filter((d) => !d.done_at).length ? <ul className="plain-list">{data.deadlines.filter((d) => !d.done_at).map((d) => (
            <li key={d.id} className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
              <span className="stack gap-2 grow"><button type="button" className="linklike-plain small" onClick={() => setEdit(d)}><strong>{d.title}</strong></button><span className="xsmall faint">{d.category} · {REPEAT_LABEL[d.repeat]}{d.note ? ` · ${d.note}` : ''}</span></span>
              <span className="row gap-8"><span className={`due ${d.due_on < data.today ? 'due-late' : d.due_on <= data.today ? 'due-today' : ''}`}>{dueLabel(d.due_on, data.today)}</span><Button small kind="secondary" icon="check" onClick={() => done(d)}>Done</Button></span>
            </li>
          ))}</ul> : <p className="panel-pad muted">No dates yet. Add the ones below with your own dates.</p>}
        </section>
        <section className="panel" aria-labelledby="sug-h">
          <div className="panel-head"><h2 className="heading" id="sug-h">Common ones to add</h2></div>
          <ul className="plain-list">{data.suggestions.filter((s) => !have.has(s.title)).map((s) => (
            <li key={s.title} className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
              <span className="stack gap-2 grow"><strong className="small">{s.title}</strong><span className="xsmall faint">{s.note}</span></span>
              <Button small kind="secondary" icon="plus" onClick={() => setEdit({ title: s.title, category: s.category, repeat: s.repeat, note: s.note, due_on: s.when ?? '' })}>Add</Button>
            </li>
          ))}</ul>
          <p className="xsmall faint panel-pad">Which of these apply depends on how Gainora is set up (sole trader or limited company). Your accountant can confirm the dates.</p>
        </section>
      </div>
      <section className="panel mt-24" aria-labelledby="agr-h">
        <div className="panel-head"><h2 className="heading" id="agr-h">Client agreements</h2>{missing > 0 && <span className="tag tag-brass">{missing} missing</span>}</div>
        <p className="small muted panel-pad" style={{ paddingBottom: 0 }}>Clients who pay through a proposal accept the terms and the data processing terms at checkout, and the date is recorded here. For anyone else, record when they agreed.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Client</th><th>Terms</th><th>Data processing terms</th><th /></tr></thead>
          <tbody>{data.agreements.map((a) => <AgreementRow key={a.email} a={a} onDone={reload} />)}</tbody>
        </table></div>
      </section>
      {edit && <DeadlineEditor d={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} onDelete={edit.id ? async () => { if (!confirmed('Delete this date?')) return; await biz.deleteDeadline(edit.id!); setEdit(null); reload(); } : undefined} />}
    </div>
  );
}

function AgreementRow({ a, onDone }: { a: Agreement; onDone: () => void }) {
  const [terms, setTerms] = useState(a.terms?.slice(0, 10) ?? '');
  const [dpa, setDpa] = useState(a.dpa?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const changed = terms !== (a.terms?.slice(0, 10) ?? '') || dpa !== (a.dpa?.slice(0, 10) ?? '');
  const save = async () => { setBusy(true); try { await biz.saveAgreement(a.email, terms || null, dpa || null); toast('Saved'); onDone(); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <tr>
      <td><Link to={clientPath(a.email)}><strong>{a.name}</strong></Link></td>
      <td><input className="input input-date" type="date" value={terms} aria-label={`${a.name}: terms accepted`} onChange={(e: any) => setTerms(e.target.value)} />{!terms && <div className="xsmall due-late">Not recorded</div>}</td>
      <td><input className="input input-date" type="date" value={dpa} aria-label={`${a.name}: data processing terms accepted`} onChange={(e: any) => setDpa(e.target.value)} />{!dpa && <div className="xsmall due-late">Not recorded</div>}</td>
      <td>{changed && <Button small busy={busy} onClick={save}>Save</Button>}</td>
    </tr>
  );
}

function DeadlineEditor({ d: initial, onClose, onDone, onDelete }: { d: Partial<Deadline>; onClose: () => void; onDone: () => void; onDelete?: () => void }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => { setBusy(true); setErr(null); try { await biz.saveDeadline(d); onDone(); } catch (x) { setErr(humanThrown(x, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <Modal title={initial.id ? 'Edit date' : 'Add a date'} onClose={onClose} footer={<>{onDelete && <Button kind="quiet" onClick={onDelete}>Delete</Button>}<Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack gap-16">
        {d.note && <p className="small muted">{d.note}</p>}
        <div className="form-grid">
          <Field label="What" error={err ?? undefined}>{(id, x) => <input id={id} className="input" aria-describedby={x} value={d.title ?? ''} onChange={(e: any) => setD({ ...d, title: e.target.value })} />}</Field>
          <Field label="Due">{(id) => <input id={id} className="input" type="date" value={d.due_on ?? ''} onChange={(e: any) => setD({ ...d, due_on: e.target.value })} />}</Field>
          <Field label="Repeats">{(id) => <select id={id} className="select" value={d.repeat ?? 'none'} onChange={(e: any) => setD({ ...d, repeat: e.target.value as Repeat })}>{(Object.entries(REPEAT_LABEL) as [Repeat, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Category">{(id) => <input id={id} className="input" value={d.category ?? ''} onChange={(e: any) => setD({ ...d, category: e.target.value })} />}</Field>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- On a client's page: their agreements, health and results ---------- */

export function ClientCare({ email, name }: { email: string; name: string }) {
  const paper = useLoad(() => biz.paperwork());
  const health = useLoad(() => biz.health());
  const [results, setResults] = useState(false);
  const a = paper.data?.agreements.find((x) => x.email === email);
  const h = health.data?.clients.find((x) => x.email === email);
  return (
    <section className="panel panel-pad stack gap-12" aria-labelledby="care-h">
      <h2 className="heading" id="care-h">Keeping them</h2>
      {!h ? <span className="small faint">{health.error ? 'Couldn’t check their health.' : 'Checking…'}</span> : (
        <div className="stack gap-4"><span><span className={`tag ${LEVEL[h.level].tone}`}>{LEVEL[h.level].label}</span></span>{h.reasons.length > 0 && <ul className="reasons">{h.reasons.map((r) => <li key={r} className="small">{r}</li>)}</ul>}<span className="xsmall faint">{h.lastSignIn ? `Last signed in ${relative(h.lastSignIn)}` : 'Hasn’t signed in yet'}</span></div>
      )}
      {a && <p className="small">Terms: {a.terms ? `accepted ${shortDate(a.terms)}` : <span className="due-late">not recorded</span>} · Data processing terms: {a.dpa ? `accepted ${shortDate(a.dpa)}` : <span className="due-late">not recorded</span>} <Link to="/paperwork" className="xsmall">Change</Link></p>}
      <div><Button small kind="secondary" icon="send" onClick={() => setResults(true)}>Results email</Button></div>
      {results && <ResultsModal email={email} name={name} onClose={() => setResults(false)} />}
    </section>
  );
}
