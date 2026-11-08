import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { CLINIC_SETTINGS } from '../src/lib/demo';

// A stand-in for Supabase, Twilio and Resend on one local server.
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'sarah@clinic.example' };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const S = structuredClone(CLINIC_SETTINGS);
for (const w of Object.values(S.automations)) w!.since = '2026-01-01T00:00:00Z';
S.texting = { number: '+447700900600', status: 'on' };
const db: Record<string, any[]> = {
  entitlements: [{ user_id: USER.id, email: USER.email, agent: 'capture', status: 'active' }],
  capture_settings: [{ user_id: USER.id, data: S, completed_at: S.completedAt }],
  enquiries: [], messages: [], opt_outs: [], enquiry_sources: [],
};
const texts: { To: string; From: string; Body: string }[] = [];
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
const get = (row: any, k: string) => k.includes('->') ? k.split(/->>?/).reduce((a, p) => a?.[p], row) : row[k];
const matches = (row: any, f: [string, string, string][]) => f.every(([k, op, v]) => op === 'eq' ? String(get(row, k)) === v : v.replace(/^\(|\)$/g, '').split(',').includes(String(get(row, k))));
const server = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  res.setHeader('Content-Type', 'application/json');
  if (req.url!.startsWith('/2010-04-01/')) { const p = Object.fromEntries(new URLSearchParams(raw)) as any; texts.push(p); return res.end(JSON.stringify({ sid: `SM${texts.length}` })); }
  if (req.url === '/auth/v1/user') return res.end(JSON.stringify(USER));
  const body = raw ? JSON.parse(raw) : null;
  const { table, filters, onConflict } = parse(req.url!);
  const rows = (db[table] ??= []);
  if (req.method === 'GET') return res.end(JSON.stringify(rows.filter((r) => matches(r, filters))));
  if (req.method === 'POST') {
    const out: any[] = [];
    for (const b of Array.isArray(body) ? body : [body]) {
      const keys = onConflict?.split(',') ?? [];
      if (keys.length && keys.every((k) => b[k] != null) && rows.find((r) => keys.every((k) => r[k] === b[k]))) continue;
      const row = { id: uuid(), created_at: new Date().toISOString(), chasers_sent: 0, payment_reminders_sent: 0, notes: '', history: [], read: true, ...b };
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
const twilioPost = async (fn: any, params: Record<string, string>, token = 'tw_token') => {
  const url = 'https://capture.gainora.co.uk/api/sms-in';
  const sig = createHmac('sha1', token).update(url + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
  const r: Response = await fn(new Request(url, { method: 'POST', body: new URLSearchParams(params).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig } }));
  return { status: r.status, text: await r.text() };
};

test('a booked call gets its confirmation, replies come back in, STOP stops texts, approvals send', async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', RESEND_API_KEY: '', APP_URL: 'https://capture.gainora.co.uk', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw_token', TWILIO_FROM: '' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => realFetch(String(url).replace('https://api.twilio.com', base), init)) as any;
  const log = console.log; console.log = () => {};
  try {
    const { default: enquiries } = await import('../netlify/functions/enquiries');
    const { default: enquiryIn } = await import('../netlify/functions/enquiry-in');
    const { default: smsIn } = await import('../netlify/functions/sms-in');
    const { runAutomations } = await import('../netlify/lib/messages');

    // The receptionist sends a finished call: George, booked on the call.
    const link = await owner(enquiries, { op: 'link', label: 'Retell', channel: 'call' });
    const token = link.body.url.split('/').pop();
    await enquiryIn(new Request(`http://x/api/enquiry-in/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'call_analyzed', call: { call_id: 'c1', from_number: '+447700900310', call_analysis: { call_summary: 'Lower back pain for two weeks. New patient.', custom_analysis_data: { caller_name: 'George Hammond' } } } }) }));
    const george = db.enquiries[0];
    // Not booked yet: he gets the thank-you text straight away, from the clinic's number.
    assert.equal(texts.length, 1);
    assert.equal(texts[0].From, '+447700900600'); assert.equal(texts[0].To, '+447700900310');
    assert.match(texts[0].Body, /^Hi George, thanks for contacting Lemon Street Physio/);
    // Sarah books him in from the app: the confirmation goes out with the booking details.
    const when = new Date(Date.now() + 3 * 86_400_000); when.setUTCHours(10, 0, 0, 0);
    await owner(enquiries, { op: 'update', id: george.id, status: 'booked', bookedFor: when.toISOString(), bookedType: 'Initial consultation', bookedWith: 'Sarah' });
    assert.equal(texts.length, 2);
    assert.match(texts[1].Body, /thank you for booking with Lemon Street Physio\. Your initial consultation appointment is on .+ at 10am with Sarah, at 12 Lemon Street/);
    // Running again doesn't repeat anything.
    await runAutomations(USER.id);
    assert.equal(texts.length, 2);
    assert.equal(db.messages.filter((m) => m.status === 'sent').length, 2);

    // George texts back: it lands on his enquiry, unread.
    const bad = await twilioPost(smsIn, { From: '+447700900310', To: '+447700900600', Body: 'Hi' }, 'wrong');
    assert.equal(bad.status, 403);
    await twilioPost(smsIn, { From: '+447700900310', To: '+447700900600', Body: 'Thanks! Is there parking?', MessageSid: 'SMin1' });
    const inbound = db.messages.find((m) => m.direction === 'in')!;
    assert.equal(inbound.enquiry_id, george.id); assert.equal(inbound.read, false);
    // Sarah replies from the app; then marks it read.
    const reply = await owner(enquiries, { op: 'reply', id: george.id, channel: 'text', text: 'Yes, free parking behind the clinic. Sarah' });
    assert.equal(reply.status, 200); assert.equal(texts.at(-1)!.Body, 'Yes, free parking behind the clinic. Sarah');
    await owner(enquiries, { op: 'read', id: george.id });
    assert.equal(db.messages.find((m) => m.direction === 'in')!.read, true);

    // STOP: confirmed, recorded, and no more texts (the app says so instead of sending).
    const stop = await twilioPost(smsIn, { From: '+447700900310', To: '+447700900600', Body: 'STOP' });
    assert.match(stop.text, /You won’t get any more texts from Lemon Street Physio/);
    assert.equal(db.opt_outs.length, 1);
    assert.equal((await owner(enquiries, { op: 'reply', id: george.id, channel: 'text', text: 'Hello?' })).status, 400);
    const start = await twilioPost(smsIn, { From: '+447700900310', To: '+447700900600', Body: 'start' });
    assert.match(start.text, /back on/); assert.equal(db.opt_outs.length, 0);

    // Someone new texts the clinic number: a new enquiry, and a thank-you.
    const before = texts.length;
    await twilioPost(smsIn, { From: '+447700900999', To: '+447700900600', Body: 'Do you treat tennis elbow? Could I book next week?', MessageSid: 'SMin2' });
    assert.equal(db.enquiries.length, 2); assert.equal(db.enquiries[1].channel, 'text');
    assert.equal(texts.length, before + 1); assert.match(texts.at(-1)!.Body, /thanks for contacting Lemon Street Physio/);

    // The final payment reminder waits for approval; approving sends it and moves the enquiry on.
    db.capture_settings[0].data.automations.payment.steps.pay1.ask = true;
    await owner(enquiries, { op: 'update', id: george.id, status: 'won', jobValue: 65, invoiceDue: new Date(Date.now() - 86_400_000).toISOString() });
    const waiting = db.messages.find((m) => m.status === 'awaiting_approval')!;
    assert.equal(waiting.step, 'pay1');
    const sentBefore = texts.length;
    const ok = await owner(enquiries, { op: 'approve', messageId: waiting.id, text: 'Hi George, just a reminder your £65 is due. Thanks, Sarah' });
    assert.equal(ok.status, 200); assert.equal(texts.length, sentBefore + 1);
    assert.equal(db.enquiries[0].payment_reminders_sent, 1);
    assert.equal((await owner(enquiries, { op: 'approve', messageId: waiting.id })).status, 404);   // only once

    // Urgent calls text the owner's own mobile (this clinic: emergencies only).
    const t0 = texts.length;
    await enquiryIn(new Request(`http://x/api/enquiry-in/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call: { call_id: 'c9', from_number: '+447700900312', call_analysis: { call_summary: 'Back pain with numbness around the groin since this morning.' } } }) }));
    assert.equal(texts.length, t0 + 1);
    assert.equal(texts.at(-1)!.To, '+447700900222');
    assert.match(texts.at(-1)!.Body, /^EMERGENCY for Lemon Street Physio/);
    // …and the red-flag caller is not sent "we'll find you an appointment".
    assert.ok(!texts.some((x) => x.To === '+447700900312'));
  } finally { console.log = log; globalThis.fetch = realFetch; server.close(); }
});
