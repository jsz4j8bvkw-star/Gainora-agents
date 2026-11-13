// Capture & Convert: the parts Gainora owns around a bought-in AI receptionist.
// Everything here is pure (no network), so the phone platform can be swapped without touching it:
//  - packFromSettings: the script and answers we paste into whichever platform the client is on
//  - normaliseEnquiry: turns any platform's webhook (or a web form / forwarded email) into one shape
//  - triage: flags emergencies and sorts enquiries so the owner sees what matters first
//  - reminder templates: quote chasers, payment reminders and review requests the owner approves and sends

import type { BookingPage, DiaryRules } from './diary';
import { automationsWithDefaults, defaultAutomations, type Automations } from './automations';

export const GAS_EMERGENCY = '0800 111 999';

/* ---------- Receptionist setup pack ---------- */

export type QuotePolicy = 'never' | 'ranges' | 'fixed';
export type BusinessKind = 'trade' | 'appointments';
export type BookingMode = 'book' | 'offer' | 'callback';
/** rebookWeeks: how long after this treatment a client is usually due back (gel nails 3, lashes 6, anti-wrinkle 12). Optional. */
export interface AppointmentType { name: string; minutes: number; price: string; who: string; rebookWeeks?: number }

/* ---------- Prices and intervals from the client's own treatment list ---------- */

export interface Price { amount: number; from: boolean }

/** "£250" → 250; "from £180" → 180 (a minimum); "Free" → 0; "£60-£90" → 60 (a minimum). Anything else is unknown. */
export function parsePrice(raw: string | undefined): Price | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^free$/i.test(s)) return { amount: 0, from: false };
  const m = s.match(/£?\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const from = /\bfrom\b|\+|–|-|\bto\b|\bper\b/i.test(s);
  return { amount, from };
}

const sameName = (a: string, b: string) => clean(a, 80).toLowerCase() === clean(b, 80).toLowerCase();

/** The price of a named appointment type from the owner's list, or null if it isn't listed or has no price. */
export function typePrice(name: string | undefined, types: AppointmentType[]): Price | null {
  if (!name) return null;
  const t = (types || []).find((x) => sameName(x.name, name));
  return t ? parsePrice(t.price) : null;
}

/** What an enquiry is worth: the value the owner entered, or else the list price of what was booked. Never a guess. */
export function enquiryValue(e: Pick<EnquiryRecord, 'jobValue' | 'quoteAmount' | 'bookedType' | 'status'>, s: Pick<CaptureSettings, 'bookings'>): (Price & { source: 'entered' | 'list' }) | null {
  if (e.jobValue != null && e.jobValue > 0) return { amount: e.jobValue, from: false, source: 'entered' };
  if (e.status === 'quoted' && e.quoteAmount) return { amount: e.quoteAmount, from: false, source: 'entered' };
  const p = typePrice(e.bookedType, s.bookings.types);
  return p && p.amount > 0 ? { ...p, source: 'list' } : null;
}

/** Weeks until a client is usually due back after this treatment: the type's own interval, or the clinic's general one. */
export function rebookWeeksFor(bookedType: string | undefined, s: Pick<CaptureSettings, 'bookings' | 'automations'>): number {
  const t = bookedType ? s.bookings.types.find((x) => sameName(x.name, bookedType)) : undefined;
  if (t?.rebookWeeks && t.rebookWeeks > 0) return t.rebookWeeks;
  const days = s.automations?.rebook?.steps?.rebook?.wait ?? 42;
  return Math.max(1, Math.round(days / 7));
}
export interface PackSection { title: string; lines: string[] }
export interface ReceptionistPack { greeting: string; sections: PackSection[]; text: string }

const clean = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const DEFAULT_EMERGENCIES = ['water leaking or flooding', 'no heating or hot water for someone vulnerable', 'no power', 'a security risk, such as a broken lock or window'];
export const DEFAULT_GREETING = '{greeting}, you’re through to {business}. How can I help?';
/** Beauty and aesthetics: concerns after a treatment that go straight to the clinic. Never to 999 or any other service: the clinic decides. */
export const DEFAULT_BEAUTY_SAFETY = 'Severe or worsening pain, swelling or redness after a treatment\nSkin that has turned white, grey, blue or blotchy after a filler or injectable\nAny change to eyesight after a treatment\nSwelling of the lips, tongue or throat, or a rash spreading after a treatment\nBlistering or a burn after laser, a peel or waxing\nSigns of infection after a treatment: hot, painful skin, pus or a high temperature';
export const DEFAULT_SAFETY = 'New numbness or tingling around the bottom, groin or genitals\nNew problems controlling the bladder or bowels\nWeakness in both legs, or getting worse quickly\nChest pain or difficulty breathing\nA recent serious fall or accident';

function timeOfDay(d = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(d));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * The opening line, from the owner's template. {business} and {greeting} are filled in
 * ({greeting} becomes good morning, afternoon or evening). A recording notice is added when calls
 * are recorded, and an AI notice only if the owner chose to announce it.
 */
export function greetingFor(s: Pick<CaptureSettings, 'business' | 'calls'>, now = new Date()): string {
  const name = clean(s.business.name, 80) || 'the business';
  let g = clean(s.calls.greeting || DEFAULT_GREETING, 300).replace(/\{business\}/gi, name).replace(/\{greeting\}/gi, timeOfDay(now));
  g = g.charAt(0).toUpperCase() + g.slice(1);
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const stop = (x: string) => { const t = x.trimEnd().replace(/[,;:–-]$/, '').trimEnd(); return /[.!?]$/.test(t) ? t : `${t}.`; };
  const before = (extra: string) => { const m = g.match(/(How (can|may) I help( you)?( today)?\??)$/i); g = m ? `${stop(g.slice(0, m.index))} ${extra} ${cap(m[1])}` : `${stop(g)} ${extra}`; };
  if (s.calls.announceAi && !/\bAI\b/.test(g)) before('I’m the AI assistant here.');
  if (s.calls.recording && !/record/i.test(g)) before('Calls are recorded for quality and training.');
  return g.replace(/\s+/g, ' ').trim();
}

/**
 * The booking the receptionist can really make. Until Gainora has connected the diary (or when the diary is
 * on paper) she can't see free times, so she takes details and the owner calls back, whatever was chosen.
 */
export function effectiveBookingMode(bk: Pick<Bookings, 'mode' | 'status' | 'system'> & { mirror?: boolean }): BookingMode {
  if (bk.mode === 'callback') return 'callback';
  if (bk.system === GAINORA_DIARY) return bk.mode;   // the diary is Gainora's own, so it's always there
  if (/paper/i.test(bk.system || '')) return 'callback';
  if (bk.status !== 'connected') return 'callback';
  return bk.mirror ? 'offer' : bk.mode;               // a copy of their real diary: offer times, the clinic confirms
}

/** The deposit new clients pay, when the owner set one with a link to pay it; otherwise ''. */
export const depositText = (bk: Pick<Bookings, 'deposit' | 'depositLink' | 'depositOn'>) =>
  bk.depositOn !== false && clean(bk.deposit ?? '', 120) && /^https:\/\//.test(String(bk.depositLink ?? '').trim()) ? clean(bk.deposit ?? '', 120) : '';

/** Everything about the deposit in one place, or null when it's off or not set up. */
export function depositRule(bk: Pick<Bookings, 'deposit' | 'depositLink' | 'depositOn' | 'depositFor' | 'depositTypes' | 'depositWording'>) {
  const what = depositText(bk);
  if (!what) return null;
  const forWho: 'new' | 'all' = bk.depositFor === 'all' ? 'all' : 'new';
  const types = (bk.depositTypes ?? []).map((t) => clean(t, 80)).filter(Boolean);
  const wording = clean(bk.depositWording ?? '', 400) || (forWho === 'all' ? DEPOSIT_WORDING_ALL : DEPOSIT_WORDING_NEW);
  return { what, link: String(bk.depositLink).trim(), forWho, types, wording };
}

/** Whether a booking for this treatment needs a deposit under the owner's rule (the who-pays part is checked separately). */
export const depositCovers = (rule: NonNullable<ReturnType<typeof depositRule>>, bookedType: string | undefined) =>
  !rule.types.length || rule.types.some((t) => sameName(t, bookedType || ''));

/** The script and knowledge for the receptionist. Plain text, so it pastes into any platform. */
export function packFromSettings(s: CaptureSettings): ReceptionistPack {
  const b = s.business;
  const appts = b.kind === 'appointments';
  const beauty = isBeauty(b);
  const name = clean(b.name, 80) || 'the business';
  const owner = clean(b.ownerName, 40) || 'the owner';
  const team = appts ? 'the team' : owner;
  const greeting = greetingFor(s);
  const services = lines(s.work.services);
  const notDone = lines(s.work.notDone);
  const hours = hoursText(s.calls);
  const bk = s.bookings;
  const types = (bk.types || []).filter((t) => clean(t.name));
  const staff = lines(bk.staff);
  const mode = effectiveBookingMode(bk);
  const who = beauty ? 'client' : appts ? 'patient or client' : 'customer';
  const dep = depositRule(bk);

  const sections: PackSection[] = [
    { title: 'Who you are', lines: [
      `You answer the phone for ${name}${b.location ? `, ${appts ? 'at' : 'based in'} ${clean(b.location, 80)}` : ''}${b.trade ? ` (${clean(b.trade, 60).toLowerCase()})` : ''}.`,
      'Sound like an experienced, friendly receptionist: warm, calm and professional. British English. Short, natural replies, one question at a time. Never rush the caller.',
      s.calls.announceAi
        ? 'You are an AI assistant, and you say so in your greeting.'
        : 'You do not need to say you are an AI unless asked. Never claim to be a person. If anyone asks whether they are speaking to a real person, a robot or an AI, always answer honestly that you are the ' + name + ' AI assistant, and offer to pass a message to ' + team + '.',
    ] },
    { title: 'Opening line', lines: [greeting, 'Use good morning, good afternoon or good evening to match the time, or a warm hello.'] },
    { title: appts ? 'What we offer' : 'What we do', lines: [...services, ...(notDone.length ? [`We don't do: ${notDone.join(', ')}. Say so kindly and don't recommend anyone else.`] : [])] },
    { title: 'Where and when', lines: [
      ...(appts
        ? [bk.address ? `Appointments are at ${clean(bk.address, 200)}.` : 'Confirm the address from the booking system.', ...(bk.arrival ? [`Tell people when they book: ${clean(bk.arrival, 300)}`] : [])]
        : [s.work.areas ? `Areas covered: ${clean(s.work.areas)}. If the job is outside this, take the details anyway and say ${owner} will confirm.` : `Take the address for every job; ${owner} confirms the area.`]),
      hours ? `Opening hours: ${hours}. Outside these hours, still help and take full details.` : 'Help callers at any time of day.',
    ] },
    { title: 'Details to collect, every call', lines: appts ? [
      'Full name. Ask them to spell the surname if you are not sure, and read it back.',
      'Best phone number: confirm the number they are calling from, or read a new one back.',
      `Whether they are a new or returning ${who}.`,
      'In a few words, what they would like help with. Do not ask for medical details beyond that.',
      ...(beauty ? ['If they mention an occasion or a date they need it for (a wedding, a holiday, a birthday), note it: it matters for timing.'] : []),
      'Which days and times suit them.',
      'Email address only if they want a confirmation by email: spell it back.',
    ] : [
      'Name. Ask them to spell the surname if you are not sure.', 'Best phone number (read it back to check).', 'Address with postcode (spell back the postcode).',
      'What the problem or job is, in their words, and how long it has been going on.',
      'When suits them for a visit or a call back.', 'How they found us.',
    ] },
    { title: 'Booking', lines: [
      ...(types.length ? [`Appointment types: ${types.map((t) => `${clean(t.name, 60)} (${t.minutes} min${t.price ? `, ${clean(t.price, 20)}` : ''}${t.who ? `, with ${clean(t.who, 60)}` : ''})`).join('; ')}.`] : []),
      ...(staff.length ? [`Team: ${staff.join(', ')}. Offer whoever is free unless the caller asks for someone.`] : []),
      mode === 'book' ? `Check the diary for free times${bk.noticeHours ? ` at least ${bk.noticeHours} hours ahead` : ''}${bk.aheadWeeks ? ` and no more than ${bk.aheadWeeks} weeks ahead` : ''}. Offer two options, book the one they choose, then read back the day, date, time${staff.length ? ', who it is with' : ''} and the address.`
        : mode === 'offer' ? `Check the diary and offer two free times. Take their choice and say ${team} will confirm it by text shortly.`
        : `Don't book a time. Take the details and say ${team} will call back to arrange it.`,
      ...(bk.cancellation ? [`Cancellation policy, mention it when booking: ${clean(bk.cancellation, 200)}`] : []),
      ...(appts && dep ? [dep.forWho === 'new'
        ? `Deposit: new ${who}s pay a deposit to secure their booking (${dep.what})${dep.types.length ? ` for ${dep.types.join(', ')}` : ''}. When you book a new ${who}${dep.types.length ? ' for one of those' : ''}, say so kindly and that a secure link to pay it comes with their confirmation text. Returning ${who}s don't pay one. Never take card details.`
        : `Deposit: every booking${dep.types.length ? ` for ${dep.types.join(', ')}` : ''} needs a deposit to secure it (${dep.what}). Say so kindly when you book, and that a secure link to pay it comes with the confirmation text. Never take card details.`] : []),
      `Tell them they'll get a text confirming the details.`,
      'At the end, sum up what happens next in one sentence and thank them for calling.',
    ] },
    { title: appts ? 'Safety' : 'Emergencies', lines: beauty ? [
      'Never give medical or aftercare advice, and never say whether something is normal.',
      `If the caller describes any of these, treat it as urgent and do not book: ${lines(s.calls.safety || DEFAULT_BEAUTY_SAFETY).join('; ')}.`,
      s.calls.emergencyLine
        ? `For any of these, ${s.calls.transferEmergency ? `put the call straight through to the clinic's emergency line, ${clean(s.calls.emergencyLine, 30)}. If it isn't answered, ` : ''}give the caller the clinic's emergency line, ${clean(s.calls.emergencyLine, 30)}, read it back slowly, and ask them to call it now. Say you are alerting ${team} straight away as well.`
        : `For any of these, tell the caller you are alerting ${team} straight away and that the clinic will call them back as a priority. Take their best number and check it.`,
      'Do not direct callers to 999, A&E, NHS 111, a pharmacy, a GP or any other service. The clinic handles every concern about its treatments itself.',
      ...(s.calls.transferTo ? [`For anything else urgent: ${clean(s.calls.transferTo, 160)}.`] : []),
    ] : appts ? [
      'Never diagnose or give medical advice. You can say it sounds like something the team can help with.',
      `If the caller describes any of these, do not book. Tell them to call 999 or go to A&E now, or call NHS 111 if they are unsure, and say you will let ${team} know: ${lines(s.calls.safety || DEFAULT_SAFETY).join('; ')}.`,
      'If anyone is in danger or seriously hurt, tell them to call 999.',
      ...(s.calls.transferTo ? [`For anything urgent that isn't an emergency: ${clean(s.calls.transferTo, 160)}.`] : []),
    ] : [
      `Treat these as urgent: ${(lines(s.calls.emergencies).length ? lines(s.calls.emergencies) : DEFAULT_EMERGENCIES).join('; ')}.`,
      s.calls.transferTo ? `For an urgent job, say you're passing it straight to the team and transfer or alert: ${clean(s.calls.transferTo, 160)}.` : `For an urgent job, say you're flagging it to ${owner} straight away and that they'll call back as soon as they can. Don't promise a time.`,
      ...(s.calls.gasWork ? [`If the caller can smell gas or thinks there's a gas leak: tell them to call the National Gas Emergency number, ${GAS_EMERGENCY}, now, and to leave the property if they feel unsafe. Don't give any other safety advice.`] : []),
      'If anyone is in danger or hurt, tell them to call 999.',
    ] },
    ...(beauty ? [{ title: 'Every kind of call, and what to do', lines: beautyCalls(s, team) }] : []),
    { title: 'Prices', lines: [
      appts
        ? (s.calls.quotePolicy === 'never' ? `Don't give prices. Say ${team} will confirm the fee.` : `You may give the prices listed for each appointment type${s.calls.priceNotes ? `, and: ${clean(s.calls.priceNotes)}` : ''}.`)
        : s.calls.quotePolicy === 'never' ? `Don't give prices. Say ${owner} gives every quote personally after a quick look, and offer a visit or call back.`
        : s.calls.quotePolicy === 'ranges' ? `You may give these guide prices only, and always say the final price is confirmed after a look: ${clean(s.calls.priceNotes) || 'ask the owner for ranges before going live'}.`
        : `These are fixed prices you may quote: ${clean(s.calls.priceNotes) || 'ask the owner for the price list before going live'}. Anything not listed gets a call back.`,
      'Never agree discounts, refunds or guarantees.',
    ] },
    { title: 'Never', lines: [
      'Never take card or bank details over the phone.',
      beauty ? 'Never give medical or aftercare advice, and never send callers to any other service.' : appts ? 'Never give medical advice or a diagnosis.' : 'Never give technical or safety advice beyond the emergency lines above.',
      'Never criticise other businesses.',
      'Never make up an answer: if unsure, say you will check and someone will get back to them.',
    ] },
    { title: 'Their information', lines: [
      `If asked, say the details are only used by ${name} to deal with their ${appts ? 'appointment' : 'enquiry'}${s.calls.recording ? ', and that recordings are kept for a limited time' : ''}.${b.website ? ` More is on ${clean(b.website, 120)}.` : ''}`,
    ] },
  ];

  const text = [`# Receptionist for ${name}`, ...sections.map((x) => `## ${x.title}\n${x.lines.map((l) => `- ${l}`).join('\n')}`)].join('\n\n');
  return { greeting, sections, text };
}

/** The calls a beauty and aesthetics clinic gets, and how each one is handled. */
function beautyCalls(s: CaptureSettings, team: string): string[] {
  const bk = s.bookings;
  const dep = depositRule(bk);
  const mode = effectiveBookingMode(bk);
  const book = mode === 'book' ? 'book it' : mode === 'offer' ? `offer two times and say ${team} will confirm by text` : `take the details and say ${team} will call back to arrange it`;
  return [
    `New client wanting a treatment: find out what they're after and why (for example a wedding or holiday date), check they're happy with the price, then ${book}.`,
    'Injectables (anti-wrinkle, fillers, skin boosters): clients must be 18 or over, so check their age before booking. A new client books a consultation first, unless the clinic’s list says otherwise. Never say whether a treatment is right for them: the practitioner decides at the consultation.',
    'Lashes, brows and tints, and laser: new clients need a patch test at least 48 hours before. Book the patch test first, then the treatment.',
    `Returning client: ask what they'd like and whether they want the same person as last time, then ${book}. For top-ups, don't comment on timing: say the practitioner will check it at the appointment.`,
    'Moving an appointment: find the booking by name and date, offer two new times, confirm the new day, date and time, and mention the cancellation policy if it applies.',
    `Cancelling: take the name and appointment, mention the cancellation policy kindly${bk.cancellation ? ` (${clean(bk.cancellation, 160)})` : ''}, offer to rebook, and say ${team} will confirm.`,
    `Running late: thank them for letting you know, take their name, appointment time and how late they'll be, and say you'll let ${team} know straight away. Don't promise the appointment can go ahead in full.`,
    'Prices and what a treatment involves: answer from the list of treatments and prices. If it isn’t on the list, say the team will confirm.',
    `Medical questions (pregnancy, breastfeeding, medication, allergies, skin conditions, whether a treatment is suitable): don't answer or guess. Say it's a really good question for the practitioner, take their details and say ${team} will call back.`,
    `Aftercare questions: don't give advice. If what they describe is on the safety list, follow the safety steps straight away. Otherwise take the details and say ${team} will call back today.`,
    `Unhappy with a result, or a complaint: listen, be kind and say sorry they feel that way. Don't argue, explain or offer refunds, discounts or free treatment. Take their name, number, the treatment and date, and say ${team} will call them back personally, today if possible.`,
    `Gift vouchers: take the buyer's name, number, the amount or treatment, and who it's for. Say ${team} will send a payment link. Never take card details.`,
    dep
      ? `Deposits: ${dep.forWho === 'new' ? 'new clients pay' : 'every booking needs'} ${dep.what}${dep.types.length ? ` (for ${dep.types.join(', ')})` : ''} to secure a booking, by the secure link in their confirmation text.${dep.forWho === 'new' ? ' Returning clients don\'t.' : ''} Never take card details.`
      : 'Deposits and payments: never take card details. Say a secure payment link will come by text.',
    'Group bookings (bridal parties, birthdays): take the date, how many people, the treatments and a contact number. Say the team will put a plan together and call back.',
    `Fully booked: offer the next free time. If nothing suits, add them to the call-back list with the days and times that work, and say ${team} will be in touch if a space comes up.`,
    'Asking for a particular person: book with them if they have a free time. If not, offer their next free time or someone else, and let the caller choose.',
    `Wants to speak to someone: say the team are with clients at the moment, take a message with their name, number and what it's about, and say someone will call back.${s.calls.transferTo ? ` If it's urgent: ${clean(s.calls.transferTo, 120)}.` : ''}`,
    'Opening hours, the address, parking and directions: answer from what you know. If unsure, say the team will text the details.',
    'Job applicants, suppliers and deliveries: take their name, company, number and what it’s about, and say the right person will get back to them.',
    'Sales calls, marketing offers and surveys: say politely that the clinic isn’t interested, thank them and end the call.',
    'Wrong number: be friendly, tell them which business they’ve reached, and end the call.',
    'Hard to hear, or English isn’t their first language: slow down, use simple words, repeat key details and spell them out.',
    'Rude or abusive callers: stay calm, say you’ll pass a message to the team, and end the call if it carries on.',
  ];
}

/* ---------- Enquiries from any source ---------- */

export type Channel = 'call' | 'form' | 'email' | 'text';

/** What the receptionist worked out on the call (Retell's post-call analysis), when the platform sends it. */
export interface CallFacts {
  callType: string;            // one of the call_type choices in shared/retell.ts, lower case, or ''
  newOrReturning: 'new' | 'returning' | '';
  appointmentType: string;     // in the business's own words, from its list
  preferredTimes: string;
  booked: boolean;             // a specific day and time was agreed on the call
  bookedFor: string | null;    // ISO time of that booking, only when it parsed and looks sane
  bookedWith: string;
}

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
  facts: CallFacts;
}

const NO_FACTS: CallFacts = { callType: '', newOrReturning: '', appointmentType: '', preferredTimes: '', booked: false, bookedFor: null, bookedWith: '' };
const truthy = (v: unknown) => v === true || v === 'true' || v === 'yes';

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
  const urgentFlag = truthy(custom.urgent_concern);
  const facts = callFacts(custom, now);
  let summary = `${urgentFlag ? 'Urgent concern raised on the call. ' : ''}${pick(analysis, ['call_summary', 'summary']) || get(['summary', 'call_summary', 'message', 'notes', 'enquiry', 'description', 'body', 'text'])}`;
  // What the receptionist found out, added to the summary when it isn't already there.
  const has = (w: string) => summary.toLowerCase().includes(w.toLowerCase());
  const extra: string[] = [];
  if (facts.newOrReturning && !has(facts.newOrReturning)) extra.push(facts.newOrReturning === 'new' ? 'New client.' : 'Returning client.');
  if (facts.appointmentType && !has(facts.appointmentType)) extra.push(`Wants: ${facts.appointmentType}.`);
  if (facts.preferredTimes && !has(facts.preferredTimes)) extra.push(`Prefers: ${facts.preferredTimes}.`);
  // Gainora's own line: whose business it is and what caught their eye.
  const bizName = String(custom.business_name ?? '').trim().slice(0, 120);
  const bizType = String(custom.business_type ?? '').trim().slice(0, 160);
  const keen = String(custom.interested_in ?? '').trim().slice(0, 80);
  if (bizName && !has(bizName)) extra.push(`Business: ${bizName}${bizType && !has(bizType) ? ` (${bizType})` : ''}.`);
  else if (bizType && !has(bizType)) extra.push(`Business: ${bizType}.`);
  if (keen && keen !== 'not sure' && !has(keen)) extra.push(`Interested in: ${keen}.`);
  // The call's language, when it wasn't English (Gainora's line speaks Polish and Romanian too).
  const lang = String(custom.call_language ?? '').trim().slice(0, 30);
  if (lang && !/^english$/i.test(lang)) extra.push(`Call in ${lang}.`);
  if (extra.length) summary = `${summary.trim()}${summary.trim() ? ' ' : ''}${extra.join(' ')}`;
  summary = summary.slice(0, 2000);
  const name = (pick(custom, ['caller_name', 'name', 'customer_name']) || get(['caller_name', 'customer_name', 'contact_name', 'name', 'full_name', 'from_name'])).slice(0, 120);
  const phone = normPhone(pick(custom, ['callback_number', 'phone']) || get(['from_number', 'caller_number', 'phone', 'phone_number', 'from', 'callback_number', 'mobile']));
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
    facts,
  };
}

/**
 * The receptionist's own analysis of the call. A booking time is only believed when it was marked as booked,
 * parses as a date, and falls between an hour from now and a year ahead: a wrong confirmation text is worse than none.
 */
function callFacts(custom: any, now: Date): CallFacts {
  if (!custom || typeof custom !== 'object') return NO_FACTS;
  const str = (k: string, max = 120) => clean(typeof custom[k] === 'string' ? custom[k] : '', max);
  const nr = str('new_or_returning').toLowerCase();
  const booked = truthy(custom.booked);
  let bookedFor: string | null = null;
  const rawWhen = str('booked_for', 60);
  if (booked && rawWhen) {
    const d = new Date(rawWhen);
    const t = d.getTime();
    if (!Number.isNaN(t) && t > now.getTime() + 3_600_000 && t < now.getTime() + 366 * 864e5) bookedFor = d.toISOString();
  }
  return {
    callType: str('call_type', 60).toLowerCase(),
    newOrReturning: nr === 'new' || nr === 'returning' ? nr : '',
    appointmentType: str('appointment_type', 80),
    preferredTimes: str('preferred_times', 160),
    booked, bookedFor,
    bookedWith: str('booked_with', 60),
  };
}

/* ---------- Triage ---------- */

export type Urgency = 'emergency' | 'urgent' | 'normal';
export type EnquiryKind = 'quote' | 'booking' | 'callback' | 'complaint' | 'spam' | 'other';
export interface Triage { urgency: Urgency; kind: EnquiryKind; gas: boolean; reasons: string[] }

const GAS = /\b(smell(s|ing)? (of )?gas|gas (leak|smell|escape)|leaking gas)\b/i;
const EMERGENCY = /\b(chest pain|can'?t breathe|difficulty breathing|(lost|losing|no) control of (my |his |her |their |the )?(bladder|bowels?)|numb(ness)? (around|in) (my |his |her |their |the )?(groin|bottom|genitals)|flood(ed|ing)?|burst|water (pouring|everywhere|coming through)|no (heating|heat|hot water|power|electric(ity)?)|sparking|smoke|fire|carbon monoxide|co alarm|locked out|break[- ]?in|broken (lock|window|door)|ceiling (collaps|coming down)|sewage|overflowing)\b/i;
const REACTION = /\b(urgent concern raised on the call|(lip|lips|face|cheek|eye|eyes|tongue|throat) (is |are |has |have )?(very |really )?(swollen|swelling|blistered|burn(ed|t|ing)?)|(swollen|swelling of (my |the )?)(lips?|tongue|throat|face)|(turned|turning|gone|going|looks?) (white|grey|gray|blue|blotchy|mottled)|(blurr(ed|y)|lost|losing|changes? (to|in)|problems? with) (my )?(vision|eyesight|sight)|(vision|eyesight|sight) (is |has gone |went |going )?(blurr(ed|y)|funny|strange|double|dark)|blister(s|ed|ing)?|(burn|burnt|burned) (after|from)|reaction (after|to) (the |my )?(filler|botox|treatment|injection|peel|laser))\b/i;
const URGENT = /\b(urgent(ly)?|asap|as soon as possible|today|tonight|emergency|right away|leak(ing)?|dripping|not working|broken down|stopped working)\b/i;
const VULNERABLE = /\b(elderly|baby|newborn|disabled|pregnant|vulnerable|poorly|oxygen)\b/i;
const COMPLAINT = /\b(complain|complaint|not happy|unhappy|disappointed|refund|still broken|came back|botched|shoddy)\b/i;
const SPAM = /\b(seo|backlinks?|google ranking|(marketing|advertising|lead generation|social media|instagram|facebook|tiktok) (agency|offer|services?|package|campaign|marketing|ads?)|business (loan|funding|grant)|merchant (services|account)|card (machine|terminal) (fees|rates)|crypto|energy (broker|tariff|supplier)|we can get you more (leads|customers|clients|bookings|reviews)|sales call|cold call|offered (seo|marketing|cheaper|a discount on))\b/i;
const QUOTE = /\b(quote|price|how much|cost|estimate)\b/i;
const BOOK = /\b(book(ed|ing)?|appointment|consultation|come out|visit|available|slot|service (my|the))\b/i;
const CALLBACK = /\b(call (me )?back|ring (me )?back|callback)\b/i;
const TIME_SENSITIVE = /\b(running late|on my way|cancel(ling)? (today|tomorrow|my appointment)|move (my|the) appointment|reschedule)\b/i;

/** What the receptionist said the call was about, when the platform sends it (shared/retell.ts call_type). */
export interface TriageHints { callType?: string; booked?: boolean }

export function triage(text: string, hints: TriageHints = {}): Triage {
  const t = String(text || '');
  const ct = (hints.callType || '').toLowerCase();
  const reasons: string[] = [];
  const gas = GAS.test(t);
  let urgency: Urgency = 'normal';
  if (gas) { urgency = 'emergency'; reasons.push('Caller mentioned a gas smell or leak'); }
  else if (EMERGENCY.test(t)) { urgency = 'emergency'; reasons.push(`Mentions: ${t.match(EMERGENCY)![0].toLowerCase()}`); }
  else if (REACTION.test(t)) { urgency = 'emergency'; reasons.push(`Possible reaction after a treatment: ${t.match(REACTION)![0].toLowerCase()}`); }
  else if (ct === 'concern after treatment') { urgency = 'emergency'; reasons.push('Your receptionist flagged a concern after a treatment'); }
  else if (ct === 'urgent') { urgency = 'urgent'; reasons.push('Your receptionist flagged the call as urgent'); }
  else if (URGENT.test(t)) { urgency = 'urgent'; reasons.push(`Mentions: ${t.match(URGENT)![0].toLowerCase()}`); }
  else if (ct === 'running late' || TIME_SENSITIVE.test(t)) { urgency = 'urgent'; reasons.push(ct === 'running late' ? 'Running late for an appointment' : `Time-sensitive: ${t.match(TIME_SENSITIVE)![0].toLowerCase()}`); }
  else if (ct === 'aftercare question' || ct === 'complaint') { urgency = 'urgent'; reasons.push(ct === 'complaint' ? 'A complaint: best handled by you, today' : 'An aftercare question: they want to hear from you today'); }
  if (VULNERABLE.test(t) && urgency !== 'emergency') { urgency = 'urgent'; reasons.push('Someone vulnerable may be affected'); }
  if (VULNERABLE.test(t) && urgency === 'emergency') reasons.push('Someone vulnerable may be affected');

  const kind: EnquiryKind = (ct === 'sales call' || ct === 'wrong number' || SPAM.test(t)) && urgency === 'normal' ? 'spam'
    : ct === 'complaint' || COMPLAINT.test(t) ? 'complaint'
    : hints.booked || /booking|consultation|patch test/.test(ct) ? 'booking'
    : ct === 'price or treatment question' || QUOTE.test(t) ? 'quote'
    : ct === 'message for the team' || ct === 'waiting list' ? 'callback'
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

export interface Bookings {
  system: string; systemOther: string; account: string;
  mode: BookingMode;
  address: string; arrival: string;
  types: AppointmentType[];
  staff: string;
  noticeHours: number; aheadWeeks: number;
  cancellation: string;
  /** Deposit new clients pay to secure a booking, in the owner's words ("£30, taken off the treatment price"). '' for none. */
  deposit?: string;
  /** Where they pay it: the owner's own payment link. Gainora never takes payments. */
  depositLink?: string;
  /** The owner's switch. Left unset (settings from before the switch existed), it's on when an amount and link are set. */
  depositOn?: boolean;
  /** Who pays: new clients only (the default) or every booking. */
  depositFor?: 'new' | 'all';
  /** The treatments that need one, by name. Empty means every treatment. */
  depositTypes?: string[];
  /** The owner's own wording for the line added to the confirmation. Empty uses ours. */
  depositWording?: string;
  /** The connected calendar is only a copy of another booking system (Fresha's calendar sync, say): Gainora can
   *  see when they're busy but can't book into the real diary, so times are offered and the clinic confirms. */
  mirror?: boolean;
  status: 'not_connected' | 'requested' | 'connected';
}

/** Switches and choices for the features on top of the receptionist and inbox. All on by default. */
export interface Features {
  /** Returning callers: what the receptionist is told about a number she recognises. */
  callers: { on: boolean; lastVisit: boolean; bookings: boolean; waiting: boolean };
  /** A space came up: who is offered a cancelled appointment, how far ahead, and the wording. */
  spaces: { on: boolean; waiting: boolean; dueBack: boolean; aheadDays: number; wording: string; dueBackWording: string };
  /** The owner's own emails. weeklyDay: 1 = Monday … 7 = Sunday. */
  emails: { daily: boolean; weekly: boolean; weeklyDay: number; monthly: boolean };
}

export const SPACE_WORDING = "Hi {first name}, a space has just come up at {business} on {day} {date} at {time}[ with {who}]. Would you like it[ for your {treatment}]? Just reply YES and we'll book you in.[ {owner}]";
export const SPACE_DUEBACK_WORDING = "Hi {first name}, a space has just come up at {business} on {day} {date} at {time}[ with {who}], and you're due your {treatment}. Would you like it? Just reply YES and we'll book you in.[ {owner}]";
export const DEPOSIT_WORDING_NEW = 'As a new client, please pay your deposit ({deposit}) to secure your booking: {deposit link}';
export const DEPOSIT_WORDING_ALL = 'Please pay your deposit ({deposit}) to secure your booking: {deposit link}';

export function defaultFeatures(): Features {
  return {
    callers: { on: true, lastVisit: true, bookings: true, waiting: true },
    spaces: { on: true, waiting: true, dueBack: true, aheadDays: 14, wording: SPACE_WORDING, dueBackWording: SPACE_DUEBACK_WORDING },
    emails: { daily: true, weekly: true, weeklyDay: 1, monthly: true },
  };
}

/** The saved feature settings with every field present. */
export function featuresOf(s: { features?: Partial<Features> | any }): Features {
  const d = defaultFeatures();
  const f = s?.features ?? {};
  const spaces = { ...d.spaces, ...(f.spaces ?? {}) };
  if (!String(spaces.wording || '').trim()) spaces.wording = SPACE_WORDING;
  if (!String(spaces.dueBackWording || '').trim()) spaces.dueBackWording = SPACE_DUEBACK_WORDING;
  spaces.aheadDays = Math.min(56, Math.max(1, Number(spaces.aheadDays) || d.spaces.aheadDays));
  const emails = { ...d.emails, ...(f.emails ?? {}) };
  emails.weeklyDay = Math.min(7, Math.max(1, Number(emails.weeklyDay) || 1));
  return { callers: { ...d.callers, ...(f.callers ?? {}) }, spaces, emails };
}

export interface Texting { number: string; status: 'off' | 'requested' | 'on' }

export interface CaptureSettings {
  business: { kind: BusinessKind; name: string; ownerName: string; trade: string; location: string; website: string; phone: string; alertEmail: string; alertMobile: string };
  work: { services: string; notDone: string; areas: string };          // one per line
  calls: {
    days: number[]; open: string; close: string;                        // 1 = Monday … 7 = Sunday, "08:00"
    emergencies: string; transferTo: string;
    quotePolicy: QuotePolicy; priceNotes: string;
    booking: 'calendar' | 'callback'; gasWork: boolean; recording: boolean;
    notify: 'all' | 'urgent';
    greeting: string; announceAi: boolean; safety: string;
    emergencyLine: string; transferEmergency: boolean;                  // beauty and aesthetics: the clinic's own emergency line
    alertText: 'emergencies' | 'urgent' | 'off';
  };
  bookings: Bookings;
  automations: Automations;
  texting: Texting;
  followUps: { reviewLink: string; payLink: string; paymentDays: number };
  provider: { name: string; aiNumber: string };
  /** Switches for returning callers, Fill the space and the owner's emails. Older settings have none: see featuresOf. */
  features?: Features;
  /** The clinic's own booking page (shared/diary.ts pageOf fills in the rest). */
  page?: Partial<BookingPage>;
  /** Diary rules: minutes between start times, and a gap after each appointment. */
  diary?: Partial<DiaryRules>;
  completedAt?: string;
}

export const TRADES = ['Plumbing and heating', 'Electrical', 'Building and renovation', 'Roofing', 'Locksmith', 'Cleaning', 'Landscaping and gardening', 'Pest control', 'Removals', 'Other trade or home service'];
export const BEAUTY = ['Aesthetics clinic', 'Skin clinic', 'Beauty salon', 'Hair salon', 'Barber', 'Nails, lashes and brows', 'Spa and wellness'];
export const CLINICS = ['Physiotherapy', 'Chiropractic', 'Osteopathy', 'Sports massage and therapy', 'Podiatry', 'Dental', ...BEAUTY, 'Other clinic or appointments'];
/** Beauty and aesthetics businesses get their own safety rules: concerns go to the clinic, never to 999. */
export const isBeauty = (b: { kind: BusinessKind; trade: string }) => b.kind === 'appointments' && (BEAUTY.includes(b.trade) || /hair and beauty/i.test(b.trade));

const CALENDARS = ['Google Calendar', 'Microsoft Outlook or 365', 'Apple Calendar (iCloud)', 'Calendly', 'Cal.com'];
const BEAUTY_SYSTEMS = ['Fresha', 'Phorest', 'Timely', 'Treatwell', 'Booksy', 'Salonized', 'Shortcuts', 'Kitomba', 'Vagaro', 'Zenoti', 'Pabau', 'Clinicminds', 'Aesthetic Nurse Software (ANS)', 'SimplyBook.me', 'Goldie'];
const CLINIC_SYSTEMS = ['Cliniko', 'Jane', 'WriteUpp', 'Pabau', 'Setmore', 'Acuity Scheduling', 'Square Appointments', 'SimplyBook.me'];
const TRADE_SYSTEMS = ['Jobber', 'Tradify', 'ServiceM8'];
const LAST = ['A paper diary, or nothing yet', 'Something else'];
/** The clinic runs its diary in Gainora itself (the booking page and the receptionist share it). */
export const GAINORA_DIARY = 'Gainora diary (this app)';
const uniq = (a: string[]) => [...new Set(a)];
export const BOOKING_SYSTEMS = uniq([GAINORA_DIARY, ...CALENDARS, ...BEAUTY_SYSTEMS, ...CLINIC_SYSTEMS, ...TRADE_SYSTEMS, ...LAST]);
/** The booking systems to offer, most likely first, for the business type. */
export function bookingSystemsFor(b: { kind: BusinessKind; trade: string }): string[] {
  if (b.kind !== 'appointments') return uniq([GAINORA_DIARY, ...CALENDARS, ...TRADE_SYSTEMS, 'Square Appointments', 'Setmore', ...LAST]);
  if (isBeauty(b)) return uniq([GAINORA_DIARY, ...BEAUTY_SYSTEMS, ...CALENDARS, 'Square Appointments', 'Setmore', 'Acuity Scheduling', ...LAST]);
  return uniq([GAINORA_DIARY, ...CLINIC_SYSTEMS, ...CALENDARS, 'Fresha', ...LAST]);
}
/** Systems Gainora can book straight into today; the rest are connected client by client. */
export const DIRECT_SYSTEMS = ['Google Calendar', 'Microsoft Outlook or 365', 'Cal.com', 'Calendly'];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function emptySettings(email = ''): CaptureSettings {
  return {
    business: { kind: 'trade', name: '', ownerName: '', trade: '', location: '', website: '', phone: '', alertEmail: email, alertMobile: '' },
    work: { services: '', notDone: '', areas: '' },
    calls: { days: [1, 2, 3, 4, 5], open: '08:00', close: '17:30', emergencies: '', transferTo: '', quotePolicy: 'never', priceNotes: '', booking: 'callback', gasWork: false, recording: true, notify: 'urgent', greeting: DEFAULT_GREETING, announceAi: false, safety: '', alertText: 'urgent', emergencyLine: '', transferEmergency: true },
    bookings: { system: '', systemOther: '', account: '', mode: 'callback', address: '', arrival: '', types: [], staff: '', noticeHours: 2, aheadWeeks: 4, cancellation: '', deposit: '', depositLink: '', status: 'not_connected' },
    followUps: { reviewLink: '', payLink: '', paymentDays: 14 },
    provider: { name: '', aiNumber: '' },
    automations: defaultAutomations('trade', new Date(0).toISOString()),
    texting: { number: '', status: 'off' },
  };
}

/** One item per line (semicolons work too). Commas are kept: “Leaks, taps and toilets” is one item. */
/** Saved settings with every field present, however old the saved copy is. */
export function withDefaults(data: any): CaptureSettings {
  const d = emptySettings();
  return {
    business: { ...d.business, ...(data?.business ?? {}) },
    work: { ...d.work, ...(data?.work ?? {}) },
    calls: { ...d.calls, ...(data?.calls ?? {}) },
    bookings: { ...d.bookings, ...(data?.bookings ?? {}), types: Array.isArray(data?.bookings?.types) ? data.bookings.types : [] },
    followUps: { ...d.followUps, ...(data?.followUps ?? {}) },
    provider: { ...d.provider, ...(data?.provider ?? {}) },
    automations: automationsWithDefaults(data?.automations, data?.business?.kind === 'appointments' ? 'appointments' : 'trade', data?.completedAt || new Date(0).toISOString()),
    texting: { ...d.texting, ...(data?.texting ?? {}) },
    features: featuresOf(data ?? {}),
    ...(data?.page ? { page: data.page } : {}),
    ...(data?.diary ? { diary: data.diary } : {}),
    completedAt: data?.completedAt,
  };
}

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
  bookedType?: string;          // what was booked, e.g. "Initial consultation"
  bookedWith?: string;          // who with
  jobValue: number | null; invoiceDue: string | null; paidAt: string | null; paymentRemindersSent: number;
  reviewAskedAt: string | null;
  receivedAt: string;
  isTest: boolean;
}

export interface EnquiryPatch {
  status?: EnquiryStatus;
  quoteAmount?: number | null;
  bookedFor?: string | null;
  bookedType?: string;
  bookedWith?: string;
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
  /** With status "lost": why. A no-show or late cancellation is counted in the report. */
  lostReason?: LostReason;
}

export type LostReason = 'noshow' | 'late_cancel' | 'cancelled' | 'other';
export const LOST_LABEL: Record<LostReason, string> = { noshow: 'Didn’t turn up', late_cancel: 'Cancelled late', cancelled: 'Cancelled', other: 'Didn’t go ahead' };
/** A history line that marks a no-show or late cancellation, so the report can count them without a new column. */
export const isNoShow = (h: HistoryItem) => /^(Didn’t turn up|Cancelled late)/.test(h.text);

/** The words that change between a trade and an appointment business. */
export function words(kind?: BusinessKind) {
  const a = kind === 'appointments';
  return { won: a ? 'Attended' : 'Job done', wonTab: a ? 'Attended' : 'Won', job: a ? 'appointment' : 'job', jobs: a ? 'appointments' : 'jobs', value: a ? 'Fee' : 'Job value', customer: a ? 'client' : 'customer' };
}
export const statusLabel = (st: EnquiryStatus, kind?: BusinessKind) => (st === 'won' ? words(kind).won : STATUS_LABEL[st]);

export const STATUS_LABEL: Record<EnquiryStatus, string> = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s.id, s.label])) as Record<EnquiryStatus, string>;
export const KIND_LABEL: Record<EnquiryKind, string> = { quote: 'Quote', booking: 'Booking', callback: 'Call back', complaint: 'Complaint', spam: 'Spam', other: 'Enquiry' };
export const CHANNEL_LABEL: Record<Channel, string> = { call: 'Phone call', form: 'Website form', email: 'Email', text: 'Text' };

const DAY_MS = 86_400_000;
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * DAY_MS).toISOString();

/** Works out the record after a change: dates stamped, counters moved, history written. Pure, so the server and the demo agree. */
export function applyPatch(e: EnquiryRecord, p: EnquiryPatch, settings: (Pick<CaptureSettings, 'followUps'> & { business?: { kind?: BusinessKind } }) | null, now = new Date()): EnquiryRecord {
  const W = words(settings?.business?.kind);
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
  if (typeof p.bookedType === 'string') next.bookedType = p.bookedType.slice(0, 80);
  if (typeof p.bookedWith === 'string') next.bookedWith = p.bookedWith.slice(0, 80);
  if (p.jobValue !== undefined) next.jobValue = p.jobValue;
  if (p.invoiceDue !== undefined) next.invoiceDue = p.invoiceDue;

  if (p.status && p.status !== e.status) {
    next.status = p.status;
    if (['replied', 'quoted', 'booked', 'won'].includes(p.status) && !next.repliedAt) next.repliedAt = at;
    if (p.status === 'quoted') { next.quotedAt = at; next.chasersSent = 0; log(`Quote sent${money(next.quoteAmount)}`); }
    else if (p.status === 'booked') log(next.bookedFor ? `Booked in for ${new Date(next.bookedFor).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Booked in');
    else if (p.status === 'won') {
      if (!next.invoiceDue && next.jobValue) next.invoiceDue = addDays(at, settings?.followUps.paymentDays ?? 14).slice(0, 10);
      log(`${W.won}${money(next.jobValue)}`);
    }
    else if (p.status === 'lost') log(p.lostReason && p.lostReason !== 'other' ? `${LOST_LABEL[p.lostReason]}${next.bookedFor ? ` for ${new Date(next.bookedFor).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}` : 'Didn’t go ahead');
    else if (p.status === 'spam') log('Filed as spam');
    else log(`Moved to ${STATUS_LABEL[p.status].toLowerCase()}`);
  } else if (p.status === 'won' && p.jobValue !== undefined) log(`${W.value} set${money(next.jobValue)}`);

  if (p.bookedFor && e.bookedFor && p.bookedFor !== e.bookedFor && e.status === 'booked' && (!p.status || p.status === 'booked')) log(`Moved to ${new Date(p.bookedFor).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
  if (p.chaserSent) { next.chasersSent = e.chasersSent + 1; log(`Quote chaser ${next.chasersSent} sent`); }
  if (p.paymentReminderSent) { next.paymentRemindersSent = e.paymentRemindersSent + 1; log(`Payment reminder ${next.paymentRemindersSent} sent`); }
  if (p.paid === true && !e.paidAt) { next.paidAt = at; log('Paid'); }
  if (p.paid === false && e.paidAt) { next.paidAt = null; log('Marked as unpaid'); }
  if (p.reviewAsked && !e.reviewAskedAt) { next.reviewAskedAt = at; log('Review requested'); }
  return next;
}

/** Brought in from the clinic's old booking system when they switched (shared/importer.ts). */
export const isImported = (e: Pick<EnquiryRecord, 'history'>) => e.history.some((h) => /^Imported from /.test(h.text));

/** History lines the receptionist's call analysis leaves, so a new client is known without a new column. */
export const NEW_CLIENT = 'New client';
export const RETURNING_CLIENT = 'Returning client';

/**
 * A new client: the receptionist recorded them as new on the call, and nothing in the inbox says they've been
 * before (an attended visit from the same number or email). Used for the deposit line in the confirmation,
 * so a regular is never asked for a deposit by mistake.
 */
export function isNewClient(e: EnquiryRecord, others: EnquiryRecord[] = []): boolean {
  if (!e.history.some((h) => h.text === NEW_CLIENT)) return false;
  const me = normPhone(e.phone);
  return !others.some((o) => o.id !== e.id && !o.isTest && o.status === 'won' && ((me && normPhone(o.phone) === me) || (!!e.email && o.email === e.email)));
}

/** Booked by the receptionist during the call itself (or within minutes of it), rather than by the owner later. */
export const bookedOnCall = (e: Pick<EnquiryRecord, 'history' | 'receivedAt'>) =>
  e.history.some((h) => /^Booked in/.test(h.text) && new Date(h.at).getTime() - new Date(e.receivedAt).getTime() < 15 * 60_000);

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
      const from = e.paidAt ?? e.history.find((h) => /^(Job done|Attended)/.test(h.text))?.at ?? e.receivedAt;
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
  /** Bookings and attended appointments valued from the owner's own figures: entered values, or the list price of what was booked. */
  bookedValue: number; bookedValueFrom: boolean; bookedValued: number;
  afterHoursBooked: number; afterHoursValue: number;
  noShows: number; unanswered: number;
  /** Bookings the receptionist made on the call itself. Left out of the owner's reply-time figures. */
  onCall: number;
  byChannel: Record<Channel, number>;
  byWeek: { weekOf: string; inHours: number; afterHours: number }[];
  byDay: number[];   // enquiries by day of week, Monday first
}

const mondayIso = (iso: string) => { const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

export function report(list: EnquiryRecord[], from: Date, to: Date, settings?: Pick<CaptureSettings, 'bookings'>, now = new Date()): Report {
  // Bookings imported from a clinic's old system aren't enquiries Gainora caught, so they're left out of the figures.
  const inRange = list.filter((e) => !e.isTest && !isImported(e) && new Date(e.receivedAt) >= from && new Date(e.receivedAt) < to);
  const real = inRange.filter((e) => e.status !== 'spam');
  const onCall = real.filter(bookedOnCall);
  // Reply time measures the owner, so calls the receptionist settled herself are left out.
  const replyMins = real.filter((e) => e.repliedAt && !bookedOnCall(e)).map((e) => Math.max(0, (new Date(e.repliedAt!).getTime() - new Date(e.receivedAt).getTime()) / 60000)).sort((a, b) => a - b);
  const median = replyMins.length ? replyMins[Math.floor((replyMins.length - 1) / 2)] : null;
  const won = real.filter((e) => e.status === 'won');
  const byChannel = { call: 0, form: 0, email: 0, text: 0 } as Record<Channel, number>;
  for (const e of real) byChannel[e.channel]++;
  const weeks = new Map<string, { inHours: number; afterHours: number }>();
  for (let t = new Date(mondayIso(from.toISOString())).getTime(); t < to.getTime(); t += 7 * DAY_MS) weeks.set(new Date(t).toISOString().slice(0, 10), { inHours: 0, afterHours: 0 });
  for (const e of real) { const w = weeks.get(mondayIso(e.receivedAt)); if (w) e.afterHours ? w.afterHours++ : w.inHours++; }
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  for (const e of real) byDay[londonClock(e.receivedAt).day - 1]++;
  const bookedList = real.filter((e) => e.status === 'booked' || e.status === 'won');
  const values = bookedList.map((e) => (settings ? enquiryValue(e, settings) : (e.jobValue ? { amount: e.jobValue, from: false, source: 'entered' as const } : null)));
  const valued = values.filter((v): v is NonNullable<typeof v> => !!v);
  const afterHoursBooked = bookedList.filter((e) => e.afterHours);
  return {
    caught: real.length, afterHours: real.filter((e) => e.afterHours).length, emergencies: real.filter((e) => e.urgency === 'emergency').length,
    spam: inRange.length - real.length,
    replied: replyMins.length, medianReplyMins: median == null ? null : Math.round(median), within1h: replyMins.filter((m) => m <= 60).length,
    quotes: real.filter((e) => e.quotedAt).length, quotedValue: real.reduce((a, e) => a + (e.quotedAt && e.quoteAmount ? e.quoteAmount : 0), 0),
    booked: bookedList.length,
    won: won.length, wonValue: won.reduce((a, e) => a + (e.jobValue ?? 0), 0),
    paidValue: won.filter((e) => e.paidAt).reduce((a, e) => a + (e.jobValue ?? 0), 0),
    outstanding: won.filter((e) => !e.paidAt && e.invoiceDue).reduce((a, e) => a + (e.jobValue ?? 0), 0),
    bookedValue: valued.reduce((a, v) => a + v.amount, 0), bookedValueFrom: valued.some((v) => v.from), bookedValued: valued.length,
    afterHoursBooked: afterHoursBooked.length,
    afterHoursValue: afterHoursBooked.reduce((a, e) => a + (settings ? enquiryValue(e, settings)?.amount ?? 0 : e.jobValue ?? 0), 0),
    noShows: inRange.filter((e) => e.history.some(isNoShow)).length,
    unanswered: real.filter((e) => e.status === 'new' && now.getTime() - new Date(e.receivedAt).getTime() > DAY_MS).length,
    onCall: onCall.length,
    byChannel, byWeek: [...weeks.entries()].map(([weekOf, v]) => ({ weekOf, ...v })), byDay,
  };
}

export function replyTime(mins: number | null): string {
  if (mins == null) return '–';
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60 * 10) / 10} h`;
  return `${Math.round(mins / 1440)} days`;
}

/* ---------- Packages ---------- */

export type PackageId = 'answer' | 'book' | 'desk';
export interface Package { id: PackageId; name: string; setup: number; monthly: number; minutes: number; adds: string[] }
export const PACKAGES: Package[] = [
  { id: 'answer', name: 'Never Miss a Call', setup: 595, monthly: 249, minutes: 300, adds: ['A professional receptionist, day and night', 'Urgent calls passed to your mobile', 'Enquiries inbox, follow-ups and monthly report', 'Ongoing care of your receptionist'] },
  { id: 'book', name: 'Call to Booking', setup: 995, monthly: 399, minutes: 600, adds: ['Everything in Never Miss a Call', 'Books into your diary and texts a confirmation', 'Recognises returning callers'] },
  { id: 'desk', name: 'Full Front Desk', setup: 1995, monthly: 599, minutes: 1200, adds: ['Everything in Call to Booking', 'Several staff, numbers or call transfers'] },
];
export const EXTRA_MINUTES = '£25 per 100 extra minutes';
