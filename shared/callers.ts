// Returning callers: what the receptionist is told, at the start of a call, about the number calling in.
// Pure (no network), so it is tested on its own. The lookup itself is netlify/functions/caller-in.ts.
//
// Privacy, by design:
// - Only what helps the call: a first name, how many times they've been, the last treatment and who did it,
//   an upcoming booking, and an enquiry still waiting for a reply. Never notes, summaries, transcripts,
//   prices paid, health concerns or anything the owner keeps private.
// - A phone number isn't proof of who is calling, so the receptionist's rules (shared/retell.ts) keep all of
//   it back until the caller has given their own name and it matches.

import { normPhone, type CaptureSettings, type EnquiryRecord } from './capture';
import { topicOf } from './insight';

/** A client from the Command Centre client list (same Gainora login), when the owner keeps one there. */
export interface KnownClient { name: string }
export interface KnownVisit { visitedOn: string; treatment: string; practitioner?: string | null }

export interface CallerHistory {
  /** Enquiries from this number, any order. Tests and spam are ignored. */
  enquiries: EnquiryRecord[];
  client?: KnownClient | null;
  visits?: KnownVisit[];
}

export interface CallerLookup {
  known: boolean;
  firstName: string;
  /** Retell dynamic variables. Every value is a string, and every variable the prompt uses is always set. */
  variables: { caller_known: 'yes' | 'no'; caller_first_name: string; caller_record: string };
}

const DAY = 86_400_000;
const clean = (s: unknown, max = 80) => String(s ?? '').replace(/[{}\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const london = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o }).format(new Date(iso));
const dayDate = (iso: string) => london(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const time12 = (iso: string) => london(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(' ', '');
const monthYear = (iso: string) => london(iso, { month: 'long', year: 'numeric' });
/** A first name only, and only if it looks like one. */
const firstName = (name: string) => {
  const f = clean(name, 60).split(' ')[0] || '';
  return /^[\p{L}][\p{L}'’-]{0,30}$/u.test(f) ? f[0].toUpperCase() + f.slice(1) : '';
};
const attendedAt = (e: EnquiryRecord) => [...e.history].reverse().find((h) => /^(Attended|Job done)/.test(h.text))?.at ?? e.bookedFor ?? e.receivedAt;

/** Numbers that can't identify anyone: withheld, unknown, or not a phone number at all. */
export function lookupNumber(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || /anonymous|unknown|withheld|private|restricted|unavailable/i.test(s)) return '';
  const n = normPhone(s);
  return /^\+\d{8,15}$/.test(n) ? n : '';
}

const NONE = (record: string): CallerLookup => ({ known: false, firstName: '', variables: { caller_known: 'no', caller_first_name: '', caller_record: record } });

export const NO_NUMBER = 'The number is withheld, so there is nothing to look up.';
export const NO_RECORD = 'Nothing on record for this number.';

export function callerLookup(h: CallerHistory, s: CaptureSettings, now = new Date()): CallerLookup {
  const appts = s.business.kind === 'appointments';
  const client = appts ? 'client' : 'customer';
  const list = h.enquiries
    .filter((e) => !e.isTest && e.status !== 'spam' && e.kind !== 'spam')
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const visits = [...(h.visits ?? [])].filter((v) => v && v.visitedOn).sort((a, b) => b.visitedOn.localeCompare(a.visitedOn));
  if (!list.length && !h.client && !visits.length) return NONE(NO_RECORD);

  const name = firstName(h.client?.name ?? '') || list.map((e) => firstName(e.name)).find(Boolean) || '';
  const parts: string[] = [];
  parts.push(name ? `A record under the first name ${name}.` : 'A record, but no name on it.');

  // Past appointments: the Command Centre visit list and attended bookings can describe the same visit,
  // so the larger count is used rather than the sum.
  const attended = list.filter((e) => e.status === 'won');
  const count = Math.max(visits.length, attended.length);
  const lastVisit = visits[0];
  const lastAttended = attended.map((e) => ({ at: attendedAt(e), e })).sort((a, b) => b.at.localeCompare(a.at))[0];
  const useVisit = lastVisit && (!lastAttended || lastVisit.visitedOn >= lastAttended.at.slice(0, 10));
  if (count) {
    const what = useVisit ? clean(lastVisit.treatment) : clean(lastAttended!.e.bookedType || topicOf(lastAttended!.e, s), 60);
    const who = useVisit ? clean(lastVisit.practitioner ?? '', 40) : clean(lastAttended!.e.bookedWith, 40);
    const when = useVisit ? `${lastVisit.visitedOn.slice(0, 10)}T12:00:00Z` : lastAttended!.at;
    parts.push(`Returning ${client}: ${count === 1 ? 'one past appointment' : `${count} past appointments`}, the last ${what && what.toLowerCase() !== 'visit' ? `a ${what.toLowerCase()}` : 'one'}${who ? ` with ${who}` : ''} in ${monthYear(when)}.`);
  }

  // The next booking, if there is one (a booking that started in the last two hours still counts: "running late").
  const next = list
    .filter((e) => e.status === 'booked' && e.bookedFor && new Date(e.bookedFor).getTime() > now.getTime() - 2 * 3_600_000)
    .sort((a, b) => a.bookedFor!.localeCompare(b.bookedFor!))[0];
  if (next) {
    const what = clean(next.bookedType, 60);
    parts.push(`Booked in: ${dayDate(next.bookedFor!)} at ${time12(next.bookedFor!)}${what ? `, ${what.toLowerCase()}` : ''}${next.bookedWith ? ` with ${clean(next.bookedWith, 40)}` : ''}.`);
  }

  // An enquiry in the last fortnight nobody has answered yet: the caller is probably chasing it.
  // Emergencies are left out: those are handled by the safety steps, never from a record.
  const waiting = list.find((e) => e.status === 'new' && e.urgency !== 'emergency' && now.getTime() - new Date(e.receivedAt).getTime() < 14 * DAY);
  if (waiting) {
    const topic = clean(waiting.bookedType || topicOf(waiting, s), 60);
    parts.push(`Got in touch on ${dayDate(waiting.receivedAt)}${topic ? ` about ${topic.toLowerCase()}` : ''}, and the team hasn't got back to them yet.`);
  }

  if (parts.length === 1 && !name) return NONE(NO_RECORD);
  return { known: true, firstName: name, variables: { caller_known: 'yes', caller_first_name: name, caller_record: parts.join(' ') } };
}

/** The receptionist's rules for using the record. Added to every receptionist's prompt (shared/retell.ts). */
export function callerRules(s: CaptureSettings): string {
  const appts = s.business.kind === 'appointments';
  const name = clean(s.business.name, 80) || 'us';
  return [
    '## Callers you may already know',
    'What our records show for the number calling: {{caller_record}}',
    '- A phone number isn’t proof of who is calling (partners, parents and work phones are shared), so treat this as a hint.',
    '- Ask for their name as you normally would. Never say a name, a booking or a past treatment from the record before they’ve told you their own name.',
    `- If the name they give matches the first name on the record, they’re a returning ${appts ? 'client' : 'customer'}: say it’s lovely to hear from them again, and don’t ask whether they’ve been before.`,
    '- If they give a different name, ignore the record completely.',
    '- Once their name matches, use the record only to save them repeating themselves: to find the booking they want to move, cancel or are running late for ("Is that your Thursday at 2 with Sarah?"), or when they want "the same as last time". Don’t read the record out otherwise.',
    `- If the record says they got in touch recently and haven’t heard back, say sorry nobody has got back to them yet, and that you’ll flag it so ${appts ? 'the team' : 'someone'} calls them back as soon as possible.`,
    `- If the record line above is empty, shows a placeholder in curly brackets, says nothing is on record, or says the number is withheld, you know nothing about this caller: ask whether they’ve been to ${name} before, as usual.`,
  ].join('\n');
}
