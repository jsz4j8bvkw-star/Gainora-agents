import { useEffect, useMemo, useState } from 'react';
import { Link, navigate, useQuery } from '../lib/router';
import { Button, ErrorNote, Field, Loading, Modal, Tabs, useLoad, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { dueLabel, ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import {
  anchorFor, BLOCK_KINDS, DAY_NAMES, daysLabel, type DayPatch, gymFor, type Level, type MeSettings, type MeTask, type Plan, REPEATS, type RoutineBlock,
  SCORE_FIELDS, TASK_CATEGORIES, taskGroups,
} from '../../shared/admin/me';
import { me } from './me-api';
import { clientPath } from './bits';

type Tab = 'today' | 'todo' | 'week' | 'routine';
const TABS: { id: Tab; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'todo', label: 'To-do list' }, { id: 'week', label: 'My weeks' }, { id: 'routine', label: 'Routine and rules' }];
const LEVEL_TONE: Record<Level, string> = { good: 'tag-forest', minimum: 'tag-forest', open: 'tag-brass', missed: 'tag-danger' };
const londonNow = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date());
const CAT_LABEL = Object.fromEntries(TASK_CATEGORIES.map((c) => [c.id, c.label])) as Record<string, string>;
const REPEAT_LABEL = Object.fromEntries(REPEATS.map((r) => [r.id, r.label])) as Record<string, string>;
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Adelin's own day: routine, check-ins, scoreboard, to-do list, notes and trading journal, in one place. */
export function MyDay() {
  // The tab lives in the address (/me?tab=todo), so links from elsewhere on the page open the right one.
  const asked = useQuery().get('tab');
  const tab: Tab = TABS.some((t) => t.id === asked) ? asked as Tab : 'today';
  const pick = (t: Tab) => navigate(t === 'today' ? '/me' : `/me?tab=${t}`, { replace: true });
  return (
    <div className="page">
      <Tabs tabs={TABS} value={tab} onChange={pick} label="My day" />
      <div className="mt-16" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'today' && <TodayTab />}
        {tab === 'todo' && <TodoTab />}
        {tab === 'week' && <WeekTab />}
        {tab === 'routine' && <RoutineTab />}
      </div>
    </div>
  );
}

/* ---------- Today ---------- */

function TodayTab() {
  const [date, setDate] = useState(ukToday());
  const { data: p, setData, error, reload } = useLoad<Plan>(() => me.today(date), [date]);
  const toast = useToast();
  const save = async (patch: DayPatch, done?: string) => {
    try { setData(await me.saveDay(date, patch)); if (done) toast(done); return true; }
    catch (e) { toast(humanThrown(e, 'That didn’t save.')); return false; }
  };
  if (error) return <ErrorNote message={/502|saved data|being set up/i.test(error) ? 'My day’s database tables aren’t set up yet. Run the My day update (20261114_gainora_my_day.sql) in Supabase.' : error} retry={reload} />;
  if (!p) return <Loading label="Loading your day" />;
  const contacts = p.day.contacts ?? 0;
  return (
    <div className="stack gap-24">
      <div className="page-head">
        <div>
          <h1 className="title">{p.isToday ? 'My day' : p.dayName}</h1>
          <p className="lede">{p.isToday ? `${p.dayName}. ` : ''}Gym: {p.gym.label}.{p.settings.gymMinutes ? ` About ${p.settings.gymMinutes} minutes.` : ' Session length not set yet.'}</p>
        </div>
        <div className="seg" role="group" aria-label="Which day">
          <button type="button" onClick={() => setDate(addDays(date, -1))}>Previous day</button>
          <button type="button" aria-pressed={p.isToday} onClick={() => setDate(ukToday())}>Today</button>
          <button type="button" onClick={() => setDate(addDays(date, 1))} disabled={date >= addDays(p.today, 7)}>Next day</button>
        </div>
      </div>

      {p.energyWarning && <div className="err" role="alert">{p.energyWarning}</div>}

      <section className="panel stats" aria-label="How the day is going">
        <div className="stat"><span className="stat-label">The day</span><span className={`tag ${LEVEL_TONE[p.status.level]}`} style={{ alignSelf: 'flex-start', marginTop: 8 }}>{p.status.label}</span><span className="stat-note">{p.status.level === 'open' ? 'Minimum first, then the rest' : p.status.level === 'missed' ? 'Tomorrow, just the minimum' : 'Streak kept'}</span></div>
        <div className="stat"><span className="stat-label">Streak</span><span className="stat-value">{p.streak}</span><span className="stat-note">Days at minimum or better</span></div>
        <div className="stat"><span className="stat-label">Contacts</span><span className="stat-value">{contacts}</span><span className="stat-note">{p.weekday >= 6 ? 'Weekend: no target' : `Minimum ${p.settings.minimum.contacts}, good ${p.settings.good.contacts}`}</span></div>
        <div className="stat"><span className="stat-label">This week</span><span className="stat-value">{p.week.contacts}</span><span className="stat-note">of {p.week.contactsTarget} contacts</span></div>
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="routine-h">
          <div className="panel-head"><h2 className="heading" id="routine-h">{p.isToday ? 'Today’s routine' : 'The routine that day'}</h2><span className="small faint">{p.blocks.filter((b) => b.ticked).length} of {p.blocks.length} done</span></div>
          <RoutineList plan={p} onTick={(id, v) => save({ ticks: { [id]: v } })} />
        </section>
        <div className="stack gap-24">
          <Levels plan={p} />
          <CheckIn key={`c-${p.date}`} plan={p} onSave={save} />
          <DueToday plan={p} onChange={reload} />
        </div>
      </div>

      <div className="grid-2">
        <Scoreboard key={`s-${p.date}`} plan={p} onSave={save} />
        <GymCard key={`g-${p.date}`} plan={p} onSave={save} />
      </div>
      <div className="grid-2">
        <TradingCard key={`t-${p.date}`} plan={p} onSave={save} />
        <NotesCard key={`n-${p.date}`} plan={p} onSave={save} />
      </div>
    </div>
  );
}

function RoutineList({ plan: p, onTick }: { plan: Plan; onTick: (id: string, v: boolean) => Promise<boolean> }) {
  const [now, setNow] = useState(londonNow());
  useEffect(() => { const t = setInterval(() => setNow(londonNow()), 60_000); return () => clearInterval(t); }, []);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const current = p.isToday ? [...p.blocks].reverse().find((b) => b.start <= now && (!b.finish || b.finish > now)) : undefined;
  if (!p.blocks.length) return <p className="panel-pad muted">No blocks on this day. Add some under Routine and rules.</p>;
  const toggle = async (b: Plan['blocks'][number]) => {
    const v = !(pending[b.id] ?? b.ticked);
    setPending((x) => ({ ...x, [b.id]: v }));
    await onTick(b.id, v);
    setPending((x) => { const { [b.id]: _, ...rest } = x; return rest; });
  };
  return (
    <ul className="task-list">
      {p.blocks.map((b) => {
        const done = pending[b.id] ?? b.ticked;
        const label = b.kind === 'gym' ? `${b.title}: ${p.gym.label}` : b.title;
        return (
          <li key={b.id} className={`task-row me-block${done ? ' is-done' : ''}${current?.id === b.id ? ' is-now' : ''}`}>
            <input type="checkbox" checked={done} onChange={() => toggle(b)} aria-label={`${done ? 'Not done' : 'Done'}: ${b.start} ${label}`} />
            <span className="me-time">{b.start}{b.finish ? <span className="faint">–{b.finish}</span> : null}</span>
            <div className="task-main">
              <span className="task-title">{label}</span>
              {(b.detail || current?.id === b.id) && <span className="task-meta">{current?.id === b.id && <span className="tag tag-brass">Now</span>}{b.detail && <span className="xsmall faint">{b.detail}</span>}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Levels({ plan: p }: { plan: Plan }) {
  const row = (c: { id: string; label: string; ok: boolean }) => <li key={c.id} className={`me-check${c.ok ? ' ok' : ''}`}><span aria-hidden="true">{c.ok ? '✓' : '○'}</span>{c.label}<span className="sr-only">{c.ok ? ' (done)' : ' (not yet)'}</span></li>;
  return (
    <section className="panel" aria-labelledby="levels-h">
      <div className="panel-head"><h2 className="heading" id="levels-h">Minimum and good day</h2><span className={`tag ${LEVEL_TONE[p.status.level]}`}>{p.status.label}</span></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16, paddingBottom: 16 }}>
        <div><p className="small"><strong>Minimum</strong> <span className="faint">(keeps the streak, even on a bad day)</span></p><ul className="me-checks">{p.status.minimum.map(row)}</ul></div>
        <div><p className="small"><strong>Good day</strong> <span className="faint">(the minimum, plus)</span></p><ul className="me-checks">{p.status.good.map(row)}</ul></div>
      </div>
    </section>
  );
}

function CheckIn({ plan: p, onSave }: { plan: Plan; onSave: (patch: DayPatch, done?: string) => Promise<boolean> }) {
  const [dos, setDos] = useState<string[]>([0, 1, 2].map((i) => p.day.must_dos[i] ?? ''));
  const [busy, setBusy] = useState(false);
  const changed = dos.join('|') !== [0, 1, 2].map((i) => p.day.must_dos[i] ?? '').join('|');
  return (
    <section className="panel" aria-labelledby="dos-h">
      <div className="panel-head"><h2 className="heading" id="dos-h">Three must-dos</h2><span className="small faint">Morning check-in</span></div>
      <div className="panel-pad stack gap-8" style={{ paddingTop: 16, paddingBottom: 16 }}>
        {dos.map((d, i) => <input key={i} className="input" value={d} placeholder={['The one thing that moves money today', 'Second', 'Third'][i]} aria-label={`Must-do ${i + 1}`} onChange={(e: any) => setDos(dos.map((x, k) => (k === i ? e.target.value : x)))} />)}
        <div><Button small busy={busy} disabled={!changed} onClick={async () => { setBusy(true); await onSave({ must_dos: dos }, 'Must-dos saved'); setBusy(false); }}>Save must-dos</Button></div>
      </div>
    </section>
  );
}

function DueToday({ plan: p, onChange }: { plan: Plan; onChange: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { await me.saveTask({ title, due_on: p.date, category: 'business' }); setTitle(''); onChange(); }
    catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-labelledby="due-h">
      <div className="panel-head"><h2 className="heading" id="due-h">Due {p.isToday ? 'today' : 'that day'}</h2><Link to="/me?tab=todo" className="small">To-do list</Link></div>
      <ul className="plain-list">
        <li><Link to="/sales"><strong>{p.followUpsDue ? `${p.followUpsDue} follow-up${p.followUpsDue === 1 ? '' : 's'} due` : 'No follow-ups due'}</strong></Link><span className="small muted">Sales → Follow-ups</span></li>
        {p.clientTasks.length > 0 && <li><Link to="/delivery"><strong>{p.clientTasks.length} client step{p.clientTasks.length === 1 ? '' : 's'} due or late</strong></Link><span className="small muted">{p.clientTasks.slice(0, 3).map((t) => <span key={t.id} style={{ display: 'block' }}><Link to={clientPath(t.email)}>{t.client}</Link>: {t.title} ({dueLabel(t.due_on, p.today)})</span>)}</span></li>}
      </ul>
      {p.tasks.due.length > 0 && <ul className="task-list" style={{ borderTop: '1px solid var(--line)' }}>{p.tasks.due.map((t) => <MeTaskRow key={t.id} task={t} today={p.today} onChange={onChange} />)}</ul>}
      <div className="panel-pad row gap-8" style={{ paddingTop: 12, paddingBottom: 16, borderTop: '1px solid var(--line)' }}>
        <input className="input" value={title} placeholder="Add a task for this day" aria-label="New task" onChange={(e: any) => setTitle(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter') add(); }} />
        <Button small kind="secondary" icon="plus" busy={busy} onClick={add}>Add</Button>
      </div>
    </section>
  );
}

function Scoreboard({ plan: p, onSave }: { plan: Plan; onSave: (patch: DayPatch, done?: string) => Promise<boolean> }) {
  const initial = () => ({ ...Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, p.day[f.key] ?? ''])), energy: p.day.energy ?? '' } as Record<string, number | ''>);
  const [v, setV] = useState(initial);
  // The tick box and the routine's follow-ups block are the same thing: either one counts, and saving keeps them in step.
  const fuBlock = p.blocks.find((b) => b.kind === 'followups');
  const [cleared, setCleared] = useState(p.day.followups_cleared || !!fuBlock?.ticked);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); await onSave({ ...v, followups_cleared: cleared, ...(fuBlock ? { ticks: { [fuBlock.id]: cleared } } : {}) } as DayPatch, 'Scoreboard saved'); setBusy(false); };
  return (
    <section className="panel" aria-labelledby="score-h">
      <div className="panel-head"><h2 className="heading" id="score-h">Scoreboard</h2><span className="small faint">Evening check-in</span></div>
      <div className="panel-pad stack gap-16" style={{ paddingTop: 16 }}>
        <div className="me-scores">
          {SCORE_FIELDS.map((f) => <Field key={f.key} label={f.label}>{(id) => <input id={id} className="input input-num" type="number" min={0} inputMode="numeric" value={v[f.key]} onChange={(e: any) => setV({ ...v, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })} />}</Field>)}
        </div>
        <Field label="Energy out of 10" as="group">{() => (
          <div className="seg me-energy" role="group">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} type="button" aria-pressed={v.energy === n} onClick={() => setV({ ...v, energy: v.energy === n ? '' : n })}>{n}</button>)}</div>
        )}</Field>
        <label className="check-row"><input type="checkbox" checked={cleared} onChange={() => setCleared(!cleared)} />Follow-ups cleared</label>
        <div className="row gap-12 wrap"><Button busy={busy} onClick={save}>Save scoreboard</Button><span className="small faint">This week: {p.week.contacts} contacts, {p.week.conversations} conversations, {p.week.sales_chats} sales chats, {p.week.proposals} proposals, {p.week.new_clients} new clients.</span></div>
      </div>
    </section>
  );
}

function GymCard({ plan: p, onSave }: { plan: Plan; onSave: (patch: DayPatch, done?: string) => Promise<boolean> }) {
  const [minutes, setMinutes] = useState<number | ''>(p.day.gym.minutes ?? '');
  const [note, setNote] = useState(p.day.gym.note);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel" aria-labelledby="gym-h">
      <div className="panel-head"><h2 className="heading" id="gym-h">Gym</h2><span className="small faint">{p.gym.label}</span></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16 }}>
        <label className="check-row"><input type="checkbox" checked={p.gym.done} onChange={() => { const b = p.blocks.find((x) => x.kind === 'gym'); onSave({ gym: { done: !p.gym.done }, ...(b ? { ticks: { [b.id]: !p.gym.done } } : {}) }); }} />Session done</label>
        <div className="row gap-12 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Minutes in the gym" help={p.settings.gymMinutes ? `Usual: ${p.settings.gymMinutes}` : 'Not counting travel'}>{(id, d) => <input id={id} aria-describedby={d} className="input input-num" type="number" min={0} inputMode="numeric" value={minutes} onChange={(e: any) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))} />}</Field>
          <Field label="Note" optional className="grow">{(id) => <input id={id} className="input" value={note} placeholder="Weights, how it felt" onChange={(e: any) => setNote(e.target.value)} />}</Field>
        </div>
        <div><Button small kind="secondary" busy={busy} onClick={async () => { setBusy(true); await onSave({ gym: { minutes: minutes === '' ? null : minutes, note } }, 'Gym saved'); setBusy(false); }}>Save</Button></div>
      </div>
    </section>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Field label={label} as="group">{() => (
      <div className="seg" role="group">{([true, false] as const).map((x) => <button key={String(x)} type="button" aria-pressed={value === x} onClick={() => onChange(value === x ? null : x)}>{x ? 'Yes' : 'No'}</button>)}</div>
    )}</Field>
  );
}

function TradingCard({ plan: p, onSave }: { plan: Plan; onSave: (patch: DayPatch, done?: string) => Promise<boolean> }) {
  const [t, setT] = useState(p.day.trading);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  return (
    <section className="panel" aria-labelledby="trade-h">
      <div className="panel-head"><h2 className="heading" id="trade-h">Trading journal</h2><button type="button" className="small linklike-plain" onClick={() => setRules(true)}>Trading rules</button></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16 }}>
        <div className="row gap-16 wrap"><YesNo label="News day?" value={t.news_day} onChange={(v) => setT({ ...t, news_day: v })} /><YesNo label="Traded?" value={t.traded} onChange={(v) => setT({ ...t, traded: v })} /></div>
        {t.news_day && t.traded && <p className="small" style={{ color: 'var(--danger)' }}>A trade on a news day. Was that in your rules?</p>}
        <Field label="Setup" optional>{(id) => <input id={id} className="input" value={t.setup} onChange={(e: any) => setT({ ...t, setup: e.target.value })} />}</Field>
        <Field label="Result" optional>{(id) => <input id={id} className="input" value={t.result} placeholder="For example +1.5R, or watched only" onChange={(e: any) => setT({ ...t, result: e.target.value })} />}</Field>
        <Field label="Notes" optional>{(id) => <textarea id={id} className="textarea" value={t.notes} onChange={(e: any) => setT({ ...t, notes: e.target.value })} />}</Field>
        <div><Button small kind="secondary" busy={busy} onClick={async () => { setBusy(true); await onSave({ trading: t }, 'Journal saved'); setBusy(false); }}>Save journal</Button></div>
      </div>
      {rules && <Modal title="Trading rules" onClose={() => setRules(false)}>{p.settings.tradingRules ? <p className="answer-text">{p.settings.tradingRules}</p> : <p className="muted">No rules written yet. Add them under Routine and rules, or tell Claude.</p>}</Modal>}
    </section>
  );
}

function NotesCard({ plan: p, onSave }: { plan: Plan; onSave: (patch: DayPatch, done?: string) => Promise<boolean> }) {
  const [notes, setNotes] = useState(p.day.notes);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel" aria-labelledby="notes-h">
      <div className="panel-head"><h2 className="heading" id="notes-h">Notes</h2><span className="small faint">Claude can add to these</span></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16 }}>
        <textarea className="textarea" style={{ minHeight: 180 }} aria-label="Notes for the day" value={notes} onChange={(e: any) => setNotes(e.target.value)} />
        <div><Button small kind="secondary" busy={busy} disabled={notes === p.day.notes} onClick={async () => { setBusy(true); await onSave({ notes }, 'Notes saved'); setBusy(false); }}>Save notes</Button></div>
      </div>
    </section>
  );
}

/* ---------- To-do list ---------- */

function MeTaskRow({ task, today, onChange, onEdit }: { task: MeTask; today: string; onChange: () => void; onEdit?: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tick = async () => {
    setBusy(true);
    try { const t = await me.saveTask({ id: task.id, done: !task.done }); if (t.next_due) toast(`Done. Next one: ${shortDay(t.next_due)}`); onChange(); }
    catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); }
  };
  return (
    <li className={`task-row${task.done ? ' is-done' : ''}`}>
      <input type="checkbox" checked={task.done} disabled={busy} onChange={tick} aria-label={`${task.done ? 'Not done' : 'Done'}: ${task.title}`} />
      <div className="task-main">
        {onEdit ? <button type="button" className="task-title linklike-plain" onClick={onEdit}>{task.title}</button> : <span className="task-title">{task.title}</span>}
        <span className="task-meta">
          <span className="xsmall muted">{CAT_LABEL[task.category]}</span>
          {task.repeat !== 'none' && <span className="xsmall faint">{REPEAT_LABEL[task.repeat]}</span>}
          {task.notes && <span className="xsmall faint">{task.notes.slice(0, 140)}</span>}
        </span>
      </div>
      {task.due_on && !task.done && <span className={`due ${task.due_on < today ? 'due-late' : task.due_on === today ? 'due-today' : ''}`}>{dueLabel(task.due_on, today)}</span>}
    </li>
  );
}

function TodoTab() {
  const [showDone, setShowDone] = useState(false);
  const [cat, setCat] = useState<string>('all');
  const { data: tasks, error, reload } = useLoad<MeTask[]>(() => me.tasks(showDone), [showDone]);
  const [editing, setEditing] = useState<Partial<MeTask> | null>(null);
  const today = ukToday();
  const list = useMemo(() => (tasks ?? []).filter((t) => cat === 'all' || t.category === cat), [tasks, cat]);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!tasks) return <Loading label="Loading your to-do list" />;
  const groups = taskGroups(list, today);
  const done = list.filter((t) => t.done);
  return (
    <div className="stack gap-16">
      <div className="page-head"><div><h1 className="title">To-do list</h1><p className="lede">{list.filter((t) => !t.done).length} open. Business, trading, gym and personal, in one list. Claude can add to it.</p></div><Button icon="plus" onClick={() => setEditing({ category: cat === 'all' ? 'business' : cat as MeTask['category'], due_on: today, repeat: 'none' })}>Add a task</Button></div>
      <div className="row gap-12 wrap">
        <div className="seg" role="group" aria-label="Category">{[{ id: 'all', label: 'All' }, ...TASK_CATEGORIES].map((c) => <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</button>)}</div>
        <label className="check-row"><input type="checkbox" checked={showDone} onChange={() => setShowDone(!showDone)} />Show done</label>
      </div>
      {!groups.length && !done.length && <section className="panel"><p className="panel-pad muted">Nothing here. Add a task, or ask Claude to.</p></section>}
      {groups.map((g) => (
        <section key={g.id} className="panel" aria-labelledby={`g-${g.id}`}>
          <div className="panel-head"><h2 className="heading" id={`g-${g.id}`}>{g.label}</h2><span className="small faint">{g.tasks.length}</span></div>
          <ul className="task-list">{g.tasks.map((t) => <MeTaskRow key={t.id} task={t} today={today} onChange={reload} onEdit={() => setEditing(t)} />)}</ul>
        </section>
      ))}
      {showDone && done.length > 0 && (
        <section className="panel" aria-labelledby="g-done"><div className="panel-head"><h2 className="heading" id="g-done">Done</h2></div><ul className="task-list">{done.map((t) => <MeTaskRow key={t.id} task={t} today={today} onChange={reload} onEdit={() => setEditing(t)} />)}</ul></section>
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function TaskEditor({ task, onClose, onDone }: { task: Partial<MeTask>; onClose: () => void; onDone: () => void }) {
  const [t, setT] = useState(task);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => { setBusy(true); setErr(null); try { await me.saveTask(t); onDone(); } catch (e) { setErr(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  const remove = async () => { if (!t.id) return; setBusy(true); try { await me.deleteTask(t.id); toast('Task deleted'); onDone(); } catch (e) { setErr(humanThrown(e, 'That didn’t delete.')); } finally { setBusy(false); } };
  return (
    <Modal title={t.id ? 'Edit task' : 'Add a task'} onClose={onClose} footer={<>{t.id && <Button kind="quiet" busy={busy} onClick={remove}>Delete</Button>}<Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack gap-16">
        <Field label="Task" error={err ?? undefined}>{(id, d) => <input id={id} className="input" aria-describedby={d} value={t.title ?? ''} onChange={(e: any) => setT({ ...t, title: e.target.value })} />}</Field>
        <div className="row gap-12 wrap">
          <Field label="Category">{(id) => <select id={id} className="select" value={t.category ?? 'business'} onChange={(e: any) => setT({ ...t, category: e.target.value })}>{TASK_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}</Field>
          <Field label="Due" optional>{(id) => <input id={id} className="input input-date" type="date" value={t.due_on ?? ''} onChange={(e: any) => setT({ ...t, due_on: e.target.value || null })} />}</Field>
          <Field label="Repeats">{(id) => <select id={id} className="select" value={t.repeat ?? 'none'} onChange={(e: any) => setT({ ...t, repeat: e.target.value })}>{REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>}</Field>
        </div>
        <Field label="Notes" optional>{(id) => <textarea id={id} className="textarea" value={t.notes ?? ''} onChange={(e: any) => setT({ ...t, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

/* ---------- My weeks ---------- */

function WeekTab() {
  const { data: w, error, reload } = useLoad(() => me.week(8));
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!w) return <Loading label="Adding up your weeks" />;
  return (
    <div className="stack gap-16">
      <div className="page-head"><div><h1 className="title">My weeks</h1><p className="lede">Streak: {w.streak} day{w.streak === 1 ? '' : 's'} at minimum or better. What you do, not what clients decide.</p></div></div>
      {w.energyWarning && <div className="err" role="alert">{w.energyWarning}</div>}
      <section className="panel">
        <p className="panel-pad small muted" style={{ paddingTop: 14, paddingBottom: 0 }}>Talks: conversations with an owner. Chats: sales chats booked. Weeks with nothing logged are left out.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Week of</th><th className="num">Contacts</th><th className="num">Talks</th><th className="num">Chats</th><th className="num">Proposals</th><th className="num">Clients</th><th className="num">Min days</th><th className="num">Good days</th><th className="num">Energy</th></tr></thead>
          <tbody>{w.weeks.filter((x, i) => i === 0 || x.daysLogged > 0).map((x) => (
            <tr key={x.week}>
              <td className="me-nowrap">{shortDay(x.week)}</td>
              <td className="num"><span className={x.contacts >= x.contactsTarget ? 'due-today' : undefined}>{x.contacts}</span><span className="faint"> / {x.contactsTarget}</span></td>
              <td className="num">{x.conversations}</td><td className="num">{x.sales_chats}</td><td className="num">{x.proposals}</td><td className="num">{x.new_clients}</td>
              <td className="num">{x.minimumDays}</td><td className="num">{x.goodDays}</td>
              <td className="num">{x.energyAvg ?? '–'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="panel" aria-labelledby="days-h">
        <div className="panel-head"><h2 className="heading" id="days-h">The last two weeks</h2></div>
        <ul className="plain-list">{w.days.map((d) => (
          <li key={d.date} className="row gap-12 wrap" style={{ justifyContent: 'space-between' }}>
            <strong className="small">{shortDay(d.date)}</strong>
            <span className="small muted">{d.contacts ?? 0} contacts · energy {d.energy ?? '–'} · gym {d.gym ? 'done' : 'not ticked'}</span>
            <span className={`tag ${LEVEL_TONE[d.level]}`}>{d.label}</span>
          </li>
        ))}</ul>
      </section>
    </div>
  );
}

/* ---------- Routine and rules ---------- */

function RoutineTab() {
  const { data, error, reload, setData } = useLoad(() => me.routine());
  const [editing, setEditing] = useState<Partial<RoutineBlock> | null>(null);
  const [filter, setFilter] = useState<number>(0);
  if (error) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading label="Loading your routine" />;
  const blocks = [...data.routine].filter((b) => !filter || b.days.includes(filter)).sort((a, b) => a.start.localeCompare(b.start) || a.sort - b.sort);
  return (
    <div className="stack gap-24">
      <div className="page-head"><div><h1 className="title">Routine and rules</h1><p className="lede">The day that repeats. Change a block here or ask Claude to.</p></div><Button icon="plus" onClick={() => setEditing({ days: [1, 2, 3, 4, 5], kind: 'other' })}>Add a block</Button></div>
      <div className="seg" role="group" aria-label="Show the day">{[0, 1, 2, 3, 4, 5, 6, 7].map((d) => <button key={d} type="button" aria-pressed={filter === d} onClick={() => setFilter(d)}>{d ? DAY_NAMES[d - 1] : 'All'}</button>)}</div>
      <section className="panel">
        <ul className="task-list">{blocks.map((b) => (
          <li key={b.id} className="task-row me-block">
            <span className="me-time">{b.start}{b.finish ? <span className="faint">–{b.finish}</span> : null}</span>
            <div className="task-main"><button type="button" className="task-title linklike-plain" onClick={() => setEditing(b)}>{b.title}</button><span className="task-meta"><span className="xsmall muted">{daysLabel(b.days)}</span><span className="xsmall faint">{BLOCK_KINDS.find((k) => k.id === b.kind)?.label}</span>{b.detail && <span className="xsmall faint">{b.detail}</span>}</span></div>
          </li>
        ))}</ul>
        {!blocks.length && <p className="panel-pad muted">No blocks on this day.</p>}
      </section>
      <div className="grid-2">
        <GymSettings settings={data.settings} onSaved={(s) => setData({ ...data, settings: s })} />
        <Targets settings={data.settings} onSaved={(s) => setData({ ...data, settings: s })} />
      </div>
      <Rules settings={data.settings} onSaved={(s) => setData({ ...data, settings: s })} />
      {editing && <BlockEditor block={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function GymSettings({ settings, onSaved }: { settings: MeSettings; onSaved: (s: MeSettings) => void }) {
  const today = ukToday();
  const [split, setSplit] = useState(settings.gymSplit);
  const [todayIdx, setTodayIdx] = useState(gymFor(settings, today).index);
  const [minutes, setMinutes] = useState<number | ''>(settings.gymMinutes ?? '');
  const [finisher, setFinisher] = useState(settings.finisher);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try { const clean = split.map((x) => x.trim()).filter(Boolean); onSaved(await me.saveSettings({ gymSplit: clean, gymAnchor: anchorFor(clean, today, Math.min(todayIdx, clean.length - 1)), gymMinutes: minutes === '' ? null : minutes, finisher })); toast('Gym plan saved'); }
    catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-labelledby="split-h">
      <div className="panel-head"><h2 className="heading" id="split-h">Gym split</h2><span className="small faint">One session a day, in this order</span></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16 }}>
        <ol className="q-edit">{split.map((s, i) => <li key={i}><div className="row gap-8"><input className="input" value={s} aria-label={`Day ${i + 1} of the split`} onChange={(e: any) => setSplit(split.map((x, k) => (k === i ? e.target.value : x)))} /><button type="button" className="icon-btn" aria-label={`Remove day ${i + 1}`} onClick={() => setSplit(split.filter((_, k) => k !== i))}>×</button></div></li>)}</ol>
        <div><Button small kind="quiet" icon="plus" onClick={() => setSplit([...split, ''])}>Add a day</Button></div>
        <div className="row gap-12 wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Today’s session is">{(id) => <select id={id} className="select" value={todayIdx} onChange={(e: any) => setTodayIdx(Number(e.target.value))}>{split.map((s, i) => <option key={i} value={i}>{i + 1}. {s || '(empty)'}</option>)}</select>}</Field>
          <Field label="Usual minutes" help="In the gym, not travel">{(id, d) => <input id={id} aria-describedby={d} className="input input-num" type="number" min={0} value={minutes} onChange={(e: any) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))} />}</Field>
          <Field label="Every session ends with">{(id) => <input id={id} className="input" value={finisher} onChange={(e: any) => setFinisher(e.target.value)} />}</Field>
        </div>
        <div><Button small busy={busy} onClick={save}>Save gym plan</Button></div>
      </div>
    </section>
  );
}

function Targets({ settings, onSaved }: { settings: MeSettings; onSaved: (s: MeSettings) => void }) {
  const [min, setMin] = useState(settings.minimum.contacts);
  const [good, setGood] = useState(settings.good.contacts);
  const [week, setWeek] = useState(settings.weeklyContacts);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => { setBusy(true); try { onSaved(await me.saveSettings({ minimum: { contacts: min }, good: { contacts: good }, weeklyContacts: week })); toast('Targets saved'); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  return (
    <section className="panel" aria-labelledby="targets-h">
      <div className="panel-head"><h2 className="heading" id="targets-h">Targets</h2></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16 }}>
        <p className="small muted">Minimum day (weekdays): follow-ups cleared, the minimum contacts, gym done, in bed on time. Weekends: gym and bed. Good day: the minimum, the good number of contacts and every block ticked.</p>
        <div className="row gap-12 wrap">
          <Field label="Minimum contacts">{(id) => <input id={id} className="input input-num" type="number" min={1} value={min} onChange={(e: any) => setMin(Number(e.target.value))} />}</Field>
          <Field label="Good day contacts">{(id) => <input id={id} className="input input-num" type="number" min={1} value={good} onChange={(e: any) => setGood(Number(e.target.value))} />}</Field>
          <Field label="Contacts a week">{(id) => <input id={id} className="input input-num" type="number" min={1} value={week} onChange={(e: any) => setWeek(Number(e.target.value))} />}</Field>
        </div>
        <div><Button small busy={busy} onClick={save}>Save targets</Button></div>
      </div>
    </section>
  );
}

function Rules({ settings, onSaved }: { settings: MeSettings; onSaved: (s: MeSettings) => void }) {
  const [rules, setRules] = useState(settings.tradingRules);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <section className="panel" aria-labelledby="rules-h">
      <div className="panel-head"><h2 className="heading" id="rules-h">Trading rules</h2><span className="small faint">One rule a line</span></div>
      <div className="panel-pad stack gap-12" style={{ paddingTop: 16 }}>
        <textarea className="textarea" style={{ minHeight: 160 }} aria-label="Trading rules" value={rules} placeholder="What counts as a news day, your setups, risk per trade, when you stop" onChange={(e: any) => setRules(e.target.value)} />
        <div><Button small busy={busy} disabled={rules === settings.tradingRules} onClick={async () => { setBusy(true); try { onSaved(await me.saveSettings({ tradingRules: rules })); toast('Rules saved'); } catch (e) { toast(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } }}>Save rules</Button></div>
      </div>
    </section>
  );
}

function BlockEditor({ block, onClose, onDone }: { block: Partial<RoutineBlock>; onClose: () => void; onDone: () => void }) {
  const [b, setB] = useState(block);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggleDay = (d: number) => setB({ ...b, days: (b.days ?? []).includes(d) ? (b.days ?? []).filter((x) => x !== d) : [...(b.days ?? []), d] });
  const save = async () => { setBusy(true); setErr(null); try { await me.saveBlock(b); onDone(); } catch (e) { setErr(humanThrown(e, 'That didn’t save.')); } finally { setBusy(false); } };
  const remove = async () => { if (!b.id) return; setBusy(true); try { await me.deleteBlock(b.id); onDone(); } catch (e) { setErr(humanThrown(e, 'That didn’t delete.')); } finally { setBusy(false); } };
  return (
    <Modal title={b.id ? 'Edit block' : 'Add a block'} onClose={onClose} footer={<>{b.id && <Button kind="quiet" busy={busy} onClick={remove}>Delete</Button>}<Button kind="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack gap-16">
        {err && <div className="err" role="alert">{err}</div>}
        <Field label="Name">{(id) => <input id={id} className="input" value={b.title ?? ''} onChange={(e: any) => setB({ ...b, title: e.target.value })} />}</Field>
        <div className="row gap-12 wrap">
          <Field label="Starts">{(id) => <input id={id} className="input input-num" type="time" value={b.start ?? ''} onChange={(e: any) => setB({ ...b, start: e.target.value })} />}</Field>
          <Field label="Ends" optional>{(id) => <input id={id} className="input input-num" type="time" value={b.finish ?? ''} onChange={(e: any) => setB({ ...b, finish: e.target.value || null })} />}</Field>
          <Field label="Kind">{(id) => <select id={id} className="select" value={b.kind ?? 'other'} onChange={(e: any) => setB({ ...b, kind: e.target.value })}>{BLOCK_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>}</Field>
        </div>
        <Field label="Days" as="group">{() => <div className="seg" role="group">{DAY_NAMES.map((n, i) => <button key={n} type="button" aria-pressed={(b.days ?? []).includes(i + 1)} onClick={() => toggleDay(i + 1)}>{n}</button>)}</div>}</Field>
        <Field label="Detail" optional>{(id) => <textarea id={id} className="textarea" value={b.detail ?? ''} onChange={(e: any) => setB({ ...b, detail: e.target.value })} />}</Field>
        <p className="xsmall faint">The kind matters for the minimum day: ticking a Gym block counts as gym done, a Sleep block as in bed on time, a Follow-ups block as follow-ups cleared.</p>
      </div>
    </Modal>
  );
}
