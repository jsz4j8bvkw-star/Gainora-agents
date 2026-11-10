// Keeping clients: early warning signs, and the monthly email that shows each client what Gainora did for them.
import type { AccountSummary } from './model';

export type Health = 'good' | 'watch' | 'risk';
export interface HealthSignals {
  lastSignIn: string | null;            // ISO
  startedOn: string | null;             // YYYY-MM-DD
  enquiries14: number | null;           // Capture & Convert enquiries in the last 14 days (null: not on their plan)
  visits14: number | null;              // website visitors in the last 14 days (null: no live site)
  oldestRequestDays: number | null;     // their oldest open website change request
}

const daysSince = (iso: string | null, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000) : null);

/** How a client is doing, with the reasons in plain words. Nothing here guesses: each reason is a fact. */
export function healthOf(a: Pick<AccountSummary, 'billing' | 'overdue' | 'packages' | 'status' | 'renewsOn'>, s: HealthSignals, now = new Date()): { level: Health; reasons: string[] } {
  if (a.status === 'left' || !a.packages.length) return { level: 'good', reasons: [] };
  const risk: string[] = []; const watch: string[] = [];
  const settled = (daysSince(s.startedOn ? `${s.startedOn}T00:00:00Z` : null, now) ?? 0) >= 21;
  if (a.billing === 'past_due') risk.push('Their last payment failed');
  const seen = daysSince(s.lastSignIn, now);
  if (seen == null) { if (settled) risk.push('Has never signed in'); }
  else if (seen > 30) risk.push(`Hasn’t signed in for ${seen} days`);
  else if (seen > 14) watch.push(`Hasn’t signed in for ${seen} days`);
  if (s.enquiries14 === 0 && settled) watch.push('No enquiries through Capture & Convert in 14 days');
  if (s.visits14 === 0 && settled) watch.push('No website visitors in 14 days');
  if (a.overdue > 3) watch.push(`${a.overdue} set-up steps are late`);
  if ((s.oldestRequestDays ?? 0) > 3) watch.push(`A change they asked for has waited ${s.oldestRequestDays} days`);
  if (a.renewsOn) { const d = Math.ceil((Date.parse(`${a.renewsOn}T12:00:00Z`) - now.getTime()) / 86_400_000); if (d >= 0 && d <= 7 && (risk.length || watch.length)) watch.push(`Renews in ${d} day${d === 1 ? '' : 's'}`); }
  return risk.length ? { level: 'risk', reasons: [...risk, ...watch] } : watch.length ? { level: 'watch', reasons: watch } : { level: 'good', reasons: [] };
}

export interface MonthResults {
  month: string; // YYYY-MM-01
  capture: { enquiries: number; calls: number; afterHours: number; booked: number } | null;
  website: { visitors: number; contacts: number } | null;
  command: { briefs: number; leads: number } | null;
}

/** The monthly results email: only what happened, only for what they have. Null when there's nothing to say. */
export function resultsEmail(name: string, r: MonthResults): { subject: string; paragraphs: string[] } | null {
  const monthName = new Date(`${r.month}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const lines: string[] = [];
  if (r.capture && r.capture.enquiries) {
    lines.push(`Capture & Convert caught ${r.capture.enquiries} enquir${r.capture.enquiries === 1 ? 'y' : 'ies'}${r.capture.calls ? `, including ${r.capture.calls} call${r.capture.calls === 1 ? '' : 's'} your receptionist answered` : ''}${r.capture.afterHours ? ` (${r.capture.afterHours} out of hours)` : ''}.${r.capture.booked ? ` ${r.capture.booked} became bookings.` : ''}`);
  }
  if (r.website && r.website.visitors) lines.push(`Your website had ${r.website.visitors} visitor${r.website.visitors === 1 ? '' : 's'}, and ${r.website.contacts} of them called, booked or sent a message.`);
  if (r.command && (r.command.briefs || r.command.leads)) lines.push(`Command Centre wrote ${r.command.briefs} weekly brief${r.command.briefs === 1 ? '' : 's'}${r.command.leads ? ` and found ${r.command.leads} new potential customer${r.command.leads === 1 ? '' : 's'}` : ''}.`);
  if (!lines.length) return null;
  return {
    subject: `Your ${monthName} with Gainora`,
    paragraphs: [`Hi ${name},`, `Here’s what Gainora did for you in ${monthName}:`, ...lines, 'If anything should change, just reply to this email.', 'Gainora'],
  };
}
