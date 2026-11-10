import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFake } from './fake-sb';
import { board, bucketOf, dueLabel, progress } from '../shared/admin/board';
import { monthCosts, monthlyFromSubscription, DEFAULT_RATES, ratesFrom } from '../shared/admin/money';
import { billingOf, packagesOf } from '../shared/admin/model';
import { addDays, tasksFor, TEMPLATES, withAuto } from '../shared/admin/templates';
import { newSite } from '../shared/site/data';
import { SAMPLE_PROFILE } from '../src/lib/demo';

test('packages, billing and the set-up checklists', () => {
  assert.deepEqual(packagesOf(['watcher', 'brief', 'capture']), ['command', 'capture']);
  assert.deepEqual(packagesOf(['website']), ['launch']);
  assert.equal(billingOf(['canceled', 'active']), 'active');
  assert.equal(billingOf([]), 'none');
  const launch = tasksFor('launch', 'a@b.co', '2026-11-09');
  assert.equal(launch.length, 25, 'the same six weeks the client sees');
  assert.equal(launch[0].due_on, '2026-11-13');
  assert.equal(launch[launch.length - 1].due_on, addDays('2026-11-09', 39));
  assert.ok(new Set(Object.values(TEMPLATES).flat().map((t) => t.key)).size === Object.values(TEMPLATES).flat().length, 'keys are unique');
  const cap = tasksFor('capture', 'a@b.co', '2026-11-09').map((t, i) => ({ ...t, id: `t${i}`, created_at: '' }));
  const auto = withAuto(cap, new Set(['cap-settings', 'cap-call']));
  assert.equal(auto.find((t) => t.template_key === 'cap:questionnaire')!.status, 'done');
  assert.equal(auto.find((t) => t.template_key === 'cap:test')!.auto, true);
  assert.equal(auto.find((t) => t.template_key === 'cap:number')!.status, 'todo');
  const l = launch.map((t, i) => ({ ...t, id: `l${i}`, created_at: '' }));
  assert.equal(withAuto(l, new Set(), { 'k-call': true }).find((t) => t.template_key === 'launch:k-call')!.status, 'done', 'a tick on the client’s launch plan counts');
});

test('the board sorts deadlines into overdue, today, this week, next week and later', () => {
  const today = '2026-11-11';   // a Wednesday
  const t = (due_on: string | null, status = 'todo') => ({ due_on, status } as any);
  assert.equal(bucketOf(t('2026-11-10'), today), 'overdue');
  assert.equal(bucketOf(t('2026-11-11'), today), 'today');
  assert.equal(bucketOf(t('2026-11-15'), today), 'week');
  assert.equal(bucketOf(t('2026-11-16'), today), 'next');
  assert.equal(bucketOf(t('2026-11-23'), today), 'later');
  assert.equal(bucketOf(t(null), today), 'undated');
  assert.equal(bucketOf(t('2026-11-01', 'done'), today), 'done');
  const b = board([{ ...t('2026-11-15'), sort: 0 }, { ...t('2026-11-12'), sort: 0 }], today);
  assert.deepEqual(b.week.map((x: any) => x.due_on), ['2026-11-12', '2026-11-15']);
  assert.deepEqual(progress([t(null, 'done'), t(null)]), { done: 1, total: 2 });
  assert.equal(dueLabel('2026-11-08', today), '3 days late');
  assert.equal(dueLabel('2026-11-12', today), 'Due tomorrow');
});

test('money: Stripe subscriptions to monthly revenue, usage to costs', () => {
  assert.equal(monthlyFromSubscription({ status: 'active', items: { data: [{ quantity: 1, price: { unit_amount: 19900, recurring: { interval: 'month', interval_count: 1 } } }, { quantity: 1, price: { unit_amount: 120000, recurring: { interval: 'year', interval_count: 1 } } }] } }), 299);
  assert.equal(monthlyFromSubscription({ status: 'canceled', items: { data: [{ price: { unit_amount: 1000, recurring: { interval: 'month' } } }] } }), 0);
  assert.equal(monthlyFromSubscription({ status: 'active', discount: { coupon: { percent_off: 50 } }, items: { data: [{ price: { unit_amount: 10000, recurring: { interval: 'month' } } }] } }), 50);
  const c = monthCosts({ aiUsd: 10, calls: 20, texts: 50, emails: 100, hasNumber: true, siteLive: true, active: true }, DEFAULT_RATES, [{ item: 'Google Ads management fee', amount: 0 }]);
  assert.equal(c.lines.find((l) => l.item.startsWith('AI'))!.amount, 7.9);
  assert.equal(c.lines.find((l) => l.item.startsWith('AI'))!.estimated, false);
  assert.equal(c.lines.find((l) => l.item.startsWith('Receptionist'))!.amount, 7.2);
  assert.equal(c.total, Math.round((7.9 + 7.2 + 2 + 0.1 + 1.15 + 1.5 + 2) * 100) / 100);
  assert.equal(ratesFrom({ sms: '0.05', callMinute: -1, nonsense: 5 }).sms, 0.05);
  assert.equal(ratesFrom({ callMinute: -1 }).callMinute, DEFAULT_RATES.callMinute);
});

test('admin and Claude connector end to end', async () => {
  const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'amy@willow.example', token: 'owner' };
  const ADMIN = { id: '22222222-2222-4222-8222-222222222222', email: 'hello@gainora.co.uk', token: 'admin' };
  const site = { ...newSite('aesthetics'), slug: 'willow' };
  site.business = { ...site.business, name: 'Willow Aesthetics', phone: '01632 960 123', town: 'Crewe', postcode: 'CW1 2BD', line1: '1 High St' };
  const fake = await startFake({
    __users: [OWNER, ADMIN],
    entitlements: [
      { email: OWNER.email, user_id: OWNER.id, agent: 'watcher', status: 'active', stripe_customer: 'cus_1', current_period_end: '2026-12-01T00:00:00Z' },
      { email: OWNER.email, user_id: OWNER.id, agent: 'website', status: 'active', stripe_customer: 'cus_1' },
      { email: 'new@shop.example', user_id: null, agent: 'capture', status: 'trialing' },
    ],
    profiles: [{ user_id: OWNER.id, data: SAMPLE_PROFILE, completed_at: '2026-11-01T10:00:00Z' }],
    sites: [{ id: '33333333-3333-4333-8333-333333333333', user_id: OWNER.id, slug: 'willow', domain: null, data: site, published: null, published_at: null, updated_at: '2026-11-01T00:00:00Z' }],
    site_requests: [{ id: '44444444-4444-4444-8444-444444444444', site_id: '33333333-3333-4333-8333-333333333333', at: '2026-11-09T09:00:00Z', page: 'Home', text: 'New photo please', status: 'open', done_at: null, reply: '' }],
    ai_usage: [{ user_id: OWNER.id, cost_usd: 2.5, created_at: new Date().toISOString() }],
    admin_accounts: [], admin_tasks: [], admin_log: [], admin_costs: [], admin_settings: [], admin_keys: [],
    watcher_state: [], briefs: [], capture_settings: [], enquiry_sources: [], enquiries: [], messages: [],
  });
  Object.assign(process.env, { SUPABASE_URL: fake.base, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', INTERNAL_SECRET: 's', APP_URL: 'https://app.gainora.co.uk', RESEND_API_KEY: 'k' });
  delete process.env.STRIPE_SECRET_KEY;
  const emails: any[] = [];
  fake.external('api.resend.com', (_m, _p, b) => { emails.push(b); return { id: 'e' }; });
  try {
    const { default: admin } = await import('../netlify/functions/admin');
    const { default: mcp } = await import('../netlify/functions/mcp');
    const { default: daily } = await import('../netlify/functions/admin-daily');
    const call = async (b: any, token = 'admin') => admin(new Request('https://admin.gainora.co.uk/api/admin', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));

    // Only Gainora's team gets in.
    assert.equal((await call({ op: 'overview' }, 'owner')).status, 403);

    let o = await (await call({ op: 'overview' })).json();
    assert.deepEqual(o.accounts.map((a: any) => [a.name, a.packages, a.setupStarted]).sort(), [['Willow Aesthetics', ['command', 'launch'], false], ['new@shop.example', ['capture'], false]].sort());
    assert.equal(o.totals.notStarted, 2);
    assert.equal(o.requests[0].client, 'Willow Aesthetics');

    // Start Launch & Grow and Command Centre for Willow: steps with deadlines; onboarding is already done, so it's ticked.
    assert.equal((await (await call({ op: 'start', email: OWNER.email, package: 'launch', start: '2026-11-09' })).json()).made, 25);
    await call({ op: 'start', email: OWNER.email, package: 'command', start: '2026-11-09' });
    assert.equal((await (await call({ op: 'start', email: OWNER.email, package: 'command', start: '2026-11-09' })).json()).made, 0, 'starting twice doesn’t duplicate');
    const acc = await (await call({ op: 'account', email: 'willow' })).json();
    assert.equal(acc.account.name, 'Willow Aesthetics');
    assert.equal(acc.tasks.length, 29);
    assert.equal(acc.tasks.find((t: any) => t.template_key === 'cmd:onboarding').status, 'done');
    assert.equal(acc.costs[0].lines.find((l: any) => l.item.startsWith('AI')).amount, 1.98);
    assert.equal(acc.record.started_on, '2026-11-09');

    // Ticking a Launch & Grow step here ticks it on the client's own launch plan.
    const kcall = acc.tasks.find((t: any) => t.template_key === 'launch:k-call');
    await call({ op: 'task-save', task: { id: kcall.id, status: 'done' } });
    assert.equal(fake.tables.sites[0].data.plan['k-call'], true);
    assert.ok(fake.tables.admin_log.some((l) => /Done: Kick-off call/.test(l.text)));

    // Notes, costs, settings.
    await call({ op: 'log-add', email: OWNER.email, text: 'Called Amy, photos coming Friday', kind: 'call' });
    await call({ op: 'account-save', email: OWNER.email, patch: { setup_fee: 499, setup_paid: false, contact_name: 'Amy Walker' } });
    await call({ op: 'cost-add', email: OWNER.email, item: 'Domain', amount: 12.99 });
    await call({ op: 'settings-save', rates: { sms: 0.05 } });
    const money = await (await call({ op: 'money' })).json();
    const w = money.rows.find((r: any) => r.email === OWNER.email);
    assert.ok(w.lines.some((l: any) => l.item === 'Domain' && l.amount === 12.99));
    assert.equal((await (await call({ op: 'overview' })).json()).totals.unpaidSetup, 499);

    // The Claude connector: a link, then a full session.
    const { url } = await (await call({ op: 'key-create', label: 'Claude' })).json();
    assert.match(url, /^https:\/\/app\.gainora\.co\.uk\/api\/mcp\/[A-Za-z0-9_-]{30,}$/);
    assert.ok(!JSON.stringify(fake.tables.admin_keys).includes(url.split('/').pop()), 'only a hash is stored');
    const key = url.split('/').pop();
    const rpc = async (method: string, params?: any, id: number | null = 1, k = key) => mcp(new Request(`https://app.gainora.co.uk/api/mcp/${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }) }));
    assert.equal((await rpc('initialize', {}, 1, 'wrong-key-wrong-key-wrong-key')).status, 401);
    const init = await (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } })).json();
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'gainora-admin');
    assert.equal((await rpc('notifications/initialized', {}, null)).status, 202);
    const tools = (await (await rpc('tools/list')).json()).result.tools.map((t: any) => t.name);
    assert.ok(['list_clients', 'get_client', 'list_tasks', 'update_task', 'get_website', 'update_website', 'publish_website', 'complete_change_request'].every((n) => tools.includes(n)));
    const use = async (name: string, args: any) => { const r = (await (await rpc('tools/call', { name, arguments: args })).json()).result; return { ...r, data: r.isError ? null : JSON.parse(r.content[0].text) }; };

    const clients = await use('list_clients', {});
    assert.equal(clients.data.find((c: any) => c.email === OWNER.email).client, 'Willow Aesthetics');
    const late = await use('list_tasks', { client: 'willow', who: 'gainora', when: 'all' });
    assert.ok(late.data.length > 10);
    const edited = await use('update_website', { client: 'Willow', changes: { copy: { 'home.title': 'Skin you feel good in' }, look: { fonts: 'editorial' }, business: { areas: ['Crewe', 'Nantwich'] } }, note: 'New headline' });
    assert.equal(edited.data.saved, true);
    assert.equal(fake.tables.sites[0].data.copy['home.title'], 'Skin you feel good in');
    assert.equal(fake.tables.sites[0].data.look.fonts, 'editorial');
    assert.equal(fake.tables.sites[0].data.look.accent, site.look.accent, 'what wasn’t sent is kept');
    assert.deepEqual(fake.tables.sites[0].data.business.areas, ['Crewe', 'Nantwich']);
    const pub = await use('publish_website', { client: OWNER.email });
    assert.equal(pub.data.published, true);
    assert.ok(fake.tables.sites[0].published);
    const reqDone = await use('complete_change_request', { request_id: '44444444-4444-4444-8444-444444444444', reply: 'New photo is up.' });
    assert.equal(reqDone.data.done, true);
    assert.ok(emails.some((e) => e.to[0] === OWNER.email && /change is done/.test(e.subject)));
    const unknown = await use('get_client', { client: 'nobody-at-all' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /No client matches/);
    assert.ok(fake.tables.admin_log.filter((l) => l.author === 'Claude').length >= 3, 'Claude’s work is on the record');
    // Claude never sees the client's customers.
    assert.ok(!(await use('get_client', { client: 'willow' })).content[0].text.includes('enquiries"'));

    // Revoking the link locks Claude out.
    const keys = (await (await call({ op: 'keys' })).json()).keys;
    await call({ op: 'key-revoke', id: keys[0].id });
    assert.equal((await rpc('tools/list')).status, 401);

    // The morning email.
    const r = await daily();
    assert.equal(await r.text(), 'sent');
    const morning = emails.find((e) => /^Gainora today/.test(e.subject));
    assert.equal(morning.to[0], 'hello@gainora.co.uk');
    assert.match(morning.text, /New clients with no set-up started:\n• new@shop\.example/);
  } finally { fake.server.close(); }
});
