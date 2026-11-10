// Winning clients: prospects, the messages that go to them and when, and how the outreach is doing.
//
// The rules that keep Gainora's outreach legal and its email domain healthy (UK PECR and GDPR):
//  - Marketing emails to limited companies and LLPs may go without asking first, as long as every email says who
//    it's from and gives an easy way to stop. Sole traders and partnerships must have said yes first.
//  - Anyone who asks to stop is never contacted again (do-not-contact list, checked before every send).
//  - Instagram, Facebook, LinkedIn and WhatsApp messages are never sent automatically: their rules forbid it. The
//    admin writes them and reminds you; you press send.

import { addDays } from './templates';

export type Channel = 'email' | 'linkedin' | 'instagram' | 'facebook' | 'whatsapp' | 'text' | 'call';
export const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', text: 'Text', call: 'Call' };
/** Only email can go from the admin itself; everything else is copied and sent by a person. */
export const AUTO_CHANNELS: Channel[] = ['email'];

export type Stage = 'new' | 'contacted' | 'replied' | 'call' | 'proposal' | 'won' | 'lost';
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'new', label: 'To contact' }, { id: 'contacted', label: 'Contacted' }, { id: 'replied', label: 'Replied' },
  { id: 'call', label: 'Call booked' }, { id: 'proposal', label: 'Proposal sent' }, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Not now' },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>;

export type CompanyType = 'limited' | 'llp' | 'sole_trader' | 'partnership' | 'unknown';
export const COMPANY_LABEL: Record<CompanyType, string> = { limited: 'Limited company', llp: 'LLP', sole_trader: 'Sole trader', partnership: 'Partnership', unknown: 'Not checked' };

export interface SequenceStep { day: number; channel: Channel; subject: string; body: string }
export interface Sequence { id: string; name: string; steps: SequenceStep[]; active: boolean }

export interface Prospect {
  id: string; business_name: string; contact_name: string; role: string; email: string; phone: string; website: string;
  instagram: string; linkedin: string; town: string; industry: string; source: string;
  company_type: CompanyType; consent: boolean; consent_note: string;
  stage: Stage; lost_reason: string; sequence_id: string | null; step: number; started_on: string | null; next_on: string | null;
  call_at: string | null; personal_line: string; note: string; unsubscribed_at: string | null; bounced_at: string | null;
  client_email: string | null; unsub_token: string | null; created_at: string; updated_at: string;
}
export interface OutreachMessage { id: string; prospect_id: string; sequence_id: string | null; step: number | null; channel: Channel; subject: string; body: string; status: 'sent' | 'skipped' | 'failed'; sent_at: string; by: string; error?: string | null }

/* ---------- May this prospect be emailed? ---------- */

export function canEmail(p: Pick<Prospect, 'email' | 'company_type' | 'consent' | 'unsubscribed_at' | 'bounced_at'>, blocked: Set<string> = new Set()): { ok: boolean; why: string } {
  const email = p.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, why: 'No email address.' };
  if (p.unsubscribed_at || blocked.has(email) || blocked.has(email.split('@')[1])) return { ok: false, why: 'Asked not to be contacted.' };
  if (p.bounced_at) return { ok: false, why: 'Emails to this address bounce.' };
  if (p.company_type === 'limited' || p.company_type === 'llp') return { ok: true, why: 'Limited company: may be emailed, with an easy way to stop.' };
  if (p.consent) return { ok: true, why: 'They said yes to hearing from you.' };
  if (p.company_type === 'unknown') return { ok: false, why: 'Check on Companies House whether they’re a limited company first. Until then, contact them another way.' };
  return { ok: false, why: `${COMPANY_LABEL[p.company_type]}: they need to say yes before a marketing email. Call or message them first.` };
}

/* ---------- Writing the message ---------- */

/** How to greet someone: their first name; "Dr Shah" for a doctor; "Mrs Smith" when only a title and surname are known. */
export function firstName(full: string): string {
  const words = full.trim().split(/\s+/).filter(Boolean);
  const title = words[0]?.replace(/\.$/, '').toLowerCase();
  if (!words.length) return 'there';
  if (/\s(and|&)\s/i.test(full.trim())) return full.trim();   // "Mari and Carys": greet both
  if (!['mr', 'mrs', 'ms', 'miss', 'dr', 'prof'].includes(title)) return words[0];
  const rest = words.slice(1);
  const t = words[0].replace(/\.$/, '');
  if (!rest.length) return 'there';
  if (title === 'dr' || title === 'prof') return `${t} ${rest[rest.length - 1]}`;
  return rest.length >= 2 ? rest[0] : `${t} ${rest[0]}`;
}

/** Fills a template. A line that only held {personal_line} disappears when there's nothing real to say. */
export function fill(template: string, p: Partial<Prospect>, me: { name: string; booking: string }): string {
  const vars: Record<string, string> = {
    first_name: firstName(p.contact_name || ''), name: p.contact_name || '', business: p.business_name || '', town: p.town || '',
    personal_line: (p.personal_line || '').trim(), booking_link: me.booking, my_name: me.name,
  };
  return template
    .split('\n')
    .filter((line) => !(line.includes('{personal_line}') && !vars.personal_line))
    .join('\n')
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The footer every outreach email carries: who it's from and how to stop. */
export const emailFooter = (sender: string, unsubscribeUrl: string) =>
  `\n\n--\n${sender}\nNot for you? Reply “stop” or use this link and you won’t hear from Gainora again: ${unsubscribeUrl}`;

/* ---------- When the next message is due ---------- */

/** After step `sent` goes out (on `on`), the step that comes next and its date, counted from the first message. */
export function afterSend(seq: Pick<Sequence, 'steps'>, sent: number, startedOn: string): { step: number; next_on: string | null } {
  const next = sent + 1;
  if (next >= seq.steps.length) return { step: next, next_on: null };
  return { step: next, next_on: addDays(startedOn, Math.max(0, seq.steps[next].day)) };
}

/** Prospects whose next message is due on or before today and who haven't replied or opted out. */
export function dueFollowUps<T extends Pick<Prospect, 'next_on' | 'stage' | 'unsubscribed_at'>>(list: T[], today: string): T[] {
  return list.filter((p) => p.next_on && p.next_on <= today && (p.stage === 'new' || p.stage === 'contacted') && !p.unsubscribed_at)
    .sort((a, b) => a.next_on!.localeCompare(b.next_on!));
}

/* ---------- How the outreach is doing ---------- */

export function funnel(list: Pick<Prospect, 'stage' | 'sequence_id'>[], messages: Pick<OutreachMessage, 'prospect_id' | 'sent_at' | 'status'>[], today: string) {
  const by = Object.fromEntries(STAGES.map((s) => [s.id, 0])) as Record<Stage, number>;
  for (const p of list) by[p.stage]++;
  const reached = list.length - by.new;
  const replied = by.replied + by.call + by.proposal + by.won + (by.lost);
  const weekAgo = addDays(today, -6);
  const sentThisWeek = messages.filter((m) => m.status === 'sent' && m.sent_at.slice(0, 10) >= weekAgo).length;
  return {
    by, total: list.length, reached, sentThisWeek,
    replyRate: reached ? (by.replied + by.call + by.proposal + by.won) / reached : null,
    callRate: reached ? (by.call + by.proposal + by.won) / reached : null,
    winRate: by.call + by.proposal + by.won ? by.won / (by.call + by.proposal + by.won) : null,
    repliedOrDone: replied,
  };
}

/* ---------- Importing a list ---------- */

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const src = text.replace(/^﻿/, '');
  const head = src.split('\n')[0];
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : head.includes('\t') && !head.includes(',') ? '\t' : ',';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) { if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell.trim()); cell = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

const COLS: [keyof Prospect, RegExp][] = [
  ['business_name', /^(business|company|clinic|salon|practice|name of business|business name|organisation|organization)$/i],
  ['contact_name', /^(contact|owner|contact name|owner name|name|person|first name|full name)$/i],
  ['role', /role|title|position/i], ['email', /e-?mail/i], ['phone', /phone|tel|mobile/i], ['website', /website|site|url|web/i],
  ['instagram', /instagram|insta|^ig$/i], ['linkedin', /linkedin/i], ['town', /town|city|area|location|place/i],
  ['company_type', /company type|legal|entity|ltd|companies house/i], ['industry', /industry|type|category|sector|kind/i], ['source', /source|found/i],
  ['note', /note|comment/i], ['personal_line', /personal|hook|observation|real line/i],
];

/** Prospects from a spreadsheet (CSV): columns are matched by name; rows without a business name are skipped. */
export function prospectsFromCsv(text: string): { rows: Partial<Prospect>[]; skipped: number } {
  const all = parseCsv(text);
  if (all.length < 2) return { rows: [], skipped: 0 };
  const head = all[0];
  const map = new Map<number, keyof Prospect>();
  head.forEach((h, i) => { for (const [k, re] of COLS) if (re.test(h.trim()) && ![...map.values()].includes(k)) { map.set(i, k); break; } });
  const rows: Partial<Prospect>[] = []; let skipped = 0;
  for (const r of all.slice(1)) {
    const p: Partial<Prospect> = {};
    map.forEach((k, i) => { (p as any)[k] = String(r[i] ?? '').trim().slice(0, 300); });
    if (!p.business_name) { skipped++; continue; }
    if (p.email) p.email = p.email.toLowerCase();
    const ct = String(p.company_type || '').toLowerCase();
    p.company_type = /ltd|limited/.test(ct) ? 'limited' : /llp/.test(ct) ? 'llp' : /sole/.test(ct) ? 'sole_trader' : /partner/.test(ct) ? 'partnership' : 'unknown';
    if (/\b(ltd|limited)\b\.?$/i.test(p.business_name)) p.company_type = 'limited';
    rows.push(p);
  }
  return { rows, skipped };
}

/** The same business twice: same email, website domain or phone digits. */
export function sameProspect(a: Partial<Prospect>, b: Partial<Prospect>): boolean {
  const dom = (u?: string) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const digits = (s?: string) => String(s || '').replace(/\D/g, '').replace(/^44/, '0');
  return (!!a.email && a.email.toLowerCase() === String(b.email || '').toLowerCase())
    || (!!dom(a.website) && dom(a.website) === dom(b.website))
    || (digits(a.phone).length >= 10 && digits(a.phone) === digits(b.phone));
}

/* ---------- The starting messages (from Gainora's outreach kit) ---------- */

export const DEFAULT_SEQUENCES: Omit<Sequence, 'id'>[] = [
  {
    name: 'Clinics by email', active: true,
    steps: [
      { day: 0, channel: 'email', subject: 'Calls at {business} while you’re with clients', body: `Hi {first_name},

{personal_line}

I’m {my_name}, founder of Gainora. I help beauty and aesthetics clinics answer every call and turn more of them into bookings, including the ones that come in while the team is with clients or after closing.

I’m offering a free 15-minute call to a few clinics this month. We’d look at how calls and enquiries reach you now and where bookings might be slipping through. I’ll share anything useful I spot, whether or not we work together.

If that sounds useful, pick any time here: {booking_link}

Thanks,
{my_name}
Founder, Gainora
gainora.co.uk` },
      { day: 4, channel: 'email', subject: 'Re: Calls at {business} while you’re with clients', body: `Hi {first_name}, just bumping this up in case it got buried in a busy week. Happy to work around clinic hours, early or late: {booking_link}

If now’s not the time, no problem at all, and thanks for reading.

{my_name}` },
    ],
  },
  {
    name: 'Clinics on LinkedIn', active: true,
    steps: [
      { day: 0, channel: 'linkedin', subject: 'Connection note', body: 'Hi {first_name}, I’m {my_name}, founder of Gainora. I work with beauty and aesthetics clinics on catching the calls and bookings that come in while the team’s with clients. I’d love to connect and hear how {business} handles it.' },
      { day: 3, channel: 'linkedin', subject: 'Message once they accept', body: `Thanks for connecting, {first_name}. Quick question: when the whole team’s with clients, what happens to the calls coming in?

I’m offering a few clinic owners a free 15-minute call this month to look at where bookings might be slipping through. If you’re up for it: {booking_link}

No pressure either way.` },
      { day: 7, channel: 'linkedin', subject: 'One follow-up', body: `Hi {first_name}, just bumping this up in case it got buried in a busy week. Happy to work around clinic hours, early or late: {booking_link}

If now’s not the time, no problem at all, and thanks for reading.

{my_name}` },
    ],
  },
  {
    name: 'People you know (WhatsApp)', active: true,
    steps: [
      { day: 0, channel: 'whatsapp', subject: 'First message', body: `Hi {first_name}, hope you’re well! Quick one: I’ve just gone full time on my business, Gainora. I’m starting with beauty and aesthetics clinics, helping them catch the calls and bookings that slip through when everyone’s with clients.

Would you be up for a free 15-minute chat so I can hear how it works at {business}? Even if it’s not for you, your honest view would really help.

Here’s my calendar if it’s easier: {booking_link}

{my_name}` },
      { day: 4, channel: 'whatsapp', subject: 'Follow-up', body: 'Hey {first_name}, no worries if you’ve been flat out! Still keen to grab 15 minutes when it suits, even a quick call between clients works.' },
    ],
  },
];
