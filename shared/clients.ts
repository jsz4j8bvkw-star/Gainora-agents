// The owner's past clients: who they are, what they had and when, when they are due back, and
// whether they may be messaged. Pure logic shared by the app, the demo, the server and the tests.
//
// Rules kept here:
// - A due-back date is only ever worked out from a real visit and a stated interval (the owner's
//   per-client interval, their per-treatment setting, or the catalogue's typical gap, labelled as such).
//   A treatment with no known interval produces no due date rather than a guessed one.
// - Marketing texts go only to clients who opted in, or to existing clients (at least one visit)
//   under the soft opt-in, and never to anyone who opted out. Every text carries an opt-out line.
// - Quiet hours and a weekly cap per client apply to every outgoing message, whatever its kind.
// - Notes the owner writes about a client are theirs alone: nothing here passes them on.

import { matchTreatment, treatmentById, type Group } from './treatments';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/* ---------- Types ---------- */
export type Consent = 'opted_in' | 'soft_opt_in' | 'opted_out' | 'unknown';

export const CONSENT_LABEL: Record<Consent, string> = {
  opted_in: 'Opted in to marketing',
  soft_opt_in: 'Existing client (soft opt-in, can opt out)',
  opted_out: 'Opted out',
  unknown: 'No consent recorded',
};

export interface Client {
  id: string;
  name: string;
  phone: string;            // normalised UK mobile (+447…) or '' when none or not a mobile
  phoneRaw?: string;        // what the owner typed, kept for display when it was not a mobile
  email: string;
  consent: Consent;
  consentAt?: string | null;
  consentSource?: 'owner' | 'import' | 'stop' | null;
  /** The owner's own interval for this client ("Sarah comes every 10 weeks"), in weeks. */
  intervalWeeks?: number | null;
  snoozedUntil?: string | null;
  notComingBack?: boolean;
  lastReviewAskAt?: string | null;
  /** Private to the owner; never sent to the AI or into a draft. */
  notes?: string;
  source: 'manual' | 'import';
  importedFrom?: string | null;
  createdAt: string;
}

export interface Visit {
  id: string;
  clientId: string;
  at: string;               // ISO date (the day of the visit)
  treatment: string;        // as the owner or their booking system named it
  treatmentId: string | null;   // catalogue id when the name matched (shared/treatments.ts)
  amount: number | null;    // £ paid
  practitioner?: string | null;
  createdAt: string;
}

/** Account-wide settings the owner keeps in their profile (no table needed). */
export interface ClientSettings {
  /** Per-treatment interval overrides, in weeks, by catalogue id. */
  intervals?: Record<string, number>;
  /** Quiet hours in UK time: no messages from quietStart (hour, 24h) until quietEnd. */
  quietStart?: number;
  quietEnd?: number;
  /** Most messages of any kind to one client in 7 days. */
  weeklyCap?: number;
  sendMode?: 'phone' | 'twilio';
}

export const DEFAULT_SETTINGS: Required<Pick<ClientSettings, 'quietStart' | 'quietEnd' | 'weeklyCap' | 'sendMode'>> = { quietStart: 20, quietEnd: 8, weeklyCap: 1, sendMode: 'phone' };
export const REVIEW_ASK_GAP_DAYS = 90;
export const LIKELY_WINDOW_DAYS = 21;

/* ---------- Typical intervals (weeks) ---------- */
/**
 * How often clients typically come back for each treatment, in weeks. These are the usual gaps
 * clinics and salons work to, used only when the owner has not set their own. Each due date built
 * from one says so, and the owner can change the gap per treatment or per client.
 */
export const TYPICAL_INTERVAL_WEEKS: Record<string, number> = {
  'aw-1': 13, 'aw-2': 13, 'aw-3': 13, 'aw-unspecified': 13, 'aw-masseter': 20, 'aw-hyperhidrosis': 26, 'aw-lipflip': 10,
  'lip-0.5': 30, 'lip-0.7': 30, 'lip-1': 39, 'lip-2': 52, 'lip-unspecified': 39, 'filler-1': 52, 'cheek-1': 52, 'cheek-2': 52, 'jaw-1': 52, 'jaw-2': 52, 'chin-1': 52,
  'nose': 52, 'tear-trough': 52, 'nasolabial': 52, 'marionette': 52,
  'profhilo-1': 4, 'profhilo-2': 26, 'polynucleotides-1': 4, 'polynucleotides-course': 26, 'skin-booster-1': 4, 'skin-booster-course': 26, 'sculptra': 52, 'prp-face': 8, 'prp-hair': 8,
  'fat-dissolve': 6, 'b12': 12, 'vitamin-drip': 4,
  'microneedling': 6, 'microneedling-course': 26, 'rf-microneedling': 8, 'rf-microneedling-course': 52, 'peel': 6, 'peel-course': 26, 'hydrafacial': 4, 'hydrafacial-deluxe': 4,
  'dermaplaning': 4, 'led': 2, 'facial': 4, 'facial-express': 4, 'facial-luxury': 6, 'microdermabrasion': 4, 'oxygen-facial': 4,
  'hifu-face': 52, 'hifu-body': 52, 'ipl-face': 4, 'laser-pigment': 6, 'carbon-laser': 4, 'co2': 52, 'rf-skin': 4,
  'lhr-upper-lip': 6, 'lhr-chin': 6, 'lhr-lip-chin': 6, 'lhr-underarm': 6, 'lhr-bikini': 6, 'lhr-hollywood': 6, 'lhr-half-leg': 8, 'lhr-full-leg': 8, 'lhr-full-face': 6, 'lhr-back': 8, 'lhr-full-body': 8, 'electrolysis': 3,
  'wax-hollywood': 5, 'wax-bikini': 5, 'wax-half-leg': 5, 'wax-full-leg': 5, 'wax-underarm': 4, 'wax-lip': 4,
  'hd-brows': 4, 'brow-lamination': 6, 'brow-tint': 4, 'microblading': 52, 'lash-lift': 7, 'lash-classic': 3, 'lash-hybrid': 3, 'lash-volume': 3, 'lash-infill': 3, 'lash-tint': 4,
  'gel-hands': 3, 'gel-toes': 4, 'biab': 3, 'biab-infill': 3, 'acrylic-full': 3, 'acrylic-infill': 3, 'manicure': 3, 'pedicure': 5,
  'cut-blowdry': 7, 'blowdry': 2, 'gents-cut': 4, 'root-colour': 6, 'full-colour': 7, 'highlights-half': 9, 'highlights-full': 10, 'balayage': 14, 'keratin': 14, 'olaplex': 6, 'extensions': 8,
  'massage-30': 4, 'massage-60': 4, 'massage-90': 4, 'hot-stone': 4, 'lymphatic': 2, 'spray-tan': 2, 'body-sculpt': 2, 'teeth-whitening': 52, 'semi-permanent-lips': 78,
};

/** A typical gap by treatment group, for catalogue entries the table above misses. */
const GROUP_INTERVAL_WEEKS: Partial<Record<Group, number>> = { Injectables: 26, Skin: 6, 'Laser and energy': 8, Body: 6, 'Brows and lashes': 4, Nails: 3, 'Hair removal': 6, Hair: 7, 'Massage and spa': 4 };

export type IntervalSource = 'client' | 'setting' | 'typical' | 'none';

/** The interval to use for a client and treatment, and where it came from. */
export function intervalFor(client: Pick<Client, 'intervalWeeks'>, treatmentId: string | null, settings: ClientSettings = {}): { weeks: number | null; source: IntervalSource } {
  if (client.intervalWeeks && client.intervalWeeks > 0) return { weeks: client.intervalWeeks, source: 'client' };
  if (treatmentId && settings.intervals && settings.intervals[treatmentId] > 0) return { weeks: settings.intervals[treatmentId], source: 'setting' };
  if (treatmentId && TYPICAL_INTERVAL_WEEKS[treatmentId]) return { weeks: TYPICAL_INTERVAL_WEEKS[treatmentId], source: 'typical' };
  const t = treatmentId ? treatmentById(treatmentId) : undefined;
  if (t && GROUP_INTERVAL_WEEKS[t.group]) return { weeks: GROUP_INTERVAL_WEEKS[t.group]!, source: 'typical' };
  return { weeks: null, source: 'none' };
}

/* ---------- Names, phones, emails ---------- */
export const firstNameOf = (name: string) => String(name || '').trim().split(/\s+/)[0] || 'there';

/**
 * A UK mobile as +447… from the ways people write it (07…, +44 7…, 0044, with spaces, brackets
 * or dashes). Landlines and anything that is not a UK mobile return null: texts need a mobile.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  let s = String(raw || '').replace(/\(0\)/g, '').replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('0044')) s = '+44' + s.slice(4);
  if (s.startsWith('44') && s.length === 12) s = '+' + s;
  if (s.startsWith('0')) s = '+44' + s.slice(1);
  if (/^\+447\d{9}$/.test(s)) return s;
  return null;
}

export const normaliseEmail = (raw: string | null | undefined): string => {
  const s = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
};

/** The key two records share when they are the same person: mobile first, then email, then the name. */
export function dedupeKey(c: { phone?: string | null; email?: string | null; name: string }): string {
  if (c.phone) return `p:${c.phone}`;
  if (c.email) return `e:${c.email.toLowerCase()}`;
  return `n:${String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

/* ---------- History ---------- */
export interface ClientSummary {
  visits: number;
  totalSpent: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  lastTreatment: string | null;
  lastTreatmentId: string | null;
  lastAmount: number | null;
  /** The last price this client paid for each treatment id (for pre-filling and for "value at their last price"). */
  lastPriceByTreatment: Record<string, number>;
}

export function summarise(visits: Visit[]): ClientSummary {
  const list = [...visits].sort((a, b) => a.at.localeCompare(b.at));
  const lastPriceByTreatment: Record<string, number> = {};
  for (const v of list) if (v.treatmentId && v.amount != null && v.amount > 0) lastPriceByTreatment[v.treatmentId] = v.amount;
  const last = list[list.length - 1];
  return {
    visits: list.length,
    totalSpent: list.reduce((a, v) => a + (v.amount ?? 0), 0),
    firstVisitAt: list[0]?.at ?? null,
    lastVisitAt: last?.at ?? null,
    lastTreatment: last?.treatment ?? null,
    lastTreatmentId: last?.treatmentId ?? null,
    lastAmount: last?.amount ?? null,
    lastPriceByTreatment,
  };
}

/* ---------- Due back ---------- */
export type DueStatus = 'overdue' | 'due' | 'upcoming' | 'none' | 'snoozed' | 'not_coming_back' | 'lapsed';

export interface DueInfo {
  clientId: string;
  status: DueStatus;
  dueAt: string | null;
  /** Whole weeks past the due date (0 when not yet past). */
  weeksOverdue: number;
  treatment: string | null;
  treatmentId: string | null;
  lastVisitAt: string | null;
  /** What they paid last time for that treatment: the value of the booking at their last price. */
  lastPrice: number | null;
  intervalWeeks: number | null;
  intervalSource: IntervalSource;
}

/** Due within this many days counts as "due this week". */
export const DUE_SOON_DAYS = 7;
/** Overdue by more than this (or more than one whole interval, whichever is longer) and the client has lapsed: a win-back, not a reminder. */
export const LAPSED_AFTER_WEEKS = 8;

/**
 * When a client is next due, from their most recent visit of each treatment and the interval
 * that applies. The earliest due treatment wins. No visits, or no interval known, gives 'none'.
 */
export function dueFor(client: Client, visits: Visit[], settings: ClientSettings = {}, now = new Date()): DueInfo {
  const base: DueInfo = { clientId: client.id, status: 'none', dueAt: null, weeksOverdue: 0, treatment: null, treatmentId: null, lastVisitAt: null, lastPrice: null, intervalWeeks: null, intervalSource: 'none' };
  const mine = visits.filter((v) => v.clientId === client.id).sort((a, b) => b.at.localeCompare(a.at));
  if (!mine.length) return base;
  base.lastVisitAt = mine[0].at;
  if (client.notComingBack) return { ...base, status: 'not_coming_back' };
  // The latest visit per treatment (free-text treatments with no catalogue match are keyed by name).
  const latest = new Map<string, Visit>();
  for (const v of mine) { const k = v.treatmentId ?? `t:${v.treatment.toLowerCase()}`; if (!latest.has(k)) latest.set(k, v); }
  let best: { due: number; v: Visit; weeks: number; source: IntervalSource } | null = null;
  for (const v of latest.values()) {
    const { weeks, source } = intervalFor(client, v.treatmentId, settings);
    if (!weeks) continue;
    const due = new Date(v.at).getTime() + weeks * WEEK;
    if (!best || due < best.due) best = { due, v, weeks, source };
  }
  if (!best) return base;
  const dueAt = new Date(best.due).toISOString();
  const info: DueInfo = { ...base, dueAt, treatment: best.v.treatment, treatmentId: best.v.treatmentId, lastPrice: best.v.amount, intervalWeeks: best.weeks, intervalSource: best.source };
  if (client.snoozedUntil && new Date(client.snoozedUntil).getTime() > now.getTime()) return { ...info, status: 'snoozed' };
  const diff = now.getTime() - best.due;
  if (diff > DUE_SOON_DAYS * DAY) {
    const weeksOverdue = Math.max(1, Math.floor(diff / WEEK));
    return { ...info, status: weeksOverdue > Math.max(LAPSED_AFTER_WEEKS, best.weeks) ? 'lapsed' : 'overdue', weeksOverdue };
  }
  if (best.due <= now.getTime() + DUE_SOON_DAYS * DAY) return { ...info, status: 'due' };
  return { ...info, status: 'upcoming' };
}

export function dueList(clients: Client[], visits: Visit[], settings: ClientSettings = {}, now = new Date()): DueInfo[] {
  return clients.map((c) => dueFor(c, visits, settings, now));
}

/** Clients due or overdue, grouped by treatment with the total value at their last prices, most valuable group first. */
export function dueGroups(clients: Client[], visits: Visit[], settings: ClientSettings = {}, now = new Date()): { treatmentId: string | null; label: string; items: { client: Client; due: DueInfo }[]; value: number; priced: number }[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const groups = new Map<string, { treatmentId: string | null; label: string; items: { client: Client; due: DueInfo }[]; value: number; priced: number }>();
  for (const due of dueList(clients, visits, settings, now)) {
    if (due.status !== 'due' && due.status !== 'overdue') continue;
    const key = due.treatmentId ?? `t:${(due.treatment || '').toLowerCase()}`;
    const label = due.treatmentId ? treatmentById(due.treatmentId)?.label ?? due.treatment ?? 'Treatment' : due.treatment ?? 'Treatment';
    const g = groups.get(key) ?? { treatmentId: due.treatmentId, label, items: [], value: 0, priced: 0 };
    g.items.push({ client: byId.get(due.clientId)!, due });
    if (due.lastPrice) { g.value += due.lastPrice; g.priced++; }
    groups.set(key, g);
  }
  const out = [...groups.values()];
  for (const g of out) g.items.sort((a, b) => b.due.weeksOverdue - a.due.weeksOverdue || (a.due.dueAt ?? '').localeCompare(b.due.dueAt ?? ''));
  return out.sort((a, b) => b.value - a.value || b.items.length - a.items.length);
}

/** The headline for Home: how many are due in the next week (or already overdue) and what their last visits were worth. */
export function dueThisWeek(clients: Client[], visits: Visit[], settings: ClientSettings = {}, now = new Date()): { count: number; value: number; priced: number; names: string[]; overdue: number } {
  const list = dueList(clients, visits, settings, now).filter((d) => d.status === 'due' || d.status === 'overdue');
  const byId = new Map(clients.map((c) => [c.id, c]));
  return {
    count: list.length,
    value: list.reduce((a, d) => a + (d.lastPrice ?? 0), 0),
    priced: list.filter((d) => d.lastPrice).length,
    names: list.slice(0, 3).map((d) => firstNameOf(byId.get(d.clientId)?.name ?? '')),
    overdue: list.filter((d) => d.status === 'overdue').length,
  };
}

/** Clients who became due or overdue since a given moment (for the morning digest and the Brief). */
export function newlyDue(clients: Client[], visits: Visit[], settings: ClientSettings, since: Date, now = new Date()): DueInfo[] {
  return dueList(clients, visits, settings, now).filter((d) => (d.status === 'due' || d.status === 'overdue') && d.dueAt && new Date(d.dueAt).getTime() > since.getTime() - DUE_SOON_DAYS * DAY && new Date(d.dueAt).getTime() <= now.getTime() + DUE_SOON_DAYS * DAY);
}

export const snoozeUntil = (weeks: number, now = new Date()) => new Date(now.getTime() + Math.max(1, Math.round(weeks)) * WEEK).toISOString();

/* ---------- Search and filters ---------- */
export type ClientFilter = 'all' | 'due' | 'lapsed' | 'top' | 'opted_out' | 'no_consent';
export const LAPSED_WEEKS = 26;

export function filterClients(clients: Client[], visits: Visit[], settings: ClientSettings, opts: { q?: string; filter?: ClientFilter; treatmentId?: string | null }, now = new Date()): Client[] {
  const q = (opts.q || '').trim().toLowerCase();
  const dues = new Map(dueList(clients, visits, settings, now).map((d) => [d.clientId, d]));
  const sums = new Map(clients.map((c) => [c.id, summarise(visits.filter((v) => v.clientId === c.id))]));
  let out = clients.filter((c) => {
    if (q) {
      const hay = `${c.name} ${c.phone} ${c.phoneRaw ?? ''} ${c.email} ${visits.filter((v) => v.clientId === c.id).map((v) => v.treatment).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (opts.treatmentId && !visits.some((v) => v.clientId === c.id && v.treatmentId === opts.treatmentId)) return false;
    const d = dues.get(c.id)!; const s = sums.get(c.id)!;
    switch (opts.filter) {
      case 'due': return d.status === 'due' || d.status === 'overdue';
      case 'lapsed': return !c.notComingBack && (d.status === 'lapsed' || (s.lastVisitAt != null && now.getTime() - new Date(s.lastVisitAt).getTime() > LAPSED_WEEKS * WEEK));
      case 'opted_out': return c.consent === 'opted_out';
      case 'no_consent': return c.consent === 'unknown';
      default: return true;
    }
  });
  if (opts.filter === 'top') out = [...out].sort((a, b) => sums.get(b.id)!.totalSpent - sums.get(a.id)!.totalSpent).slice(0, 20);
  else if (opts.filter === 'due') out = [...out].sort((a, b) => dues.get(b.id)!.weeksOverdue - dues.get(a.id)!.weeksOverdue || (dues.get(a.id)!.dueAt ?? '').localeCompare(dues.get(b.id)!.dueAt ?? ''));
  else out = [...out].sort((a, b) => (sums.get(b.id)!.lastVisitAt ?? '').localeCompare(sums.get(a.id)!.lastVisitAt ?? '') || a.name.localeCompare(b.name));
  return out;
}

/* ---------- Who may be messaged ---------- */
export type MessageKind = 'rebook' | 'review_request' | 'quiet_day' | 'competitor_response';

/** A message already sent to a client (the shape shared/money.ts records). */
export interface SentRef { clientId: string | null; kind: MessageKind | string; sentAt: string }

export interface Permission { ok: boolean; reason: string | null }

/** The hour of the day in UK time for a moment (handles BST). */
export function londonHour(d: Date): number {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(d);
  return Number(s.replace(/\D/g, '')) || 0;
}

export function inQuietHours(now: Date, settings: ClientSettings = {}): boolean {
  const start = settings.quietStart ?? DEFAULT_SETTINGS.quietStart; const end = settings.quietEnd ?? DEFAULT_SETTINGS.quietEnd;
  const h = londonHour(now);
  if (start === end) return false;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/**
 * Whether this client may be sent this kind of message right now. Checks consent (the law),
 * then the owner's own courtesy rules (quiet hours, the weekly cap, the 90-day review gap).
 * The reason is plain enough to show next to the client's name.
 */
export function canMessage(client: Client, kind: MessageKind, ctx: { visits: number; sent: SentRef[]; settings?: ClientSettings; now?: Date }): Permission {
  const now = ctx.now ?? new Date(); const settings = ctx.settings ?? {};
  if (client.consent === 'opted_out') return { ok: false, reason: 'Opted out of messages' };
  if (!client.phone) return { ok: false, reason: 'No mobile number' };
  if (client.consent === 'unknown' || (client.consent === 'soft_opt_in' && ctx.visits === 0)) return { ok: false, reason: 'No consent recorded: ask them, or log a visit (existing clients may be texted under the soft opt-in)' };
  if (kind === 'rebook' && client.notComingBack) return { ok: false, reason: 'Marked as not coming back' };
  if (kind === 'review_request' && client.lastReviewAskAt && now.getTime() - new Date(client.lastReviewAskAt).getTime() < REVIEW_ASK_GAP_DAYS * DAY) return { ok: false, reason: `Asked for a review in the last ${REVIEW_ASK_GAP_DAYS} days` };
  const cap = settings.weeklyCap ?? DEFAULT_SETTINGS.weeklyCap;
  const recent = ctx.sent.filter((s) => s.clientId === client.id && now.getTime() - new Date(s.sentAt).getTime() < WEEK).length;
  if (recent >= cap) return { ok: false, reason: cap === 1 ? 'Already messaged this week' : `Already messaged ${recent} times this week` };
  if (inQuietHours(now, settings)) return { ok: false, reason: `Quiet hours until ${settings.quietEnd ?? DEFAULT_SETTINGS.quietEnd}am` };
  return { ok: true, reason: null };
}

/** Applies a STOP (or any opt-out) to a client: no more messages of any kind. */
export function optOut<T extends Pick<Client, 'consent' | 'consentAt' | 'consentSource'>>(c: T, at = new Date(), source: 'owner' | 'stop' = 'stop'): T {
  return { ...c, consent: 'opted_out', consentAt: at.toISOString(), consentSource: source };
}

/* ---------- Visits ---------- */
/** Fills in the catalogue id for a treatment name, so intervals and prices line up. */
export function treatmentIdFor(name: string): string | null { return matchTreatment(name)?.id ?? null; }

/** The amount to pre-fill when logging a visit: this client's last price for the treatment, else the owner's list price. */
export function suggestAmount(treatmentId: string | null, summary: ClientSummary, ownerPrices: Record<string, number> = {}): number | null {
  if (treatmentId && summary.lastPriceByTreatment[treatmentId]) return summary.lastPriceByTreatment[treatmentId];
  if (treatmentId && ownerPrices[treatmentId]) return ownerPrices[treatmentId];
  return null;
}

/* ---------- GDPR ---------- */
/** Everything held about one client, as a plain object the owner can hand over or keep. */
export function exportClient(client: Client, visits: Visit[], actions: { kind: string; sentAt: string; text: string }[] = []): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    client: { name: client.name, mobile: client.phone || client.phoneRaw || '', email: client.email, consent: CONSENT_LABEL[client.consent], consentRecordedAt: client.consentAt ?? null, notes: client.notes ?? '', addedAt: client.createdAt, source: client.source },
    visits: visits.filter((v) => v.clientId === client.id).sort((a, b) => a.at.localeCompare(b.at)).map((v) => ({ date: v.at.slice(0, 10), treatment: v.treatment, amount: v.amount, practitioner: v.practitioner ?? null })),
    messages: actions.map((a) => ({ kind: a.kind, sentAt: a.sentAt, text: a.text })),
  };
}
