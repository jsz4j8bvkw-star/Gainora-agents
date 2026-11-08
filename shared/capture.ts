// Capture & Convert: the parts Gainora owns around a bought-in AI receptionist.
// Everything here is pure (no network), so the phone platform can be swapped without touching it:
//  - receptionistPack: the script and answers we paste into whichever platform the client is on
//  - normaliseEnquiry: turns any platform's webhook (or a web form / forwarded email) into one shape
//  - triage: flags emergencies and sorts enquiries so the owner sees what matters first
//  - reminder templates: quote chasers, payment reminders and review requests the owner approves and sends

export const GAS_EMERGENCY = '0800 111 999';

/* ---------- Receptionist setup pack ---------- */

export type QuotePolicy = 'never' | 'ranges' | 'fixed';

export interface ReceptionistSetup {
  hours?: string;             // "Mon–Fri 8am–6pm, Sat 9am–1pm"
  areas?: string;             // "Truro and 20 miles around"
  services?: string[];        // what they do
  notDone?: string[];         // what they don't do, so the agent can say no politely
  emergencies?: string[];     // what counts as urgent for this business
  quotePolicy?: QuotePolicy;  // whether the agent may talk about prices
  priceNotes?: string;        // the ranges or fixed prices it may give
  transferTo?: string;        // who gets urgent calls, e.g. "Dave on 07…" (kept as the owner wrote it)
  booking?: 'calendar' | 'callback';
  gasWork?: boolean;          // heating / gas engineers get the gas-escape script
  recording?: boolean;        // calls are recorded (default true)
}

export interface PackSection { title: string; lines: string[] }
export interface ReceptionistPack { greeting: string; sections: PackSection[]; text: string }

interface ProfileLike {
  business: { name: string; ownerName?: string; location?: string; oneLiner?: string; industry?: string; website?: string };
  offer?: { products?: string; typicalPrice?: string };
  customers?: { areas?: string[] };
}

const clean = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (xs: unknown, max = 12) => (Array.isArray(xs) ? xs : []).map((x) => clean(x, 120)).filter(Boolean).slice(0, max);

const DEFAULT_EMERGENCIES = ['water leaking or flooding', 'no heating or hot water for someone vulnerable', 'no power', 'a security risk, such as a broken lock or window'];

/** The greeting always says it's an AI and, when calls are recorded, says so. */
export function greetingFor(businessName: string, recording = true): string {
  const name = clean(businessName, 80) || 'the business';
  return `Hi, you're through to ${name}. I'm their AI assistant${recording ? ', and calls are recorded so we can help you properly' : ''}. How can I help?`;
}

/**
 * The script and knowledge for the receptionist, written from the client's Gainora profile plus what the
 * onboarding call adds. It's plain text, so it pastes into any platform's prompt and knowledge fields.
 */
export function receptionistPack(profile: ProfileLike, setup: ReceptionistSetup = {}): ReceptionistPack {
  const b = profile.business;
  const name = clean(b.name, 80) || 'the business';
  const owner = clean(b.ownerName, 40) || 'the owner';
  const recording = setup.recording !== false;
  const greeting = greetingFor(name, recording);
  const services = list(setup.services).length ? list(setup.services) : [clean(profile.offer?.products) || clean(b.oneLiner)].filter(Boolean);
  const areas = clean(setup.areas) || [clean(b.location), ...list(profile.customers?.areas)].filter(Boolean).join(', ');
  const emergencies = list(setup.emergencies).length ? list(setup.emergencies) : DEFAULT_EMERGENCIES;
  const policy: QuotePolicy = setup.quotePolicy ?? 'never';
  const booking = setup.booking ?? 'callback';

  const sections: PackSection[] = [
    { title: 'Who you are', lines: [
      `You answer the phone for ${name}${b.location ? `, based in ${clean(b.location, 80)}` : ''}. ${clean(b.oneLiner)}`.trim(),
      'You are an AI assistant. Say so if asked, and never pretend to be a person.',
      'Be warm, brief and plain-spoken. British English. One question at a time.',
    ] },
    { title: 'Opening line', lines: [greeting] },
    { title: 'What we do', lines: [...services, ...(list(setup.notDone).length ? [`We don't do: ${list(setup.notDone).join(', ')}. Say so kindly and don't recommend anyone else.`] : [])] },
    { title: 'Where and when', lines: [
      areas ? `Areas covered: ${areas}. If the job is outside this, take the details anyway and say ${owner} will confirm.` : `Take the address for every job; ${owner} confirms the area.`,
      setup.hours ? `Opening hours: ${clean(setup.hours)}. Outside these hours, still take full details.` : 'Take full details at any time of day.',
    ] },
    { title: 'Details to collect, every call', lines: [
      'Name.', 'Best phone number (read it back to check).', 'Address with postcode (spell back the postcode).',
      'What the problem or job is, in their words, and how long it has been going on.',
      'When suits them for a visit or a call back.', 'How they found us.',
    ] },
    { title: 'Emergencies', lines: [
      `Treat these as urgent: ${emergencies.join('; ')}.`,
      setup.transferTo ? `For an urgent job, say you're passing it straight to the team and transfer or alert: ${clean(setup.transferTo, 120)}.` : `For an urgent job, say you're flagging it to ${owner} straight away and that they'll call back as soon as they can. Don't promise a time.`,
      ...(setup.gasWork !== false ? [`If the caller can smell gas or thinks there's a gas leak: tell them to call the National Gas Emergency number, ${GAS_EMERGENCY}, now, and to leave the property if they feel unsafe. Don't give any other safety advice.`] : []),
      'If anyone is in danger or hurt, tell them to call 999.',
    ] },
    { title: 'Prices', lines: [
      policy === 'never' ? `Don't give prices. Say ${owner} gives every quote personally after a quick look, and offer a visit or call back.`
        : policy === 'ranges' ? `You may give these guide prices only, and always say the final price is confirmed after a look: ${clean(setup.priceNotes) || clean(profile.offer?.typicalPrice) || 'ask the owner for ranges before going live'}.`
        : `These are fixed prices you may quote: ${clean(setup.priceNotes) || 'ask the owner for the price list before going live'}. Anything not listed gets a call back.`,
      'Never agree discounts, refunds or guarantees.',
    ] },
    { title: 'Booking', lines: [
      booking === 'calendar' ? 'Offer the first free slots from the calendar that suit the caller, and confirm the day, time and address back to them.'
        : `Don't book a time. Take the details and say ${owner} will call back to arrange it.`,
      'At the end, sum up what happens next in one sentence.',
    ] },
    { title: 'Never', lines: [
      'Never take card or bank details over the phone.',
      'Never give technical or safety advice beyond the emergency lines above.',
      'Never criticise other businesses or previous tradespeople.',
      'Never make up an answer: if unsure, say you will check and someone will call back.',
    ] },
    { title: 'Your information', lines: [
      `If asked, say the details are only used by ${name} to deal with the enquiry${recording ? ', and that recordings are kept for a limited time' : ''}. ${b.website ? `More is on ${clean(b.website, 120)}.` : ''}`.trim(),
    ] },
  ];

  const text = [`# Receptionist for ${name}`, ...sections.map((s) => `## ${s.title}\n${s.lines.map((l) => `- ${l}`).join('\n')}`)].join('\n\n');
  return { greeting, sections, text };
}

/* ---------- Enquiries from any source ---------- */

export type Channel = 'call' | 'form' | 'email' | 'text';
export interface Enquiry {
  channel: Channel;
  externalId: string | null;
  name: string;
  phone: string;
  email: string;
  postcode: string;
  summary: string;
  transcript: string;
  recordingUrl: string;
  receivedAt: string;
}

const pick = (o: any, keys: string[]): string => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
};

/** Transcripts sometimes arrive as lists of turns. */
function transcriptText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((t: any) => (typeof t === 'string' ? t : `${t?.role ?? t?.speaker ?? ''}: ${t?.content ?? t?.text ?? t?.message ?? ''}`)).join('\n');
  return '';
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
export function findPostcode(text: string): string {
  const m = text.match(POSTCODE);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : '';
}

/** UK numbers in one shape (+44…), so the same caller is recognised however the platform writes it. */
export function normPhone(raw: string): string {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(0, 16);
  if (d.startsWith('00')) return `+${d.slice(2)}`.slice(0, 16);
  if (d.startsWith('44')) return `+${d}`.slice(0, 16);
  if (d.startsWith('0')) return `+44${d.slice(1)}`.slice(0, 16);
  return d.slice(0, 16);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accepts the webhook body from whichever platform sends it. Known shapes: Retell ("call_analyzed" with a
 * `call` object) and the flat JSON most platforms, Zapier and web forms send. Unknown keys are ignored;
 * anything nested under `call`, `data`, `payload` or `message` is looked at too.
 */
export function normaliseEnquiry(raw: any, hint?: Channel, now = new Date()): Enquiry | null {
  if (!raw || typeof raw !== 'object') return null;
  const layers = [raw, raw.call, raw.data, raw.payload, raw.message, raw.data?.call].filter((x) => x && typeof x === 'object');
  const get = (keys: string[]) => { for (const l of layers) { const v = pick(l, keys); if (v) return v; } return ''; };
  const analysis = layers.map((l) => l.call_analysis || l.analysis).find(Boolean) || {};
  const custom = analysis.custom_analysis_data || {};

  const transcript = transcriptText(layers.map((l) => l.transcript ?? l.transcript_object ?? l.messages).find((t) => t != null)).slice(0, 20000);
  const summary = (pick(analysis, ['call_summary', 'summary']) || get(['summary', 'call_summary', 'message', 'notes', 'enquiry', 'description', 'body', 'text'])).slice(0, 2000);
  const name = (pick(custom, ['caller_name', 'name', 'customer_name']) || get(['caller_name', 'customer_name', 'contact_name', 'name', 'full_name', 'from_name'])).slice(0, 120);
  const phone = normPhone(pick(custom, ['phone', 'callback_number']) || get(['from_number', 'caller_number', 'phone', 'phone_number', 'from', 'callback_number', 'mobile']));
  const emailRaw = (pick(custom, ['email']) || get(['email', 'email_address', 'from_email', 'reply_to'])).toLowerCase();
  const email = EMAIL.test(emailRaw) ? emailRaw.slice(0, 200) : '';
  if (!summary && !transcript && !phone && !email) return null;

  const channel: Channel = hint ?? (raw.call || transcript || get(['call_id']) ? 'call' : email && !phone ? 'email' : 'form');
  const ts = get(['end_timestamp', 'start_timestamp', 'timestamp', 'created_at', 'received_at', 'date']);
  const when = ts ? new Date(/^\d+$/.test(ts) ? Number(ts) : ts) : now;
  return {
    channel,
    externalId: (get(['call_id', 'id', 'message_id', 'submission_id']) || '').slice(0, 120) || null,
    name, phone, email,
    postcode: findPostcode(pick(custom, ['postcode', 'address']) || get(['postcode', 'address']) || `${summary}\n${transcript}`),
    summary, transcript,
    recordingUrl: /^https:\/\//.test(get(['recording_url'])) ? get(['recording_url']).slice(0, 500) : '',
    receivedAt: Number.isNaN(when.getTime()) ? now.toISOString() : when.toISOString(),
  };
}

/* ---------- Triage ---------- */

export type Urgency = 'emergency' | 'urgent' | 'normal';
export type EnquiryKind = 'quote' | 'booking' | 'callback' | 'complaint' | 'spam' | 'other';
export interface Triage { urgency: Urgency; kind: EnquiryKind; gas: boolean; reasons: string[] }

const GAS = /\b(smell(s|ing)? (of )?gas|gas (leak|smell|escape)|leaking gas)\b/i;
const EMERGENCY = /\b(flood(ed|ing)?|burst|water (pouring|everywhere|coming through)|no (heating|heat|hot water|power|electric(ity)?)|sparking|smoke|fire|carbon monoxide|co alarm|locked out|break[- ]?in|broken (lock|window|door)|ceiling (collaps|coming down)|sewage|overflowing)\b/i;
const URGENT = /\b(urgent(ly)?|asap|as soon as possible|today|tonight|emergency|right away|leak(ing)?|dripping|not working|broken down|boiler)\b/i;
const VULNERABLE = /\b(elderly|baby|newborn|disabled|pregnant|vulnerable|poorly|oxygen)\b/i;
const COMPLAINT = /\b(complain|complaint|not happy|unhappy|disappointed|refund|still broken|came back|botched|shoddy)\b/i;
const SPAM = /\b(seo|backlinks?|google ranking|marketing agency|business loan|merchant (services|account)|crypto|we can get you more (leads|customers))\b/i;
const QUOTE = /\b(quote|price|how much|cost|estimate)\b/i;
const BOOK = /\b(book|appointment|come out|visit|available|slot|service (my|the))\b/i;
const CALLBACK = /\b(call (me )?back|ring (me )?back|callback)\b/i;

export function triage(text: string): Triage {
  const t = String(text || '');
  const reasons: string[] = [];
  const gas = GAS.test(t);
  let urgency: Urgency = 'normal';
  if (gas) { urgency = 'emergency'; reasons.push('Caller mentioned a gas smell or leak'); }
  else if (EMERGENCY.test(t)) { urgency = 'emergency'; reasons.push(`Mentions: ${t.match(EMERGENCY)![0].toLowerCase()}`); }
  else if (URGENT.test(t)) { urgency = 'urgent'; reasons.push(`Mentions: ${t.match(URGENT)![0].toLowerCase()}`); }
  if (VULNERABLE.test(t) && urgency !== 'emergency') { urgency = 'urgent'; reasons.push('Someone vulnerable may be affected'); }
  if (VULNERABLE.test(t) && urgency === 'emergency') reasons.push('Someone vulnerable may be affected');

  const kind: EnquiryKind = SPAM.test(t) && urgency === 'normal' ? 'spam'
    : COMPLAINT.test(t) ? 'complaint'
    : QUOTE.test(t) ? 'quote'
    : BOOK.test(t) ? 'booking'
    : CALLBACK.test(t) ? 'callback'
    : 'other';
  return { urgency, kind, gas, reasons };
}

/* ---------- Enquiry status ---------- */

export type EnquiryStatus = 'new' | 'replied' | 'quoted' | 'booked' | 'won' | 'lost' | 'spam';
export const ENQUIRY_STATUSES: { id: EnquiryStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'replied', label: 'Replied' },
  { id: 'quoted', label: 'Quote sent' },
  { id: 'booked', label: 'Booked in' },
  { id: 'won', label: 'Job done' },
  { id: 'lost', label: 'Didn’t go ahead' },
  { id: 'spam', label: 'Spam' },
];

/** Days after a quote is sent when each chaser is due. */
export const QUOTE_CHASE_DAYS = [3, 8];

export function quoteChaseDue(quotedAt: string | null | undefined, chasersSent: number, now = new Date()): boolean {
  if (!quotedAt) return false;
  const days = QUOTE_CHASE_DAYS[chasersSent];
  if (days == null) return false;
  const due = new Date(quotedAt); due.setDate(due.getDate() + days);
  return due.getTime() <= now.getTime();
}

/* ---------- Messages the owner approves and sends ---------- */

export const MARKETING_OPT_OUT = 'If you’d rather not hear from us about this, just reply STOP.';

export interface MessageContext {
  business: string;
  owner: string;
  customer?: string;      // first name if known
  job?: string;           // "the boiler service"
  amount?: string;        // "£240"
  dueDate?: string;       // "14 November"
  invoiceRef?: string;
  payLink?: string;       // the client's own payment link
  reviewLink?: string;    // the client's Google review link
}

const hi = (c: MessageContext) => (c.customer ? `Hi ${clean(c.customer, 40)},` : 'Hi,');
const sign = (c: MessageContext) => `${clean(c.owner, 40)}\n${clean(c.business, 80)}`;

/** First reply to a new enquiry, short enough for a text. A service message: no opt-out needed. */
export function firstReply(c: MessageContext, kind: EnquiryKind, channel: Channel): string {
  const what = kind === 'quote' ? 'a price for the job' : kind === 'booking' ? 'getting you booked in' : 'your enquiry';
  const body = `${hi(c)} thanks for getting in touch with ${clean(c.business, 80)} about ${c.job ? clean(c.job, 80) : what}. I'll call you back today to sort the details.`;
  return channel === 'email' ? `Subject: Your enquiry with ${clean(c.business, 80)}\n\n${body}\n\n${sign(c)}` : `${body} ${clean(c.owner, 40)}`;
}

/** Quote chasers: a friendly check-in, then a final one. Service messages about a quote they asked for. */
export function quoteChaser(c: MessageContext, n: 1 | 2): string {
  const job = c.job ? clean(c.job, 80) : 'the job';
  if (n === 1) return `${hi(c)} just checking the quote for ${job}${c.amount ? ` (${c.amount})` : ''} reached you. Happy to answer any questions or adjust anything. ${clean(c.owner, 40)}, ${clean(c.business, 80)}`;
  return `${hi(c)} I won't keep chasing about ${job}. If you'd like to go ahead later, just reply here and I'll get you booked in. Thanks, ${clean(c.owner, 40)}, ${clean(c.business, 80)}`;
}

/** Payment reminders: stage 1 on the due date, 2 a week later, 3 two weeks later. Polite at every stage. */
export function paymentReminder(c: MessageContext, stage: 1 | 2 | 3): string {
  const ref = c.invoiceRef ? ` (invoice ${clean(c.invoiceRef, 40)})` : '';
  const amount = c.amount ? clean(c.amount, 20) : 'the balance';
  const pay = c.payLink ? ` You can pay here: ${clean(c.payLink, 300)}` : '';
  if (stage === 1) return `${hi(c)} a friendly reminder that ${amount} for ${c.job ? clean(c.job, 80) : 'the recent work'}${ref} is due${c.dueDate ? ` on ${clean(c.dueDate, 40)}` : ' today'}.${pay} Thank you! ${clean(c.owner, 40)}, ${clean(c.business, 80)}`;
  if (stage === 2) return `${hi(c)} our records show ${amount}${ref} is still outstanding. If you've already paid, thank you and please ignore this.${pay} If something's wrong with the invoice, just reply and I'll sort it. ${clean(c.owner, 40)}, ${clean(c.business, 80)}`;
  return `${hi(c)} ${amount}${ref} is now two weeks overdue. Could you let me know when it will be paid, or call me if there's a problem we can sort out together?${pay} ${clean(c.owner, 40)}, ${clean(c.business, 80)}`;
}

/** Stage of payment reminder due for an unpaid invoice, or null if none is due yet / all sent. */
export function paymentStageDue(dueDate: string, remindersSent: number, now = new Date()): 1 | 2 | 3 | null {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const daysLate = Math.floor((now.getTime() - due.getTime()) / 864e5);
  const stage = daysLate >= 14 ? 3 : daysLate >= 7 ? 2 : daysLate >= 0 ? 1 : 0;
  return stage > remindersSent ? (Math.min(stage, remindersSent + 1) as 1 | 2 | 3) : null;
}

/** Review request after a finished job. Treated as marketing, so it always carries an opt-out. */
export function reviewRequest(c: MessageContext): string {
  const link = c.reviewLink ? ` If you have a minute, a Google review really helps a small business like ours: ${clean(c.reviewLink, 300)}` : ' If you have a minute, a Google review really helps a small business like ours.';
  return `${hi(c)} thanks for choosing ${clean(c.business, 80)}${c.job ? ` for ${clean(c.job, 80)}` : ''}. I hope everything's working well.${link} ${clean(c.owner, 40)}\n\n${MARKETING_OPT_OUT}`;
}
