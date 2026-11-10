import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { BEAUTY_SETTINGS } from '../src/lib/demo';

// Fake Supabase: one clinic, one regular, and no Command Centre client list yet (that table answers 404).
const TOKEN = 'A'.repeat(32);
const hash = createHash('sha256').update(TOKEN).digest('hex');
const calls: string[] = [];
const soon = new Date(Date.now() + 3 * 86_400_000); soon.setUTCHours(14, 0, 0, 0);
const server = createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  const url = decodeURIComponent(req.url!);
  calls.push(url);
  res.setHeader('Content-Type', 'application/json');
  if (url.startsWith('/rest/v1/enquiry_sources')) return res.end(JSON.stringify(url.includes(hash) ? [{ id: 's1', user_id: 'u1' }] : []));
  if (url.startsWith('/rest/v1/capture_settings')) return res.end(JSON.stringify([{ data: BEAUTY_SETTINGS }]));
  if (url.startsWith('/rest/v1/enquiries')) {
    if (!url.includes('phone=eq.+447700900410')) return res.end('[]');
    return res.end(JSON.stringify([{ id: 'e1', channel: 'call', name: 'Chloe Martin', phone: '+447700900410', summary: 'Lip filler top-up', status: 'booked', kind: 'booking', urgency: 'normal',
      booked_for: soon.toISOString(), booked_type: 'Lip filler', booked_with: 'Amy', history: [], received_at: new Date(Date.now() - 86_400_000).toISOString(), is_test: false }]));
  }
  if (url.startsWith('/rest/v1/clients')) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'relation "public.clients" does not exist' })); }
  res.statusCode = 204; res.end();
});

test('caller lookup: Retell gets the regular’s record, unknown and withheld numbers get none, and it never fails a call', async () => {
  await new Promise<void>((r) => server.listen(0, r));
  Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${(server.address() as any).port}`, SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  try {
    const { default: fn } = await import('../netlify/functions/caller-in');
    const ask = (from: string | undefined, token = TOKEN, body?: any) => fn(new Request(`https://capture.gainora.co.uk/api/caller-in/${token}`, { method: 'POST', body: JSON.stringify(body ?? { event: 'call_inbound', call_inbound: { from_number: from, to_number: '+441326000201' } }) }));

    const r = await ask('+447700900410');
    assert.equal(r.status, 200);
    const v = (await r.json()).call_inbound.dynamic_variables;
    assert.equal(v.caller_known, 'yes');
    assert.equal(v.caller_first_name, 'Chloe');
    assert.match(v.caller_record, /Booked in: .* at \d{1,2}(:\d\d)?[ap]m, lip filler with Amy/);
    for (const k of Object.keys(v)) assert.equal(typeof v[k], 'string');

    const u = (await (await ask('+447700900999')).json()).call_inbound.dynamic_variables;
    assert.equal(u.caller_known, 'no');
    assert.match(u.caller_record, /Nothing on record/);

    const w = (await (await ask('anonymous')).json()).call_inbound.dynamic_variables;
    assert.match(w.caller_record, /withheld/);
    assert.ok(!calls.some((c) => c.includes('phone=eq.anonymous')));

    // A bad link is refused; other events get an empty success.
    assert.equal((await ask('+447700900410', 'B'.repeat(32))).status, 404);
    assert.equal((await ask('+447700900410', 'short')).status, 404);
    assert.deepEqual(await (await ask(undefined, TOKEN, { event: 'chat_inbound', chat_inbound: {} })).json(), {});

    // Supabase down: the call still goes ahead, with no record.
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    const down = await ask('+447700900410');
    assert.equal(down.status, 200);
    assert.equal((await down.json()).call_inbound.dynamic_variables.caller_known, 'no');
  } finally { server.close(); }
});
