// Server-side reading of the owner's clients for the morning digest, the Brief and the monthly
// email. Reads only; the owner's app does the writing. Every function here tolerates the client
// tables not existing yet (the migration is the owner's to run) by returning "not ready".
import { db } from './core';
import { dueThisWeek, newlyDue, type Client, type ClientSettings, type Visit } from '../../shared/clients';
import { moneySummary, type ClientAction, type Outcome } from '../../shared/money';

export interface ClientsSnapshot { ready: boolean; clients: Client[]; visits: Visit[]; actions: ClientAction[]; outcomes: Outcome[] }

const mapClient = (r: any): Client => ({ id: r.id, name: r.name, phone: r.phone ?? '', email: r.email ?? '', consent: r.consent, consentAt: r.consent_at, consentSource: r.consent_source, intervalWeeks: r.interval_weeks, snoozedUntil: r.snoozed_until, notComingBack: !!r.not_coming_back, lastReviewAskAt: r.last_review_ask_at, source: r.source, importedFrom: r.imported_from, createdAt: r.created_at });
const mapVisit = (r: any): Visit => ({ id: r.id, clientId: r.client_id, at: r.visited_on, treatment: r.treatment, treatmentId: r.treatment_id, amount: r.amount != null ? Number(r.amount) : null, practitioner: r.practitioner, createdAt: r.created_at });
const mapAction = (r: any): ClientAction => ({ id: r.id, clientId: r.client_id, kind: r.kind, channel: r.channel, text: r.text, sentAt: r.sent_at, treatmentId: r.treatment_id, amountHint: r.amount_hint != null ? Number(r.amount_hint) : null, ref: r.ref });
const mapOutcome = (r: any): Outcome => ({ id: r.id, actionId: r.action_id, clientId: r.client_id, visitId: r.visit_id, amount: r.amount != null ? Number(r.amount) : null, status: r.status, at: r.happened_at, title: r.title, createdAt: r.created_at });

/** Everything about one owner's clients, or `ready: false` when the tables are not there. Notes are never read here. */
export async function loadClients(userId: string): Promise<ClientsSnapshot> {
  try {
    const [c, v, a, o] = await Promise.all([
      db<any[]>(`clients?select=id,name,phone,email,consent,consent_at,consent_source,interval_weeks,snoozed_until,not_coming_back,last_review_ask_at,source,imported_from,created_at&user_id=eq.${userId}&limit=5000`),
      db<any[]>(`client_visits?select=*&user_id=eq.${userId}&order=visited_on.desc&limit=20000`),
      db<any[]>(`client_actions?select=*&user_id=eq.${userId}&order=sent_at.desc&limit=5000`),
      db<any[]>(`client_outcomes?select=*&user_id=eq.${userId}&limit=5000`),
    ]);
    return { ready: true, clients: c.map(mapClient), visits: v.map(mapVisit), actions: a.map(mapAction), outcomes: o.map(mapOutcome) };
  } catch {
    return { ready: false, clients: [], visits: [], actions: [], outcomes: [] };
  }
}

export interface Reminder { clientId: string; name: string; dueOn: string; treatment: string | null; lastPrice: number | null; overdueWeeks: number }

/**
 * Clients who became due (or overdue) since the last run and have not been reminded for this due
 * date. Pure: the caller passes what it already reminded. One reminder per client per due date.
 */
export function dueReminders(snap: Pick<ClientsSnapshot, 'clients' | 'visits'>, settings: ClientSettings, since: Date, reminded: Set<string>, now = new Date()): Reminder[] {
  const byId = new Map(snap.clients.map((c) => [c.id, c]));
  return newlyDue(snap.clients, snap.visits, settings, since, now)
    .filter((d) => d.dueAt && !reminded.has(`${d.clientId}:${d.dueAt.slice(0, 10)}`))
    .map((d) => ({ clientId: d.clientId, name: byId.get(d.clientId)?.name ?? 'A client', dueOn: d.dueAt!.slice(0, 10), treatment: d.treatment, lastPrice: d.lastPrice, overdueWeeks: d.weeksOverdue }));
}

const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const first = (s: string) => s.split(' ')[0];

/** The one line for the owner's alert and digest about clients who are due. */
export function reminderLine(rs: Reminder[]): string | null {
  if (!rs.length) return null;
  const value = rs.reduce((a, r) => a + (r.lastPrice ?? 0), 0);
  const names = rs.slice(0, 3).map((r) => first(r.name)).join(', ');
  const overdue = rs.filter((r) => r.overdueWeeks > 0).length;
  return `${rs.length === 1 ? `${first(rs[0].name)} is` : `${rs.length} clients are`} due back${overdue ? ` (${overdue} overdue)` : ''}: ${names}${rs.length > 3 ? ` and ${rs.length - 3} more` : ''}${value ? `, worth ${money(value)} at their last prices` : ''}. ${rs.length === 1 ? 'A text is' : 'Texts are'} drafted under Your clients; you approve and send.`;
}

/** The digest lines for the week: who is due this week, and what Gainora's messages brought in so far this month. */
export function weeklyClientLines(snap: ClientsSnapshot, settings: ClientSettings, now = new Date()): string[] {
  if (!snap.ready) return [];
  const out: string[] = [];
  const d = dueThisWeek(snap.clients, snap.visits, settings, now);
  if (d.count) out.push(`Your clients: ${d.count} due back this week (${d.names.join(', ')}${d.count > d.names.length ? ` and ${d.count - d.names.length} more` : ''})${d.priced ? `, worth ${money(d.value)} at their last prices` : ''}. The texts are drafted; approve and send them from your phone.`);
  const m = moneySummary(snap.outcomes, snap.actions, new Date(now.getFullYear(), now.getMonth(), 1));
  if (m.bookings) out.push(`So far this month Gainora’s messages brought in ${money(m.confirmed)} from ${m.bookings} booking${m.bookings === 1 ? '' : 's'} you confirmed.${m.likely.length ? ` ${m.likely.length} likely booking${m.likely.length === 1 ? '' : 's'} waiting for you to confirm.` : ''}`);
  else if (m.likely.length) out.push(`${m.likely.length} client${m.likely.length === 1 ? '' : 's'} came in within three weeks of a Gainora text; confirm under Your clients → Bookings if the text brought them in.`);
  return out;
}

/** The monthly email's money line: confirmed bookings only, for the month that just ended. */
export function monthlyMoneyLines(snap: ClientsSnapshot, start: Date, end: Date): string[] {
  if (!snap.ready) return [];
  const m = moneySummary(snap.outcomes, snap.actions, start, end);
  if (!m.bookings) return ['No bookings were confirmed as coming from Gainora’s messages. When a client books after a text, mark it under Your clients and it counts here.'];
  const kinds = Object.entries(m.byKind).map(([k, v]) => `${v!.bookings} from ${k === 'rebook' ? 'rebook texts' : k === 'review_request' ? 'review requests' : k === 'quiet_day' ? 'quiet-day texts' : k === 'competitor_response' ? 'competitor responses' : 'bookings you added'}`).join(', ');
  return [`Gainora helped bring in ${money(m.confirmed)} from ${m.bookings} booking${m.bookings === 1 ? '' : 's'} you confirmed (${kinds}). Only bookings you confirmed are counted.`];
}
