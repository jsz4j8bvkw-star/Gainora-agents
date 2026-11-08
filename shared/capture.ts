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
const URGENT = /\b(urgent(ly)?|asap|as soon as possible|today|tonight|emergency|right away|leak(ing)?|dripping|not working|broken down|stopped working)\b/i;
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

/* ======================================================================
   The app's own data: settings, enquiry records, follow-up queue, report
   ====================================================================== */

export interface CaptureSettings {
  business: { name: string; ownerName: string; trade: string; location: string; website: string; phone: string; alertEmail: string; alertMobile: string };
  work: { services: string; notDone: string; areas: string };          // one per line
  calls: {
    days: number[]; open: string; close: string;                        // 1 = Monday … 7 = Sunday, "08:00"
    emergencies: string; transferTo: string;
    quotePolicy: QuotePolicy; priceNotes: string;
    booking: 'calendar' | 'callback'; gasWork: boolean; recording: boolean;
    notify: 'all' | 'urgent';
  };
  followUps: { reviewLink: string; payLink: string; paymentDays: number };
  provider: { name: string; aiNumber: string };
  completedAt?: string;
}

export const TRADES = ['Plumbing and heating', 'Electrical', 'Building and renovation', 'Roofing', 'Locksmith', 'Cleaning', 'Landscaping and gardening', 'Pest control', 'Removals', 'Other trade or home service'];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function emptySettings(email = ''): CaptureSettings {
  return {
    business: { name: '', ownerName: '', trade: '', location: '', website: '', phone: '', alertEmail: email, alertMobile: '' },
    work: { services: '', notDone: '', areas: '' },
    calls: { days: [1, 2, 3, 4, 5], open: '08:00', close: '17:30', emergencies: '', transferTo: '', quotePolicy: 'never', priceNotes: '', booking: 'callback', gasWork: false, recording: true, notify: 'urgent' },
    followUps: { reviewLink: '', payLink: '', paymentDays: 14 },
    provider: { name: '', aiNumber: '' },
  };
}

/** One item per line (semicolons work too). Commas are kept: “Leaks, taps and toilets” is one item. */
export const lines = (s: string | undefined) => String(s ?? '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);

export function hoursText(c: CaptureSettings['calls']): string {
  const d = [...c.days].sort((a, b) => a - b);
  if (!d.length) return '';
  const runs: string[] = [];
  let start = d[0], prev = d[0];
  for (const x of [...d.slice(1), 99]) {
    if (x === prev + 1) { prev = x; continue; }
    runs.push(start === prev ? DAYS[start - 1] : `${DAYS[start - 1]}–${DAYS[prev - 1]}`);
    start = x; prev = x;
  }
  const t = (s: string) => { const [h, m] = s.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`; };
  return `${runs.join(', ')} ${t(c.open)}–${t(c.close)}`;
}

/** The receptionist pack from the app's settings. */
export function packFromSettings(s: CaptureSettings): ReceptionistPack {
  return receptionistPack(
    { business: { name: s.business.name, ownerName: s.business.ownerName, location: s.business.location, website: s.business.website, oneLiner: s.business.trade ? `A ${s.business.trade.toLowerCase()} business.` : '' } },
    {
      hours: hoursText(s.calls), areas: s.work.areas, services: lines(s.work.services), notDone: lines(s.work.notDone),
      emergencies: lines(s.calls.emergencies), quotePolicy: s.calls.quotePolicy, priceNotes: s.calls.priceNotes,
      transferTo: s.calls.transferTo, booking: s.calls.booking, gasWork: s.calls.gasWork, recording: s.calls.recording,
    },
  );
}

/** Day of week (1–7) and minutes past midnight, in UK time. */
export function londonClock(iso: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: DAYS.indexOf(get('weekday')) + 1, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isAfterHours(iso: string, c: Pick<CaptureSettings['calls'], 'days' | 'open' | 'close'>): boolean {
  const { day, minutes } = londonClock(iso);
  if (!c.days.includes(day)) return true;
  const m = (s: string) => { const [h, mm] = String(s || '0:0').split(':').map(Number); return h * 60 + (mm || 0); };
  return minutes < m(c.open) || minutes >= m(c.close);
}

export interface HistoryItem { at: string; text: string }

export interface EnquiryRecord {
  id: string;
  channel: Channel;
  name: string; phone: string; email: string; postcode: string;
  summary: string; transcript: string; recordingUrl: string;
  urgency: Urgency; kind: EnquiryKind; reasons: string[];
  status: EnquiryStatus;
  afterHours: boolean;
  notes: string;
  history: HistoryItem[];
  repliedAt: string | null;
  quoteAmount: number | null; quotedAt: string | null; chasersSent: number;
  bookedFor: string | null;
  jobValue: number | null; invoiceDue: string | null; paidAt: string | null; paymentRemindersSent: number;
  reviewAskedAt: string | null;
  receivedAt: string;
  isTest: boolean;
}

export interface EnquiryPatch {
  status?: EnquiryStatus;
  quoteAmount?: number | null;
  bookedFor?: string | null;
  jobValue?: number | null;
  invoiceDue?: string | null;
  paid?: boolean;
  chaserSent?: boolean;
  paymentReminderSent?: boolean;
  reviewAsked?: boolean;
  replied?: boolean;
  notes?: string;
  kind?: EnquiryKind;
  name?: string; phone?: string; email?: string; postcode?: string;
}

export const STATUS_LABEL: Record<EnquiryStatus, string> = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s.id, s.label])) as Record<EnquiryStatus, string>;
export const KIND_LABEL: Record<EnquiryKind, string> = { quote: 'Quote', booking: 'Booking', callback: 'Call back', complaint: 'Complaint', spam: 'Spam', other: 'Enquiry' };
export const CHANNEL_LABEL: Record<Channel, string> = { call: 'Phone call', form: 'Website form', email: 'Email', text: 'Text' };

const DAY_MS = 86_400_000;
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * DAY_MS).toISOString();

/** Works out the record after a change: dates stamped, counters moved, history written. Pure, so the server and the demo agree. */
export function applyPatch(e: EnquiryRecord, p: EnquiryPatch, settings: Pick<CaptureSettings, 'followUps'> | null, now = new Date()): EnquiryRecord {
  const at = now.toISOString();
  const next: EnquiryRecord = { ...e, history: [...e.history] };
  const log = (text: string) => next.history.push({ at, text });
  const money = (n: number | null | undefined) => (n == null ? '' : ` (£${n.toLocaleString('en-GB')})`);

  for (const k of ['name', 'phone', 'email', 'postcode'] as const) if (typeof p[k] === 'string') next[k] = k === 'phone' ? normPhone(p[k]!) : p[k]!.trim().slice(0, 200);
  if (p.kind && p.kind !== e.kind) { next.kind = p.kind; log(`Marked as ${KIND_LABEL[p.kind].toLowerCase()}`); }
  if (typeof p.notes === 'string') next.notes = p.notes.slice(0, 4000);
  if (p.replied && !next.repliedAt) { next.repliedAt = at; log('Replied to the customer'); if (next.status === 'new') next.status = 'replied'; }
  if (p.quoteAmount !== undefined) next.quoteAmount = p.quoteAmount;
  if (p.bookedFor !== undefined) next.bookedFor = p.bookedFor;
  if (p.jobValue !== undefined) next.jobValue = p.jobValue;
  if (p.invoiceDue !== undefined) next.invoiceDue = p.invoiceDue;

  if (p.status && p.status !== e.status) {
    next.status = p.status;
    if (['replied', 'quoted', 'booked', 'won'].includes(p.status) && !next.repliedAt) next.repliedAt = at;
    if (p.status === 'quoted') { next.quotedAt = at; next.chasersSent = 0; log(`Quote sent${money(next.quoteAmount)}`); }
    else if (p.status === 'booked') log(next.bookedFor ? `Booked in for ${new Date(next.bookedFor).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Booked in');
    else if (p.status === 'won') {
      if (!next.invoiceDue && next.jobValue) next.invoiceDue = addDays(at, settings?.followUps.paymentDays ?? 14).slice(0, 10);
      log(`Job done${money(next.jobValue)}`);
    }
    else if (p.status === 'lost') log('Didn’t go ahead');
    else if (p.status === 'spam') log('Filed as spam');
    else log(`Moved to ${STATUS_LABEL[p.status].toLowerCase()}`);
  } else if (p.status === 'won' && p.jobValue !== undefined) log(`Job value set${money(next.jobValue)}`);

  if (p.chaserSent) { next.chasersSent = e.chasersSent + 1; log(`Quote chaser ${next.chasersSent} sent`); }
  if (p.paymentReminderSent) { next.paymentRemindersSent = e.paymentRemindersSent + 1; log(`Payment reminder ${next.paymentRemindersSent} sent`); }
  if (p.paid === true && !e.paidAt) { next.paidAt = at; log('Paid'); }
  if (p.paid === false && e.paidAt) { next.paidAt = null; log('Marked as unpaid'); }
  if (p.reviewAsked && !e.reviewAskedAt) { next.reviewAskedAt = at; log('Review requested'); }
  return next;
}

/* ---------- The follow-up queue ---------- */

export type FollowKind = 'quote' | 'payment' | 'review';
export interface FollowItem { enquiry: EnquiryRecord; kind: FollowKind; stage: number; label: string; due: boolean; dueAt: string }

export function followUps(list: EnquiryRecord[], now = new Date()): FollowItem[] {
  const out: FollowItem[] = [];
  for (const e of list) {
    if (e.isTest) continue;
    if (e.status === 'quoted' && e.quotedAt) {
      const days = QUOTE_CHASE_DAYS[e.chasersSent];
      if (days != null) {
        const dueAt = addDays(e.quotedAt, days);
        out.push({ enquiry: e, kind: 'quote', stage: e.chasersSent + 1, label: e.chasersSent === 0 ? 'First quote chaser' : 'Last quote chaser', due: new Date(dueAt) <= now, dueAt });
      }
    }
    if (e.status === 'won' && e.invoiceDue && !e.paidAt) {
      const stage = paymentStageDue(e.invoiceDue, e.paymentRemindersSent, now);
      const nextStage = e.paymentRemindersSent + 1;
      if (nextStage <= 3) {
        const dueAt = addDays(new Date(e.invoiceDue).toISOString(), [0, 7, 14][nextStage - 1]);
        out.push({ enquiry: e, kind: 'payment', stage: nextStage, label: ['Payment due reminder', 'Payment overdue reminder', 'Final payment reminder'][nextStage - 1], due: stage != null, dueAt });
      }
    }
    if (e.status === 'won' && !e.reviewAskedAt && (e.paidAt || !e.invoiceDue)) {
      const from = e.paidAt ?? e.history.find((h) => h.text.startsWith('Job done'))?.at ?? e.receivedAt;
      const dueAt = addDays(from, 1);
      out.push({ enquiry: e, kind: 'review', stage: 1, label: 'Ask for a review', due: new Date(dueAt) <= now, dueAt });
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/* ---------- Monthly report ---------- */

export interface Report {
  caught: number; afterHours: number; emergencies: number; spam: number;
  replied: number; medianReplyMins: number | null; within1h: number;
  quotes: number; quotedValue: number; booked: number; won: number; wonValue: number; paidValue: number; outstanding: number;
  byChannel: Record<Channel, number>;
  byWeek: { weekOf: string; inHours: number; afterHours: number }[];
}

const mondayIso = (iso: string) => { const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

export function report(list: EnquiryRecord[], from: Date, to: Date): Report {
  const inRange = list.filter((e) => !e.isTest && new Date(e.receivedAt) >= from && new Date(e.receivedAt) < to);
  const real = inRange.filter((e) => e.status !== 'spam');
  const replyMins = real.filter((e) => e.repliedAt).map((e) => Math.max(0, (new Date(e.repliedAt!).getTime() - new Date(e.receivedAt).getTime()) / 60000)).sort((a, b) => a - b);
  const median = replyMins.length ? replyMins[Math.floor((replyMins.length - 1) / 2)] : null;
  const won = real.filter((e) => e.status === 'won');
  const byChannel = { call: 0, form: 0, email: 0, text: 0 } as Record<Channel, number>;
  for (const e of real) byChannel[e.channel]++;
  const weeks = new Map<string, { inHours: number; afterHours: number }>();
  for (let t = new Date(mondayIso(from.toISOString())).getTime(); t < to.getTime(); t += 7 * DAY_MS) weeks.set(new Date(t).toISOString().slice(0, 10), { inHours: 0, afterHours: 0 });
  for (const e of real) { const w = weeks.get(mondayIso(e.receivedAt)); if (w) e.afterHours ? w.afterHours++ : w.inHours++; }
  return {
    caught: real.length, afterHours: real.filter((e) => e.afterHours).length, emergencies: real.filter((e) => e.urgency === 'emergency').length,
    spam: inRange.length - real.length,
    replied: replyMins.length, medianReplyMins: median == null ? null : Math.round(median), within1h: replyMins.filter((m) => m <= 60).length,
    quotes: real.filter((e) => e.quotedAt).length, quotedValue: real.reduce((a, e) => a + (e.quotedAt && e.quoteAmount ? e.quoteAmount : 0), 0),
    booked: real.filter((e) => e.status === 'booked' || e.status === 'won').length,
    won: won.length, wonValue: won.reduce((a, e) => a + (e.jobValue ?? 0), 0),
    paidValue: won.filter((e) => e.paidAt).reduce((a, e) => a + (e.jobValue ?? 0), 0),
    outstanding: won.filter((e) => !e.paidAt && e.invoiceDue).reduce((a, e) => a + (e.jobValue ?? 0), 0),
    byChannel, byWeek: [...weeks.entries()].map(([weekOf, v]) => ({ weekOf, ...v })),
  };
}

export function replyTime(mins: number | null): string {
  if (mins == null) return '–';
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60 * 10) / 10} h`;
  return `${Math.round(mins / 1440)} days`;
}
