import { useState } from 'react';
import { Link } from '../lib/router';
import { Button, useToast } from '../components/ui';
import { humanThrown } from '../lib/errors';
import { dueLabel } from '../../shared/admin/board';
import { PACKAGES, type Package, type TaskWho, WHO_LABEL, ACCOUNT_STATUS_LABEL, type AccountStatus } from '../../shared/admin/model';
import { admin, type ClientTask } from './api';

export const clientPath = (email: string) => `/clients/${encodeURIComponent(email)}`;

export function PackageChips({ packages }: { packages: Package[] }) {
  if (!packages.length) return <span className="xsmall faint">No package</span>;
  return <span className="pkg-chips">{packages.map((p) => <span key={p} className={`pkg pkg-${p}`} title={PACKAGES[p].label}>{PACKAGES[p].short}</span>)}</span>;
}

export const WhoChip = ({ who }: { who: TaskWho }) => <span className={`who who-${who}`}>{WHO_LABEL[who]}</span>;
export const StatusChip = ({ status }: { status: AccountStatus }) => <span className={`tag ${status === 'active' ? 'tag-forest' : status === 'onboarding' ? 'tag-brass' : 'tag-plain'}`}>{ACCOUNT_STATUS_LABEL[status]}</span>;

export function Due({ due, today, done }: { due: string | null; today: string; done?: boolean }) {
  if (done) return <span className="xsmall faint">Done</span>;
  const late = !!due && due < today;
  return <span className={`due ${late ? 'due-late' : due === today ? 'due-today' : ''}`}>{dueLabel(due, today)}</span>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return <span className="xsmall faint">Not started</span>;
  return (
    <span className="mini-progress" title={`${done} of ${total} steps done`}>
      <span className="bar"><span style={{ width: `${(done / total) * 100}%` }} /></span>
      <span className="xsmall muted">{done}/{total}</span>
    </span>
  );
}

/** A delivery task: tick it off, see who it's with and when it's due. */
export function TaskRow({ task, today, showClient, onChange, onEdit, editor }: { task: ClientTask; today: string; showClient?: boolean; onChange: () => void; onEdit?: () => void; editor?: any }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [ticked, setTicked] = useState<boolean | null>(null);
  const done = ticked ?? task.status === 'done';
  const toggle = async () => {
    const next = !done;
    setTicked(next); setBusy(true);
    try { await admin.saveTask({ id: task.id, status: next ? 'done' : 'todo' }); onChange(); }
    catch (e) { setTicked(null); toast(humanThrown(e, 'That didn’t save.')); }
    finally { setBusy(false); }
  };
  return (
    <li className={`task-row${done ? ' is-done' : ''}`}>
      <input type="checkbox" checked={done} disabled={busy || !!task.auto} onChange={toggle} aria-label={`${done ? 'Not done' : 'Done'}: ${task.title}`} title={task.auto ? 'Ticked automatically from the apps' : undefined} />
      <div className="task-main">
        {onEdit ? <button type="button" className="task-title linklike-plain" aria-expanded={!!editor} onClick={onEdit}>{task.title}</button> : <span className="task-title">{task.title}</span>}
        <span className="task-meta">
          {showClient && <Link to={clientPath(task.email)} className="task-client">{task.client}</Link>}
          {task.status === 'waiting' && <span className="xsmall muted">Waiting</span>}
          {task.status === 'doing' && <span className="xsmall muted">In progress</span>}
          {task.auto && <span className="xsmall faint">Ticked from the apps</span>}
          {task.detail && <span className="xsmall faint">{task.detail}</span>}
        </span>
      </div>
      <WhoChip who={task.who} />
      <Due due={task.due_on} today={today} done={done} />
      {editor && <div className="task-editor">{editor}</div>}
    </li>
  );
}

export function StartSetup({ email, packages, started, onDone }: { email: string; packages: Package[]; started: Package[]; onDone: () => void }) {
  const [busy, setBusy] = useState<Package | null>(null);
  const toast = useToast();
  const todo = packages.filter((p) => !started.includes(p));
  if (!todo.length) return null;
  const go = async (p: Package) => {
    setBusy(p);
    try { const n = await admin.start(email, p, new Date().toISOString().slice(0, 10)); toast(`${PACKAGES[p].label}: ${n} steps added, starting today.`); onDone(); }
    catch (e) { toast(humanThrown(e, 'The set-up didn’t start.')); }
    finally { setBusy(null); }
  };
  return <span className="row gap-8 wrap">{todo.map((p) => <Button key={p} small kind="secondary" icon="plus" busy={busy === p} onClick={() => go(p)}>Start {PACKAGES[p].label} set-up</Button>)}</span>;
}
