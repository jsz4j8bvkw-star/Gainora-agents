import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFake } from './fake-sb';
import { ukToday } from '../shared/admin/board';
import { addDays } from '../shared/admin/templates';
import { answersText, cleanAnswers, cleanQuestions, progressOf, templateFor } from '../shared/admin/asks';

test('question sets: cleaning, answers and progress', () => {
  const qs = cleanQuestions([{ label: 'Your name', type: 'text' }, { label: '' }, { id: 'pics', label: 'Photos', type: 'photos' }, { id: 'pics', label: 'Again', type: 'weird' }]);
  assert.deepEqual(qs.map((q) => [q.id, q.type]), [['q1', 'text'], ['pics', 'photos'], ['pics_3', 'long']]);
  const a = cleanAnswers(qs, { q1: '  Amy  ', pics: 'nope', pics_3: '', extra: 'x' });
  assert.deepEqual(a, { q1: 'Amy' });
  assert.deepEqual(progressOf({ questions: qs, answers: a, files: [{ url: 'u', name: 'n', question: 'pics' }] }), { answered: 2, total: 3 });
  assert.match(answersText({ questions: qs, answers: a, files: [] }), /Your name\nAmy\n\nPhotos\n\(no photos added\)/);
  const w = templateFor('website');
  assert.ok(w.questions.length >= 14 && w.next?.who === 'claude');
  assert.equal(templateFor('nope').key, 'custom');
});

// Asking a client for details end to end: draft → sent by email → opened → saved as they type → a photo → sent
// back → their step ticked, a task for Claude, the team told, the answers readable through the connector.
test('asking a client for details, from the admin to the answers', async () => {
  const ADMIN = { id: '22222222-2222-4222-8222-222222222222', email: 'hello@gainora.co.uk', token: 'admin' };
  const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'amy@alder.example', token: 'owner' };
  const fake = await startFake({
    __users: [ADMIN, OWNER],
    entitlements: [{ email: OWNER.email, user_id: OWNER.id, agent: 'brief', status: 'active' }, { email: OWNER.email, user_id: OWNER.id, agent: 'website', status: 'active' }],
    admin_accounts: [{ email: OWNER.email, business_name: 'Alder Ease Aesthetics', contact_name: 'Amy Walker', status: 'onboarding' }],
    client_asks: [], admin_tasks: [], admin_log: [], admin_keys: [], admin_settings: [], admin_costs: [], profiles: [], sites: [], site_requests: [], ai_usage: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 's', APP_URL: 'https://app.gainora.co.uk', RESEND_API_KEY: 'k' });
  delete process.env.STRIPE_SECRET_KEY;
  const emails: any[] = [];
  fake.external('api.resend.com', (_m, _p, b) => { emails.push(b); return { id: `e${emails.length}` }; });
  try {
    const { default: asks } = await import('../netlify/functions/admin-asks');
    const { default: form } = await import('../netlify/functions/ask');
    const { default: admin } = await import('../netlify/functions/admin');
    const { default: mcp } = await import('../netlify/functions/mcp');
    const call = (b: any, token = 'admin') => asks(new Request('https://admin.gainora.co.uk/api/admin-asks', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));
    const ok = async (r: Response | Promise<Response>) => { const res = await r; const j = await res.json(); assert.equal(res.status, 200, JSON.stringify(j)); return j; };

    assert.equal((await call({ op: 'list' }, 'owner')).status, 403, 'clients can’t use it');

    // Draft from the website template, then send it.
    const { ask } = await ok(call({ op: 'save', ask: { email: 'Alder Ease', template: 'website' } }));
    assert.equal(ask.status, 'draft');
    assert.equal(ask.email, OWNER.email);
    assert.equal(ask.due_on, addDays(ukToday(), 5));
    assert.match(ask.url, /^https:\/\/app\.gainora\.co\.uk\/q\/[A-Za-z0-9_-]{20,}$/);
    const draftPage = await form(new Request(ask.url));
    assert.equal(draftPage.status, 404, 'a draft link doesn’t open');
    const sent = await ok(call({ op: 'send', id: ask.id, email: OWNER.email }));
    assert.equal(sent.ask.status, 'sent');
    const mail = emails.find((e) => e.to[0] === OWNER.email);
    assert.equal(mail.subject, 'Your new website: a few questions');
    assert.equal(mail.reply_to, 'hello@gainora.co.uk');
    assert.match(mail.text, /^Hi Amy,/);
    assert.ok(mail.html.includes(ask.url));
    const clientTask = fake.tables.admin_tasks.find((t) => t.who === 'client');
    assert.equal(clientTask.title, 'Answer: Your new website: a few questions');
    assert.equal(clientTask.due_on, ask.due_on);
    assert.ok(fake.tables.admin_log.some((l) => /^Asked: Your new website/.test(l.text)));

    // The client opens it on their phone.
    const html = await (await form(new Request(ask.url))).text();
    for (const bit of ['Your new website: a few questions', 'About you and the clinic', 'Add photos', 'Send to Gainora', 'name="owner"']) assert.ok(html.includes(bit), bit);
    assert.equal(fake.tables.client_asks[0].status, 'opened');

    // Saves as they type, a photo, a wrong file type, then sends it.
    const save = await (await form(new Request(`${ask.url}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { owner: 'Amy Walker, nurse prescriber, 6 years', treatments: 'Skin boosters £180, 45 min' } }) }))).json();
    assert.deepEqual([save.answered, save.total], [2, 15]);
    const photo = await (await form(new Request(`${ask.url}/photo?question=photos&name=room.jpg`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255, 1, 2, 3]) }))).json();
    assert.match(photo.file.url, new RegExp(`/storage/v1/object/public/site-media/${OWNER.id}/from-questions/.+\\.jpg$`), 'photos go in the client’s own website folder');
    assert.equal((await form(new Request(`${ask.url}/photo?question=photos&name=x.gif`, { method: 'POST', headers: { 'Content-Type': 'image/gif' }, body: new Uint8Array([1]) }))).status, 415);
    assert.equal((await form(new Request(`${ask.url}/photo?question=owner&name=x.jpg`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([1]) }))).status, 400);
    assert.equal(fake.tables.__storage.length, 1);
    const done = await form(new Request(`${ask.url}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { owner: 'Amy Walker, nurse prescriber, 6 years', case_study: 'yes', baseline: 'About 20 enquiries, 12 bookings' } }) }));
    assert.equal(done.status, 200);
    const row = fake.tables.client_asks[0];
    assert.equal(row.status, 'answered');
    assert.equal(row.answers.treatments, 'Skin boosters £180, 45 min', 'earlier answers are kept');
    assert.equal(row.answers.case_study, 'yes');
    assert.equal(fake.tables.admin_tasks.find((t) => t.id === clientTask.id).status, 'done', 'their checklist step is ticked');
    const next = fake.tables.admin_tasks.find((t) => t.who === 'claude');
    assert.equal(next.title, 'Build the website draft from their answers');
    assert.equal(next.project, 'launch');
    const team = emails.find((e) => /^Answers in:/.test(e.subject));
    assert.equal(team.to[0], 'hello@gainora.co.uk');
    assert.match(team.text, /Skin boosters £180/);
    assert.match(await (await form(new Request(ask.url))).text(), /Thank you/);
    assert.match(await (await form(new Request(`${ask.url}?edit=1`))).text(), /Send the changes to Gainora/);

    // Through the connector, Claude sees the answers; it can draft questions but not send them.
    const { url } = await (await admin(new Request('https://admin.gainora.co.uk/api/admin', { method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'key-create', label: 'Claude' }) }))).json();
    const key = url.split('/').pop();
    const use = async (name: string, args: any) => { const r = (await (await mcp(new Request(`https://app.gainora.co.uk/api/mcp/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }))).json()).result; return r.isError ? r : JSON.parse(r.content[0].text); };
    const answered = await use('list_client_questions', { status: 'answered' });
    assert.equal(answered[0].client, 'Alder Ease Aesthetics');
    assert.match(answered[0].answers, /nurse prescriber/);
    assert.equal(answered[0].photos.length, 1);
    const drafted = await use('draft_client_questions', { client: 'alder', questions: [{ label: 'Which photo should go at the top of the home page?', type: 'text' }] });
    assert.equal(drafted.draft, true);
    const before = emails.length;
    assert.equal(fake.tables.client_asks.filter((a) => a.status === 'draft').length, 1);
    assert.equal(emails.length, before, 'drafting sends nothing');
    assert.equal((await use('get_client', { client: 'alder' })).questions_sent.length, 2);

    // Remind, cancel, and a one-off email.
    const draft2 = fake.tables.client_asks.find((a) => a.status === 'draft');
    await ok(call({ op: 'send', id: draft2.id }));
    await ok(call({ op: 'remind', id: draft2.id }));
    assert.ok(emails.some((e) => /^Reminder:/.test(e.subject) && /^Hi Amy,/.test(e.text)));
    await ok(call({ op: 'cancel', id: draft2.id }));
    assert.equal((await form(new Request(`https://app.gainora.co.uk/q/${draft2.token}`))).status, 404, 'a cancelled link stops working');
    assert.equal((await call({ op: 'cancel', id: ask.id })).status, 409, 'answered ones can’t be cancelled');
    await ok(call({ op: 'email', email: 'Alder Ease', subject: 'Photos for your site', message: 'Hi Amy,\n\nCould you send one more photo of the room?' }));
    const one = emails.find((e) => e.subject === 'Photos for your site');
    assert.equal(one.reply_to, 'hello@gainora.co.uk');
    assert.ok(fake.tables.admin_log.some((l) => l.kind === 'email' && /Photos for your site/.test(l.text)));
    const list = await ok(call({ op: 'list', email: OWNER.email }));
    assert.equal(list.asks.length, 2);
  } finally { fake.server.close(); }
});
