// My day on the server: Adelin's routine, daily log, to-do list and trading journal. Shared by /api/admin-me
// (the admin page) and /api/mcp (the Claude connector). Private to one person: MY_DAY_EMAILS, or the first
// email in GAINORA_ADMIN_EMAILS.
import { randomUUID } from 'node:crypto';
import { db, env, HttpError, insert, type AuthedUser } from './core';
import { requireGainora, type AdminState } from './admin';
import { gainoraEmails } from './sites';
import { ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import { dueFollowUps, type Prospect } from '../../shared/admin/sales';
import {
  applyDayPatch, buildPlan, cleanBlock, cleanSettings, cleanTask, DEFAULT_ROUTINE, dayFrom, type DayPatch, isDate, type MeDay, type MeSettings, type MeTask,
  nextDue, type Plan, type RoutineBlock, settingsFrom, weeksOf, streakOf, energyWarning, type WeekSummary, type ClientTaskDue, type DayRow, recentLevels,
} from '../../shared/admin/me';

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };
const id = (v: unknown) => { const s = String(v || ''); if (!/^[0-9a-f-]{36}$/i.test(s)) throw new HttpError(400, 'Unknown item.'); return s; };
/** Turns a validation message from the shared cleaners into a 400 the page or Claude can show as it is. */
const clean = <T,>(fn: () => T): T => { try { return fn(); } catch (e: any) { throw new HttpError(400, e?.message || 'That isn’t valid.'); } };

export const meEmails = () => (env('MY_DAY_EMAILS') ? env('MY_DAY_EMAILS').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) : gainoraEmails().slice(0, 1));

/** On Gainora's team and the owner of My day. */
export async function requireMe(req: Request): Promise<AuthedUser> {
  const user = await requireGainora(req);
  if (!meEmails().includes(user.email)) throw new HttpError(403, 'My day is private to Adelin. (Set MY_DAY_EMAILS in Netlify to change who sees it.)');
  return user;
}

/* ---------- Settings and routine ---------- */

export async function getSettings(): Promise<MeSettings> {
  const row = (await db<any[]>('me_settings?select=data&id=eq.1'))[0];
  return settingsFrom(row?.data);
}

export async function saveSettings(patch: any): Promise<MeSettings> {
  const next = cleanSettings(patch ?? {}, await getSettings());
  await db('me_settings?on_conflict=id', { method: 'POST', body: { id: 1, data: next, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  return next;
}

const toBlock = (r: any): RoutineBlock => ({ id: r.id, start: r.start, finish: r.finish ?? null, title: r.title, detail: r.detail ?? '', days: (r.days ?? []).map(Number), kind: r.kind, sort: r.sort ?? 0, active: r.active !== false });

/** The routine. The first time, it's filled in with the routine agreed on 11 Nov 2026. */
export async function getRoutine(settings?: MeSettings): Promise<RoutineBlock[]> {
  const rows = await db<any[]>('me_routine?select=*&order=start.asc&limit=200');
  if (rows.length) return rows.map(toBlock);
  const s = settings ?? await getSettings();
  if (s.seeded) return [];
  const now = new Date().toISOString();
  const made = await insert<any>('me_routine', DEFAULT_ROUTINE.map((b) => ({ ...b, id: randomUUID(), active: true, created_at: now, updated_at: now })));
  await saveSettings({ seeded: true });
  return made.map(toBlock);
}

export async function saveBlock(input: any): Promise<RoutineBlock> {
  const now = new Date().toISOString();
  if (input?.id) {
    const was = (await db<any[]>(`me_routine?select=*&id=eq.${id(input.id)}`))[0];
    if (!was) throw new HttpError(404, 'That block no longer exists.');
    const row = clean(() => cleanBlock(input, toBlock(was)));
    const [saved] = await db<any[]>(`me_routine?id=eq.${was.id}`, { method: 'PATCH', body: { ...row, updated_at: now }, prefer: 'return=representation' });
    return toBlock(saved);
  }
  const row = clean(() => cleanBlock(input ?? {}));
  const [saved] = await insert<any>('me_routine', { ...row, id: randomUUID(), created_at: now, updated_at: now });
  await saveSettings({ seeded: true });
  return toBlock(saved);
}

export async function deleteBlock(blockId: string) { await db(`me_routine?id=eq.${id(blockId)}`, { method: 'DELETE' }); }

/** Finds a block by id, or by (part of) its title, as Claude refers to them. */
export function findBlock(blocks: RoutineBlock[], ref: string): RoutineBlock {
  const q = String(ref || '').trim().toLowerCase();
  const exact = blocks.find((b) => b.id === q || b.title.toLowerCase() === q);
  if (exact) return exact;
  const hits = blocks.filter((b) => b.title.toLowerCase().includes(q) || b.start === q);
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new HttpError(404, `No routine block matches “${ref}”.`);
  throw new HttpError(409, `More than one block matches “${ref}”: ${hits.slice(0, 6).map((h) => `${h.start} ${h.title}`).join('; ')}.`);
}

/* ---------- Days ---------- */

export async function getDays(from: string, to: string): Promise<Map<string, MeDay>> {
  const rows = await db<any[]>(`me_days?select=*&date=gte.${from}&date=lte.${to}&limit=1000`);
  return new Map(rows.map((r) => [String(r.date).slice(0, 10), dayFrom(r, String(r.date).slice(0, 10))]));
}

export async function saveDay(date: string, patch: DayPatch): Promise<MeDay> {
  if (!isDate(date)) throw new HttpError(400, 'Which date? Use YYYY-MM-DD.');
  if (date > addDays(ukToday(), 7)) throw new HttpError(400, 'That’s more than a week ahead.');
  const was = (await db<any[]>(`me_days?select=*&date=eq.${date}`))[0];
  const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const next = applyDayPatch(dayFrom(was, date), patch ?? {}, stamp);
  const { updated_at: _u, ...row } = next;
  const [saved] = await db<any[]>('me_days?on_conflict=date', { method: 'POST', body: { ...row, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' });
  return dayFrom(saved ?? row, date);
}

/* ---------- Personal tasks ---------- */

export async function getTasks(includeDone = false): Promise<MeTask[]> {
  return db<MeTask[]>(`me_tasks?select=*${includeDone ? '' : '&done=eq.false'}&order=due_on.asc.nullslast&limit=2000`);
}

/** Adds or changes a task. Ticking a repeating task moves it to its next date instead of closing it. */
export async function saveTask(input: any, by: string): Promise<MeTask & { next_due?: string | null }> {
  const now = new Date().toISOString();
  if (input?.id) {
    const was = (await db<MeTask[]>(`me_tasks?select=*&id=eq.${id(input.id)}`))[0];
    if (!was) throw new HttpError(404, 'That task no longer exists.');
    const fields = clean(() => cleanTask(input, was));
    const body: Record<string, unknown> = { ...fields, updated_at: now };
    let next: string | null | undefined;
    if (input.done !== undefined) {
      if (input.done && fields.repeat !== 'none') {
        next = nextDue(fields.due_on ?? ukToday(), fields.repeat);
        Object.assign(body, { due_on: next, done: false, done_at: null, last_done_at: now });
      } else Object.assign(body, { done: !!input.done, done_at: input.done ? now : null, ...(input.done ? { last_done_at: now } : {}) });
    }
    const [saved] = await db<MeTask[]>(`me_tasks?id=eq.${was.id}`, { method: 'PATCH', body, prefer: 'return=representation' });
    return next !== undefined ? { ...saved, next_due: next } : saved;
  }
  const fields = clean(() => cleanTask(input ?? {}));
  const [saved] = await insert<MeTask>('me_tasks', { ...fields, id: randomUUID(), done: false, done_at: null, last_done_at: null, created_by: String(by).slice(0, 80), created_at: now, updated_at: now });
  return saved;
}

export async function deleteTask(taskId: string) { await db(`me_tasks?id=eq.${id(taskId)}`, { method: 'DELETE' }); }

/** Finds a personal task by id or by (part of) its title. */
export function findTask(tasks: MeTask[], ref: string): MeTask {
  const q = String(ref || '').trim().toLowerCase();
  const exact = tasks.find((t) => t.id === q || t.title.toLowerCase() === q);
  if (exact) return exact;
  const hits = tasks.filter((t) => t.title.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new HttpError(404, `No task matches “${ref}”.`);
  throw new HttpError(409, `More than one task matches “${ref}”: ${hits.slice(0, 6).map((h) => h.title).join('; ')}.`);
}

/* ---------- The day as a whole ---------- */

/** Client work due by `date` that Gainora does, from the admin's state (with steps the apps ticked already done). */
function clientTasksDue(s: AdminState | null, date: string): ClientTaskDue[] {
  if (!s) return [];
  return s.tasks.filter((t) => t.status !== 'done' && t.who !== 'client' && t.due_on && t.due_on <= date)
    .sort((a, b) => a.due_on!.localeCompare(b.due_on!)).slice(0, 30)
    .map((t) => ({ id: t.id, client: t.client, email: t.email, title: t.title, due_on: t.due_on }));
}

/** Everything for one day. History is read back far enough to count the streak. */
export async function plan(date: string, state: AdminState | null): Promise<Plan> {
  const today = ukToday();
  if (!isDate(date)) throw new HttpError(400, 'Which date? Use YYYY-MM-DD.');
  const settings = await getSettings();
  const from = addDays(date < today ? date : today, -120);
  const [routine, days, tasks, prospects] = await Promise.all([
    getRoutine(settings), getDays(from, date > today ? date : today), getTasks(false),
    safe(db<Prospect[]>('prospects?select=id,next_on,stage,unsubscribed_at&next_on=not.is.null&limit=5000'), []),
  ]);
  return buildPlan({ date, today, settings, routine, days, tasks, followUpsDue: dueFollowUps(prospects, date).length, clientTasks: clientTasksDue(state, date) });
}

export interface WeekView { weeks: WeekSummary[]; streak: number; energyWarning: string | null; days: DayRow[] }

/** The last few weeks, the last two weeks day by day, the streak and the energy warning. */
export async function weeks(n = 8): Promise<WeekView> {
  const today = ukToday();
  const settings = await getSettings();
  const [routine, days] = await Promise.all([getRoutine(settings), getDays(addDays(today, -Math.max(120, n * 7 + 7)), today)]);
  const list = weeksOf(days, routine, settings, today, Math.max(1, Math.min(26, n)));
  return { weeks: list, streak: streakOf(days, routine, settings, today), energyWarning: energyWarning(list), days: recentLevels(days, routine, settings, today, 14) };
}
