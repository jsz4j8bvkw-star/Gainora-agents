import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  applyPatch, emptySettings, followUps, GAINORA_DIARY, GAS_EMERGENCY, hoursText, isAfterHours, MARKETING_OPT_OUT, normaliseEnquiry, normPhone,
  packFromSettings, paymentReminder, paymentStageDue, quoteChaseDue, quoteChaser, report, reviewRequest, triage,
  withDefaults, type CaptureSettings, type EnquiryRecord,
} from '../shared/capture';
import { CLINIC_SETTINGS, DEMO_SETTINGS } from '../src/lib/demo';
import { phone } from '../src/lib/format';

const S: CaptureSettings = structuredClone(DEMO_SETTINGS);

const rec = (over: Partial<EnquiryRecord> = {}): EnquiryRecord => ({
  id: 'e1', channel: 'call', name: 'Jane Price', phone: '+447700900123', email: '', postcode: 'TR1 2AB', summary: 'Boiler service', transcript: '', recordingUrl: '',
  urgency: 'normal', kind: 'booking', reasons: [], status: 'new', afterHours: false, notes: '', history: [], repliedAt: null,
  quoteAmount: null, quotedAt: null, chasersSent: 0, bookedFor: null, jobValue: null, invoiceDue: null, paidAt: null,
  paymentRemindersSent: 0, reviewAskedAt: null, receivedAt: '2026-11-02T10:00:00Z', isTest: false, ...over,
});

test('script: natural greeting, honest if asked, gas line, prices only as the owner chose', () => {
  const p = packFromSettings(S);
  assert.match(p.greeting, /^Good (morning|afternoon|evening), you’re through to Smith Plumbing & Heating\. Calls are recorded for quality and training\. How can I help\?$/);
  assert.doesNotMatch(p.greeting, /\bAI\b/);                         // not announced, as the owner chose
  assert.match(p.text, /Never claim to be a person/);
  assert.match(p.text, /always answer honestly that you are the Smith Plumbing & Heating AI assistant/);
  assert.ok(p.text.includes(GAS_EMERGENCY));
  assert.match(p.text, /Boiler service from £85/);
  assert.match(p.text, /Never take card or bank details/);
  assert.match(p.text, /Mon–Fri 8am–5:30pm/);
  const ai = packFromSettings({ ...S, calls: { ...S.calls, announceAi: true, recording: false, greeting: 'Hello, {business}, how can I help?' } });
  assert.equal(ai.greeting, 'Hello, Smith Plumbing & Heating. I’m the AI assistant here. How can I help?');
  const never = packFromSettings({ ...S, calls: { ...S.calls, quotePolicy: 'never', gasWork: false, recording: false } });
  assert.match(never.text, /Don't give prices/);
  assert.ok(!never.text.includes(GAS_EMERGENCY));
  assert.doesNotMatch(never.greeting, /record/i);
  assert.equal(hoursText({ ...S.calls, days: [1, 2, 3, 5, 6] }), 'Mon–Wed, Fri–Sat 8am–5:30pm');
});

test('clinic script: books into the diary, never diagnoses, sends red flags to urgent care', () => {
  const p = packFromSettings(CLINIC_SETTINGS);
  assert.match(p.greeting, /you’re through to Lemon Street Physio/);
  assert.match(p.text, /Initial consultation \(45 min, £65, with Any physio\)/);
  assert.match(p.text, /Offer two options, book the one they choose/);
  assert.match(p.text, /12 Lemon Street, Truro TR1 2LS/);
  assert.match(p.text, /Ask them to spell the surname/);
  assert.match(p.text, /Never diagnose or give medical advice/);
  assert.match(p.text, /call 999 or go to A&E now, or call NHS 111/);
  assert.match(p.text, /bladder or bowels/);
  assert.ok(!p.text.includes(GAS_EMERGENCY));
  assert.equal(triage('Back pain and new numbness around the groin since this morning').urgency, 'emergency');
  assert.equal(triage('He has lost control of his bladder').urgency, 'emergency');
  assert.equal(triage('Lower back pain for two weeks, worse when sitting').urgency, 'normal');
  // Older saved settings without the new sections still load.
  const old = withDefaults({ business: { name: 'Old Co' }, calls: { days: [1] } });
  assert.equal(old.bookings.mode, 'callback'); assert.deepEqual(old.bookings.types, []); assert.equal(old.business.kind, 'trade');
  // Clinic wording in the history.
  const e = applyPatch(rec(), { status: 'won', jobValue: 65 }, CLINIC_SETTINGS, new Date('2026-11-02T12:00:00Z'));
  assert.equal(e.history.at(-1)!.text, 'Attended (£65)');
  assert.equal(e.invoiceDue, '2026-11-02');   // paid on the day
});

test('out of hours is judged in UK time, including summer time', () => {
  const c = { days: [1, 2, 3, 4, 5], open: '08:00', close: '17:30' };
  assert.equal(isAfterHours('2026-11-02T10:00:00Z', c), false);   // Mon 10:00 GMT
  assert.equal(isAfterHours('2026-11-02T18:00:00Z', c), true);    // Mon 18:00
  assert.equal(isAfterHours('2026-11-07T10:00:00Z', c), true);    // Saturday
  assert.equal(isAfterHours('2026-07-06T07:30:00Z', c), false);   // Mon 08:30 BST
  assert.equal(isAfterHours('2026-07-06T16:45:00Z', c), true);    // Mon 17:45 BST
});

test('enquiries from any platform, triage and phone numbers', () => {
  const call = normaliseEnquiry({ event: 'call_analyzed', call: { call_id: 'c1', from_number: '+447700900123', transcript: 'User: no hot water TR1 2AB', call_analysis: { call_summary: 'No hot water', custom_analysis_data: { caller_name: 'Jane' } } } })!;
  assert.equal(call.channel, 'call'); assert.equal(call.externalId, 'c1'); assert.equal(call.name, 'Jane'); assert.equal(call.postcode, 'TR1 2AB');
  const form = normaliseEnquiry({ name: 'Tom', phone: '07700 900456', email: 'TOM@example.com', message: 'Quote please' }, 'form')!;
  assert.equal(form.phone, '+447700900456'); assert.equal(form.email, 'tom@example.com');
  assert.equal(normaliseEnquiry({ foo: 1 }), null);
  assert.equal(normPhone('0044 1872 123456'), '+441872123456');
  assert.equal(phone('+447700900123'), '07700 900123');
  assert.equal(phone('+442079460000'), '020 7946 0000');
  assert.equal(triage('I can smell gas').gas, true);
  assert.equal(triage('Burst pipe, water everywhere').urgency, 'emergency');
  assert.equal(triage('Annual service for a combi boiler').urgency, 'normal');   // "boiler" alone isn't urgent
  assert.equal(triage('We can get you more leads with SEO').kind, 'spam');
  assert.notEqual(triage('Flooding in the hall, also we do SEO').kind, 'spam');
});

test('a job from enquiry to paid, with dates, counters and history', () => {
  const t0 = new Date('2026-11-02T11:00:00Z');
  let e = applyPatch(rec(), { replied: true }, S, t0);
  assert.equal(e.status, 'replied'); assert.equal(e.repliedAt, t0.toISOString());
  e = applyPatch(e, { status: 'quoted', quoteAmount: 640 }, S, new Date('2026-11-02T15:00:00Z'));
  assert.ok(e.quotedAt); assert.equal(e.chasersSent, 0);
  assert.equal(followUps([e], new Date('2026-11-04T15:00:00Z')).length, 1);
  assert.equal(followUps([e], new Date('2026-11-04T15:00:00Z'))[0].due, false);
  assert.equal(followUps([e], new Date('2026-11-05T16:00:00Z'))[0].due, true);
  e = applyPatch(e, { chaserSent: true }, S, new Date('2026-11-05T16:00:00Z'));
  assert.equal(e.chasersSent, 1);
  e = applyPatch(e, { status: 'won', jobValue: 640 }, S, new Date('2026-11-06T12:00:00Z'));
  assert.equal(e.invoiceDue, '2026-11-20');   // 14-day terms
  const pay = followUps([e], new Date('2026-11-20T12:00:00Z')).find((f) => f.kind === 'payment')!;
  assert.equal(pay.due, true); assert.equal(pay.stage, 1);
  assert.equal(followUps([e], new Date('2026-11-20T12:00:00Z')).some((f) => f.kind === 'review'), false); // not until paid
  e = applyPatch(e, { paid: true }, S, new Date('2026-11-21T09:00:00Z'));
  const rv = followUps([e], new Date('2026-11-22T10:00:00Z'));
  assert.deepEqual(rv.map((f) => [f.kind, f.due]), [['review', true]]);
  e = applyPatch(e, { reviewAsked: true }, S, new Date('2026-11-22T10:00:00Z'));
  assert.equal(followUps([e]).length, 0);
  assert.deepEqual(e.history.map((h) => h.text), ['Replied to the customer', 'Quote sent (£640)', 'Quote chaser 1 sent', 'Job done (£640)', 'Paid', 'Review requested']);
});

test('message wording and timing', () => {
  assert.equal(quoteChaseDue('2026-11-01T09:00:00Z', 0, new Date('2026-11-04T09:00:00Z')), true);
  assert.equal(quoteChaseDue('2026-11-01T09:00:00Z', 2, new Date('2026-12-01T09:00:00Z')), false);
  assert.equal(paymentStageDue('2026-11-10', 0, new Date('2026-11-30T12:00:00Z')), 1);  // one at a time
  assert.equal(paymentStageDue('2026-11-10', 1, new Date('2026-11-17T12:00:00Z')), 2);
  const ctx = { business: 'Smith Plumbing', owner: 'Dave', customer: 'Jane', job: 'the boiler repair', amount: '£240', payLink: 'https://pay.example/x' };
  assert.match(quoteChaser(ctx, 1), /Hi Jane, just checking the quote for the boiler repair \(£240\)/);
  assert.match(paymentReminder(ctx, 3), /two weeks overdue/);
  assert.ok(reviewRequest(ctx).endsWith(MARKETING_OPT_OUT));
  assert.ok(!quoteChaser(ctx, 1).includes('STOP'));
});

test('monthly report counts honestly', () => {
  const list = [
    rec({ id: 'a', afterHours: true, status: 'won', jobValue: 300, paidAt: '2026-11-05T10:00:00Z', repliedAt: '2026-11-02T10:20:00Z', urgency: 'emergency' }),
    rec({ id: 'b', status: 'quoted', quotedAt: '2026-11-03T10:00:00Z', quoteAmount: 900, repliedAt: '2026-11-02T13:00:00Z' }),
    rec({ id: 'c', status: 'spam' }),
    rec({ id: 'd', isTest: true }),
    rec({ id: 'e', receivedAt: '2026-10-20T10:00:00Z' }),
  ];
  const r = report(list, new Date('2026-11-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'));
  assert.equal(r.caught, 2); assert.equal(r.spam, 1); assert.equal(r.afterHours, 1); assert.equal(r.emergencies, 1);
  assert.equal(r.won, 1); assert.equal(r.wonValue, 300); assert.equal(r.paidValue, 300); assert.equal(r.quotes, 1); assert.equal(r.quotedValue, 900);
  assert.equal(r.medianReplyMins, 20); assert.equal(r.within1h, 1);
});

/* ---------- End to end against a stand-in for Supabase ---------- */
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'dave@smith.example' };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const db: Record<string, any[]> = {
  entitlements: [{ user_id: USER.id, email: USER.email, agent: 'capture', status: 'active' }],
  capture_settings: [{ user_id: USER.id, data: { ...S, business: { ...S.business, alertEmail: 'alerts@smith.example' } } }],
  enquiry_sources: [], enquiries: [], ai_usage: [],
};
function parse(url: string) {
  const u = new URL(url, 'http://x');
  const filters: [string, string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict', 'or'].includes(k)) continue;
    const m = v.match(/^(eq|in)\.(.*)$/s);
    if (m) filters.push([k, m[1], m[2]]);
  }
  return { table: u.pathname.replace('/rest/v1/', ''), filters, onConflict: u.searchParams.get('on_conflict') };
}
const matches = (row: any, f: [string, string, string][]) => f.every(([k, op, v]) =>
  op === 'eq' ? String(row[k]) === v : v.replace(/^\(|\)$/g, '').split(',').includes(String(row[k])));
const server = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/auth/v1/user') return res.end(JSON.stringify(USER));
  const { table, filters, onConflict } = parse(req.url!);
  const rows = (db[table] ??= []);
  if (req.method === 'GET') return res.end(JSON.stringify(rows.filter((r) => matches(r, filters))));
  if (req.method === 'POST') {
    const out: any[] = [];
    for (const b of Array.isArray(body) ? body : [body]) {
      const keys = onConflict?.split(',') ?? [];
      if (keys.length && b[keys[keys.length - 1]] != null && rows.find((r) => keys.every((k) => r[k] === b[k]))) continue; // ignore-duplicates
      const row = { id: uuid(), created_at: new Date().toISOString(), chasers_sent: 0, payment_reminders_sent: 0, notes: '', ...b };
      rows.push(row); out.push(row);
    }
    return res.end(JSON.stringify(out));
  }
  if (req.method === 'PATCH') { const hit = rows.filter((r) => matches(r, filters)); for (const r of hit) Object.assign(r, body); return res.end(JSON.stringify(hit)); }
  if (req.method === 'DELETE') { db[table] = rows.filter((r) => !matches(r, filters)); res.statusCode = 204; return res.end(); }
  res.statusCode = 405; res.end();
});

const owner = async (fn: any, payload: unknown) => {
  const r: Response = await fn(new Request('http://x/api/enquiries', { method: 'POST', body: JSON.stringify(payload), headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' } }));
  return { status: r.status, body: await r.json() };
};
const platform = async (fn: any, url: string, payload: unknown, form = false) => {
  const r: Response = await fn(new Request(url, {
    method: 'POST', body: form ? new URLSearchParams(payload as any).toString() : JSON.stringify(payload),
    headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' } : { 'Content-Type': 'application/json' },
  }));
  return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() };
};

test('secret link, intake, alerts, owner actions and deletion', async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', RESEND_API_KEY: '', APP_URL: 'https://capture.gainora.co.uk' });
  const logs: string[] = []; const log = console.log; console.log = (...a: any[]) => { logs.push(a.join(' ')); };
  try {
    const { default: enquiries } = await import('../netlify/functions/enquiries');
    const { default: enquiryIn } = await import('../netlify/functions/enquiry-in');

    const link = await owner(enquiries, { op: 'link', label: 'Trillet', channel: 'call' });
    assert.equal(link.status, 200);
    assert.match(link.body.url, /^https:\/\/capture\.gainora\.co\.uk\/api\/enquiry-in\/[A-Za-z0-9_-]{32}$/);
    const token = link.body.url.split('/').pop();
    assert.ok(!JSON.stringify(db.enquiry_sources).includes(token));   // only the hash is stored
    const inUrl = `http://x/api/enquiry-in/${token}`;
    assert.equal((await platform(enquiryIn, 'http://x/api/enquiry-in/short', { summary: 'x' })).status, 404);

    // A gas call: saved once (the platform retries), flagged, owner emailed (skipped here: no Resend key).
    const call = { event: 'call_analyzed', call: { call_id: 'c1', from_number: '07700900123', end_timestamp: Date.parse('2026-11-07T21:15:00Z'), transcript: 'User: I can smell gas', call_analysis: { call_summary: 'Smells gas in kitchen, TR1 2AB', custom_analysis_data: { caller_name: 'Jane Price' } } } };
    assert.equal((await platform(enquiryIn, inUrl, call)).status, 200);
    await platform(enquiryIn, inUrl, call);
    assert.equal(db.enquiries.length, 1);
    const e = db.enquiries[0];
    assert.equal(e.urgency, 'emergency'); assert.equal(e.after_hours, true); assert.equal(e.phone, '+447700900123');
    assert.match(e.history[1].text, /Flagged as an emergency/);
    assert.ok(logs.some((l) => /email skipped.*Emergency: Jane Price, TR1 2AB/.test(l)));

    // "Call started" pings and spam-bot form posts are ignored; a real form post gets a thank-you page.
    await platform(enquiryIn, inUrl, { event: 'call_started', call: { call_id: 'c2' } });
    await platform(enquiryIn, inUrl, { name: 'Bot', message: 'hi', website_url_confirm: 'http://spam' }, true);
    const thanks = await platform(enquiryIn, inUrl, { name: 'Tom', phone: '07700 900456', message: 'Quote for a new bathroom please' }, true);
    assert.match(thanks.type, /text\/html/); assert.match(thanks.text, /Thank you/);
    await platform(enquiryIn, inUrl, { name: 'Growth Co', email: 'x@growth.example', message: 'We can get you more leads with SEO' });
    assert.equal(db.enquiries.length, 3);
    assert.equal(db.enquiries[2].status, 'spam');

    // The owner's actions, through the same rules as the app.
    const tom = db.enquiries[1];
    const draft = await owner(enquiries, { op: 'draft', id: tom.id });
    assert.match(draft.body.text, /^Hi Tom, thanks for getting in touch with Smith Plumbing & Heating/);
    const q = await owner(enquiries, { op: 'update', id: tom.id, status: 'quoted', quoteAmount: '£4,800' });
    assert.equal(q.body.status, 'quoted'); assert.equal(q.body.quoteAmount, 4800); assert.ok(q.body.repliedAt);
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, chaserSent: true })).body.chasersSent, 1);
    const won = await owner(enquiries, { op: 'update', id: tom.id, status: 'won', jobValue: 4800 });
    assert.ok(won.body.invoiceDue);
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, paymentReminderSent: true })).body.paymentRemindersSent, 1);
    const paid = await owner(enquiries, { op: 'update', id: tom.id, paid: true, notes: 'Lovely job' });
    assert.ok(paid.body.paidAt); assert.equal(paid.body.notes, 'Lovely job');

    // Logging a call by hand, and the test enquiry.
    const added = await owner(enquiries, { op: 'add', enquiry: { channel: 'call', name: 'Sue', phone: '07700900999', summary: 'Dripping tap' } });
    assert.equal(added.status, 200); assert.equal(added.body.history[0].text, 'Logged by you');
    const t = await owner(enquiries, { op: 'test' });
    assert.equal(t.body.isTest, true);

    // Bad input is refused cleanly.
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, status: 'married' })).status, 400);
    assert.equal((await owner(enquiries, { op: 'update', id: 'nope', status: 'won' })).status, 404);
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, jobValue: -1 })).status, 400);
    assert.equal((await owner(enquiries, { op: 'update', id: e.id, chaserSent: true })).status, 400);
    assert.equal((await owner(enquiries, { op: 'add', enquiry: { summary: '' } })).status, 400);

    // Deleting removes it for good; a switched-off link stops working.
    await owner(enquiries, { op: 'delete', id: added.body.id });
    assert.ok(!db.enquiries.some((x) => x.id === added.body.id));
    await owner(enquiries, { op: 'revoke', id: link.body.id });
    assert.equal((await platform(enquiryIn, inUrl, { summary: 'hello', phone: '07700900111' })).status, 404);

    // Without the plan, the owner tools are locked.
    db.entitlements[0].status = 'canceled';
    assert.equal((await owner(enquiries, { op: 'test' })).status, 403);
  } finally { console.log = log; server.close(); }
});

test('settings with nothing saved still work', () => {
  const s = emptySettings('a@b.co');
  assert.equal(s.business.alertEmail, 'a@b.co');
  assert.match(packFromSettings({ ...s, business: { ...s.business, name: 'X' } }).greeting, /you’re through to X\. Calls are recorded/);
});

/* ---------- Beauty and aesthetics ---------- */
{
  const { packFromSettings, triage, isBeauty, bookingSystemsFor, emptySettings, DEFAULT_BEAUTY_SAFETY } = await import('../shared/capture');
  const s = emptySettings('amy@example.com');
  s.business = { ...s.business, kind: 'appointments', name: 'Willow Skin', trade: 'Aesthetics clinic', ownerName: 'Amy' };
  s.calls.safety = DEFAULT_BEAUTY_SAFETY;
  s.calls.emergencyLine = '07700 900444';
  s.calls.transferEmergency = true;
  test('beauty: recognised from the type of business', () => { assert(isBeauty(s.business)); assert(!isBeauty({ kind: 'appointments', trade: 'Physiotherapy' })); assert(!isBeauty({ kind: 'trade', trade: 'Beauty salon' })); });
  test('beauty: script never sends callers to 999 or other services', () => {
    const text = packFromSettings(s).text;
    assert(!/call 999|go to A&E|call NHS 111/i.test(text), 'mentions 999, A&E or 111 as an instruction');
    assert(/emergency line, 07700 900444/.test(text), 'missing the clinic emergency line');
    assert(/put the call straight through/.test(text), 'missing transfer');
    assert(/Do not direct callers to 999/.test(text), 'missing the rule against other services');
  });
  test('beauty: without an emergency line, the clinic calls back as a priority', () => {
    const t = packFromSettings({ ...s, calls: { ...s.calls, emergencyLine: '' } }).text;
    assert(/call them back as a priority/.test(t)); assert(!/call 999/i.test(t));
  });
  test('physio clinics keep their 999 safety script', () => {
    const p = packFromSettings({ ...s, business: { ...s.business, trade: 'Physiotherapy' }, calls: { ...s.calls, safety: '' } }).text;
    assert(/call 999 or go to A&E/.test(p));
  });
  test('triage: reactions after a treatment are emergencies', () => {
    for (const t of ['My top lip is very swollen and a patch has turned white', 'Since the filler my vision is blurry', 'I have blisters after laser yesterday', 'I think I am having a reaction to the botox']) {
      assert(triage(t).urgency === 'emergency', t);
    }
    assert(triage('Can I book a lash lift on Saturday?').urgency === 'normal');
  });
  test('booking systems: salon systems first for beauty, trade systems for trades', () => {
    const b = bookingSystemsFor(s.business);
    for (const x of ['Fresha', 'Phorest', 'Timely', 'Treatwell', 'Booksy', 'Salonized', 'Pabau']) assert(b.includes(x), x);
    // Gainora's own diary comes first, then the salon systems.
    assert(b[0] === GAINORA_DIARY && b[1] === 'Fresha' && b.indexOf('Phorest') < b.indexOf('Google Calendar'));
    assert(!b.includes('Jobber'));
    const t = bookingSystemsFor({ kind: 'trade', trade: 'Electrical' });
    assert(t.includes('Jobber') && !t.includes('Phorest'));
    assert(b[b.length - 1] === 'Something else' && t[t.length - 1] === 'Something else');
  });
}
