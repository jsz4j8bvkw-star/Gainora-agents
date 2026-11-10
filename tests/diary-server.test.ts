import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startFake } from './fake-db';
import { BEAUTY_SETTINGS } from '../src/lib/demo';
import { londonDate } from '../shared/diary';

// One clinic on an active plan, its booking page on, a call link, and nothing booked yet.
const TOKEN = 'T'.repeat(32);
const settings = { ...structuredClone(BEAUTY_SETTINGS), page: { on: true, slug: 'willow-skin-beauty', mode: 'book' } };
// The next day the clinic is open (Tue–Sat), from tomorrow.
const tomorrow = (() => { for (let i = 1; i < 8; i++) { const d = londonDate(new Date(Date.now() + i * 86_400_000)); const wd = ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; if (BEAUTY_SETTINGS.calls.days.includes(wd)) return d; } return ''; })();

test('the booking page, the receptionist and the diary share one set of free times', async () => {
  const fake = await startFake({
    capture_settings: [{ user_id: 'u1', data: settings, completed_at: settings.completedAt }],
    entitlements: [{ user_id: 'u1', agent: 'capture', status: 'active', email: 'owner@willow.example' }],
    enquiry_sources: [{ id: 's1', user_id: 'u1', channel: 'call', token_hash: createHash('sha256').update(TOKEN).digest('hex'), active: true }],
    enquiries: [], messages: [], opt_outs: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 'test-secret', APP_URL: 'https://capture.gainora.co.uk' });
  try {
    const { default: book } = await import('../netlify/functions/book');
    const { default: tool } = await import('../netlify/functions/diary-tool');
    const page = (path: string, init?: RequestInit) => book(new Request(`https://capture.gainora.co.uk/api/book/${path}`, init));

    // The public page: name, treatments and team; nothing private.
    const info = await (await page('willow-skin-beauty')).json();
    assert.equal(info.name, 'Willow Skin & Beauty');
    assert.ok(info.types.some((t: any) => t.name === 'Lip filler' && t.price === '£250'));
    assert.deepEqual(info.team, ['Amy', 'Leah', 'Jess']);
    assert.equal(info.deposit.what, '£30, taken off your treatment');
    assert.ok(!JSON.stringify(info).includes('owner@') && !('alertEmail' in info));
    assert.equal((await page('no-such-clinic')).status, 404);

    // Free times for tomorrow, then book the first one.
    const times = await (await page(`willow-skin-beauty/times?type=Lip%20filler&from=${tomorrow}&days=1`)).json();
    const first = times.days[0]?.slots[0];
    assert.ok(first, 'there are free times tomorrow');
    assert.equal(first.who, 'Amy');
    const post = (slot: string, name = 'Sam Taylor', phone = '07700 900555') => page('willow-skin-beauty', { method: 'POST', body: JSON.stringify({ type: 'Lip filler', slot, name, phone, newClient: true }) });
    const r = await (await post(first.id)).json();
    assert.equal(r.ok, true);
    assert.equal(r.status, 'booked');
    assert.deepEqual(r.deposit, { what: '£30, taken off your treatment', link: 'https://pay.example/willow-skin/deposit' });
    const saved = fake.tables.enquiries.find((e) => e.name === 'Sam Taylor')!;
    assert.equal(saved.status, 'booked');
    assert.equal(saved.booked_with, 'Amy');
    assert.equal(saved.channel, 'form');
    assert.ok(saved.history.some((h: any) => h.text === 'New client'));
    assert.ok(saved.history.some((h: any) => h.text === 'Booked online by the client'));

    // The same time again is gone, for the page and for the receptionist.
    const again = await post(first.id, 'Someone Else', '07700 900666');
    assert.equal(again.status, 409);
    const call = (action: string, args: any, callId = 'call_1') => tool(new Request(`https://capture.gainora.co.uk/api/diary-tool/${TOKEN}/${action}`, { method: 'POST', body: JSON.stringify({ name: action, call: { call_id: callId, from_number: '+447700900777' }, args }) }));
    const offer = await (await call('times', { treatment: 'lip filler', date: tomorrow })).json();
    assert.equal(offer.ok, true);
    assert.ok(offer.options.length >= 2);
    assert.ok(!offer.options.some((o: any) => o.slot === first.id), 'the booked time is never offered');
    assert.match(offer.options[0].say, /at \d{1,2}(:\d\d)?[ap]m with Amy$/);

    // She books one on the call; asking twice on the same call doesn't book twice.
    const booked = await (await call('book', { slot: offer.options[0].slot, treatment: 'Lip filler', name: 'Chloe Martin', new_client: false })).json();
    assert.equal(booked.booked, true);
    // Texting isn't set up in this test, so she doesn't promise a text (found on Gainora's own line before Twilio).
    assert.match(booked.note, /don’t promise a text/);
    const twice = await (await call('book', { slot: offer.options[1].slot, treatment: 'Lip filler', name: 'Chloe Martin' })).json();
    assert.match(twice.note, /already has a booking/);
    const onCall = fake.tables.enquiries.filter((e) => e.external_id === 'call_1');
    assert.equal(onCall.length, 1);
    assert.equal(onCall[0].phone, '+447700900777');
    assert.ok(onCall[0].history.some((h: any) => h.text === 'Booked by your receptionist during the call'));

    // The call's summary arrives afterwards and joins the booking, not a second enquiry.
    const { intake } = await import('../netlify/lib/capture');
    const merged: any = await intake('u1', 's1', { event: 'call_analyzed', call: { call_id: 'call_1', from_number: '+447700900777', transcript: 'Agent: Hello…', call_analysis: { call_summary: 'Chloe booked lip filler with Amy.', custom_analysis_data: { caller_name: 'Chloe Martin' } } } }, 'call');
    assert.ok(merged.saved);
    assert.equal(fake.tables.enquiries.filter((e) => e.external_id === 'call_1').length, 1);
    assert.match(onCall[0].summary, /^Chloe booked lip filler with Amy\./);
    assert.equal(onCall[0].transcript, 'Agent: Hello…');

    // Unknown treatment: she's told what can be booked.
    const odd = await (await call('times', { treatment: 'tattoo removal' }, 'call_2')).json();
    assert.match(odd.note, /These can be booked: Free consultation/);

    // With texting set up, she says the confirmation text is on its way.
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'test' });
    try {
      const more = await (await call('times', { treatment: 'lip filler', date: tomorrow }, 'call_3')).json();
      const texted = await (await call('book', { slot: more.options[0].slot, treatment: 'Lip filler', name: 'Priya Shah' }, 'call_3')).json();
      assert.equal(texted.booked, true);
      assert.match(texted.note, /confirmation text is on its way/);
    } finally { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; }
  } finally { fake.server.close(); }
});
