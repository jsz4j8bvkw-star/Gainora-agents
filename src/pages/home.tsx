import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link } from '../lib/router';
import { AGENTS, Button, ErrorNote, Icon, Loading, useLoad, useToast } from '../components/ui';
import { greeting, longDate, money, relative } from '../lib/format';
import { formatMinutes, startOfMonth, summariseValue } from '../../shared/value';
import { actionLink } from '../../shared/today';
import { dueThisWeek } from '../../shared/clients';
import { moneySummary } from '../../shared/money';
import { firstActions, isNewAccount, reviewPosition } from '../../shared/firstten';
import { distanceLabel } from '../../shared/competitors';
import type { Action, AgentId, ClientsData, TodayItem } from '../lib/types';

const AGENT_SHORT: Record<string, string> = { watcher: 'Watcher', scout: 'Scout', brief: 'Brief', you: 'You' };

/* "Done" on a Today item hides it on this device for a fortnight. It is a convenience, not a record:
   the item disappears for good once the underlying finding changes (the review is replied to, the lead moves on). */
const DONE_KEY = 'gainora.today.done.v1';
const DONE_FOR = 14 * 86_400_000;
function readDone(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => typeof t === 'number' && now - (t as number) < DONE_FOR)) as Record<string, number>;
  } catch { return {}; }
}
function writeDone(d: Record<string, number>) { try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch { /* private mode */ } }

export function Home() {
  const { profile, plan } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.getHome());
  const [newTodo, setNewTodo] = useState('');
  const [done, setDone] = useState<Record<string, number>>(readDone);
  const toast = useToast();

  if (loading && !data) return <Loading label="Loading your home" />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'Home could not load.'} retry={reload} /></div>;

  const toggle = async (a: Action) => {
    setData({ ...data, actions: data.actions.map((x) => (x.id === a.id ? { ...x, done: !x.done } : x)) });
    try { await api.setActionDone(a.id, !a.done); }
    catch { toast('That change didn’t save. Try again.'); reload(); }
  };
  const add = async (e: any) => {
    e.preventDefault();
    const t = newTodo.trim();
    if (!t) return;
    setNewTodo('');
    try { const a = await api.addAction(t); setData({ ...data, actions: [a, ...data.actions] }); }
    catch { toast('Couldn’t add that. Try again.'); }
  };
  const markDone = (item: TodayItem) => {
    const next = { ...done, [item.id]: Date.now() };
    setDone(next); writeDone(next);
    toast('Done. It won’t show here again.');
  };

  const open = data.actions.filter((a) => !a.done);
  const finished = data.actions.filter((a) => a.done);
  const g = data.goalProgress;
  const pct = g.current != null && g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : null;
  const unread = data.alerts.filter((a) => !a.read).length;
  const today = (data.today ?? []).filter((t) => !done[t.id]);
  const firstName = profile.business.ownerName.split(' ')[0];
  const cd = data.clients;
  const due = cd?.ready ? dueThisWeek(cd.clients, cd.visits, profile.clientSettings ?? {}) : null;
  const fresh = isNewAccount(profile, cd?.clients ?? []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">{greeting()}, {firstName}.</h1>
          <p className="lede"><span className="lede-date">{longDate()}. </span>Here’s where {profile.business.name} stands and what to do first.</p>
        </div>
        <Link to="/ask" className="btn btn-secondary hide-phone"><Icon name="ask" />Ask a question</Link>
      </div>

      {fresh && <FirstTen clients={cd} />}

      {due && due.count > 0 && (
        <Link to="/clients?tab=due" className="due-card" aria-label="Clients due back this week">
          <span className="row gap-16" style={{ alignItems: 'center', minWidth: 0 }}>
            <span className="due-card-figure">{due.count}</span>
            <span className="due-card-body">
              <span className="subhead">{due.count === 1 ? 'client' : 'clients'} due back this week{due.overdue ? `, ${due.overdue} overdue` : ''}</span>
              <span className="small muted">{due.names.join(', ')}{due.count > due.names.length ? ` and ${due.count - due.names.length} more` : ''}{due.priced ? ` · ${money(due.value)} at their last prices` : ''}. A text is drafted for each.</span>
            </span>
          </span>
          <span className="btn btn-primary btn-small">See the drafts<Icon name="chevron" /></span>
        </Link>
      )}

      <section className="today" aria-labelledby="today-h">
        <div className="section-head">
          <h2 className="heading" id="today-h">Do these today</h2>
          <span className="small faint">Ranked by what is most likely to cost or earn you money</span>
        </div>
        <div className="panel rows">
          {today.length === 0 && (
            <div className="empty">
              <h3 className="subhead">Nothing urgent today</h3>
              <p className="muted mt-8">{data.today ? 'Your agents found nothing that needs you right now. They keep checking every morning.' : 'Your agents are running their first checks. The first things to do will appear here within 24 hours.'}</p>
            </div>
          )}
          {today.map((t, i) => (
            <article className="today-item" key={t.id}>
              <span className="today-num" aria-hidden="true">{i + 1}</span>
              <div className="today-body">
                <h3 className="subhead">{t.title}</h3>
                <p className="muted today-why">{t.why}</p>
                <span className="xsmall faint">{t.agent === 'clients' ? 'Your clients' : AGENTS[t.agent].name}</span>
              </div>
              <div className="today-actions">
                <Link to={t.link} className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} btn-small`}>{t.cta}<Icon name="chevron" /></Link>
                <button className="btn btn-quiet btn-small" onClick={() => markDone(t)}>Done</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid-2 section">
        <section className="panel letter" aria-labelledby="notes-h">
          <h2 className="heading" id="notes-h">From your agents</h2>
          <div className="mt-8">
            {data.notes.length === 0 && <p className="voice muted">Your agents are running their first checks. Their notes will appear here within 24 hours.</p>}
            {data.notes.map((n) => (
              <div className="letter-entry" key={n.agent}>
                <Link to={AGENTS[n.agent].path} className="letter-from">{AGENTS[n.agent].name}</Link>
                <p className="voice">{n.body}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="stack gap-16">
        <aside className="goal" aria-labelledby="goal-h">
          <h2 className="label" id="goal-h">Your 90-day goal</h2>
          <p className="goal-target">{profile.goals.target}</p>
          {g.target != null ? (
            <>
              <div className="goal-figure tabular">{g.current ?? 0}<small>of {g.target} {g.label}</small></div>
              <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label="Progress towards goal"><span style={{ width: `${pct ?? 0}%` }} /></div>
              {g.detail && <p className="small" style={{ color: '#BDB8AF' }}>{g.detail}</p>}
            </>
          ) : <p className="small" style={{ color: '#BDB8AF' }}>Add a number to your target under Your business to track progress here.</p>}
          <p className="small" style={{ color: '#8E8A82' }}>{g.weeksLeft} {g.weeksLeft === 1 ? 'week' : 'weeks'} left. Focus: {profile.goals.focus}.</p>
        </aside>
        {cd?.ready && <MoneyStrip clients={cd} />}
        <ValueStrip />
        </div>
      </div>

      <div className="grid-2 section">
        <section aria-labelledby="todo-h">
          <div className="section-head"><h2 className="heading" id="todo-h">To do</h2><span className="small faint">{open.length} open</span></div>
          <div className="panel">
            <div className="rows">
              {open.length === 0 && <div className="empty"><p className="muted">Nothing left on your list. Your agents add new actions as they find them, and you can add your own below.</p></div>}
              {[...open, ...finished.slice(0, 3)].map((a) => {
                const link = a.done ? null : actionLink(a);
                return (
                  <div className={`todo ${a.done ? 'done' : ''}`} key={a.id} style={{ position: 'relative' }}>
                    <input type="checkbox" id={`t-${a.id}`} checked={a.done} onChange={() => toggle(a)} />
                    <label htmlFor={`t-${a.id}`} className="check" aria-hidden="true"><Icon name="check" /></label>
                    <label htmlFor={`t-${a.id}`}>
                      <span className="todo-text">{a.text}</span>
                      <span className="xsmall faint">{AGENT_SHORT[a.agent]}, {relative(a.createdAt)}</span>
                    </label>
                    {link && <Link to={link} className="todo-go" aria-label={`Open ${a.text}`}><Icon name="chevron" /></Link>}
                  </div>
                );
              })}
            </div>
            <form className="add-todo" onSubmit={add} style={{ borderTop: '1px solid var(--line)' }}>
              <label htmlFor="new-todo" className="sr-only">Add your own task</label>
              <input id="new-todo" className="input" placeholder="Add your own task" value={newTodo} onChange={(e: any) => setNewTodo(e.target.value)} />
              <Button type="submit" kind="secondary" small icon="plus" aria-label="Add task" />
            </form>
          </div>
        </section>

        <section aria-labelledby="alerts-h">
          <div className="section-head">
            <h2 className="heading" id="alerts-h">Alerts</h2>
            {unread > 0 && <button className="btn btn-quiet btn-small" onClick={async () => { setData({ ...data, alerts: data.alerts.map((a) => ({ ...a, read: true })) }); await api.markAlertsRead().catch(() => {}); }}>Mark all read</button>}
          </div>
          <div className="panel rows">
            {data.alerts.length === 0 && <div className="empty"><p className="muted">No alerts. You’ll hear from your agents here when something needs you.</p></div>}
            {data.alerts.slice(0, 6).map((a) => (
              <div className="alert-row" key={a.id}>
                <span className="dot" style={{ background: a.level === 'urgent' ? 'var(--danger)' : a.level === 'notice' ? 'var(--brass)' : 'var(--sage)', opacity: a.read ? 0.35 : 1 }} aria-hidden="true" />
                <div>
                  <div style={{ fontWeight: a.read ? 500 : 600 }}>{a.title}<span className="sr-only">{a.read ? '' : ' (unread)'}</span></div>
                  <div className="small muted">{a.body}</div>
                  <div className="xsmall faint mt-8 row gap-12 wrap">
                    <span>{AGENTS[a.agent].name}, {relative(a.at)}</span>
                    {a.link && <a href={a.link} target="_blank" rel="noreferrer">Open<span className="sr-only"> (opens in a new tab)</span></a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="section" aria-labelledby="agents-h">
        <div className="section-head"><h2 className="heading" id="agents-h">Your agents</h2></div>
        <div className="panel rows">
          {(Object.keys(AGENTS) as AgentId[]).map((id) => {
            const a = AGENTS[id];
            const on = plan.agents.includes(id);
            const st = data.agentStatus[id];
            return (
              <Link to={a.path} key={id} className={`agent-row ${on ? '' : 'locked'}`}>
                <span className="agent-icon"><Icon name={on ? a.icon : 'lock'} /></span>
                <span className="stack gap-4" style={{ minWidth: 0 }}>
                  <span className="subhead">{a.name}</span>
                  <span className="small muted">{on ? st.line : `${a.blurb}. Not on your plan yet.`}</span>
                  {on && st.lastRun && <span className="xsmall faint agent-when">Updated {relative(st.lastRun)}</span>}
                </span>
                <Icon name="chevron" className="chev" />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** The money number: only bookings the owner confirmed came from Gainora's messages. */
function MoneyStrip({ clients }: { clients: ClientsData }) {
  const s = moneySummary(clients.outcomes, clients.actions, startOfMonth());
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' });
  return (
    <Link to="/clients?tab=bookings" className="home-money" aria-label="What Gainora helped bring in this month">
      <span className="biz-kicker">{month}: Gainora helped bring in</span>
      <span className="home-money-figure">{money(s.confirmed)}<small>from {s.bookings} booking{s.bookings === 1 ? '' : 's'} you confirmed</small></span>
      <span className="home-money-line">{s.bookings ? 'Tap for the list behind the number.' : 'When a client books after a text Gainora drafted, mark it and it counts here. Nothing is estimated.'}{s.likely.length ? ` ${s.likely.length} likely booking${s.likely.length === 1 ? '' : 's'} waiting for you to confirm.` : ''}</span>
    </Link>
  );
}

/**
 * A new owner's first ten minutes: their nearby competitors as the Watcher finds them (polled while
 * the first search runs), where their reviews stand, and three things to do now.
 */
function FirstTen({ clients }: { clients: ClientsData | undefined }) {
  const { profile } = useApp();
  const { data: w, reload } = useLoad(() => api.getWatcher().catch(() => null));
  const searching = !w?.competitors?.foundAt;
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(reload, 15_000); const stop = setTimeout(() => clearInterval(t), 6 * 60_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [searching, reload]);
  const acts = firstActions({ watcher: w ?? null, clientsReady: !!clients?.ready, clients: clients?.clients ?? [], visits: clients?.visits ?? [], hasBookingSystem: !!profile.offer?.bookingSystem && !['None', 'Other'].includes(profile.offer.bookingSystem) });
  const pos = reviewPosition(w);
  const list = w?.competitors?.list ?? [];
  const town = profile.business.location.split(',')[0].trim();
  return (
    <section className="first-grid" aria-labelledby="first-h">
      <div className="panel">
        <div className="panel-head"><h2 className="heading" id="first-h">Your first ten minutes</h2><span className="small faint">Three things to do now</span></div>
        <ol className="first-steps">
          {acts.length === 0 && <li style={{ gridTemplateColumns: '1fr' }}><span className="muted">Your agents are at work. The first things to do appear here within a few minutes.</span></li>}
          {acts.map((a) => (
            <li key={a.id}>
              <span className="stack gap-4" style={{ minWidth: 0 }}><span className="subhead">{a.title}</span><span className="small muted">{a.why}</span></span>
              <Link to={a.link} className="btn btn-secondary btn-small">{a.cta}<Icon name="chevron" /></Link>
            </li>
          ))}
        </ol>
      </div>
      <div className="first-side">
        <div className="panel panel-pad">
          <h3 className="subhead">Businesses like yours near {town || 'you'}</h3>
          {searching ? <p className="progress-line mt-8"><span className="pulse" aria-hidden="true" />Searching Google around you now. Usually a few minutes.</p> : (
            <>
              <p className="small muted mt-8">{list.length} found{w?.competitors?.foundRadiusKm ? ` within ${w.competitors.foundRadiusKm} km` : ''}. The Watcher now reads their prices, reviews and Instagram every day.</p>
              <ul className="comp-list-plain mt-8">{list.slice(0, 5).map((c) => <li key={c.key} className="split"><span>{c.name}</span><span className="faint xsmall">{distanceLabel(c.distanceKm)}{c.rating != null ? ` · ${c.rating.toFixed(1)}★ (${c.count})` : ''}</span></li>)}</ul>
              <p className="mt-8"><Link to="/watcher?tab=competitors" className="small">See the comparison</Link></p>
            </>
          )}
        </div>
        <div className="panel panel-pad">
          <h3 className="subhead">Your reviews next to theirs</h3>
          {pos ? <p className="small muted mt-8">{pos.text}</p> : <p className="small muted mt-8">Connect your Google listing and this shows where your rating and review count sit among the businesses nearby. <Link to="/watcher?tab=reviews">Find my listing</Link></p>}
        </div>
      </div>
    </section>
  );
}

/** A small reminder on Home of what the agents have done this month. */
function ValueStrip() {
  const { data } = useLoad(() => api.listValue());
  if (!data) return null;
  const v = summariseValue(data, startOfMonth());
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' });
  return (
    <Link to="/results" className="panel value-strip">
      <span className="value-strip-head"><span className="subhead">{month} with Gainora</span><Icon name="chevron" className="chev" /></span>
      <span className="value-strip-grid">
        <span><strong className="tabular">{formatMinutes(v.minutesSaved, true)}</strong><span>saved (estimate)</span></span>
        <span><strong className="tabular">{v.counts.lead_found}</strong><span>potential customers</span></span>
        <span><strong className="tabular">{v.counts.tender_found}</strong><span>{v.tenderValue ? `contracts, ${money(v.tenderValue)}` : 'public contracts'}</span></span>
      </span>
    </Link>
  );
}
