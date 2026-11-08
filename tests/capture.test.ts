import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  findPostcode, greetingFor, GAS_EMERGENCY, MARKETING_OPT_OUT, normaliseEnquiry, normPhone, paymentReminder, paymentStageDue,
  quoteChaseDue, quoteChaser, receptionistPack, reviewRequest, triage,
} from '../shared/capture';
import { summariseValue } from '../shared/value';

const TRADE = {
  business: { name: 'Smith Plumbing & Heating', ownerName: 'Dave', location: 'Truro, Cornwall', oneLiner: 'Boiler servicing, repairs and bathrooms.', website: 'https://smithplumbing.example' },
  offer: { products: 'Boiler servicing and repairs, bathrooms', typicalPrice: 'Boiler service £85' },
  customers: { areas: ['Local'] },
};

test('receptionist pack: says it is an AI, records, gas line, no prices by default', () => {
  const p = receptionistPack(TRADE, { hours: 'Mon–Fri 8am–6pm', emergencies: ['no heating', 'water leak'] });
  assert.match(p.greeting, /Smith Plumbing & Heating/);
  assert.match(p.greeting, /AI assistant/);
  assert.match(p.greeting, /recorded/);
  assert.ok(p.text.includes(GAS_EMERGENCY));
  assert.match(p.text, /Don't give prices/);
  assert.match(p.text, /Never take card or bank details/);
  assert.match(p.text, /Mon–Fri 8am–6pm/);
  assert.match(p.text, /no heating; water leak/);
  // No recording → the greeting doesn't claim it.
  assert.doesNotMatch(greetingFor('X', false), /recorded/);
  // Guide prices only when the owner chose that.
  const ranges = receptionistPack(TRADE, { quotePolicy: 'ranges', priceNotes: 'Boiler service £85–£95', gasWork: false });
  assert.match(ranges.text, /Boiler service £85–£95/);
  assert.ok(!ranges.text.includes(GAS_EMERGENCY));
});

test('enquiries: Retell-style call, flat form post and junk', () => {
  const now = new Date('2026-11-08T10:00:00Z');
  const call = normaliseEnquiry({
    event: 'call_analyzed',
    call: {
      call_id: 'call_123', from_number: '+447700900123', end_timestamp: 1794132000000, recording_url: 'https://rec.example/1.wav',
      transcript: 'Agent: Hi\nUser: My boiler has stopped, there is no hot water, postcode tr1 2ab',
      call_analysis: { call_summary: 'Boiler stopped, no hot water. Wants someone today.', custom_analysis_data: { caller_name: 'Jane Price' } },
    },
  }, undefined, now)!;
  assert.equal(call.channel, 'call');
  assert.equal(call.externalId, 'call_123');
  assert.equal(call.name, 'Jane Price');
  assert.equal(call.phone, '+447700900123');
  assert.equal(call.postcode, 'TR1 2AB');
  assert.equal(call.recordingUrl, 'https://rec.example/1.wav');
  assert.match(call.summary, /Boiler stopped/);

  const form = normaliseEnquiry({ name: 'Tom', phone: '07700 900456', email: 'TOM@example.com', message: 'Could I get a quote for a new bathroom?' }, 'form', now)!;
  assert.equal(form.channel, 'form');
  assert.equal(form.phone, '+447700900456');
  assert.equal(form.email, 'tom@example.com');
  assert.equal(form.receivedAt, now.toISOString());

  const bad = normaliseEnquiry({ email: 'not-an-email', foo: 1 });
  assert.equal(bad, null);
  assert.equal(normaliseEnquiry('nope' as any), null);
  assert.equal(normPhone('0044 1872 123456'), '+441872123456');
  assert.equal(findPostcode('at PL25 4AB please'), 'PL25 4AB');
});

test('triage: gas and floods are emergencies, salesy calls are spam', () => {
  const gas = triage('I can smell gas in the kitchen');
  assert.equal(gas.urgency, 'emergency');
  assert.equal(gas.gas, true);
  assert.equal(triage('Burst pipe, water everywhere').urgency, 'emergency');
  const vulnerable = triage('Boiler making a noise, my mum is elderly');
  assert.equal(vulnerable.urgency, 'urgent');
  assert.equal(triage('How much for a boiler service next month?').kind, 'quote');
  assert.equal(triage('Can you come out to service the boiler in December').kind, 'booking');
  assert.equal(triage('We can get you more leads with SEO and backlinks').kind, 'spam');
  assert.equal(triage('Not happy, the leak came back').kind, 'complaint');
  // An emergency is never filed as spam, whatever else it says.
  assert.notEqual(triage('Flooding in the hall! also we do SEO').kind, 'spam');
});

test('follow-up timing and wording', () => {
  const sent = '2026-11-01T09:00:00Z';
  assert.equal(quoteChaseDue(sent, 0, new Date('2026-11-03T09:00:00Z')), false);
  assert.equal(quoteChaseDue(sent, 0, new Date('2026-11-04T09:00:00Z')), true);
  assert.equal(quoteChaseDue(sent, 1, new Date('2026-11-09T10:00:00Z')), true);
  assert.equal(quoteChaseDue(sent, 2, new Date('2026-12-01T10:00:00Z')), false);

  assert.equal(paymentStageDue('2026-11-10', 0, new Date('2026-11-09T12:00:00Z')), null);
  assert.equal(paymentStageDue('2026-11-10', 0, new Date('2026-11-10T12:00:00Z')), 1);
  assert.equal(paymentStageDue('2026-11-10', 1, new Date('2026-11-17T12:00:00Z')), 2);
  assert.equal(paymentStageDue('2026-11-10', 0, new Date('2026-11-30T12:00:00Z')), 1); // catches up one at a time
  assert.equal(paymentStageDue('2026-11-10', 3, new Date('2026-12-30T12:00:00Z')), null);

  const ctx = { business: 'Smith Plumbing', owner: 'Dave', customer: 'Jane', job: 'the boiler repair', amount: '£240', payLink: 'https://pay.example/x' };
  assert.match(quoteChaser(ctx, 1), /Hi Jane, just checking the quote for the boiler repair \(£240\)/);
  assert.match(quoteChaser(ctx, 2), /won't keep chasing/);
  assert.match(paymentReminder(ctx, 1), /due today\. You can pay here: https:\/\/pay\.example\/x/);
  assert.match(paymentReminder(ctx, 2), /already paid/);
  assert.match(paymentReminder(ctx, 3), /two weeks overdue/);
  // Review requests count as marketing, so they always carry the opt-out.
  assert.ok(reviewRequest(ctx).endsWith(MARKETING_OPT_OUT));
  assert.ok(!quoteChaser(ctx, 1).includes('STOP'));
});

test('won jobs count as money in the results', () => {
  const s = summariseValue([
    { id: '1', agent: 'capture', kind: 'enquiry_caught', title: 'Enquiry: Jane', at: '2026-11-02T10:00:00Z' },
    { id: '2', agent: 'you', kind: 'enquiry_won', title: 'Job won: Jane', amount: 240, at: '2026-11-05T10:00:00Z' },
  ]);
  assert.equal(s.counts.enquiry_caught, 1);
  assert.equal(s.wonValue, 240);
  assert.equal(s.minutesSaved, 5);
});

/* ---------- End to end against a stand-in for Supabase ---------- */
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'dave@smith.example' };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const db: Record<string, any[]> = {
  entitlements: [{ user_id: USER.id, email: USER.email, agent: 'capture', status: 'active' }],
  profiles: [{ user_id: USER.id, data: TRADE }],
  enquiry_sources: [], enquiries: [], value_events: [], alerts: [], ai_usage: [],
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
      if (keys.length && rows.find((r) => keys.every((k) => r[k] === b[k]))) continue; // ignore-duplicates
      const row = { id: uuid(), created_at: new Date().toISOString(), chasers_sent: 0, status: 'new', ...b };
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
    method: 'POST',
    body: form ? new URLSearchParams(payload as any).toString() : JSON.stringify(payload),
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
  }));
  return { status: r.status, body: await r.json() };
};

test('enquiry link, inbox, emergency alert, reply draft and a won job', async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', APP_URL: 'https://app.gainora.co.uk' });
  try {
    const { default: enquiries } = await import('../netlify/functions/enquiries');
    const { default: enquiryIn } = await import('../netlify/functions/enquiry-in');

    // A secret link is made and shown once; only its hash is stored.
    const link = await owner(enquiries, { op: 'link', label: 'Trillet', channel: 'call' });
    assert.equal(link.status, 200);
    assert.match(link.body.url, /^https:\/\/app\.gainora\.co\.uk\/api\/enquiry-in\/[A-Za-z0-9_-]{32}$/);
    const token = link.body.url.split('/').pop();
    assert.ok(!JSON.stringify(db.enquiry_sources).includes(token));
    const inUrl = `http://x/api/enquiry-in/${token}`;

    // Unknown or malformed links are refused without saving anything.
    assert.equal((await platform(enquiryIn, 'http://x/api/enquiry-in/short', { summary: 'x' })).status, 404);
    assert.equal((await platform(enquiryIn, `http://x/api/enquiry-in/${'a'.repeat(32)}`, { summary: 'x' })).status, 404);

    // A gas call arrives: saved, flagged urgent, counted. The platform's retry doesn't duplicate it.
    const call = { event: 'call_analyzed', call: { call_id: 'c1', from_number: '07700900123', transcript: 'User: I can smell gas', call_analysis: { call_summary: 'Smells gas in kitchen, TR1 2AB', custom_analysis_data: { caller_name: 'Jane Price' } } } };
    const got = await platform(enquiryIn, inUrl, call);
    assert.equal(got.status, 200);
    await platform(enquiryIn, inUrl, call);
    assert.equal(db.enquiries.length, 1);
    const e = db.enquiries[0];
    assert.equal(e.urgency, 'emergency');
    assert.equal(e.phone, '+447700900123');
    assert.equal(e.postcode, 'TR1 2AB');
    assert.equal(db.alerts.length, 1);
    assert.equal(db.alerts[0].level, 'urgent');
    assert.equal(db.alerts[0].agent, 'capture');
    assert.equal(db.value_events.filter((v) => v.kind === 'enquiry_caught').length, 1);

    // "Call started" pings are ignored; a web form post works; sales spam is filed away quietly.
    assert.equal((await platform(enquiryIn, inUrl, { event: 'call_started', call: { call_id: 'c2' } })).body.skipped, 'call_started');
    await platform(enquiryIn, inUrl, { name: 'Tom', phone: '07700 900456', message: 'Quote for a new bathroom please' }, true);
    await platform(enquiryIn, inUrl, { name: 'Growth Co', email: 'x@growth.example', message: 'We can get you more leads with SEO' });
    assert.equal(db.enquiries.length, 3);
    assert.equal(db.enquiries[2].status, 'spam');
    assert.equal(db.value_events.filter((v) => v.kind === 'enquiry_caught').length, 2);
    assert.equal(db.alerts.length, 1);

    // The owner gets a drafted reply (template without AI configured); nothing is sent.
    const tom = db.enquiries[1];
    const draft = await owner(enquiries, { op: 'draft', id: tom.id });
    assert.match(draft.body.text, /^Hi Tom, thanks for getting in touch with Smith Plumbing & Heating/);

    // Quote sent → chaser text → won with a value → moved back removes the win.
    await owner(enquiries, { op: 'update', id: tom.id, status: 'quoted' });
    assert.ok(db.enquiries[1].quoted_at);
    const chase = await owner(enquiries, { op: 'message', kind: 'quote', id: tom.id, job: 'the bathroom', amount: '£4,800' });
    assert.match(chase.body.text, /Hi Tom, just checking the quote for the bathroom \(£4,800\)/);
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, chaserSent: true })).body.chasers_sent, 1);
    await owner(enquiries, { op: 'update', id: tom.id, status: 'won', value: 4800 });
    let wins = db.value_events.filter((v) => v.kind === 'enquiry_won');
    assert.equal(wins.length, 1);
    assert.equal(wins[0].amount, 4800);
    await owner(enquiries, { op: 'update', id: tom.id, status: 'booked' });
    wins = db.value_events.filter((v) => v.kind === 'enquiry_won');
    assert.equal(wins.length, 0);

    // Payment reminder and review request use only https links the owner gave.
    const pay = await owner(enquiries, { op: 'message', kind: 'payment', stage: 2, customer: 'Tom', amount: '£4,800', payLink: 'javascript:alert(1)' });
    assert.doesNotMatch(pay.body.text, /javascript/);
    const review = await owner(enquiries, { op: 'message', kind: 'review', customer: 'Tom', reviewLink: 'https://g.page/r/abc/review' });
    assert.match(review.body.text, /reply STOP/);

    // The receptionist pack comes from the saved profile.
    const pack = await owner(enquiries, { op: 'pack', setup: { quotePolicy: 'never' } });
    assert.match(pack.body.greeting, /Smith Plumbing & Heating/);

    // Bad input is refused cleanly; a revoked link stops working.
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, status: 'married' })).status, 400);
    assert.equal((await owner(enquiries, { op: 'update', id: 'nope', status: 'won' })).status, 404);
    assert.equal((await owner(enquiries, { op: 'update', id: tom.id, value: -1 })).status, 400);
    assert.equal((await owner(enquiries, { op: 'message', kind: 'poem' })).status, 400);
    await owner(enquiries, { op: 'link', revoke: link.body.id });
    assert.equal((await platform(enquiryIn, inUrl, { summary: 'hello', phone: '07700900999' })).status, 404);

    // Without the Capture & Convert plan, the owner tools are locked.
    db.entitlements[0].status = 'canceled';
    assert.equal((await owner(enquiries, { op: 'pack' })).status, 403);
  } finally { server.close(); }
});
