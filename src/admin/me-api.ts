// My day's calls to /api/admin-me, and a demo that keeps a sample week in memory.
import { callFunction } from '../lib/live';
import { ukToday } from '../../shared/admin/board';
import { addDays } from '../../shared/admin/templates';
import {
  applyDayPatch, buildPlan, cleanBlock, cleanSettings, cleanTask, DEFAULT_ROUTINE, DEFAULT_SETTINGS, type DayPatch, type DayRow, emptyDay, energyWarning,
  type MeDay, type MeSettings, type MeTask, nextDue, type Plan, recentLevels, type RoutineBlock, streakOf, weeksOf, type WeekSummary,
} from '../../shared/admin/me';

declare const __DEMO__: boolean;

export interface WeekView { weeks: WeekSummary[]; streak: number; energyWarning: string | null; days: DayRow[] }
export interface MeApi {
  today(date: string): Promise<Plan>;
  saveDay(date: string, patch: DayPatch): Promise<Plan>;
  tasks(includeDone?: boolean): Promise<MeTask[]>;
  saveTask(task: Partial<MeTask> & { done?: boolean }): Promise<MeTask & { next_due?: string | null }>;
  deleteTask(id: string): Promise<void>;
  routine(): Promise<{ routine: RoutineBlock[]; settings: MeSettings }>;
  saveBlock(block: Partial<RoutineBlock>): Promise<RoutineBlock>;
  deleteBlock(id: string): Promise<void>;
  saveSettings(settings: Partial<MeSettings>): Promise<MeSettings>;
  week(weeks?: number): Promise<WeekView>;
}

const call = <T,>(body: Record<string, unknown>, doing: string) => callFunction<T>('admin-me', body, { doing });

function liveMe(): MeApi {
  return {
    today: async (date) => (await call<{ plan: Plan }>({ op: 'today', date }, 'loading your day')).plan,
    saveDay: async (date, patch) => (await call<{ plan: Plan }>({ op: 'day-save', date, patch }, 'saving your day')).plan,
    tasks: async (includeDone) => (await call<{ tasks: MeTask[] }>({ op: 'tasks', includeDone }, 'loading your to-do list')).tasks,
    saveTask: async (task) => (await call<{ task: MeTask & { next_due?: string | null } }>({ op: 'task-save', task }, 'saving the task')).task,
    deleteTask: async (id) => { await call({ op: 'task-delete', id }, 'deleting the task'); },
    routine: () => call({ op: 'routine' }, 'loading your routine'),
    saveBlock: async (block) => (await call<{ block: RoutineBlock }>({ op: 'block-save', block }, 'saving the block')).block,
    deleteBlock: async (id) => { await call({ op: 'block-delete', id }, 'deleting the block'); },
    saveSettings: async (settings) => (await call<{ settings: MeSettings }>({ op: 'settings-save', settings }, 'saving your settings')).settings,
    week: (weeks) => call({ op: 'week', weeks }, 'loading your weeks'),
  };
}

/* ---------- Demo: the default routine and a sample fortnight ---------- */

function demoMe(): MeApi {
  const today = ukToday();
  let n = 0;
  const uid = () => `demo-${++n}`;
  let settings: MeSettings = { ...DEFAULT_SETTINGS, gymAnchor: addDays(today, -2), gymMinutes: 90, seeded: true, tradingRules: 'No trades on red-folder news days.\nStop at 15:30, win or lose.\nOne setup at a time.' };
  let routine: RoutineBlock[] = DEFAULT_ROUTINE.map((b) => ({ ...b, id: uid(), active: true }));
  const days = new Map<string, MeDay>();
  const tickAll = (date: string, except: string[] = []) => Object.fromEntries(routine.filter((b) => b.days.includes(((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1) && !except.includes(b.kind)).map((b) => [b.id, true]));
  for (let i = 1; i <= 9; i++) {
    const d = addDays(today, -i);
    const wd = ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const weekend = wd >= 6;
    days.set(d, { ...emptyDay(d), ticks: tickAll(d, i % 3 === 0 ? ['calls', 'review'] : []), energy: 6 + (i % 3), contacts: weekend ? null : 12 + ((i * 7) % 14), conversations: weekend ? null : 2 + (i % 3), sales_chats: weekend ? null : i % 2, proposals: weekend ? null : i % 4 === 0 ? 1 : 0, new_clients: 0, gym: { done: true, minutes: 70 + (i % 3) * 5, session: '', note: '' }, must_dos: weekend ? [] : ['Clear follow-ups', 'Walk into 8 clinics', 'Mirela’s weekly brief'] });
  }
  let tasks: MeTask[] = [
    { title: 'Decide set-up fees and contract length', category: 'business', due_on: today, repeat: 'none', notes: 'See Decisions in the schedule doc.' },
    { title: 'Print 30 one-page notes', category: 'business', due_on: addDays(today, 1), repeat: 'none', notes: '' },
    { title: 'Weekly trading review', category: 'trading', due_on: addDays(today, 2), repeat: 'weekly', notes: '' },
    { title: 'Buy new hand wraps', category: 'gym', due_on: null, repeat: 'none', notes: '' },
  ].map((t) => ({ ...t, id: uid(), notes: t.notes, done: false, done_at: null, last_done_at: null, created_by: 'Adelin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) as MeTask[];
  const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const make = (date: string): Plan => buildPlan({
    date, today, settings, routine, days, tasks, followUpsDue: 3,
    clientTasks: [{ id: 'ct1', client: 'Willow Aesthetics', email: 'demo@clinic.example', title: 'First weekly brief delivered', due_on: today }],
  });
  const fail = (e: any) => { throw Object.assign(new Error(e?.message || 'That isn’t valid.'), { status: 400 }); };
  return {
    async today(date) { await wait(); return make(date); },
    async saveDay(date, patch) { await wait(150); days.set(date, applyDayPatch(days.get(date) ?? emptyDay(date), patch, new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))); return make(date); },
    async tasks(includeDone) { await wait(); return tasks.filter((t) => includeDone || !t.done); },
    async saveTask(input) {
      await wait(150);
      const now = new Date().toISOString();
      if (input.id) {
        const i = tasks.findIndex((t) => t.id === input.id);
        let fields; try { fields = cleanTask(input, tasks[i]); } catch (e) { return fail(e); }
        let t: MeTask & { next_due?: string | null } = { ...tasks[i], ...fields, updated_at: now };
        if (input.done !== undefined) {
          if (input.done && t.repeat !== 'none') { const next = nextDue(t.due_on ?? today, t.repeat); t = { ...t, due_on: next, done: false, done_at: null, last_done_at: now, next_due: next }; }
          else t = { ...t, done: !!input.done, done_at: input.done ? now : null };
        }
        tasks[i] = t; return t;
      }
      let fields; try { fields = cleanTask(input); } catch (e) { return fail(e); }
      const t: MeTask = { ...fields, id: uid(), done: false, done_at: null, last_done_at: null, created_by: 'Adelin', created_at: now, updated_at: now };
      tasks = [...tasks, t]; return t;
    },
    async deleteTask(id) { await wait(150); tasks = tasks.filter((t) => t.id !== id); },
    async routine() { await wait(); return { routine, settings }; },
    async saveBlock(input) {
      await wait(150);
      const was = routine.find((b) => b.id === input.id);
      let row; try { row = cleanBlock(input, was); } catch (e) { return fail(e); }
      const b: RoutineBlock = { ...row, id: was?.id ?? uid() };
      routine = was ? routine.map((x) => (x.id === b.id ? b : x)) : [...routine, b];
      return b;
    },
    async deleteBlock(id) { await wait(150); routine = routine.filter((b) => b.id !== id); },
    async saveSettings(patch) { await wait(150); settings = cleanSettings(patch, settings); return settings; },
    async week(count = 8) {
      await wait();
      const weeks = weeksOf(days, routine, settings, today, count);
      return { weeks, streak: streakOf(days, routine, settings, today), energyWarning: energyWarning(weeks), days: recentLevels(days, routine, settings, today, 14) };
    },
  };
}

export const me: MeApi = typeof __DEMO__ !== 'undefined' && __DEMO__ ? demoMe() : liveMe();
