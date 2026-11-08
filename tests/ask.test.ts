import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureReply, mergeChat, POLL_DELAYS_MS, replyAfter, waitingText } from '../shared/chat';

const msg = (id: string, role: 'user' | 'agent', text: string, at: string) => ({ id, role, text, at });

test('ask: the reply to a question is the first agent message after it; merging keeps the server copy', () => {
  const q = msg('q1', 'user', 'How do my prices compare?', '2026-11-08T23:28:00.000Z');
  const list = [msg('a0', 'agent', 'old', '2026-11-08T23:00:00.000Z'), q, msg('a1', 'agent', 'Your lip filler is £20 above the local average.', '2026-11-08T23:28:09.000Z')];
  assert.equal(replyAfter(list, q)?.id, 'a1');
  assert.equal(replyAfter(list.slice(0, 2), q), null);
  // The question's local copy has a temporary id: match by time instead.
  assert.equal(replyAfter(list, { id: 'tmp123', at: q.at })?.id, 'a1');
  const local = [msg('tmp1', 'user', 'How do my prices compare?', '2026-11-08T23:28:00.500Z'), msg('tmp2', 'user', 'unsent draft', '2026-11-08T23:40:00.000Z')];
  const merged = mergeChat(local, list);
  assert.deepEqual(merged.map((m) => m.id), ['a0', 'q1', 'a1', 'tmp2'], 'the temporary copy of a saved question is dropped, an unsent one kept');
  assert.equal(POLL_DELAYS_MS.reduce((a, b) => a + b, 0) > 80_000, true, 'polls for well over a minute');
  assert.equal(waitingText(3_000), 'Writing an answer');
  assert.match(waitingText(20_000), /usually take/);
  assert.match(waitingText(45_000), /saved to this conversation/);
  assert.match(failureReply('You’ve reached this month’s research allowance. It resets on the 1st.'), /research allowance/);
  assert.match(failureReply('SyntaxError: Unexpected token < in JSON'), /didn’t respond/);
  assert.ok(!/JSON/.test(failureReply('SyntaxError: Unexpected token < in JSON')));
});

/* ---------- The chat function: hand-off to the background, with an inline fallback ---------- */
function fakeSupabase(log: { url: string; method: string; body?: any }[], opts: { internalOk: boolean }) {
  let n = 0;
  return async (url: any, init: any) => {
    const u = String(url);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    log.push({ url: u, method, body });
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'h@x.co.uk' }), { status: 200 });
    if (u.includes('/rest/v1/entitlements')) return new Response(JSON.stringify([{ agent: 'watcher' }]), { status: 200 });
    if (u.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ data: { business: { name: 'Willow Skin', ownerName: 'Hannah' }, offer: {}, customers: {}, competitors: {}, goals: {}, preferences: {} } }]), { status: 200 });
    if (u.includes('/rest/v1/chat_messages') && method === 'POST') { n++; return new Response(JSON.stringify([{ id: `m${n}`, ...body, created_at: `2026-11-08T23:28:0${n}.000Z` }]), { status: 201 }); }
    if (u.includes('/rest/v1/chat_messages')) return new Response('[]', { status: 200 });
    if (u.includes('/rest/v1/ai_usage')) return new Response(method === 'POST' ? '[{}]' : '[]', { status: 200 });
    if (u.includes('/.netlify/functions/chat-background')) return new Response(null, { status: opts.internalOk ? 202 : 500 });
    if (u === 'https://api.anthropic.com/v1/messages') return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Your lip filler is £20 above the local average.\nSOURCES: prices' }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
    return new Response('[]', { status: 200 });
  };
}

test('ask: the question is saved first and the answer handed to the background; the app gets the saved question back to poll on', async () => {
  const real = globalThis.fetch;
  const log: any[] = [];
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', URL: 'http://site.test', INTERNAL_SECRET: 's3cret', ANTHROPIC_API_KEY: 'sk-ant-api-test', AI_MONTHLY_CAP_USD: '100' });
  globalThis.fetch = fakeSupabase(log, { internalOk: true }) as any;
  try {
    const { default: handler } = await import('../netlify/functions/chat');
    const res = await handler(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ text: 'How do my prices compare?' }), headers: { Authorization: 'Bearer t' } }));
    assert.equal(res.status, 202);
    const j: any = await res.json();
    assert.equal(j.queued, true);
    assert.equal(j.question.role, 'user');
    assert.equal(j.question.text, 'How do my prices compare?');
    const handoff = log.find((l) => l.url.includes('chat-background'));
    assert.ok(handoff, 'background function called');
    assert.equal(handoff.body.questionId, j.question.id);
    assert.ok(!log.some((l) => l.url.includes('anthropic')), 'no AI call in the synchronous function');
  } finally { globalThis.fetch = real; }
});

test('ask: when the hand-off fails the answer is written inline and saved, so the owner still gets a reply', async () => {
  const real = globalThis.fetch;
  const log: any[] = [];
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', URL: 'http://site.test', INTERNAL_SECRET: 's3cret', ANTHROPIC_API_KEY: 'sk-ant-api-test', AI_MONTHLY_CAP_USD: '100' });
  globalThis.fetch = fakeSupabase(log, { internalOk: false }) as any;
  try {
    const { default: handler } = await import('../netlify/functions/chat');
    const res = await handler(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ text: 'How do my prices compare?' }), headers: { Authorization: 'Bearer t' } }));
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.queued, false);
    assert.equal(j.reply.role, 'agent');
    assert.equal(j.reply.text, 'Your lip filler is £20 above the local average.');
    assert.deepEqual(j.reply.sources.map((s: any) => s.title.replace(/ \(.*\)$/, '')), ['The Watcher’s price comparison']);
    const saves = log.filter((l) => l.url.includes('chat_messages') && l.method === 'POST');
    assert.deepEqual(saves.map((s) => s.body.role), ['user', 'agent'], 'question saved before the answer, answer saved after');
    const ai = log.find((l) => l.url.includes('anthropic'));
    assert.equal(ai.body.messages.at(-1).content, 'How do my prices compare?');
    assert.ok(ai.body.max_tokens <= 700);
  } finally { globalThis.fetch = real; }
});

test('ask: when the AI fails, a plain reply is still saved so the question is never left hanging', async () => {
  const real = globalThis.fetch;
  const log: any[] = [];
  const base = fakeSupabase(log, { internalOk: false });
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', URL: 'http://site.test', INTERNAL_SECRET: 's3cret', ANTHROPIC_API_KEY: 'sk-ant-api-test', AI_MONTHLY_CAP_USD: '100' });
  globalThis.fetch = (async (url: any, init: any) => (String(url).includes('anthropic') ? new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 }) : base(url, init))) as any;
  try {
    const { default: handler } = await import('../netlify/functions/chat');
    const res = await handler(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ text: 'Hello?' }), headers: { Authorization: 'Bearer t' } }));
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.reply.role, 'agent');
    assert.match(j.reply.text, /couldn’t answer that just now/);
  } finally { globalThis.fetch = real; delete process.env.ANTHROPIC_API_KEY; }
});

test('ask: the background writer skips a question that already has its answer', async () => {
  const real = globalThis.fetch;
  const log: any[] = [];
  Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 's3cret' });
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url); log.push({ url: u, method: init?.method || 'GET' });
    if (u.includes('chat_messages') && u.includes('id=eq.q1')) return new Response(JSON.stringify([{ id: 'q1', text: 'x', role: 'user', created_at: '2026-11-08T23:28:00.000Z' }]), { status: 200 });
    if (u.includes('chat_messages') && u.includes('role=eq.agent')) return new Response(JSON.stringify([{ id: 'a1' }]), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as any;
  try {
    const { default: bg } = await import('../netlify/functions/chat-background');
    const res = await bg(new Request('http://x/.netlify/functions/chat-background', { method: 'POST', body: JSON.stringify({ userId: 'u1', questionId: 'q1' }), headers: { 'x-gainora-internal': 's3cret' } }));
    assert.equal(res.status, 202);
    assert.ok(!log.some((l) => l.url.includes('profiles')), 'answered already: nothing more is done');
    const bad = await bg(new Request('http://x/.netlify/functions/chat-background', { method: 'POST', body: '{}', headers: { 'x-gainora-internal': 'wrong' } }));
    assert.equal(bad.status, 202, 'never throws; a bad secret is logged and ignored');
  } finally { globalThis.fetch = real; }
});
