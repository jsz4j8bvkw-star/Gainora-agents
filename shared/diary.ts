// The diary: free times for a treatment, worked out the same way for the booking page, the receptionist on
// the phone and the app. Pure (no network): the server passes in what's already booked, from Gainora and from
// the clinic's own calendar when it's connected.
//
// Rules: the clinic's opening days and hours (UK time, so the clocks changing is handled), the treatment's
// length, who does it, the shortest notice and how far ahead people may book, an optional gap after each
// appointment, and nobody booked twice at once.

import { lines, normPhone, type AppointmentType, type CaptureSettings, type EnquiryRecord } from './capture';

export interface Busy { start: string; end: string; /** A team member's first name, or '' when it blocks everyone. */ who: string }
export interface Slot { start: string; end: string; who: string }
export interface DayTimes { date: string; /** "Thursday 12 November" */ label: string; slots: Slot[] }

/** Settings for the clinic's own booking page. Stored with the rest of their settings. */
export interface BookingPage {
  on: boolean;
  /** The page's address: capture.gainora.co.uk/book/<slug>. */
  slug: string;
  /** book: times are confirmed straight away. request: the client asks for a time and the clinic confirms it. */
  mode: 'book' | 'request';
  intro: string;
  showPrices: boolean;
  /** Treatments offered online, by name. Empty means all of them. */
  types: string[];
  /** Let clients choose who they see. */
  chooseStaff: boolean;
  /** The clinic's colour for buttons, as #RRGGBB. Empty uses Gainora's. */
  accent: string;
}

export interface DiaryRules { step: number; buffer: number }

const clean = (s: unknown, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const DAY_MS = 86_400_000;

export function defaultPage(s: Pick<CaptureSettings, 'business'>): BookingPage {
  return { on: false, slug: slugify(s.business.name), mode: 'book', intro: '', showPrices: true, types: [], chooseStaff: true, accent: '' };
}

export function pageOf(s: CaptureSettings & { page?: Partial<BookingPage> }): BookingPage {
  const d = defaultPage(s);
  const p = { ...d, ...(s.page ?? {}) };
  p.slug = slugify(p.slug || d.slug);
  p.mode = p.mode === 'request' ? 'request' : 'book';
  p.accent = /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '';
  p.types = Array.isArray(p.types) ? p.types.map((t) => clean(t, 80)).filter(Boolean) : [];
  return p;
}

export function rulesOf(s: CaptureSettings & { diary?: Partial<DiaryRules> }): DiaryRules {
  const step = Number(s.diary?.step);
  const buffer = Number(s.diary?.buffer);
  return { step: [5, 10, 15, 20, 30, 60].includes(step) ? step : 15, buffer: [0, 5, 10, 15, 20, 30].includes(buffer) ? buffer : 0 };
}

/** "Willow Skin & Beauty" → "willow-skin-beauty". Letters, numbers and dashes, 3 to 40 characters. */
export function slugify(raw: string): string {
  const s = String(raw || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s.length >= 3 ? s : s ? `${s}-clinic` : 'my-clinic';
}

/* ---------- UK time ---------- */

const parts = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: Number(g('year')), m: Number(g('month')), d: Number(g('day')), h: Number(g('hour')), min: Number(g('minute')), wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(g('weekday')) + 1 };
};
/** The instant a UK wall-clock time happens, e.g. londonTime('2026-11-12', 14 * 60). */
export function londonTime(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    t -= shown - Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  }
  return new Date(t);
}
/** The UK date (YYYY-MM-DD) of an instant. */
export const londonDate = (d: Date) => { const p = parts(d); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const addDays = (date: string, n: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekdayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; };
const mins = (hhmm: string) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const dayLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00Z`));
export const timeLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(':00', '').replace(' ', '');

/* ---------- Who does what ---------- */

/** The team, by first name, from the "Who takes bookings" list. Empty when the owner listed nobody. */
export const teamOf = (s: Pick<CaptureSettings, 'bookings'>) => [...new Set(lines(s.bookings.staff).map((n) => clean(n, 60).split(' ')[0]).filter(Boolean))];

export function findType(s: Pick<CaptureSettings, 'bookings'>, name: string): AppointmentType | undefined {
  const n = clean(name, 80).toLowerCase();
  if (!n) return undefined;
  const types = s.bookings.types.filter((t) => clean(t.name));
  return types.find((t) => t.name.toLowerCase() === n) ?? types.find((t) => t.name.toLowerCase().includes(n) || n.includes(t.name.toLowerCase()));
}

/** Who can do a treatment: the team members named in its "Who" field, or everyone when none are named. */
export function whoDoes(s: Pick<CaptureSettings, 'bookings'>, type: AppointmentType | undefined): string[] {
  const team = teamOf(s);
  if (!team.length) return [''];
  const named = team.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(type?.who ?? ''));
  return named.length ? named : team;
}

/** A first name the caller or client asked for, matched to the team, or ''. */
export function matchStaff(s: Pick<CaptureSettings, 'bookings'>, asked: string | undefined): string {
  const a = clean(asked, 60).toLowerCase().split(' ')[0];
  if (!a || /^(any|anyone|either|no)/.test(a)) return '';
  return teamOf(s).find((t) => t.toLowerCase() === a) ?? '';
}

/* ---------- What's already booked ---------- */

/** Appointments booked through Gainora, as busy times. A booking with nobody named blocks the whole team (safest). */
export function busyFromBookings(list: EnquiryRecord[], s: Pick<CaptureSettings, 'bookings'>, now = new Date()): Busy[] {
  const team = teamOf(s);
  return list
    .filter((e) => !e.isTest && e.status === 'booked' && e.bookedFor && new Date(e.bookedFor).getTime() > now.getTime() - DAY_MS)
    .map((e) => {
      const len = findType(s, e.bookedType || '')?.minutes || 60;
      const who = team.find((t) => t.toLowerCase() === clean(e.bookedWith, 60).split(' ')[0].toLowerCase()) ?? '';
      return { start: e.bookedFor!, end: new Date(new Date(e.bookedFor!).getTime() + len * 60_000).toISOString(), who };
    });
}

/* ---------- Free times ---------- */

export interface TimesQuery {
  type: string;
  /** A team member's first name, or '' for whoever is free. */
  who?: string;
  /** UK date to start from (YYYY-MM-DD). Defaults to today. */
  from?: string;
  days?: number;
  busy?: Busy[];
  now?: Date;
}

/**
 * Every start time a treatment could be booked, day by day, within the clinic's rules. With nobody asked for,
 * each time is given once, with the first free team member (in the order the owner listed them).
 */
export function freeTimes(s: CaptureSettings & { diary?: Partial<DiaryRules> }, q: TimesQuery): DayTimes[] {
  const now = q.now ?? new Date();
  const type = findType(s, q.type);
  const len = type?.minutes || 60;
  const { step, buffer } = rulesOf(s);
  const asked = matchStaff(s, q.who);
  const people = asked ? whoDoes(s, type).filter((p) => p === asked) : whoDoes(s, type);
  if (!people.length) return [];
  const busy = q.busy ?? [];
  const earliest = now.getTime() + (s.bookings.noticeHours || 0) * 3_600_000;
  const latest = now.getTime() + Math.max(1, s.bookings.aheadWeeks || 4) * 7 * DAY_MS;
  const open = mins(s.calls.open), close = mins(s.calls.close);
  const start = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : londonDate(now);
  const out: DayTimes[] = [];
  for (let i = 0; i < Math.min(q.days ?? 7, 62); i++) {
    const date = addDays(start, i);
    if (!s.calls.days.includes(weekdayOf(date))) continue;
    const slots: Slot[] = [];
    for (let m = open; m + len <= close; m += step) {
      const a = londonTime(date, m);
      if (a.getTime() < earliest) continue;
      if (a.getTime() > latest) break;
      const b = new Date(a.getTime() + len * 60_000);
      const until = b.getTime() + buffer * 60_000;
      const free = people.find((p) => !busy.some((x) => (x.who === '' || p === '' || x.who === p) && new Date(x.start).getTime() < until && new Date(x.end).getTime() + buffer * 60_000 > a.getTime()));
      if (free !== undefined) slots.push({ start: a.toISOString(), end: b.toISOString(), who: free });
    }
    if (slots.length) out.push({ date, label: dayLabel(date), slots });
  }
  return out;
}

/** Whether one exact time is still free (checked again just before booking, in case someone took it). */
export function stillFree(s: CaptureSettings, type: string, start: string, who: string, busy: Busy[], now = new Date()): boolean {
  const date = londonDate(new Date(start));
  return freeTimes(s, { type, who, from: date, days: 1, busy, now }).some((d) => d.slots.some((x) => x.start === new Date(start).toISOString() && (!who || x.who === who)));
}

/**
 * A few times to offer on the phone: the first free one, then others spread out (a different part of the day,
 * then a different day), so the caller has a real choice. Optional preference for morning, afternoon or evening.
 */
export function offerTimes(days: DayTimes[], opts: { part?: 'morning' | 'afternoon' | 'evening' | ''; count?: number } = {}): Slot[] {
  const count = opts.count ?? 3;
  const hour = (iso: string) => parts(new Date(iso)).h;
  const fits = (x: Slot) => !opts.part || (opts.part === 'morning' ? hour(x.start) < 12 : opts.part === 'afternoon' ? hour(x.start) >= 12 && hour(x.start) < 17 : hour(x.start) >= 17);
  const all = days.flatMap((d) => d.slots).filter(fits);
  const out: Slot[] = [];
  for (const x of all) {
    if (out.length >= count) break;
    const last = out[out.length - 1];
    if (!last || londonDate(new Date(x.start)) !== londonDate(new Date(last.start)) || new Date(x.start).getTime() - new Date(last.start).getTime() >= 2 * 3_600_000) out.push(x);
  }
  return out;
}

/** How a time reads on the phone and in texts: "Thursday 12 November at 2pm with Amy". */
export const sayTime = (x: Slot) => `${dayLabel(londonDate(new Date(x.start)))} at ${timeLabel(x.start)}${x.who ? ` with ${x.who}` : ''}`;

/** A time the receptionist hands back to book it: the start and who, in one string she can't garble. */
export const slotId = (x: Pick<Slot, 'start' | 'who'>) => `${new Date(x.start).toISOString()}${x.who ? `|${x.who}` : ''}`;
export function parseSlotId(id: string): { start: string; who: string } | null {
  const [start, who = ''] = String(id || '').split('|');
  const d = new Date(start);
  return Number.isNaN(d.getTime()) ? null : { start: d.toISOString(), who: clean(who, 40) };
}

/** Someone booking more than three times in an hour from the same number is almost certainly not a client. */
export const tooMany = (list: EnquiryRecord[], phone: string, now = new Date()) =>
  list.filter((e) => normPhone(e.phone) === normPhone(phone) && now.getTime() - new Date(e.receivedAt).getTime() < 3_600_000).length >= 3;

/* ---------- What the public booking page shows ---------- */

export interface PublicType { name: string; minutes: number; price: string; who: string[] }
export interface PublicPage {
  slug: string; name: string; location: string; address: string; phone: string; website: string;
  intro: string; mode: 'book' | 'request'; accent: string; chooseStaff: boolean;
  team: string[]; types: PublicType[];
  deposit: { what: string; forWho: 'new' | 'all'; types: string[] } | null;
  cancellation: string; arrival: string; aheadWeeks: number;
}

/** Only what a client needs to book: no emails, no settings, no private notes. */
export function publicPage(s: CaptureSettings, deposit: { what: string; forWho: 'new' | 'all'; types: string[] } | null): PublicPage {
  const p = pageOf(s);
  const offered = s.bookings.types.filter((t) => clean(t.name) && (!p.types.length || p.types.some((x) => x.toLowerCase() === t.name.toLowerCase())));
  return {
    slug: p.slug, name: clean(s.business.name, 80), location: clean(s.business.location, 80), address: clean(s.bookings.address, 200),
    phone: clean(s.business.phone, 30), website: /^https:\/\//.test(s.business.website || '') ? clean(s.business.website, 200) : '',
    intro: clean(p.intro, 400), mode: p.mode, accent: p.accent, chooseStaff: p.chooseStaff && teamOf(s).length > 1,
    team: teamOf(s),
    types: offered.map((t) => ({ name: clean(t.name, 80), minutes: t.minutes || 60, price: p.showPrices ? clean(t.price, 30) : '', who: whoDoes(s, t).filter(Boolean) })),
    deposit, cancellation: clean(s.bookings.cancellation, 300), arrival: clean(s.bookings.arrival, 300), aheadWeeks: s.bookings.aheadWeeks || 4,
  };
}

/** A time a client asked for (booking page or phone, for a clinic that confirms each one), from its history. */
export function requestedTime(e: Pick<EnquiryRecord, 'history' | 'status'>): { start: string; who: string; type: string } | null {
  if (e.status !== 'new' && e.status !== 'replied') return null;
  const h = [...e.history].reverse().find((x) => x.text.startsWith('Requested: '));
  if (!h) return null;
  const [start, who = '', type = ''] = h.text.slice('Requested: '.length).split('|');
  return Number.isNaN(new Date(start).getTime()) ? null : { start: new Date(start).toISOString(), who, type };
}
