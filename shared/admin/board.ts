// Deadlines at a glance: what's overdue, due today, this week, next week and later.
import type { AdminTask } from './model';

export type Bucket = 'overdue' | 'today' | 'week' | 'next' | 'later' | 'undated' | 'done';
export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' }, { id: 'today', label: 'Today' }, { id: 'week', label: 'This week' },
  { id: 'next', label: 'Next week' }, { id: 'later', label: 'Later' }, { id: 'undated', label: 'No date' },
];

/** UK date for "today" (YYYY-MM-DD), so the board turns over at midnight in London. */
export const ukToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);

/** Monday of the week containing the date. */
function monday(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const plus = (isoDate: string, n: number) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function bucketOf(t: Pick<AdminTask, 'status' | 'due_on'>, today: string): Bucket {
  if (t.status === 'done') return 'done';
  if (!t.due_on) return 'undated';
  if (t.due_on < today) return 'overdue';
  if (t.due_on === today) return 'today';
  const thisMonday = monday(today);
  if (t.due_on < plus(thisMonday, 7)) return 'week';
  if (t.due_on < plus(thisMonday, 14)) return 'next';
  return 'later';
}

export function board<T extends AdminTask>(tasks: T[], today: string): Record<Bucket, T[]> {
  const out = { overdue: [], today: [], week: [], next: [], later: [], undated: [], done: [] } as Record<Bucket, T[]>;
  for (const t of tasks) out[bucketOf(t, today)].push(t);
  for (const k of Object.keys(out) as Bucket[]) out[k].sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.sort - b.sort);
  return out;
}

export function progress(tasks: Pick<AdminTask, 'status'>[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length };
}

/** "3 days late", "Due today", "Due Fri 14 Nov". */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return 'No date';
  const days = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} late`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${new Date(`${due}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}
