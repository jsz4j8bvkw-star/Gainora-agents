// My day: Adelin's own routine, targets, to-do list, notes and trading journal, inside the admin.
// Pure logic shared by the admin app (and its demo), the server and the Claude connector. Nothing here is about clients.
import { addDays } from './templates';

/* ---------- Shapes ---------- */

export type BlockKind = 'checkin' | 'gym' | 'meal' | 'followups' | 'sales' | 'calls' | 'trading' | 'client' | 'review' | 'sleep' | 'other';
export const BLOCK_KINDS: { id: BlockKind; label: string }[] = [
  { id: 'checkin', label: 'Check-in' }, { id: 'gym', label: 'Gym' }, { id: 'meal', label: 'Meal' }, { id: 'followups', label: 'Follow-ups' },
  { id: 'sales', label: 'Sales' }, { id: 'calls', label: 'Evening calls' }, { id: 'trading', label: 'Trading' }, { id: 'client', label: 'Client work' },
  { id: 'review', label: 'Review' }, { id: 'sleep', label: 'Sleep' }, { id: 'other', label: 'Other' },
];
const KIND_IDS = BLOCK_KINDS.map((k) => k.id);

/** One block of the repeating day. days: 1 = Monday … 7 = Sunday. */
export interface RoutineBlock { id: string; start: string; finish: string | null; title: string; detail: string; days: number[]; kind: BlockKind; sort: number; active: boolean }

export type TaskCategory = 'business' | 'trading' | 'gym' | 'personal';
export const TASK_CATEGORIES: { id: TaskCategory; label: string }[] = [
  { id: 'business', label: 'Business' }, { id: 'trading', label: 'Trading' }, { id: 'gym', label: 'Gym' }, { id: 'personal', label: 'Personal' },
];
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
export const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'none', label: 'Once' }, { id: 'daily', label: 'Every day' }, { id: 'weekdays', label: 'Every weekday' }, { id: 'weekly', label: 'Every week' }, { id: 'monthly', label: 'Every month' },
];
export interface MeTask {
  id: string; title: string; notes: string; due_on: string | null; category: TaskCategory; repeat: Repeat;
  done: boolean; done_at: string | null; last_done_at: string | null; created_by: string; created_at: string; updated_at: string;
}

export interface Gym { done: boolean; minutes: number | null; session: string; note: string }
export interface Trading { news_day: boolean | null; traded: boolean | null; setup: string; result: string; notes: string }
export interface MeDay {
  date: string; ticks: Record<string, boolean>; must_dos: string[]; notes: string; energy: number | null;
  contacts: number | null; conversations: number | null; sales_chats: number | null; proposals: number | null; new_clients: number | null;
  followups_cleared: boolean; gym: Gym; trading: Trading; updated_at: string | null;
}
export const SCORE_FIELDS = [
  { key: 'contacts', label: 'Contacts' }, { key: 'conversations', label: 'Owner conversations' }, { key: 'sales_chats', label: 'Sales chats' },
  { key: 'proposals', label: 'Proposals' }, { key: 'new_clients', label: 'New clients' },
] as const;
export type ScoreKey = typeof SCORE_FIELDS[number]['key'];

export interface MeSettings {
  /** The gym rotation, one session a day, repeating. */
  gymSplit: string[];
  /** A date on which the first session of the split was done; the rotation counts on from it. */
  gymAnchor: string;
  /** Usual session length in minutes, travel not included. Null until it's known. */
  gymMinutes: number | null;
  /** What ends every session. */
  finisher: string;
  minimum: { contacts: number };
  good: { contacts: number };
  weeklyContacts: number;
  tradingRules: string;
  /** Set once the default routine has been written, so an emptied routine stays empty. */
  seeded: boolean;
}

export const DEFAULT_SETTINGS: MeSettings = {
  gymSplit: ['Chest', 'Back', 'Shoulders and arms', 'Legs', 'Chest', 'Back', 'Shoulders'],
  gymAnchor: '2026-11-11',
  gymMinutes: 90,
  finisher: 'heavy bag',
  minimum: { contacts: 10 },
  good: { contacts: 20 },
  weeklyContacts: 100,
  tradingRules: '',
  seeded: false,
};

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
type NewBlock = Omit<RoutineBlock, 'id' | 'active'>;
/** The routine agreed on 11 Nov 2026: about 90 minutes in the gym with the bag, home by about 08:45. */
export const DEFAULT_ROUTINE: NewBlock[] = [
  { start: '05:30', finish: '06:15', title: 'Wake, coffee, morning check-in', detail: 'Write today’s three must-dos. No rushing.', days: EVERY_DAY, kind: 'checkin', sort: 0 },
  { start: '06:15', finish: '08:45', title: 'Gym', detail: 'Leave at 06:15. About 90 minutes: today’s session from the split, then the heavy bag. Home by about 08:45.', days: EVERY_DAY, kind: 'gym', sort: 1 },
  { start: '08:45', finish: '09:15', title: 'Shower and breakfast (meal 1 of 3)', detail: '', days: EVERY_DAY, kind: 'meal', sort: 2 },
  { start: '09:15', finish: '09:45', title: 'Clear every follow-up due', detail: 'Admin → Sales → Follow-ups. Before anything else.', days: WEEKDAYS, kind: 'followups', sort: 3 },
  { start: '09:45', finish: '10:00', title: 'Prep check on today’s clinics', detail: 'One problem written in each clinic’s note.', days: [2, 3, 4], kind: 'sales', sort: 4 },
  { start: '10:00', finish: '12:30', title: 'Walk-ins: 8 to 10 clinics', detail: 'Log each one in the admin straight after, with a next date.', days: [2, 3, 4], kind: 'sales', sort: 5 },
  { start: '09:45', finish: '12:30', title: 'Add 50 clinics, then phone and email outreach', detail: 'This week’s route. Claude can build the list.', days: [1], kind: 'sales', sort: 6 },
  { start: '09:45', finish: '12:30', title: 'Weekly client briefs, follow-up calls and proposals', detail: '', days: [5], kind: 'client', sort: 7 },
  { start: '12:30', finish: '13:30', title: 'Lunch (meal 2 of 3)', detail: 'Sales chats can be booked at 12:00 or straight after walk-ins.', days: EVERY_DAY, kind: 'meal', sort: 8 },
  { start: '13:30', finish: '14:30', title: 'Trading prep and analysis', detail: '', days: WEEKDAYS, kind: 'trading', sort: 9 },
  { start: '14:30', finish: '15:30', title: 'New York open', detail: 'Hard stop at 15:30. News day: watch only, no trades.', days: WEEKDAYS, kind: 'trading', sort: 10 },
  { start: '15:30', finish: '17:00', title: 'Client work (protected)', detail: 'No sales in this block.', days: WEEKDAYS, kind: 'client', sort: 11 },
  { start: '16:00', finish: '17:00', title: 'Weekly review and playbook notes', detail: 'Fill in the week, energy out of 10, what worked, what changes.', days: [5], kind: 'review', sort: 12 },
  { start: '17:00', finish: '17:30', title: 'Close the day: scoreboard and evening check-in', detail: 'Numbers in, tomorrow’s list ready.', days: WEEKDAYS, kind: 'checkin', sort: 13 },
  { start: '18:00', finish: '18:30', title: 'Dinner (meal 3 of 3)', detail: '', days: EVERY_DAY, kind: 'meal', sort: 14 },
  { start: '18:30', finish: '19:30', title: 'Ring tomorrow’s clinics after closing', detail: 'Note who answers and who doesn’t.', days: [1, 2, 3], kind: 'calls', sort: 15 },
  { start: '21:30', finish: null, title: 'In bed', detail: 'Non-negotiable.', days: EVERY_DAY, kind: 'sleep', sort: 16 },
];

/* ---------- Dates ---------- */

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** 1 = Monday … 7 = Sunday. */
export const weekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const isWeekend = (date: string) => weekday(date) >= 6;
export const mondayOf = (date: string) => addDays(date, 1 - weekday(date));
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export const longDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "Every day", "Mon to Fri", "Tue to Thu", "Sat and Sun", "Mon, Wed". */
export function daysLabel(days: number[]): string {
  const d = [...new Set(days)].filter((x) => x >= 1 && x <= 7).sort();
  if (!d.length) return 'No days';
  if (d.length === 7) return 'Every day';
  const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (run && d.length >= 3) return `${DAY_NAMES[d[0] - 1]} to ${DAY_NAMES[d[d.length - 1] - 1]}`;
  if (d.length === 2) return `${DAY_NAMES[d[0] - 1]} and ${DAY_NAMES[d[1] - 1]}`;
  return d.map((x) => DAY_NAMES[x - 1]).join(', ');
}

/** The blocks on a date, in time order. */
export function blocksFor(blocks: RoutineBlock[], date: string): RoutineBlock[] {
  const wd = weekday(date);
  return blocks.filter((b) => b.active && b.days.includes(wd)).sort((a, b) => a.start.localeCompare(b.start) || a.sort - b.sort);
}

/** Today's gym session from the rotation. */
export function gymFor(s: Pick<MeSettings, 'gymSplit' | 'gymAnchor' | 'finisher'>, date: string): { index: number; session: string; label: string } {
  const split = s.gymSplit.length ? s.gymSplit : DEFAULT_SETTINGS.gymSplit;
  const n = split.length;
  const index = (((daysBetween(s.gymAnchor, date)) % n) + n) % n;
  const session = split[index];
  return { index, session, label: s.finisher ? `${session}, then ${s.finisher}` : session };
}

/** The anchor that makes `date` fall on session number `index` of the split. */
export const anchorFor = (split: string[], date: string, index: number) => addDays(date, -(((index % split.length) + split.length) % split.length));

/** Next time a repeating task is due, after the one just done. */
export function nextDue(from: string, repeat: Repeat): string | null {
  if (repeat === 'daily') return addDays(from, 1);
  if (repeat === 'weekly') return addDays(from, 7);
  if (repeat === 'weekdays') { let d = addDays(from, 1); while (isWeekend(d)) d = addDays(d, 1); return d; }
  if (repeat === 'monthly') {
    const [y, m, day] = from.split('-').map(Number);
    const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  }
  return null;
}

/* ---------- Cleaning what comes in (from the page or from Claude) ---------- */

const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const count = (v: unknown): number | null => (v === null || v === '' || v === undefined ? null : Number.isFinite(Number(v)) ? Math.max(0, Math.min(10_000, Math.round(Number(v)))) : null);
const yesNo = (v: unknown): boolean | null => (v === true || v === 'yes' || v === 'true' ? true : v === false || v === 'no' || v === 'false' ? false : null);

export function emptyDay(date: string): MeDay {
  return {
    date, ticks: {}, must_dos: [], notes: '', energy: null, contacts: null, conversations: null, sales_chats: null, proposals: null, new_clients: null,
    followups_cleared: false, gym: { done: false, minutes: null, session: '', note: '' }, trading: { news_day: null, traded: null, setup: '', result: '', notes: '' }, updated_at: null,
  };
}

/** A stored row with every field filled in, so old or partial rows read the same as new ones. */
export function dayFrom(row: any, date: string): MeDay {
  const e = emptyDay(date);
  if (!row) return e;
  return {
    ...e, ...row, date,
    ticks: row.ticks && typeof row.ticks === 'object' ? row.ticks : {},
    must_dos: Array.isArray(row.must_dos) ? row.must_dos.map(String) : [],
    notes: String(row.notes ?? ''),
    gym: { ...e.gym, ...(row.gym ?? {}) }, trading: { ...e.trading, ...(row.trading ?? {}) },
  };
}

export type DayPatch = Partial<Omit<MeDay, 'date' | 'gym' | 'trading' | 'updated_at'>> & { gym?: Partial<Gym>; trading?: Partial<Trading>; append_note?: string };

/** Applies a change to a day. Ticks, gym and trading merge; everything else replaces; append_note adds a line. */
export function applyDayPatch(day: MeDay, patch: DayPatch, stamp = ''): MeDay {
  const next: MeDay = { ...day, ticks: { ...day.ticks }, gym: { ...day.gym }, trading: { ...day.trading } };
  if (patch.ticks && typeof patch.ticks === 'object') for (const [k, v] of Object.entries(patch.ticks).slice(0, 60)) if (/^[\w-]{1,64}$/.test(k)) { if (v) next.ticks[k] = true; else delete next.ticks[k]; }
  if (patch.must_dos !== undefined) next.must_dos = (Array.isArray(patch.must_dos) ? patch.must_dos : []).map((x) => text(x, 200)).filter(Boolean).slice(0, 3);
  if (patch.notes !== undefined) next.notes = text(patch.notes, 8000);
  if (patch.append_note) next.notes = text(`${next.notes ? `${next.notes}\n` : ''}${stamp ? `${stamp} ` : ''}${text(patch.append_note, 2000)}`, 8000);
  if (patch.energy !== undefined) { const n = count(patch.energy); next.energy = n === null ? null : Math.max(1, Math.min(10, n)); }
  for (const f of SCORE_FIELDS) if ((patch as any)[f.key] !== undefined) (next as any)[f.key] = count((patch as any)[f.key]);
  if (patch.followups_cleared !== undefined) next.followups_cleared = !!patch.followups_cleared;
  if (patch.gym) {
    const g = patch.gym;
    if (g.done !== undefined) next.gym.done = !!g.done;
    if (g.minutes !== undefined) { const n = count(g.minutes); next.gym.minutes = n === null ? null : Math.min(n, 600); }
    if (g.session !== undefined) next.gym.session = text(g.session, 80);
    if (g.note !== undefined) next.gym.note = text(g.note, 1000);
  }
  if (patch.trading) {
    const t = patch.trading;
    if (t.news_day !== undefined) next.trading.news_day = yesNo(t.news_day);
    if (t.traded !== undefined) next.trading.traded = yesNo(t.traded);
    if (t.setup !== undefined) next.trading.setup = text(t.setup, 1000);
    if (t.result !== undefined) next.trading.result = text(t.result, 1000);
    if (t.notes !== undefined) next.trading.notes = text(t.notes, 4000);
  }
  return next;
}

export function cleanBlock(input: any, existing?: RoutineBlock): Omit<RoutineBlock, 'id'> {
  const base: Omit<RoutineBlock, 'id'> = existing ? { ...existing } : { start: '', finish: null, title: '', detail: '', days: WEEKDAYS, kind: 'other', sort: 50, active: true };
  if (input.start !== undefined) base.start = String(input.start);
  if (input.finish !== undefined) base.finish = input.finish === null || input.finish === '' ? null : String(input.finish);
  if (input.title !== undefined) base.title = text(input.title, 160);
  if (input.detail !== undefined) base.detail = text(input.detail, 600);
  if (input.days !== undefined) base.days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number).filter((d: number) => d >= 1 && d <= 7))].sort() as number[];
  if (input.kind !== undefined) base.kind = KIND_IDS.includes(input.kind) ? input.kind : 'other';
  if (input.sort !== undefined && Number.isFinite(Number(input.sort))) base.sort = Math.round(Number(input.sort));
  if (input.active !== undefined) base.active = !!input.active;
  if (!isTime(base.start)) throw new Error('Give the block a start time like 09:30.');
  if (base.finish !== null && !isTime(base.finish)) throw new Error('The end time should look like 12:30, or be left empty.');
  if (base.finish !== null && base.finish <= base.start) throw new Error('The end time has to be after the start time.');
  if (!base.title) throw new Error('Give the block a name.');
  if (!base.days.length) throw new Error('Pick at least one day.');
  return base;
}

export function cleanTask(input: any, existing?: MeTask): Pick<MeTask, 'title' | 'notes' | 'due_on' | 'category' | 'repeat'> {
  const base = existing ? { title: existing.title, notes: existing.notes, due_on: existing.due_on, category: existing.category, repeat: existing.repeat } : { title: '', notes: '', due_on: null as string | null, category: 'business' as TaskCategory, repeat: 'none' as Repeat };
  if (input.title !== undefined) base.title = text(input.title, 300);
  if (input.notes !== undefined) base.notes = text(input.notes, 4000);
  if (input.due_on !== undefined) base.due_on = isDate(input.due_on) ? input.due_on : null;
  if (input.category !== undefined) base.category = TASK_CATEGORIES.some((c) => c.id === input.category) ? input.category : 'business';
  if (input.repeat !== undefined) base.repeat = REPEATS.some((r) => r.id === input.repeat) ? input.repeat : 'none';
  if (!base.title) throw new Error('Give the task a title.');
  return base;
}

export function cleanSettings(input: any, base: MeSettings): MeSettings {
  const s: MeSettings = { ...base, minimum: { ...base.minimum }, good: { ...base.good } };
  if (Array.isArray(input.gymSplit)) { const split = input.gymSplit.map((x: unknown) => text(x, 60)).filter(Boolean).slice(0, 14); if (split.length) s.gymSplit = split; }
  if (isDate(input.gymAnchor)) s.gymAnchor = input.gymAnchor;
  if (input.gymMinutes !== undefined) { const n = count(input.gymMinutes); s.gymMinutes = n === null || n === 0 ? null : Math.min(n, 600); }
  if (input.finisher !== undefined) s.finisher = text(input.finisher, 60);
  const pos = (v: unknown, fallback: number) => { const n = count(v); return n === null || n < 1 ? fallback : n; };
  if (input.minimum?.contacts !== undefined) s.minimum.contacts = pos(input.minimum.contacts, s.minimum.contacts);
  if (input.good?.contacts !== undefined) s.good.contacts = pos(input.good.contacts, s.good.contacts);
  if (s.good.contacts < s.minimum.contacts) s.good.contacts = s.minimum.contacts;
  if (input.weeklyContacts !== undefined) s.weeklyContacts = pos(input.weeklyContacts, s.weeklyContacts);
  if (input.tradingRules !== undefined) s.tradingRules = text(input.tradingRules, 8000);
  if (input.seeded !== undefined) s.seeded = !!input.seeded;
  return s;
}
export const settingsFrom = (data: any): MeSettings => cleanSettings(data && typeof data === 'object' ? data : {}, DEFAULT_SETTINGS);

/* ---------- Minimum day, good day, streak ---------- */

export type Level = 'good' | 'minimum' | 'open' | 'missed';
export const LEVEL_LABEL: Record<Level, string> = { good: 'Good day', minimum: 'Minimum done', open: 'Not there yet', missed: 'Missed' };
export interface Check { id: string; label: string; ok: boolean }

const tickedKind = (day: MeDay, blocks: RoutineBlock[], kind: BlockKind) => blocks.some((b) => b.kind === kind && day.ticks[b.id]);

/**
 * Minimum day (weekdays): follow-ups cleared, the minimum number of contacts, gym done, in bed on time.
 * Weekends: gym and bed. A good day is the minimum plus the good number of contacts and every block ticked.
 * A minimum day keeps the streak alive.
 */
export function levelOf(day: MeDay, dayBlocks: RoutineBlock[], s: MeSettings, today: string): { level: Level; minimum: Check[]; good: Check[] } {
  const weekend = isWeekend(day.date);
  const contacts = day.contacts ?? 0;
  const gym: Check = { id: 'gym', label: 'Gym done', ok: day.gym.done || tickedKind(day, dayBlocks, 'gym') };
  const bed: Check = { id: 'bed', label: 'In bed on time', ok: tickedKind(day, dayBlocks, 'sleep') };
  const minimum: Check[] = weekend ? [gym, bed] : [
    { id: 'followups', label: 'Follow-ups cleared', ok: day.followups_cleared || tickedKind(day, dayBlocks, 'followups') },
    { id: 'contacts', label: `${s.minimum.contacts}+ contacts`, ok: contacts >= s.minimum.contacts },
    gym, bed,
  ];
  const ticked = dayBlocks.filter((b) => day.ticks[b.id]).length;
  const good: Check[] = [
    ...(weekend ? [] : [{ id: 'contacts-good', label: `${s.good.contacts}+ contacts`, ok: contacts >= s.good.contacts }]),
    { id: 'blocks', label: `Every block ticked (${ticked} of ${dayBlocks.length})`, ok: dayBlocks.length > 0 && ticked === dayBlocks.length },
  ];
  const min = minimum.every((c) => c.ok);
  const level: Level = min ? (good.every((c) => c.ok) ? 'good' : 'minimum') : day.date < today ? 'missed' : 'open';
  return { level, minimum, good };
}

/** Days in a row at minimum or better. Today counts once it's reached; until then the streak runs to yesterday. */
export function streakOf(days: Map<string, MeDay>, blocks: RoutineBlock[], s: MeSettings, today: string, max = 400): number {
  const ok = (date: string) => { const l = levelOf(days.get(date) ?? emptyDay(date), blocksFor(blocks, date), s, today).level; return l === 'good' || l === 'minimum'; };
  let n = 0;
  let d = ok(today) ? today : addDays(today, -1);
  while (n < max && ok(d)) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- The week ---------- */

export interface WeekSummary {
  week: string; contacts: number; conversations: number; sales_chats: number; proposals: number; new_clients: number;
  contactsTarget: number; energyAvg: number | null; energyDays: number; minimumDays: number; goodDays: number; daysLogged: number;
}

export function weekSummary(days: Map<string, MeDay>, monday: string, blocks: RoutineBlock[], s: MeSettings, today: string): WeekSummary {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d <= today);
  const rows = dates.map((d) => days.get(d)).filter(Boolean) as MeDay[];
  const sum = (k: ScoreKey) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const energies = rows.map((r) => r.energy).filter((e): e is number => typeof e === 'number');
  const levels = dates.map((d) => levelOf(days.get(d) ?? emptyDay(d), blocksFor(blocks, d), s, today).level);
  return {
    week: monday, contacts: sum('contacts'), conversations: sum('conversations'), sales_chats: sum('sales_chats'), proposals: sum('proposals'), new_clients: sum('new_clients'),
    contactsTarget: s.weeklyContacts, energyAvg: energies.length ? Math.round((energies.reduce((a, e) => a + e, 0) / energies.length) * 10) / 10 : null,
    energyDays: energies.length, minimumDays: levels.filter((l) => l === 'minimum' || l === 'good').length, goodDays: levels.filter((l) => l === 'good').length, daysLogged: rows.length,
  };
}

/** The last `n` weeks, newest first. */
export function weeksOf(days: Map<string, MeDay>, blocks: RoutineBlock[], s: MeSettings, today: string, n = 8): WeekSummary[] {
  const m = mondayOf(today);
  return Array.from({ length: n }, (_, i) => weekSummary(days, addDays(m, -7 * i), blocks, s, today));
}

/** A warning when energy has averaged under 6 for two weeks in a row (weeks with at least three scores). */
export function energyWarning(weeks: WeekSummary[]): string | null {
  const scored = weeks.filter((w) => w.energyDays >= 3 && w.energyAvg !== null);
  for (let i = 0; i + 1 < scored.length; i++) {
    const [a, b] = [scored[i], scored[i + 1]];
    if (daysBetween(b.week, a.week) !== 7) continue;
    if (a.energyAvg! < 6 && b.energyAvg! < 6) return `Energy has averaged under 6 for two weeks running (${b.energyAvg} then ${a.energyAvg}). Cut back before it turns into burnout: keep the minimum day, drop the extras, protect 21:30 bed.`;
    return null;
  }
  return null;
}

/* ---------- The whole day, as the page and Claude see it ---------- */

export interface ClientTaskDue { id: string; client: string; email: string; title: string; due_on: string | null }
export interface Plan {
  date: string; today: string; isToday: boolean; dayName: string; weekday: number;
  blocks: (RoutineBlock & { ticked: boolean })[];
  gym: { session: string; label: string; index: number; done: boolean; minutes: number | null; usualMinutes: number | null };
  day: MeDay;
  status: { level: Level; label: string; minimum: Check[]; good: Check[] };
  streak: number;
  followUpsDue: number;
  clientTasks: ClientTaskDue[];
  tasks: { due: MeTask[]; undated: number; open: number };
  week: WeekSummary; lastWeek: WeekSummary;
  energyWarning: string | null;
  settings: MeSettings;
}

export function buildPlan(input: {
  date: string; today: string; settings: MeSettings; routine: RoutineBlock[]; days: Map<string, MeDay>; tasks: MeTask[];
  followUpsDue: number; clientTasks: ClientTaskDue[];
}): Plan {
  const { date, today, settings: s, routine, days } = input;
  const day = days.get(date) ?? emptyDay(date);
  const dayBlocks = blocksFor(routine, date);
  const gym = gymFor(s, date);
  const st = levelOf(day, dayBlocks, s, today);
  const open = input.tasks.filter((t) => !t.done);
  const weeks = weeksOf(days, routine, s, today, 4);
  const thisWeek = weekSummary(days, mondayOf(date), routine, s, today);
  return {
    date, today, isToday: date === today, dayName: longDay(date), weekday: weekday(date),
    blocks: dayBlocks.map((b) => ({ ...b, ticked: !!day.ticks[b.id] })),
    gym: { session: day.gym.session || gym.session, label: day.gym.session ? `${day.gym.session}${s.finisher ? `, then ${s.finisher}` : ''}` : gym.label, index: gym.index, done: st.minimum.find((c) => c.id === 'gym')!.ok, minutes: day.gym.minutes, usualMinutes: s.gymMinutes },
    day, status: { ...st, label: LEVEL_LABEL[st.level] },
    streak: streakOf(days, routine, s, today),
    followUpsDue: input.followUpsDue,
    clientTasks: input.clientTasks,
    tasks: { due: open.filter((t) => t.due_on && t.due_on <= date).sort((a, b) => a.due_on!.localeCompare(b.due_on!)), undated: open.filter((t) => !t.due_on).length, open: open.length },
    week: thisWeek, lastWeek: weekSummary(days, addDays(mondayOf(date), -7), routine, s, today),
    energyWarning: energyWarning(weeks),
    settings: s,
  };
}

export interface DayRow { date: string; level: Level; label: string; contacts: number | null; energy: number | null; gym: boolean }
/** The last `n` days with their level, newest first. */
export function recentLevels(days: Map<string, MeDay>, routine: RoutineBlock[], s: MeSettings, today: string, n = 14): DayRow[] {
  return Array.from({ length: n }, (_, i) => addDays(today, -i)).map((d) => {
    const day = days.get(d) ?? emptyDay(d);
    const st = levelOf(day, blocksFor(routine, d), s, today);
    return { date: d, level: st.level, label: LEVEL_LABEL[st.level], contacts: day.contacts, energy: day.energy, gym: st.minimum.find((c) => c.id === 'gym')!.ok };
  });
}

/** Personal tasks sorted the way the to-do list shows them: late, today, this week, later, no date. */
export function taskGroups(tasks: MeTask[], today: string): { id: string; label: string; tasks: MeTask[] }[] {
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.created_at.localeCompare(b.created_at));
  const sunday = addDays(mondayOf(today), 6);
  return [
    { id: 'late', label: 'Late', tasks: open.filter((t) => t.due_on && t.due_on < today) },
    { id: 'today', label: 'Today', tasks: open.filter((t) => t.due_on === today) },
    { id: 'week', label: 'This week', tasks: open.filter((t) => t.due_on && t.due_on > today && t.due_on <= sunday) },
    { id: 'later', label: 'Later', tasks: open.filter((t) => t.due_on && t.due_on > sunday) },
    { id: 'undated', label: 'No date', tasks: open.filter((t) => !t.due_on) },
  ].filter((g) => g.tasks.length);
}
