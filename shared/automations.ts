// Automations: the messages that go to customers on their own, and the rules that keep them polite.
// Pure functions only, shared by the server's message engine and the in-browser demo, so they always agree.
//
// The owner doesn't build flows. Gainora ships a fixed set of well-made workflows; the owner switches
// each one on or off, edits the wording and timing, and marks any step "ask me first".
import { applyPatch, findPostcode, normPhone, rebookWeeksFor, type BusinessKind, type CaptureSettings, type EnquiryPatch, type EnquiryRecord } from './capture';

export type WorkflowId = 'ack' | 'booking' | 'quote' | 'payment' | 'review' | 'aftercare' | 'rebook';
export type StepId = 'ack' | 'confirm' | 'reminder' | 'chase1' | 'chase2' | 'pay1' | 'pay2' | 'pay3' | 'review' | 'checkin' | 'rebook';
export type MsgChannel = 'text' | 'email' | 'both';

export interface StepSetting { on: boolean; channel: MsgChannel; ask: boolean; text: string; subject: string; wait: number }
export interface WorkflowSetting { on: boolean; since: string; steps: Partial<Record<StepId, StepSetting>> }
export type Automations = Partial<Record<WorkflowId, WorkflowSetting>>;

export interface WaitOption { value: number; label: string }
export interface StepDef {
  id: StepId; title: string;
  waits: WaitOption[]; defaultWait: number;
  defaultAsk?: boolean;
  /** Review requests count as marketing: the opt-out line is added and can't be removed. */
  marketing?: boolean;
  /** Sent at once in reply to something the customer just did, so quiet hours don't hold it back. */
  immediate?: boolean;
  text: (kind: BusinessKind) => string;
  subject: (kind: BusinessKind) => string;
}
export interface WorkflowDef { id: WorkflowId; title: (k: BusinessKind) => string; blurb: (k: BusinessKind) => string; defaultOn: (k: BusinessKind) => boolean; steps: StepDef[]; /** Shown only for this kind of business. */ only?: BusinessKind }

export const OPT_OUT_LINE = 'Reply STOP to stop these messages.';
export const QUIET_FROM = 20;   // 8pm
export const QUIET_TO = 8;      // 8am
export const WEEKLY_CAP = 4;    // automatic messages per customer in 7 days, not counting confirmations and reminders

const appt = (k: BusinessKind) => k === 'appointments';
const NOW_ONLY: WaitOption[] = [{ value: 0, label: 'Straight away' }];
const weeks = (...w: number[]): WaitOption[] => w.map((n) => ({ value: n * 7, label: `${n} weeks after` }));
const days = (...d: number[]): WaitOption[] => d.map((n) => ({ value: n, label: n === 0 ? 'On the day' : `${n} ${n === 1 ? 'day' : 'days'}` }));

export const WORKFLOWS: WorkflowDef[] = [
  {
    id: 'ack', title: () => 'When someone gets in touch',
    blurb: (k) => appt(k) ? 'A thank-you the moment someone calls or fills in your form, if they didn’t book on the call.' : 'A thank-you the moment someone calls or fills in your form, so they don’t ring the next trade on the list.',
    defaultOn: () => true,
    steps: [{
      id: 'ack', title: 'Thank-you message', waits: NOW_ONLY, defaultWait: 0, immediate: true,
      text: (k) => appt(k)
        ? 'Hi {first name}, thanks for contacting {business}. We’ll be in touch shortly to find you an appointment.'
        : 'Hi {first name}, thanks for contacting {business}. {owner} will call you back as soon as possible.',
      subject: () => 'Thanks for getting in touch',
    }],
  },
  {
    id: 'booking', title: (k) => appt(k) ? 'When an appointment is booked' : 'When a visit is booked',
    blurb: () => 'A confirmation straight away, then a reminder before the day. If the booking moves, they get a new confirmation.',
    defaultOn: () => true,
    steps: [
      {
        id: 'confirm', title: 'Booking confirmation', waits: NOW_ONLY, defaultWait: 0, immediate: true,
        text: (k) => appt(k)
          ? 'Hi {first name}, thank you for booking with {business}. Your [{appointment} ]appointment is on {day} {date} at {time}[ with {who}], at {address}.[ {arrival}] Need to change it? Just reply to this message.'
          : 'Hi {first name}, you’re booked in with {business} for {day} {date} at {time}. Need to change it? Just reply to this message. {owner}',
        subject: () => 'Your booking is confirmed',
      },
      {
        id: 'reminder', title: 'Reminder', defaultWait: 1,
        waits: [{ value: 1, label: '9am the day before' }, { value: 24, label: '24 hours before' }, { value: 2, label: '2 hours before' }],
        text: (k) => appt(k)
          ? 'Hi {first name}, a reminder of your [{appointment} ]appointment at {business} {when} at {time}[ with {who}].[ {cancellation}] Reply to this message if you need to change it.'
          : 'Hi {first name}, a reminder that {owner} from {business} is booked to see you {when} at {time}. Reply to this message if you need to change it.',
        subject: () => 'A reminder of your booking',
      },
    ],
  },
  {
    id: 'quote', title: () => 'When you send a quote',
    blurb: () => 'A friendly nudge, then one last message. They stop as soon as the customer replies or you update the job.',
    defaultOn: (k) => !appt(k),
    steps: [
      { id: 'chase1', title: 'First chaser', waits: days(2, 3, 4, 5), defaultWait: 3,
        text: () => 'Hi {first name}, just checking the quote[ for {amount}] reached you. Happy to answer any questions or adjust anything. {owner}, {business}',
        subject: () => 'Your quote from {business}' },
      { id: 'chase2', title: 'Last chaser', waits: days(7, 8, 10, 14), defaultWait: 8,
        text: () => 'Hi {first name}, I won’t keep chasing. If you’d like to go ahead later, just reply here and I’ll get you booked in. Thanks, {owner}, {business}',
        subject: () => 'Your quote from {business}' },
    ],
  },
  {
    id: 'payment', title: () => 'When payment is due',
    blurb: () => 'Polite reminders on the due date, then after 7 and 14 days. The last one waits for your OK.',
    defaultOn: () => true,
    steps: [
      { id: 'pay1', title: 'Due date reminder', waits: days(0, 1), defaultWait: 0,
        text: () => 'Hi {first name}, a friendly reminder that {amount} for your recent [{appointment} ]booking with {business} is due {due}.[ You can pay here: {pay link}] Thank you!',
        subject: () => 'Payment reminder from {business}' },
      { id: 'pay2', title: 'Overdue reminder', waits: days(5, 7, 10), defaultWait: 7,
        text: () => 'Hi {first name}, our records show {amount} is still outstanding. If you’ve already paid, thank you and please ignore this.[ You can pay here: {pay link}] If something’s not right, just reply and we’ll sort it. {business}',
        subject: () => 'Payment reminder from {business}' },
      { id: 'pay3', title: 'Final reminder', waits: days(14, 21), defaultWait: 14, defaultAsk: true,
        text: () => 'Hi {first name}, {amount} is now overdue. Could you let us know when it will be paid, or reply if there’s a problem we can sort out together?[ {pay link}] {owner}, {business}',
        subject: () => 'Overdue payment: {business}' },
    ],
  },
  {
    id: 'review', title: (k) => appt(k) ? 'After the appointment' : 'After the job',
    blurb: (k) => appt(k) ? 'A thank-you and a request for a Google review, once they’ve attended and paid.' : 'A thank-you and a request for a Google review, once the job is done and paid.',
    defaultOn: () => true,
    steps: [{
      id: 'review', title: 'Review request', waits: days(1, 2, 3, 7), defaultWait: 1, marketing: true,
      text: (k) => appt(k)
        ? 'Hi {first name}, thank you for visiting {business}. We hope you’re feeling the benefit.[ If you have a minute, a Google review really helps us: {review link}]'
        : 'Hi {first name}, thanks for choosing {business}. I hope everything’s working well.[ If you have a minute, a Google review really helps a small business like ours: {review link}] {owner}',
      subject: () => 'Thank you from {business}',
    }],
  },
  {
    id: 'aftercare', title: () => 'Checking in after a treatment', only: 'appointments',
    blurb: () => 'A short, caring message a day or two after the appointment. If anything doesn’t feel right, they reply and it comes straight to you.',
    defaultOn: () => true,
    steps: [{
      id: 'checkin', title: 'Aftercare check-in', waits: days(1, 2, 3), defaultWait: 1,
      text: () => 'Hi {first name}, just checking in after your [{appointment} ]appointment at {business}. We hope you’re happy! If anything doesn’t feel quite right, reply here[ or call us on {phone}] and we’ll help.',
      subject: () => 'How are you getting on?',
    }],
  },
  {
    id: 'rebook', title: () => 'Inviting them back', only: 'appointments',
    blurb: () => 'A friendly nudge when it’s time for their next appointment. Never sent if they’ve already booked again, and it stops if they reply.',
    defaultOn: () => true,
    steps: [{
      id: 'rebook', title: 'Time to rebook', waits: weeks(4, 6, 8, 12, 16), defaultWait: 42, marketing: true,
      text: () => 'Hi {first name}, it’s been a little while since your [{appointment} ]appointment at {business}. Would you like to book your next one? Just reply here[ or call us on {phone}].',
      subject: () => 'Time for your next appointment?',
    }],
  },
];

export const stepDef = (wf: WorkflowId, step: StepId) => WORKFLOWS.find((w) => w.id === wf)!.steps.find((s) => s.id === step)!;

/** Default settings for every workflow, for a new client or one saved before automations existed. */
export function defaultAutomations(kind: BusinessKind, since: string): Required<Automations> {
  const out: any = {};
  for (const w of WORKFLOWS) {
    const steps: any = {};
    for (const st of w.steps) steps[st.id] = { on: true, channel: 'text', ask: !!st.defaultAsk, text: st.text(kind), subject: st.subject(kind), wait: st.defaultWait };
    out[w.id] = { on: w.defaultOn(kind), since, steps };
  }
  return out;
}

export function automationsWithDefaults(a: any, kind: BusinessKind, since: string): Required<Automations> {
  const d = defaultAutomations(kind, since);
  for (const w of WORKFLOWS) {
    const saved = a?.[w.id];
    if (!saved) continue;
    d[w.id] = { on: !!saved.on, since: saved.since || since, steps: { ...d[w.id].steps } };
    for (const st of w.steps) if (saved.steps?.[st.id]) d[w.id].steps[st.id] = { ...d[w.id].steps[st.id]!, ...saved.steps[st.id] };
  }
  return d;
}

/* ---------- Filling in the wording ---------- */

export const FIELDS = ['first name', 'business', 'owner', 'day', 'date', 'time', 'when', 'appointment', 'who', 'address', 'arrival', 'cancellation', 'amount', 'due', 'pay link', 'review link', 'phone'] as const;
export type Field = typeof FIELDS[number];

const london = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o }).format(new Date(iso));
const dayKey = (iso: string) => london(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });

export function fieldsFor(e: EnquiryRecord, s: CaptureSettings, now = new Date()): Record<Field, string> {
  const at = e.bookedFor;
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
  const money = (n: number | null) => (n != null && n > 0 ? `£${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '');
  const due = e.invoiceDue ? (dayKey(e.invoiceDue) === dayKey(now.toISOString()) ? 'today' : `on ${london(e.invoiceDue, { day: 'numeric', month: 'long' })}`) : '';
  return {
    'first name': e.name.split(' ')[0] || 'there',
    business: s.business.name,
    owner: s.business.ownerName,
    day: at ? london(at, { weekday: 'long' }) : '',
    date: at ? london(at, { day: 'numeric', month: 'long' }) : '',
    time: at ? london(at, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(' ', '') : '',
    when: at ? (dayKey(at) === dayKey(now.toISOString()) ? 'today' : dayKey(at) === dayKey(tomorrow) ? 'tomorrow' : `on ${london(at, { weekday: 'long', day: 'numeric', month: 'long' })}`) : '',
    appointment: (e.bookedType || '').toLowerCase(),
    who: e.bookedWith || '',
    address: s.bookings.address || '',
    arrival: s.bookings.arrival || '',
    cancellation: s.bookings.cancellation || '',
    amount: money(e.jobValue ?? e.quoteAmount),
    due,
    'pay link': s.followUps.payLink || '',
    'review link': s.followUps.reviewLink || '',
    phone: s.business.phone || '',
  };
}

/**
 * Fills in {fields}. Anything in [square brackets] is left out when a field inside it is empty,
 * so "[with {who}]" disappears when nobody is named.
 */
export function render(template: string, f: Record<string, string>, marketing = false): string {
  const fill = (t: string) => t.replace(/\{([a-z ]+)\}/gi, (_, k) => f[k.toLowerCase()] ?? '');
  let out = template.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const keys = [...inner.matchAll(/\{([a-z ]+)\}/gi)].map((m) => m[1].toLowerCase());
    return keys.some((k) => !f[k]) ? '' : fill(inner);
  });
  // Plain quotes keep a text in the cheaper character set (curly ones make every text cost twice as much).
  out = fill(out).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[ \t]+/g, ' ').replace(/\s+([.,!?])/g, '$1').replace(/\.\./g, '.').trim();
  if (marketing && !out.includes('STOP')) out += `\n\n${OPT_OUT_LINE}`;
  return out;
}

/** Text messages are billed in pieces of 160 characters (153 when split; 70 with emoji or curly quotes). */
export function smsParts(text: string): number {
  const gsm = /^[\x20-\x7E\n£€é]*$/.test(text);
  const per = gsm ? 160 : 70; const split = gsm ? 153 : 67;
  return text.length <= per ? 1 : Math.ceil(text.length / split);
}

/* ---------- Deciding what to send ---------- */

export interface MessageLite {
  enquiryId: string | null; direction: 'in' | 'out'; key: string | null; status: string; createdAt: string; automatic: boolean;
}

export interface Draft {
  enquiryId: string; workflow: WorkflowId; step: StepId; key: string;
  channel: 'text' | 'email'; to: string; subject: string; body: string;
  ask: boolean; sendAt: string; patch: EnquiryPatch | null;
}

/** Moves a send time out of quiet hours (8pm–8am UK time) to 8am. */
export function outOfQuietHours(iso: string): string {
  let d = new Date(iso);
  for (let i = 0; i < 14; i++) {
    const h = Number(london(d.toISOString(), { hour: 'numeric', hourCycle: 'h23' }));
    if (h >= QUIET_TO && h < QUIET_FROM) return d.toISOString();
    const m = Number(london(d.toISOString(), { minute: 'numeric' }));
    d = new Date(d.getTime() + (60 - m) * 60_000);   // to the next full hour
  }
  return d.toISOString();
}

/** 9am UK time on the day before a booking. */
function nineTheDayBefore(iso: string): string {
  const day = new Date(new Date(iso).getTime() - 86_400_000);
  const base = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9));
  const h = Number(london(base.toISOString(), { hour: 'numeric', hourCycle: 'h23' }));
  return new Date(base.getTime() - (h - 9) * 3_600_000).toISOString();
}

const lastHistory = (e: EnquiryRecord, re: RegExp) => [...e.history].reverse().find((h) => re.test(h.text))?.at ?? null;

interface Due { wf: WorkflowId; step: StepId; key: string; anchor: string; sendAt: string; patch: EnquiryPatch | null }

/** Every message this enquiry should get, with its send time. Some may still be in the future. */
export function schedule(e: EnquiryRecord, s: CaptureSettings): Due[] {
  const out: Due[] = [];
  const kind = s.business.kind;
  const dayMs = 86_400_000;
  if (e.isTest || e.status === 'spam' || e.kind === 'spam') return out;
  // Thank-you: for enquiries not booked on the call, not logged by the owner, and not clinic emergencies
  // (those callers have been told to get urgent help, not "we'll find you an appointment").
  const bookedOnCall = e.history.some((h) => /^Booked in/.test(h.text) && new Date(h.at).getTime() - new Date(e.receivedAt).getTime() < 15 * 60_000);
  const loggedByOwner = e.history.some((h) => h.text === 'Logged by you');
  if (!bookedOnCall && !loggedByOwner && !(e.urgency === 'emergency' && kind === 'appointments')) {
    out.push({ wf: 'ack', step: 'ack', key: 'ack', anchor: e.receivedAt, sendAt: e.receivedAt, patch: null });
  }
  if (e.status === 'booked' && e.bookedFor) {
    const anchor = lastHistory(e, /^(Booked in|Moved to)/) ?? e.receivedAt;
    out.push({ wf: 'booking', step: 'confirm', key: `confirm@${e.bookedFor}`, anchor, sendAt: anchor, patch: null });
    const w = s.automations?.booking?.steps?.reminder?.wait ?? 1;
    const at = w === 1 ? nineTheDayBefore(e.bookedFor) : new Date(new Date(e.bookedFor).getTime() - w * 3_600_000).toISOString();
    // Only if the reminder is still useful: at least 3 hours after the booking was made and before the appointment.
    if (new Date(at).getTime() - new Date(anchor).getTime() > 3 * 3_600_000) out.push({ wf: 'booking', step: 'reminder', key: `reminder@${e.bookedFor}`, anchor, sendAt: at, patch: null });
  }
  if (e.status === 'quoted' && e.quotedAt) {
    const steps: StepId[] = ['chase1', 'chase2'];
    const st = steps[e.chasersSent];
    if (st) {
      const w = s.automations?.quote?.steps?.[st]?.wait ?? stepDef('quote', st).defaultWait;
      out.push({ wf: 'quote', step: st, key: `${st}@${e.quotedAt}`, anchor: e.quotedAt, sendAt: new Date(new Date(e.quotedAt).getTime() + w * dayMs).toISOString(), patch: { chaserSent: true } });
    }
  }
  if (e.status === 'won' && e.invoiceDue && !e.paidAt) {
    const steps: StepId[] = ['pay1', 'pay2', 'pay3'];
    const st = steps[e.paymentRemindersSent];
    if (st) {
      const w = s.automations?.payment?.steps?.[st]?.wait ?? stepDef('payment', st).defaultWait;
      const due = new Date(`${e.invoiceDue.slice(0, 10)}T10:00:00Z`).getTime();
      const anchor = lastHistory(e, /^(Job done|Attended)/) ?? e.receivedAt;
      out.push({ wf: 'payment', step: st, key: `${st}@${e.invoiceDue.slice(0, 10)}`, anchor, sendAt: new Date(due + w * dayMs).toISOString(), patch: { paymentReminderSent: true } });
    }
  }
  if (e.status === 'won' && kind === 'appointments') {
    const attended = lastHistory(e, /^(Job done|Attended)/) ?? e.receivedAt;
    const wc = s.automations?.aftercare?.steps?.checkin?.wait ?? 1;
    out.push({ wf: 'aftercare', step: 'checkin', key: `checkin@${attended.slice(0, 10)}`, anchor: attended, sendAt: new Date(new Date(attended).getTime() + wc * dayMs).toISOString(), patch: null });
    // "Time to rebook" follows the treatment's own interval when the owner set one, else the step's general wait.
    const wr = rebookWeeksFor(e.bookedType, s) * 7;
    out.push({ wf: 'rebook', step: 'rebook', key: `rebook@${attended.slice(0, 10)}`, anchor: attended, sendAt: new Date(new Date(attended).getTime() + wr * dayMs).toISOString(), patch: null });
  }
  if (e.status === 'won' && !e.reviewAskedAt && (e.paidAt || !e.invoiceDue)) {
    const anchor = e.paidAt ?? lastHistory(e, /^(Job done|Attended)/) ?? e.receivedAt;
    const w = s.automations?.review?.steps?.review?.wait ?? 1;
    out.push({ wf: 'review', step: 'review', key: 'review', anchor, sendAt: new Date(new Date(anchor).getTime() + w * dayMs).toISOString(), patch: { reviewAsked: true } });
  }
  return out;
}

/**
 * The messages to create now for one enquiry. Rules that always apply:
 * the workflow and step are switched on; it happened after the workflow was switched on; it hasn't been
 * sent already; no texts to someone who replied STOP; chasers, payment and review messages pause once the
 * customer has replied; quiet hours (except instant replies); at most WEEKLY_CAP automatic messages a week.
 */
export function dueNow(e: EnquiryRecord, s: CaptureSettings, msgs: MessageLite[], optedOut: boolean, now = new Date(), others: EnquiryRecord[] = []): Draft[] {
  const auto = s.automations;
  if (!auto) return [];
  const mine = msgs.filter((m) => m.enquiryId === e.id);
  const sentKeys = new Set(mine.filter((m) => m.direction === 'out' && m.key).map((m) => m.key!));
  const lastIn = mine.filter((m) => m.direction === 'in').map((m) => m.createdAt).sort().pop() ?? null;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  let recent = mine.filter((m) => m.direction === 'out' && m.automatic && !/^(confirm|reminder)@/.test(m.key ?? '') && new Date(m.createdAt).getTime() > weekAgo).length;
  const out: Draft[] = [];
  const f = fieldsFor(e, s, now);
  for (const d of schedule(e, s)) {
    const wf = auto[d.wf];
    const st = wf?.steps?.[d.step];
    const def = stepDef(d.wf, d.step);
    if (!wf?.on || !st?.on) continue;
    if (new Date(d.anchor).getTime() < new Date(wf.since).getTime()) continue;
    const key = `${d.wf}.${d.key}`;
    if (sentKeys.has(key)) continue;
    const sendAt = def.immediate ? d.sendAt : outOfQuietHours(d.sendAt);
    if (new Date(sendAt).getTime() > now.getTime()) continue;
    // Don't send something that's out of date: a confirmation more than a day late, a reminder after the booking.
    if (def.immediate && now.getTime() - new Date(d.sendAt).getTime() > 86_400_000) continue;
    if (d.step === 'reminder' && e.bookedFor && new Date(e.bookedFor).getTime() < now.getTime()) continue;
    if (['quote', 'payment', 'review', 'rebook'].includes(d.wf) && lastIn && new Date(lastIn) > new Date(d.anchor)) continue;
    // No "time to rebook" for someone who has already been back in touch since.
    if (d.wf === 'rebook') {
      const me = normPhone(e.phone);
      if (others.some((o) => o.id !== e.id && ((me && normPhone(o.phone) === me) || (e.email && o.email === e.email)) && new Date(o.receivedAt) > new Date(d.anchor))) continue;
      if (now.getTime() - new Date(d.sendAt).getTime() > 21 * 86_400_000) continue;   // too late to be useful
    }
    if (d.wf === 'aftercare' && now.getTime() - new Date(d.sendAt).getTime() > 2 * 86_400_000) continue;   // a check-in a week late isn't caring
    if (!/^(confirm|reminder)$/.test(d.step) && recent >= WEEKLY_CAP) continue;
    const phone = normPhone(e.phone);
    const channels: ('text' | 'email')[] = st.channel === 'both' ? ['text', 'email'] : [st.channel];
    let made = false;
    for (const ch of channels) {
      const to = ch === 'text' ? (optedOut ? '' : phone) : e.email;
      if (!to) continue;
      out.push({
        enquiryId: e.id, workflow: d.wf, step: d.step, key, channel: ch, to,
        subject: render(st.subject || def.subject(s.business.kind), f), body: render(st.text, f, !!def.marketing),
        ask: st.ask, sendAt, patch: made ? null : d.patch,
      });
      made = true;
    }
    // Text wanted but no number (or opted out): fall back to email when there is one.
    if (!made && st.channel === 'text' && e.email) {
      out.push({ enquiryId: e.id, workflow: d.wf, step: d.step, key, channel: 'email', to: e.email, subject: render(st.subject || def.subject(s.business.kind), f), body: render(st.text, f, !!def.marketing), ask: st.ask, sendAt, patch: d.patch });
      made = true;
    }
    if (made && !/^(confirm|reminder)$/.test(d.step)) recent++;
  }
  return out;
}

/** What's coming up next for an enquiry, for the app to show ("Reminder: Mon 9am"). */
export function upcoming(e: EnquiryRecord, s: CaptureSettings, msgs: MessageLite[], now = new Date()): { workflow: WorkflowId; step: StepId; sendAt: string; title: string }[] {
  const sent = new Set(msgs.filter((m) => m.enquiryId === e.id && m.direction === 'out' && m.key).map((m) => m.key!));
  return schedule(e, s)
    .filter((d) => s.automations?.[d.wf]?.on && s.automations[d.wf]!.steps[d.step]?.on && !sent.has(`${d.wf}.${d.key}`))
    .map((d) => ({ workflow: d.wf, step: d.step, sendAt: stepDef(d.wf, d.step).immediate ? d.sendAt : outOfQuietHours(d.sendAt), title: stepDef(d.wf, d.step).title }))
    .filter((d) => new Date(d.sendAt).getTime() > now.getTime());
}

/** The change in the enquiry that an automatic step stands for, once it's sent. */
export const patchForStep = (step: string | null): EnquiryPatch | null =>
  step === 'chase1' || step === 'chase2' ? { chaserSent: true } : /^pay[123]$/.test(step ?? '') ? { paymentReminderSent: true } : step === 'review' ? { reviewAsked: true } : null;

/** Applies the change that sending a message implies (chaser count, reminders, review asked). */
export function afterSend(e: EnquiryRecord, d: Draft, s: CaptureSettings, now = new Date()): EnquiryRecord {
  return d.patch ? applyPatch(e, d.patch, s, now) : e;
}

/* ---------- Texts in ---------- */

export type Keyword = 'stop' | 'start' | null;
export function keyword(body: string): Keyword {
  const t = body.trim().toLowerCase().replace(/[^a-z ]/g, '');
  if (/^(stop|stopall|unsubscribe|cancel messages|end|quit|opt out|optout)$/.test(t)) return 'stop';
  if (/^(start|unstop|resume)$/.test(t)) return 'start';
  return null;
}

/** The text sent to the owner's own mobile when an urgent call comes in. Not sent to customers. */
export function ownerAlert(e: EnquiryRecord, s: CaptureSettings): string {
  const who = e.name || e.phone || 'A caller';
  const where = e.postcode || findPostcode(e.summary);
  return `${e.urgency === 'emergency' ? 'EMERGENCY' : 'Urgent'} for ${s.business.name}: ${who}${where ? `, ${where}` : ''}. ${e.summary.slice(0, 220)}${e.phone ? ` Call back: ${e.phone.replace(/^\+44/, '0')}` : ''}`;
}
