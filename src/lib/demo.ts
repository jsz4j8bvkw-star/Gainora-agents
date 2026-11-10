// The demo: a plumbing and heating business in Cornwall, with five weeks of enquiries.
// Everything runs in the browser with the same rules as the live app (shared/capture.ts).
import type { Api } from './api';
import type { CaptureSettings, EnquiryRecord, MessageRecord, Source, User } from './types';
import { afterSend, defaultAutomations, dueNow, fieldsFor, ownerAlert, patchForStep, render, stepDef, type MessageLite, type StepId, type WorkflowId } from '../../shared/automations';
import { applyPatch, bookedOnCall, NEW_CLIENT, DEFAULT_BEAUTY_SAFETY, DEFAULT_GREETING, DEFAULT_SAFETY, greetingFor, isAfterHours, isBeauty, lines, normaliseEnquiry, rebookWeeksFor, triage } from '../../shared/capture';
import { suggestReply } from '../../shared/insight';
import { uid } from './format';

const KEY = 'gainora.capture.demo.v3';
const DAY = 86_400_000;

export type Sample = 'trade' | 'clinic' | 'beauty';
interface DemoState { user: User | null; sample: Sample; settings: CaptureSettings | null; enquiries: EnquiryRecord[]; sources: Source[]; messages: MessageRecord[]; optOuts: string[] }
const fresh = (): DemoState => ({ user: null, sample: 'beauty', settings: null, enquiries: [], sources: [], messages: [], optOuts: [] });

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
    booking: 'callback', gasWork: true, recording: true, notify: 'urgent', greeting: DEFAULT_GREETING, announceAi: false, safety: '', alertText: 'urgent', emergencyLine: '', transferEmergency: true,
  },
  bookings: { system: 'Google Calendar', systemOther: '', account: 'dave@smithplumbing.example', mode: 'offer', address: '', arrival: '', types: [{ name: 'Quote visit', minutes: 30, price: 'Free', who: 'Dave' }, { name: 'Boiler service', minutes: 60, price: '£85', who: 'Dave' }], staff: 'Dave Smith', noticeHours: 24, aheadWeeks: 4, cancellation: '', status: 'connected' },
  followUps: { reviewLink: 'https://g.page/r/smith-plumbing/review', payLink: 'https://pay.example/smith-plumbing', paymentDays: 14 },
  provider: { name: 'Retell', aiNumber: '01872 000001' },
  automations: defaultAutomations('trade', new Date(Date.now() - 60 * DAY).toISOString()),
  texting: { number: '07700 900500', status: 'on' },
  completedAt: new Date(Date.now() - 36 * DAY).toISOString(),
};

export const CLINIC_SETTINGS: CaptureSettings = {
  business: { kind: 'appointments', name: 'Lemon Street Physio', ownerName: 'Sarah', trade: 'Physiotherapy', location: 'Truro, Cornwall', website: 'https://lemonstreetphysio.example', phone: '01872 000100', alertEmail: 'sarah@lemonstreetphysio.example', alertMobile: '07700 900222' },
  work: { services: 'Back and neck pain\nSports injuries\nPost-surgery rehab\nSports massage\nHeadaches and jaw pain', notDone: 'Home visits\nNHS referrals', areas: '' },
  calls: {
    days: [1, 2, 3, 4, 5, 6], open: '08:00', close: '19:00', emergencies: '', transferTo: 'Text Sarah on 07700 900222',
    quotePolicy: 'fixed', priceNotes: '', booking: 'calendar', gasWork: false, recording: true, notify: 'urgent',
    greeting: DEFAULT_GREETING, announceAi: false, safety: DEFAULT_SAFETY, alertText: 'emergencies', emergencyLine: '', transferEmergency: true,
  },
  bookings: {
    system: 'Cliniko', systemOther: '', account: 'Lemon Street Physio', mode: 'book', address: '12 Lemon Street, Truro TR1 2LS',
    arrival: 'Please wear loose, comfortable clothing and arrive 5 minutes early. Free parking behind the clinic.',
    types: [{ name: 'Initial consultation', minutes: 45, price: '£65', who: 'Any physio' }, { name: 'Follow-up', minutes: 30, price: '£50', who: 'Your physio' }, { name: 'Sports massage', minutes: 60, price: '£55', who: 'Tom' }],
    staff: 'Sarah Bennett\nJames Hooper\nTom Ellis', noticeHours: 2, aheadWeeks: 6, cancellation: 'Please give 24 hours’ notice to cancel or move, or the full fee may be charged.', status: 'connected',
  },
  followUps: { reviewLink: 'https://g.page/r/lemon-street-physio/review', payLink: 'https://pay.example/lemon-street', paymentDays: 0 },
  provider: { name: 'Retell', aiNumber: '01872 000101' },
  automations: defaultAutomations('appointments', new Date(Date.now() - 60 * DAY).toISOString()),
  texting: { number: '07700 900600', status: 'on' },
  completedAt: new Date(Date.now() - 40 * DAY).toISOString(),
};

export const BEAUTY_SETTINGS: CaptureSettings = {
  business: { kind: 'appointments', name: 'Willow Skin & Beauty', ownerName: 'Amy', trade: 'Aesthetics clinic', location: 'Falmouth, Cornwall', website: 'https://willowskin.example', phone: '01326 000200', alertEmail: 'amy@willowskin.example', alertMobile: '07700 900444' },
  work: { services: 'Anti-wrinkle treatments\nDermal fillers\nSkin peels and HydraFacials\nLaser hair removal\nLash lifts and brows\nGel nails', notDone: 'Tattoo removal\nTreatments for under-18s', areas: '' },
  calls: {
    days: [2, 3, 4, 5, 6], open: '09:00', close: '19:00', emergencies: '', transferTo: 'Text Amy on 07700 900444',
    quotePolicy: 'fixed', priceNotes: '', booking: 'calendar', gasWork: false, recording: true, notify: 'urgent',
    greeting: DEFAULT_GREETING, announceAi: false, safety: DEFAULT_BEAUTY_SAFETY, alertText: 'emergencies', emergencyLine: '07700 900444', transferEmergency: true,
  },
  bookings: {
    system: 'Phorest', systemOther: '', account: 'Willow Skin & Beauty', mode: 'book', address: '4 Arwenack Street, Falmouth TR11 3JA',
    arrival: 'Please arrive 5 minutes early with clean skin and no make-up on the area being treated. Pay-and-display parking on Arwenack Street.',
    types: [
      { name: 'Free consultation', minutes: 30, price: 'Free', who: 'Amy' },
      { name: 'Anti-wrinkle treatment', minutes: 30, price: 'from £180', who: 'Amy', rebookWeeks: 12 },
      { name: 'Lip filler', minutes: 45, price: '£250', who: 'Amy', rebookWeeks: 26 },
      { name: 'HydraFacial', minutes: 60, price: '£120', who: 'Leah', rebookWeeks: 4 },
      { name: 'Laser hair removal', minutes: 30, price: 'from £60', who: 'Leah', rebookWeeks: 4 },
      { name: 'Lash lift and tint', minutes: 45, price: '£55', who: 'Jess', rebookWeeks: 6 },
      { name: 'Gel nails', minutes: 60, price: '£35', who: 'Jess', rebookWeeks: 3 },
    ],
    staff: 'Amy Carter\nLeah Price\nJess Morgan', noticeHours: 2, aheadWeeks: 8, cancellation: 'Please give 48 hours’ notice to cancel or move, or the deposit is kept.', deposit: '£30, taken off your treatment', depositLink: 'https://pay.example/willow-skin/deposit', status: 'connected',
  },
  followUps: { reviewLink: 'https://g.page/r/willow-skin/review', payLink: 'https://pay.example/willow-skin', paymentDays: 0 },
  provider: { name: 'Retell', aiNumber: '01326 000201' },
  automations: defaultAutomations('appointments', new Date(Date.now() - 60 * DAY).toISOString()),
  texting: { number: '07700 900700', status: 'on' },
  completedAt: new Date(Date.now() - 38 * DAY).toISOString(),
};
const SAMPLE_SETTINGS: Record<Sample, CaptureSettings> = { trade: DEMO_SETTINGS, clinic: CLINIC_SETTINGS, beauty: BEAUTY_SETTINGS };

interface Seed {
  name: string; phone?: string; email?: string; channel: EnquiryRecord['channel']; summary: string;
  callType?: string;       // what the receptionist reported the call was about
  days: number; hour: number; min?: number;
  ago?: number;            // hours ago, for the newest few, so they're never in the future
  then?: (e: EnquiryRecord, at: (d: number, h?: number) => Date) => EnquiryRecord;
}

/** Times are set against "now" so the demo always looks current. */
function seed(settings: CaptureSettings): EnquiryRecord[] {
  const now = Date.now();
  const at = (days: number, hour = 10, min = 0) => { const d = new Date(now - days * DAY); d.setHours(hour, min, 0, 0); return d; };
  const step = (e: EnquiryRecord, d: Date, p: Parameters<typeof applyPatch>[1]) => applyPatch(e, p, settings, d);
  const S: Seed[] = isBeauty(settings.business) ? beautySeeds(step, now) : settings.business.kind === 'appointments' ? clinicSeeds(step, now) : [
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
      then: (e, t) => { let x = step(e, t(29, 9), { replied: true }); x = step(x, t(28, 15), { status: 'quoted', quoteAmount: 2950 }); x = step(x, t(24, 9), { status: 'won', jobValue: 2950 }); x = { ...x, invoiceDue: t(15, 0).toISOString().slice(0, 10) }; x = step(x, t(15, 10), { paymentReminderSent: true }); return step(x, t(8, 10), { paymentReminderSent: true }); } },
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
    const t = triage(e.summary, { callType: x.callType });
    const after = isAfterHours(e.receivedAt, settings.calls);
    const history = [{ at: e.receivedAt, text: `${x.channel === 'call' ? 'Call answered by your receptionist' : x.channel === 'form' ? 'Website form received' : 'Email received'}${after ? ' (out of hours)' : ''}` }];
    if (t.urgency !== 'normal') history.push({ at: e.receivedAt, text: `${t.urgency === 'emergency' ? 'Flagged as an emergency' : 'Flagged as urgent'}: ${t.reasons.join('; ')}` });
    if (x.channel === 'call' && /\bnew client\b/i.test(x.summary)) history.push({ at: e.receivedAt, text: NEW_CLIENT });
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

/** Five weeks at an aesthetics clinic: treatments booked on the call, a reaction after filler sent to the clinic's line, nails and lashes. */
function beautySeeds(step: Step, now: number): Seed[] {
  const slot = (daysAhead: number, h: number, m = 0) => { const d = new Date(now + daysAhead * DAY); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const booked = (type: string, who: string, daysAhead: number, h: number, m = 0) => (e: EnquiryRecord) => step(e, new Date(new Date(e.receivedAt).getTime() + 3 * 60_000), { status: 'booked', bookedFor: slot(daysAhead, h, m), bookedType: type, bookedWith: who });
  const attended = (fee: number, type: string, who: string, review = true) => (e: EnquiryRecord, t: (d: number, h?: number) => Date) => {
    const d0 = (Date.now() - new Date(e.receivedAt).getTime()) / DAY;
    let x = step(e, new Date(new Date(e.receivedAt).getTime() + 4 * 60_000), { status: 'booked', bookedFor: t(Math.max(0, Math.floor(d0) - 3), 11).toISOString(), bookedType: type, bookedWith: who });
    x = step(x, t(Math.max(0, Math.floor(d0) - 3), 12), { status: 'won', jobValue: fee });
    x = step(x, t(Math.max(0, Math.floor(d0) - 3), 12.2), { paid: true });
    if (review) x = step(x, t(Math.max(0, Math.floor(d0) - 4), 10), { reviewAsked: true });
    return x;
  };
  return [
    { name: 'Chloe Martin', phone: '07700 900410', channel: 'call', days: 0, hour: 0, ago: 0.5, summary: 'New client. Would like anti-wrinkle treatment on her forehead before a wedding next month. Booked a free consultation with Amy.', then: booked('Free consultation', 'Amy', 2, 11) },
    { name: 'Sophie Reed', phone: '07700 900411', channel: 'call', days: 0, hour: 0, ago: 1.6, summary: 'Had lip filler on Tuesday. Her top lip is very swollen and a patch has turned white and painful. Receptionist did not book, put her through to the clinic’s emergency line and alerted Amy.',
      then: (e) => ({ ...step(e, new Date(new Date(e.receivedAt).getTime() + 6 * 60_000), { replied: true }), notes: 'Amy saw her at the clinic within the hour and treated it. Follow-up call booked for tomorrow.' }) },
    { name: 'Megan Hall', phone: '07700 900412', channel: 'call', days: 0, hour: 0, ago: 3.1, summary: 'Called during a treatment. Wants gel nails and a lash lift together on Saturday morning. Booked with Jess.', then: booked('Gel nails', 'Jess', 6 - new Date(now).getDay() || 7, 10) },
    { name: 'Laura Bennett', email: 'laura.bennett@example.com', phone: '07700 900413', channel: 'form', days: 1, hour: 22, min: 5, summary: 'Asked how many laser hair removal sessions she would need for underarms and whether she needs a patch test first.' },
    { name: 'Glow Leads Ltd', phone: '02079 460222', channel: 'call', days: 1, hour: 11, summary: 'Caller offered Instagram marketing and more Google reviews for the clinic. Receptionist said no thank you and ended the call.', callType: 'sales call' },
    { name: 'Nancy Bell', phone: '07700 900429', channel: 'call', days: 1, hour: 16, min: 25, summary: 'Running about 15 minutes late for her 4.30 appointment with Leah. Receptionist let the team know.', callType: 'running late',
      then: (e, t) => step(e, t(1, 16.6), { replied: true }) },
    { name: 'Rosie Clarke', phone: '07700 900431', channel: 'call', days: 0, hour: 0, ago: 2.4, summary: 'Called to cancel her lip filler appointment with Amy on Thursday: she has a cold. Said she will call back to rebook.', callType: 'cancel appointment',
      then: (e) => { const x = booked('Lip filler', 'Amy', 3, 14)(e); return step(x, new Date(new Date(e.receivedAt).getTime() + 5 * 60_000), { status: 'lost', lostReason: 'cancelled' }); } },
    { name: 'Ellie Morgan', phone: '07700 900432', email: 'ellie.morgan@example.com', channel: 'form', days: 2, hour: 21, min: 40, summary: 'New client. Would like lip filler before her birthday at the end of the month. Any availability next week?',
      then: (e, t) => step(e, t(1, 10), { replied: true }) },
    { name: 'Tilly Dawson', phone: '07700 900430', channel: 'call', days: 3, hour: 14, summary: 'Gel nails, new client. Booked with Jess for yesterday morning.',
      then: (e, t) => { let x = step(e, new Date(new Date(e.receivedAt).getTime() + 3 * 60_000), { status: 'booked', bookedFor: t(1, 10).toISOString(), bookedType: 'Gel nails', bookedWith: 'Jess' }); return step(x, t(1, 10.7), { status: 'lost', lostReason: 'noshow' }); } },
    { name: 'Hannah Price', phone: '07700 900414', channel: 'call', days: 2, hour: 19, min: 20, summary: 'Returning client. HydraFacial with Leah. Booked.', then: booked('HydraFacial', 'Leah', 3, 15) },
    { name: 'Zara Khan', phone: '07700 900415', channel: 'call', days: 4, hour: 13, min: 10, summary: 'Asked the price of lip filler and said she would think about it.', then: (e, t) => step(e, t(4, 13.5), { replied: true }) },
    { name: 'Ella Watson', phone: '07700 900416', channel: 'call', days: 6, hour: 18, min: 40, summary: 'Anti-wrinkle top-up, returning client. Booked with Amy.', then: attended(180, 'Anti-wrinkle treatment', 'Amy') },
    { name: 'Olivia Grant', phone: '07700 900417', channel: 'call', days: 8, hour: 12, summary: 'Lash lift and tint. Booked with Jess.', then: attended(55, 'Lash lift and tint', 'Jess') },
    { name: 'Freya Collins', email: 'freya.collins@example.com', phone: '07700 900418', channel: 'form', days: 9, hour: 21, min: 30, summary: 'Would like a HydraFacial before a holiday. Booked.', then: attended(120, 'HydraFacial', 'Leah') },
    { name: 'Rosie Turner', phone: '07700 900419', channel: 'call', days: 11, hour: 10, min: 15, summary: 'Lip filler, first time. Booked after a consultation.', then: attended(250, 'Lip filler', 'Amy') },
    { name: 'Jade Morris', phone: '07700 900420', channel: 'call', days: 13, hour: 17, min: 55, summary: 'Gel nails, returning client. Booked.', then: attended(35, 'Gel nails', 'Jess', false) },
    { name: 'Amelia Ward', phone: '07700 900421', channel: 'call', days: 15, hour: 9, min: 30, summary: 'Anti-wrinkle treatment for crow’s feet. Booked.', then: attended(180, 'Anti-wrinkle treatment', 'Amy') },
    { name: 'Lily Evans', phone: '07700 900422', channel: 'call', days: 17, hour: 19, min: 10, summary: 'Asked whether we do tattoo removal.', then: (e, t) => step(step(e, t(17, 19.5), { replied: true }), t(16, 10), { status: 'lost' }) },
    { name: 'Grace Hughes', phone: '07700 900423', channel: 'call', days: 19, hour: 11, summary: 'HydraFacial and brows. Booked.', then: attended(120, 'HydraFacial', 'Leah') },
    { name: 'Poppy Shaw', phone: '07700 900424', channel: 'call', days: 22, hour: 18, min: 20, summary: 'Lip filler top-up. Booked.', then: attended(250, 'Lip filler', 'Amy') },
    { name: 'Isla Roberts', phone: '07700 900425', channel: 'call', days: 25, hour: 12, min: 40, summary: 'Lash lift before a wedding. Booked.', then: attended(55, 'Lash lift and tint', 'Jess') },
    { name: 'Evie Clarke', phone: '07700 900426', channel: 'call', days: 28, hour: 20, min: 5, summary: 'Anti-wrinkle treatment, new client after a consultation. Booked.', then: attended(180, 'Anti-wrinkle treatment', 'Amy') },
    { name: 'Mia Lewis', phone: '07700 900427', channel: 'call', days: 31, hour: 10, summary: 'Gel nails. Booked.', then: attended(35, 'Gel nails', 'Jess') },
    { name: 'Ruby Adams', phone: '07700 900428', channel: 'call', days: 34, hour: 17, min: 30, summary: 'Laser hair removal course, booked the first session.', then: attended(90, 'Laser hair removal', 'Leah') },
    { name: 'Holly Fraser', phone: '07700 900431', channel: 'call', days: 40, hour: 11, min: 10, summary: 'HydraFacial, returning client. Booked with Leah.', then: attended(120, 'HydraFacial', 'Leah') },
    { name: 'Hannah Price', phone: '07700 900414', channel: 'call', days: 37, hour: 12, min: 30, summary: 'HydraFacial with Leah. Booked.', then: attended(120, 'HydraFacial', 'Leah') },
  ];
}

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
      then: (e) => step(e, new Date(new Date(e.receivedAt).getTime() + 3 * 60_000), { status: 'booked', bookedFor: slot(2, 10), bookedType: 'Initial consultation', bookedWith: 'Sarah' }) },
    { name: 'Priya Shah', phone: '07700 900311', channel: 'call', days: 0, hour: 0, ago: 2.2, summary: 'Sore shoulder after swimming. Asked whether we treat sports injuries and would like a call back about times after work.' },
    { name: 'Mark Davies', phone: '07700 900312', channel: 'call', days: 1, hour: 19, min: 40, summary: 'Lower back pain since this morning with new numbness around the groin, and he has lost control of his bladder. Receptionist did not book and told him to go to A&E now.',
      then: (e, t) => ({ ...step(e, t(1, 19.9), { replied: true, status: 'lost' }), notes: 'Sarah rang at 7.55pm. He was on his way to A&E at Treliske. Call him tomorrow to check in.' }) },
    { name: 'Emma Wilson', email: 'emma.wilson@example.com', phone: '07700 900313', channel: 'form', days: 1, hour: 21, min: 10, summary: 'Could I book a sports massage for Saturday morning? Training for the Cornwall half marathon.',
      then: (e, t) => step(step(e, t(0, 8.2), { replied: true }), t(0, 8.3), { status: 'booked', bookedFor: slot(6 - new Date(now).getDay() || 7, 9), bookedType: 'Sports massage', bookedWith: 'Tom' }) },
    { name: 'Tom Baker', phone: '07700 900314', channel: 'call', days: 2, hour: 12, min: 15, summary: 'Returning patient. Follow-up for knee rehab with James. Booked.',
      then: (e) => step(e, new Date(new Date(e.receivedAt).getTime() + 3 * 60_000), { status: 'booked', bookedFor: slot(1, 16, 30), bookedType: 'Follow-up', bookedWith: 'James' }) },
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
    const [p1 = 'Sarah', p2 = 'James'] = lines(s.bookings.staff).map((n) => n.split(' ')[0]);
    return [
      opening,
      `Caller: Hi, it's ${first}. ${summary.split('.')[0]}.`,
      isBeauty(s.business) ? `Receptionist: Lovely, that's something we do a lot of. Have you been to us before, or would this be your first visit?` : `Receptionist: Oh, I'm sorry to hear that. That's something our physios help with a lot. Have you been to us before, or would this be your first visit?`,
      'Caller: First time.',
      `Receptionist: Lovely. Can I take your full name, please?`,
      `Caller: ${name}.`,
      `Receptionist: Thank you. And how do you spell your surname?`,
      `Caller: ${name.split(' ').slice(-1)[0].toUpperCase().split('').join('-')}.`,
      `Receptionist: Perfect. Is the number you're calling from the best one to reach you?`,
      'Caller: Yes.',
      ...(booked ? [
        `Receptionist: I've got Tuesday at 10am with ${p1}, or Wednesday at half four with ${p2}. Which suits you better?`,
        'Caller: Tuesday, please.',
        `Receptionist: Lovely, you're booked in for ${t ? `an ${t.name.toLowerCase()}` : 'an appointment'} on Tuesday at 10am with ${p1}, at ${s.bookings.address}. ${s.bookings.cancellation ? 'If you need to move it, just let us know in good time.' : ''} I'll text you the details now. Is there anything else I can help with?`,
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

/* ---------- Messages in the demo ---------- */

const msg = (m: Partial<MessageRecord> & Pick<MessageRecord, 'enquiryId' | 'direction' | 'channel' | 'body' | 'createdAt'>): MessageRecord => ({
  id: uid('m_'), audience: 'customer', to: '', from: '', subject: '', automatic: false, workflow: null, step: null, key: null,
  status: m.direction === 'in' ? 'received' : 'sent', error: null, read: true, sentAt: m.createdAt, ...m,
});
const lite = (m: MessageRecord): MessageLite => ({ enquiryId: m.enquiryId, direction: m.direction, key: m.key, status: m.status, createdAt: m.createdAt, automatic: m.automatic });

/** The texts that would already have gone out, read from each enquiry's history. */
function seedMessages(list: EnquiryRecord[], s: CaptureSettings, sample: Sample): MessageRecord[] {
  const out: MessageRecord[] = [];
  const later = (iso: string, sec: number) => new Date(new Date(iso).getTime() + sec * 1000).toISOString();
  const auto = (e: EnquiryRecord, wf: WorkflowId, step: StepId, key: string, at: string) => {
    const st = s.automations[wf]?.steps[step];
    if (!st || !e.phone) return;
    out.push(msg({ enquiryId: e.id, direction: 'out', channel: 'text', to: e.phone, body: render(st.text, fieldsFor(e, s, new Date(at)), !!stepDef(wf, step).marketing), createdAt: at, automatic: true, workflow: wf, step, key: `${wf}.${key}` }));
  };
  for (const e of list) {
    if (e.status === 'spam' || e.isTest) continue;
    if (e.urgency !== 'normal' && s.calls.alertText !== 'off' && (s.calls.alertText === 'urgent' || e.urgency === 'emergency')) {
      out.push(msg({ enquiryId: e.id, direction: 'out', audience: 'owner', channel: 'text', to: s.business.alertMobile, body: ownerAlert(e, s), createdAt: later(e.receivedAt, 8), automatic: true, workflow: 'owner_alert', key: 'owner-alert' }));
    }
    if (!bookedOnCall(e) && !(e.urgency === 'emergency' && s.business.kind === 'appointments')) auto(e, 'ack', 'ack', 'ack', later(e.receivedAt, 20));
    for (const h of e.history) {
      if (/^Booked in/.test(h.text) && e.bookedFor) {
        auto(e, 'booking', 'confirm', `confirm@${e.bookedFor}`, later(h.at, 20));
        const remind = new Date(new Date(e.bookedFor).getTime() - 86_400_000); remind.setHours(9, 0, 0, 0);
        if (remind.getTime() < Date.now() && remind.getTime() - new Date(h.at).getTime() > 3 * 3_600_000) auto(e, 'booking', 'reminder', `reminder@${e.bookedFor}`, remind.toISOString());
      }
      const c = h.text.match(/^Quote chaser (\d) sent/); if (c && e.quotedAt) auto(e, 'quote', `chase${c[1]}` as StepId, `chase${c[1]}@${e.quotedAt}`, h.at);
      const p = h.text.match(/^Payment reminder (\d) sent/); if (p && e.invoiceDue) auto(e, 'payment', `pay${p[1]}` as StepId, `pay${p[1]}@${e.invoiceDue.slice(0, 10)}`, h.at);
      if (h.text === 'Review requested') auto(e, 'review', 'review', 'review', h.at);
      // "Time to rebook" went out on the day it was due, at 9am.
      if (/^Attended/.test(h.text) && s.business.kind === 'appointments') {
        const due = new Date(new Date(h.at).getTime() + rebookWeeksFor(e.bookedType, s) * 7 * 86_400_000); due.setHours(9, 0, 0, 0);
        if (due.getTime() < Date.now()) auto(e, 'rebook', 'rebook', `rebook@${h.at.slice(0, 10)}`, due.toISOString());
      }
    }
  }
  // A few replies from customers, as they'd really come in.
  const reply = (name: string, body: string, minsAgo: number, read: boolean) => {
    const e = list.find((x) => x.name === name); if (!e) return;
    out.push(msg({ enquiryId: e.id, direction: 'in', channel: 'text', from: e.phone, body, createdAt: new Date(Date.now() - minsAgo * 60_000).toISOString(), read }));
  };
  if (sample === 'beauty') {
    reply('Chloe Martin', 'Thank you! Is it OK to wear make-up to the consultation?', 20, false);
    reply('Laura Bennett', 'Weekday evenings are best for me', 90, false);
    reply('Megan Hall', 'Amazing, see you Saturday 💅', 4 * 60, true);
  } else if (sample === 'clinic') {
    reply('George Hammond', 'Thanks! Is there parking at the clinic?', 25, false);
    reply('Priya Shah', 'After 5pm any weekday is best for me, thanks', 70, false);
    reply('Emma Wilson', 'Perfect, see you Saturday 😊', 6 * 60, true);
  } else {
    reply('Priya Shah', 'Thanks Dave. Could you do it for £600 if I book this month?', 18 * 60, false);
    reply('Kate Brown', 'Great, see you then. The side gate will be open', 26 * 60, true);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createDemoApi(): Api {
  let s = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* demo works without storage */ } };
  const ensure = () => {
    if (s.settings) return;
    s.settings = structuredClone(SAMPLE_SETTINGS[s.sample] ?? DEMO_SETTINGS);
    s.enquiries = seed(s.settings);
    s.sources = [
      { id: uid('src_'), label: 'Retell receptionist', channel: 'call', active: true, createdAt: new Date(Date.now() - 35 * DAY).toISOString(), lastUsedAt: s.enquiries.find((e) => e.channel === 'call')?.receivedAt ?? null },
      { id: uid('src_'), label: s.sample === 'trade' ? 'Website contact form' : 'Website booking form', channel: 'form', active: true, createdAt: new Date(Date.now() - 35 * DAY).toISOString(), lastUsedAt: s.enquiries.find((e) => e.channel === 'form')?.receivedAt ?? null },
    ];
    s.messages = seedMessages(s.enquiries, s.settings, s.sample);
    run();
    save();
  };
  /** The same engine as the live app: what's due now goes out (simulated), or waits for approval. */
  const run = (only?: string[]) => {
    if (!s.settings) return;
    const settings = s.settings;
    const texting = settings.texting.status === 'on';
    for (const e0 of s.enquiries) {
      if (only && !only.includes(e0.id)) continue;
      let e = e0;
      for (const d of dueNow(e, settings, s.messages.map(lite), s.optOuts.includes(e.phone), new Date(), s.enquiries)) {
        const ok = d.channel === 'email' || texting;
        s.messages.unshift(msg({ enquiryId: e.id, direction: 'out', channel: d.channel, to: d.to, subject: d.subject, body: d.body, createdAt: new Date().toISOString(), automatic: true, workflow: d.workflow, step: d.step, key: d.key, status: d.ask ? 'awaiting_approval' : ok ? 'sent' : 'failed', error: ok ? null : 'Texting isn’t switched on yet.' }));
        if (!d.ask && ok && d.patch) e = afterSend(e, d, settings);
      }
      if (e !== e0) s.enquiries = s.enquiries.map((x) => (x.id === e.id ? e : x));
    }
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
      s.enquiries = [rec, ...s.enquiries]; run([rec.id]); save(); return find(rec.id);
    },
    async updateEnquiry(id, patch) {
      await wait(200);
      const next = applyPatch(find(id), patch, s.settings);
      s.enquiries = s.enquiries.map((x) => (x.id === id ? next : x)); run([id]); save(); return find(id);
    },
    async deleteEnquiry(id) { s.enquiries = s.enquiries.filter((x) => x.id !== id); s.messages = s.messages.filter((m) => m.enquiryId !== id); save(); },
    async draftReply(id) {
      await wait(700);
      const e = find(id);
      const last = s.messages.filter((m) => m.enquiryId === id && m.direction === 'in').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return suggestReply(e, s.settings!, { unreadReply: last ? { body: last.body, at: last.createdAt } : null });
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

    async listMessages() { await wait(80); ensure(); run(); save(); return s.messages; },
    async reply(enquiryId, channel, text, subject) {
      await wait(500);
      const e = find(enquiryId);
      const to = channel === 'text' ? e.phone : e.email;
      if (!to) throw new Error(channel === 'text' ? 'There’s no mobile number for this customer.' : 'There’s no email address for this customer.');
      if (channel === 'text' && s.optOuts.includes(e.phone)) throw new Error('This customer replied STOP, so they can’t be texted. Call or email them instead.');
      const m = msg({ enquiryId, direction: 'out', channel, to, subject: subject ?? '', body: text, createdAt: new Date().toISOString() });
      s.messages.unshift(m);
      const next = applyPatch(e, { replied: true }, s.settings);
      s.enquiries = s.enquiries.map((x) => (x.id === enquiryId ? next : x)); save();
      return { message: m, enquiry: next };
    },
    async approveMessage(id, text) {
      await wait(400);
      const m = s.messages.find((x) => x.id === id && x.status === 'awaiting_approval');
      if (!m) throw new Error('That message has already been dealt with.');
      m.status = 'sent'; m.sentAt = new Date().toISOString(); if (text?.trim()) m.body = text.trim();
      const p = patchForStep(m.step);
      if (p && m.enquiryId) { const e = applyPatch(find(m.enquiryId), p, s.settings); s.enquiries = s.enquiries.map((x) => (x.id === e.id ? e : x)); }
      save();
    },
    async skipMessage(id) { const m = s.messages.find((x) => x.id === id); if (m) m.status = 'skipped'; save(); },
    async markRead(enquiryId) { for (const m of s.messages) if (m.enquiryId === enquiryId && m.direction === 'in') m.read = true; save(); },
    async testText() { await wait(400); },

    async listSources() { await wait(100); ensure(); return s.sources; },
    async createSource(label, channel) {
      await wait(300);
      const src: Source = { id: uid('src_'), label, channel, active: true, createdAt: new Date().toISOString(), lastUsedAt: null };
      s.sources = [src, ...s.sources]; save();
      const t = token32();
      return { ...src, url: `https://capture.gainora.co.uk/api/enquiry-in/${t}`, ...(channel === 'call' ? { lookupUrl: `https://capture.gainora.co.uk/api/caller-in/${t}` } : {}) };
    },
    async revokeSource(id) { s.sources = s.sources.map((x) => (x.id === id ? { ...x, active: false } : x)); save(); },

    resetDemo() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } s = fresh(); },
  };
}

