import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

// Fake Supabase + Stripe on one local server, recording every call.
const calls: { method: string; url: string; body: any }[] = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  calls.push({ method: req.method!, url: req.url!, body });
  res.setHeader('Content-Type', 'application/json');
  if (req.url!.startsWith('/v1/customers/')) return res.end(JSON.stringify({ id: 'cus_1', email: 'Owner@Shop.co.uk' }));
  if (req.url!.startsWith('/auth/v1/admin/users') && req.method === 'POST') { res.statusCode = 200; return res.end(JSON.stringify({ id: 'u_1' })); }
  if (req.url!.startsWith('/auth/v1/admin/users')) return res.end(JSON.stringify({ users: [{ id: 'u_1', email: 'owner@shop.co.uk' }] }));
  if (req.url!.startsWith('/rest/v1/entitlements') && req.method === 'POST') return res.end(JSON.stringify([body]));
  res.statusCode = 204; res.end();
});

test('a Capture & Convert subscription grants access; other Gainora products are left alone', async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'svc', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_CAPTURE_PRODUCTS: 'prod_CAP, prod_CAP_FOUNDING' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => realFetch(String(url).replace('https://api.stripe.com', base), init)) as any;
  try {
    const { default: webhook } = await import('../netlify/functions/stripe-webhook');
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_800_000_000, items: { data: [{ price: { product: 'prod_CAP' } }, { price: { product: 'prod_other' } }] } } } };
    const payload = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_x').update(`${t}.${payload}`).digest('hex');
    const bad = await webhook(new Request('http://x/api/stripe-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=deadbeef` } }));
    assert.equal(bad.status, 400);
    const ok = await webhook(new Request('http://x/api/stripe-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } }));
    assert.equal(ok.status, 200);
    const ent = calls.filter((c) => c.url.startsWith('/rest/v1/entitlements') && c.method === 'POST');
    assert.equal(ent.length, 1);
    assert.equal(ent[0].body.email, 'owner@shop.co.uk');
    assert.equal(ent[0].body.agent, 'capture');
    assert.equal(ent[0].body.status, 'active');
    assert.ok(calls.some((c) => c.url.startsWith('/auth/v1/admin/users') && c.method === 'POST' && c.body.email === 'owner@shop.co.uk'));
    assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.startsWith('/rest/v1/entitlements') && c.body.user_id === 'u_1'));

    // A Command Centre product is handled by the Gainora Agents app, not here.
    calls.length = 0;
    const cc = JSON.stringify({ ...event, data: { object: { ...event.data.object, id: 'sub_2', items: { data: [{ price: { product: 'prod_COMMAND' } }] } } } });
    const sig2 = createHmac('sha256', 'whsec_x').update(`${t}.${cc}`).digest('hex');
    assert.equal((await webhook(new Request('http://x/api/stripe-webhook', { method: 'POST', body: cc, headers: { 'stripe-signature': `t=${t},v1=${sig2}` } }))).status, 200);
    assert.equal(calls.filter((c) => c.url.startsWith('/rest/v1/entitlements')).length, 0);
    assert.equal(calls.filter((c) => c.url.startsWith('/auth/v1/admin/users') && c.method === 'POST').length, 0);
  } finally { globalThis.fetch = realFetch; server.close(); }
});
