// The demo: a plumbing and heating business in Cornwall, with five weeks of enquiries.
// Everything runs in the browser with the same rules as the live app (shared/capture.ts).
import type { Api } from './api';
import type { CaptureSettings, EnquiryRecord, Source, User } from './types';
import { applyPatch, firstReply, isAfterHours, normaliseEnquiry, triage } from '../../shared/capture';
import { uid } from './format';

const KEY = 'gainora.capture.demo.v1';
const DAY = 86_400_000;

interface DemoState { user: User | null; settings: CaptureSettings | null; enquiries: EnquiryRecord[]; sources: Source[] }
const fresh = (): DemoState => ({ user: null, settings: null, enquiries: [], sources: [] });

function load(): DemoState {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...fresh(), ...JSON.parse(raw) }; } catch { /* no storage */ }
  return fresh();
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const token32 = () => Array.from({ length: 32 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-'[Math.floor(Math.random() * 58)]).join('');

export const DEMO_SETTINGS: CaptureSettings = {
  business: { name: 'Smith Plumbing & Heating', ownerName: 'Dave', trade: 'Plumbing and heating', location: 'Truro, Cornwall', website: 'https://smithplumbing.example', phone: '01872 000000', alertEmail: 'dave@smithplumbing.example', alertMobile: '07700 900111' },
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
    booking: 'callback', gasWork: true, recording: true, notify: 'urgent',
  },
  followUps: { reviewLink: 'https://g.page/r/smith-plumbing/review', payLink: 'https://pay.example/smith-plumbing', paymentDays: 14 },
  provider: { name: 'Trillet', aiNumber: '01872 000001' },
  completedAt: new Date(Date.now() - 36 * DAY).toISOString(),
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
  const S: Seed[] = [
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
      transcript: x.channel === 'call' ? demoTranscript(x.name, e.summary, settings) : '', recordingUrl: '',
      urgency: t.urgency, kind: t.kind, reasons: t.reasons, status: t.kind === 'spam' ? 'spam' : 'new', afterHours: after,
      notes: '', history, repliedAt: null, quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null, jobValue: null,
      invoiceDue: null, paidAt: null, paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: e.receivedAt, isTest: false,
    };
    if (x.then) rec = x.then(rec, (d, h = 10) => at(d, Math.floor(h), Math.round((h % 1) * 60)));
    return rec;
  }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

function demoTranscript(name: string, summary: string, s: CaptureSettings): string {
  const first = name.split(' ')[0];
  return [
    `Receptionist: Hi, you're through to ${s.business.name}. I'm their AI assistant, and calls are recorded so we can help you properly. How can I help?`,
    `Caller: Hi, it's ${first}. ${summary.split('.')[0]}.`,
    'Receptionist: I’m sorry to hear that. Can I take your best phone number?',
    'Caller: Yes, it’s the one I’m calling from.',
    'Receptionist: Thank you. And the address with postcode, please?',
    `Caller: ${summary.match(/TR\d+ \d[A-Z]{2}/)?.[0] ?? 'TR1 2AB'}.`,
    `Receptionist: Thanks ${first}. I’ve passed this to ${s.business.ownerName}, who will call you back as soon as possible.`,
  ].join('\n');
}

export function createDemoApi(): Api {
  let s = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* demo works without storage */ } };
  const ensure = () => {
    if (s.settings) return;
    s.settings = structuredClone(DEMO_SETTINGS);
    s.enquiries = seed(s.settings);
    s.sources = [
      { id: uid('src_'), label: 'Trillet receptionist', channel: 'call', active: true, createdAt: new Date(Date.now() - 35 * DAY).toISOString(), lastUsedAt: s.enquiries.find((e) => e.channel === 'call')?.receivedAt ?? null },
      { id: uid('src_'), label: 'Website contact form', channel: 'form', active: true, createdAt: new Date(Date.now() - 35 * DAY).toISOString(), lastUsedAt: s.enquiries.find((e) => e.channel === 'form')?.receivedAt ?? null },
    ];
    save();
  };
  const find = (id: string) => { const e = s.enquiries.find((x) => x.id === id); if (!e) throw new Error('That enquiry no longer exists.'); return e; };

  return {
    mode: 'demo',
    async getUser() { if (s.user) ensure(); return s.user; },
    async requestSignIn(email) { s.user = { id: 'demo', email }; ensure(); save(); },
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

