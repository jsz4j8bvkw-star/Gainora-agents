import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Link } from '../lib/router';
import { AGENTS, Button, ErrorNote, Icon, Loading, useLoad, useToast } from '../components/ui';
import { greeting, money, relative } from '../lib/format';
import { formatMinutes, startOfMonth, summariseValue } from '../../shared/value';
import type { Action, AgentId } from '../lib/types';

const AGENT_SHORT: Record<string, string> = { watcher: 'Watcher', scout: 'Scout', brief: 'Brief', you: 'You' };

export function Home() {
  const { profile, plan } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.getHome());
  const [newTodo, setNewTodo] = useState('');
  const toast = useToast();

  if (loading && !data) return <Loading />;
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

  const open = data.actions.filter((a) => !a.done);
  const done = data.actions.filter((a) => a.done);
  const g = data.goalProgress;
  const pct = g.current != null && g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : null;
  const unread = data.alerts.filter((a) => !a.read).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">{greeting()}, {profile.business.ownerName}.</h1>
          <p className="lede">Here’s what your agents found for {profile.business.name}.</p>
        </div>
        <Link to="/ask" className="btn btn-secondary"><Icon name="ask" />Ask a question</Link>
      </div>

      <div className="grid-2">
        <section className="panel letter" aria-labelledby="notes-h">
          <h2 className="heading" id="notes-h">This week</h2>
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
            </>
          ) : <p className="small" style={{ color: '#BDB8AF' }}>Add a number to your target under Your business to track progress here.</p>}
          <p className="small" style={{ color: '#8E8A82' }}>{g.weeksLeft} {g.weeksLeft === 1 ? 'week' : 'weeks'} left. Focus: {profile.goals.focus}.</p>
        </aside>
        <ValueStrip />
        </div>
      </div>

      <div className="grid-2 section">
        <section aria-labelledby="todo-h">
          <div className="section-head"><h2 className="heading" id="todo-h">To do</h2><span className="small faint">{open.length} open</span></div>
          <div className="panel">
            <div className="rows">
              {open.length === 0 && <div className="empty"><p className="muted">Nothing left on your list. Your agents will add new actions as they find them.</p></div>}
              {[...open, ...done.slice(0, 3)].map((a) => (
                <div className={`todo ${a.done ? 'done' : ''}`} key={a.id} style={{ position: 'relative' }}>
                  <input type="checkbox" id={`t-${a.id}`} checked={a.done} onChange={() => toggle(a)} />
                  <label htmlFor={`t-${a.id}`} className="check" aria-hidden="true"><Icon name="check" /></label>
                  <label htmlFor={`t-${a.id}`}>
                    <span className="todo-text">{a.text}</span>
                    <span className="xsmall faint">{AGENT_SHORT[a.agent]}, {relative(a.createdAt)}</span>
                  </label>
                </div>
              ))}
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
                  <div className="xsmall faint mt-8">{AGENTS[a.agent].name}, {relative(a.at)}</div>
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
                </span>
                <span className="row gap-12">
                  {on && st.lastRun && <span className="xsmall faint" style={{ whiteSpace: 'nowrap' }}>Updated {relative(st.lastRun)}</span>}
                  <Icon name="chevron" className="chev" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
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
