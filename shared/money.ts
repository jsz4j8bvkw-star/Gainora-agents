// The money number: "Gainora helped bring in £X this month", counted only from bookings the
// owner confirmed came from something Gainora did. Pure and shared.
//
// How it stays honest:
// - Every outgoing message, response pack and quiet-day note is recorded as an action.
// - A booking only counts when the owner marks it ("this got a booking") with an amount. That is
//   a confirmed outcome. Nothing is estimated.
// - A visit logged for a client within 21 days of a Gainora message is a *likely* outcome: shown
//   separately, never in the headline, until the owner confirms or dismisses it.
// - The amount is pre-filled from the client's last price for that treatment, and the owner can change it.

import { LIKELY_WINDOW_DAYS, type MessageKind, type Visit } from './clients';

const DAY = 86_400_000;

export type ActionKind = MessageKind;
export type Channel = 'sms_phone' | 'sms_twilio' | 'copy' | 'instagram' | 'website';

export const ACTION_LABEL: Record<ActionKind, string> = { rebook: 'Rebook text', review_request: 'Review request', quiet_day: 'Quiet-day text', competitor_response: 'Competitor response' };

export interface ClientAction {
  id: string;
  clientId: string | null;    // null for a public post or website line
  kind: ActionKind;
  channel: Channel;
  text: string;
  sentAt: string;
  treatmentId?: string | null;
  /** The amount this is likely worth, for pre-filling: the client's last price for the treatment. */
  amountHint?: number | null;
  /** The event or review the action answers (a competitor event id, a review id). */
  ref?: string | null;
}

export type OutcomeStatus = 'confirmed' | 'likely' | 'dismissed';

export interface Outcome {
  id: string;
  actionId: string | null;
  clientId: string | null;
  visitId?: string | null;
  amount: number | null;      // £; required once confirmed
  status: OutcomeStatus;
  at: string;                 // when the booking happened (the visit date, or when the owner marked it)
  title: string;              // "Sarah M. rebooked anti-wrinkle, 2 areas"
  createdAt: string;
}

export interface MoneySummary {
  confirmed: number;          // £ in the period, confirmed only
  bookings: number;           // confirmed count
  likely: Outcome[];          // waiting for the owner
  likelyValue: number;        // their amounts where known (never shown as earned)
  byKind: Partial<Record<ActionKind | 'manual', { bookings: number; amount: number }>>;
  list: Outcome[];            // confirmed, newest first
}

/** Confirmed money in a period, with the list behind the number. */
export function moneySummary(outcomes: Outcome[], actions: ClientAction[], since: Date, until?: Date): MoneySummary {
  const inPeriod = (o: Outcome) => new Date(o.at).getTime() >= since.getTime() && (!until || new Date(o.at).getTime() < until.getTime());
  const confirmed = outcomes.filter((o) => o.status === 'confirmed' && inPeriod(o)).sort((a, b) => b.at.localeCompare(a.at));
  const likely = outcomes.filter((o) => o.status === 'likely').sort((a, b) => b.at.localeCompare(a.at));
  const byAction = new Map(actions.map((a) => [a.id, a]));
  const byKind: MoneySummary['byKind'] = {};
  for (const o of confirmed) {
    const k = (o.actionId && byAction.get(o.actionId)?.kind) || 'manual';
    const b = byKind[k] ?? { bookings: 0, amount: 0 };
    b.bookings++; b.amount += o.amount ?? 0; byKind[k] = b;
  }
  return {
    confirmed: confirmed.reduce((a, o) => a + (o.amount ?? 0), 0), bookings: confirmed.length,
    likely, likelyValue: likely.reduce((a, o) => a + (o.amount ?? 0), 0), byKind, list: confirmed,
  };
}

/**
 * Visits that followed a Gainora message to the same client within the window, not already
 * linked to an outcome. These become 'likely' outcomes for the owner to confirm. Each visit and
 * each action is used at most once.
 */
export function likelyOutcomes(actions: ClientAction[], visits: Visit[], existing: Outcome[], mkId: () => string, now = new Date(), windowDays = LIKELY_WINDOW_DAYS): Outcome[] {
  const usedVisits = new Set(existing.map((o) => o.visitId).filter(Boolean));
  const usedActions = new Set(existing.map((o) => o.actionId).filter(Boolean));
  const out: Outcome[] = [];
  const sorted = [...actions].filter((a) => a.clientId && !usedActions.has(a.id)).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  for (const a of sorted) {
    const sent = new Date(a.sentAt).getTime();
    const v = visits.filter((x) => x.clientId === a.clientId && !usedVisits.has(x.id)).map((x) => ({ x, t: new Date(x.at).getTime() }))
      .filter(({ t }) => t >= sent - DAY && t <= sent + windowDays * DAY && t <= now.getTime() + DAY).sort((p, q) => p.t - q.t)[0];
    if (!v) continue;
    usedVisits.add(v.x.id); usedActions.add(a.id);
    out.push({ id: mkId(), actionId: a.id, clientId: a.clientId, visitId: v.x.id, amount: v.x.amount ?? a.amountHint ?? null, status: 'likely', at: v.x.at, title: `${v.x.treatment} after a ${ACTION_LABEL[a.kind].toLowerCase()}`, createdAt: now.toISOString() });
  }
  return out;
}

/** The sentence on Home and in the monthly email. Only confirmed figures; says plainly when there are none. */
export function moneySentence(s: MoneySummary, period: string): string {
  if (!s.bookings) return `No bookings confirmed from Gainora’s messages ${period} yet. When a client books after a text, mark it and it counts here.`;
  return `${period.charAt(0).toUpperCase()}${period.slice(1)} Gainora helped bring in £${Math.round(s.confirmed).toLocaleString('en-GB')} from ${s.bookings} booking${s.bookings === 1 ? '' : 's'} you confirmed.`;
}

/** A booking a month at the typical treatment value against the subscription, in plain words (both figures stated). */
export function coverLine(s: MoneySummary, subscription = 299): string | null {
  if (!s.bookings) return null;
  if (s.confirmed >= subscription) return `That covers this month’s £${subscription} subscription.`;
  return `£${Math.round(subscription - s.confirmed)} short of this month’s £${subscription} subscription so far.`;
}
