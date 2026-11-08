// The thinking layer: what needs the owner first, what to do next, a reply drafted from the actual enquiry,
// who is due back, and what the month's numbers suggest changing. Pure functions, no network, so the app,
// the demo and the server agree. Nothing here invents a price, a figure or a fact: every number comes from the
// owner's own settings or their own enquiries.
import {
  enquiryValue, isBeauty, isNoShow, lines, normPhone, rebookWeeksFor, typePrice, words,
  type CaptureSettings, type EnquiryRecord, type Report,
} from './capture';

const DAY = 86_400_000;
const clean = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const first = (e: Pick<EnquiryRecord, 'name'>) => clean(e.name, 60).split(' ')[0] || '';
const london = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o }).format(new Date(iso));
const time12 = (iso: string) => london(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(' ', '');
const dayDate = (iso: string) => london(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (iso: string) => london(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** "on Tuesday 10 November", "tomorrow" or "today", for a booking time. */
export function whenWord(iso: string, now = new Date()): string {
  const k = dayKey(iso);
  if (k === dayKey(now.toISOString())) return 'today';
  if (k === dayKey(new Date(now.getTime() + DAY).toISOString())) return 'tomorrow';
  return `on ${dayDate(iso)}`;
}

/* ---------- What the owner is looking at ---------- */

/** The last thing the customer sent, if it hasn't been read, and whether a message is waiting for the owner's OK. */
export interface Context { unreadReply?: { body: string; at: string } | null; awaitingOk?: number; now?: Date }

export type Action = 'call' | 'reply' | 'book' | 'attended' | 'pay' | 'review' | 'rebook' | 'open' | 'none';
export interface Step { action: Action; title: string; detail?: string }

const TIMES = /\b(morning|afternoon|evening|lunch|weekday|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|after \d|before \d|\d\s?(am|pm)|o'?clock|next week|this week)\b/i;

/** Hours since something happened, never negative. */
const hoursSince = (iso: string, now: Date) => Math.max(0, (now.getTime() - new Date(iso).getTime()) / 3_600_000);
const waited = (h: number) => (h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? 'day' : 'days'} ago`);

/**
 * The next step for this enquiry, in one line, with the one action that moves it on.
 * Order of importance: an emergency, a client waiting on an answer, a new enquiry, then the stage it's at.
 */
export function nextStep(e: EnquiryRecord, s: CaptureSettings, ctx: Context = {}): Step {
  const now = ctx.now ?? new Date();
  const appts = s.business.kind === 'appointments';
  const beauty = isBeauty(s.business);
  const W = words(s.business.kind);
  const name = first(e) || 'them';
  const r = ctx.unreadReply;

  if (e.urgency === 'emergency' && e.status === 'new') {
    return { action: 'call', title: beauty ? `Call ${name} now.` : 'Call them back now.', detail: beauty ? 'A concern after a treatment. The receptionist gave your emergency line and did not book.' : e.reasons[0] };
  }
  if (r) {
    const q = /\?|can i|is it ok|do i|should i|what time|how (much|long|many)/i.test(r.body);
    const when = TIMES.test(r.body) && e.status !== 'booked';
    return { action: when && appts ? 'book' : 'reply', title: when ? `${name} said when suits. ${appts ? 'Find a time and book them in.' : 'Reply and get it booked.'}` : q ? `${name} asked a question. Reply so they're not left waiting.` : `${name} replied. Read it and reply if it needs one.`, detail: `“${clean(r.body, 140)}” · ${waited(hoursSince(r.at, now))}` };
  }
  if (e.urgency === 'emergency' && e.status === 'replied') {
    return { action: 'open', title: `You've been in touch with ${name}.`, detail: 'Add a note of what happened, then mark it booked, attended or didn’t go ahead.' };
  }
  if (e.status === 'new') {
    const h = hoursSince(e.receivedAt, now);
    if (e.urgency === 'urgent') return { action: 'call', title: 'Call them back today.', detail: e.reasons[0] };
    if (e.kind === 'complaint') return { action: 'call', title: `Call ${name} yourself, today.`, detail: 'A complaint handled quickly and kindly is usually kept.' };
    if (e.kind === 'quote') return { action: 'reply', title: appts ? `Reply with the price and what's involved.` : `Reply, then get a quote to them.`, detail: h > 24 ? `They've waited ${waited(h)}.` : 'People book with whoever answers first.' };
    if (e.kind === 'booking') return { action: appts ? 'book' : 'reply', title: appts ? `Find ${name} a time and book them in.` : 'Reply and get the visit booked.', detail: h > 24 ? `They've waited ${waited(h)}.` : undefined };
    return { action: 'reply', title: 'Reply while it’s fresh.', detail: h > 24 ? `They've waited ${waited(h)}.` : appts ? 'A quick text is enough to hold them.' : 'The first to get back usually gets the job.' };
  }
  if (e.status === 'replied') {
    return { action: appts ? 'book' : 'open', title: appts ? `You've been in touch. Booked them in yet?` : 'You’ve been in touch. What happened next?', detail: appts ? 'Mark it booked and the confirmation text goes out for you.' : undefined };
  }
  if (e.status === 'quoted') {
    return { action: 'open', title: `Quote sent${e.quoteAmount ? ` for £${e.quoteAmount.toLocaleString('en-GB')}` : ''}${e.quotedAt ? ` ${waited(hoursSince(e.quotedAt, now))}` : ''}.`, detail: e.chasersSent ? `${e.chasersSent} ${e.chasersSent === 1 ? 'chaser' : 'chasers'} sent.` : 'Chasers go out on their own if they’re switched on.' };
  }
  if (e.status === 'booked') {
    if (!e.bookedFor) return { action: 'open', title: 'Booked in.' };
    const past = new Date(e.bookedFor).getTime() < now.getTime() - 2 * 3_600_000;
    const what = `${e.bookedType ? `${e.bookedType}, ` : ''}${dayDate(e.bookedFor)} at ${time12(e.bookedFor)}${e.bookedWith ? ` with ${e.bookedWith}` : ''}.`;
    if (past) return { action: 'attended', title: `Did ${name} ${appts ? 'attend' : 'go ahead'}?`, detail: `${what} Mark it so the right message follows${appts ? ' and the no-show count stays honest' : ''}.` };
    return { action: 'open', title: what, detail: 'Confirmation sent. The reminder goes out on its own.' };
  }
  if (e.status === 'won') {
    if (!e.paidAt && e.invoiceDue) return { action: 'pay', title: `${W.won}${e.jobValue ? `, £${e.jobValue.toLocaleString('en-GB')}` : ''}. Waiting to be paid.`, detail: `Due ${whenWord(e.invoiceDue, now).replace(/^on /, '')}.` };
    if (!e.reviewAskedAt) return { action: 'review', title: `${W.won}. Ask for a review while it’s fresh.` };
    return { action: 'none', title: `${W.won}${e.jobValue ? `, £${e.jobValue.toLocaleString('en-GB')}` : ''}. All done.` };
  }
  if (e.status === 'lost') return { action: 'none', title: e.history.some(isNoShow) ? 'Didn’t turn up.' : 'Didn’t go ahead.' };
  return { action: 'none', title: 'Filed as spam.' };
}

/* ---------- Priority: who first ---------- */

export interface Priority { score: number; why: string; step: Step }

/**
 * A number to sort the inbox by: emergencies, then people waiting on a reply (longest first), then likely value.
 * The "why" is the one line a busy owner reads before deciding.
 */
export function priority(e: EnquiryRecord, s: CaptureSettings, ctx: Context = {}): Priority {
  const now = ctx.now ?? new Date();
  const step = nextStep(e, s, ctx);
  let score = 0;
  const why: string[] = [];
  if (e.status === 'spam' || e.isTest) return { score: -1, why: '', step };
  if (e.urgency === 'emergency') { score += e.status === 'new' ? 1000 : 150; why.push(e.reasons[0] || 'Emergency'); }
  else if (e.urgency === 'urgent' && e.status === 'new') { score += 500; why.push(e.reasons[0] || 'Urgent'); }
  if (ctx.unreadReply) { score += 400 + Math.min(100, hoursSince(ctx.unreadReply.at, now) * 4); why.push(`Replied ${waited(hoursSince(ctx.unreadReply.at, now))}`); }
  if (e.status === 'new') {
    const h = hoursSince(e.receivedAt, now);
    score += 200 + Math.min(150, h * 3);
    why.push(h >= 1 ? `Waiting ${waited(h).replace(' ago', '')}` : 'Just in');
    if (e.kind === 'complaint') { score += 150; why.push('complaint'); }
    if (e.afterHours && h < 24) why.push('out of hours');
  }
  const v = enquiryValue(e, s);
  if (v && v.amount > 0) { score += Math.min(100, v.amount / 10); if (e.status === 'new' || ctx.unreadReply) why.push(`${v.from ? 'from ' : ''}£${v.amount.toLocaleString('en-GB')}`); }
  else if (e.status === 'new' && (e.kind === 'quote' || e.kind === 'booking')) { score += 40; }
  if (e.status === 'booked' && e.bookedFor && new Date(e.bookedFor).getTime() < now.getTime() - 2 * 3_600_000) { score += 120; why.push('appointment time has passed: attended?'); }
  if ((ctx.awaitingOk ?? 0) > 0) { score += 100; why.push('a message is waiting for your OK'); }
  return { score, why: why.join(' · '), step };
}

/* ---------- A reply written from the enquiry itself ---------- */

const MEDICAL = /\b(pain|painful|swell|swollen|rash|blister|bleed|infect|allerg|react|pregnan|breastfeed|medication|antibiotic|lump|bruis|numb|burn|itch|hot|pus|fever|temperature|dizzy|sick|unwell|worried about (my|the))\b/i;
const PREP = /\b(make-?up|mascara|wear|arrive|early|parking|park|bring|prepare|prep|shave|fake tan|sunbed|alcohol|eat|drink|clean|wash)\b/i;

/** The treatment or service the enquiry is about, in the owner's own words from their list, or ''. */
export function topicOf(e: Pick<EnquiryRecord, 'summary' | 'bookedType'>, s: CaptureSettings): string {
  if (e.bookedType) return e.bookedType.toLowerCase();
  const text = ` ${e.summary.toLowerCase()} `;
  const names = [...s.bookings.types.map((t) => t.name), ...lines(s.work.services)].map((n) => clean(n, 60)).filter((n) => n.length > 3);
  // Longest match first, so "laser hair removal" wins over "laser".
  const hit = names.sort((a, b) => b.length - a.length).find((n) => text.includes(n.toLowerCase()));
  if (hit) return hit.toLowerCase();
  if (s.business.kind !== 'appointments') return '';
  // A single key word from a listed treatment ("nails" from "Gel nails").
  const word = names.flatMap((n) => n.toLowerCase().split(/[\s,/]+/)).filter((w) => w.length > 4 && !/^(treat|consult|appoint|service|session|and|with|the|for)/.test(w)).find((w) => text.includes(w));
  return word ? word : '';
}

/**
 * A short, personal reply for the owner to send (never sent for them). Built from what the customer actually said,
 * the stage the enquiry is at, and the owner's own details (address, arrival notes, prices). It never gives medical
 * or aftercare advice, never invents a time, and signs with the owner's first name.
 */
export function suggestReply(e: EnquiryRecord, s: CaptureSettings, ctx: Context & { channel?: 'text' | 'email' } = {}): string {
  const now = ctx.now ?? new Date();
  const channel = ctx.channel ?? (e.email && !e.phone ? 'email' : 'text');
  const appts = s.business.kind === 'appointments';
  const beauty = isBeauty(s.business);
  const biz = clean(s.business.name, 80);
  const owner = clean(s.business.ownerName, 40) || biz;
  const hi = `Hi ${first(e) || 'there'},`;
  const topic = topicOf(e, s);
  const price = e.bookedType ? null : topic ? typePrice(s.bookings.types.find((t) => t.name.toLowerCase() === topic)?.name, s.bookings.types) : null;
  const line = s.business.phone ? ` If it's easier, call us on ${clean(s.business.phone, 30)}.` : '';
  const emergency = beauty && s.calls.emergencyLine ? clean(s.calls.emergencyLine, 30) : '';
  const r = ctx.unreadReply?.body ? clean(ctx.unreadReply.body, 300) : '';
  let body: string;

  if (r && beauty && MEDICAL.test(r)) {
    // Never advise by text. Get them to a person, and give the emergency line for anything that worries them.
    body = `${hi} thank you for letting us know. That's one for ${owner} to answer properly rather than by text, so I'll call you today.${emergency ? ` If it's getting worse or you're worried, please ring our emergency line now: ${emergency}.` : ''}`;
  } else if (r && e.status === 'booked' && e.bookedFor && PREP.test(r) && s.bookings.arrival) {
    body = `${hi} good question. ${clean(s.bookings.arrival, 200)} See you ${whenWord(e.bookedFor, now)} at ${time12(e.bookedFor)}${e.bookedWith ? ` with ${e.bookedWith}` : ''}.`;
  } else if (r && TIMES.test(r)) {
    const pref = (r.match(TIMES)?.[0] || '').toLowerCase();
    body = `${hi} thanks, ${pref ? `${pref} it is` : 'noted'}. I'll check the diary and text you a couple of times that work shortly.`;
  } else if (r && /thank|thanks|great|perfect|lovely|see you|brilliant/i.test(r) && !/\?/.test(r)) {
    body = `${hi} you're welcome${e.bookedFor ? `, see you ${whenWord(e.bookedFor, now)}` : ''}!`;
  } else if (r) {
    body = `${hi} thanks for your message. ${e.status === 'booked' && e.bookedFor ? `I'll come back to you before your appointment ${whenWord(e.bookedFor, now)}.` : 'I’ll come back to you today.'}${line}`;
  } else if (appts) {
    const about = topic ? ` about ${topic}` : '';
    if (e.kind === 'complaint') body = `${hi} I'm sorry to hear you're not happy. I'd like to put it right, so I'll call you personally today.${line}`;
    else if (e.kind === 'quote') body = `${hi} thanks for asking about ${topic || 'our treatments'}. ${price && price.amount > 0 ? `It's ${price.from ? 'from ' : ''}£${price.amount.toLocaleString('en-GB')}${beauty ? ', and a free chat first is always welcome' : ''}.` : 'I’ll come back to you today with the price and what’s involved.'}${beauty ? ' Would you like me to find you a time?' : ''}`;
    else if (e.status === 'new' && e.urgency === 'emergency' && beauty) body = `${hi} thank you for calling. ${owner} is going to call you straight away.${emergency ? ` If anything gets worse before then, ring ${emergency}.` : ''}`;
    else body = `${hi} thanks for getting in touch with ${biz}${about}. I'll ${e.kind === 'booking' ? 'find you a time and text you the options' : 'call you back today'}${beauty && e.summary && /wedding|holiday|birthday|event|party/i.test(e.summary) ? ', and we’ll make sure it’s all done in good time for the big day' : ''}.`;
  } else {
    const what = e.kind === 'quote' ? 'a price for the job' : e.kind === 'booking' ? 'getting you booked in' : 'your enquiry';
    body = `${hi} thanks for getting in touch with ${biz} about ${topic || what}. I'll call you back today to sort the details.`;
  }
  body = body.replace(/\s+/g, ' ').replace(/\s([.,!?])/g, '$1').trim();
  if (channel === 'email') return `Subject: ${e.bookedFor ? `Your appointment with ${biz}` : `Your enquiry with ${biz}`}\n\n${body}\n\n${owner}\n${biz}`;
  return `${body} ${owner}`;
}

/* ---------- Clients due back ---------- */

/** type: the treatment in the owner's words, or '' when the enquiry never had one recorded. */
export interface RebookItem { enquiry: EnquiryRecord; type: string; weeks: number; dueAt: string; overdueDays: number; value: ReturnType<typeof enquiryValue> }

/**
 * Appointment businesses: attended clients who are due (or about to be due) for their next treatment, by the
 * interval the owner set for that treatment. Nobody who has been back in touch since, and nobody more than
 * ten weeks overdue (that's a win-back, not a reminder). Most overdue first.
 */
export function rebookDue(list: EnquiryRecord[], s: CaptureSettings, now = new Date(), aheadDays = 7): RebookItem[] {
  if (s.business.kind !== 'appointments') return [];
  const out: RebookItem[] = [];
  for (const e of list) {
    if (e.isTest || e.status !== 'won') continue;
    const attendedAt = [...e.history].reverse().find((h) => /^(Attended|Job done)/.test(h.text))?.at ?? e.bookedFor ?? e.receivedAt;
    const weeks = rebookWeeksFor(e.bookedType, s);
    const dueAt = new Date(new Date(attendedAt).getTime() + weeks * 7 * DAY);
    const overdueDays = Math.floor((now.getTime() - dueAt.getTime()) / DAY);
    if (overdueDays < -aheadDays || overdueDays > 70) continue;
    const me = normPhone(e.phone);
    const cameBack = list.some((o) => o.id !== e.id && !o.isTest && o.status !== 'spam' && ((me && normPhone(o.phone) === me) || (e.email && o.email === e.email)) && new Date(o.receivedAt) > new Date(attendedAt));
    if (cameBack) continue;
    out.push({ enquiry: e, type: e.bookedType || topicOf(e, s), weeks, dueAt: dueAt.toISOString(), overdueDays, value: enquiryValue(e, s) });
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays);
}

/** The text that invites a client back, from the rebook automation's wording if the owner changed it, else ours. */
export function rebookText(item: RebookItem, s: CaptureSettings): string {
  const e = item.enquiry;
  const owner = clean(s.business.ownerName, 40);
  const who = e.bookedWith ? ` with ${e.bookedWith}` : '';
  return `Hi ${first(e) || 'there'}, it's been about ${item.weeks} weeks since your ${item.type || 'last appointment'} at ${clean(s.business.name, 80)}, so you may be due your next one. Would you like me to book you in${who}? Just reply here${s.business.phone ? ` or call ${clean(s.business.phone, 30)}` : ''}. ${owner}\n\nReply STOP to stop these messages.`;
}

/* ---------- What the month suggests changing ---------- */

export interface Advice { title: string; detail: string; to?: '/automations' | '/enquiries' | '/settings' | '/follow-ups' | '/receptionist' }

const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Two to four plain observations, each with the one change it points to. Every figure is from the owner's own
 * inbox for the month; nothing is benchmarked against anyone else.
 */
export function advice(r: Report, list: EnquiryRecord[], s: CaptureSettings, range: { from: Date; to: Date }, now = new Date()): Advice[] {
  const out: Advice[] = [];
  const appts = s.business.kind === 'appointments';
  const beauty = isBeauty(s.business);
  const W = words(s.business.kind);
  const inRange = list.filter((e) => !e.isTest && e.status !== 'spam' && new Date(e.receivedAt) >= range.from && new Date(e.receivedAt) < range.to);
  const a = s.automations;
  if (r.caught === 0) return out;

  // 1. Out of hours: the receptionist's whole point. Say what it caught, in their own numbers.
  if (r.afterHours >= 2 && pct(r.afterHours, r.caught) >= 25) {
    const money = r.afterHoursValue > 0 ? `, ${r.afterHoursBooked} of them booked${r.afterHoursValue ? ` (worth ${r.bookedValueFrom ? 'at least ' : ''}£${Math.round(r.afterHoursValue).toLocaleString('en-GB')} by your own prices)` : ''}` : r.afterHoursBooked ? `, ${r.afterHoursBooked} of them booked` : '';
    out.push({ title: `${pct(r.afterHours, r.caught)}% of enquiries came in while you were closed`, detail: `${plural(r.afterHours, 'call, form or email', 'calls, forms and emails')} arrived outside your hours${money}. Keep calls forwarding the moment you close, and check your hours in Settings still match the days you're actually open.`, to: '/settings' });
  }
  // 2. Unanswered enquiries are the cheapest fix there is.
  if (r.unanswered >= 1) {
    out.push({ title: `${plural(r.unanswered, 'enquiry has', 'enquiries have')} had no reply for over a day`, detail: `Each one is someone who asked to hear from you. Open Enquiries, reply or mark what happened${appts && a?.ack?.on === false ? '. Switching on the thank-you text means they at least hear back straight away' : ''}.`, to: '/enquiries' });
  } else if (r.medianReplyMins != null && r.medianReplyMins > 120 && r.replied >= 3) {
    out.push({ title: `Your typical reply took ${r.medianReplyMins >= 60 ? `${Math.round(r.medianReplyMins / 60)} hours` : `${r.medianReplyMins} minutes`}`, detail: `${pct(r.within1h, r.replied)}% were answered within an hour. ${a?.ack?.on ? 'The thank-you text buys you time, but a' : 'Switch on the thank-you text so people hear back at once, then a'} quick reply the same day is what turns an enquiry into a booking.`, to: a?.ack?.on ? '/enquiries' : '/automations' });
  }
  // 3. No-shows and late cancellations.
  if (r.noShows >= 1) {
    const rem = a?.booking?.on && a.booking.steps?.reminder?.on;
    out.push({ title: `${plural(r.noShows, 'no-show or late cancellation', 'no-shows and late cancellations')}`, detail: rem
      ? `Reminders are already going out. ${s.bookings.cancellation ? 'Your cancellation policy is read out when the receptionist books and sent in the reminder; a deposit for new clients is the usual next step.' : 'Adding a cancellation policy in Settings → Bookings puts it in every booking call and reminder.'}`
      : 'The reminder before the appointment is switched off. Switching it on is the simplest fix.', to: rem ? '/settings' : '/automations' });
  }
  // 4. Price questions that went nowhere.
  const priceLost = inRange.filter((e) => e.kind === 'quote' && (e.status === 'lost' || (e.status === 'replied' && now.getTime() - new Date(e.receivedAt).getTime() > 7 * DAY)));
  if (priceLost.length >= 2) {
    out.push({ title: `${plural(priceLost.length, 'price enquiry', 'price enquiries')} didn’t turn into a booking`, detail: appts
      ? `They asked how much and then went quiet. ${s.calls.quotePolicy === 'never' ? 'Letting the receptionist give your listed prices on the call means fewer people hang up to compare.' : beauty ? 'A text a few days later offering a free consultation often brings them back; they’re listed under Follow-ups.' : 'A short follow-up a few days later often brings them back.'}`
      : `They asked for a price and didn’t book. ${a?.quote?.on ? 'Quote chasers are on; check the quotes were marked as sent so they go out.' : 'Switch on quote chasers so each one gets a nudge on day 3 and day 8.'}`, to: appts ? (s.calls.quotePolicy === 'never' ? '/settings' : '/follow-ups') : '/automations' });
  }
  // 5. The busiest day, if there's a clear one.
  const total = r.byDay.reduce((x, y) => x + y, 0);
  const top = r.byDay.indexOf(Math.max(...r.byDay));
  if (total >= 8 && pct(r.byDay[top], total) >= 30) {
    const closed = !s.calls.days.includes(top + 1);
    out.push({ title: `${DAYS_LONG[top]} is your busiest day for enquiries`, detail: `${pct(r.byDay[top], total)}% of the month's enquiries came in on a ${DAYS_LONG[top]}${closed ? ', a day you’re closed. The receptionist is catching them; make sure the follow-up happens the next morning' : '. If the team is flat out that day, that’s when the receptionist earns its keep'}.` });
  }
  // 6. Most-booked treatment, from what the owner marked booked.
  if (appts) {
    const counts = new Map<string, number>();
    for (const e of inRange) if (e.bookedType && (e.status === 'booked' || e.status === 'won')) counts.set(e.bookedType, (counts.get(e.bookedType) ?? 0) + 1);
    const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best && best[1] >= 3) {
      const p = typePrice(best[0], s.bookings.types);
      out.push({ title: `${best[0]} was booked most: ${plural(best[1], 'time', 'times')}`, detail: `${p ? `Listed at ${p.from ? 'from ' : ''}£${p.amount.toLocaleString('en-GB')}. ` : 'It has no price in your list, so the receptionist can’t quote it and the value doesn’t show here. '}${s.bookings.types.find((t) => t.name === best[0])?.rebookWeeks ? 'Its rebook interval is set, so clients get invited back at the right time.' : 'Set how many weeks until it’s due again (Settings → Bookings) and clients will be invited back at the right time.'}`, to: '/settings' });
    }
  }
  // 7. Payments owed (trades mostly).
  if (r.outstanding > 0) out.push({ title: `£${Math.round(r.outstanding).toLocaleString('en-GB')} from ${W.jobs} this month is still unpaid`, detail: `${a?.payment?.on ? 'Payment reminders are going out on their own. ' : 'Payment reminders are switched off. '}Mark each one paid as the money lands so the reminders stop.`, to: a?.payment?.on ? '/follow-ups' : '/automations' });
  // 8. Spam filtered, as a quiet reassurance.
  if (r.spam >= 3 && out.length < 4) out.push({ title: `${plural(r.spam, 'sales call', 'sales calls')} kept out of your inbox`, detail: 'Filed as spam by the receptionist and the inbox, so they never reached you. If one was real, open the Spam tab and move it back.', to: '/enquiries' });
  return out.slice(0, 4);
}
