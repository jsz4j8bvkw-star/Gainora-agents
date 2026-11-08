// The demo: a plumbing and heating business in Cornwall, with five weeks of enquiries.
// Everything runs in the browser with the same rules as the live app (shared/capture.ts).
import type { Api } from './api';
import type { CaptureSettings, EnquiryRecord, Source, User } from './types';
import { applyPatch, DEFAULT_GREETING, DEFAULT_SAFETY, firstReply, greetingFor, isAfterHours, normaliseEnquiry, triage } from '../../shared/capture';
import { uid } from './format';

const KEY = 'gainora.capture.demo.v1';
const DAY = 86_400_000;

export type Sample = 'trade' | 'clinic';
interface DemoState { user: User | null; sample: Sample; settings: CaptureSettings | null; enquiries: EnquiryRecord[]; sources: Source[] }
const fresh = (): DemoState => ({ user: null, sample: 'trade', settings: null, enquiries: [], sources: [] });

function load(): DemoState {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...fresh(), ...JSON.parse(raw) }; } catch { /* no storage */ }
  return fresh();
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token32 = () => Array.from({ length: 32 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-'[Math.floor(Math.random() * 58)]).join('');

export const DEMO_SETTINGS: CaptureSettings = {
  business: { kind: 'trade', name: 'Smith Plumbing & Heating', ownerName: 'Dave', trade: 'Plumbing and heating', location: 'Truro, Cornwall', website: 'https://smithplumbing.example', phone: '01872 000000', alertEmail: 'dave@smithplumbing.example', alertMobile: '07700 900111' },
  work: {
    services: 'Boiler servicing and repairs\nNew boilers (gas and oil)\nBathroom fitting\nLeaks, taps and toilets\nRadiators and heating systems',
    notDone: 'Electrical work\nDrain unblocking',
    areas: 'Truro and 20 miles around, including Falmouth, Redruth and St Austell',
  },
  calls: {
    days: [1, 2, 3, 4, 5], open: '08:00', close: '17:30',
    emergencies: 'No heating or hot water for someone vulnerable\nWater leaking or a burst pipe\nNo water at all',
    transferTo: 'Text Dave on 07700 900111 and say it’s urgent',
    quotePolicy: 'ranges', priceNotes: 'Boiler service from £85. Call-out and first hour £75. New boilers and bathrooms are quoted after a visit.',
    booking: 'callback', gasWork: true, recording: true, notify: 'urgent', greeting: DEFAULT_GREETING, announceAi: false, safety: '',
  },
  bookings: { system: 'Google Calendar', systemOther: '', account: 'dave@smithplumbing.example', mode: 'offer', address: '', arrival: '', types: [{ name: 'Quote visit', minutes: 30, price: 'Free', who: 'Dave' }, { name: 'Boiler service', minutes: 60, price: '£85', who: 'Dave' }], staff: 'Dave Smith', noticeHours: 24, aheadWeeks: 4, cancellation: '', status: 'connected' },
  followUps: { reviewLink: 'https://g.page/r/smith-plumbing/review', payLink: 'https://pay.example/smith-plumbing', paymentDays: 14 },
  provider: { name: 'Retell', aiNumber: '01872 000001' },
  completedAt: new Date(Date.now() - 36 * DAY).toISOString(),
};

export const CLINIC_SETTINGS: CaptureSettings = {
  business: { kind: 'appointments', name: 'Lemon Street Physio', ownerName: 'Sarah', trade: 'Physiotherapy', location: 'Truro, Cornwall', website: 'https://lemonstreetphysio.example', phone: '01872 000100', alertEmail: 'sarah@lemonstreetphysio.example', alertMobile: '07700 900222' },
  work: { services: 'Back and neck pain\nSports injuries\nPost-surgery rehab\nSports massage\nHeadaches and jaw pain', notDone: 'Home visits\nNHS referrals', areas: '' },
  calls: {
    days: [1, 2, 3, 4, 5, 6], open: '08:00', close: '19:00', emergencies: '', transferTo: 'Text Sarah on 07700 900222',
    quotePolicy: 'fixed', priceNotes: '', booking: 'calendar', gasWork: false, recording: true, notify: 'urgent',
    greeting: DEFAULT_GREETING, announceAi: false, safety: DEFAULT_SAFETY,
  },
  bookings: {
    system: 'Cliniko', systemOther: '', account: 'Lemon Street Physio', mode: 'book', address: '12 Lemon Street, Truro TR1 2LS',
    arrival: 'Please wear loose, comfortable clothing and arrive 5 minutes early. Free parking behind the clinic.',
    types: [{ name: 'Initial consultation', minutes: 45, price: '£65', who: 'Any physio' }, { name: 'Follow-up', minutes: 30, price: '£50', who: 'Your physio' }, { name: 'Sports massage', minutes: 60, price: '£55', who: 'Tom' }],
    staff: 'Sarah Bennett\nJames Hooper\nTom Ellis', noticeHours: 2, aheadWeeks: 6, cancellation: 'Please give 24 hours’ notice to cancel or move, or the full fee may be charged.', status: 'connected',
  },
  followUps: { reviewLink: 'https://g.page/r/lemon-street-physio/review', payLink: 'https://pay.example/lemon-street', paymentDays: 0 },
  provider: { name: 'Retell', aiNumber: '01872 000101' },
  completedAt: new Date(Date.now() - 40 * DAY).toISOString(),
};

interface Seed {
  name: string; phone?: string; email?: string; channel: EnquiryRecord['channel']; summary: string;
  days: number; hour: number; min?: number;
  ago?: number;            // hours ago, for the newest few, so they're never in the future
  then?: (e: EnquiryRecord, at: (d: number, h?: number) => Date) => EnquiryRecord;
}

/** Times are set against "now" so the demo always looks current. */
function seed(settings: CaptureSettings): EnquiryRecord[] {
  const now = Date.now();
  const at = (days: number, hour = 10, min = 0) => { const d = new Date(now - days * DAY); d.setHours(hour, min, 0, 0); return d; };
  const step = (e: EnquiryRecord, d: Date, p: Parameters<typeof applyPatch>[1]) => applyPatch(e, p, settings, d);
  const S: Seed[] = settings.business.kind === 'appointments' ? clinicSeeds(step, now) : [
    { name: 'Jane Price', phone: '07700 900123', channel: 'call', days: 0, hour: 0, ago: 1.4, summary: 'Boiler stopped overnight. No heating or hot water and her elderly mother is staying. Postcode TR1 2AB. Wants someone today if at all possible.' },
    { name: 'Tom Hughes', phone: '07700 900456', email: 'tom.hughes@example.com', channel: 'form', days: 0, hour: 0, ago: 0.6, summary: 'Quote for replacing a small family bathroom: bath, basin, toilet and tiling. TR3 6JE. Flexible on dates, ideally before Christmas.' },
    { name: 'Jo Martin', phone: '07700 900789', channel: 'call', days: 1, hour: 12, min: 5, summary: 'Asked for a call back about a new boiler quote. Current boiler is 18 years old. TR2 4HL.' },
    { name: 'Mark Ellis', phone: '07700 900321', channel: 'call', days: 1, hour: 19, min: 20, summary: 'Radiator valve in the hallway is leaking and dripping onto the carpet. Has put a towel down. TR4 8QP.',
      then: (e, t) => step(e, t(1, 19.5), { replied: true }) },
    { name: 'Growth Leads Ltd', phone: '02079 460000', channel: 'call', days: 2, hour: 11, summary: 'Caller said they can get you more leads with SEO and a better Google ranking.' },
    { name: 'Kate Brown', phone: '07700 900654', channel: 'call', days: 2, hour: 20, min: 45, summary: 'Toilet keeps running after flushing. Can someone look at it this week. TR1 3QS.',
      then: (e, t) => step(step(e, t(1, 8.5), { replied: true }), t(1, 9), { status: 'booked', bookedFor: new Date(now + 1 * DAY).toISOString() }) },
    { name: 'Sarah Knight', phone: '07700 900987', channel: 'call', days: 3, hour: 10, min: 30, summary: 'Annual service for a Worcester combi boiler. Prefers a morning. TR1 1UH.',
      then: (e, t) => step(step(e, t(3, 10.7), { replied: true }), t(3, 11), { status: 'booked', bookedFor: new Date(now + 2 * DAY).toISOString() }) },
    { name: 'Priya Shah', email: 'priya.shah@example.com', phone: '07700 900222', channel: 'email', days: 5, hour: 14, summary: 'Quote to move a radiator to the other wall and fit thermostatic valves on four radiators. TR3 7AB.',
      then: (e, t) => step(step(e, t(5, 15), { replied: true }), t(4, 16), { status: 'quoted', quoteAmount: 640 }) },
    { name: 'Daniel Fox', phone: '07700 900333', channel: 'call', days: 6, hour: 18, min: 10, summary: 'Caller can smell gas near the meter cupboard. Receptionist gave the National Gas Emergency number. TR1 2PE.',
      then: (e, t) => ({ ...step(e, t(6, 18.3), { replied: true, status: 'lost' }), notes: 'Gas network attended. Not a job for us, but rang to check he was OK.' }) },
    { name: 'Emma Lewis', phone: '07700 900444', channel: 'call', days: 7, hour: 21, min: 30, summary: 'Burst pipe under the kitchen sink, water everywhere. Has turned off the stopcock. TR4 9DD.',
      then: (e, t) => { let x = step(e, t(7, 21.6), { replied: true }); x = step(x, t(6, 9), { status: 'won', jobValue: 180 }); x = step(x, t(5, 12), { paid: true }); return step(x, t(4, 10), { reviewAsked: true }); } },
    { name: 'Owen Price', email: 'owen.p@example.com', channel: 'form', days: 8, hour: 16, summary: 'Could you fit an outside tap at the back of the house? TR2 5RT.',
      then: (e, t) => step(step(e, t(8, 17), { replied: true }), t(6, 10), { status: 'lost' }) },
    { name: 'Alan Cooke', phone: '07700 900555', email: 'alan.cooke@example.com', channel: 'form', days: 11, hour: 8, min: 50, summary: 'Quote for a full bathroom refit including a walk-in shower. TR1 1RJ.',
      then: (e, t) => { let x = step(e, t(11, 10), { replied: true }); x = step(x, t(9, 15), { status: 'quoted', quoteAmount: 4800 }); return step(x, t(6, 9), { chaserSent: true }); } },
    { name: 'Helen Ward', phone: '07700 900666', channel: 'call', days: 12, hour: 13, summary: 'Boiler service for a Vaillant combi, also the pressure keeps dropping. TR3 6PQ.',
      then: (e, t) => { let x = step(e, t(12, 13.5), { replied: true }); x = step(x, t(12, 14), { status: 'booked', bookedFor: t(9, 9).toISOString() }); x = step(x, t(9, 12), { status: 'won', jobValue: 145 }); return step(x, t(2, 11), { paid: true }); } },
    { name: 'Linda Moss', phone: '07700 900777', channel: 'call', days: 21, hour: 7, min: 15, summary: 'Hot water cylinder not heating up. TR4 8AA.',
      then: (e, t) => { let x = step(e, t(21, 8.4), { replied: true }); x = step(x, t(19, 10), { status: 'won', jobValue: 320 }); return { ...x, invoiceDue: t(5, 0).toISOString().slice(0, 10) }; } },
    { name: 'Rob Turner', phone: '07700 900888', email: 'rob.turner@example.com', channel: 'call', days: 30, hour: 18, min: 40, summary: 'New combi boiler to replace an old back boiler. TR1 3XY.',
      then: (e, t) => { let x = step(e, t(29, 9), { replied: true }); x = step(x, t(28, 15), { status: 'quoted', quoteAmount: 2950 }); x = step(x, t(24, 9), { status: 'won', jobValue: 2950 }); x = { ...x, invoiceDue: t(9, 0).toISOString().slice(0, 10) }; return step(x, t(9, 10), { paymentReminderSent: true }); } },
    { name: 'Chris Young', phone: '07700 900999', channel: 'call', days: 16, hour: 11, summary: 'Leaking kitchen tap and a stiff isolation valve. TR2 4QQ.',
      then: (e, t) => { let x = step(e, t(16, 11.3), { replied: true, status: 'booked', bookedFor: t(15, 9).toISOString() }); x = step(x, t(15, 12), { status: 'won', jobValue: 95 }); x = step(x, t(13, 9), { paid: true }); return step(x, t(12, 10), { reviewAsked: true }); } },
    { name: 'Sophie Hall', phone: '07700 900135', channel: 'call', days: 18, hour: 19, summary: 'No hot water since this morning, combi boiler showing an error code. TR3 6AA.',
      then: (e, t) => { let x = step(e, t(18, 19.2), { replied: true }); x = step(x, t(17, 10), { status: 'won', jobValue: 210 }); x = step(x, t(15, 9), { paid: true }); return step(x, t(14, 9), { reviewAsked: true }); } },
    { name: 'Peter Green', phone: '07700 900246', channel: 'call', days: 23, hour: 10, summary: 'Quote for powerflushing the heating system, radiators cold at the bottom. TR1 2CC.',
      then: (e, t) => { let x = step(e, t(23, 11), { replied: true }); x = step(x, t(22, 16), { status: 'quoted', quoteAmount: 480 }); x = step(x, t(19, 9), { chaserSent: true }); x = step(x, t(16, 10), { status: 'won', jobValue: 480 }); x = step(x, t(12, 9), { paid: true }); return step(x, t(11, 9), { reviewAsked: true }); } },
    { name: 'Ruth Allen', email: 'ruth.allen@example.com', channel: 'email', days: 25, hour: 15, summary: 'Would like a quote for a new en-suite shower. TR4 7EE.',
      then: (e, t) => { let x = step(e, t(24, 9), { replied: true }); x = step(x, t(22, 12), { status: 'quoted', quoteAmount: 3600 }); x = step(x, t(19, 9), { chaserSent: true }); x = step(x, t(14, 9), { chaserSent: true }); return step(x, t(12, 9), { status: 'lost' }); } },
    { name: 'Gary Wood', phone: '07700 900468', channel: 'call', days: 27, hour: 6, min: 55, summary: 'Water coming through the kitchen ceiling from the bathroom above. TR1 1AA.',
      then: (e, t) => { let x = step(e, t(27, 7.2), { replied: true }); x = step(x, t(27, 15), { status: 'won', jobValue: 260 }); x = step(x, t(25, 9), { paid: true }); return step(x, t(24, 9), { reviewAsked: true }); } },
    { name: 'Nina Patel', phone: '07700 900579', channel: 'call', days: 29, hour: 17, min: 50, summary: 'Thermostat not talking to the boiler, house is cold. TR2 5AA.',
      then: (e, t) => { let x = step(e, t(29, 18.5), { replied: true }); x = step(x, t(28, 11), { status: 'won', jobValue: 135 }); x = step(x, t(26, 9), { paid: true }); return step(x, t(25, 9), { reviewAsked: true }); } },
    { name: 'Best Merchant Services', phone: '03300 000000', channel: 'call', days: 14, hour: 12, summary: 'Offered cheaper card machine fees through merchant services.' },
    { name: 'Liam Scott', phone: '07700 900680', channel: 'call', days: 33, hour: 20, min: 30, summary: 'Asked for a price for a new oil boiler. TR4 9ZZ.',
      then: (e, t) => { let x = step(e, t(32, 9), { replied: true }); x = step(x, t(31, 15), { status: 'quoted', quoteAmount: 4200 }); x = step(x, t(28, 9), { chaserSent: true }); x = step(x, t(26, 9), { status: 'won', jobValue: 4200 }); x = step(x, t(15, 9), { paid: true }); return step(x, t(14, 9), { reviewAsked: true }); } },
    { name: 'Amy Clarke', phone: '07700 900791', channel: 'call', days: 35, hour: 9, summary: 'Dripping shower head and low pressure upstairs. TR1 4BB.',
      then: (e, t) => { let x = step(e, t(35, 9.5), { replied: true }); x = step(x, t(34, 14), { status: 'won', jobValue: 110 }); return step(x, t(32, 9), { paid: true, reviewAsked: true }); } },
    { name: 'Ben Hart', email: 'ben.hart@example.com', channel: 'form', days: 38, hour: 22, summary: 'Quote to replace all radiators in a three-bed semi. TR3 8CC.',
      then: (e, t) => { let x = step(e, t(37, 9), { replied: true }); x = step(x, t(36, 12), { status: 'quoted', quoteAmount: 2100 }); x = step(x, t(33, 9), { chaserSent: true }); x = step(x, t(28, 9), { chaserSent: true }); return step(x, t(27, 9), { status: 'lost' }); } },
  ];
  return S.map((x) => {
    const when = x.ago != null ? new Date(now - x.ago * 3_600_000) : at(x.days, Math.floor(x.hour), x.min ?? Math.round((x.hour % 1) * 60));
    const e = normaliseEnquiry({ name: x.name, phone: x.phone, email: x.email, summary: x.summary }, x.channel, when)!;
    const t = triage(e.summary);
    const after = isAfterHours(e.receivedAt, settings.calls);
    const history = [{ at: e.receivedAt, text: `${x.channel === 'call' ? 'Call answered by your receptionist' : x.channel === 'form' ? 'Website form received' : 'Email received'}${after ? ' (out of hours)' : ''}` }];
    if (t.urgency !== 'normal') history.push({ at: e.receivedAt, text: `${t.urgency === 'emergency' ? 'Flagged as an emergency' : 'Flagged as urgent'}: ${t.reasons.join('; ')}` });
    let rec: EnquiryRecord = {
      id: uid('e_'), channel: x.channel, name: e.name, phone: e.phone, email: e.email, postcode: e.postcode, summary: e.summary,
      transcript: x.channel === 'call' && t.kind !== 'spam' ? demoTranscript(x.name, e.summary, settings, rec0Booked(x)) : '', recordingUrl: '',
      urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: t.kind === 'spam' ? 'spam' : 'new', afterHours: after,
      notes: '', history, repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null, jobValue: null,
      invoiceDue: null, paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: e.receivedAt, isTest: false,
    };
    if (x.then) rec = x.then(rec, (d, h = 10) => at(d, Math.floor(h), Math.round((h % 1) * 60)));
    return rec;
  }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

type Step = (e: EnquiryRecord, d: Date, p: Parameters<typeof applyPatch>[1]) => EnquiryRecord;
const rec0Booked = (x: Seed) => /booked|book(ing)? (an|a)/i.test(x.summary);

/** Five weeks at a physio clinic: bookings, a red-flag call, attended appointments and a few unpaid. */
function clinicSeeds(step: Step, now: number): Seed[] {
  const slot = (daysAhead: number, h: number, m = 0) => { const d = new Date(now + daysAhead * DAY); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const attended = (fee: number, paid = true, review = true) => (e: EnquiryRecord, t: (d: number, h?: number) => Date) => {
    const d0 = (Date.now() - new Date(e.receivedAt).getTime()) / DAY;
    let x = step(e, new Date(new Date(e.receivedAt).getTime() + 4 * 60_000), { status: 'booked', bookedFor: t(Math.max(0, Math.floor(d0) - 2), 10).toISOString() });
    x = step(x, t(Math.max(0, Math.floor(d0) - 2), 11), { status: 'won', jobValue: fee });
    if (paid) x = step(x, t(Math.max(0, Math.floor(d0) - 2), 11.2), { paid: true });
    if (paid && review) x = step(x, t(Math.max(0, Math.floor(d0) - 3), 10), { reviewAsked: true });
    return x;
  };
  return [
    { name: 'George Hammond', phone: '07700 900310', channel: 'call', days: 0, hour: 0, ago: 0.7, summary: 'Lower back pain for two weeks, worse when sitting. New patient. Booked an initial consultation.',
      then: (e) => step(e, new Date(new Date(e.receivedAt).getTime() + 3 * 60_000), { status: 'booked', bookedFor: slot(2, 10) }) },
    { name: 'Priya Shah', phone: '07700 900311', channel: 'call', days: 0, hour: 0, ago: 2.2, summary: 'Sore shoulder after swimming. Asked whether we treat sports injuries and would like a call back about times after work.' },
    { name: 'Mark Davies', phone: '07700 900312', channel: 'call', days: 1, hour: 19, min: 40, summary: 'Lower back pain since this morning with new numbness around the groin, and he has lost control of his bladder. Receptionist did not book and told him to go to A&E now.',
      then: (e, t) => ({ ...step(e, t(1, 19.9), { replied: true, status: 'lost' }), notes: 'Sarah rang at 7.55pm. He was on his way to A&E at Treliske. Call him tomorrow to check in.' }) },
    { name: 'Emma Wilson', email: 'emma.wilson@example.com', phone: '07700 900313', channel: 'form', days: 1, hour: 21, min: 10, summary: 'Could I book a sports massage for Saturday morning? Training for the Cornwall half marathon.',
      then: (e, t) => step(step(e, t(0, 8.2), { replied: true }), t(0, 8.3), { status: 'booked', bookedFor: slot(6 - new Date(now).getDay() || 7, 9) }) },
    { name: 'Tom Baker', phone: '07700 900314', channel: 'call', days: 2, hour: 12, min: 15, summary: 'Returning patient. Follow-up for knee rehab with James. Booked.',
      then: (e) => step(e, new Date(new Date(e.receivedAt).getTime() + 3 * 60_000), { status: 'booked', bookedFor: slot(1, 16, 30) }) },
    { name: 'Clinic Growth Ltd', phone: '02079 460111', channel: 'call', days: 2, hour: 10, summary: 'Caller offered SEO and a better Google ranking for the clinic website.' },
    { name: 'Lucy Grant', phone: '07700 900315', channel: 'call', days: 6, hour: 18, min: 30, summary: 'Neck pain and headaches from desk work. New patient. Booked an initial consultation.', then: attended(65, true, false) },
    { name: 'Rachel Hughes', phone: '07700 900316', channel: 'call', days: 7, hour: 13, summary: 'Follow-up for plantar fasciitis. Returning patient. Booked.',
      then: (e, t) => { const x = attended(50, false)(e, t); return { ...x, invoiceDue: t(4, 0).toISOString().slice(0, 10) }; } },
    { name: 'Alan Price', phone: '07700 900317', channel: 'call', days: 5, hour: 11, summary: 'Asked about prices for an initial consultation and said he would think about it.',
      then: (e, t) => step(e, t(5, 11.5), { replied: true }) },
    { name: 'Sophie Turner', phone: '07700 900318', channel: 'call', days: 9, hour: 8, min: 5, summary: 'Rehab after a knee replacement, booked a course of sessions.', then: attended(65) },
    { name: 'Ben Carter', phone: '07700 900319', channel: 'call', days: 10, hour: 7, min: 30, summary: 'Hamstring injury from football at the weekend. Booked.', then: attended(65) },
    { name: 'Hannah Lee', email: 'hannah.lee@example.com', phone: '07700 900320', channel: 'form', days: 12, hour: 22, min: 15, summary: 'Back pain in pregnancy, would like an appointment with a female physio.', then: attended(65) },
    { name: 'Owen Morris', phone: '07700 900321', channel: 'call', days: 13, hour: 19, min: 20, summary: 'Tennis elbow, new patient. Booked.', then: attended(65) },
    { name: 'Grace Hill', phone: '07700 900322', channel: 'call', days: 15, hour: 12, summary: 'Sports massage before a cycling event. Booked with Tom.', then: attended(55) },
    { name: 'Daniel Shaw', phone: '07700 900323', channel: 'call', days: 16, hour: 20, min: 5, summary: 'Jaw pain and headaches, asked if physio helps. Booked an initial consultation.', then: attended(65) },
    { name: 'Megan Price', email: 'megan.price@example.com', channel: 'email', days: 18, hour: 9, summary: 'Asked whether we do home visits for her dad after a hip operation.',
      then: (e, t) => step(step(e, t(18, 10), { replied: true }), t(17, 10), { status: 'lost' }) },
    { name: 'Chris Fowler', phone: '07700 900324', channel: 'call', days: 19, hour: 18, min: 45, summary: 'Lower back pain after lifting at work. Booked.', then: attended(65) },
    { name: 'Nina Roberts', phone: '07700 900325', channel: 'call', days: 21, hour: 8, min: 10, summary: 'Follow-up for shoulder rehab. Returning patient. Booked.', then: attended(50) },
    { name: 'Sam Edwards', phone: '07700 900326', channel: 'call', days: 23, hour: 17, min: 50, summary: 'Ankle sprain from running. Booked an initial consultation.', then: attended(65) },
    { name: 'Laura King', phone: '07700 900327', channel: 'call', days: 25, hour: 13, min: 30, summary: 'Neck pain after a car accident last month. Booked.', then: attended(65) },
    { name: 'Peter Lloyd', phone: '07700 900328', channel: 'call', days: 27, hour: 21, min: 40, summary: 'Hip pain when walking. New patient. Booked.', then: attended(65) },
    { name: 'Kate Evans', phone: '07700 900329', channel: 'call', days: 29, hour: 11, summary: 'Follow-up for back pain. Booked.', then: attended(50) },
    { name: 'Jo Bennett', phone: '07700 900330', channel: 'call', days: 31, hour: 19, min: 5, summary: 'Sports massage after a marathon. Booked with Tom.', then: attended(55) },
    { name: 'Ian Walsh', phone: '07700 900331', channel: 'call', days: 33, hour: 10, summary: 'Asked about prices and availability for a knee assessment, then booked elsewhere.',
      then: (e, t) => step(step(e, t(33, 10.5), { replied: true }), t(31, 10), { status: 'lost' }) },
    { name: 'Amy Collins', phone: '07700 900332', channel: 'call', days: 35, hour: 18, min: 15, summary: 'Lower back and sciatica, new patient. Booked.', then: attended(65) },
    { name: 'Rob Green', phone: '07700 900333', channel: 'call', days: 37, hour: 8, min: 40, summary: 'Frozen shoulder, booked a course of treatment.', then: attended(65) },
  ];
}

function demoTranscript(name: string, summary: string, s: CaptureSettings, booked = false): string {
  const first = name.split(' ')[0];
  const opening = `Receptionist: ${greetingFor(s, new Date(Date.now() - 3 * 3_600_000))}`;
  if (s.business.kind === 'appointments') {
    const t = s.bookings.types[0];
    return [
      opening,
      `Caller: Hi, it's ${first}. ${summary.split('.')[0]}.`,
      `Receptionist: Oh, I'm sorry to hear that. That's something our physios help with a lot. Have you been to us before, or would this be your first visit?`,
      'Caller: First time.',
      `Receptionist: Lovely. Can I take your full name, please?`,
      `Caller: ${name}.`,
      `Receptionist: Thank you. And how do you spell your surname?`,
      `Caller: ${name.split(' ').slice(-1)[0].toUpperCase().split('').join('-')}.`,
      `Receptionist: Perfect. Is the number you're calling from the best one to reach you?`,
      'Caller: Yes.',
      ...(booked ? [
        `Receptionist: I've got Tuesday at 10am with Sarah, or Wednesday at half four with James. Which suits you better?`,
        'Caller: Tuesday, please.',
        `Receptionist: Lovely, you're booked in for ${t ? `an ${t.name.toLowerCase()}` : 'an appointment'} on Tuesday at 10am with Sarah, at ${s.bookings.address}. ${s.bookings.cancellation ? 'If you need to move it, just let us know 24 hours before.' : ''} I'll text you the details now. Is there anything else I can help with?`,
        'Caller: No, that’s great, thanks.',
        `Receptionist: You're welcome, ${first}. See you on Tuesday. Bye for now.`,
      ] : [
        `Receptionist: Thank you, ${first}. I'll pass this to the team and someone will call you back. Is there anything else I can help with?`,
      ]),
    ].join('\n');
  }
  return [
    opening,
    `Caller: Hi, it's ${first}. ${summary.split('.')[0]}.`,
    'Receptionist: I’m sorry to hear that. Can I take your full name, please?',
    `Caller: ${name}.`,
    'Receptionist: Thank you. And is the number you’re calling from the best one to reach you?',
    'Caller: Yes, that’s fine.',
    'Receptionist: And the address with postcode, please?',
    `Caller: ${summary.match(/TR\d+ \d[A-Z]{2}/)?.[0] ?? 'TR1 2AB'}.`,
    `Receptionist: Thanks ${first}. I’ve passed this to ${s.business.ownerName}, who will call you back as soon as possible.`,
  ].join('\n');
}

export function createDemoApi(): Api {
  let s = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* demo works without storage */ } };
  const ensure = () => {
    if (s.settings) return;
    s.settings = structuredClone(s.sample === 'clinic' ? CLINIC_SETTINGS : DEMO_SETTINGS);
    s.enquiries = seed(s.settings);
    s.sources = [
      { id: uid('src_'), label: 'Retell receptionist', channel: 'call', active: true, createdAt: new Date(Date.now() - 35 * DAY).toISOString(), lastUsedAt: s.enquiries.find((e) => e.channel === 'call')?.receivedAt ?? null },
      { id: uid('src_'), label: s.sample === 'clinic' ? 'Website booking form' : 'Website contact form', channel: 'form', active: true, createdAt: new Date(Date.now() - 35 * DAY).toISOString(), lastUsedAt: s.enquiries.find((e) => e.channel === 'form')?.receivedAt ?? null },
    ];
    save();
  };
  const find = (id: string) => { const e = s.enquiries.find((x) => x.id === id); if (!e) throw new Error('That enquiry no longer exists.'); return e; };

  return {
    mode: 'demo',
    async getUser() { if (s.user) ensure(); return s.user; },
    async requestSignIn(email, sample) { s.user = { id: 'demo', email }; if (sample && sample !== s.sample) { s.sample = sample; s.settings = null; } ensure(); save(); },
    async signOut() { s.user = null; save(); },
    async getPlan() { return { active: true, package: 'book' as const, renewsOn: new Date(Date.now() + 19 * DAY).toISOString(), alsoCommandCentre: false }; },
    async billingUrl() { return null; },
    async getSettings() { await wait(100); return s.settings; },
    async saveSettings(next) { s.settings = next; save(); },

    async listEnquiries() { await wait(150); ensure(); return s.enquiries; },
    async addEnquiry(input) {
      await wait(250);
      const e = normaliseEnquiry({ ...input }, input.channel)!;
      if (!e) throw new Error('Add a phone number, email or a line about what they need.');
      const t = triage(e.summary);
      const rec: EnquiryRecord = {
        id: uid('e_'), channel: e.channel, name: e.name, phone: e.phone, email: e.email, postcode: e.postcode, summary: e.summary, transcript: '', recordingUrl: '',
        urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: t.kind === 'spam' ? 'spam' : 'new', afterHours: isAfterHours(e.receivedAt, s.settings!.calls),
        notes: '', history: [{ at: e.receivedAt, text: 'Logged by you' }], repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null,
        jobValue: null, invoiceDue: null, paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: e.receivedAt, isTest: false,
      };
      s.enquiries = [rec, ...s.enquiries]; save(); return rec;
    },
    async updateEnquiry(id, patch) {
      await wait(200);
      const next = applyPatch(find(id), patch, s.settings);
      s.enquiries = s.enquiries.map((x) => (x.id === id ? next : x)); save(); return next;
    },
    async deleteEnquiry(id) { s.enquiries = s.enquiries.filter((x) => x.id !== id); save(); },
    async draftReply(id) {
      await wait(700);
      const e = find(id);
      return firstReply({ business: s.settings!.business.name, owner: s.settings!.business.ownerName, customer: e.name.split(' ')[0] || undefined }, e.kind, e.email && !e.phone ? 'email' : 'text');
    },
    async sendTest() {
      await wait(600);
      const e = normaliseEnquiry({ name: 'Test caller', phone: '07700 900000', summary: 'This is a test enquiry from Gainora. A customer would like a quote for replacing a kitchen tap, ideally next week. Postcode TR1 2AB.' }, 'call')!;
      const t = triage(e.summary);
      const rec: EnquiryRecord = {
        id: uid('e_'), channel: 'call', name: e.name, phone: e.phone, email: '', postcode: e.postcode, summary: e.summary, transcript: '', recordingUrl: '',
        urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: 'new', afterHours: isAfterHours(e.receivedAt, s.settings!.calls), notes: '',
        history: [{ at: e.receivedAt, text: 'Test enquiry received' }], repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null,
        jobValue: null, invoiceDue: null, paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: e.receivedAt, isTest: true,
      };
      s.enquiries = [rec, ...s.enquiries]; save(); return rec;
    },

    async listSources() { await wait(100); ensure(); return s.sources; },
    async createSource(label, channel) {
      await wait(300);
      const src: Source = { id: uid('src_'), label, channel, active: true, createdAt: new Date().toISOString(), lastUsedAt: null };
      s.sources = [src, ...s.sources]; save();
      return { ...src, url: `https://capture.gainora.co.uk/api/enquiry-in/${token32()}` };
    },
    async revokeSource(id) { s.sources = s.sources.map((x) => (x.id === id ? { ...x, active: false } : x)); save(); },

    resetDemo() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } s = fresh(); },
  };
}

